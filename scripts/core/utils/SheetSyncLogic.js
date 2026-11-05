// Last compiled at 2026-11-05_1050
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/** Pure helpers for SheetSync (unit tested in Node). */

/**
 * Only the US site is read: its page formats (M/D/YYYY dates, "$16.99") are what the parser understands. Other
 * marketplaces write dates as D/M/YYYY and amounts like "16,99 €", which would put wrong values on the sheet.
 */
export const isSupportedHost = (hostname) => /^www\.amazon\.com$/i.test(String(hostname || ""));

/** Which list page the URL is: "orders", "reviews" or null. */
export function pageKind(pathname) {
	const p = String(pathname || "").replace(/\/+$/, "");
	if (/\/vine\/orders$/.test(p)) return "orders";
	if (/\/vine\/vine-reviews$/.test(p)) return "reviews";
	return null;
}

/** Amazon lists newest first; the sheet is oldest first, so new rows must be added in the reverse order. */
export function oldestFirst(orders) {
	// reverse first: the sort is stable, so orders of the same day also come out oldest first
	return [...orders].reverse().sort((a, b) => (a.orderDate || "").localeCompare(b.orderDate || ""));
}

export function chunk(list, size) {
	const out = [];
	for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
	return out;
}

const dayNumber = (iso) => {
	const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
	return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : null;
};

/**
 * Attach the estimated delivery date remembered from the checkout / thank-you pages to the orders it belongs to:
 * same ASIN, and an order date within 2 days of the day the order was placed. Orders are returned as new objects.
 * @param pending {[purchaseId]: {placedOn, groups: [{arriving, items: [{asin}]}]}}
 */
export function attachDelivery(orders, pending) {
	const entries = Object.values(pending || {}).filter((e) => e && e.placedOn && Array.isArray(e.groups));
	return orders.map((o) => {
		const od = dayNumber(o.orderDate);
		if (od === null || o.deliveryDate) return o;
		for (const e of entries) {
			const pd = dayNumber(e.placedOn);
			if (pd === null || Math.abs(pd - od) > 2) continue;
			for (const g of e.groups) {
				if (g.arriving && (g.items || []).some((i) => i.asin === o.asin)) return { ...o, deliveryDate: g.arriving };
			}
		}
		return o;
	});
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
		deliveryDate: o.deliveryDate || undefined,
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

export const MAX_PAGES = 60;

/** Total pages to walk for "sync all": never more than `cap`, at least 1. */
export function pageCount(pagination, cap = MAX_PAGES) {
	const pages = Number.isInteger(pagination?.pages) ? pagination.pages : 1;
	return Math.max(1, Math.min(cap, pages));
}

/** True when the list has more pages than "sync all" will read. */
export function isCapped(pagination, cap = MAX_PAGES) {
	return Number.isInteger(pagination?.pages) && pagination.pages > cap;
}
