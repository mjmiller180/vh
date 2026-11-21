// Last compiled at 2026-11-21_1828
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
// Pins remember the queue page they were pinned from; the Pinned tab tile has an icon that opens it in a new tab.
const assert = require("node:assert/strict");
const { launch } = require("./lib.cjs");

const PX = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
function vinePage() {
	const tiles = [1, 2, 3, 4]
		.map(
			(i) =>
				`<div class="vvp-item-tile"><div class="vvp-item-tile-content"><img src="${PX}" alt=""><div class="vvp-item-product-title-container"><a class="a-link-normal" href="/dp/B0SRC00${i}00"><span class="a-truncate"><span class="a-truncate-full a-offscreen">Source item ${i}</span><span class="a-truncate-cut" aria-hidden="true">Source item ${i}</span></span></a></div><span class="a-button a-button-primary vvp-details-btn"><span class="a-button-inner"><input data-asin="B0SRC00${i}00" data-is-parent-asin="false" data-is-pre-release="false" data-recommendation-id="amzn1.vine.rec#B0SRC00${i}00#vine.enrollment.a1b2c3d4-0001-4000-8000-00000000000${i}" data-recommendation-type="VINE_FOR_ALL" class="a-button-input" type="submit"><span class="a-button-text">See details</span></span></span></div></div>`
		)
		.join("");
	return `<!doctype html><html lang="en-us"><head><meta charset="utf-8"><title>Vine</title></head><body>
<script type="a-state" data-a-state='{"key":"vvp-context"}'>${JSON.stringify({ queueKey: "encore", customerId: "A1FIXTURE", marketplaceId: "ATVPDKIKX0DER", voiceDetails: { tierStatus: "TIER1" } })}</script>
<div id="vvp-header"><div id="vvp-vine-participation-content"><ul><li>Silver tier. Limit of $ 2,000.00 this period.</li></ul></div></div>
<div id="vvp-items-button-container"></div>
<div class="a-section vvp-tab-content"><div id="vvp-items-grid-container"><p>Displaying 1-4 of 4 results</p><div id="vvp-items-grid" class="a-section">${tiles}</div></div></div></body></html>`;
}

const results = [];
async function test(name, fn) {
	try {
		await fn();
		results.push(true);
		console.log(`  ok   ${name}`);
	} catch (e) {
		results.push(false);
		console.log(`  FAIL ${name}\n       ${String(e.stack || e.message).split("\n").slice(0, 8).join("\n       ")}`);
	}
}

(async () => {
	const { ctx, log, sw } = await launch({ pageRenderer: vinePage });
	const waitFor = async (fn, ms = 20000) => {
		const t0 = Date.now();
		for (;;) {
			let v = false;
			try {
				v = await fn();
			} catch (e) {}
			if (v) return v;
			if (Date.now() - t0 > ms) throw new Error("timed out: " + fn.toString().slice(0, 100));
			await new Promise((r) => setTimeout(r, 200));
		}
	};
	const pinned = () => sw.evaluate(async () => (await chrome.storage.local.get("pinnedItems")).pinnedItems || {});
	const open = async (query) => {
		const page = await ctx.newPage();
		await page.goto("https://www.amazon.com/vine/vine-items" + query);
		await page.waitForSelector("#vh-status[data-status='productsUpdated']", { state: "attached", timeout: 30000 });
		return page;
	};

	await (await open("?queue=encore&page=15")).close();
	await waitFor(async () => (await sw.evaluate(() => chrome.storage.local.get("settings"))).settings);

	console.log("\nPin source page");
	const SRC = "https://www.amazon.com/vine/vine-items?queue=encore&pn=&cn=&page=15";
	await test("pinning stores the page it was pinned from; the Pinned tab tile has an icon that opens that page in a new tab", async () => {
		const page = await open("?queue=encore&pn=&cn=&page=15#something");
		await page.click("#vh-pin-link-B0SRC00100");
		await waitFor(async () => (await pinned()).B0SRC00100);
		assert.equal((await pinned()).B0SRC00100.source_url, SRC, "stored without the #fragment");
		const link = page.locator("#vh-pin-B0SRC00100 .vh-source-link");
		await waitFor(async () => (await link.count()) === 1);
		assert.equal(await link.getAttribute("href"), SRC);
		assert.equal(await link.getAttribute("target"), "_blank");
		const [popup] = await Promise.all([ctx.waitForEvent("page"), link.evaluate((a) => a.click())]);
		assert.match(popup.url(), /vine-items\?queue=encore&pn=&cn=&page=15$/);
		await popup.close();
		await page.close();
	});

	await test("it is still there after a reload, and a pin from another page keeps its own page", async () => {
		const page = await open("?queue=potluck&page=2");
		await page.click("#vh-pin-link-B0SRC00200");
		await waitFor(async () => (await pinned()).B0SRC00200);
		assert.equal((await pinned()).B0SRC00200.source_url, "https://www.amazon.com/vine/vine-items?queue=potluck&page=2");
		await page.reload();
		await page.waitForSelector("#vh-status[data-status='productsUpdated']", { state: "attached" });
		assert.equal(await page.locator("#vh-pin-B0SRC00100 .vh-source-link").getAttribute("href"), SRC);
		assert.equal(await page.locator("#vh-pin-B0SRC00200 .vh-source-link").getAttribute("href"), "https://www.amazon.com/vine/vine-items?queue=potluck&page=2");
		await page.close();
	});

	await test("older pins (no page known) and junk from a sync get no icon", async () => {
		await sw.evaluate(async () => {
			const { pinnedItems } = await chrome.storage.local.get("pinnedItems");
			const base = { date_added: Date.now(), queue: "encore", thumbnail: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", is_parent_asin: false, is_pre_release: false };
			pinnedItems.B0SRC00300 = { ...base, title: "Old pin", enrollment_guid: "a1b2c3d4-0003-4000-8000-000000000003" };
			pinnedItems.B0SRC00400 = { ...base, title: "Junk pin", enrollment_guid: "a1b2c3d4-0004-4000-8000-000000000004", source_url: "javascript:alert(1)" };
			await chrome.storage.local.set({ pinnedItems });
		});
		const page = await open("?queue=encore&page=1");
		await page.waitForSelector("#vh-pin-B0SRC00300", { state: "attached" });
		await page.waitForSelector("#vh-pin-B0SRC00400", { state: "attached" });
		assert.equal(await page.locator("#vh-pin-B0SRC00300 .vh-source-link").count(), 0);
		assert.equal(await page.locator("#vh-pin-B0SRC00400 .vh-source-link").count(), 0);
		assert.equal(await page.locator("#vh-pin-B0SRC00100 .vh-source-link").count(), 1);
		await page.close();
	});

	const hosts = new Set(log.requests.map((r) => new URL(r.url).host));
	assert.deepEqual([...hosts].filter((h) => h !== "www.amazon.com"), []);
	await ctx.close();
	const failed = results.filter((r) => !r).length;
	console.log(`\n${results.length - failed}/${results.length} passed`);
	process.exit(failed ? 1 : 0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
