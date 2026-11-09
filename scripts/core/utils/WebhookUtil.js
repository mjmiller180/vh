// Last compiled at 2026-11-04_2317
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/**
 * Pure helpers for the Discord webhooks (no chrome.* / DOM access: unit tested in Node).
 */

// Only Discord webhooks are allowed. This is also what the manifest CSP / host permissions allow,
// so the extension has no way to talk to any other non-Amazon host.
const DISCORD_HOSTS = ["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"];

export const DEFAULT_TEMPLATE = `{
"content": "New item in $QUEUE_NAME!",
"embeds": [{
	"title": "$TITLE",
	"url": "$VH_URL",
	"thumbnail":  {
		"url": "$IMG_URL"
	}
}]
}`;

export const WEBHOOK_TYPES = {
	keyword: { settingKey: "KWsMatch", label: "Keyword match" },
	afa: { settingKey: "AFA", label: "New item in AFA" },
	rfy: { settingKey: "RFY", label: "New item in RFY" },
	zeroETV: { settingKey: "zeroETV", label: "Zero ETV" },
	manual: { settingKey: "manual", label: "Manual button" },
};

/** @returns {{ok: boolean, reason?: string}} */
export function validateWebhookUrl(url) {
	if (typeof url !== "string" || url.trim() === "") return { ok: false, reason: "empty" };
	let u;
	try {
		u = new URL(url.trim());
	} catch (e) {
		return { ok: false, reason: "not a valid URL" };
	}
	if (u.protocol !== "https:") return { ok: false, reason: "must be https" };
	if (u.username || u.password) return { ok: false, reason: "no credentials allowed in the URL" };
	const host = u.hostname.toLowerCase();
	const hostOk = DISCORD_HOSTS.includes(host); //exact names only: no other subdomains
	if (!hostOk) return { ok: false, reason: "only discord.com webhooks are supported" };
	if (!/^\/api(\/v\d+)?\/webhooks\/\d+\/[\w-]+\/?$/.test(u.pathname)) {
		return { ok: false, reason: "not a Discord webhook URL (/api/webhooks/<id>/<token>)" };
	}
	return { ok: true };
}

// Escape a value so it can be dropped inside a JSON string literal.
const jsonEscape = (v) => JSON.stringify(String(v ?? "")).slice(1, -1);

/**
 * Replace $PLACEHOLDERS in a JSON template with JSON-escaped values.
 * (The legacy code pasted raw text in, so a title containing a quote produced invalid JSON.)
 * @returns {{ok: true, body: string} | {ok: false, error: string}}
 */
export function renderTemplate(template, vars) {
	const v = { ...vars };
	if (v.TITLE) v.TITLE = String(v.TITLE).slice(0, 250); // Discord embed title limit is 256
	let body = String(template ?? "");
	const names = Object.keys(v).sort((a, b) => b.length - a.length);
	for (const name of names) {
		body = body.split("$" + name).join(jsonEscape(v[name]));
	}
	try {
		JSON.parse(body);
	} catch (e) {
		return { ok: false, error: "Message template is not valid JSON: " + e.message };
	}
	return { ok: true, body };
}

/** Key used to remember that something was already sent (so reloading the page does not re-send). */
export function dedupeKey(type, asin) {
	return `${type}:${asin}`;
}

/** Drop entries older than maxAgeMs. Returns a new object. */
export function pruneSent(sent, now, maxAgeMs) {
	const out = {};
	for (const [k, ts] of Object.entries(sent || {})) {
		if (now - ts <= maxAgeMs) out[k] = ts;
	}
	return out;
}

/**
 * Product titles come from sellers: a title containing @everyone would ping the whole channel. Unless the
 * user's template says otherwise, tell Discord not to parse any mentions.
 * @param {string} body valid JSON
 * @returns {string} JSON
 */
export function withSafeMentions(body) {
	const obj = JSON.parse(body);
	if (obj && typeof obj === "object" && !Array.isArray(obj) && !("allowed_mentions" in obj)) {
		obj.allowed_mentions = { parse: [] };
		return JSON.stringify(obj);
	}
	return body;
}
