// Last compiled at 2026-11-05_0123
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/**
 * Reads the two Vine list pages (pure DOM reading: nothing is sent anywhere from here):
 *   /vine/orders        -> orders: title, ASIN, thumbnail, order date, ETV ("Fair market value"), order number
 *   /vine/vine-reviews  -> reviews: ASIN, order date, review status, quality score, review link
 * Works on a live Document or on one made with DOMParser (used to read the other pages for "sync all pages").
 */

/** Amazon double-escapes some titles ("&amp;amp;" in the markup shows "&amp;" as text): decode until stable. */
export function decodeEntities(text) {
	let t = String(text ?? "");
	for (let i = 0; i < 3; i++) {
		const next = t
			.replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Math.min(+d, 0x10ffff)))
			.replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
			.replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (m, n) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[n]);
		if (next === t) break;
		t = next;
	}
	return t.replace(/\s+/g, " ").trim();
}

/** "$16.99" / "$1,016.99" -> number; null when there is no amount. */
export function parseMoney(text) {
	const m = String(text ?? "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
	return m ? Number(m[1]) : null;
}

/** "11/4/2026" (the US Vine pages) -> "2026-11-04"; null for anything else. */
export function parseUsDate(text) {
	const m = String(text ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
	if (!m) return null;
	const [mo, d, y] = [+m[1], +m[2], +m[3]];
	if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
	return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const asinFrom = (href) => {
	const m = String(href || "").match(/\/dp\/([A-Z0-9]{10})(?:[/?#]|$)/i);
	return m ? m[1].toUpperCase() : null;
};
const orderIdFrom = (href) => {
	const m = String(href || "").match(/[?&]orderID=([A-Z0-9]{3}-\d{7}-\d{7})/i);
	return m ? m[1] : null;
};
const titleOf = (row, linkSel) => {
	const link = row.querySelector(linkSel);
	if (!link) return { asin: null, title: "" };
	const full = link.querySelector(".a-truncate-full") || link;
	return { asin: asinFrom(link.getAttribute("href")), title: decodeEntities(full.textContent) };
};
// The page shows a small thumbnail; the saved/live src is on Amazon's image hosts. Anything else is not used.
const thumbOf = (row, sel) => {
	const src = row.querySelector(sel)?.getAttribute("src") || "";
	return /^https:\/\/([a-z0-9-]+\.)*(media-amazon\.com|ssl-images-amazon\.com)\//i.test(src) ? src : "";
};

/** @returns {{orderNumber:string, orderDate:string, asin:string, title:string, imageUrl:string, etv:number|null}[]} */
export function parseOrdersPage(root) {
	const out = [];
	for (const row of root.querySelectorAll("tr.vvp-orders-table--row")) {
		const orderNumber = orderIdFrom(row.querySelector('a[name="vvp-orders-table--order-details-btn"]')?.getAttribute("href"));
		const { asin, title } = titleOf(row, ".vvp-orders-table--text-col a.a-link-normal");
		if (!orderNumber || !asin) continue; // not a real order row
		const cells = row.querySelectorAll("td.vvp-orders-table--text-col");
		const orderDate = parseUsDate(cells[1]?.textContent) || "";
		out.push({
			orderNumber,
			orderDate,
			asin,
			title,
			imageUrl: thumbOf(row, ".vvp-orders-table--image-col img"),
			etv: parseMoney(cells[2]?.textContent),
		});
	}
	return out;
}

/** @returns {{asin:string, title:string, orderDate:string, status:string, score:string, reviewLink:string, reviewHeadline:string}[]} */
export function parseReviewsPage(root) {
	const out = [];
	for (const row of root.querySelectorAll("tr.vvp-reviews-table--row")) {
		const { asin, title } = titleOf(row, "#vvp-reviews-product-detail-page-link");
		if (!asin) continue;
		const cells = row.querySelectorAll("td.vvp-reviews-table--text-col");
		const link = row.querySelector('a[name="vvp-reviews-table--see-review-btn"]')?.getAttribute("href") || "";
		out.push({
			asin,
			title,
			orderDate: parseUsDate(cells[1]?.textContent) || "",
			status: decodeEntities(cells[2]?.textContent),
			score: cells.length > 3 ? decodeEntities(cells[3]?.textContent) : "",
			reviewLink: /^https:\/\/www\.amazon\.[a-z.]{2,7}\/gp\/customer-reviews\/[A-Z0-9]+/i.test(link) ? link.split("?")[0] : "",
			reviewHeadline: decodeEntities(cells[2]?.getAttribute("data-review-content")),
		});
	}
	return out;
}

/** "Displaying 1-10 of 143 results" + pagination -> {total, pages}; pages = highest page number linked, at least 1. */
export function parsePagination(root) {
	const text = root.body ? root.body.textContent : root.textContent || "";
	const m = text.match(/Displaying\s+\d+\s*-\s*\d+\s+of\s+([\d,]+)\s+results/i);
	let pages = 1;
	for (const a of root.querySelectorAll("ul.a-pagination li a")) {
		const n = Number((a.getAttribute("href") || "").match(/[?&]page=(\d+)/)?.[1]);
		if (Number.isInteger(n) && n > pages) pages = n;
	}
	return { total: m ? Number(m[1].replace(/,/g, "")) : null, pages };
}
