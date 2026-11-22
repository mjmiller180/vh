// Last compiled at 2026-11-21_1906
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
// Pins remember the queue page they were pinned from; the Pinned tab tile has an icon that opens it in a new tab.
const assert = require("node:assert/strict");
const { launch } = require("./lib.cjs");

const PX = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
function vinePage(url) {
	const items = (new URL(url).searchParams.get("items") || "1,2,3,4").split(",").map(Number);
	const tiles = items
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
		// the same icon in the header bar of the item's own tile in the listing, only while it is pinned
		const tileIcon = page.locator("#vh-source-link-B0SRC00100");
		assert.equal(await tileIcon.evaluate((a) => a.style.display !== "none"), true, "icon in the tile header after pinning");
		assert.equal(await tileIcon.getAttribute("href"), SRC);
		assert.equal(await page.locator("#vh-source-link-B0SRC00200").evaluate((a) => a.style.display), "none", "not pinned: no icon");
		const [popup] = await Promise.all([ctx.waitForEvent("page"), link.evaluate((a) => a.click())]);
		assert.match(popup.url(), /vine-items\?queue=encore&pn=&cn=&page=15$/);
		await popup.close();
		await page.close();
	});

	const iconHref = (page, n) => page.locator(`#vh-pin-B0SRC00${n}00 .vh-source-link`).evaluate((a) => ({ href: a.getAttribute("href"), shown: a.style.display !== "none" }));
	const base = { queue: "encore", thumbnail: PX, is_parent_asin: false, is_pre_release: false };
	const seed = (entries) =>
		sw.evaluate(async ({ entries, base }) => {
			const { pinnedItems } = await chrome.storage.local.get("pinnedItems");
			for (const [n, extra] of Object.entries(entries)) pinnedItems[`B0SRC00${n}00`] = { ...base, date_added: Date.now(), title: `Seed pin ${n}`, enrollment_guid: `a1b2c3d4-000${n}-4000-8000-00000000000${n}`, ...extra };
			await chrome.storage.local.set({ pinnedItems });
		}, { entries, base });

	await test("a pinned item that shows on a page of another address gets that page as its new link (stored and shown); others keep theirs", async () => {
		await seed({ 2: { source_url: "https://www.amazon.com/vine/vine-items?queue=encore&page=3" } }); // not on the page below
		const B = "https://www.amazon.com/vine/vine-items?queue=encore&page=16&items=1";
		const page = await open("?queue=encore&page=16&items=1");
		await waitFor(async () => (await pinned()).B0SRC00100.source_url === B);
		assert.deepEqual(await iconHref(page, 1), { href: B, shown: true }, "the tile already shows the new link");
		assert.equal((await pinned()).B0SRC00200.source_url, "https://www.amazon.com/vine/vine-items?queue=encore&page=3", "not on this page: unchanged");
		const tileIcon = page.locator("#vh-source-link-B0SRC00100");
		assert.deepEqual(await tileIcon.evaluate((a) => ({ href: a.getAttribute("href"), shown: a.style.display !== "none" })), { href: B, shown: true }, "old pin: icon in its tile header with the new link");
		assert.ok((await pinned()).B0SRC00100.source_seen_at > 0);
		await page.close();
	});

	await test("older pins (no page known) and junk from a sync are filled in when the item shows; a pin that is not on the page stays without an icon", async () => {
		await seed({ 3: {}, 4: { source_url: "javascript:alert(1)" }, 5: {} }); // 5 is never on the page below
		const C = "https://www.amazon.com/vine/vine-items?queue=encore&page=7&items=3,4";
		const page = await open("?queue=encore&page=7&items=3,4");
		await waitFor(async () => (await pinned()).B0SRC00300.source_url === C && (await pinned()).B0SRC00400.source_url === C);
		assert.deepEqual(await iconHref(page, 3), { href: C, shown: true });
		assert.deepEqual(await iconHref(page, 4), { href: C, shown: true });
		assert.equal((await pinned()).B0SRC00500.source_url, undefined);
		assert.equal((await iconHref(page, 5)).shown, false, "no page known: no icon");
		await page.close();
	});

	await test("seeing the item again on the same page changes nothing (no needless rewrite)", async () => {
		const before = (await pinned()).B0SRC00300.source_seen_at;
		await new Promise((r) => setTimeout(r, 50));
		const page = await open("?queue=encore&page=7&items=3,4");
		await page.waitForSelector("#vh-pin-B0SRC00300", { state: "attached" });
		await page.waitForTimeout(1500);
		assert.equal((await pinned()).B0SRC00300.source_seen_at, before);
		await page.close();
	});

	await test("unpinning takes the icon out of the tile header", async () => {
		const page = await open("?queue=encore&page=16&items=1");
		const tileIcon = page.locator("#vh-source-link-B0SRC00100");
		await waitFor(async () => (await tileIcon.evaluate((a) => a.style.display)) !== "none");
		await page.click("#vh-pin-link-B0SRC00100"); // unpin
		await waitFor(async () => !(await pinned()).B0SRC00100);
		assert.equal(await tileIcon.evaluate((a) => a.style.display), "none");
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
