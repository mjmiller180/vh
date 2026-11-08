// Last compiled at 2026-11-07_2157
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/**
 * Saved Vine searches (pure logic, unit tested in Node).
 * A saved search is a relative address such as "/vine/vine-items?search=dog&queue=encore". Only the search text and the
 * queue / category parameters are kept (not the page number), in a fixed order, so the same search is always the
 * same string.
 */
export const MAX_SAVED = 14;
const KEEP = ["queue", "pn", "cn"];
const ITEMS_PATH = /^((?:\/[A-Za-z0-9_-]+)*)\/vine\/vine-items\/?$/;
// what a stored entry must look like before it is ever used as a link
const ENTRY_RE = /^(?:\/[A-Za-z0-9_-]+)*\/vine\/vine-items\?search=[^\s<>"'\\]{1,150}(?:&(?:queue|pn|cn)=[^\s<>"'&\\]*)*$/;
const QUEUE_NAMES = { potluck: "RFY", last_chance: "AFA", encore: "AI", all_items: "ALL" };

/**
 * The canonical saved-search address for a Vine page, or null when it is not a Vine items page or has no search text.
 * @param {string} href  the page address (absolute or relative)
 * @param {string=} term search text typed in the box: used instead of the address's own `search`
 */
export function buildSearchUrl(href, term) {
	let u;
	try {
		u = new URL(href, "https://www.amazon.com");
	} catch (e) {
		return null;
	}
	const m = u.pathname.match(ITEMS_PATH);
	if (!m) return null;
	const search = String(term ?? u.searchParams.get("search") ?? "").trim().slice(0, 50); // Amazon's box allows 50
	if (!search) return null;
	const parts = [`search=${encodeURIComponent(search)}`];
	for (const k of KEEP) {
		const v = u.searchParams.get(k);
		if (v) parts.push(`${k}=${encodeURIComponent(v)}`);
	}
	return `${m[1]}/vine/vine-items?${parts.join("&")}`;
}

/** Only well-formed entries (they come from storage, which a sync can fill from another computer). Duplicates dropped. */
export function sanitiseList(list) {
	if (!Array.isArray(list)) return [];
	const seen = new Set();
	const out = [];
	for (const e of list) {
		if (typeof e !== "string" || e.length > 400 || !ENTRY_RE.test(e)) continue;
		const k = e.toLowerCase();
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(e);
	}
	return out;
}

export const findSaved = (list, url) => (url ? sanitiseList(list).find((e) => e.toLowerCase() === url.toLowerCase()) ?? null : null);

/** @returns {{ok: true, list: string[]} | {ok: false, reason: "full"|"invalid"|"exists"}} */
export function addSaved(list, url, max = MAX_SAVED) {
	const clean = sanitiseList(list);
	if (!url || !ENTRY_RE.test(url)) return { ok: false, reason: "invalid" };
	if (findSaved(clean, url)) return { ok: false, reason: "exists" };
	if (clean.length >= max) return { ok: false, reason: "full" };
	return { ok: true, list: [...clean, url] };
}

export function removeSaved(list, url) {
	return sanitiseList(list).filter((e) => e.toLowerCase() !== String(url ?? "").toLowerCase());
}

/** Text of a chip: the search text, plus the queue when the search was limited to one: "dog [AI]". */
export function labelFor(url) {
	try {
		const u = new URL(url, "https://www.amazon.com");
		const s = u.searchParams.get("search") || "";
		const q = QUEUE_NAMES[u.searchParams.get("queue")];
		return q ? `${s} [${q}]` : s;
	} catch (e) {
		return "";
	}
}
