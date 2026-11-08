// Last compiled at 2026-11-07_2157
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
// Saved searches end to end: a Vine items page with the real header structure (logo link, header links, search box),
// the real extension, real clicks. Layout is checked with real bounding boxes.
const assert = require("node:assert/strict");
const { launch } = require("./lib.cjs");

function vinePage(url) {
	const u = new URL(url);
	const term = u.searchParams.get("search") || "";
	return `<!doctype html><html lang="en-us"><head><meta charset="utf-8"><title>Vine</title>
<style>body{background:#1a1a1a;color:#eee;margin:0;font-family:Arial}
#vvp-header{overflow:hidden;padding:10px;width:1500px}
#vvp-logo-link{float:left;margin-right:16px}#vvp-logo-link img{width:205px;height:65px;background:#4a4}
.vvp-header-links-container{float:right;list-style:none;margin:0;padding:0}.vvp-header-link{display:inline-block;padding:0 8px}
.vvp-container-search{display:flex;justify-content:flex-end;align-items:center;width:1500px}</style></head><body>
<script type="a-state" data-a-state='{"key":"vvp-context"}'>${JSON.stringify({ queueKey: "encore", customerId: "A1FIXTURE", marketplaceId: "ATVPDKIKX0DER", voiceDetails: { tierStatus: "TIER1" } })}</script>
<div class="a-container vvp-body"><div id="vvp-header" class="a-section vvp-header-margins">
<a id="vvp-logo-link" href="https://www.amazon.com/vine"> <img alt="vine_logo_title" height="65"></a>
<ul class="vvp-header-links-container"><li class="vvp-header-link"><a href="#">Messages</a></li><li class="vvp-header-link"><a href="/vine/help">Vine Help</a></li><li class="vvp-header-link"><a href="#">Feedback</a></li><li class="vvp-header-link"><a href="#">Contact Us</a></li></ul></div>
<div class="a-section vvp-container-right-align vvp-container-search"><div class="a-search"><i class="a-icon a-icon-search"></i><input type="search" maxlength="50" required id="vvp-search-text-input" placeholder="Search Vine items" value="${term.replace(/"/g, "&quot;")}" class="a-input-text"></div>
<span class="a-declarative"><span id="vvp-search-button" class="a-button a-button-search"><span class="a-button-inner"><input class="a-button-input" type="submit"><span class="a-button-text" aria-hidden="true">Search</span></span></span></span></div>
<div id="vvp-items-grid-container"><p>0 items</p><div id="vvp-items-grid" class="a-section"></div></div></div></body></html>`;
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
	const { ctx, log, sw } = await launch({ pageRenderer: vinePage });
	const waitFor = async (fn, ms = 15000) => {
		const t0 = Date.now();
		for (;;) {
			let v = false;
			try {
				v = await fn();
			} catch (e) {}
			if (v) return v;
			if (Date.now() - t0 > ms) throw new Error("timed out: " + fn.toString().slice(0, 110));
			await new Promise((r) => setTimeout(r, 200));
		}
	};
	const open = async (query) => {
		const page = await ctx.newPage();
		await page.goto("https://www.amazon.com/vine/vine-items" + query, { waitUntil: "load" });
		await page.waitForSelector("#vs-save-search", { timeout: 20000 });
		return page;
	};
	const stored = () => sw.evaluate(async () => (await chrome.storage.local.get("settings")).settings?.savedSearches?.items);
	const label = (page) => page.locator("#vs-save-search").textContent();
	const chips = (page) => page.locator("#vs-saved-searches a.vs-search-chip");
	const save = async (query) => {
		const page = await open(query);
		await page.locator("#vs-save-search").click();
		await waitFor(async () => /Remove Search/.test(await label(page)));
		return page;
	};

	await waitFor(async () => (await sw.evaluate(() => chrome.storage.local.get("settings"))).settings);
	console.log("\nSaved searches");
	await test("Save Search saves the page's search; the chip appears in the header next to the logo and the button becomes Remove Search", async () => {
		const page = await open("?search=dog&queue=encore");
		assert.equal((await label(page)).trim(), "Save Search");
		assert.equal(await chips(page).count(), 0);
		await page.locator("#vs-save-search").click();
		await waitFor(async () => (await chips(page).count()) === 1);
		assert.equal((await chips(page).first().textContent()).trim(), "dog [AI]");
		assert.equal((await label(page)).trim(), "Remove Search");
		assert.deepEqual(await stored(), ["/vine/vine-items?search=dog&queue=encore"]);
		const logo = await page.locator("#vvp-logo-link").boundingBox();
		const chip = await chips(page).first().boundingBox();
		assert.ok(chip.x > logo.x + logo.width, "to the right of the logo");
		assert.ok(chip.y < logo.y + logo.height, "level with the logo, not below it");
		assert.ok(await chips(page).first().evaluate((a) => a.classList.contains("vs-current")), "the search being viewed is highlighted");
		await page.close();
	});

	await test("it is still there on the next visit (and on a page without that search the button says Save Search again)", async () => {
		const page = await open("");
		assert.equal(await chips(page).count(), 1);
		assert.equal((await label(page)).trim(), "Save Search");
		await page.close();
	});

	await test("typed text that was not searched yet can be saved; empty box gives a hint instead", async () => {
		const page = await open("");
		await page.locator("#vs-save-search").click();
		assert.match(await label(page), /Type a search first/);
		await page.locator("#vvp-search-text-input").fill("cat toy");
		await page.waitForTimeout(100);
		await waitFor(async () => /Save Search/.test(await label(page)), 4000);
		await page.locator("#vs-save-search").click();
		await waitFor(async () => (await chips(page).count()) === 2);
		assert.deepEqual(await stored(), ["/vine/vine-items?search=dog&queue=encore", "/vine/vine-items?search=cat%20toy"]);
		await page.close();
	});

	await test("layout: two per column, top then bottom, then the next column", async () => {
		for (const t of ["bird", "fish", "frog"]) await (await save("?search=" + t)).close();
		const page = await open("");
		await waitFor(async () => (await chips(page).count()) === 5);
		const b = [];
		for (let i = 0; i < 5; i++) b.push(await chips(page).nth(i).boundingBox());
		assert.equal(Math.round(b[0].x), Math.round(b[1].x), "1 and 2 share a column");
		assert.ok(b[1].y > b[0].y + b[0].height - 1, "2 is below 1");
		assert.ok(b[2].x > b[0].x + b[0].width - 1 && Math.round(b[2].y) === Math.round(b[0].y), "3 starts the next column at the top");
		assert.equal(Math.round(b[3].x), Math.round(b[2].x));
		assert.ok(b[3].y > b[2].y);
		assert.ok(b[4].x > b[2].x && Math.round(b[4].y) === Math.round(b[0].y), "5 starts the third column");
		const hdr = await page.locator(".vvp-header-links-container").boundingBox();
		assert.ok(b[4].x + b[4].width < hdr.x, "the chips never run into the header links");
		await page.close();
	});

	await test("clicking a chip opens that search; Remove Search takes it out and the others move up", async () => {
		const page = await open("");
		await chips(page).nth(1).click(); // "cat toy"
		await page.waitForURL(/search=cat%20toy/);
		await page.waitForSelector("#vs-save-search");
		assert.equal((await label(page)).trim(), "Remove Search");
		await page.locator("#vs-save-search").click();
		await waitFor(async () => (await chips(page).count()) === 4);
		assert.equal((await label(page)).trim(), "Save Search");
		const texts = await chips(page).allTextContents();
		assert.deepEqual(texts.map((t) => t.trim()), ["dog [AI]", "bird", "fish", "frog"]);
		assert.equal((await stored()).length, 4);
		await page.close();
	});

	await test("the list holds 14; the 15th is refused with a message", async () => {
		await sw.evaluate(async () => {
			const { settings } = await chrome.storage.local.get("settings");
			settings.savedSearches = { items: Array.from({ length: 14 }, (_, i) => `/vine/vine-items?search=s${i}`) };
			await chrome.storage.local.set({ settings, settingsModifiedAt: Date.now() });
		});
		const page = await open("?search=extra");
		await page.locator("#vs-save-search").click();
		await waitFor(async () => /List full \(14\)/.test(await label(page)));
		assert.equal((await stored()).length, 14);
		await page.close();
	});

	await test("junk in the stored list (a sync from another computer) is ignored: no links to other sites, no markup", async () => {
		await sw.evaluate(async () => {
			const { settings } = await chrome.storage.local.get("settings");
			settings.savedSearches = { items: ["javascript:alert(1)", "https://evil.example/vine/vine-items?search=a", '/vine/vine-items?search=<img src=x onerror="window.__pwn=1">', "/vine/vine-items?search=good"] };
			await chrome.storage.local.set({ settings, settingsModifiedAt: Date.now() });
		});
		const page = await open("");
		await waitFor(async () => (await chips(page).count()) === 1);
		assert.equal((await chips(page).first().textContent()).trim(), "good");
		assert.deepEqual(await page.locator("#vs-saved-searches a").evaluateAll((as) => as.map((a) => a.getAttribute("href"))), ["/vine/vine-items?search=good"]);
		assert.equal(await page.evaluate(() => window.__pwn), undefined);
		await page.close();
	});

	const hosts = new Set(log.requests.map((r) => new URL(r.url).host));
	assert.deepEqual([...hosts].filter((h) => h !== "www.amazon.com"), [], "nothing but Amazon was contacted");
	await ctx.close();
	const failed = results.filter((r) => !r).length;
	console.log(`\n${results.length - failed}/${results.length} passed`);
	process.exit(failed ? 1 : 0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
