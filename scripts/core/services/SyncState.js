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

/** Remember that `asin` was removed from the `kind` ("hidden" | "pinned") list just now. */
export async function recordRemoval(kind, asin) {
	const t = await readTombstones();
	t[kind][asin] = Date.now();
	await chrome.storage.local.set({ [REMOVAL_KEY]: t });
}

/** The item was (re-)added: any older removal record is obsolete. */
export async function clearRemoval(kind, asin) {
	const t = await readTombstones();
	if (t[kind][asin] === undefined) return;
	delete t[kind][asin];
	await chrome.storage.local.set({ [REMOVAL_KEY]: t });
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
