// Last compiled at 2026-11-05_0123
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
import test from "node:test";
import assert from "node:assert/strict";
import { decodeEntities, parseMoney, parseUsDate } from "../../scripts/core/utils/VineListParser.js";
import { pageKind, oldestFirst, chunk, toSheetOrders, describeOrdersResult, describeReviewsResult, pageCount } from "../../scripts/core/utils/SheetSyncLogic.js";
import { mapReviewStatus, mapReviewScore, starsText, buildFieldCells, mapColumns, buildOrderCells } from "../../scripts/core/utils/DashboardRow.js";
import { createSheetsClient } from "../../scripts/background/google/SheetsClient.js";
import { createGoogleSheetsService } from "../../scripts/background/google/GoogleSheetsService.js";

const HEADERS = ["ORDER DATE", "ORDER #", "IMAGE", "STATUS", "TITLE (PRODUCT LINK)", "ETV", "DELIVERY STATUS", "DELIVERY DATE", "PICS", "REVIEW SATUS", "REVIEW SCORE", "STAR RATING", "GENERAL REVIEW NOTES", "REVIEW DATE", "REVIEW LINK"];

test("decodeEntities: Amazon's double-escaped titles come out as plain text", () => {
	assert.equal(decodeEntities("Dogs &amp;amp; Cats"), "Dogs & Cats");
	assert.equal(decodeEntities("Bow 13&amp;#34; x 50&amp;#34;"), 'Bow 13" x 50"');
	assert.equal(decodeEntities("  a \n  b  "), "a b");
	assert.equal(decodeEntities("Fish &amp; Chips &#39;n&#x27; more"), "Fish & Chips 'n' more");
	assert.equal(decodeEntities(null), "");
});

test("parseMoney / parseUsDate", () => {
	assert.equal(parseMoney("$16.99"), 16.99);
	assert.equal(parseMoney("$1,016.50"), 1016.5);
	assert.equal(parseMoney("$0.00"), 0);
	assert.equal(parseMoney(""), null);
	assert.equal(parseMoney("n/a"), null);
	assert.equal(parseUsDate("11/4/2026"), "2026-11-04");
	assert.equal(parseUsDate(" 9/18/2026 "), "2026-09-18");
	for (const bad of ["", "2026-11-04", "13/1/2026", "1/32/2026", null]) assert.equal(parseUsDate(bad), null, String(bad));
});

test("pageKind: only the two list pages, any marketplace", () => {
	assert.equal(pageKind("/vine/orders"), "orders");
	assert.equal(pageKind("/vine/orders/"), "orders");
	assert.equal(pageKind("/vine/vine-reviews"), "reviews");
	assert.equal(pageKind("/vine/vine-items"), null);
	assert.equal(pageKind("/vine/orders/evil"), null);
	assert.equal(pageKind(""), null);
});

test("oldestFirst / chunk / pageCount / toSheetOrders", () => {
	const l = [{ orderDate: "2026-11-04", n: 1 }, { orderDate: "2026-10-25", n: 2 }, { orderDate: "2026-11-02", n: 3 }];
	assert.deepEqual(oldestFirst(l).map((o) => o.n), [2, 3, 1]);
	assert.deepEqual(l.map((o) => o.n), [1, 2, 3], "input not mutated");
	assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
	assert.deepEqual(chunk([], 3), []);
	assert.equal(pageCount({ pages: 15 }), 15);
	assert.equal(pageCount({ pages: 900 }), 60);
	assert.equal(pageCount({ pages: 0 }), 1);
	assert.equal(pageCount(null), 1);
	const o = toSheetOrders([{ orderNumber: "111-1000001-2000003", orderDate: "", asin: "B0H7GXLHFK", title: "T", imageUrl: "", etv: null }], "www.amazon.com")[0];
	assert.deepEqual([o.orderDate, o.imageUrl, o.etv, o.domain], [undefined, undefined, undefined, "www.amazon.com"]);
});

test("messages: quiet when off or nothing changed, helpful when sign-in is needed", () => {
	assert.equal(describeOrdersResult({ ok: true, added: 3, skipped: 7 }), "Added 3 orders to your sheet (7 already there).");
	assert.equal(describeOrdersResult({ ok: true, added: 1, skipped: 0 }), "Added 1 order to your sheet.");
	assert.equal(describeOrdersResult({ ok: true, added: 0, skipped: 10 }), null);
	assert.equal(describeOrdersResult({ ok: false, reason: "disabled" }), null);
	assert.equal(describeOrdersResult({ ok: false, reason: "not-configured" }), null);
	assert.match(describeOrdersResult({ ok: false, reason: "signin" }), /Sign in/);
	assert.match(describeOrdersResult({ ok: false, error: "HTTP 403" }), /HTTP 403/);
	assert.equal(describeReviewsResult({ ok: true, updated: 2 }), "Updated the review columns of 2 rows.");
	assert.equal(describeReviewsResult({ ok: true, updated: 0 }), null);
});

