// Last compiled at 2026-11-05_1433
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
import test from "node:test";
import assert from "node:assert/strict";
import { decodeEntities, parseMoney, parseUsDate } from "../../scripts/core/utils/VineListParser.js";
import { pageKind, oldestFirst, chunk, toSheetOrders, describeOrdersResult, describeReviewsResult, pageCount, isCapped, isSupportedHost } from "../../scripts/core/utils/SheetSyncLogic.js";
import { mapReviewStatus, mapReviewScore, starsText, buildFieldCells, mapColumns, buildOrderCells } from "../../scripts/core/utils/DashboardRow.js";
import { createSheetsClient } from "../../scripts/background/google/SheetsClient.js";
import { createGoogleSheetsService } from "../../scripts/background/google/GoogleSheetsService.js";

const HEADERS = ["ORDER DATE", "ORDER #", "IMAGE", "STATUS", "TITLE (PRODUCT LINK)", "ETV", "DELIVERY STATUS", "DELIVERY DATE", "PICS", "REVIEW SATUS", "REVIEW SCORE", "STAR RATING", "GENERAL REVIEW NOTES", "REVIEW DATE", "REVIEW LINK", "REVIEW TITLE", "REVIEW TEXT"];

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
	assert.equal(etv.userEnteredValue.formulaValue, '=HYPERLINK("https://www.amazon.com/gp/css/summary/print.html?orderID=111-1000001-2000003", 0.00)', "a zero ETV is still recorded, as a number");
	assert.equal(etv.textFormatRuns, undefined, "rich-text links are only valid on text cells: the number is linked with HYPERLINK()");
});

