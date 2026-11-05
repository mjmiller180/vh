// Last compiled at 2026-11-05_1508
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/**
 * Pure merge logic for the folder sync (no chrome.* / DOM access, so it can be unit tested in Node).
 *
 * A "state" is:
 * {
 *   settings: {...},               // the whole settings object
 *   settingsModifiedAt: number,    // ms epoch of the last local settings change
 *   hiddenItems: { [asin]: ms },   // asin -> time it was hidden
 *   pinnedItems: { [asin]: {date_added: ms, ...} },
 *   tombstones: { hidden: { [asin]: ms }, pinned: { [asin]: ms } }  // time of un-hide / un-pin
 * }
 *
 * Lists use "latest event wins" per ASIN: an item survives if its add time is strictly newer
 * than the newest removal recorded for it on either side.
 * Settings use last-writer-wins for the whole object, except for LOCAL_ONLY keys which are
 * never taken from the other side.
 */

export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const HIDDEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // mirrors HiddenListMgr garbage collection

// Settings that describe this device/browser and must never be shared or overwritten by another device:
//  - per-device state (usage counter, country, template-cache marker, GC marker, checkout in progress)
//  - secrets (the tab-to-tab encryption keys) and leftovers of the server era (uuid, fingerprint, ...)
// Writing one of these never counts as "the user changed their settings" (see SettingsMgrDI).
export const LOCAL_ONLY_SETTINGS = [
	"metrics",
	"sync",
	"crypto",
	"checkout",
	"general.country",
	"general.versionInfoPopup",
	"general.deviceName",
	"general.uuid",
	"general.uuidError",
	"general.fingerprint",
	"general.cid",
	"general.patreon",
	"hiddenTab.lastGC",
];

/** True when `path` (e.g. "crypto.privateKey") is, or lies inside, a device-local setting. */
export function isLocalOnlySetting(path) {
	return LOCAL_ONLY_SETTINGS.some((p) => path === p || path.startsWith(p + "."));
}

const clone = (o) => JSON.parse(JSON.stringify(o ?? null));

function getPath(obj, path) {
	return path.split(".").reduce((p, c) => (p == null ? undefined : p[c]), obj);
}

function setPath(obj, path, value) {
	const keys = path.split(".");
	const last = keys.pop();
	let cur = obj;
	for (const k of keys) {
		if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
		cur = cur[k];
	}
	if (value === undefined) delete cur[last];
	else cur[last] = value;
}

function deletePath(obj, path) {
	setPath(obj, path, undefined);
}

/** Copy of the settings without the local-only keys (what gets written to the shared file). */
export function stripLocalOnly(settings) {
	const out = clone(settings) || {};
	for (const p of LOCAL_ONLY_SETTINGS) deletePath(out, p);
	return out;
}

/** Take the other side's settings but keep this device's local-only values. */
export function restoreLocalOnly(incoming, local) {
	const out = clone(incoming) || {};
	for (const p of LOCAL_ONLY_SETTINGS) {
		const v = getPath(local, p);
		if (v !== undefined) setPath(out, p, clone(v));
		else deletePath(out, p);
	}
	return out;
}

/**
 * Best-effort conversion of a stored time value to epoch ms. Numbers, numeric strings and date strings
 * (older versions stored Date objects, which serialise to ISO strings) are understood; anything else is 0
 * ("age unknown"). Never NaN: a NaN would make every comparison false and silently drop the user's item.
 */
export function toTimestamp(v) {
	if (typeof v === "number") return Number.isFinite(v) ? v : 0;
	if (typeof v === "string" && v.trim() !== "") {
		const n = Number(v);
		if (Number.isFinite(n)) return n;
		const d = Date.parse(v);
		if (Number.isFinite(d)) return d;
	}
	return 0;
}

/**
 * Read a stored hidden/pinned list in any format it has ever had and return {asin: value}.
 *  - object {asin: value}                       (current)
 *  - JSON string of an object or of pairs       (older versions)
 *  - [[asin, value], ...]                       (Map entries)
 *  - [{asin, date}] / [{asin, title, ...}]      (oldest format)
 * Unrecognisable input gives {} (the caller never loses data it could not have understood anyway).
 * @param {"hidden"|"pinned"} kind
 */
export function normaliseListMap(v, kind) {
	if (!v) return {};
	if (typeof v === "string") {
		try {
			v = JSON.parse(v);
		} catch (e) {
			return {};
		}
	}
	if (Array.isArray(v)) {
		const out = {};
		for (const e of v) {
			if (Array.isArray(e) && typeof e[0] === "string") {
				out[e[0]] = e[1];
			} else if (e && typeof e === "object" && typeof e.asin === "string") {
				const { asin, ...rest } = e;
				out[asin] = kind === "hidden" ? (rest.date ?? rest.ts ?? 0) : rest;
			}
		}
		return out;
	}
	return typeof v === "object" ? v : {};
}

