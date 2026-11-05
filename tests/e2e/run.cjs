// Last compiled at 2026-11-04_2317
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
// End-to-end tests: real Chromium, the real unpacked extension, a fixture Vine page, a mock Discord.
const assert = require("node:assert/strict");
const { launch, openVine, hosts } = require("./lib.cjs");

const WEBHOOK = "https://discord.com/api/webhooks/123456789012345678/TESTtoken_abc-123";
const results = [];
async function test(name, fn) {
	try {
		await fn();
		results.push([true, name]);
		console.log("  ok   " + name);
	} catch (e) {
		results.push([false, name]);
		console.log("  FAIL " + name + "\n       " + String(e.message).split("\n").join("\n       "));
	}
}

(async () => {
	const discordPosts = [];
	let discordStatus = 204; // set to 500 to simulate Discord failing
	const { ctx, log, extId, sw } = await launch({
		extraRoutes: async (route, url) => {
			if (url.startsWith("https://discord.com/api/webhooks/")) {
				discordPosts.push({ url, body: route.request().postData(), method: route.request().method(), status: discordStatus });
				await route.fulfill({ status: discordStatus, body: "" });
				return true;
			}
			return false;
		},
	});
	const waitFor = async (fn, ms = 15000, step = 200) => {
		const t0 = Date.now();
		for (;;) {
			const v = await fn();
			if (v) return v;
			if (Date.now() - t0 > ms) throw new Error("timed out waiting for condition: " + fn.toString().slice(0, 120));
			await new Promise((r) => setTimeout(r, step));
		}
	};
	assert.ok(sw && extId, "service worker did not start");
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
	const storageGet = (keys) => sw.evaluate((k) => chrome.storage.local.get(k), keys);

	// ------------------------------------------------------------------------------------------
	console.log("\nBase behaviour");
	let page = await openVine(ctx, log);
	await page.waitForSelector("#vh-status[data-status='productsUpdated']", { state: "attached", timeout: 15000 });

	await test("page works: 4 tiles, 4 toolbars, grid visible, no page errors", async () => {
		assert.equal(await page.locator(".vvp-item-tile").count(), 4);
		assert.equal(await page.locator(".vvp-item-tile .vh-status-container").count(), 4);
		assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#vvp-items-grid-container")).display), "block");
		assert.deepEqual(log.pageErrors, []);
	});

	await test("NO third-party traffic: only the Amazon page itself was requested", async () => {
		const h = hosts(log.requests.map((r) => r.url));
		assert.deepEqual(Object.keys(h), ["www.amazon.com"], JSON.stringify(h));
		assert.deepEqual(log.blocked, []);
	});

	await test("hide and pin work locally; un-hide leaves a removal record for sync", async () => {
		await page.locator("#vh-hide-link-B0TEST0001").click();
		await page.waitForTimeout(600);
		let s = await storageGet(["hiddenItems"]);
		assert.ok(s.hiddenItems && s.hiddenItems.B0TEST0001, "hidden item not stored: " + JSON.stringify(s));
		await page.locator("#vh-pin-link-B0TEST0002").evaluate((el) => el.click());
		await page.waitForTimeout(1500);
		s = await storageGet(["pinnedItems"]);
		assert.ok(s.pinnedItems && s.pinnedItems.B0TEST0002, "pinned item not stored");
		assert.ok(s.pinnedItems.B0TEST0002.date_added > 0);
		// un-hide it again (the link now lives in the hidden tab, which is not displayed: click via the DOM)
		await page.locator("#vh-hide-link-B0TEST0001").evaluate((el) => el.click());
		await page.waitForTimeout(600);
		s = await storageGet(["hiddenItems", "syncTombstones"]);
		assert.equal(s.hiddenItems?.B0TEST0001, undefined);
		assert.ok(s.syncTombstones?.hidden?.B0TEST0001 > 0, "no tombstone: " + JSON.stringify(s));
		// and un-pin
		await page.locator("#vh-pin-link-B0TEST0002").evaluate((el) => el.click());
		await page.waitForTimeout(1200); // pin clicks are debounced for 1s
		await page.waitForTimeout(600);
		s = await storageGet(["pinnedItems", "syncTombstones"]);
		assert.equal(s.pinnedItems?.B0TEST0002, undefined);
		assert.ok(s.syncTombstones?.pinned?.B0TEST0002 > 0);
	});

	// ------------------------------------------------------------------------------------------
	console.log("\nDiscord webhooks");
	await test("nothing is sent while Discord is off", async () => {
		await page.reload();
		await page.waitForTimeout(2500);
		assert.equal(discordPosts.length, 0);
	});

	await test("RFY + keyword triggers: one message per item, keyword wins over RFY, no re-send on reload", async () => {
		await setSettings({
			"discord.active": true,
			"discord.webhook.default.url": WEBHOOK,
			"discord.webhook.RFY.active": true,
			"discord.webhook.KWsMatch.active": true,
			"discord.webhook.KWsMatch.content": '{"content": "KW[$KEYWORD] $TITLE"}',
			"discord.webhook.RFY.content": '{"content": "RFY $TITLE"}',
			"general.highlightKeywords": [{ contains: "Dinosaur", without: "", etv_min: "", etv_max: "" }],
		});
		await page.reload();
		await page.waitForSelector("#vh-status[data-status='productsUpdated']", { state: "attached" });
		for (let i = 0; i < 30 && discordPosts.length < 4; i++) await page.waitForTimeout(500);
		await page.waitForTimeout(3000); // make sure nothing extra trickles in
		const msgs = discordPosts.map((p) => JSON.parse(p.body).content).sort();
		assert.equal(msgs.length, 4, "messages: " + JSON.stringify(msgs));
		assert.ok(msgs.includes("KW[Dinosaur] Plush Dinosaur Toy for Kids"), JSON.stringify(msgs));
		assert.equal(msgs.filter((m) => m.startsWith("RFY ")).length, 3, "the dinosaur must not also be sent as RFY");
		assert.ok(discordPosts.every((p) => p.url === WEBHOOK && p.method === "POST"));
		const before = discordPosts.length;
		await page.reload();
		await page.waitForTimeout(4000);
		assert.equal(discordPosts.length, before, "reload re-sent items");
	});

	await test("zero-ETV trigger fires when an ETV of 0 is revealed", async () => {
		await setSettings({ "discord.webhook.zeroETV.active": true });
		await page.reload();
		await page.waitForSelector("#vh-status[data-status='productsUpdated']", { state: "attached" });
		await page.waitForTimeout(1500);
		const before = discordPosts.length;
		await page.evaluate(() =>
			window.postMessage({ type: "etv", data: { asin: "B0TEST0003", parent_asin: null, etv: 0, title: "x", thumbnail: "x", enrollment_guid: "g" } }, "/")
		);
		await page.waitForTimeout(3000);
		const added = discordPosts.slice(before).map((p) => JSON.parse(p.body));
		assert.ok(added.some((b) => b.content.startsWith("0 ETV item")), JSON.stringify(added));
	});

	await test("manual button appears when enabled and sends the item (titles with quotes stay valid JSON)", async () => {
		await setSettings({ "discord.webhook.manual.active": true });
		await page.reload();
		await page.waitForSelector("#vh-status[data-status='productsUpdated']", { state: "attached" });
		await page.waitForTimeout(1500);
		const before = discordPosts.length;
		const btn = page.locator("#vh-announce-link-B0TEST0002");
		assert.equal(await btn.count(), 1, "manual button missing");
		await btn.click();
		await page.waitForTimeout(2500);
		const added = discordPosts.slice(before).map((p) => JSON.parse(p.body));
		assert.equal(added.length, 1);
		assert.equal(added[0].embeds[0].title, 'Zorbo "Pro" Wireless Mouse \\ RGB');
	});

	await test("a non-Discord webhook URL is refused and nothing leaves the browser", async () => {
		await setSettings({ "discord.webhook.default.url": "https://evil.example.com/api/webhooks/1/abc" });
		const before = discordPosts.length;
		const blockedBefore = log.blocked.length;
		await page.reload();
		await page.waitForSelector("#vh-status[data-status='productsUpdated']", { state: "attached" });
		await page.waitForTimeout(3000);
		assert.equal(discordPosts.length, before);
		assert.equal(log.blocked.length, blockedBefore, "something tried to reach: " + log.blocked.slice(blockedBefore).join(","));
		const manual = await page.locator("#vh-announce-link-B0TEST0002").count();
		assert.equal(manual, 0, "manual button should be hidden without a valid URL");
		await setSettings({ "discord.webhook.default.url": WEBHOOK });
	});

	// ------------------------------------------------------------------------------------------
	console.log("\nReview findings: Discord de-duplication across tabs and failures");
	await test("two tabs loading at the same time send each item exactly once", async () => {
		await sw.evaluate(() => chrome.storage.local.remove("discordSent"));
		await setSettings({ "discord.webhook.zeroETV.active": false, "discord.webhook.manual.active": false, "discord.webhook.KWsMatch.active": false, "discord.webhook.RFY.active": true, "discord.webhook.RFY.content": '{"content": "RFY $TITLE"}' });
		const before = discordPosts.length;
		const [a, b] = await Promise.all([openVine(ctx, log), openVine(ctx, log)]);
		await waitFor(() => discordPosts.length - before >= 4);
		await a.waitForTimeout(4000);
		const msgs = discordPosts.slice(before).map((p) => JSON.parse(p.body).content).sort();
		assert.equal(msgs.length, 4, "messages: " + JSON.stringify(msgs));
		assert.equal(new Set(msgs).size, 4);
		await a.close(); await b.close();
	});

	await test("a failed send is retried on the next page load (and not marked as sent)", async () => {
		await sw.evaluate(() => chrome.storage.local.remove("discordSent"));
		const before = discordPosts.length;
		discordStatus = 500;
		await page.reload();
		await waitFor(() => discordPosts.length - before >= 4); // all four attempts (the sender spaces them 0.7s apart)
		await page.waitForTimeout(1500); // ...and their roll-backs
		const sentAfterFailure = (await storageGet(["discordSent"])).discordSent || {};
		assert.deepEqual(Object.keys(sentAfterFailure), [], "failures must be rolled back in storage: " + JSON.stringify(sentAfterFailure));
		discordStatus = 204;
		const mid = discordPosts.length;
		await page.reload();
		await waitFor(() => discordPosts.length - mid >= 4);
	});

	await test("default messages cannot ping @everyone", async () => {
		const last = JSON.parse(discordPosts[discordPosts.length - 1].body);
		assert.deepEqual(last.allowed_mentions, { parse: [] });
	});

	// ------------------------------------------------------------------------------------------
	console.log("\nBlur keywords (re-implemented for the normal page)");
	await test("a blur keyword blurs the matching item only", async () => {
		await setSettings({ "general.blurKeywords": ["dinosaur"] });
		await page.reload();
		await page.waitForSelector("#vh-status[data-status='productsUpdated']", { state: "attached" });
		await page.waitForTimeout(1500);
		const blurred = await page.evaluate(() =>
			[...document.querySelectorAll(".vvp-item-tile")].filter((t) => t.querySelector("img.blur, img.dynamic-blur")).map((t) => t.querySelector("input[data-asin]").dataset.asin)
		);
		assert.deepEqual(blurred, ["B0TEST0003"]);
	});

	// ------------------------------------------------------------------------------------------
	console.log("\nSettings page");
	const sp = await ctx.newPage();
	const spErrors = [];
	sp.on("pageerror", (e) => spErrors.push(String(e)));
	sp.on("console", (m) => m.type() === "error" && spErrors.push(m.text()));
	await sp.goto(`chrome-extension://${extId}/page/settings.html`);
	await sp.waitForSelector("#tabs-index", { timeout: 10000 });

	await test("settings page renders 8 tabs incl. Sync and Discord, with no errors", async () => {
		const tabs = await sp.locator("#tabs-index li").allTextContents();
		assert.deepEqual(tabs.map((t) => t.trim()), ["General", "Notifications", "System", "Styles", "Discord", "Keywords", "Keyboard", "Sync"]);
		assert.equal(await sp.locator("#syncChooseFolder").count(), 1);
		assert.equal(await sp.locator("input[name='discord.webhook.manual.active']").count(), 1);
		assert.deepEqual(spErrors, []);
	});

	await test("settings page edits are saved (Discord switch + webhook toggle)", async () => {
		await sp.locator("#tabs-index li", { hasText: "Discord" }).click();
		const kw = sp.locator("input[name='discord.webhook.AFA.active']");
		await kw.check();
		await sp.waitForTimeout(500);
		const { settings } = await storageGet(["settings"]);
		assert.equal(settings.discord.webhook.AFA.active, true);
	});

	await test("settings page makes no third-party requests", async () => {
		const bad = log.requests.filter((r) => !/^https:\/\/(www\.amazon\.com|discord\.com)\//.test(r.url));
		assert.deepEqual(bad.map((r) => r.url), []);
	});

	// ------------------------------------------------------------------------------------------
	console.log("\nFolder sync (service worker, using the browser's private file system as the shared folder)");
	await test("service worker syncs lists + settings to a file in the chosen folder", async () => {
		await sp.evaluate(async (extId) => {
			const mod = await import(`chrome-extension://${extId}/scripts/background/FolderSync.js`);
			const root = await navigator.storage.getDirectory();
			const dir = await root.getDirectoryHandle("shared-drive-folder", { create: true });
			await mod.handleStore.set(dir);
		}, extId);
		await storageGet(["settings"]);
		await sw.evaluate(() => chrome.storage.local.set({ hiddenItems: { H_TEST_1: Date.now() - 1000 } }));
		const res = await sp.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: "folderSync", reason: "manual" }, r)));
		assert.equal(res.ok, true, JSON.stringify(res));
		const file = await sp.evaluate(async () => {
			const root = await navigator.storage.getDirectory();
			const dir = await root.getDirectoryHandle("shared-drive-folder");
			const fh = await dir.getFileHandle("vinetools-sync.json");
			return JSON.parse(await (await fh.getFile()).text());
		});
		assert.equal(file.format, 1);
		assert.ok(file.hiddenItems.H_TEST_1);
		assert.equal(file.settings.discord.webhook.AFA.active, true);
		assert.equal(file.settings.general.country, undefined, "country must stay device-local");
	});

	await test("another device's changes in the folder are pulled in (hidden item + settings)", async () => {
		await sp.evaluate(async () => {
			const root = await navigator.storage.getDirectory();
			const dir = await root.getDirectoryHandle("shared-drive-folder");
			const fh = await dir.getFileHandle("vinetools-sync.json");
			const cur = JSON.parse(await (await fh.getFile()).text());
			cur.hiddenItems.FROM_OTHER_PC = Date.now() - 500;
			cur.settingsModifiedAt = Date.now() + 5000;
			cur.settings.general.toolbarBackgroundColor = "#123456";
			const w = await fh.createWritable();
			await w.write(JSON.stringify(cur));
			await w.close();
		});
		const res = await sp.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: "folderSync", reason: "manual" }, r)));
		assert.equal(res.ok && res.pulled, true, JSON.stringify(res));
		const s = await storageGet(["hiddenItems", "settings"]);
		assert.ok(s.hiddenItems.FROM_OTHER_PC && s.hiddenItems.H_TEST_1);
		assert.equal(s.settings.general.toolbarBackgroundColor, "#123456");
		assert.ok(s.settings.general.country, "own country must be preserved");
	});

	await test("status reports the folder", async () => {
		const st = await sp.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: "folderSyncStatus" }, r)));
		assert.equal(st.configured, true);
		assert.equal(st.folderName, "shared-drive-folder");
		assert.equal(st.permission, "granted");
		assert.ok(st.lastSync > 0);
	});

	await test("the Vine page pulls the folder into storage on load", async () => {
		await page.reload();
		await page.waitForSelector("#vh-status[data-status='productsUpdated']", { state: "attached" });
		const s = await storageGet(["hiddenItems"]);
		assert.ok(s.hiddenItems.FROM_OTHER_PC);
	});

	// ------------------------------------------------------------------------------------------
	console.log("\nReview findings: sync data safety");
	const readSyncFile = () =>
		sp.evaluate(async () => {
			const root = await navigator.storage.getDirectory();
			const dir = await root.getDirectoryHandle("shared-drive-folder");
			const fh = await dir.getFileHandle("vinetools-sync.json");
			return JSON.parse(await (await fh.getFile()).text());
		});
	const writeSyncFile = (obj) =>
		sp.evaluate(async (obj) => {
			const root = await navigator.storage.getDirectory();
			const dir = await root.getDirectoryHandle("shared-drive-folder");
			const fh = await dir.getFileHandle("vinetools-sync.json", { create: true });
			const w = await fh.createWritable();
			await w.write(JSON.stringify(obj));
			await w.close();
		}, obj);
	const syncNowMsg = () => sp.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: "folderSync", reason: "manual" }, r)));
	const hiddenAsins = () => page.evaluate(() => [...document.querySelectorAll("#tab-hidden .vvp-item-tile input[data-asin]")].map((i) => i.dataset.asin).sort());

	await test("C3: a hide pulled from the folder shows up on the FIRST page load (lists reloaded after the pull)", async () => {
		const f = await readSyncFile();
		f.hiddenItems = { ...f.hiddenItems, B0TEST0002: Date.now() - 1000 };
		await writeSyncFile(f);
		await page.reload();
		await page.waitForSelector("#vh-status[data-status='productsUpdated']", { state: "attached" });
		await waitFor(async () => (await hiddenAsins()).includes("B0TEST0002"), 8000);
	});

	await test("C2: bulk 'Show all' sticks - the next sync does not re-hide the items", async () => {
		await page.locator(".vh-showall").first().evaluate((el) => el.click());
		await waitFor(async () => (await hiddenAsins()).length === 0, 8000);
		await page.waitForTimeout(800);
		const st = await storageGet(["hiddenItems", "syncTombstones"]);
		assert.deepEqual(Object.keys(st.hiddenItems || {}).filter((k) => k.startsWith("B0TEST")), []);
		assert.ok(st.syncTombstones?.hidden?.B0TEST0002 > 0, "no removal record for the bulk un-hide: " + JSON.stringify(st.syncTombstones));
		await syncNowMsg();
		await syncNowMsg();
		const after = await storageGet(["hiddenItems"]);
		assert.equal(after.hiddenItems?.B0TEST0002, undefined, "sync resurrected an un-hidden item");
		assert.equal((await readSyncFile()).hiddenItems.B0TEST0002, undefined);
	});

	await test("C2/I5: 'Delete all hidden items' is also propagated (file emptied, not restored)", async () => {
		await sw.evaluate(() => chrome.storage.local.set({ hiddenItems: { DEL_1: Date.now() - 10, DEL_2: Date.now() - 20 } }));
		await syncNowMsg();
		assert.ok((await readSyncFile()).hiddenItems.DEL_1);
		await sp.reload();
		await sp.waitForSelector("#tabs-index");
		await sp.locator("#tabs-index li", { hasText: "System" }).click();
		await sp.locator("#hiddenItemReset").click();
		await sp.locator("button", { hasText: /^OK$/ }).click();
		await waitFor(async () => Object.keys((await storageGet(["hiddenItems"])).hiddenItems || {}).length === 0, 5000);
		await syncNowMsg();
		await syncNowMsg();
		const f = await readSyncFile();
		assert.equal(f.hiddenItems.DEL_1, undefined, "shared file kept the deleted items");
		assert.equal((await storageGet(["hiddenItems"])).hiddenItems?.DEL_1, undefined, "sync restored the deleted items");
	});

	await test("C1: a fresh install adopts the shared file's settings instead of overwriting them with defaults", async () => {
		// simulate a second, brand-new computer: wipe local storage (keeps the folder handle in IndexedDB)
		const remoteStamp = Date.now() - 3600_000;
		const remoteSettings = JSON.parse(JSON.stringify((await readSyncFile()).settings));
		remoteSettings.general = { ...remoteSettings.general, hideKeywords: [{ contains: "REMOTE_KW", without: "", etv_min: "", etv_max: "" }], toolbarBackgroundColor: "#abcdef" };
		await writeSyncFile({ ...(await readSyncFile()), settings: remoteSettings, settingsModifiedAt: remoteStamp });
		await sw.evaluate(() => chrome.storage.local.clear());
		const fresh = await openVine(ctx, log); // first run: creates defaults, versionInfoPopup etc., then syncs on load
		await fresh.waitForSelector("#vh-status[data-status='productsUpdated']", { state: "attached" });
		await waitFor(async () => (await storageGet(["settings"])).settings?.general?.toolbarBackgroundColor === "#abcdef", 8000);
		let st = await storageGet(["settings", "settingsModifiedAt"]);
		assert.equal(st.settingsModifiedAt, remoteStamp, "timestamp must be the file's, not a first-run bump");
		assert.equal(st.settings.general.hideKeywords[0].contains, "REMOTE_KW");
		// opening the settings page and touching nothing must not bump it either
		const sp2 = await ctx.newPage();
		await sp2.goto(`chrome-extension://${extId}/page/settings.html`);
		await sp2.waitForSelector("#tabs-index");
		await sp2.waitForTimeout(1500);
		st = await storageGet(["settings", "settingsModifiedAt"]);
		assert.equal(st.settingsModifiedAt, remoteStamp, "opening the settings page bumped the timestamp");
		await sp2.close();
		await syncNowMsg();
		const file = await readSyncFile();
		assert.equal(file.settings.general.toolbarBackgroundColor, "#abcdef", "the shared file was overwritten with defaults");
		assert.equal(file.settingsModifiedAt, remoteStamp);
		await fresh.close();
	});

	await test("I1: the shared file never contains the tab encryption keys or legacy identity", async () => {
		await sw.evaluate(async () => {
			const { settings } = await chrome.storage.local.get("settings");
			settings.general.uuid = "legacy-uuid"; settings.general.fingerprint = { id: 1 };
			settings.crypto = { privateKey: { k: "secret" } };
			await chrome.storage.local.set({ settings, settingsModifiedAt: Date.now() });
		});
		await syncNowMsg();
		const raw = JSON.stringify(await readSyncFile());
		for (const bad of ["legacy-uuid", "secret", "\"crypto\"", "fingerprint"]) assert.ok(!raw.includes(bad), "shared file contains " + bad);
	});

	await ctx.close();
	const failed = results.filter((r) => !r[0]).length;
	console.log(`\n${results.length - failed}/${results.length} passed`);
	process.exit(failed ? 1 : 0);
})().catch((e) => {
	console.error(e);
	process.exit(2);
});
