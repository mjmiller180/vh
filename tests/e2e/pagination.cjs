// Last compiled at 2026-11-09_1226
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
// Top pagination: with the "Pagination on top" style AND the "Pagination also at the top" copy switched on, the two used to be
// drawn on top of each other (garbled numbers). Real browser, real extension, real bounding boxes.
const assert = require("node:assert/strict");
const { launch } = require("./lib.cjs");

const PX = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
function vinePage(url) {
	const tiles = [1, 2].map((i) => `<div class="vvp-item-tile"><div class="vvp-item-tile-content"><img src="${PX}" alt=""><div class="vvp-item-product-title-container"><a class="a-link-normal" href="/dp/B0PAGE0${i}00"><span class="a-truncate"><span class="a-truncate-full a-offscreen">Item ${i}</span><span class="a-truncate-cut" aria-hidden="true">Item ${i}</span></span></a></div><span class="a-button a-button-primary vvp-details-btn"><span class="a-button-inner"><input data-asin="B0PAGE0${i}00" data-is-parent-asin="false" data-is-pre-release="false" data-recommendation-id="amzn1.vine.rec#B0PAGE0${i}00#vine.enrollment.a1b2c3d4-0001-4000-8000-00000000000${i}" data-recommendation-type="VINE_FOR_ALL" class="a-button-input" type="submit"><span class="a-button-text">See details</span></span></span></div></div>`).join("");
	return `<!doctype html><html lang="en-us"><head><meta charset="utf-8"><title>Vine</title></head><body>
<script type="a-state" data-a-state='{"key":"vvp-context"}'>${JSON.stringify({ queueKey: "encore", customerId: "A1FIXTURE", marketplaceId: "ATVPDKIKX0DER", voiceDetails: { tierStatus: "TIER1" } })}</script>
<div id="vvp-header"><div id="vvp-vine-participation-content"><ul><li>Silver tier. Limit of $ 2,000.00 this period.</li></ul></div></div>
<div id="vvp-items-button-container"></div>
<div class="a-section vvp-tab-content"><div id="vvp-items-grid-container"><p>Displaying 1-2 of 90 results</p><div id="vvp-items-grid" class="a-section">${tiles}</div>
<nav class="a-text-center"><ul class="a-pagination"><li class="a-disabled">Previous</li><li class="a-selected"><a href="#">1</a></li><li><a href="?page=2">2</a></li><li><a href="?page=3">3</a></li><li class="a-last"><a href="?page=2">Next</a></li></ul></nav></div></div></body></html>`;
}

const results = [];
async function test(name, fn) {
	try {
		await fn();
		results.push(true);
		console.log(`  ok   ${name}`);
	} catch (e) {
		results.push(false);
		console.log(`  FAIL ${name}\n       ${String(e.stack || e.message).split("\n").slice(0, 6).join("\n       ")}`);
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
	const setSettings = (patch) =>
		sw.evaluate(async (patch) => {
			const { settings } = await chrome.storage.local.get("settings");
			for (const [path, v] of Object.entries(patch)) {
				const keys = path.split(".");
				const last = keys.pop();
				let cur = settings;
				for (const k of keys) cur = cur[k] ??= {};
				cur[last] = v;
			}
			await chrome.storage.local.set({ settings, settingsModifiedAt: Date.now() });
		}, patch);
	const open = async () => {
		const page = await ctx.newPage();
		await page.goto("https://www.amazon.com/vine/vine-items?queue=encore");
		await page.waitForSelector("#vh-status[data-status='productsUpdated']", { state: "attached", timeout: 30000 });
		return page;
	};
	// the visible pagination bars and where they are
	const bars = (page) =>
		page.evaluate(() =>
			[...document.querySelectorAll("ul.a-pagination")]
				.map((u) => ({ r: u.getBoundingClientRect(), top: !!u.closest(".topPagination, .topPaginationVerbose"), shown: u.getClientRects().length > 0 }))
				.filter((b) => b.shown && b.r.width > 0)
				.map((b) => ({ x: b.r.x, y: b.r.y, w: b.r.width, h: b.r.height, copy: b.top }))
		);
	const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

	await (await open()).close();
	await waitFor(async () => (await sw.evaluate(() => chrome.storage.local.get("settings"))).settings);
	console.log("\nTop pagination");
	await test("'Pagination also at the top' alone: one copy at the top, one at the bottom, not on top of each other", async () => {
		await setSettings({ "general.topPagination": true, "thorvarium.paginationOnTop": false });
		const page = await open();
		const b = await bars(page);
		assert.equal(b.length, 2, JSON.stringify(b));
		assert.equal(b.filter((x) => x.copy).length, 1);
		assert.ok(!overlap(b[0], b[1]));
		await page.close();
	});

	await test("with the 'Pagination on top' style as well: ONE pagination at the top, nothing drawn over anything", async () => {
		await setSettings({ "general.topPagination": true, "thorvarium.paginationOnTop": true });
		const page = await open();
		await waitFor(async () => (await bars(page)).length >= 1);
		const b = await bars(page);
		assert.equal(b.filter((x) => x.copy).length, 0, "no second copy while the style already moves Amazon's own to the top: " + JSON.stringify(b));
		for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) assert.ok(!overlap(b[i], b[j]), "two paginations overlap: " + JSON.stringify(b));
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
