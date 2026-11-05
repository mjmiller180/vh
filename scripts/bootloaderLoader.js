// Last compiled at 2026-11-04_2317
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
//Load the bootloader file as a module
(async () => {
	try {
		const module = await import(chrome.runtime.getURL("./scripts/bootloader.js"));
	} catch (error) {
		console.error("Error loading module:", error);
		console.trace();
	}
})();
