// Runs the extension against a MOCK of api.vinehelper.ovh so that every call it would make
// actually fires; prints each action with the identity fields it carries.
const { launch, openVine, hosts } = require("./lib.cjs");
(async () => {
	const calls = [];
	const { ctx, log } = await launch({
		extraRoutes: async (route, url) => {
			if (!url.startsWith("https://api.vinehelper.ovh")) return false;
			const req = route.request();
			let body = {};
			try { body = JSON.parse(req.postData() || "{}"); } catch (e) {}
			calls.push(body);
			const reply = {
				get_uuid: { ok: "ok", uuid: "mock-uuid-0001" },
				upload_fingerprint: { ok: "ok", fingerprint_id: 7 },
				get_info: { ok: "ok", products: {}, current_time: new Date().toISOString().slice(0, 19).replace("T", " "), patreon_membership_tier: 0 },
			}[body.action] || { ok: "ok" };
			await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(reply) });
			return true;
		},
	});
	const page = await openVine(ctx, log);
	await page.waitForTimeout(8000);
	console.log("hosts:", hosts(log.requests.map((r) => r.url)));
	for (const c of calls) {
		const keys = Object.keys(c).filter((k) => !["api_version", "s", "pk"].includes(k));
		console.log(`- ${c.action}: ${keys.join(", ")}`);
		if (c.action === "get_info") console.log("    items:", JSON.stringify(c.items).slice(0, 300));
	}
	await ctx.close();
})().catch((e) => { console.error(e); process.exit(1); });
