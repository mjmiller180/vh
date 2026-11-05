// Last compiled at 2026-11-05_1050
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
// Loads the checkout capture as a module (content scripts cannot use import statements directly).
(async () => {
	try {
		const mod = await import(chrome.runtime.getURL("./scripts/checkout/CheckoutCapture.js"));
		await mod.startCheckoutCapture();
	} catch (error) {
		console.error("VineTools checkout capture:", error);
	}
})();