// ---------------------------------------------------------------- updateReviews against a tiny fake
function fake(rows, links) {
	const grid = rows.map((r) => [...r]);
	const posts = [];
	const handler = async (url, opts = {}) => {
		const method = opts.method || "GET";
		const ok = (o) => ({ ok: true, status: 200, json: async () => o, headers: { get: () => null } });
		if (method === "GET" && url.includes("/values/")) return ok({ values: grid.map((r) => r.slice()) });
		if (method === "GET" && url.includes("ranges=")) {
			// a link is reported either as `hyperlink` or (rich text) only in the text runs: "runs:" prefix = the second form
			return ok({ sheets: [{ data: [{ startRow: 0, rowData: grid.map((_, i) => ({ values: [!links[i] ? {} : String(links[i]).startsWith("runs:") ? { textFormatRuns: [{ format: { link: { uri: links[i].slice(5) } } }] } : { hyperlink: links[i] }] })) }] }] });
		}
		if (method === "GET") return ok({ sheets: [{ properties: { sheetId: 1, title: "DASHBOARD", gridProperties: { rowCount: 100, columnCount: 15 } } }] });
		const body = JSON.parse(opts.body);
		for (const r of body.requests) {
			const v = r.updateCells?.rows[0].values[0];
			if (v?.textFormatRuns && v.userEnteredValue.stringValue === undefined) return { ok: false, status: 400, json: async () => ({ error: { message: "textFormatRuns are only valid on user entered strings" } }), headers: { get: () => null } };
		}
		posts.push(body);
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
	const res = await client(f).updateReviews("S", "DASHBOARD", [{ asin: "B0AAAAAAAA", orderDate: "2026-01-06", status: "Approved", score: "Excellent", reviewLink: "https://www.amazon.com/gp/customer-reviews/R3NCIWZ4UAGTNT" }]);
	assert.deepEqual([res.updated, res.unchanged, res.unmatched, res.ambiguous], [1, 0, 0, 0]);
	assert.deepEqual(writes(f).sort((a, b) => a[1] - b[1]), [[2, 3, "COMPLETED"], [2, 9, "LIVE"], [2, 10, "EXCELLENT"], [2, 14, "https://www.amazon.com/review/R3NCIWZ4UAGTNT/ref=cm_cr_othr_d_rdp_perm?ie=UTF8"]]);
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
	// two rows for B0BBBBBBBB: 1/8/26 (row 3, LIVE) and 2/9/2026 (row 4, a manual TAKEN DOWN state)
	const byDate = await client(f).updateReviews("S", "DASHBOARD", [{ asin: "B0BBBBBBBB", orderDate: "2026-01-08", status: "Approved", score: "Good" }]);
	assert.equal(byDate.updated, 1);
	assert.deepEqual(writes(f).map((w) => [w[0], w[1]]), [[3, 10]], "the 1/8/26 row got the new score and nothing else");
	const manual = await client(fake(baseRows(), LINKS)).updateReviews("S", "DASHBOARD", [{ asin: "B0BBBBBBBB", orderDate: "2026-02-09", status: "Approved", score: "Good" }]);
	assert.deepEqual([manual.updated, manual.unchanged], [0, 1], "the TAKEN DOWN row is not touched");
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
	f2.grid[5][9] = "REJECTED";
	const keep = await client(f2).updateReviews("S", "DASHBOARD", [{ asin: "B0CCCCCCCC", status: "Not yet reviewed" }]);
	assert.equal(keep.updated, 0, "a real Amazon verdict is not overwritten by 'not yet reviewed'");
	f2.grid[5][9] = "PENDING APPROVAL"; // written when the review was submitted; still listed as awaiting = the submit did not go through
	assert.equal((await client(f2).updateReviews("S", "DASHBOARD", [{ asin: "B0CCCCCCCC", status: "Not yet reviewed" }])).updated, 1);
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

test("updateReviews: a review submitted from the form records stars, today's date and the pending status", async () => {
	const f = fake(baseRows(), LINKS);
	const res = await client(f).updateReviews("S", "DASHBOARD", [{ asin: "B0CCCCCCCC", status: "Pending approval", score: "Pending", starRating: 4, reviewDate: "2026-11-05" }]);
	assert.equal(res.updated, 1);
	const w = writes(f).sort((a, b) => a[1] - b[1]);
	assert.deepEqual(w.map((x) => x[1]), [9, 10, 11, 13]);
	assert.deepEqual([w[0][2], w[1][2], w[2][2]], ["PENDING APPROVAL", "PENDING", "⭐⭐⭐⭐"]);
});

// ---------------------------------------------------------------- fixes from the independent review
test("review of a re-order: the sheet has the ASIN once, the list has it twice -> only the review with the matching order date is used (C1)", async () => {
	const rows = baseRows();
	rows[2][0] = "1/6/2026"; // Thing A, B0AAAAAAAA, ordered 1/6/2026
	const f = fake(rows, LINKS);
	const res = await client(f).updateReviews("S", "DASHBOARD", [
		{ asin: "B0AAAAAAAA", orderDate: "2026-09-01", status: "Approved", score: "Poor", reviewLink: "https://www.amazon.com/gp/customer-reviews/RSEPT" }, // newest first, the re-order: not on the sheet
		{ asin: "B0AAAAAAAA", orderDate: "2026-01-06", status: "Approved", score: "Excellent", reviewLink: "https://www.amazon.com/gp/customer-reviews/RJAN" },
	]);
	assert.deepEqual([res.updated, res.unmatched], [1, 1]);
	const w = writes(f);
	assert.ok(w.some((x) => x[2] === "EXCELLENT"));
	assert.ok(!w.some((x) => x[2] === "POOR" || String(x[2]).includes("RSEPT")), "the September review is not written onto the January row");
	// without any date a second review for the same row is reported, not silently dropped
	const f2 = fake(baseRows(), LINKS);
	const dup = await client(f2).updateReviews("S", "DASHBOARD", [{ asin: "B0AAAAAAAA", status: "Approved" }, { asin: "B0AAAAAAAA", status: "Approved" }]);
	assert.deepEqual([dup.updated, dup.ambiguous], [1, 1]);
});

test("a row whose REVIEW STATUS the owner set by hand is left completely alone: no score, stars, date or link (I2)", async () => {
	const f = fake(baseRows(), LINKS);
	const res = await client(f).updateReviews("S", "DASHBOARD", [{ asin: "B0BBBBBBBB", orderDate: "2026-02-09", status: "Pending approval", score: "Pending", starRating: 2, reviewDate: "2026-11-05", reviewLink: "https://www.amazon.com/gp/customer-reviews/R9" }]);
	assert.deepEqual([res.updated, res.unchanged], [0, 1]);
	assert.equal(f.posts.length, 0);
});

test("stars and review date already on the sheet are not rewritten (I2)", async () => {
	const rows = baseRows();
	rows[5][9] = "PENDING APPROVAL";
	rows[5][10] = "PENDING";
	rows[5][11] = "⭐⭐⭐⭐";
	rows[5][13] = "11/5/2026";
	const f = fake(rows, LINKS);
	const res = await client(f).updateReviews("S", "DASHBOARD", [{ asin: "B0CCCCCCCC", status: "Pending approval", score: "Pending", starRating: 4, reviewDate: "2026-11-05" }]);
	assert.deepEqual([res.updated, res.unchanged], [0, 1]);
});

test("a title link that only exists as rich text (no `hyperlink` field) is still found", async () => {
	const f = fake(baseRows(), { ...LINKS, 2: "runs:https://www.amazon.com/dp/B0AAAAAAAA" });
	const res = await client(f).updateReviews("S", "DASHBOARD", [{ asin: "B0AAAAAAAA", status: "Approved" }]);
	assert.equal(res.updated, 1);
});

test("only www.amazon.com is read: other marketplaces use D/M/YYYY dates and '16,99 €' amounts (I3)", () => {
	assert.ok(isSupportedHost("www.amazon.com"));
	for (const h of ["www.amazon.co.uk", "www.amazon.de", "www.amazon.ca", "amazon.com.evil.example", "", null]) assert.ok(!isSupportedHost(h), String(h));
});

test("orders of the same day come out oldest first, not newest first (M4); a capped list is reported (M3)", () => {
	const listed = [{ orderDate: "2026-11-04", n: "newest" }, { orderDate: "2026-11-04", n: "older" }, { orderDate: "2026-11-02", n: "earlier day" }];
	assert.deepEqual(oldestFirst(listed).map((o) => o.n), ["earlier day", "older", "newest"]);
	assert.equal(isCapped({ pages: 61 }), true);
	assert.equal(isCapped({ pages: 60 }), false);
	assert.equal(isCapped(null), false);
});

test("review title and text are written to the REVIEW TITLE / REVIEW TEXT columns, as plain text, only when they changed", async () => {
	const f = fake(baseRows().map((r) => [...r, ...Array(17 - r.length).fill("")]), LINKS);
	const review = { asin: "B0CCCCCCCC", status: "Pending approval", score: "Pending", starRating: 5, reviewDate: "2026-11-05", reviewTitle: "Great value", reviewText: "=HYPERLINK(\"http://evil.example\")\nSecond line" };
	const res = await client(f).updateReviews("S", "DASHBOARD", [review]);
	assert.equal(res.updated, 1);
	const cell = f.posts[0].requests.map((r) => r.updateCells).filter((u) => u.start.columnIndex === 16)[0].rows[0].values[0];
	assert.equal(cell.userEnteredValue.stringValue, review.reviewText, "stored as a string value: Sheets does not parse it as a formula");
	assert.equal(cell.userEnteredValue.formulaValue, undefined);
	assert.deepEqual(f.posts[0].requests.map((r) => r.updateCells.start.columnIndex).sort((a, b) => a - b), [9, 10, 11, 13, 15, 16]);
	// the sheet now shows what was written: a second submit of the same text changes nothing
	const f2 = fake(baseRows().map((r) => [...r, ...Array(17 - r.length).fill("")]), LINKS);
	f2.grid[5][9] = "PENDING APPROVAL"; f2.grid[5][10] = "PENDING"; f2.grid[5][11] = "⭐⭐⭐⭐⭐"; f2.grid[5][13] = "11/5/2026"; f2.grid[5][15] = "Great value"; f2.grid[5][16] = review.reviewText;
	assert.equal((await client(f2).updateReviews("S", "DASHBOARD", [review])).updated, 0);
	f2.grid[5][16] = "old text";
	assert.equal((await client(f2).updateReviews("S", "DASHBOARD", [review])).updated, 1, "an edited review replaces the old text");
});

test("a sheet without REVIEW TITLE / REVIEW TEXT columns simply skips them", async () => {
	const rows = baseRows().map((r) => r.slice(0, 15));
	const f = fake(rows.map((r) => [...r, ...Array(15 - r.length).fill("")]), LINKS);
	const res = await client(f).updateReviews("S", "DASHBOARD", [{ asin: "B0CCCCCCCC", status: "Pending approval", reviewTitle: "t", reviewText: "x" }]);
	assert.equal(res.updated, 1);
	assert.deepEqual(f.posts[0].requests.map((r) => r.updateCells.start.columnIndex), [9]);
});

test("service: review title and text are length-limited and must be strings", async () => {
	const f = fake(baseRows().map((r) => [...r, ...Array(17 - r.length).fill("")]), LINKS);
	const svc = createGoogleSheetsService({
		getConfig: () => ({ enabled: true, id: "1o1zOgVLvMNbmqvcSjWJ9wgfpEkrwlNBndEgRzSVMBpI", tab: "DASHBOARD" }),
		auth: { getToken: async () => "t", clearToken: async () => {} },
		makeClient: (deps) => createSheetsClient({ ...deps, fetchFn: f.handler, sleep: async () => {} }),
	});
	await svc.updateReviews([{ asin: "B0CCCCCCCC", status: "Pending approval", reviewTitle: "T".repeat(900), reviewText: "x".repeat(60000) }]);
	const byCol = Object.fromEntries(f.posts[0].requests.map((r) => [r.updateCells.start.columnIndex, r.updateCells.rows[0].values[0].userEnteredValue.stringValue]));
	assert.equal(byCol[15].length, 500);
	assert.equal(byCol[16].length, 50000);
	const f2 = fake(baseRows().map((r) => [...r, ...Array(17 - r.length).fill("")]), LINKS);
	const svc2 = createGoogleSheetsService({ getConfig: () => ({ enabled: true, id: "1o1zOgVLvMNbmqvcSjWJ9wgfpEkrwlNBndEgRzSVMBpI", tab: "DASHBOARD" }), auth: { getToken: async () => "t" }, makeClient: (deps) => createSheetsClient({ ...deps, fetchFn: f2.handler, sleep: async () => {} }) });
	await svc2.updateReviews([{ asin: "B0CCCCCCCC", status: "Pending approval", reviewTitle: { evil: 1 }, reviewText: 5 }]);
	assert.deepEqual(f2.posts[0].requests.map((r) => r.updateCells.start.columnIndex), [9], "non-string values are ignored");
});

// ---------------------------------------------------------------- the owner's real sheet (copy of Reviews, 2026-11-05)
const REAL_ROWS = () => [
	["", "", "", "", "$815.31", "$4,076.53", "", "", "", "52.63%", "80.00%"],
	HEADERS,
	// linked title, review already LIVE with the owner's own link form
	["9/18/2026", "111-2164556-4013016", "", "COMPLETED", "Tire Inflator 150 PSI Compatible with Makita 18V Battery | Portable air compressor", "$53.99", "", "", "", "LIVE", "EXCELLENT", "⭐⭐⭐⭐⭐", "my notes", "2026-09-29_2053", "https://www.amazon.com/review/R3NCIWZ4UAGTNT/ref=cm_cr_othr_d_rdp_perm?ie=UTF8"],
	// NO link on the title, literal entities in the text (older paste)
	["9/16/2026", "111-6728766-4923425", "", "DELIVERED", "PETSOLON Automatic Dog Water Dispenser, Auto Fill Dog Water Bowl Dispenser | 1 Gallon, Durable Water Bowl for Pets &amp; Livestock, Indoor &amp; Outdoor Use, Wide Bowl, BPA Free, Fits GHT 3/4&#34; Faucet, Gray", "$59.99"],
];
const REAL_LINKS = { 2: "https://www.amazon.com/dp/B0H5JR235Z" };

test("real sheet: a row without a title link is found by order date + title (entities decoded); the owner's review link form counts as the same review", async () => {
	const f = fake(REAL_ROWS().map((r) => [...r, ...Array(17 - r.length).fill("")]), REAL_LINKS);
	const res = await client(f).updateReviews("S", "DASHBOARD", [
		// linked row, same review in Amazon's other link form: nothing to change
		{ asin: "B0H5JR235Z", orderDate: "2026-09-18", title: "Tire Inflator 150 PSI Compatible with Makita 18V Battery | Portable air compressor", status: "Approved", score: "Excellent", reviewLink: "https://www.amazon.com/gp/customer-reviews/R3NCIWZ4UAGTNT" },
		// no link on the sheet row: found through its title and date
		{ asin: "B0H9R5QBJC", orderDate: "2026-09-16", title: 'PETSOLON Automatic Dog Water Dispenser, Auto Fill Dog Water Bowl Dispenser | 1 Gallon, Durable Water Bowl for Pets & Livestock, Indoor & Outdoor Use, Wide Bowl, BPA Free, Fits GHT 3/4" Faucet, Gray', status: "Approved", score: "Excellent", reviewLink: "https://www.amazon.com/gp/customer-reviews/R3JIP39KX3DNXX" },
	]);
	assert.deepEqual([res.updated, res.unchanged, res.unmatched], [1, 1, 0]);
	const w = writes(f);
	assert.ok(w.every((x) => x[0] === 3), "only the unlinked row (row 4) is written");
	assert.deepEqual(w.map((x) => x[2]).sort(), ["COMPLETED", "EXCELLENT", "LIVE", "https://www.amazon.com/review/R3JIP39KX3DNXX/ref=cm_cr_othr_d_rdp_perm?ie=UTF8"].sort());
});

test("real sheet: a title match needs the same day; another product the same day is not confused with it", async () => {
	const f = fake(REAL_ROWS().map((r) => [...r, ...Array(17 - r.length).fill("")]), REAL_LINKS);
	const res = await client(f).updateReviews("S", "DASHBOARD", [
		{ asin: "B0XXXXXXXX", orderDate: "2026-09-17", title: "PETSOLON Automatic Dog Water Dispenser, Auto Fill Dog Water Bowl Dispenser", status: "Approved" }, // other day
		{ asin: "B0YYYYYYYY", orderDate: "2026-09-16", title: "A completely different product on the same day", status: "Approved" },
	]);
	assert.deepEqual([res.updated, res.unmatched], [0, 2]);
	assert.equal(f.posts.length, 0);
});
