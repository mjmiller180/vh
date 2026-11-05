/**
 * Folder sync engine (dependency-injected so it can be tested in Node with a fake folder).
 *
 * The user picks a folder (typically inside Google Drive for Desktop). One JSON file in it,
 * vine-helper-sync.json, holds the settings and the hidden/pinned lists. Every device that points at
 * the same folder merges its state with that file (see SyncMerge.js).
 *
 * Nothing leaves the computer except through the user's own Drive client writing that file.
 */
import { mergeState, toFile, parseFile } from "../core/utils/SyncMerge.js";

export const SYNC_FILE_NAME = "vine-helper-sync.json";
const STATE_KEYS = ["settings", "settingsModifiedAt", "hiddenItems", "pinnedItems", "syncTombstones"];

// hiddenItems / pinnedItems used to be stored as JSON strings in older versions.
function normaliseMap(v) {
	if (!v) return {};
	if (typeof v === "string") {
		try {
			v = JSON.parse(v);
		} catch (e) {
			return {};
		}
	}
	if (Array.isArray(v)) return Object.fromEntries(v);
	return typeof v === "object" ? v : {};
}

export function createFolderSync({ handleStore, storage, notifyTabs = () => {}, fileName = SYNC_FILE_NAME, now = Date.now }) {
	let chain = Promise.resolve();

	async function readLocal() {
		const d = await storage.get(STATE_KEYS);
		return {
			settings: d.settings,
			settingsModifiedAt: d.settingsModifiedAt || 0,
			hiddenItems: normaliseMap(d.hiddenItems),
			pinnedItems: normaliseMap(d.pinnedItems),
			tombstones: { hidden: d.syncTombstones?.hidden || {}, pinned: d.syncTombstones?.pinned || {} },
		};
	}

	async function writeLocal(state, settingsChanged) {
		const out = {
			hiddenItems: state.hiddenItems,
			pinnedItems: state.pinnedItems,
			syncTombstones: state.tombstones,
		};
		if (settingsChanged) {
			out.settings = state.settings;
			out.settingsModifiedAt = state.settingsModifiedAt;
		}
		await storage.set(out);
	}

	async function readRemote(dir) {
		let fh;
		try {
			fh = await dir.getFileHandle(fileName, { create: false });
		} catch (e) {
			if (e && (e.name === "NotFoundError" || e.name === "TypeMismatchError")) return { exists: false, state: {} };
			throw e;
		}
		const text = await (await fh.getFile()).text();
		if (text.trim() === "") return { exists: true, state: {} }; // freshly created / being synced by Drive
		let parsed;
		try {
			parsed = JSON.parse(text);
		} catch (e) {
			throw new Error("The sync file is not valid JSON (refusing to overwrite it): " + e.message);
		}
		return { exists: true, state: parseFile(parsed) };
	}

	async function writeRemote(dir, state) {
		const fh = await dir.getFileHandle(fileName, { create: true });
		const w = await fh.createWritable();
		await w.write(JSON.stringify(toFile(state, now()), null, 1));
		await w.close();
	}

	async function permissionOf(handle) {
		try {
			return await handle.queryPermission({ mode: "readwrite" });
		} catch (e) {
			return "denied";
		}
	}

	async function setMeta(patch) {
		const cur = (await storage.get(["syncMeta"])).syncMeta || {};
		await storage.set({ syncMeta: { ...cur, ...patch } });
	}

	async function runOnce(reason) {
		const handle = await handleStore.get();
		if (!handle) return { ok: false, reason: "not-configured" };
		const perm = await permissionOf(handle);
		if (perm !== "granted") {
			await setMeta({ lastError: "Folder access needs to be re-authorized (open the settings page and press the Sync button)." });
			return { ok: false, reason: "permission", needsPermission: true };
		}
		try {
			const local = await readLocal();
			const remote = await readRemote(handle);
			const res = mergeState(local, remote.state, now());
			if (res.changedLocal) await writeLocal(res.state, res.settingsFromRemote);
			if (res.changedRemote || !remote.exists) await writeRemote(handle, res.state);
			await setMeta({
				lastSync: now(),
				lastError: null,
				lastReason: reason,
				lastChangedLocal: res.changedLocal ? now() : (await storage.get(["syncMeta"])).syncMeta?.lastChangedLocal || null,
			});
			if (res.changedLocal) notifyTabs({ settings: res.settingsFromRemote, lists: true });
			return {
				ok: true,
				pulled: res.changedLocal,
				pushed: res.changedRemote || !remote.exists,
				hidden: Object.keys(res.state.hiddenItems).length,
				pinned: Object.keys(res.state.pinnedItems).length,
			};
		} catch (e) {
			await setMeta({ lastError: String(e.message || e) });
			return { ok: false, reason: "error", error: String(e.message || e) };
		}
	}

	return {
		/** Merge local state with the shared file (never runs two at once). */
		syncNow(reason = "manual") {
			const p = chain.then(() => runOnce(reason));
			chain = p.catch(() => {});
			return p;
		},
		async getStatus() {
			const handle = await handleStore.get();
			const meta = (await storage.get(["syncMeta"])).syncMeta || {};
			return {
				configured: !!handle,
				folderName: handle ? handle.name : null,
				permission: handle ? await permissionOf(handle) : null,
				lastSync: meta.lastSync || null,
				lastError: meta.lastError || null,
			};
		},
	};
}
