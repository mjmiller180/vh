import test from "node:test";
import assert from "node:assert/strict";
import { createFolderSync, SYNC_FILE_NAME } from "../../scripts/background/FolderSyncCore.js";

// ---- fakes -------------------------------------------------------------------------------
class FakeDir {
	constructor(name = "Drive/VineHelper") { this.name = name; this.files = new Map(); this.perm = "granted"; }
	async queryPermission() { return this.perm; }
	async getFileHandle(n, { create } = {}) {
		if (!this.files.has(n)) {
			if (!create) { const e = new Error("nf"); e.name = "NotFoundError"; throw e; }
			this.files.set(n, "");
		}
		const files = this.files;
		return {
			getFile: async () => ({ text: async () => files.get(n) }),
			createWritable: async () => { let buf = ""; return { write: async (s) => { buf += s; }, close: async () => { files.set(n, buf); } }; },
		};
	}
}
const fakeStorage = (init = {}) => { const m = { ...init }; return { m, get: async (keys) => Object.fromEntries(keys.filter((k) => k in m).map((k) => [k, structuredClone(m[k])])), set: async (o) => { Object.assign(m, structuredClone(o)); } }; };
const device = (dir, init, clock) => {
	const storage = fakeStorage(init);
	const notified = [];
	const sync = createFolderSync({ handleStore: { get: async () => dir }, storage, notifyTabs: (x) => notified.push(x), now: () => clock.t });
	return { storage, sync, notified };
};
const T0 = 1_800_000_000_000;
const base = (extra = {}) => ({ settings: { general: { country: "com", color: "red" } }, settingsModifiedAt: 0, hiddenItems: {}, pinnedItems: {}, ...extra });

test("not configured / no permission do nothing and say why", async () => {
	const clock = { t: T0 };
	const a = device(null, base(), clock);
	assert.equal((await a.sync.syncNow()).reason, "not-configured");
	const dir = new FakeDir(); dir.perm = "prompt";
	const b = device(dir, base(), clock);
	const r = await b.sync.syncNow();
	assert.deepEqual([r.ok, r.needsPermission], [false, true]);
	assert.equal(dir.files.size, 0);
});

test("first sync creates the file; second device picks the data up", async () => {
	const dir = new FakeDir(); const clock = { t: T0 };
	const A = device(dir, base({ hiddenItems: { H1: T0 - 1000 }, pinnedItems: { P1: { date_added: T0 - 2000, title: "pin" } }, settingsModifiedAt: T0 - 500, settings: { general: { country: "com", color: "blue" } } }), clock);
	const r1 = await A.sync.syncNow();
	assert.equal(r1.ok, true); assert.equal(r1.pushed, true);
	assert.ok(dir.files.has(SYNC_FILE_NAME));
	const onDisk = JSON.parse(dir.files.get(SYNC_FILE_NAME));
	assert.equal(onDisk.settings.general.country, undefined, "device-local setting must not be shared");
	assert.equal(onDisk.settings.general.color, "blue");

	const B = device(dir, base({ settings: { general: { country: "de", color: "red" } } }), clock);
	const r2 = await B.sync.syncNow();
	assert.equal(r2.pulled, true);
	assert.deepEqual(Object.keys(B.storage.m.hiddenItems), ["H1"]);
	assert.equal(B.storage.m.pinnedItems.P1.title, "pin");
	assert.equal(B.storage.m.settings.general.color, "blue", "newer settings adopted");
	assert.equal(B.storage.m.settings.general.country, "de", "own country preserved");
	assert.deepEqual(B.notified[0], { settings: true, lists: true });
});

test("un-hide on B propagates to A", async () => {
	const dir = new FakeDir(); const clock = { t: T0 };
	const A = device(dir, base({ hiddenItems: { X: T0 - 5000 } }), clock);
	await A.sync.syncNow();
	const B = device(dir, base(), clock);
	await B.sync.syncNow();
	clock.t = T0 + 1000;
	// B un-hides X (what HiddenListMgr + SyncState do)
	B.storage.m.hiddenItems = {}; B.storage.m.syncTombstones = { hidden: { X: clock.t }, pinned: {} };
	await B.sync.syncNow();
	clock.t = T0 + 2000;
	const r = await A.sync.syncNow();
	assert.equal(r.pulled, true);
	assert.deepEqual(A.storage.m.hiddenItems, {});
});

test("legacy string-encoded lists are understood", async () => {
	const dir = new FakeDir(); const clock = { t: T0 };
	const A = device(dir, base({ hiddenItems: JSON.stringify({ L1: T0 - 10 }), pinnedItems: JSON.stringify([["P9", { date_added: T0 - 20, title: "legacy" }]]) }), clock);
	assert.equal((await A.sync.syncNow()).ok, true);
	const f = JSON.parse(dir.files.get(SYNC_FILE_NAME));
	assert.deepEqual(Object.keys(f.hiddenItems), ["L1"]);
	assert.equal(f.pinnedItems.P9.title, "legacy");
});

