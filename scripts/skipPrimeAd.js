// Last compiled at 2026-11-04_2317
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/*global chrome*/
// Replaces the old checkout monitor. Its only local feature is kept: when the "skip Prime ad"
// setting is on, decline the Prime upsell shown during Vine checkout. Nothing is recorded or sent.
(async () => {
	try {
		const { settings } = await chrome.storage.local.get("settings");
		if (!settings?.general?.skipPrimeAd) return;
		for (let i = 0; i < 20; i++) {
			const btn = document.querySelector("#prime-decline-button");
			if (btn) {
				btn.click();
				return;
			}
			await new Promise((r) => setTimeout(r, 250));
		}
	} catch (e) {
		// storage unavailable: leave the page alone
	}
})();
