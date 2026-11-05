// Last compiled at 2026-11-05_0130
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
// Loads the review form tools as a module (content scripts cannot use import statements directly).
(async () => {
	try {
		const mod = await import(chrome.runtime.getURL("./scripts/review/ReviewTools.js"));
		await mod.startReviewTools();
	} catch (error) {
		console.error("VineTools review tools:", error);
	}
})();
