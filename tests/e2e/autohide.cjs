// Last compiled at 2026-11-09_1758
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
// Auto-hide panel in the Product Details dialog, end to end: a Vine items page with six tiles, "See details" opens a dialog built
// from Amazon's real Product Details markup (tests/e2e/fixtures/product-details-modal.html), real clicks on the real extension.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { launch } = require("./lib.cjs");

const PX = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const MODAL = fs.readFileSync(path.join(__dirname, "fixtures", "product-details-modal.html"), "utf8");
const ITEMS = [
	["B0AUTO0001", "Toyota Tundra Sequoia Floor Mats Custom Fit All Weather Liners"],
	["B0AUTO0002", "Toyota Sequoia Seat Covers Leather"],
	["B0AUTO0003", "Toyota Camry Phone Holder"],
	["B0AUTO0004", "Honda Civic Floor Mats"],
	["B0AUTO0005", "Toyota Tundra Tow Hitch Receiver"],
	["B0AUTO0006", "Plush Dinosaur Toy for Kids"],
];
function vinePage() {
	const tiles = ITEMS.map(
		([asin, title], i) =>
			`<div class="vvp-item-tile"><div class="vvp-item-tile-content"><img src="${PX}" alt=""><div class="vvp-item-product-title-container"><a class="a-link-normal" href="/dp/${asin}"><span class="a-truncate"><span class="a-truncate-full a-offscreen">${title}</span><span class="a-truncate-cut" aria-hidden="true">${title}</span></span></a></div><span class="a-button a-button-primary vvp-details-btn"><span class="a-button-inner"><input data-asin="${asin}" data-is-parent-asin="false" data-is-pre-release="false" data-recommendation-id="amzn1.vine.rec#${asin}#vine.enrollment.a1b2c3d4-0001-4000-8000-00000000000${i + 1}" data-recommendation-type="VINE_FOR_ALL" class="a-button-input" type="submit"><span class="a-button-text">See details</span></span></span></div></div>`
	).join("");
	// stand-in for Amazon's own script: a new dialog is built every time "See details" is pressed
	const script = `
const MODAL = ${JSON.stringify(MODAL)};
const TITLES = ${JSON.stringify(Object.fromEntries(ITEMS))};
document.addEventListener("click", (e) => {
	const btn = e.target.closest(".vvp-details-btn input");
	if (!btn) return;
	e.preventDefault();
	document.querySelectorAll(".a-popover-modal").forEach((d) => d.remove());
	const host = document.createElement("div");
	host.innerHTML = MODAL;
	const dialog = host.firstElementChild;
	document.body.append(dialog);
	setTimeout(() => {
		const a = dialog.querySelector("#vvp-product-details-modal--product-title");
		a.href = "https://www.amazon.com/dp/" + btn.dataset.asin;
		a.textContent = TITLES[btn.dataset.asin];
	}, 150);
	dialog.querySelector('button[data-action="a-popover-close"]').addEventListener("click", () => dialog.remove());
}, true);
window.__requests = 0;
document.addEventListener("click", (e) => { if (e.target.closest("[data-action='vvp-request-product']")) window.__requests++; });`;
	return `<!doctype html><html lang="en-us"><head><meta charset="utf-8"><title>Vine</title></head><body>
<script type="a-state" data-a-state='{"key":"vvp-context"}'>${JSON.stringify({ queueKey: "encore", customerId: "A1FIXTURE", marketplaceId: "ATVPDKIKX0DER", voiceDetails: { tierStatus: "TIER1" } })}</script>
<div id="vvp-header"><div id="vvp-vine-participation-content"><ul><li>Silver tier. Limit of $ 2,000.00 this period.</li></ul></div></div>
<div id="vvp-items-button-container"></div>
<div class="a-section vvp-tab-content"><div id="vvp-items-grid-container"><p>Displaying 1-6 of 6 results</p><div id="vvp-items-grid" class="a-section">${tiles}</div></div></div>
<script>${script}</script></body></html>`;
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
		console.log(`  FAIL ${name}\n       ${String(e.stack || e.message).split("\n").slice(0, 8).join("\n       ")}`);
	}
}

