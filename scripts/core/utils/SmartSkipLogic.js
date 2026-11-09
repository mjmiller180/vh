// Last compiled at 2026-11-09_1130
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

/** Patrol: loop over a fixed range of pages again and again, looking for items that were not there last lap. */
export const DEFAULT_PATROL = { start: 1, last: 25 };
export const DEFAULT_JUMP_PAGES = [100, 200, 300];

const pageNumber = (v, fallback) => {
	const n = toNum(v);
	return Number.isFinite(n) && n >= 1 ? Math.min(HARD_MAX_PAGES, Math.floor(n)) : fallback;
};

/** Patrol range from free-text settings: 1 <= start <= last <= HARD_MAX_PAGES; blanks / junk mean the defaults. */
export function normalisePatrol(start, last) {
	const s = pageNumber(start, DEFAULT_PATROL.start);
	const l = Math.max(s, pageNumber(last, Math.max(s, DEFAULT_PATROL.last)));
	return { start: s, last: l };
}

/** Page a jump key opens (blank / junk -> that key's default). */
export function normaliseJumpPage(v, fallback = 1) {
	return pageNumber(v, fallback);
}

/** Page number of a Vine list address (no / bad `page` means 1). */
export function pageOfUrl(href) {
	try {
		return pageNumber(new URL(href, "https://www.amazon.com").searchParams.get("page"), 1);
	} catch (e) {
		return 1;
	}
}

/** The same address with another page number (queue, category and search stay). */
export function urlWithPage(href, page) {
	const u = new URL(href, "https://www.amazon.com");
	u.searchParams.set("page", String(pageNumber(page, 1)));
	return u.toString();
}

/**
 * After a page with nothing new in a patrol: turn the page ("next") or start the next lap ("lap").
 * A lap ends at the last page of the range, or earlier when the queue itself has no next page.
 */
export function patrolAction({ patrolLast }, currentPage, hasNext) {
	return currentPage >= patrolLast || !hasNext ? "lap" : "next";
}

export function newSession(now = Date.now(), { patrol = false, patrolStart, patrolLast } = {}) {
	const range = normalisePatrol(patrolStart, patrolLast);
	return { status: "running", seen: 0, skips: 0, found: 0, consecutive: 0, startedAt: now, patrol: !!patrol, laps: 1, lastFound: "", patrolStart: range.start, patrolLast: range.last };
}

const cleanInt = (v, max = 1e9) => {
	const n = toNum(v);
	return Number.isFinite(n) && n >= 0 && n < max ? Math.floor(n) : 0;
};

function normalisePatrolState(o) {
	const r = normalisePatrol(o.patrolStart, o.patrolLast);
	return { patrolStart: r.start, patrolLast: r.last };
}

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
		patrol: o.patrol === true,
		laps: Math.max(1, cleanInt(o.laps)),
		lastFound: typeof o.lastFound === "string" && /^[A-Z0-9]{4,12}$/i.test(o.lastFound) ? o.lastFound.toUpperCase() : "",
		...normalisePatrolState(o),
	};
}

/** Case-insensitive key match; "Space" (any case) means the space bar; an empty binding never matches. */
export function keyMatches(eventKey, binding) {
	if (typeof eventKey !== "string" || typeof binding !== "string" || eventKey === "" || binding === "") return false;
	const norm = (k) => (k.toLowerCase() === "space" ? " " : k.toLowerCase());
	return norm(eventKey) === norm(binding);
}

/** The page SmartSkip starts from. Marketplace TLD and queue are whitelisted/sanitised. */
export function startUrl(tld, queue, page = 1) {
	const safeTld = /^[a-z]{2,3}(\.[a-z]{2,3})?$/.test(String(tld)) ? tld : "com";
	const safeQueue = QUEUES.includes(queue) ? queue : "encore";
	return `https://www.amazon.${safeTld}/vine/vine-items?queue=${safeQueue}&pn=&cn=&page=${pageNumber(page, 1)}`;
}
