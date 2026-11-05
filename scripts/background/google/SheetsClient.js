// Last compiled at 2026-11-05_0049
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
import { mapColumns, buildOrderCells, buildFieldCells, normaliseHeader, NO_ORDER_NUMBER_COLUMN } from "../../core/utils/DashboardRow.js";

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
		const values = (await request("GET", `/v4/spreadsheets/${id}/values/${encodeURIComponent(`${quoteSheet(sheetName)}!A1:Z`)}`)).values || [];

		const headerRow = values.slice(0, 10).findIndex((r) => (r || []).some((c) => ["ORDER#", "ORDERNUMBER", "ORDERNO"].includes(normaliseHeader(c))));
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
			sheetId: sheet.sheetId,
			rowCount: sheet.gridProperties?.rowCount ?? values.length,
			columnCount: sheet.gridProperties?.columnCount ?? 0,
			headerRow,
			colMap,
			orders,
			lastDataRow,
		};
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

	return {
		loadDashboard,

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
