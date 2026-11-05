// Last compiled at 2026-11-05_0049
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
// DASHBOARD row building + Sheets client, tested against a small in-memory fake of the Sheets API.
import test from "node:test";
import assert from "node:assert/strict";
import { mapColumns, dateToSerial, buildOrderCells, buildFieldCells, isOrderNumber } from "../../scripts/core/utils/DashboardRow.js";
import { createSheetsClient, SheetsError } from "../../scripts/background/google/SheetsClient.js";

const HEADERS = ["ORDER DATE", "ORDER #", "IMAGE", "STATUS", "TITLE (PRODUCT LINK)", "ETV", "DELIVERY STATUS", "DELIVERY DATE", "PICS", "REVIEW SATUS", "REVIEW SCORE", "STAR RATING", "GENERAL REVIEW NOTES", "REVIEW DATE", "REVIEW LINK"];

// ------------------------------------------------------------------ fake Sheets API
function fakeSheets({ rows, rowCount = 988, sheetId = 0, title = "DASHBOARD" }) {
	const grid = rows.map((r) => [...r]); // formatted text per cell
	const calls = [];
	const state = { grid, rowCount, failures: [] };
	const handler = async (url, opts = {}) => {
		const method = opts.method || "GET";
		calls.push({ method, url, body: opts.body ? JSON.parse(opts.body) : null, auth: opts.headers?.Authorization });
		if (state.failures.length) {
			const f = state.failures.shift();
			return { ok: false, status: f.status, json: async () => ({ error: { message: f.message || "x" } }), headers: { get: () => null } };
		}
		const json = (o) => ({ ok: true, status: 200, json: async () => o, headers: { get: () => null } });
		if (method === "GET" && /\/v4\/spreadsheets\/[^/]+\?/.test(url)) {
			return json({ sheets: [{ properties: { sheetId, title, gridProperties: { rowCount: state.rowCount, columnCount: 31 } } }] });
		}
		if (method === "GET" && url.includes("/values/")) {
			return json({ values: grid.map((r) => r.slice()) });
		}
		if (method === "POST" && url.endsWith(":batchUpdate")) {
			const { requests } = JSON.parse(opts.body);
			for (const r of requests) {
				if (r.appendDimension) state.rowCount += r.appendDimension.length;
				if (r.updateCells) {
					const { rowIndex, columnIndex } = r.updateCells.start;
					while (grid.length <= rowIndex) grid.push([]);
					const c = r.updateCells.rows[0].values[0].userEnteredValue;
					grid[rowIndex][columnIndex] = c.stringValue ?? (c.numberValue !== undefined ? String(c.numberValue) : c.formulaValue);
				}
			}
			return json({ replies: requests.map(() => ({})) });
		}
		throw new Error("unexpected call " + method + " " + url);
	};
	return { handler, calls, state };
}
const makeClient = (fake, extra = {}) =>
	createSheetsClient({ fetchFn: fake.handler, getToken: async () => "tok-123", clearToken: async () => { fake.cleared = (fake.cleared || 0) + 1; }, sleep: async () => {}, ...extra });

const baseRows = () => [
	["", "totals row"],
	HEADERS,
	["1/12/2026", "113-0842733-4045023", "img", "DELIVERED", "Large Felt Bulletin Board", "36.99"],
	["1/13/2026", "113-9050815-6761050", "img", "DELIVERED", "Nextay Dresser", "49.99"],
];
const ORDER = { orderNumber: "112-8085227-2269802", orderDate: "2026-01-06", asin: "B0FZ9Y2B2T", title: 'Plant Covers 23.6" X 31.5" & more', imageUrl: "https://m.media-amazon.com/images/I/31Vs7ybz1SL._SS210_.jpg", etv: 15.99 };

