// Last compiled at 2026-11-05_1508
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
// Orders / Reviews pages -> Google Sheet, end to end: real extension, real saved Vine pages (anonymised fixtures),
// a fake Google Sheets API behind the route mock, and a stubbed Chrome sign-in (the sandbox cannot sign in to Google).
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { launch } = require("./lib.cjs");

const FIX = (n) => fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8");
const ORDERED = FIX("vine-ordered.html");
const REVIEWED = FIX("vine-reviewed.html");
const AWAITING = FIX("vine-awaiting.html");

// pages 2 and 3 are page 1 with other order numbers / ASINs, so "send all pages" has something to walk
function variant(html, page) {
	if (page === 1) return html;
	return html
		.replace(/(orderID=)111-1(\d{6})-/g, `$1111-${page}$2-`)
		.replace(/\/dp\/([A-Z0-9]{9})[A-Z0-9]/g, `/dp/$1${page}`)
		.replace(/Displaying 1-10/, `Displaying ${(page - 1) * 10 + 1}-${page * 10}`);
}
const shortPager = (html) => html.replace(/page=15/g, "page=3").replace(/of 143 results/, "of 30 results").replace(/of 86 results/, "of 30 results").replace(/of 50 results/, "of 30 results");

// stand-ins for the checkout page and the thank-you page (same ids / data attributes as the saved Amazon pages)
function checkoutPage(purchaseId, asin, title, arriving) {
	return `<!doctype html><html><head><meta charset="utf-8"><title>Place Your Order - Amazon Checkout</title></head><body>
<form><input type="hidden" name="purchaseId" value="${purchaseId}"></form>
<div data-optimistic-target="delivery-group:0"><div id="checkout-item-block-0"><h2><span><span class="break-word">${arriving}</span></span></h2>
<span class="lineitem-title-text break-word"> ${title} </span><span data-testid="Item_asin_0_0_0" class="aok-hidden">${asin}</span></div></div>
<span>Place your order</span></body></html>`;
}
function thankYouPage() {
	return `<!doctype html><html><head><meta charset="utf-8"><title>Place Your Order - Amazon Checkout</title></head><body>
<div cel_widget_id="typ-purchaseConfirmationStatus" class="celwidget"><h4 aria-level="1" class="a-color-success"><div class="a-box a-alert-inline a-alert-inline-success"><div class="a-box-inner a-alert-container"><h4 class="a-alert-heading">Order placed, thanks!</h4></div></div></h4></div>
<div id="widget-deliveryPromise-orderGroupID0#itemGroupID0" class="a-row"><span id="delivery-promise-orderGroupID0#itemGroupID0"><span class="a-text-bold"><span class="break-word">Monday, Nov. 9</span></span><p><span class="break-word">Estimated delivery</span></p></span></div>
</body></html>`;
}

function render(url) {
	const u = new URL(url);
	if (u.pathname === "/checkout/p/p-106-1111111-2222222/spc") return checkoutPage("106-1111111-2222222", "B0H7GXLHFK", "Pet Hair Removal Glove", "Arriving Nov 9, 2026");
	if (u.pathname === "/checkout/p/p-106-3333333-4444444/spc") return checkoutPage("106-3333333-4444444", "B0HLPGVW5T", "Reversible Dog Toy Basket", "Arriving Nov 12, 2026");
	if (u.pathname.startsWith("/gp/buy/thankyou/")) return thankYouPage();
	const page = Number(u.searchParams.get("page") || 1);
	if (u.pathname === "/vine/orders") return variant(shortPager(ORDERED), page);
	if (u.pathname === "/vine/vine-reviews") return variant(shortPager(u.searchParams.get("review-type") === "completed" ? REVIEWED : AWAITING), page);
	return "<!doctype html><title>x</title>";
}

