// Last compiled at 2026-11-05_1050
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/**
 * Runs on amazon.com's checkout page and thank-you page and remembers the estimated delivery date of what you ordered,
 * so the DASHBOARD row (created later from the Vine Orders page) gets its DELIVERY DATE. Only when the Google sheet
 * link is switched on. Nothing leaves the browser from here.
 */
import { parseCheckoutPage, parseThankYouPage } from "/scripts/checkout/CheckoutParser.js";
import { createPendingStore } from "/scripts/checkout/PendingStore.js";

export async function startCheckoutCapture() {
	if (location.hostname !== "www.amazon.com") return; // other marketplaces: different date formats, not supported
	const { settings } = await chrome.storage.local.get("settings");
	if (!settings?.google?.sheet?.enabled) return;
	const store = createPendingStore(chrome.storage.local);

	if (location.pathname.startsWith("/checkout/p/")) {
		// the checkout page fills itself in after it loads: read it again whenever it changes (until it is left)
		let timer = null;
		const read = () => {
			const r = parseCheckoutPage(document, location.href);
			if (r.purchaseId && r.groups.length) store.seeCheckout(r.purchaseId, r.groups).catch(() => {});
		};
		read();
		new MutationObserver(() => {
			clearTimeout(timer);
			timer = setTimeout(read, 1000);
		}).observe(document.body, { childList: true, subtree: true });
		return;
	}

	if (location.pathname.startsWith("/gp/buy/thankyou/")) {
		const r = parseThankYouPage(document, location.href);
		if (r.placed && r.purchaseId) await store.seePlaced(r.purchaseId, r.arrivals);
	}
}
