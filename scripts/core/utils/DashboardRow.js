// Last compiled at 2026-11-05_0049
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/**
 * Builds the cells of a DASHBOARD row (pure: no chrome.*, no network, unit tested in Node).
 *
 * Columns are found by their header text, not by position, so the owner can move columns around.
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
	if (typeof order.etv === "number" && Number.isFinite(order.etv)) {
		const c = num(order.etv);
		if (withFormats) c.userEnteredFormat = moneyFormat;
		put("etv", c);
	}
	return out.sort((a, b) => a.column - b.column);
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
	if (present(fields.starRating)) put("starRating", typeof fields.starRating === "number" ? num(fields.starRating) : text(fields.starRating));
	if (present(fields.etv) && typeof fields.etv === "number") put("etv", num(fields.etv));
	for (const key of ["deliveryDate", "reviewDate"]) if (present(fields[key])) put(key, num(dateToSerial(fields[key])));
	if (present(fields.reviewLink)) put("reviewLink", AMAZON_URL_RE.test(fields.reviewLink) ? linked(fields.reviewLink, fields.reviewLink) : text(fields.reviewLink));
	return out.sort((a, b) => a.column - b.column);
}