// ---- fake Google Sheets API (just what the extension uses)
const HEADERS = ["ORDER DATE", "ORDER #", "IMAGE", "STATUS", "TITLE (PRODUCT LINK)", "ETV", "DELIVERY STATUS", "DELIVERY DATE", "PICS", "REVIEW SATUS", "REVIEW SCORE", "STAR RATING", "GENERAL REVIEW NOTES", "REVIEW DATE", "REVIEW LINK"];
const sheet = {
	grid: [["", "totals"], HEADERS, ["9/18/2026", "111-9999999-0000001", "img", "DELIVERED", "Tire Inflator 150 PSI Compatible with Makita 18V Battery", "20", "", "", "", "", "", "", "", "", ""]],
	links: { 2: "https://www.amazon.com/dp/B0H5JR235Z" },
	rowCount: 400,
	posts: [],
	gets: [],
};
function sheetsApi(route) {
	const req = route.request();
	const url = new URL(req.url());
	const json = (o) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(o) });
	if (req.method() === "GET" && url.pathname.includes("/values/")) return json({ values: sheet.grid.map((r) => r.slice()) });
	if (req.method() === "GET" && url.searchParams.get("ranges")) {
		sheet.gets.push("links");
		return json({ sheets: [{ data: [{ startRow: 0, rowData: sheet.grid.map((_, i) => ({ values: [sheet.links[i] ? { hyperlink: sheet.links[i] } : {}] })) }] }] });
	}
	if (req.method() === "GET") return json({ sheets: [{ properties: { sheetId: 7, title: "DASHBOARD", gridProperties: { rowCount: sheet.rowCount, columnCount: 31 } } }] });
	if (req.method() === "POST" && url.pathname.endsWith(":batchUpdate")) {
		const body = JSON.parse(req.postData());
		for (const r of body.requests) {
			const c = r.updateCells?.rows[0].values[0];
			if (c?.textFormatRuns && c.userEnteredValue.stringValue === undefined) return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { message: "textFormatRuns are only valid on user entered strings" } }) });
		}
		sheet.posts.push(body);
		for (const r of body.requests) {
			if (r.appendDimension) sheet.rowCount += r.appendDimension.length;
			if (r.updateCells) {
				const { rowIndex, columnIndex } = r.updateCells.start;
				while (sheet.grid.length <= rowIndex) sheet.grid.push([]);
				const cell = r.updateCells.rows[0].values[0];
				const v = cell.userEnteredValue;
								sheet.grid[rowIndex][columnIndex] = v.stringValue ?? (v.numberValue !== undefined ? String(v.numberValue) : v.formulaValue);
				const link = cell.textFormatRuns?.[0]?.format?.link?.uri;
				if (columnIndex === 4 && link) sheet.links[rowIndex] = link;
			}
		}
		return json({ replies: body.requests.map(() => ({})) });
	}
	return route.fulfill({ status: 404, body: "{}" });
}

const results = [];
async function test(name, fn) {
	const t0 = Date.now();
	try {
		await fn();
		results.push(true);
		console.log(`  ok   ${name} (${Math.round((Date.now() - t0) / 1000)}s)`);
	} catch (e) {
		results.push(false);
		console.log(`  FAIL ${name}\n       ${String(e.stack || e.message).split("\n").slice(0, 6).join("\n       ")}`);
	}
}