// ------------------------------------------------------------------ pure builders
test("mapColumns: finds columns by header text, tolerates the 'SATUS' typo and reordering", () => {
	const m = mapColumns(HEADERS);
	assert.equal(m.orderDate, 0); assert.equal(m.orderNumber, 1); assert.equal(m.title, 4); assert.equal(m.reviewStatus, 9); assert.equal(m.reviewLink, 14);
	const m2 = mapColumns(["Title (product link)", "order #", "REVIEW STATUS", "ETV"]);
	assert.deepEqual([m2.title, m2.orderNumber, m2.reviewStatus, m2.etv], [0, 1, 2, 3]);
	assert.throws(() => mapColumns(["ORDER DATE", "TITLE"]), /ORDER #/);
});

test("dateToSerial: Sheets serial numbers for every input shape", () => {
	assert.equal(dateToSerial("1/6/2026"), 46028);
	assert.equal(dateToSerial("2026-01-06"), 46028);
	assert.equal(dateToSerial(new Date(2026, 0, 6, 23, 59)), 46028);
	assert.equal(dateToSerial("12/31/2025"), 46022);
	assert.throws(() => dateToSerial("not a date"));
	assert.throws(() => dateToSerial("13/40/2026"));
});

test("isOrderNumber", () => {
	assert.ok(isOrderNumber("112-8085227-2269802"));
	for (const bad of ["", "112-808522-2269802", "abc", null, undefined, "112-8085227-2269802 "]) assert.ok(!isOrderNumber(bad), String(bad));
});

test("buildOrderCells: the DASHBOARD columns from an order (links, IMAGE formula, ORDERED)", () => {
	const m = mapColumns(HEADERS);
	const cells = buildOrderCells(ORDER, m);
	const byCol = Object.fromEntries(cells.map((c) => [c.column, c.cell]));
	assert.equal(byCol[0].userEnteredValue.numberValue, 46028); // ORDER DATE
	assert.equal(byCol[1].userEnteredValue.stringValue, "112-8085227-2269802"); // ORDER #
	assert.equal(byCol[1].textFormatRuns[0].format.link.uri, "https://www.amazon.com/your-orders/order-details?orderID=112-8085227-2269802");
	assert.equal(byCol[2].userEnteredValue.formulaValue, '=IMAGE("https://m.media-amazon.com/images/I/31Vs7ybz1SL._SS210_.jpg")');
	assert.equal(byCol[3].userEnteredValue.stringValue, "ORDERED"); // STATUS
	assert.equal(byCol[4].userEnteredValue.stringValue, 'Plant Covers 23.6" X 31.5" & more'); // plain text, not HTML-escaped
	assert.equal(byCol[4].textFormatRuns[0].format.link.uri, "https://www.amazon.com/dp/B0FZ9Y2B2T");
	assert.equal(byCol[5].userEnteredValue.numberValue, 15.99);
	assert.deepEqual(cells.map((c) => c.column).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5], "must not touch the manual columns");
});

