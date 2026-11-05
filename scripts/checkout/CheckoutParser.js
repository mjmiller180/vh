// Last compiled at 2026-11-05_1050
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/**
 * Reads Amazon's checkout page and thank-you page (DOM only; nothing is sent anywhere from here).
 * The checkout page shows the item(s) and "Arriving Nov 9, 2026"; the thank-you page confirms the order was placed and
 * shows "Monday, Nov. 9 / Estimated delivery". Neither page shows the ORDER number (the id in their address is the
 * "purchase id", which differs from the order id), so the rows themselves still come from the Vine Orders page; what is
 * remembered here is the delivery date to attach to the matching order.
 */
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DATE_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/gi;

const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * "Arriving Nov 9, 2026" / "Monday, Nov. 9" / "Nov 9 - Nov 12" -> "YYYY-MM-DD" (the LAST date of a range), or null.
 * A date without a year gets the current year, or the next one when that would be more than 60 days in the past.
 */
export function parseArrival(text, now = new Date()) {
	let last = null;
	for (const m of String(text ?? "").matchAll(DATE_RE)) {
		const month = MONTHS[m[1].toLowerCase()];
		const day = Number(m[2]);
		if (!month || day < 1 || day > 31) continue;
		let year = m[3] ? Number(m[3]) : now.getFullYear();
		const check = new Date(Date.UTC(year, month - 1, day));
		if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) continue; // Feb 30 and the like
		if (!m[3] && check.getTime() < now.getTime() - 60 * 86400000) year++;
		last = iso(year, month, day);
	}
	return last;
}

const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
const PURCHASE_ID = /^[A-Z0-9]{3}-\d{7}-\d{7}$/i;

/** The purchase id: the form field, else the address (p-106-... on the checkout page, ?purchaseId= on the thank-you page). */
export function purchaseIdFrom(root, href) {
	const field = root.querySelector?.('input[name="purchaseId"]')?.value;
	if (PURCHASE_ID.test(field || "")) return field;
	try {
		const u = new URL(href);
		const q = u.searchParams.get("purchaseId");
		if (PURCHASE_ID.test(q || "")) return q;
		const m = u.pathname.match(/\/checkout\/p\/p-([A-Z0-9]{3}-\d{7}-\d{7})/i);
		if (m) return m[1];
	} catch (e) {}
	return null;
}

/** @returns {{purchaseId: string|null, groups: {arriving: string|null, items: {asin: string, title: string}[]}[]}} */
export function parseCheckoutPage(root, href, now = new Date()) {
	const groups = [];
	for (const g of root.querySelectorAll('[data-optimistic-target^="delivery-group:"]')) {
		const items = [];
		const asins = [...g.querySelectorAll('[data-testid^="Item_asin_"]')].map((n) => text(n).toUpperCase()).filter((a) => /^[A-Z0-9]{10}$/.test(a));
		const titles = [...g.querySelectorAll(".lineitem-title-text")].map(text);
		asins.forEach((asin, i) => items.push({ asin, title: titles[i] || "" }));
		if (items.length) groups.push({ arriving: parseArrival(text(g.querySelector("h2")), now), items });
	}
	return { purchaseId: purchaseIdFrom(root, href), groups };
}

/** @returns {{purchaseId: string|null, placed: boolean, arrivals: (string|null)[]}} one arrival per shipment group, page order */
export function parseThankYouPage(root, href, now = new Date()) {
	const placed = !!root.querySelector('[cel_widget_id="typ-purchaseConfirmationStatus"], [data-cel-widget="typ-purchaseConfirmationStatus"]') && /order placed/i.test(text(root.querySelector(".a-alert-heading, h4")));
	const arrivals = [...root.querySelectorAll('[id^="delivery-promise-orderGroupID"]')].map((n) => parseArrival(text(n), now));
	return { purchaseId: purchaseIdFrom(root, href), placed, arrivals };
}