(async () => {
	const { ctx, log, sw } = await launch({
		pageRenderer: render,
		extraRoutes: async (route, url) => {
			if (url.startsWith("https://sheets.googleapis.com/")) {
				await sheetsApi(route);
				return true;
			}
			return false;
		},
	});
	const waitFor = async (fn, ms = 30000) => {
		const t0 = Date.now();
		for (;;) {
			let v = false;
			try {
				v = await fn();
			} catch (e) {}
			if (v) return v;
			if (Date.now() - t0 > ms) throw new Error("timed out: " + fn.toString().slice(0, 110));
			await new Promise((r) => setTimeout(r, 250));
		}
	};
	const open = async (p) => {
		const page = await ctx.newPage();
		await page.goto("https://www.amazon.com" + p, { waitUntil: "load" });
		return page;
	};
	const toasts = (page) => page.evaluate(() => [...document.querySelectorAll(".vh-notification, [class*=notification]")].map((n) => n.textContent).join(" | "));

	// a first visit creates the default settings
	await (await open("/vine/orders")).close();
	await waitFor(async () => (await sw.evaluate(() => chrome.storage.local.get("settings"))).settings);
	await sw.evaluate(async () => {
		chrome.identity.getAuthToken = (opts, cb) => cb("fake-token"); // Chrome sign-in stub
		const { settings } = await chrome.storage.local.get("settings");
		settings.google = { sheet: { enabled: true, id: "1o1zOgVLvMNbmqvcSjWJ9wgfpEkrwlNBndEgRzSVMBpI", tab: "DASHBOARD" } };
		await chrome.storage.local.set({ settings, settingsModifiedAt: Date.now() });
	});

	console.log("\nCheckout -> delivery date");
	const pending = () => sw.evaluate(async () => (await chrome.storage.local.get("vs.checkout.pending"))["vs.checkout.pending"] || {});
	await test("checkout page: the item and its arrival date are remembered; an abandoned checkout is not used", async () => {
		const a = await open("/checkout/p/p-106-1111111-2222222/spc");
		const b = await open("/checkout/p/p-106-3333333-4444444/spc");
		await waitFor(async () => Object.keys(await pending()).length === 2); // (pages stay open until the capture has run)
		await a.close();
		await b.close();
		const p = await pending();
		assert.deepEqual(p["106-1111111-2222222"].groups, [{ arriving: "2026-11-09", items: [{ asin: "B0H7GXLHFK", title: "Pet Hair Removal Glove" }] }]);
		assert.equal(p["106-1111111-2222222"].placedOn, null, "not placed yet");
	});
	await test("thank-you page: the purchase is marked placed (today), and an unknown purchase id is ignored", async () => {
		const ty = await open("/gp/buy/thankyou/handlers/display.html?purchaseId=106-1111111-2222222&ref_=x");
		await waitFor(async () => (await pending())["106-1111111-2222222"].placedOn);
		await ty.close();
		assert.match((await pending())["106-1111111-2222222"].placedOn, /^\d{4}-\d{2}-\d{2}$/);
		const unknown = await open("/gp/buy/thankyou/handlers/display.html?purchaseId=106-9999999-9999999");
		await new Promise((r) => setTimeout(r, 1500));
		await unknown.close();
		assert.equal((await pending())["106-9999999-9999999"], undefined);
		assert.equal((await pending())["106-3333333-4444444"].placedOn, null);
		// the fixture orders are dated 2026-11-04: pretend the order was placed that day, whatever today is
		await sw.evaluate(async () => {
			const o = (await chrome.storage.local.get("vs.checkout.pending"))["vs.checkout.pending"];
			o["106-1111111-2222222"].placedOn = "2026-11-04";
			await chrome.storage.local.set({ "vs.checkout.pending": o });
		});
	});

	console.log("\nOrders and reviews -> sheet");
	await test("Orders page: the 10 orders are added oldest-first with date, order #, picture, ORDERED, title (linked), ETV (linked to the invoice)", async () => {
		const page = await open("/vine/orders");
		await waitFor(() => sheet.grid.length >= 13);
		const added = sheet.grid.slice(3);
		assert.equal(added.length, 10);
		const dates = added.map((r) => r[0]).filter(Boolean);
		assert.deepEqual([...dates].sort((a, b) => a - b), dates, "oldest first");
		assert.deepEqual(added.map((r) => r[3]), Array(10).fill("ORDERED"));
		assert.match(added[0][1], /^111-\d{7}-\d{7}$/);
		assert.match(added[0][2], /^=IMAGE\("https:\/\/m\.media-amazon\.com\//);
		const writes = sheet.posts.flatMap((p) => p.requests).filter((r) => r.updateCells);
		const etv = writes.find((r) => r.updateCells.start.columnIndex === 5);
		assert.match(etv.updateCells.rows[0].values[0].userEnteredValue.formulaValue, /^=HYPERLINK\("https:\/\/www\.amazon\.com\/gp\/css\/summary\/print\.html\?orderID=111-\d{7}-\d{7}", \d+\.\d\d\)$/);
		// DELIVERY DATE (column H) only for the order that was really placed (B0H7GXLHFK); serial of 2026-11-09
		const serial = String(Math.round((Date.UTC(2026, 10, 9) - Date.UTC(1899, 11, 30)) / 86400000));
		const delivery = added.map((r) => r[7]).filter(Boolean);
		assert.deepEqual(delivery, [serial], "exactly one row has a delivery date");
		const titles = added.map((r) => r[4]);
		assert.ok(titles.some((t) => t.includes('13" x 50"')), "&#34; in the page's title became a real quote: " + titles.join("|"));
		assert.ok(titles.every((t) => !/&amp;|&#34;/.test(t)), "no leftover entities");
		await waitFor(async () => /Added 10 orders/.test(await toasts(page)), 8000);
		await page.close();
	});

	await test("Visiting the Orders page again adds nothing (order numbers are already on the sheet)", async () => {
		const before = sheet.posts.length;
		const page = await open("/vine/orders");
		await page.waitForTimeout(4000);
		assert.equal(sheet.posts.length, before);
		await page.close();
	});

	await test("'Send all orders' walks pages 1-3 and adds only the 20 new ones", async () => {
		const page = await open("/vine/orders");
		await page.locator("#vs-sheet-sync-all").click();
		await waitFor(async () => /Added 20 order/.test(await toasts(page)), 40000);
		assert.equal(sheet.grid.length, 3 + 30);
		const nums = sheet.grid.slice(3).map((r) => r[1]);
		assert.equal(new Set(nums).size, 30, "no duplicates");
		await page.close();
	});

	await test("Reviewed page: the matching row gets LIVE, EXCELLENT, COMPLETED and the review link; other rows are untouched", async () => {
		const page = await open("/vine/vine-reviews?review-type=completed");
		await waitFor(() => sheet.grid[2][9] === "LIVE", 20000);
		assert.equal(sheet.grid[2][10], "EXCELLENT");
		assert.equal(sheet.grid[2][3], "COMPLETED");
		assert.match(sheet.grid[2][14], /^https:\/\/www\.amazon\.com\/review\/R[A-Z0-9]+\/ref=cm_cr_othr_d_rdp_perm\?ie=UTF8$/);
		assert.equal(sheet.grid[2][1], "111-9999999-0000001");
		await page.close();
	});

	await test("Awaiting page: 'Not yet reviewed' -> NOT SUBMITTED only where the status is empty; manual states are never replaced", async () => {
		sheet.grid[2][9] = "TAKEN DOWN"; // the owner's own state on the first row
		const page = await open("/vine/vine-reviews?review-type=pending_review");
		const row = Number(Object.keys(sheet.links).find((k) => /B0HCVX7XDG$/.test(sheet.links[k])));
		assert.ok(row > 2, "the awaiting item was added by the orders test");
		await waitFor(() => sheet.grid[row][9] === "NOT SUBMITTED", 15000);
		assert.equal(sheet.grid[2][9], "TAKEN DOWN");
		await page.close();
	});

	await test("Nothing is sent to Google while 'add automatically' is off", async () => {
		await sw.evaluate(async () => {
			const { settings } = await chrome.storage.local.get("settings");
			settings.google.sheet.enabled = false;
			await chrome.storage.local.set({ settings, settingsModifiedAt: Date.now() });
		});
		const before = sheet.posts.length;
		const reqs = log.requests.filter((r) => /sheets\.googleapis/.test(r.url)).length;
		const page = await open("/vine/orders");
		await page.waitForTimeout(3500);
		assert.equal(log.requests.filter((r) => /sheets\.googleapis/.test(r.url)).length, reqs);
		assert.equal(sheet.posts.length, before);
		assert.equal(await page.locator("#vs-sheet-sync-all").count(), 0, "no extra button either");
		await page.close();
	});

	const hostsSeen = new Set(log.requests.map((r) => new URL(r.url).host));
	console.log("\nhosts contacted:", [...hostsSeen].join(", "));
	assert.deepEqual([...hostsSeen].filter((h) => !/^(www\.amazon\.com|m\.media-amazon\.com|sheets\.googleapis\.com)$/.test(h)), []);
	await ctx.close();
	const failed = results.filter((r) => !r).length;
	console.log(`\n${results.length - failed}/${results.length} passed`);
	process.exit(failed ? 1 : 0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