(async () => {
	const { ctx, log, sw, extId } = await launch({ pageRenderer: vinePage });
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
			for (const [p, v] of Object.entries(patch)) {
				const keys = p.split(".");
				const last = keys.pop();
				let cur = settings;
				for (const k of keys) cur = cur[k] ??= {};
				cur[last] = v;
			}
			await chrome.storage.local.set({ settings, settingsModifiedAt: Date.now() });
		}, patch);
	const getSetting = (p) =>
		sw.evaluate(async (p) => {
			const { settings } = await chrome.storage.local.get("settings");
			return p.split(".").reduce((o, k) => o?.[k], settings);
		}, p);
	const kw = (contains, extra = {}) => ({ contains, without: "", etv_min: "", etv_max: "", ...extra });
	const open = async (patch = {}, first = false) => {
		if (!first) await setSettings({ "general.hideKeywords": [], "general.highlightKeywords": [], ...patch });
		const page = await ctx.newPage();
		await page.goto("https://www.amazon.com/vine/vine-items?queue=encore");
		await page.waitForSelector("#vh-status[data-status='productsUpdated']", { state: "attached", timeout: 30000 });
		return page;
	};
	const openPanel = async (page, asin) => {
		await page.click(`input[data-asin="${asin}"]`);
		await page.waitForSelector("#vvp-product-details-modal--product-title:not(:empty)");
		await page.click(".vs-ah-toggle");
		await page.waitForSelector(".vs-ah-chip");
	};
	const chip = (page, text) => page.locator(".vs-ah-chips .vs-ah-chip", { hasText: new RegExp(`^${text}\\d*$`) });
	const visibleTitles = (page) => page.$$eval("#vvp-items-grid .vvp-item-tile:not([style*='display: none']) .a-truncate-full", (e) => e.map((x) => x.textContent));
	const hiddenCount = (page) => page.$$eval("#tab-hidden .vvp-item-tile", (e) => e.length);

	await (await open({}, true)).close();
	await waitFor(async () => (await sw.evaluate(() => chrome.storage.local.get("settings"))).settings);
	console.log("\nAuto-hide panel");

	await test("the panel is added to a fresh Product Details dialog each time it opens", async () => {
		const page = await open();
		await page.click('input[data-asin="B0AUTO0001"]');
		await page.waitForSelector(".vs-autohide .vs-ah-toggle");
		assert.equal(await page.locator(".vs-autohide").count(), 1);
		await page.click('button[data-action="a-popover-close"]');
		await page.click('input[data-asin="B0AUTO0002"]');
		await page.waitForSelector(".vs-autohide .vs-ah-toggle");
		assert.equal(await page.locator(".vs-autohide").count(), 1);
		await page.close();
	});

	await test("while the panel is open Request product is off (and works again after closing); the panel does not overlap the product", async () => {
		const page = await open();
		await page.click('input[data-asin="B0AUTO0001"]');
		await page.waitForSelector("#vvp-product-details-modal--product-title:not(:empty)");
		const reqInput = "#vvp-product-details-modal--request-btn input";
		assert.equal(await page.locator(reqInput).isDisabled(), false);
		assert.equal(await page.textContent(".vs-ah-toggle"), "Hide / Highlight");
		await page.click(".vs-ah-toggle");
		await page.waitForSelector(".vs-ah-chip");
		assert.equal(await page.locator(reqInput).isDisabled(), true);
		await page.locator("#vvp-product-details-modal--request-btn").dispatchEvent("click");
		assert.equal(await page.evaluate(() => window.__requests), 0, "a click on the off button reached Amazon's handler");
		const r = await page.evaluate(() => {
			const a = document.querySelector(".vs-autohide").getBoundingClientRect();
			const b = document.querySelector("#vvp-product-details-modal--main").getBoundingClientRect();
			return { aBottom: a.bottom, bTop: b.top };
		});
		assert.ok(r.aBottom <= r.bTop + 1, "panel is above the product block: " + JSON.stringify(r));
		await page.click(".vs-ah-toggle"); // closes the panel
		assert.equal(await page.locator(reqInput).isDisabled(), false);
		await page.locator("#vvp-product-details-modal--request-btn").dispatchEvent("click");
		assert.equal(await page.evaluate(() => window.__requests), 1);
		await page.close();
	});

	await test("Toyota Tundra / Sequoia: two Ctrl+click phrases become one rule; matching tiles hide, pinned and others stay; Undo restores", async () => {
		const page = await open();
		// pin item 5 (Toyota Tundra Tow Hitch): pinning overrides the hide rule for that item
		await page.waitForSelector("#vh-pin-link-B0AUTO0005");
		await page.click("#vh-pin-link-B0AUTO0005");
		await waitFor(async () => (await page.$$eval("#tab-pinned .vvp-item-tile", (e) => e.length)) === 1);
		await openPanel(page, "B0AUTO0001");
		await chip(page, "Toyota").click({ modifiers: ["Control"] });
		await chip(page, "Tundra").click({ modifiers: ["Control"] });
		await page.click('.vs-ah-small:has-text("+ phrase")');
		await chip(page, "Toyota").click({ modifiers: ["Control"] });
		await chip(page, "Sequoia").click({ modifiers: ["Control"] });
		const rule = await page.inputValue(".vs-ah-expr");
		assert.equal(rule, "toyotas?\\b.*\\b(tundras?|sequoias?)");
		const preview = await page.textContent(".vs-ah-preview");
		assert.match(preview, /2 items would be hidden/);
		assert.match(preview, /1 pinned item/);
		await page.click(".vs-ah-go");
		await page.waitForSelector(".vs-ah-done");
		const saved = await getSetting("general.hideKeywords");
		assert.deepEqual(saved.map((r) => r.contains), [rule]);
		await waitFor(async () => (await hiddenCount(page)) === 2);
		const vis = await visibleTitles(page);
		assert.ok(vis.includes("Toyota Tundra Tow Hitch Receiver"), "pinned item stays: " + vis);
		assert.ok(vis.includes("Toyota Camry Phone Holder") && vis.includes("Honda Civic Floor Mats"));
		await page.click(".vs-ah-done button");
		await waitFor(async () => (await hiddenCount(page)) === 0);
		assert.deepEqual(await getSetting("general.hideKeywords"), []);
		await page.close();
	});

	await test("highlight conflict: the user must choose; 'keep' leaves the highlighted item out of the new rule", async () => {
		const page = await open({ "general.highlightKeywords": [kw("camry")] });
		await openPanel(page, "B0AUTO0001");
		await chip(page, "Toyota").click();
		assert.match(await page.textContent(".vs-ah-conflict"), /Conflict: 1 of these also match your highlight keywords/);
		assert.equal(await page.locator(".vs-ah-go").isDisabled(), true, "no choice, no add");
		await page.check('input[name="vs-autohide-res"][value="keep"]');
		await page.click(".vs-ah-go");
		await page.waitForSelector(".vs-ah-done");
		const saved = await getSetting("general.hideKeywords");
		assert.equal(saved.length, 1);
		assert.equal(saved[0].without, "camry");
		await waitFor(async () => (await hiddenCount(page)) === 2); // 1 and 2; the Camry is kept by its highlight rule, item 5 is still pinned from the test above
		assert.ok((await visibleTitles(page)).includes("Toyota Camry Phone Holder"));
		await page.close();
	});

	await test("highlight conflict: 'the new rule wins' edits the highlight rule instead", async () => {
		const page = await open({ "general.highlightKeywords": [kw("camry")] });
		await openPanel(page, "B0AUTO0001");
		await chip(page, "Toyota").click();
		await page.check('input[name="vs-autohide-res"][value="win"]');
		await page.click(".vs-ah-go");
		await page.waitForSelector(".vs-ah-done");
		assert.equal((await getSetting("general.hideKeywords"))[0].without, "");
		assert.equal((await getSetting("general.highlightKeywords"))[0].without, "toyotas?");
		await waitFor(async () => (await hiddenCount(page)) === 3); // 1, 2 and the Camry (item 5 stays: pinned)
		await page.close();
	});

	await test("a group: the next word joins the existing rule of that group instead of starting another one", async () => {
		const page = await open({ "general.hideKeywords": [kw("toyotas?", { group: "Cars" })] });
		await openPanel(page, "B0AUTO0004");
		await chip(page, "Honda").click();
		await page.fill('input[list="vs-autohide-groups"]', "Cars");
		await page.dispatchEvent('input[list="vs-autohide-groups"]', "change");
		assert.match(await page.textContent(".vs-autohide"), /added to an existing rule in the group “Cars”/);
		await page.click(".vs-ah-go");
		await page.waitForSelector(".vs-ah-done");
		const saved = await getSetting("general.hideKeywords");
		assert.equal(saved.length, 1, JSON.stringify(saved));
		assert.equal(saved[0].contains, "toyotas?|hondas?");
		assert.equal(saved[0].group, "Cars");
		await page.close();
	});

	await test("Hide this brand adds the brand as written; the rule can be edited by hand", async () => {
		const page = await open();
		await openPanel(page, "B0AUTO0001");
		await page.click('.vs-ah-chip:has-text("Hide this brand: Brotherhood")');
		assert.equal(await page.inputValue(".vs-ah-expr"), "Brotherhood");
		await page.fill(".vs-ah-expr", "(");
		await page.dispatchEvent(".vs-ah-expr", "change");
		assert.match(await page.textContent(".vs-autohide"), /not a valid expression/);
		assert.equal(await page.locator(".vs-ah-go").count(), 0);
		await page.close();
	});

	await test("Highlight mode adds to the highlight list and marks the matching tiles", async () => {
		const page = await open();
		await openPanel(page, "B0AUTO0006");
		await page.click('.vs-ah-mode:has-text("Highlight")');
		await chip(page, "Dinosaur").click();
		await page.click(".vs-ah-go");
		await page.waitForSelector(".vs-ah-done");
		assert.deepEqual((await getSetting("general.highlightKeywords")).map((r) => r.contains), ["dinosaurs?"]);
		assert.deepEqual(await getSetting("general.hideKeywords"), []);
		assert.equal(await page.$$eval('.vvp-item-tile[data-keyword-highlight="true"]', (e) => e.length), 1);
		await page.close();
	});

	console.log("\nKeywords tab groups");
	await test("the Keywords tab shows the Group column, keeps groups on Save, and sorts by group", async () => {
		await setSettings({ "general.hideKeywords": [kw("zebra"), kw("toyotas?", { group: "Cars" }), kw("battery", { group: "Batteries" })] });
		const sp = await ctx.newPage();
		await sp.goto(`chrome-extension://${extId}/page/settings.html`);
		await sp.waitForSelector("#tabs-index");
		await sp.locator("#tabs-index li", { hasText: "Keywords" }).click();
		const rows = sp.locator('#general\\.hideKeywords table>tr');
		await waitFor(async () => (await rows.count()) === 4); // header + 3
		const groups = await sp.$$eval('#general\\.hideKeywords input[name="group"]', (e) => e.map((x) => x.value));
		assert.deepEqual(groups, ["Batteries", "Cars", ""], "by group, ungrouped last");
		await sp.locator('#general\\.hideKeywords input[name="save"]').click();
		await waitFor(async () => (await getSetting("general.hideKeywords"))?.some((r) => r.group === "Cars"));
		const saved = await getSetting("general.hideKeywords");
		assert.deepEqual(saved.map((r) => [r.contains, r.group ?? null]), [["battery", "Batteries"], ["toyotas?", "Cars"], ["zebra", null]]);
		await sp.close();
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
