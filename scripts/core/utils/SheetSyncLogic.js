// Last compiled at 2026-11-05_0123
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/** Pure helpers for SheetSync (unit tested in Node). */

/** Which list page the URL is: "orders", "reviews" or null. Works for every marketplace. */
export function pageKind(pathname) {
	const p = String(pathname || "").replace(/\/+$/, "");
	if (/\/vine\/orders$/.test(p)) return "orders";
	if (/\/vine\/vine-reviews$/.test(p)) return "reviews";
	return null;
}

/** Amazon lists newest first; the sheet is oldest first, so new rows must be added in the reverse order. */
export function oldestFirst(orders) {
	return [...orders].sort((a, b) => (a.orderDate || "").localeCompare(b.orderDate || "") || 0).filter(Boolean);
}

export function chunk(list, size) {
	const out = [];
	for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
	return out;
}

/** Orders as the service worker wants them (only the fields the sheet uses). */
export function toSheetOrders(parsed, domain) {
	return parsed.map((o) => ({
		orderNumber: o.orderNumber,
		orderDate: o.orderDate || undefined,
		asin: o.asin,
		title: o.title,
		imageUrl: o.imageUrl || undefined,
		etv: typeof o.etv === "number" ? o.etv : undefined,
		domain: domain || undefined,
	}));
}

/** One short sentence for the on-screen message, or null when nothing should be said. */
export function describeOrdersResult(res) {
	if (!res) return null;
	if (res.ok) {
		if (res.added > 0) return `Added ${res.added} order${res.added === 1 ? "" : "s"} to your sheet` + (res.skipped ? ` (${res.skipped} already there)` : "") + ".";
		return null; // everything was already there: nothing to report
	}
	return describeFailure(res);
}

export function describeReviewsResult(res) {
	if (!res) return null;
	if (res.ok) {
		if (res.updated > 0) return `Updated the review columns of ${res.updated} row${res.updated === 1 ? "" : "s"}.`;
		return null;
	}
	return describeFailure(res);
}

function describeFailure(res) {
	if (res.reason === "disabled" || res.reason === "not-configured") return null; // the owner has not turned it on
	if (res.reason === "signin") return "Your Google sign-in is needed: open VineTools' settings, Google tab, and press Sign in.";
	return "Google sheet: " + String(res.error || "something went wrong").slice(0, 200);
}

/** Total pages to walk for "sync all": never more than `cap`, at least 1. */
export function pageCount(pagination, cap = 60) {
	const pages = Number.isInteger(pagination?.pages) ? pagination.pages : 1;
	return Math.max(1, Math.min(cap, pages));
}
