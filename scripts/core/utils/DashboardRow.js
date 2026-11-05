// Last compiled at 2026-11-05_1200
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/**
 * Builds the cells of a DASHBOARD row (pure: no chrome.*, no network, unit tested in Node).
 *
 * Columns are found by their header text, not by position or letter, so the owner can move, insert or add columns
 * (the header row itself is found by its "ORDER #" cell: on the owner's sheet it is row 2, data starts on row 3).
 * Cells are produced one per column ({column, cell}) so that only the columns we know about are ever written:
 * the manual columns (delivery date, pics, notes ...) and any formulas next to them are left alone.
 */

// header text (normalised: upper case, only A-Z 0-9 #) -> key. The sheet really spells it "REVIEW SATUS".
const ALIASES = {
	orderDate: ["ORDERDATE"],
	orderNumber: ["ORDER#", "ORDERNUMBER", "ORDERNO"],
	image: ["IMAGE"],
	status: ["STATUS"],
	title: ["TITLEPRODUCTLINK", "TITLE", "PRODUCT"],
	etv: ["ETV"],
	deliveryStatus: ["DELIVERYSTATUS"],
	deliveryDate: ["DELIVERYDATE"],
	pics: ["PICS"],
	reviewStatus: ["REVIEWSATUS", "REVIEWSTATUS"],
	reviewScore: ["REVIEWSCORE"],
	starRating: ["STARRATING"],
	notes: ["GENERALREVIEWNOTES", "REVIEWNOTES", "NOTES"],
	reviewDate: ["REVIEWDATE"],
	reviewLink: ["REVIEWLINK"],
	reviewTitle: ["REVIEWTITLE", "REVIEWHEADLINE"],
	reviewText: ["REVIEWTEXT", "REVIEWBODY", "REVIEWCONTENT"],
};

export const normaliseHeader = (h) => String(h ?? "").toUpperCase().replace(/[^A-Z0-9#]/g, "");

export const NO_ORDER_NUMBER_COLUMN = 'The header row has no "ORDER #" column';

/** @returns {{[key: string]: number}} column index per key; throws when the ORDER # column is missing */
export function mapColumns(headerRow) {
	const norm = (headerRow || []).map(normaliseHeader);
	const map = {};
	for (const [key, aliases] of Object.entries(ALIASES)) {
		const i = norm.findIndex((h) => aliases.includes(h));
		if (i >= 0) map[key] = i;
	}
	if (map.orderNumber === undefined) throw new Error(NO_ORDER_NUMBER_COLUMN);
	return map;
}

export const isOrderNumber = (v) => typeof v === "string" && /^[A-Z0-9]{3}-\d{7}-\d{7}$/i.test(v);

/** Google Sheets date serial (days since 1899-12-30) for a date given as Date, epoch ms, "M/D/YYYY" or "YYYY-MM-DD". */
export function dateToSerial(input) {
	let y, m, d;
	if (input instanceof Date || typeof input === "number") {
		const dt = new Date(input);
		if (Number.isNaN(dt.getTime())) throw new Error("Invalid date: " + input);
		[y, m, d] = [dt.getFullYear(), dt.getMonth() + 1, dt.getDate()];
	} else if (typeof input === "string") {
		let mm;
		if ((mm = input.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [m, d, y] = [+mm[1], +mm[2], +mm[3]];
		else if ((mm = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})/))) [y, m, d] = [+mm[1], +mm[2], +mm[3]];
		else throw new Error("Invalid date: " + input);
	} else {
		throw new Error("Invalid date: " + input);
	}
	const utc = Date.UTC(y, m - 1, d);
	const check = new Date(utc);
	if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) throw new Error("Invalid date: " + input);
	return Math.round((utc - Date.UTC(1899, 11, 30)) / 86400000);
}