function mergeList(localItems, remoteItems, localRem, remoteRem, getTs, now, ttl) {
	const items = {};
	const removed = {};
	const asins = new Set([
		...Object.keys(localItems || {}),
		...Object.keys(remoteItems || {}),
		...Object.keys(localRem || {}),
		...Object.keys(remoteRem || {}),
	]);

	for (const asin of asins) {
		const l = localItems?.[asin];
		const r = remoteItems?.[asin];
		const lTs = l !== undefined ? getTs(l) : undefined;
		const rTs = r !== undefined ? getTs(r) : undefined;

		let best;
		let bestTs;
		if (lTs !== undefined && (rTs === undefined || lTs >= rTs)) {
			best = l;
			bestTs = lTs;
		} else if (rTs !== undefined) {
			best = r;
			bestTs = rTs;
		}

		const remTs = Math.max(localRem?.[asin] !== undefined ? toTimestamp(localRem[asin]) : -Infinity, remoteRem?.[asin] !== undefined ? toTimestamp(remoteRem[asin]) : -Infinity);

		if (best !== undefined && bestTs > remTs) {
			// Items past the TTL are dropped (same rule as the hidden list garbage collection).
			if (ttl && bestTs > 0 && now - bestTs > ttl) continue; //(age unknown = keep)
			items[asin] = best;
		} else if (remTs !== -Infinity && now - remTs <= TOMBSTONE_TTL_MS) {
			removed[asin] = remTs;
		}
	}
	return { items, removed };
}

const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Merge two states. Returns the merged state and which side(s) need to be written.
 */
export function mergeState(local, remote, now = Date.now()) {
	local = local || {};
	remote = remote || {};

	// ---- lists
	const hidden = mergeList(
		local.hiddenItems,
		remote.hiddenItems,
		local.tombstones?.hidden,
		remote.tombstones?.hidden,
		(ts) => toTimestamp(ts),
		now,
		HIDDEN_TTL_MS
	);
	const pinned = mergeList(
		local.pinnedItems,
		remote.pinnedItems,
		local.tombstones?.pinned,
		remote.tombstones?.pinned,
		(obj) => toTimestamp(obj?.date_added),
		now,
		0
	);

	// ---- settings (whole object, last writer wins)
	const lAt = Number(local.settingsModifiedAt ?? 0);
	const rAt = Number(remote.settingsModifiedAt ?? 0);
	let settings = local.settings;
	let settingsModifiedAt = lAt;
	if (remote.settings && rAt > lAt) {
		settings = restoreLocalOnly(remote.settings, local.settings);
		settingsModifiedAt = rAt;
	} else if (!local.settings && remote.settings) {
		settings = restoreLocalOnly(remote.settings, {});
		settingsModifiedAt = rAt;
	}

	const merged = {
		settings,
		settingsModifiedAt,
		hiddenItems: hidden.items,
		pinnedItems: pinned.items,
		tombstones: { hidden: hidden.removed, pinned: pinned.removed },
	};

	const changedLocal =
		!sameJSON(merged.hiddenItems, local.hiddenItems || {}) ||
		!sameJSON(merged.pinnedItems, local.pinnedItems || {}) ||
		!sameJSON(merged.tombstones, {
			hidden: local.tombstones?.hidden || {},
			pinned: local.tombstones?.pinned || {},
		}) ||
		(settingsModifiedAt !== lAt && !sameJSON(stripLocalOnly(merged.settings), stripLocalOnly(local.settings)));

	const changedRemote =
		!sameJSON(merged.hiddenItems, remote.hiddenItems || {}) ||
		!sameJSON(merged.pinnedItems, remote.pinnedItems || {}) ||
		!sameJSON(merged.tombstones, {
			hidden: remote.tombstones?.hidden || {},
			pinned: remote.tombstones?.pinned || {},
		}) ||
		settingsModifiedAt !== rAt;

	return {
		state: merged,
		changedLocal,
		changedRemote,
		settingsFromRemote: settingsModifiedAt !== lAt,
	};
}

/** The object written to the shared file: the state minus the local-only settings. */
export function toFile(state, now = Date.now()) {
	return {
		format: 1,
		written: now,
		settings: stripLocalOnly(state.settings),
		settingsModifiedAt: state.settingsModifiedAt || 0,
		hiddenItems: state.hiddenItems || {},
		pinnedItems: state.pinnedItems || {},
		tombstones: {
			hidden: state.tombstones?.hidden || {},
			pinned: state.tombstones?.pinned || {},
		},
	};
}

/** Validate/normalise a parsed file. Throws on anything that is not a recognisable sync file. */
export function parseFile(obj) {
	if (!obj || typeof obj !== "object" || obj.format !== 1) {
		throw new Error("Not a VineSmyths sync file (unknown format)");
	}
	return {
		settings: obj.settings && typeof obj.settings === "object" ? obj.settings : undefined,
		settingsModifiedAt: Number(obj.settingsModifiedAt ?? 0),
		hiddenItems: obj.hiddenItems && typeof obj.hiddenItems === "object" ? obj.hiddenItems : {},
		pinnedItems: obj.pinnedItems && typeof obj.pinnedItems === "object" ? obj.pinnedItems : {},
		tombstones: {
			hidden: obj.tombstones?.hidden || {},
			pinned: obj.tombstones?.pinned || {},
		},
	};
}
