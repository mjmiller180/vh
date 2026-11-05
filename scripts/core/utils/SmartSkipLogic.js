// Last compiled at 2026-11-05_0049
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/**
 * SmartSkip decision logic (pure: no DOM, no chrome.*, unit tested in Node).
 * SmartSkip pages through a Vine queue on a timer and stops at the first page that has an item you have not
 * pinned (and that was not already hidden). The state lives in sessionStorage, i.e. per tab.
 */

export const MIN_DELAY_MS = 2000; // never page faster than this, whatever the settings say
export const STATUSES = ["running", "paused", "braked", "found"];
const QUEUES = ["encore", "potluck", "last_chance", "all_items"];

const toNum = (v) => {
	const n = typeof v === "number" ? v : parseFloat(v);
	return Number.isFinite(n) ? n : NaN;
};

/** Delay range from (possibly string / missing) settings: numbers, >= MIN_DELAY_MS, max >= min. */
export function clampRange(min, max, defaults) {
	let lo = toNum(min);
	let hi = toNum(max);
	if (Number.isNaN(lo)) lo = defaults.min;
	if (Number.isNaN(hi)) hi = defaults.max;
	lo = Math.max(MIN_DELAY_MS, Math.round(lo));
	hi = Math.max(lo, Math.round(hi));
	return { min: lo, max: hi };
}

/** Random delay in [min, max] ms. */
export function pickDelay({ min, max }, rnd = Math.random) {
	return Math.floor(rnd() * (max - min + 1)) + min;
}

export function formatDuration(ms) {
	if (!(ms > 0)) return "0s";
	const total = Math.floor(ms / 1000);
	const m = Math.floor(total / 60);
	const s = total % 60;
	return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export const DEFAULT_MAX_PAGES = 300;
export const HARD_MAX_PAGES = 1000;

/** Page limit from a free-text setting: a blank / non-numeric / <1 value means the default, never "no limit". */
export function normaliseMaxPages(v) {
	const n = toNum(v);
	if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_PAGES;
	return Math.min(HARD_MAX_PAGES, Math.floor(n));
}

/**
 * What to do with the page that was just scanned (`seen` includes this page).
 *  found: an unpinned item is here (reported even on the last allowed page)
 *  limit: nothing new and this was the last page we are allowed to scan ("stop after N pages" = N pages)
 *  skip:  nothing new, keep going
 * @returns {"found" | "skip" | "limit"}
 */
export function decidePage({ unpinnedCount, seen, maxPages }) {
	if (unpinnedCount > 0) return "found";
	return seen >= normaliseMaxPages(maxPages) ? "limit" : "skip";
}

export function newSession(now = Date.now()) {
	return { status: "running", seen: 0, skips: 0, found: 0, consecutive: 0, startedAt: now };
}

const cleanInt = (v, max = 1e9) => {
	const n = toNum(v);
	return Number.isFinite(n) && n >= 0 && n < max ? Math.floor(n) : 0;
};

/** Read the stored session defensively (the page's own scripts can write sessionStorage too). */
export function parseState(json) {
	if (typeof json !== "string") return null;
	let o;
	try {
		o = JSON.parse(json);
	} catch (e) {
		return null;
	}
	if (!o || typeof o !== "object" || !STATUSES.includes(o.status)) return null;
	return {
		status: o.status,
		seen: cleanInt(o.seen),
		skips: cleanInt(o.skips),
		found: cleanInt(o.found),
		consecutive: cleanInt(o.consecutive),
		startedAt: cleanInt(o.startedAt, 1e14), //epoch milliseconds
	};
}

/** Case-insensitive key match; "Space" (any case) means the space bar; an empty binding never matches. */
export function keyMatches(eventKey, binding) {
	if (typeof eventKey !== "string" || typeof binding !== "string" || eventKey === "" || binding === "") return false;
	const norm = (k) => (k.toLowerCase() === "space" ? " " : k.toLowerCase());
	return norm(eventKey) === norm(binding);
}

/** The page SmartSkip starts from. Marketplace TLD and queue are whitelisted/sanitised. */
export function startUrl(tld, queue) {
	const safeTld = /^[a-z]{2,3}(\.[a-z]{2,3})?$/.test(String(tld)) ? tld : "com";
	const safeQueue = QUEUES.includes(queue) ? queue : "encore";
	return `https://www.amazon.${safeTld}/vine/vine-items?queue=${safeQueue}&pn=&cn=&page=1`;
}