// Values come from Amazon's page DOM: only accept what a real Amazon page would contain.
const IMAGE_RE = /^https:\/\/([a-z0-9-]+\.)*(media-amazon\.com|ssl-images-amazon\.com)\/[^\s"]*$/i;
const DOMAIN_RE = /^www\.amazon\.[a-z]{2,3}(\.[a-z]{2})?$/i;
const ASIN_RE = /^[A-Z0-9]{10}$/i;
const AMAZON_URL_RE = /^https:\/\/www\.amazon\.[a-z]{2,3}(\.[a-z]{2})?\/[^\s]*$/i;

const text = (s) => ({ userEnteredValue: { stringValue: String(s) } });
const num = (n) => ({ userEnteredValue: { numberValue: n } });
const linked = (label, uri) => ({ userEnteredValue: { stringValue: String(label) }, textFormatRuns: [{ startIndex: 0, format: { link: { uri } } }] });
const formulaImage = (url) => ({ userEnteredValue: { formulaValue: `=IMAGE("${String(url).replace(/"/g, '""')}")` } });

const present = (v) => v !== undefined && v !== null && v !== "";

const dateFormat = { numberFormat: { type: "DATE", pattern: "M/d/yyyy" } };
const moneyFormat = { numberFormat: { type: "CURRENCY", pattern: "$#,##0.00" } };

/**
 * The cells for a NEW order row: date, order # (linked), image, status ORDERED, title (linked), ETV.
 * @param {{withFormats?: boolean}} opts  withFormats: also set the date / money number formats (used when there is
 *   no previous row to copy the formatting from, otherwise a date would show as a serial number like 46028)
 */
export function buildOrderCells(order, colMap, { withFormats = false } = {}) {
	if (!isOrderNumber(order.orderNumber)) throw new Error("Invalid order number: " + order.orderNumber);
	const host = order.domain || "www.amazon.com";
	if (!DOMAIN_RE.test(host)) throw new Error("Invalid marketplace domain: " + host);
	const out = [];
	const put = (key, cell) => {
		if (colMap[key] !== undefined) out.push({ column: colMap[key], cell });
	};
	if (present(order.orderDate)) {
		const c = num(dateToSerial(order.orderDate));
		if (withFormats) c.userEnteredFormat = dateFormat;
		put("orderDate", c);
	}
	put("orderNumber", linked(order.orderNumber, `https://${host}/your-orders/order-details?orderID=${order.orderNumber}`));
	if (present(order.imageUrl) && IMAGE_RE.test(order.imageUrl)) put("image", formulaImage(order.imageUrl)); //anything else: no image
	put("status", text(order.status || "ORDERED"));
	if (present(order.title)) put("title", ASIN_RE.test(order.asin || "") ? linked(order.title, `https://${host}/dp/${order.asin}`) : text(order.title));
	if (present(order.deliveryDate) && /^\d{4}-\d{2}-\d{2}$/.test(order.deliveryDate)) {
		try {
			const c = num(dateToSerial(order.deliveryDate));
			if (withFormats) c.userEnteredFormat = dateFormat;
			put("deliveryDate", c); // an impossible date (Feb 30) is simply not written; it must not fail the whole batch
		} catch (e) {}
	}
	if (typeof order.etv === "number" && Number.isFinite(order.etv)) {
		// the owner's sheet links the ETV cell to the order's invoice page. Rich-text links are only valid on text cells,
		// so the number is kept as a number with =HYPERLINK(url, value).
		const c = { userEnteredValue: { formulaValue: `=HYPERLINK("https://${host}/gp/css/summary/print.html?orderID=${order.orderNumber}", ${Number(order.etv).toFixed(2)})` } };
		if (withFormats) c.userEnteredFormat = moneyFormat;
		put("etv", c);
	}
	return out.sort((a, b) => a.column - b.column);
}

// The DASHBOARD's REVIEW columns are strict dropdown lists: only these exact values may be written.
export const REVIEW_STATUS_VALUES = ["LIVE", "REJECTED", "PENDING APPROVAL", "NOT SUBMITTED", "DECLINE TO REVIEW", "UNABLE TO REVIEW", "TAKEN DOWN"];
export const REVIEW_SCORE_VALUES = ["EXCELLENT", "GOOD", "FAIR", "POOR", "PENDING"];
/** States the owner sets by hand: an automatic update never replaces them. */
export const MANUAL_REVIEW_STATES = ["DECLINE TO REVIEW", "UNABLE TO REVIEW", "TAKEN DOWN"];

/** Amazon's "Review status" text on the Vine reviews pages -> the sheet's REVIEW STATUS value (null: unknown, write nothing). */
export function mapReviewStatus(text) {
	const t = String(text ?? "").trim().toLowerCase();
	if (!t) return null;
	if (t === "not yet reviewed") return "NOT SUBMITTED";
	if (t === "approved") return "LIVE";
	if (t === "rejected" || t === "not approved") return "REJECTED";
	if (t === "pending" || t.startsWith("pending") || t === "submitted" || t === "in review" || t === "under review") return "PENDING APPROVAL";
	return null;
}

/** Amazon's "Review quality score" text -> the sheet's REVIEW SCORE value (null: unknown/blank). */
export function mapReviewScore(text) {
	const t = String(text ?? "").trim().toUpperCase();
	return REVIEW_SCORE_VALUES.includes(t) ? t : null;
}

/** 1..5 -> the star strings the STAR RATING dropdown uses ("⭐" x n); null for anything else. */
export function starsText(n) {
	const k = typeof n === "string" && /^\d$/.test(n) ? Number(n) : n;
	return Number.isInteger(k) && k >= 1 && k <= 5 ? "⭐".repeat(k) : null;
}

/** Cells for an UPDATE of existing columns (review fields etc.): only the keys that are given. */
export function buildFieldCells(fields, colMap) {
	const out = [];
	const put = (key, cell) => {
		if (colMap[key] !== undefined) out.push({ column: colMap[key], cell });
	};
	for (const key of ["status", "deliveryStatus", "pics", "reviewStatus", "reviewScore", "notes"]) {
		if (present(fields[key])) put(key, typeof fields[key] === "number" ? num(fields[key]) : text(fields[key]));
	}
	if (present(fields.starRating)) {
		const stars = starsText(fields.starRating) ?? (/^(⭐){1,5}$/u.test(String(fields.starRating)) ? String(fields.starRating) : null);
		if (stars) put("starRating", text(stars));
	}
	if (present(fields.etv) && typeof fields.etv === "number") put("etv", num(fields.etv));
	for (const key of ["deliveryDate", "reviewDate"]) if (present(fields[key])) put(key, num(dateToSerial(fields[key])));
	// the review as submitted (Sheets keeps at most 50,000 characters in a cell); written as plain text, never parsed as a formula
	for (const key of ["reviewTitle", "reviewText"]) if (present(fields[key])) put(key, text(String(fields[key]).slice(0, 50000)));
	if (present(fields.reviewLink)) put("reviewLink", AMAZON_URL_RE.test(fields.reviewLink) ? linked(fields.reviewLink, fields.reviewLink) : text(fields.reviewLink));
	return out.sort((a, b) => a.column - b.column);
}
