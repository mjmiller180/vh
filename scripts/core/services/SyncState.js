/*global chrome*/
/**
 * Content-script side of the folder sync.
 *  - records removals (un-hide / un-pin) so another device learns about them
 *  - asks the service worker to run a sync (debounced)
 * The actual file access happens in the service worker (see FolderSync.js).
 */

const REMOVAL_KEY = "syncTombstones";
let timer = null;

async function readTombstones() {
	const data = await chrome.storage.local.get(REMOVAL_KEY);
	const t = data[REMOVAL_KEY] || {};
	return { hidden: t.hidden || {}, pinned: t.pinned || {} };
}

// The tombstone object is read-modify-written; the Web Locks API serialises that across tabs
// (same origin) so two tabs removing items at once cannot lose each other's record.
function withLock(fn) {
	if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request("vh-sync-tombstones", fn);
	return fn();
}

/**
 * Record what the user just did to a list so that other devices can learn about it:
 * `removed` ASINs get a removal record (un-hide / un-pin), `added` ASINs lose any older removal record.
 * Only EXPLICIT user actions are passed in here (never garbage collection or quota trimming).
 * @param {"hidden"|"pinned"} kind
 */
export async function recordListChange(kind, removed = [], added = []) {
	if (removed.length === 0 && added.length === 0) return;
	await withLock(async () => {
		const t = await readTombstones();
		const now = Date.now();
		let changed = false;
		for (const asin of removed) {
			t[kind][asin] = now;
			changed = true;
		}
		for (const asin of added) {
			if (t[kind][asin] !== undefined) {
				delete t[kind][asin];
				changed = true;
			}
		}
		if (changed) await chrome.storage.local.set({ [REMOVAL_KEY]: t });
	});
}

/** Ask the service worker to sync with the shared folder soon (no-op if no folder is configured). */
export function requestSync(delayMs = 2000) {
	clearTimeout(timer);
	timer = setTimeout(() => {
		try {
			chrome.runtime.sendMessage({ type: "folderSync", reason: "change" }, () => void chrome.runtime.lastError);
		} catch (e) {
			// Extension context invalidated (extension reloaded); nothing to do.
		}
	}, delayMs);
}

/** Run a sync now and wait for the result (used once at page load). Never rejects. */
export function syncNow(reason = "load", timeoutMs = 4000) {
	return new Promise((resolve) => {
		const t = setTimeout(() => resolve({ ok: false, timeout: true }), timeoutMs);
		try {
			chrome.runtime.sendMessage({ type: "folderSync", reason }, (res) => {
				clearTimeout(t);
				void chrome.runtime.lastError;
				resolve(res || { ok: false });
			});
		} catch (e) {
			clearTimeout(t);
			resolve({ ok: false });
		}
	});
}