test("buildOrderCells: missing optional data is skipped; unsafe image URLs get no formula; marketplace domain is honoured", () => {
	const m = mapColumns(HEADERS);
	const base = { orderNumber: ORDER.orderNumber, orderDate: ORDER.orderDate, asin: ORDER.asin, title: "T", domain: "www.amazon.co.uk" };
	const cells = buildOrderCells({ ...base, imageUrl: "https://m.media-amazon.com/images/I/ok.jpg" }, m);
	const byCol = Object.fromEntries(cells.map((c) => [c.column, c.cell]));
	assert.equal(byCol[5], undefined, "no ETV known -> ETV left empty");
	assert.equal(byCol[2].userEnteredValue.formulaValue, '=IMAGE("https://m.media-amazon.com/images/I/ok.jpg")');
	assert.ok(byCol[1].textFormatRuns[0].format.link.uri.startsWith("https://www.amazon.co.uk/your-orders/"));
	assert.equal(byCol[4].textFormatRuns[0].format.link.uri, "https://www.amazon.co.uk/dp/B0FZ9Y2B2T");
	for (const bad of ['https://x/y"z.jpg', "http://m.media-amazon.com/a.jpg", "https://evil.example/a.jpg", "https://media-amazon.com.evil.example/a.jpg", 'https://m.media-amazon.com/a"b.jpg', "javascript:alert(1)"]) {
		const c = buildOrderCells({ ...base, imageUrl: bad }, m);
		assert.ok(!c.some((x) => x.column === 2), "no image cell for " + bad);
	}
	assert.throws(() => buildOrderCells({ ...ORDER, orderNumber: "bad" }, m), /order number/i);
	assert.throws(() => buildOrderCells({ ...ORDER, domain: "evil.example" }, m), /domain/i);
	// a malformed ASIN: title is written as plain text, not linked
	const plain = buildOrderCells({ ...ORDER, asin: "../x" }, m).find((x) => x.column === 4).cell;
	assert.equal(plain.textFormatRuns, undefined);
	// no previous row to copy from: number formats are set
	const f = buildOrderCells(ORDER, m, { withFormats: true });
	assert.equal(f.find((x) => x.column === 0).cell.userEnteredFormat.numberFormat.type, "DATE");
	assert.equal(f.find((x) => x.column === 5).cell.userEnteredFormat.numberFormat.type, "CURRENCY");
});

test("buildFieldCells: a review link that is not an Amazon URL is written as plain text", () => {
	const m = mapColumns(HEADERS);
	const c = buildFieldCells({ reviewLink: "https://evil.example/x" }, m)[0].cell;
	assert.equal(c.textFormatRuns, undefined);
	assert.equal(c.userEnteredValue.stringValue, "https://evil.example/x");
});

test("buildFieldCells: only the fields given (review columns), nothing else", () => {
	const m = mapColumns(HEADERS);
	const cells = buildFieldCells({ reviewStatus: "SUBMITTED", starRating: 4, reviewDate: "2026-02-01", reviewLink: "https://www.amazon.com/review/R1", pics: "YES" }, m);
	const byCol = Object.fromEntries(cells.map((c) => [c.column, c.cell]));
	assert.deepEqual(Object.keys(byCol).map(Number).sort((a, b) => a - b), [8, 9, 11, 13, 14]);
	assert.equal(byCol[9].userEnteredValue.stringValue, "SUBMITTED");
	assert.equal(byCol[11].userEnteredValue.stringValue, "⭐⭐⭐⭐", "STAR RATING is a text dropdown");
	assert.equal(byCol[13].userEnteredValue.numberValue, dateToSerial("2026-02-01"));
	assert.equal(byCol[14].textFormatRuns[0].format.link.uri, "https://www.amazon.com/review/R1");
});

