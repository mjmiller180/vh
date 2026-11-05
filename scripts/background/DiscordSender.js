/**
 * Posts a webhook message to the user's Discord. Runs in the service worker.
 * The URL is validated here (not only in the page) because this is the trust boundary:
 * anything that can message the service worker could otherwise ask it to POST anywhere.
 */
import { validateWebhookUrl } from "../core/utils/WebhookUtil.js";

const MIN_SPACING_MS = 700; // Discord allows about 5 requests / 2 seconds per webhook
const MAX_RETRIES = 3;
const MAX_BODY_BYTES = 20000;

let chain = Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(url, body) {
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		let res;
		try {
			res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
		} catch (e) {
			return { ok: false, error: "network error: " + e.message };
		}
		if (res.status === 429) {
			let wait = 2000;
			try {
				const j = await res.json();
				if (typeof j.retry_after === "number") wait = Math.ceil(j.retry_after * 1000) + 100;
			} catch (e) {}
			await sleep(Math.min(wait, 15000));
			continue;
		}
		if (res.ok) return { ok: true, status: res.status };
		return { ok: false, status: res.status, error: `Discord answered HTTP ${res.status}` };
	}
	return { ok: false, error: "Discord rate limit: gave up after retries" };
}

/** Queue one message. Resolves with {ok, status?, error?}. Messages are sent one at a time. */
export function sendWebhook(url, body) {
	const check = validateWebhookUrl(url);
	if (!check.ok) return Promise.resolve({ ok: false, error: "Webhook URL rejected: " + check.reason });
	if (typeof body !== "string" || body.length === 0 || body.length > MAX_BODY_BYTES) {
		return Promise.resolve({ ok: false, error: "Message body missing or too large" });
	}
	try {
		JSON.parse(body);
	} catch (e) {
		return Promise.resolve({ ok: false, error: "Message body is not valid JSON" });
	}
	const p = chain.then(async () => {
		const r = await post(url.trim(), body);
		await sleep(MIN_SPACING_MS);
		return r;
	});
	chain = p.catch(() => {});
	return p;
}
