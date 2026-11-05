// Last compiled at 2026-11-05_0049
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
// SmartSkip end-to-end: a fake 5-page queue (2 items per page, real Next links), real extension, real keyboard.
const assert = require("node:assert/strict");
const { launch, openVine } = require("./lib.cjs");

const PAGES = 5;
const PX = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const asinOf = (page, i) => `B0PG${page}0${i}`;
const guid = (page, i) => `a1b2c3d4-00${page}${i}-4000-8000-0000000000${page}${i}`;

function renderQueuePage(url) {
	const u = new URL(url);
	const page = Math.min(PAGES, Math.max(1, parseInt(u.searchParams.get("page") || "1", 10)));
	const queue = u.searchParams.get("queue") || "encore";
	let tiles = "";
	for (const i of [1, 2]) {
		const asin = asinOf(page, i);
		const title = `Queue page ${page} item ${i}`;
		tiles += `<div class="vvp-item-tile"><div class="vvp-item-tile-content"><img src="${PX}" alt=""><div class="vvp-item-product-title-container"><a class="a-link-normal" href="/dp/${asin}"><span class="a-truncate"><span class="a-truncate-full a-offscreen">${title}</span><span class="a-truncate-cut" aria-hidden="true">${title}</span></span></a></div><span class="a-button a-button-primary vvp-details-btn"><span class="a-button-inner"><input data-asin="${asin}" data-is-parent-asin="false" data-is-pre-release="false" data-recommendation-id="amzn1.vine.rec#${asin}#vine.enrollment.${guid(page, i)}" data-recommendation-type="VINE_FOR_ALL" class="a-button-input" type="submit"><span class="a-button-text">See details</span></span></span></div></div>`;
	}
	const next = page < PAGES ? `<li class="a-last"><a href="/vine/vine-items?queue=${queue}&amp;page=${page + 1}">Next</a></li>` : `<li class="a-last a-disabled">Next</li>`;
	const prev = page > 1 ? `<li><a href="/vine/vine-items?queue=${queue}&amp;page=${page - 1}">Previous</a></li>` : `<li class="a-disabled">Previous</li>`;
	return `<!doctype html><html lang="en-us"><head><meta charset="utf-8"><title>Vine queue page ${page}</title></head><body>
<script type="a-state" data-a-state='{"key":"vvp-context"}'>${JSON.stringify({ queueKey: queue, customerId: "A1FIXTURE", marketplaceId: "ATVPDKIKX0DER", voiceDetails: { tierStatus: "TIER1" } })}</script>
<div id="vvp-header"><div id="vvp-vine-participation-content"><ul><li>Silver tier. Limit of $ 2,000.00 this period.</li></ul></div></div>
<div id="vvp-items-button-container"></div>
<div id="vvp-items-grid-container"><p>10 items</p><div id="vvp-items-grid" class="a-section">${tiles}</div>
<nav class="a-text-center"><ul class="a-pagination">${prev}<li class="a-selected"><a href="#">${page}</a></li>${next}</ul></nav></div></body></html>`;
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
		console.log(`  FAIL ${name}\n       ${String(e.message).split("\n").join("\n       ")}`);
	}
}

