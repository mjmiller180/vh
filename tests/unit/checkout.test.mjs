// Last compiled at 2026-11-05_1050
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
import test from "node:test";
import assert from "node:assert/strict";
import { parseArrival } from "../../scripts/checkout/CheckoutParser.js";
import { createPendingStore } from "../../scripts/checkout/PendingStore.js";
import { attachDelivery, toSheetOrders } from "../../scripts/core/utils/SheetSyncLogic.js";
import { mapColumns, buildOrderCells } from "../../scripts/core/utils/DashboardRow.js";

const NOW = new Date(2026, 10, 5, 12, 0);

test("parseArrival: the formats Amazon's checkout and thank-you pages use", () => {
	assert.equal(parseArrival("Arriving Nov 9, 2026", NOW), "2026-11-09");
	assert.equal(parseArrival("Monday, Nov. 9", NOW), "2026-11-09");
	assert.equal(parseArrival("Arriving Aug 30", NOW), "2027-08-30", "a date more than 60 days back means next year");
	assert.equal(parseArrival("Arriving Nov 9 - Nov 12", NOW), "2026-11-12", "a range gives its last day");
	assert.equal(parseArrival("Arriving Dec 29 - Jan 2", NOW), "2027-01-02", "a range over New Year rolls the year");
	assert.equal(parseArrival("Arriving December 3rd", NOW), "2026-12-03");
	assert.equal(parseArrival("Arriving Feb 30", NOW), null);
	assert.equal(parseArrival("Arriving tomorrow", NOW), null);
	assert.equal(parseArrival("", NOW), null);
	assert.equal(parseArrival(null, NOW), null);
});

test("parseArrival: Jan date seen in late December belongs to next year; a date a few days ago stays in this year", () => {
	assert.equal(parseArrival("Jan 3", new Date(2026, 11, 28)), "2027-01-03");
	assert.equal(parseArrival("Nov 1", NOW), "2026-11-01");
});

const memory = () => {
	const data = {};
	return { data, get: async (k) => ({ [k]: structuredClone(data[k]) }), set: async (o) => { await new Promise((r) => setTimeout(r, Math.random() * 3)); Object.assign(data, structuredClone(o)); } };
};
const GROUPS = [{ arriving: "2026-11-09", items: [{ asin: "B0H7GXLHFK", title: "Glove" }] }];

test("PendingStore: checkout is remembered, placing it fills placedOn and the thank-you arrival; unknown purchases are ignored", async () => {
	let t = 1_000_000;
	const st = memory();
	const s = createPendingStore(st, () => t);
	await s.seeCheckout("106-1111111-2222222", GROUPS);
	assert.equal((await s.all())["106-1111111-2222222"].placedOn, null);
	assert.equal(await s.seePlaced("106-9999999-9999999", ["2026-11-10"], new Date(2026, 10, 4)), false);
	assert.equal(await s.seePlaced("106-1111111-2222222", ["2026-11-10"], new Date(2026, 10, 4)), true);
	const e = (await s.all())["106-1111111-2222222"];
	assert.deepEqual([e.placedOn, e.groups[0].arriving], ["2026-11-04", "2026-11-10"]);
	await s.seeCheckout("106-1111111-2222222", GROUPS); // the checkout page re-rendered: placedOn is kept
	assert.equal((await s.all())["106-1111111-2222222"].placedOn, "2026-11-04");
});

test("PendingStore: entries expire after 30 days and at most 50 are kept; concurrent writes do not lose each other", async () => {
	let t = 1_000_000;
	const st = memory();
	const s = createPendingStore(st, () => t);
	await Promise.all(["106-0000001-0000001", "106-0000002-0000002"].map((id) => s.seeCheckout(id, GROUPS)));
	assert.equal(Object.keys(await s.all()).length, 2);
	t += 31 * 24 * 3600 * 1000;
	await s.seeCheckout("106-0000003-0000003", GROUPS);
	assert.deepEqual(Object.keys(await s.all()), ["106-0000003-0000003"]);
	for (let i = 0; i < 60; i++) {
		t += 1000;
		await s.seeCheckout(`106-${String(i).padStart(7, "0")}-0000000`, GROUPS);
	}
	assert.equal(Object.keys(await s.all()).length, 50);
});

const PENDING = { "106-1111111-2222222": { placedOn: "2026-11-04", groups: [{ arriving: "2026-11-09", items: [{ asin: "B0H7GXLHFK" }] }] }, "106-3333333-4444444": { placedOn: null, groups: [{ arriving: "2026-11-12", items: [{ asin: "B0HLPGVW5T" }] }] } };

test("attachDelivery: same ASIN and an order date within 2 days of the day it was placed; abandoned checkouts and other items are not used", () => {
	const orders = [
		{ orderNumber: "A", asin: "B0H7GXLHFK", orderDate: "2026-11-04" },
		{ orderNumber: "B", asin: "B0H7GXLHFK", orderDate: "2026-11-06" }, // 2 days: still the same purchase
		{ orderNumber: "C", asin: "B0H7GXLHFK", orderDate: "2026-11-20" }, // a later re-order of the same item
		{ orderNumber: "D", asin: "B0HLPGVW5T", orderDate: "2026-11-04" }, // checkout never completed
		{ orderNumber: "E", asin: "B0OTHER000", orderDate: "2026-11-04" },
		{ orderNumber: "F", asin: "B0H7GXLHFK", orderDate: "" },
	];
	const out = attachDelivery(orders, PENDING);
	assert.deepEqual(out.map((o) => o.deliveryDate), ["2026-11-09", "2026-11-09", undefined, undefined, undefined, undefined]);
	assert.equal(orders[0].deliveryDate, undefined, "input not mutated");
	assert.deepEqual(attachDelivery(orders, null).map((o) => o.deliveryDate), Array(6).fill(undefined));
	assert.equal(toSheetOrders(out.slice(0, 1), "www.amazon.com")[0].deliveryDate, "2026-11-09");
});

test("buildOrderCells: DELIVERY DATE is a date serial; a bad date is skipped instead of failing the batch", () => {
	const m = mapColumns(["ORDER DATE", "ORDER #", "IMAGE", "STATUS", "TITLE (PRODUCT LINK)", "ETV", "DELIVERY STATUS", "DELIVERY DATE"]);
	const base = { orderNumber: "111-1000001-2000003", orderDate: "2026-11-04", asin: "B0H7GXLHFK", title: "T" };
	const c = buildOrderCells({ ...base, deliveryDate: "2026-11-09" }, m).find((x) => x.column === 7);
	assert.equal(c.cell.userEnteredValue.numberValue, 46335);
	assert.equal(buildOrderCells({ ...base, deliveryDate: "2026-02-30" }, m).find((x) => x.column === 7), undefined);
	assert.equal(buildOrderCells({ ...base, deliveryDate: "soon" }, m).find((x) => x.column === 7), undefined);
	assert.equal(buildOrderCells(base, m).find((x) => x.column === 7), undefined);
});