test("review vocabulary matches the sheet's strict dropdowns", () => {
	assert.equal(mapReviewStatus("Approved"), "LIVE");
	assert.equal(mapReviewStatus("Not yet reviewed"), "NOT SUBMITTED");
	assert.equal(mapReviewStatus(" rejected "), "REJECTED");
	assert.equal(mapReviewStatus("Pending approval"), "PENDING APPROVAL");
	assert.equal(mapReviewStatus("something new"), null, "unknown Amazon wording is never written");
	assert.equal(mapReviewScore("Excellent"), "EXCELLENT");
	assert.equal(mapReviewScore("poor"), "POOR");
	assert.equal(mapReviewScore(""), null);
	assert.equal(mapReviewScore("Amazing"), null);
	assert.equal(starsText(4), "⭐⭐⭐⭐");
	assert.equal(starsText("5"), "⭐⭐⭐⭐⭐");
	assert.equal(starsText(0), null);
	assert.equal(starsText(6), null);
	assert.equal(starsText(3.5), null);
	const m = mapColumns(HEADERS);
	const c = buildFieldCells({ starRating: 4 }, m)[0];
	assert.equal(c.cell.userEnteredValue.stringValue, "⭐⭐⭐⭐", "STAR RATING is a text dropdown, not a number");
	assert.deepEqual(buildFieldCells({ starRating: 9 }, m), []);
});

test("ETV cell is linked to the order's invoice page like the owner's sheet", () => {
	const m = mapColumns(HEADERS);
	const cells = buildOrderCells({ orderNumber: "111-1000001-2000003", orderDate: "2026-11-04", asin: "B0H7GXLHFK", title: "T", etv: 0 }, m);
	const etv = cells.find((c) => c.column === 5).cell;
	assert.equal(etv.userEnteredValue.numberValue, 0, "a zero ETV is still recorded");
	assert.equal(etv.textFormatRuns[0].format.link.uri, "https://www.amazon.com/gp/css/summary/print.html?orderID=111-1000001-2000003");
});

// ---------------------------------------------------------------- updateReviews against a tiny fake
function fake(rows, links) {
	const grid = rows.map((r) => [...r]);
	const posts = [];
	const handler = async (url, opts = {}) => {
		const method = opts.method || "GET";
		const ok = (o) => ({ ok: true, status: 200, json: async () => o, headers: { get: () => null } });
		if (method === "GET" && url.includes("/values/")) return ok({ values: grid.map((r) => r.slice()) });
		if (method === "GET" && url.includes("ranges=")) return ok({ sheets: [{ data: [{ startRow: 0, rowData: grid.map((_, i) => ({ values: [links[i] ? { hyperlink: links[i] } : {}] })) }] }] });
		if (method === "GET") return ok({ sheets: [{ properties: { sheetId: 1, title: "DASHBOARD", gridProperties: { rowCount: 100, columnCount: 15 } } }] });
		posts.push(JSON.parse(opts.body));
		return ok({});
	};
	return { handler, posts, grid };
}
const client = (f) => createSheetsClient({ fetchFn: f.handler, getToken: async () => "t", sleep: async () => {} });
const baseRows = () => [
	["", "totals"],
	HEADERS,
	["1/6/2026", "112-1111111-1111111", "", "DELIVERED", "Thing A", "10", "", "", "", "", "", "", "", "", ""],
	["1/8/26", "112-2222222-2222222", "", "COMPLETED", "Thing B first", "11", "", "", "", "LIVE", "EXCELLENT", "", "", "", ""],
	["2/9/2026", "112-3333333-3333333", "", "ORDERED", "Thing B second", "12", "", "", "", "TAKEN DOWN", "", "", "", "", ""],
	["2/10/2026", "112-4444444-4444444", "", "ORDERED", "Thing C", "13", "", "", "", "", "", "", "", "", ""],
];
const LINKS = { 2: "https://www.amazon.com/dp/B0AAAAAAAA", 3: "https://www.amazon.com/dp/B0BBBBBBBB?ref=x", 4: "https://www.amazon.com/dp/B0BBBBBBBB", 5: "https://www.amazon.com/dp/B0CCCCCCCC" };
const writes = (f) => f.posts.flatMap((p) => p.requests).map((r) => [r.updateCells.start.rowIndex, r.updateCells.start.columnIndex, Object.values(r.updateCells.rows[0].values[0].userEnteredValue)[0]]);

test("updateReviews: status, score, COMPLETED and link go to the row found by ASIN; nothing else is written", async () => {
	const f = fake(baseRows(), LINKS);
	const res = await client(f).updateReviews("S", "DASHBOARD", [{ asin: "B0AAAAAAAA", orderDate: "2026-01-06", status: "Approved", score: "Excellent", reviewLink: "https://www.amazon.com/gp/customer-reviews/R1" }]);
	assert.deepEqual([res.updated, res.unchanged, res.unmatched, res.ambiguous], [1, 0, 0, 0]);
	assert.deepEqual(writes(f).sort((a, b) => a[1] - b[1]), [[2, 3, "COMPLETED"], [2, 9, "LIVE"], [2, 10, "EXCELLENT"], [2, 14, "https://www.amazon.com/gp/customer-reviews/R1"]]);
});