(async () => {
	const { ctx, log, sw } = await launch({ pageRenderer: renderQueuePage });
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
	const pin = (pages) =>
		sw.evaluate(async ({ pages, PX }) => {
			const items = {};
			for (const p of pages)
				for (const i of [1, 2]) items[`B0PG${p}0${i}`] = { date_added: Date.now(), title: `Queue page ${p} item ${i}`, queue: "encore", thumbnail: PX, is_parent_asin: false, enrollment_guid: `a1b2c3d4-00${p}${i}-4000-8000-0000000000${p}${i}`, is_pre_release: false };
			await chrome.storage.local.set({ pinnedItems: items });
		}, { pages, PX });
	const url = (p) => `?queue=encore&page=${p}`;
	const state = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("vt.smartskip") || "null"));
	const boxText = (page) => page.evaluate(() => document.getElementById("vt-smartskip")?.textContent || "");
	const waitFor = async (fn, ms = 40000) => {
		const t0 = Date.now();
		for (;;) {
			let v = false;
			try {
				v = await fn();
			} catch (err) {
				// the page was navigating while we looked: just look again
			}
			if (v) return v;
			if (Date.now() - t0 > ms) throw new Error("timed out: " + fn.toString().slice(0, 100));
			await new Promise((r) => setTimeout(r, 250));
		}
	};
	const ready = (page) => page.waitForSelector("#vh-status[data-status='productsUpdated']", { state: "attached" });

	// first visit creates the default settings; then make the delays short (2s is the enforced floor)
	let page = await openVine(ctx, log, url(1));
	await ready(page);
	await setSettings({ "smartSkip.delay.active.min": "2000", "smartSkip.delay.active.max": "2000", "smartSkip.delay.background.min": "2000", "smartSkip.delay.background.max": "2000" });

	console.log("\nSmartSkip");
	await test("scans pinned pages, skips them, stops at the first page with an unpinned item (page 3)", async () => {
		await pin([1, 2]);
		await page.goto("https://www.amazon.com/vine/vine-items" + url(1));
		await ready(page);
		await page.keyboard.press("k");
		await waitFor(async () => (await boxText(page)).includes("FOUND NEW ITEMS"));
		assert.match(page.url(), /page=3/);
		const st = await state(page);
		assert.deepEqual([st.status, st.seen, st.skips, st.found], ["found", 3, 2, 2]);
		const urlAtStop = page.url();
		await page.waitForTimeout(3500);
		assert.equal(page.url(), urlAtStop, "must not keep paging after finding items");
	});

	await test("Space resumes after you pin the found items, and stops again at the next unpinned page (4)", async () => {
		await page.locator(`#vh-pin-link-${asinOf(3, 1)}`).evaluate((el) => el.click());
		await page.waitForTimeout(1200); // pin clicks are debounced for 1s
		await page.locator(`#vh-pin-link-${asinOf(3, 2)}`).evaluate((el) => el.click());
		await page.waitForTimeout(800);
		await page.keyboard.press("Space");
		await waitFor(async () => /page=4/.test(page.url()) && (await boxText(page)).includes("FOUND NEW ITEMS"));
		const st = await state(page);
		assert.equal(st.seen, 4);
	});

	await test("Escape stops the session and clears it", async () => {
		await page.keyboard.press("Escape");
		await waitFor(async () => (await state(page)) === null);
		assert.equal(await page.evaluate(() => document.getElementById("vt-smartskip")?.style.display), "none");
	});

	await test("Space pauses while a page is waiting to turn, and resuming carries on", async () => {
		await pin([1, 2, 3, 4, 5]);
		await page.goto("https://www.amazon.com/vine/vine-items" + url(1));
		await ready(page);
		await page.keyboard.press("k");
		await waitFor(async () => (await state(page))?.skips === 1); // page 1 evaluated, timer running
		await page.keyboard.press("Space");
		await waitFor(async () => (await boxText(page)).includes("PAUSED"));
		const urlWhenPaused = page.url();
		await page.waitForTimeout(3500);
		assert.equal(page.url(), urlWhenPaused, "paused sessions must not page");
		await page.keyboard.press("Space"); // resume: re-checks this page, then pages on
		await waitFor(async () => /page=2/.test(page.url()));
	});

	await test("reaches the end of the queue (disabled Next) and finishes with the totals", async () => {
		await waitFor(async () => (await state(page)) === null, 45000);
		assert.match(page.url(), /page=5/);
		await page.waitForSelector("text=end of the queue");
		await page.waitForSelector("text=Pages seen:");
	});

	await test("page limit: stops after the configured number of pages", async () => {
		await setSettings({ "smartSkip.maxPages": "2" });
		await page.goto("https://www.amazon.com/vine/vine-items" + url(1));
		await ready(page);
		await page.keyboard.press("k");
		await waitFor(async () => (await state(page)) === null, 30000);
		assert.match(page.url(), /page=2/, "maxPages=2 means exactly 2 pages are scanned");
		await page.waitForSelector("text=page limit reached");
	});

	await test("delays below the 2 second floor are raised to it", async () => {
		await setSettings({ "smartSkip.maxPages": "300", "smartSkip.delay.active.min": "100", "smartSkip.delay.active.max": "200", "smartSkip.delay.background.min": "100", "smartSkip.delay.background.max": "200" });
		await page.goto("https://www.amazon.com/vine/vine-items" + url(1));
		await ready(page);
		await page.keyboard.press("k");
		await waitFor(async () => (await state(page))?.skips === 1);
		const t0 = Date.now();
		await waitFor(async () => /page=2/.test(page.url()), 10000);
		const waited = Date.now() - t0;
		assert.ok(waited >= 1700, "paged after only " + waited + "ms (floor is 2000ms, polling adds up to 250ms of slack)");
		await page.keyboard.press("Escape");
	});

	await test("typing in a text box never triggers SmartSkip", async () => {
		await waitFor(async () => (await state(page)) === null);
		await page.evaluate(() => { const i = document.createElement("input"); i.id = "tb"; document.body.appendChild(i); i.focus(); });
		await page.keyboard.type("kkk");
		await page.waitForTimeout(500);
		assert.equal(await state(page), null);
	});

	await test("the session never leaves the tab: no third-party requests", async () => {
		const bad = log.requests.filter((r) => !/^https:\/\/www\.amazon\.com\//.test(r.url));
		assert.deepEqual(bad.map((r) => r.url), []);
	});

	await ctx.close();
	const failed = results.filter((r) => !r).length;
	console.log(`\n${results.length - failed}/${results.length} passed`);
	process.exit(failed ? 1 : 0);
})().catch((e) => {
	console.error(e);
	process.exit(2);
});
