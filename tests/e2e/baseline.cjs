// Last compiled at 2026-11-04_2317
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
// Prints every outbound request the extension makes on a Vine page. Use it to confirm
// nothing besides Amazon (and the user's own webhook) is contacted.
const { launch, openVine, hosts } = require("./lib.cjs");

(async () => {
	const { ctx, log, extId } = await launch();
	console.log("extension id:", extId);
	const page = await openVine(ctx, log);
	await page.waitForTimeout(6000);
	console.log("tiles:", await page.locator(".vvp-item-tile").count());
	console.log("toolbars:", await page.locator(".vh-toolbar, .vh-tile-toolbar, [class*=vh-toolbar]").count());
	console.log("\nRequest hosts:", hosts(log.requests.map((r) => r.url)));
	const actions = {};
	for (const r of log.requests) {
		try {
			const a = JSON.parse(r.body || "{}").action;
			if (a) actions[a] = (actions[a] || 0) + 1;
		} catch (e) {}
	}
	console.log("API actions:", actions);
	console.log("console errors:", log.consoleErrors.length, "page errors:", log.pageErrors.length);
	for (const e of log.pageErrors.slice(0, 5)) console.log("  pageerror:", e.slice(0, 200));
	await ctx.close();
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