test("a corrupt sync file is never overwritten", async () => {
	const dir = new FakeDir(); const clock = { t: T0 };
	dir.files.set(SYNC_FILE_NAME, "{ this is not json");
	const A = device(dir, base({ hiddenItems: { H: T0 - 1 } }), clock);
	const r = await A.sync.syncNow();
	assert.equal(r.ok, false);
	assert.equal(dir.files.get(SYNC_FILE_NAME), "{ this is not json");
	assert.match((await A.sync.getStatus()).lastError, /not valid JSON/);
	// an unrelated JSON file is refused too
	dir.files.set(SYNC_FILE_NAME, JSON.stringify({ hello: "world" }));
	assert.equal((await A.sync.syncNow()).ok, false);
	assert.equal(JSON.parse(dir.files.get(SYNC_FILE_NAME)).hello, "world");
});

test("empty file (Drive still downloading) is treated as empty, not as an error", async () => {
	const dir = new FakeDir(); const clock = { t: T0 };
	dir.files.set(SYNC_FILE_NAME, "");
	const A = device(dir, base({ hiddenItems: { H: T0 - 1 } }), clock);
	assert.equal((await A.sync.syncNow()).ok, true);
});

test("repeat sync with no change writes nothing", async () => {
	const dir = new FakeDir(); const clock = { t: T0 };
	const A = device(dir, base({ hiddenItems: { H: T0 - 1 } }), clock);
	await A.sync.syncNow();
	const before = dir.files.get(SYNC_FILE_NAME);
	clock.t += 60000;
	const r = await A.sync.syncNow();
	assert.deepEqual([r.pulled, r.pushed], [false, false]);
	assert.equal(dir.files.get(SYNC_FILE_NAME), before);
});

test("concurrent syncNow calls are serialised", async () => {
	const dir = new FakeDir(); const clock = { t: T0 };
	const A = device(dir, base({ hiddenItems: { H: T0 - 1 } }), clock);
	const rs = await Promise.all([A.sync.syncNow(), A.sync.syncNow(), A.sync.syncNow()]);
	assert.ok(rs.every((r) => r.ok));
});

// ---- review finding I3: a local change made while the sync is reading the file must not be overwritten
test("a hide made while the sync is reading the shared file is not lost (sync re-merges)", async () => {
	const dir = new FakeDir(); const clock = { t: T0 };
	const A = device(dir, base({ hiddenItems: { H1: T0 - 5000 } }), clock);
	await A.sync.syncNow(); // file now exists
	// B pushes something so that A has real work to do
	const B = device(dir, base({ hiddenItems: { FROM_B: T0 - 1000 } }), clock);
	await B.sync.syncNow();
	// While A reads the file, the user hides another item in a tab
	const realGetHandle = dir.getFileHandle.bind(dir);
	let injected = false;
	dir.getFileHandle = async (n, o) => {
		const fh = await realGetHandle(n, o);
		if (!injected && n === SYNC_FILE_NAME) {
			injected = true;
			A.storage.m.hiddenItems = { ...A.storage.m.hiddenItems, HIDDEN_DURING_SYNC: T0 - 10 };
		}
		return fh;
	};
	clock.t = T0 + 1000;
	const r = await A.sync.syncNow();
	assert.equal(r.ok, true, JSON.stringify(r));
	assert.ok(A.storage.m.hiddenItems.HIDDEN_DURING_SYNC, "local hide was overwritten");
	assert.ok(A.storage.m.hiddenItems.FROM_B, "remote item was not pulled");
	assert.ok(JSON.parse(dir.files.get(SYNC_FILE_NAME)).hiddenItems.HIDDEN_DURING_SYNC, "hide was not pushed");
});

test("sync only rewrites the local keys that actually changed", async () => {
	const dir = new FakeDir(); const clock = { t: T0 };
	const A = device(dir, base({ hiddenItems: { H1: T0 - 5000 }, pinnedItems: { P: { date_added: T0 - 9, title: "p" } } }), clock);
	await A.sync.syncNow();
	const B = device(dir, base({ hiddenItems: { FROM_B: T0 - 1000 } }), clock);
	await B.sync.syncNow();
	const writes = [];
	const realSet = A.storage.set;
	A.storage.set = async (o) => { writes.push(Object.keys(o)); return realSet(o); };
	clock.t += 5000;
	await A.sync.syncNow();
	const written = writes.flat();
	assert.ok(written.includes("hiddenItems"));
	assert.ok(!written.includes("pinnedItems"), "untouched list must not be rewritten: " + JSON.stringify(written));
	assert.ok(!written.includes("settings"));
});
