// Last compiled at 2026-11-05_0123
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
// Shared helpers for the end-to-end tests.
// Loads the unpacked extension in Chromium, serves a fixture Vine page for
// https://www.amazon.com/vine/*, blocks every other outbound request and records them all.
const path = require("path");
const fs = require("fs");
const os = require("os");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../..");
const FIXTURE = fs.readFileSync(path.join(__dirname, "fixture-vine.html"), "utf8");

// Let Playwright report network traffic from extension service workers too.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

async function launch({ extraRoutes, pageRenderer } = {}) {
	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vh-e2e-"));
	const ctx = await chromium.launchPersistentContext(userDataDir, {
		headless: false,
		args: [
			"--headless=new",
			`--disable-extensions-except=${ROOT}`,
			`--load-extension=${ROOT}`,
			"--no-sandbox",
		],
	});

	const log = { requests: [], blocked: [], consoleErrors: [], pageErrors: [] };

	ctx.on("request", (r) => {
		const u = r.url();
		if (u.startsWith("chrome-extension://") || u.startsWith("data:") || u.startsWith("blob:")) return;
		log.requests.push({ method: r.method(), url: u, body: r.postData() });
	});

	await ctx.route("**/*", async (route) => {
		const url = route.request().url();
		if (url.startsWith("chrome-extension://") || url.startsWith("data:")) return route.continue();
		if (extraRoutes) {
			const handled = await extraRoutes(route, url);
			if (handled) return;
		}
		if (/^https:\/\/www\.amazon\.com\/vine\//.test(url) && ["document", "fetch", "xhr"].includes(route.request().resourceType())) {
			return route.fulfill({ status: 200, contentType: "text/html", body: pageRenderer ? pageRenderer(url) : FIXTURE });
		}
		log.blocked.push(url);
		return route.abort("blockedbyclient");
	});

	let sw = ctx.serviceWorkers()[0];
	if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 }).catch(() => null);
	const extId = sw ? new URL(sw.url()).host : null;
	return { ctx, log, extId, sw, userDataDir };
}

async function openVine(ctx, log, query = "?queue=potluck") {
	const page = await ctx.newPage();
	page.on("console", (m) => {
		if (m.type() === "error") log.consoleErrors.push(m.text());
	});
	page.on("pageerror", (e) => log.pageErrors.push(String(e)));
	await page.goto("https://www.amazon.com/vine/vine-items" + query, { waitUntil: "load" });
	return page;
}

function hosts(urls) {
	const set = new Map();
	for (const u of urls) {
		try {
			const h = new URL(u).host;
			set.set(h, (set.get(h) || 0) + 1);
		} catch (e) {}
	}
	return Object.fromEntries(set);
}

module.exports = { launch, openVine, hosts, ROOT };
