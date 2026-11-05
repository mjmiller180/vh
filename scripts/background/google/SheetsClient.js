// Last compiled at 2026-11-05_1433
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/**
 * Minimal Google Sheets client for the DASHBOARD. Everything that touches the network is injected
 * (fetchFn, getToken, clearToken, sleep) so the logic is unit tested against an in-memory fake of the API.
 *
 * Safety rules:
 *  - the header row must contain an "ORDER #" column, otherwise nothing is written
 *  - new orders go into the first empty row after the last data row, and that row first receives the FORMAT and
 *    DATA VALIDATION (dropdowns) of the last data row, so it looks and behaves like the others
 *  - every cell is written by its own updateCells request with an explicit field mask, so no other column
 *    (manual columns, formulas) is ever cleared
 *  - an order number that is already on the sheet is never added twice
 */
import { decodeEntities } from "../../core/utils/VineListParser.js";
import { mapColumns, buildOrderCells, buildFieldCells, normaliseHeader, NO_ORDER_NUMBER_COLUMN, mapReviewStatus, mapReviewScore, dateToSerial, starsText, MANUAL_REVIEW_STATES } from "../../core/utils/DashboardRow.js";

const BASE = "https://sheets.googleapis.com";
const CELL_FIELDS = "userEnteredValue,textFormatRuns";
const CELL_FIELDS_WITH_FORMAT = "userEnteredValue,textFormatRuns,userEnteredFormat.numberFormat";

// All writes in this worker run one at a time. Two overlapping calls would both pick the same "first empty
// row"; serialising them makes the second one read the sheet AFTER the first one has written.
let writeChain = Promise.resolve();
function serialise(fn) {
	const run = writeChain.then(fn, fn);
	writeChain = run.catch(() => {});
	return run;
}

export class SheetsError extends Error {
	constructor(status, message) {
		super(message);
		this.name = "SheetsError";
		this.status = status;
	}
}

const quoteSheet = (name) => `'${String(name).replace(/'/g, "''")}'`;

