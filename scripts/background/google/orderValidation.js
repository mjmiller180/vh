// Last compiled at 2026-11-05_0049
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
import { isOrderNumber } from "../../core/utils/DashboardRow.js";

/** Cheap checks on a batch of orders before any network call. */
export function buildOrderValidation(orders) {
	if (!Array.isArray(orders) || orders.length === 0) return { ok: false, error: "No orders to add" };
	if (orders.length > 100) return { ok: false, error: "Too many orders in one request (max 100)" };
	for (const o of orders) {
		if (!o || !isOrderNumber(o.orderNumber)) return { ok: false, error: "Invalid order number: " + (o && o.orderNumber) };
	}
	return { ok: true };
}
