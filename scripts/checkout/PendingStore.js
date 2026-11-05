// Last compiled at 2026-11-05_1508
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/**
 * What the checkout / thank-you pages told us, kept until the matching order shows up on the Vine Orders page:
 * { [purchaseId]: { seenAt, placedOn: "YYYY-MM-DD" | null, groups: [{arriving, items: [{asin, title}]}] } }
 * Only entries whose thank-you page was seen (the order was really placed) are ever used.
 */
const KEY = "vs.checkout.pending";
const TTL_MS = 30 * 24 * 3600 * 1000;
const MAX_ENTRIES = 50;

const queues = new WeakMap();
function serial(storage, fn) {
	const prev = queues.get(storage) || Promise.resolve();
	const next = prev.then(fn, fn);
	queues.set(storage, next.catch(() => {}));
	return next;
}

const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function createPendingStore(storage, now = () => Date.now()) {
	const read = async () => {
		const o = (await storage.get(KEY))[KEY];
		return o && typeof o === "object" && !Array.isArray(o) ? o : {};
	};
	const write = async (all) => {
		const keep = Object.entries(all)
			.filter(([, v]) => v && now() - (v.seenAt || 0) < TTL_MS)
			.sort((a, b) => (b[1].seenAt || 0) - (a[1].seenAt || 0))
			.slice(0, MAX_ENTRIES);
		await storage.set({ [KEY]: Object.fromEntries(keep) });
	};
	return {
		all: read,
		/** The checkout page was read: remember its items (a later read replaces the earlier one, keeping placedOn). */
		seeCheckout: (purchaseId, groups) =>
			serial(storage, async () => {
				const all = await read();
				all[purchaseId] = { seenAt: now(), placedOn: all[purchaseId]?.placedOn ?? null, groups };
				await write(all);
			}),
		/** The thank-you page was read: the order was placed; its arrival dates (per group) replace the checkout's. */
		seePlaced: (purchaseId, arrivals, date = new Date(now())) =>
			serial(storage, async () => {
				const all = await read();
				const e = all[purchaseId];
				if (!e) return false; // we never saw this checkout: nothing to attach later
				e.placedOn = today(date);
				e.seenAt = now();
				arrivals.forEach((a, i) => {
					if (a && e.groups[i]) e.groups[i].arriving = a;
				});
				await write(all);
				return true;
			}),
	};
}