export function createSheetsClient({ fetchFn = globalThis.fetch?.bind(globalThis), getToken, clearToken = async () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), baseUrl = BASE }) {
	async function request(method, path, body) {
		let refreshed = false;
		for (let attempt = 0; attempt < 4; attempt++) {
			const token = await getToken();
			const res = await fetchFn(baseUrl + path, {
				method,
				headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
				body: body === undefined ? undefined : JSON.stringify(body),
			});
			if (res.ok) return res.json();
			if (res.status === 401 && !refreshed) {
				refreshed = true;
				await clearToken(token); // the cached token is stale: drop it and ask for a fresh one
				continue;
			}
			// 429 means "not applied, try later". A 5xx on a WRITE may have been applied (resending would, for example,
			// add the blank rows twice), so only reads are retried on 5xx.
			const retryable = res.status === 429 || (res.status >= 500 && method === "GET");
			if (retryable && attempt < 3) {
				await sleep(1000 * 2 ** attempt);
				continue;
			}
			let message = `HTTP ${res.status}`;
			try {
				message = (await res.json())?.error?.message || message;
			} catch (e) {}
			throw new SheetsError(res.status, message); // never includes the token
		}
		throw new SheetsError(0, "Too many retries");
	}

	async function loadDashboard(spreadsheetId, sheetName) {
		const id = encodeURIComponent(spreadsheetId);
		const meta = await request("GET", `/v4/spreadsheets/${id}?fields=${encodeURIComponent("sheets.properties(sheetId,title,gridProperties)")}`);
		const sheet = (meta.sheets || []).map((s) => s.properties).find((p) => p.title === sheetName);
		if (!sheet) throw new SheetsError(404, `Sheet tab "${sheetName}" not found`);
		// every column of the tab (not a fixed A:Z), so columns added further right are seen too
		const lastCol = colLetter(Math.max(26, sheet.gridProperties?.columnCount || 0) - 1);
		const values = (await request("GET", `/v4/spreadsheets/${id}/values/${encodeURIComponent(`${quoteSheet(sheetName)}!A1:${lastCol}`)}`)).values || [];

		const headerRow = values.slice(0, 30).findIndex((r) => (r || []).some((c) => ["ORDER#", "ORDERNUMBER", "ORDERNO"].includes(normaliseHeader(c))));
		if (headerRow < 0) throw new Error(NO_ORDER_NUMBER_COLUMN);
		const colMap = mapColumns(values[headerRow]);

		const orders = new Map(); // order number -> 0-based row index
		let lastDataRow = headerRow;
		// A row is "used" if any key column has something in it (a half-filled row is not free to overwrite).
		const keyColumns = ["orderDate", "orderNumber", "title", "etv"].map((k) => colMap[k]).filter((c) => c !== undefined);
		for (let i = headerRow + 1; i < values.length; i++) {
			const row = values[i] || [];
			const num = String(row[colMap.orderNumber] ?? "").trim();
			if (num) orders.set(num, i);
			if (keyColumns.some((c) => String(row[c] ?? "").trim() !== "")) lastDataRow = i;
		}
		return {
			spreadsheetId,
			sheetName,
			values,
			sheetId: sheet.sheetId,
			rowCount: sheet.gridProperties?.rowCount ?? values.length,
			columnCount: sheet.gridProperties?.columnCount ?? 0,
			headerRow,
			colMap,
			orders,
			lastDataRow,
		};
	}

	const colLetter = (i) => {
		let n = i + 1;
		let out = "";
		while (n > 0) {
			out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
			n = Math.floor((n - 1) / 26);
		}
		return out;
	};

	/** 0-based row index -> ASIN, read from the link on each TITLE cell (https://www.amazon.<tld>/dp/<ASIN>). */
	async function loadTitleAsins(dash) {
		if (dash.colMap.title === undefined) return new Map();
		const col = colLetter(dash.colMap.title);
		const range = `${quoteSheet(dash.sheetName)}!${col}1:${col}`;
		const res = await request("GET", `/v4/spreadsheets/${encodeURIComponent(dash.spreadsheetId)}?ranges=${encodeURIComponent(range)}&fields=${encodeURIComponent("sheets.data(startRow,rowData.values(hyperlink,textFormatRuns.format.link.uri))")}`);
		const data = res.sheets?.[0]?.data?.[0] || {};
		const start = data.startRow || 0;
		const out = new Map();
		(data.rowData || []).forEach((r, i) => {
			const cell = r?.values?.[0];
			// a whole-cell link comes back as `hyperlink`; a link written as rich text may only show up in the text runs
			const link = cell?.hyperlink || cell?.textFormatRuns?.find((t) => t?.format?.link?.uri)?.format.link.uri || "";
			const m = String(link).match(/\/dp\/([A-Z0-9]{10})(?:[/?#]|$)/i);
			if (m) out.set(start + i, m[1].toUpperCase());
		});
		return out;
	}

	const cellRequest = (sheetId, rowIndex, { column, cell }) => ({
		updateCells: {
			rows: [{ values: [cell] }],
			fields: cell.userEnteredFormat ? CELL_FIELDS_WITH_FORMAT : CELL_FIELDS,
			start: { sheetId, rowIndex, columnIndex: column },
		},
	});

	const batch = (spreadsheetId, requests) => request("POST", `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, { requests });

	async function addOrdersNow(spreadsheetId, sheetName, orders, { dryRun = false } = {}) {
		const dash = await loadDashboard(spreadsheetId, sheetName);
		const seen = new Set(dash.orders.keys());
		const fresh = [];
		let skipped = 0;
		const sourceRow = dash.lastDataRow > dash.headerRow ? dash.lastDataRow : null;
		for (const order of orders) {
			if (seen.has(order.orderNumber)) {
				skipped++;
				continue;
			}
			// validates the order (throws on bad data); with no row above to copy from, set the number formats too
			const cells = buildOrderCells(order, dash.colMap, { withFormats: sourceRow === null });
			seen.add(order.orderNumber);
			fresh.push(cells);
		}
		if (fresh.length === 0) return { added: 0, skipped, requests: [] };

		const startRow = dash.lastDataRow + 1;
		const requests = [];
		const needRows = startRow + fresh.length;
		if (needRows > dash.rowCount) requests.push({ appendDimension: { sheetId: dash.sheetId, dimension: "ROWS", length: needRows - dash.rowCount } });

		// copy format + dropdowns across the WHOLE row (also the owner's columns to the right of the ones we write)
		const width = Math.max(Math.max(...Object.values(dash.colMap)) + 1, dash.columnCount || 0);
		const range = (row) => ({ sheetId: dash.sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: width });

		fresh.forEach((cells, k) => {
			const row = startRow + k;
			if (sourceRow !== null) {
				for (const pasteType of ["PASTE_FORMAT", "PASTE_DATA_VALIDATION"]) {
					requests.push({ copyPaste: { source: range(sourceRow), destination: range(row), pasteType, pasteOrientation: "NORMAL" } });
				}
			}
			for (const c of cells) requests.push(cellRequest(dash.sheetId, row, c));
		});

		if (dryRun) return { dryRun: true, added: fresh.length, skipped, requests };
		await batch(spreadsheetId, requests);
		return { added: fresh.length, skipped, requests };
	}

	async function updateOrderNow(spreadsheetId, sheetName, orderNumber, fields, { dryRun = false } = {}) {
		const dash = await loadDashboard(spreadsheetId, sheetName);
		const row = dash.orders.get(orderNumber);
		if (row === undefined) throw new Error(`Order ${orderNumber} not found on the sheet`);
		const cells = buildFieldCells(fields, dash.colMap);
		if (cells.length === 0) return { updated: 0, requests: [] };
		const requests = cells.map((c) => cellRequest(dash.sheetId, row, c));
		if (dryRun) return { dryRun: true, updated: cells.length, requests };
		await batch(spreadsheetId, requests);
		return { updated: cells.length, requests };
	}

	/** Serial of a date cell shown as M/D/YYYY or M/D/YY (null when empty or not a date). */
	const cellSerial = (dash, row, key) => {
		const v = String((dash.values[row] || [])[dash.colMap[key]] ?? "").trim();
		try {
			return v ? dateToSerial(/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(v) ? v.replace(/\/(\d{2})$/, "/20$1") : v) : null;
		} catch (e) {
			return null;
		}
	};
	const DONE_BEFORE_REVIEW = ["", "ORDERED", "SHIPPED", "DELIVERED", "WAITING FOR VINE"];

	/**
	 * Copy what Amazon's Vine "reviews" pages say into the REVIEW columns of the matching DASHBOARD rows.
	 * A row is found by the ASIN in its title link (and the order date when the ASIN is on the sheet more than once).
	 * Values the owner set by hand (TAKEN DOWN, ...) and values that are already right are never written.
	 * @param {{asin:string, orderDate?:string, status?:string, score?:string, reviewLink?:string}[]} reviews
	 */
	async function updateReviewsNow(spreadsheetId, sheetName, reviews, { dryRun = false } = {}) {
		const dash = await loadDashboard(spreadsheetId, sheetName);
		const asins = await loadTitleAsins(dash);
		const cur = (row, key) => String((dash.values[row] || [])[dash.colMap[key]] ?? "").trim();
		const rowsByAsin = new Map();
		for (const [row, asin] of asins) {
			if (row > dash.headerRow) rowsByAsin.set(asin, [...(rowsByAsin.get(asin) || []), row]);
		}
		// Rows whose title cell has no product link (not all of the owner's rows have one) are found by order date + title.
		// The sheet's titles may hold literal entities ("&amp;", "&#39;") from older pastes: compare the decoded text.
		const norm = (t) => decodeEntities(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
		const sameTitle = (a, b) => {
			const n = Math.min(a.length, b.length, 60);
			return n >= 20 && a.slice(0, n) === b.slice(0, n); // (one of the two may be shortened)
		};
		const rowsByTitle = (title, serial) => {
			const want = norm(title);
			if (!want || serial === null) return [];
			const out = [];
			for (let i = dash.headerRow + 1; i < dash.values.length; i++) {
				if (cellSerial(dash, i, "orderDate") === serial && sameTitle(norm(cur(i, "title")), want)) out.push(i);
			}
			return out;
		};
		const reviewId = (u) => String(u || "").match(/\/(R[A-Z0-9]{8,})(?:[/?#]|$)/)?.[1] || null;
		const requests = [];
		const seenRows = new Set();
		let updated = 0, unchanged = 0, unmatched = 0, ambiguous = 0;
		for (const r of reviews) {
			let rows = rowsByAsin.get(String(r.asin || "").toUpperCase()) || [];
			if (r.orderDate) {
				// The order date decides which order a review belongs to, also when the sheet has the ASIN only once
				// (a re-order that is not on the sheet must not write onto the older order's row).
				let want = null;
				try {
					want = dateToSerial(r.orderDate);
				} catch (e) {}
				if (want !== null) rows = rows.filter((x) => {
					const have = cellSerial(dash, x, "orderDate");
					return have === null || have === want; // an unreadable date on the sheet does not rule the row out
				});
			}
			if (rows.length === 0 && r.title && r.orderDate) {
				let want = null;
				try {
					want = dateToSerial(r.orderDate);
				} catch (e) {}
				rows = rowsByTitle(r.title, want);
			}
			if (rows.length === 0) {
				unmatched++;
				continue;
			}
			if (rows.length > 1) {
				ambiguous++;
				continue;
			}
			const row = rows[0];
			if (seenRows.has(row)) {
				ambiguous++; // two reviews in the list point at the same row: only the first is used, the other is reported
				continue;
			}
			seenRows.add(row);

			const now = cur(row, "reviewStatus");
			if (MANUAL_REVIEW_STATES.includes(now)) {
				unchanged++; // the owner set this row by hand: nothing on it is touched
				continue;
			}
			const fields = {};
			const status = mapReviewStatus(r.status);
			if (status && (status === "NOT SUBMITTED" ? now === "" || now === "PENDING APPROVAL" : status !== now)) fields.reviewStatus = status;
			const score = mapReviewScore(r.score);
			if (score && score !== cur(row, "reviewScore")) fields.reviewScore = score;
			if (status === "LIVE" && DONE_BEFORE_REVIEW.includes(cur(row, "status"))) fields.status = "COMPLETED";
			// the owner's sheet keeps review links as https://www.amazon.com/review/<ID>/ref=cm_cr_othr_d_rdp_perm?ie=UTF8;
			// the Vine list gives /gp/customer-reviews/<ID>. The same review in either form is "already there".
			const rid = reviewId(r.reviewLink);
			if (rid && rid !== reviewId(cur(row, "reviewLink"))) fields.reviewLink = `https://www.amazon.com/review/${rid}/ref=cm_cr_othr_d_rdp_perm?ie=UTF8`;
			for (const key of ["reviewTitle", "reviewText"]) if (r[key] && String(r[key]).slice(0, 50000) !== cur(row, key)) fields[key] = r[key];
			if (r.starRating && starsText(r.starRating) !== cur(row, "starRating")) fields.starRating = r.starRating;
			if (r.reviewDate) {
				let want = null;
				try {
					want = dateToSerial(r.reviewDate);
				} catch (e) {}
				if (want !== null && cellSerial(dash, row, "reviewDate") !== want) fields.reviewDate = r.reviewDate;
			}

			const cells = buildFieldCells(fields, dash.colMap);
			if (cells.length === 0) {
				unchanged++;
				continue;
			}
			updated++;
			for (const c of cells) requests.push(cellRequest(dash.sheetId, row, c));
		}
		if (requests.length === 0) return { updated, unchanged, unmatched, ambiguous, requests };
		if (dryRun) return { dryRun: true, updated, unchanged, unmatched, ambiguous, requests };
		await batch(spreadsheetId, requests);
		return { updated, unchanged, unmatched, ambiguous, requests };
	}

	return {
		loadDashboard,

		/** See updateReviewsNow. */
		updateReviews: (spreadsheetId, sheetName, reviews, opts) => serialise(() => updateReviewsNow(spreadsheetId, sheetName, reviews, opts)),

		/**
		 * Append new orders to the DASHBOARD.
		 * @returns {{added: number, skipped: number, requests?: object[], dryRun?: boolean}}
		 */
		addOrders: (spreadsheetId, sheetName, orders, opts) => serialise(() => addOrdersNow(spreadsheetId, sheetName, orders, opts)),

		/** Update chosen columns (review status, star rating, review date/link, pics ...) of an existing order. */
		updateOrder: (spreadsheetId, sheetName, orderNumber, fields, opts) =>
			serialise(() => updateOrderNow(spreadsheetId, sheetName, orderNumber, fields, opts)),
	};
}
