// Last compiled at 2026-11-21_1828
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/**
 * The queue page an item was pinned from, so the pin can take you back to see whether the item is still in the queue.
 * Pure (unit tested in Node). Anything that comes back from storage or from a sync is checked again before it becomes a link:
 * only an https Amazon Vine items page is accepted, the #fragment is dropped.
 */
const VINE_ITEMS = /^https:\/\/www\.amazon\.[a-z]{2,3}(\.[a-z]{2})?\/vine\/vine-items(\?[^#\s]*)?$/i;

/** @returns {string|null} the address without its #fragment, or null when it is not a Vine items page */
export function cleanSourceUrl(href) {
	if (typeof href !== "string" || href.length > 600) return null;
	const noHash = href.trim().split("#")[0];
	return VINE_ITEMS.test(noHash) ? noHash : null;
}
