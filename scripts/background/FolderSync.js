/*global chrome, indexedDB*/
/**
 * Browser bindings for the folder sync: the chosen folder handle is kept in IndexedDB (extension
 * origin, so the settings page and the service worker see the same one) and the state lives in
 * chrome.storage.local.
 */
import { createFolderSync } from "/scripts/background/FolderSyncCore.js";

const DB_NAME = "vh-folder-sync";
const STORE = "handles";
const KEY = "folder";

function openDb() {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function tx(mode, fn) {
	const db = await openDb();
	try {
		return await new Promise((resolve, reject) => {
			const t = db.transaction(STORE, mode);
			const r = fn(t.objectStore(STORE));
			t.oncomplete = () => resolve(r && r.result);
			t.onerror = () => reject(t.error);
			t.onabort = () => reject(t.error);
		});
	} finally {
		db.close();
	}
}

export const handleStore = {
	get: () => tx("readonly", (s) => s.get(KEY)).then((h) => h || null),
	set: (h) => tx("readwrite", (s) => s.put(h, KEY)),
	clear: () => tx("readwrite", (s) => s.delete(KEY)),
};

const storage = {
	get: (keys) => chrome.storage.local.get(keys),
	set: (obj) => chrome.storage.local.set(obj),
};

export function createBrowserFolderSync(notifyTabs) {
	return createFolderSync({ handleStore, storage, notifyTabs });
}

/** Settings page only (needs a user gesture): let the user pick the shared folder. */
export async function pickFolder() {
	const handle = await window.showDirectoryPicker({ id: "vine-helper-sync", mode: "readwrite" });
	await handleStore.set(handle);
	return handle;
}

/** Settings page only (needs a user gesture): (re)grant read/write access to the saved folder. */
export async function requestFolderPermission() {
	const handle = await handleStore.get();
	if (!handle) return "none";
	return handle.requestPermission({ mode: "readwrite" });
}
