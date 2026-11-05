// Last compiled at 2026-11-05_0138
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
// Review form tools end to end: a stand-in for Amazon's create-review form (same ids / test ids), the real extension,
// real keyboard / clipboard / drag events.
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { launch } = require("./lib.cjs");

const FORM = fs.readFileSync(path.join(__dirname, "fixtures", "review-form.html"), "utf8");
const render = () => FORM;
// 1x1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

// ---- fake Google Drive (list, thumbnail, file) behind the route mock
const driveLog = [];
const DRIVE_BYTES = PNG;
function driveRoute(route, url) {
	const u = new URL(url);
	const json = (o) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(o) });
	driveLog.push(u.host + u.pathname + (u.searchParams.get("q") ? " q=" + u.searchParams.get("q") : "") + (u.searchParams.get("alt") ? " alt=" + u.searchParams.get("alt") : ""));
	if (u.host === "lh3.googleusercontent.com") return route.fulfill({ status: 200, contentType: "image/png", body: DRIVE_BYTES });
	if (u.pathname === "/drive/v3/files") {
		const q = u.searchParams.get("q") || "";
		if (q.includes("'1FolderAAAAAA' in parents")) return json({ files: [{ id: "photoInFolder1", name: "order-folder-pic.png", mimeType: "image/png", size: String(PNG.length), thumbnailLink: "https://lh3.googleusercontent.com/in=s220" }] });
		if (q.includes("name contains 'tire'")) return json({ files: [{ id: "photoSearch001", name: "tire-front.png", mimeType: "image/png", size: String(PNG.length) }] });
		return json({
			files: [
				{ id: "1FolderAAAAAA", name: "<b>Order 111-1000001</b>", mimeType: "application/vnd.google-apps.folder" },
				{ id: "photoRecent001", name: "20261025_155816.png", mimeType: "image/png", size: String(PNG.length), thumbnailLink: "https://lh3.googleusercontent.com/r1=s220" },
				{ id: "photoRecent002", name: "20261025_155829.png", mimeType: "image/png", size: String(PNG.length), thumbnailLink: "https://lh3.googleusercontent.com/r2=s220" },
			],
		});
	}
	const m = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
	if (m && u.searchParams.get("alt") === "media") return route.fulfill({ status: 200, contentType: "image/png", body: DRIVE_BYTES });
	if (m && m[1] === "1FolderAAAAAA") return json({ id: m[1], name: "Order 111-1000001" });
	if (m) return json({ id: m[1], name: m[1] + ".png", mimeType: "image/png", size: String(PNG.length) });
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
	const sheetMessages = [];
	const { ctx, log, sw } = await launch({
		pageRenderer: render,
		extraRoutes: async (route, url) => {
			if (/^https:\/\/(www\.googleapis\.com\/drive\/|lh3\.googleusercontent\.com\/)/.test(url)) {
				await driveRoute(route, url);
				return true;
			}
			return false;
		},
	});
	await sw.evaluate(() => {
		self.__msgs = [];
		chrome.runtime.onMessage.addListener((m) => {
			if (m && m.type === "googleUpdateReviews") self.__msgs.push(m); // record only; never answers
		});
	});
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
	const open = async (asin = "B0HCVX7XDG") => {
		const page = await ctx.newPage();
		page.on("dialog", (d) => (page.__dialog ? page.__dialog(d) : d.accept()));
		await page.goto(`https://www.amazon.com/review/create-review?encoding=UTF&channel=vine-portal&asin=${asin}`, { waitUntil: "load" });
		await page.waitForSelector('[data-vt="toolbar"]', { timeout: 20000 });
		return page;
	};
	const selectAll = (page, id) => page.evaluate((id) => { const t = document.getElementById(id); t.focus(); t.setSelectionRange(0, t.value.length); }, id);
	const val = (page, id) => page.evaluate((id) => document.getElementById(id).value, id);
	const btn = (page, title) => page.locator(`[data-vt="toolbar"] button[title="${title}"]`);

	await waitFor(async () => (await sw.evaluate(() => chrome.storage.local.get("settings"))).settings);
	console.log("\nReview form tools");
	await test("toolbar appears on the form; Bold turns the selection into bold letters and the page is told (input event)", async () => {
		const page = await open();
		await page.locator("#reviewText").fill("Great product");
		await selectAll(page, "reviewText");
		await btn(page, "Bold").click();
		assert.equal(await val(page, "reviewText"), "𝗚𝗿𝗲𝗮𝘁 𝗽𝗿𝗼𝗱𝘂𝗰𝘁");
		assert.equal((await page.evaluate(() => window.__reactSeen.at(-1)))[1], "𝗚𝗿𝗲𝗮𝘁 𝗽𝗿𝗼𝗱𝘂𝗰𝘁");
		await btn(page, "Bold").click();
		assert.equal(await val(page, "reviewText"), "Great product", "second click removes it");
		await page.close();
	});

	await test("only the selected part is styled; lists work on the current line; Tx clears", async () => {
		const page = await open();
		await page.locator("#reviewText").fill("Good battery life\nSolid build");
		await page.evaluate(() => { const t = document.getElementById("reviewText"); t.focus(); t.setSelectionRange(0, 4); });
		await btn(page, "Italic").click();
		assert.equal(await val(page, "reviewText"), "𝘎𝘰𝘰𝘥 battery life\nSolid build");
		await page.evaluate(() => { const t = document.getElementById("reviewText"); t.focus(); t.setSelectionRange(26, 26); }); // caret in line 2 (the styled letters take two UTF-16 units each)
		await btn(page, "Bullet list").click();
		assert.equal(await val(page, "reviewText"), "𝘎𝘰𝘰𝘥 battery life\n● Solid build");
		await selectAll(page, "reviewText");
		await btn(page, "Clear all styling and list marks from the selection").click();
		assert.equal(await val(page, "reviewText"), "Good battery life\nSolid build");
		await btn(page, "Numbered list").click();
		assert.equal(await val(page, "reviewText"), "1) Good battery life\n2) Solid build");
		await page.close();
	});

	await test("with nothing selected a style button says so instead of changing the text", async () => {
		const page = await open();
		await page.locator("#reviewText").fill("abc");
		await page.evaluate(() => { const t = document.getElementById("reviewText"); t.focus(); t.setSelectionRange(1, 1); });
		await btn(page, "Bold").click();
		assert.equal(await val(page, "reviewText"), "abc");
		assert.match(await page.locator(".vt-status").textContent(), /Select some text/);
		await page.close();
	});

	await test("phrases and templates: save, insert, rename, delete (kept in the browser)", async () => {
		const page = await open();
		page.__dialog = (d) => (d.type() === "prompt" ? d.accept("My phrase") : d.accept());
		await page.locator("#reviewText").fill("Works as described.");
		await selectAll(page, "reviewText");
		await btn(page, "Save the selection as a phrase").click();
		await waitFor(async () => (await page.locator('select[title="Insert phrase…"] option').count()) === 2);
		await page.locator("#reviewText").fill("");
		await page.locator('select[title="Insert phrase…"]').selectOption({ label: "My phrase" });
		assert.equal(await val(page, "reviewText"), "Works as described.");
		page.__dialog = (d) => (d.type() === "prompt" ? d.accept("Intro") : d.accept());
		await page.locator("#reviewText").fill("Thanks to Vine for this item.\nHere is my review:");
		await btn(page, "Save the whole text (or the selection) as a template").click();
		await waitFor(async () => (await page.locator('select[title="Insert template…"] option').count()) === 2);
		await page.reload();
		await page.waitForSelector('[data-vt="toolbar"]');
		await page.locator("#reviewText").fill("");
		await page.locator('select[title="Insert template…"]').selectOption({ label: "Intro" });
		assert.equal(await val(page, "reviewText"), "Thanks to Vine for this item.\nHere is my review:", "survives a reload");
		// manage: rename then delete
		page.__dialog = (d) => (d.type() === "prompt" ? d.accept("Renamed") : d.accept());
		await btn(page, "Rename or delete phrases and templates").click();
		const rowNamed = (n) => page.locator(".vt-row").filter({ has: page.locator(".vt-name", { hasText: new RegExp(`^${n}$`) }) });
		await rowNamed("My phrase").getByRole("button", { name: "Rename", exact: true }).click();
		await rowNamed("Renamed").waitFor();
		await rowNamed("Renamed").getByRole("button", { name: "Delete" }).click();
		await waitFor(async () => (await rowNamed("Renamed").count()) === 0);
		assert.equal(await rowNamed("Intro").count(), 1, "the other item is untouched");
		await page.close();
	});

	await test("a saved name containing HTML is shown as text, never as markup", async () => {
		const page = await open();
		await sw.evaluate(() => chrome.storage.local.set({ "vt.review.phrases": [{ id: "x1", name: '<img src=x onerror="window.__pwn=1">', text: "<b>t</b>" }] }));
		await page.reload();
		await page.waitForSelector('[data-vt="toolbar"]');
		await page.locator('select[title="Insert phrase…"]').selectOption({ index: 1 });
		assert.equal(await val(page, "reviewText"), "<b>t</b>");
		assert.equal(await page.evaluate(() => window.__pwn), undefined);
		assert.equal(await page.locator("[data-vt=toolbar] img").count(), 0);
		await sw.evaluate(() => chrome.storage.local.remove("vt.review.phrases"));
		await page.close();
	});

	await test("autosave: title and text are saved per product and come back after a reload; other products are separate", async () => {
		const page = await open("B0AUTOSAV1");
		await page.locator("#reviewTitle").fill("Solid little gadget");
		await page.locator("#reviewText").fill("Draft body text");
		await waitFor(async () => /Draft saved/.test(await page.locator(".vt-status").textContent()));
		await page.reload();
		await page.waitForSelector('[data-vt="toolbar"]');
		await waitFor(async () => (await val(page, "reviewText")) === "Draft body text");
		assert.equal(await val(page, "reviewTitle"), "Solid little gadget");
		assert.equal((await page.evaluate(() => window.__reactSeen.at(-1)))[0], "reviewTitle", "restoring goes through input events so the page sees it");
		const other = await open("B0AUTOSAV2");
		await other.waitForTimeout(800);
		assert.equal(await val(other, "reviewText"), "");
		await other.close();
		await page.close();
	});

	await test("Submit: the draft is kept but not auto-restored again, and the rating, date and status go to the sheet", async () => {
		const page = await open("B0SUBMIT01");
		await page.locator("[role=radio]").nth(3).click(); // 4 stars
		await page.locator("#reviewTitle").fill("Good value");
		await page.locator("#reviewText").fill("It does the job.");
		await page.locator("input[type=submit]").click();
		await waitFor(async () => (await sw.evaluate(() => self.__msgs.length)) === 1);
		const m = (await sw.evaluate(() => self.__msgs))[0];
		assert.deepEqual(m.reviews[0], { asin: "B0SUBMIT01", status: "Pending approval", score: "Pending", starRating: 4, reviewDate: m.reviews[0].reviewDate });
		assert.match(m.reviews[0].reviewDate, /^\d{4}-\d{2}-\d{2}$/);
		await page.reload();
		await page.waitForSelector('[data-vt="toolbar"]');
		await page.waitForTimeout(500);
		assert.equal(await val(page, "reviewText"), "", "a submitted draft is not put back on its own");
		await page.locator('[data-vt="toolbar"] button', { hasText: "Restore draft" }).click();
		assert.equal(await val(page, "reviewText"), "It does the job.");
		await page.close();
	});

	await test("Submit with the title missing records nothing", async () => {
		const before = await sw.evaluate(() => self.__msgs.length);
		const page = await open("B0SUBMIT02");
		await page.locator("[role=radio]").nth(4).click();
		await page.locator("#reviewText").fill("text but no title");
		await page.locator("input[type=submit]").click();
		await page.waitForTimeout(1000);
		assert.equal(await sw.evaluate(() => self.__msgs.length), before);
		await page.close();
	});

	await test("pictures: pasted image and dropped files reach Amazon's upload input one by one; non-images are refused", async () => {
		const page = await open();
		const dropOne = (name, type) =>
			page.evaluate(async ({ name, type, b64 }) => {
				const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
				const dt = new DataTransfer();
				dt.items.add(new File([bytes], name, { type }));
				const zone = document.querySelector(".in-context-ryp__form-field--mediaUploadInput");
				zone.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
				zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
			}, { name, type, b64: PNG.toString("base64") });
		await dropOne("one.png", "image/png");
		await waitFor(() => page.evaluate(() => window.__uploads.length === 1));
		await dropOne("notes.txt", "text/plain");
		await page.waitForTimeout(500);
		assert.equal(await page.evaluate(() => window.__uploads.length), 1, "a text file is not uploaded");
		// paste event with an image
		await page.evaluate(async (b64) => {
			const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
			const dt = new DataTransfer();
			dt.items.add(new File([bytes], "shot.png", { type: "image/png" }));
			document.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
		}, PNG.toString("base64"));
		await waitFor(() => page.evaluate(() => window.__uploads.length === 2));
		const up = await page.evaluate(() => window.__uploads);
		assert.deepEqual(up.map((u) => u[0]), ["one.png", "shot.png"]);
		assert.equal(up[0][2], PNG.length);
		await page.close();
	});

	const enableDrive = (on, folder = "") =>
		sw.evaluate(async ({ on, folder }) => {
			chrome.identity.getAuthToken = (opts, cb) => cb("fake-token"); // Chrome sign-in stub
			const { settings } = await chrome.storage.local.get("settings");
			settings.google = { ...(settings.google || {}), drive: { enabled: on, folder } };
			await chrome.storage.local.set({ settings, settingsModifiedAt: Date.now() });
		}, { on, folder });

	await test("Drive picker is not offered while the Drive switch is off", async () => {
		await enableDrive(false);
		const page = await open();
		assert.equal(await page.getByRole("button", { name: "Add from Google Drive…" }).count(), 0);
		assert.deepEqual(driveLog, [], "nothing reached Google");
		await page.close();
	});

	await test("Drive picker: newest pictures with previews, tick two, they arrive in Amazon's upload input; names with HTML stay text", async () => {
		await enableDrive(true);
		const page = await open();
		await page.getByRole("button", { name: "Add from Google Drive…" }).click();
		await page.locator(".vtd-item", { hasText: "20261025_155816.png" }).waitFor();
		assert.equal(await page.locator(".vtd-name img, .vtd-grid b").count(), 0, "a folder name with <b> is shown as text");
		await waitFor(() => page.evaluate(() => [...document.querySelectorAll(".vtd-item img")].filter((i) => i.src.startsWith("data:image/png")).length === 2));
		await page.locator(".vtd-item", { hasText: "20261025_155816.png" }).click();
		await page.locator(".vtd-item", { hasText: "20261025_155829.png" }).click();
		assert.equal(await page.getByRole("button", { name: "Add 2 pictures" }).count(), 1);
		await page.getByRole("button", { name: "Add 2 pictures" }).click();
		await waitFor(() => page.evaluate(() => window.__uploads.length === 2), 20000);
		const up = await page.evaluate(() => window.__uploads);
		assert.deepEqual(up.map((u) => [u[0], u[1], u[2]]), [["photoRecent001.png", "image/png", PNG.length], ["photoRecent002.png", "image/png", PNG.length]]);
		assert.equal(await page.locator(".vtd-modal").count(), 0, "the window closes");
		await page.close();
	});

	await test("Drive picker: open a folder, go Up, search by name", async () => {
		await enableDrive(true);
		const page = await open();
		await page.getByRole("button", { name: "Add from Google Drive…" }).click();
		await page.locator(".vtd-item", { hasText: "Order 111-1000001" }).click();
		await page.locator(".vtd-item", { hasText: "order-folder-pic.png" }).waitFor();
		assert.match(await page.locator(".vtd-bar strong").textContent(), /Order 111-1000001/);
		await page.getByRole("button", { name: "↑ Up" }).click();
		await page.locator(".vtd-item", { hasText: "20261025_155816.png" }).waitFor();
		await page.locator(".vtd-bar input[type=search]").fill("tire");
		await page.locator(".vtd-bar input[type=search]").press("Enter");
		await page.locator(".vtd-item", { hasText: "tire-front.png" }).waitFor();
		assert.equal(await page.locator(".vtd-item").count(), 1);
		await page.close();
	});

	await test("Drive picker: without a Chrome sign-in it explains instead of failing silently", async () => {
		await enableDrive(true);
		await sw.evaluate(() => { chrome.identity.getAuthToken = (opts, cb) => { chrome.runtime.lastError; cb(undefined); }; });
		const page = await open();
		await page.getByRole("button", { name: "Add from Google Drive…" }).click();
		await waitFor(async () => /Sign in to Google first/.test(await page.locator(".vtd-msg").textContent()), 25000);
		await page.close();
		await sw.evaluate(() => { chrome.identity.getAuthToken = (opts, cb) => cb("fake-token"); });
	});

	await test("with the tools switched off in settings nothing is added to the page", async () => {
		await sw.evaluate(async () => {
			const { settings } = await chrome.storage.local.get("settings");
			settings.reviewTools = { enabled: false };
			await chrome.storage.local.set({ settings });
		});
		const page = await ctx.newPage();
		await page.goto("https://www.amazon.com/review/create-review?asin=B0HCVX7XDG");
		await page.waitForTimeout(2500);
		assert.equal(await page.locator('[data-vt="toolbar"]').count(), 0);
		await page.close();
		await sw.evaluate(async () => {
			const { settings } = await chrome.storage.local.get("settings");
			settings.reviewTools = { enabled: true };
			await chrome.storage.local.set({ settings });
		});
	});

	const hosts = new Set(log.requests.map((r) => new URL(r.url).host));
	assert.deepEqual([...hosts].filter((h) => !/^(www\.amazon\.com|www\.googleapis\.com|lh3\.googleusercontent\.com)$/.test(h)), [], "only Amazon and (when Drive pictures are on) Google Drive");
	assert.ok(driveLog.every((l) => !/ (POST|PUT|PATCH|DELETE)/.test(l)), "Drive is read only");
	await ctx.close();
	const failed = results.filter((r) => !r).length;
	console.log(`\n${results.length - failed}/${results.length} passed`);
	process.exit(failed ? 1 : 0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
