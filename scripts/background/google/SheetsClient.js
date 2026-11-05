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
			if ((res.status === 429 || res.status >= 500) && attempt < 3) {
				await sleep(500 * 2 ** attempt);
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
		for (let i = headerRow + 1; i < values.length; i++) {
			const row = values[i] || [];
			const num = String(row[colMap.orderNumber] ?? "").trim();
			const title = colMap.title !== undefined ? String(row[colMap.title] ?? "").trim() : "";
			if (num) orders.set(num, i);
			if (num || title) lastDataRow = i;
		}
		return { spreadsheetId, sheetId: sheet.sheetId, rowCount: sheet.gridProperties?.rowCount ?? values.length, headerRow, colMap, orders, lastDataRow };
	}

	const cellRequest = (sheetId, rowIndex, { column, cell }) => ({
		updateCells: { rows: [{ values: [cell] }], fields: CELL_FIELDS, start: { sheetId, rowIndex, columnIndex: column } },
	});

	const batch = (spreadsheetId, requests) => request("POST", `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, { requests });

	return {
		loadDashboard,

		/**
		 * Append new orders to the DASHBOARD.
		 * @returns {{added: number, skipped: number, requests?: object[], dryRun?: boolean}}
		 */
		async addOrders(spreadsheetId, sheetName, orders, { dryRun = false } = {}) {
			const dash = await loadDashboard(spreadsheetId, sheetName);
			const seen = new Set(dash.orders.keys());
			const fresh = [];
			let skipped = 0;
			for (const order of orders) {
				if (seen.has(order.orderNumber)) {
					skipped++;
					continue;
				}
				const cells = buildOrderCells(order, dash.colMap); // validates the order (throws on bad data)
				seen.add(order.orderNumber);
				fresh.push(cells);
			}
			if (fresh.length === 0) return { added: 0, skipped, requests: [] };

			const startRow = dash.lastDataRow + 1;
			const requests = [];
			const needRows = startRow + fresh.length;
			if (needRows > dash.rowCount) requests.push({ appendDimension: { sheetId: dash.sheetId, dimension: "ROWS", length: needRows - dash.rowCount } });

			const sourceRow = dash.lastDataRow > dash.headerRow ? dash.lastDataRow : null;
			const width = Math.max(...Object.values(dash.colMap)) + 1;
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
		},

		/** Update chosen columns (review status, star rating, review date/link, pics ...) of an existing order. */
		async updateOrder(spreadsheetId, sheetName, orderNumber, fields, { dryRun = false } = {}) {
			const dash = await loadDashboard(spreadsheetId, sheetName);
			const row = dash.orders.get(orderNumber);
			if (row === undefined) throw new Error(`Order ${orderNumber} not found on the sheet`);
			const cells = buildFieldCells(fields, dash.colMap);
			if (cells.length === 0) return { updated: 0, requests: [] };
			const requests = cells.map((c) => cellRequest(dash.sheetId, row, c));
			if (dryRun) return { dryRun: true, updated: cells.length, requests };
			await batch(spreadsheetId, requests);
			return { updated: cells.length, requests };
		},
	};
}