// ------------------------------------------------------------------ client
test("addOrders: writes into the first empty row, copies format+dropdowns from the last data row, one cell per request", async () => {
	const fake = fakeSheets({ rows: baseRows() });
	const res = await makeClient(fake).addOrders("SID", "DASHBOARD", [ORDER]);
	assert.deepEqual([res.added, res.skipped], [1, 0]);
	const post = fake.calls.find((c) => c.method === "POST");
	const reqs = post.body.requests;
	const paste = reqs.filter((r) => r.copyPaste);
	assert.deepEqual(paste.map((r) => r.copyPaste.pasteType).sort(), ["PASTE_DATA_VALIDATION", "PASTE_FORMAT"]);
	assert.equal(paste[0].copyPaste.source.startRowIndex, 3, "source = last data row (0-based 3)");
	assert.equal(paste[0].copyPaste.destination.startRowIndex, 4, "destination = first empty row");
	const updates = reqs.filter((r) => r.updateCells);
	for (const u of updates) {
		assert.equal(u.updateCells.start.rowIndex, 4);
		assert.equal(u.updateCells.rows[0].values.length, 1, "single cell per update so other columns are never cleared");
		assert.equal(u.updateCells.fields, "userEnteredValue,textFormatRuns");
	}
	assert.deepEqual(updates.map((u) => u.updateCells.start.columnIndex).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
	assert.equal(fake.state.grid[4][1], "112-8085227-2269802");
	assert.equal(post.auth, "Bearer tok-123");
});

test("addOrders: orders already on the sheet (by order number) are skipped; duplicates inside the batch collapse", async () => {
	const fake = fakeSheets({ rows: baseRows() });
	const dup = { ...ORDER, orderNumber: "113-9050815-6761050" };
	const res = await makeClient(fake).addOrders("SID", "DASHBOARD", [dup, ORDER, { ...ORDER }]);
	assert.deepEqual([res.added, res.skipped], [1, 2]);
	const none = await makeClient(fake).addOrders("SID", "DASHBOARD", [dup]);
	assert.deepEqual([none.added, none.skipped], [0, 1]);
	assert.equal(fake.calls.filter((c) => c.method === "POST").length, 1, "nothing to add -> no write at all");
});

test("addOrders: several orders land in consecutive rows; the sheet grows when it is full", async () => {
	const fake = fakeSheets({ rows: baseRows(), rowCount: 5 }); // rows 0..4 exist, data ends at row 3
	const o2 = { ...ORDER, orderNumber: "112-2553095-9098631", asin: "B0G48KCKP7" };
	const o3 = { ...ORDER, orderNumber: "113-0068336-0088234", asin: "B0TEST0003" };
	const res = await makeClient(fake).addOrders("SID", "DASHBOARD", [ORDER, o2, o3]);
	assert.equal(res.added, 3);
	const reqs = fake.calls.find((c) => c.method === "POST").body.requests;
	assert.equal(reqs[0].appendDimension.dimension, "ROWS");
	assert.equal(reqs[0].appendDimension.length, 2, "rows 4,5,6 needed, 5 exist -> grow by 2");
	assert.deepEqual([...new Set(reqs.filter((r) => r.updateCells).map((r) => r.updateCells.start.rowIndex))], [4, 5, 6]);
});

test("addOrders: dry run returns the requests and sends no write", async () => {
	const fake = fakeSheets({ rows: baseRows() });
	const res = await makeClient(fake).addOrders("SID", "DASHBOARD", [ORDER], { dryRun: true });
	assert.equal(res.dryRun, true);
	assert.ok(res.requests.length > 0);
	assert.equal(fake.calls.filter((c) => c.method === "POST").length, 0);
});

test("updateOrder: writes only the given review fields on the row of that order", async () => {
	const fake = fakeSheets({ rows: baseRows() });
	await makeClient(fake).updateOrder("SID", "DASHBOARD", "113-9050815-6761050", { reviewStatus: "SUBMITTED", starRating: 5 });
	const reqs = fake.calls.find((c) => c.method === "POST").body.requests;
	assert.ok(reqs.every((r) => r.updateCells && r.updateCells.start.rowIndex === 3));
	assert.deepEqual(reqs.map((r) => r.updateCells.start.columnIndex).sort((a, b) => a - b), [9, 11]);
	await assert.rejects(() => makeClient(fake).updateOrder("SID", "DASHBOARD", "999-9999999-9999999", { pics: "YES" }), /not found/i);
});

test("HTTP: a 401 refreshes the token once and retries; 429 backs off and retries; other errors surface without leaking the token", async () => {
	const fake = fakeSheets({ rows: baseRows() });
	fake.state.failures.push({ status: 401 });
	const ok = await makeClient(fake).addOrders("SID", "DASHBOARD", [ORDER]);
	assert.equal(ok.added, 1);
	assert.equal(fake.cleared, 1, "stale token must be dropped");

	const f2 = fakeSheets({ rows: baseRows() });
	f2.state.failures.push({ status: 429 }, { status: 503 });
	assert.equal((await makeClient(f2).addOrders("SID", "DASHBOARD", [ORDER])).added, 1);

	const f3 = fakeSheets({ rows: baseRows() });
	f3.state.failures.push({ status: 403, message: "The caller does not have permission" });
	await assert.rejects(
		() => makeClient(f3).addOrders("SID", "DASHBOARD", [ORDER]),
		(e) => e instanceof SheetsError && e.status === 403 && /permission/.test(e.message) && !/tok-123/.test(e.message)
	);
});

test("a sheet without the expected header row is refused instead of written to blindly", async () => {
	const fake = fakeSheets({ rows: [["a", "b"], ["c", "d"]] });
	await assert.rejects(() => makeClient(fake).addOrders("SID", "DASHBOARD", [ORDER]), /ORDER #/);
	assert.equal(fake.calls.filter((c) => c.method === "POST").length, 0);
});

test("concurrent addOrders calls are serialised: the second sees the first one's row and uses the next free row", async () => {
	const fake = fakeSheets({ rows: baseRows() });
	const o2 = { ...ORDER, orderNumber: "112-2553095-9098631", asin: "B0G48KCKP7" };
	const client = makeClient(fake);
	const [a, b] = await Promise.all([client.addOrders("SID", "DASHBOARD", [ORDER]), client.addOrders("SID", "DASHBOARD", [o2])]);
	assert.deepEqual([a.added, b.added], [1, 1]);
	assert.equal(fake.state.grid[4][1], ORDER.orderNumber);
	assert.equal(fake.state.grid[5][1], o2.orderNumber);
	// the same order submitted twice at once is only written once
	const f2 = fakeSheets({ rows: baseRows() });
	const c2 = makeClient(f2);
	const rs = await Promise.all([c2.addOrders("SID", "DASHBOARD", [ORDER]), c2.addOrders("SID", "DASHBOARD", [ORDER])]);
	assert.deepEqual(rs.map((r) => r.added).sort(), [0, 1]);
});

test("HTTP: a 5xx on a WRITE is not retried (it may have been applied)", async () => {
	const fake = fakeSheets({ rows: baseRows() });
	// two reads (meta, values) succeed, then the POST fails
	let n = 0;
	const inner = fake.handler;
	fake.handler = async (url, opts = {}) => (opts.method === "POST" && ++n ? { ok: false, status: 503, json: async () => ({ error: { message: "backend" } }), headers: { get: () => null } } : inner(url, opts));
	await assert.rejects(() => makeClient(fake).addOrders("SID", "DASHBOARD", [ORDER]), (e) => e instanceof SheetsError && e.status === 503);
	assert.equal(n, 1, "POST sent exactly once");
});

test("addOrders: format/validation copy spans the whole row width (sheet columns beyond the mapped ones)", async () => {
	const fake = fakeSheets({ rows: baseRows() }); // fake sheet reports columnCount 31
	const reqs = (await makeClient(fake).addOrders("SID", "DASHBOARD", [ORDER], { dryRun: true })).requests;
	const paste = reqs.find((r) => r.copyPaste);
	assert.equal(paste.copyPaste.destination.endColumnIndex, 31);
	assert.equal(paste.copyPaste.destination.startColumnIndex, 0);
});

test("addOrders: a half-filled row below the data counts as used (not overwritten); an empty sheet gets number formats", async () => {
	const rows = baseRows();
	rows.push(["", "", "", "", "Half typed title"]); // title only
	const fake = fakeSheets({ rows });
	await makeClient(fake).addOrders("SID", "DASHBOARD", [ORDER]);
	assert.equal(fake.state.grid[5][1], ORDER.orderNumber, "written below the half-filled row 4");
	assert.equal(fake.state.grid[4][4], "Half typed title");

	const empty = fakeSheets({ rows: [HEADERS] });
	const res = await makeClient(empty).addOrders("SID", "DASHBOARD", [ORDER], { dryRun: true });
	assert.ok(!res.requests.some((r) => r.copyPaste), "no source row -> no copy");
	const withFmt = res.requests.filter((r) => r.updateCells && r.updateCells.fields.includes("numberFormat"));
	assert.equal(withFmt.length, 2, "date and ETV cells carry their number format");
});