test("updateReviews: values that are already right are not rewritten; the same review twice is one update", async () => {
	const f = fake(baseRows(), LINKS);
	const r = { asin: "B0BBBBBBBB", orderDate: "2026-01-08", status: "Approved", score: "Excellent" };
	const res = await client(f).updateReviews("S", "DASHBOARD", [r, r]);
	assert.equal(res.updated, 0);
	assert.equal(res.unchanged, 1);
	assert.equal(f.posts.length, 0, "nothing to change -> no write at all");
});

test("updateReviews: an ASIN on the sheet twice is told apart by the order date; undecidable ones are skipped, not guessed", async () => {
	const f = fake(baseRows(), LINKS);
	// two rows for B0BBBBBBBB: 1/8/26 and 2/9/2026 (the second is a manual TAKEN DOWN state)
	const byDate = await client(f).updateReviews("S", "DASHBOARD", [{ asin: "B0BBBBBBBB", orderDate: "2026-02-09", status: "Approved", score: "Good" }]);
	assert.equal(byDate.updated, 1);
	assert.deepEqual(writes(f).filter((w) => w[0] === 4).map((w) => w[1]).sort((a, b) => a - b), [10], "score written; TAKEN DOWN kept");
	const f2 = fake(baseRows(), LINKS);
	const amb = await client(f2).updateReviews("S", "DASHBOARD", [{ asin: "B0BBBBBBBB", status: "Approved" }]);
	assert.deepEqual([amb.ambiguous, amb.updated, f2.posts.length], [1, 0, 0]);
});

test("updateReviews: unknown ASIN is counted as unmatched; 'Not yet reviewed' only fills an empty status; dry run writes nothing", async () => {
	const f = fake(baseRows(), LINKS);
	const res = await client(f).updateReviews("S", "DASHBOARD", [
		{ asin: "B0ZZZZZZZZ", status: "Approved" },
		{ asin: "B0CCCCCCCC", status: "Not yet reviewed" }, // row 5: empty -> NOT SUBMITTED
		{ asin: "B0AAAAAAAA", status: "Not yet reviewed" }, // row 2: also empty
	]);
	assert.deepEqual([res.unmatched, res.updated], [1, 2]);
	assert.deepEqual(writes(f).map((w) => w[2]), ["NOT SUBMITTED", "NOT SUBMITTED"]);
	const f2 = fake(baseRows(), LINKS);
	f2.grid[5][9] = "PENDING APPROVAL";
	const keep = await client(f2).updateReviews("S", "DASHBOARD", [{ asin: "B0CCCCCCCC", status: "Not yet reviewed" }]);
	assert.equal(keep.updated, 0, "a status the owner or an earlier run set is not downgraded");
	const f3 = fake(baseRows(), LINKS);
	const dry = await client(f3).updateReviews("S", "DASHBOARD", [{ asin: "B0AAAAAAAA", status: "Approved" }], { dryRun: true });
	assert.equal(dry.dryRun, true);
	assert.equal(f3.posts.length, 0);
});

test("service.updateReviews: validates and cleans what the page sent (bad ASIN, foreign link, oversize)", async () => {
	const f = fake(baseRows(), LINKS);
	const svc = createGoogleSheetsService({
		getConfig: () => ({ enabled: true, id: "1o1zOgVLvMNbmqvcSjWJ9wgfpEkrwlNBndEgRzSVMBpI", tab: "DASHBOARD" }),
		auth: { getToken: async () => "t", clearToken: async () => {} },
		makeClient: (deps) => createSheetsClient({ ...deps, fetchFn: f.handler, sleep: async () => {} }),
	});
	assert.equal((await svc.updateReviews([])).ok, false);
	assert.equal((await svc.updateReviews([{ asin: "bad" }])).ok, false);
	assert.equal((await svc.updateReviews(new Array(201).fill({ asin: "B0AAAAAAAA" }))).ok, false);
	const res = await svc.updateReviews([{ asin: "b0aaaaaaaa", status: "Approved", score: "Excellent", reviewLink: "https://evil.example/x" }]);
	assert.equal(res.ok, true);
	assert.ok(!writes(f).some((w) => w[1] === 14), "a link that is not an Amazon address is dropped");
	const off = createGoogleSheetsService({ getConfig: () => ({ enabled: false, id: "1o1zOgVLvMNbmqvcSjWJ9wgfpEkrwlNBndEgRzSVMBpI", tab: "DASHBOARD" }), auth: { getToken: async () => "t" }, makeClient: () => { throw new Error("must not be built"); } });
	assert.deepEqual(await off.updateReviews([{ asin: "B0AAAAAAAA" }]), { ok: false, reason: "disabled" });
});
