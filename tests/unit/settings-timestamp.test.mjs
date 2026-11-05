// Review finding C1/I1/I2: settingsModifiedAt must only move on real user edits, so a freshly installed
// (or merely opened) device never looks "newer" than the shared file; secrets stay device-local.
import test from "node:test";
import assert from "node:assert/strict";
import { SettingsMgrDI } from "../../scripts/core/services/SettingsMgrDI.js";
import { MemoryStorageAdapter } from "../../scripts/infrastructure/StorageAdapter.js";
import { mergeState, stripLocalOnly, isLocalOnlySetting } from "../../scripts/core/utils/SyncMerge.js";

const quiet = { add() {} };
async function fresh(initial) {
	const storage = new MemoryStorageAdapter();
	if (initial) for (const [k, v] of Object.entries(initial)) await storage.set(k, v);
	const s = new SettingsMgrDI(storage, quiet);
	await s.waitForLoad();
	return { s, storage };
}
const stamp = (storage) => storage.get("settingsModifiedAt");

test("a brand new install is 'pristine': timestamp 0", async () => {
	const { storage } = await fresh();
	assert.equal(await stamp(storage), 0);
});

test("automatic / device-local writes never bump the timestamp", async () => {
	const { s, storage } = await fresh();
	await s.set("general.versionInfoPopup", "4.5");
	await s.set("hiddenTab.lastGC", 12345);
	await s.set("checkout.currentASIN", "B0TEST");
	await s.set("crypto.privateKey", { k: 1 });
	await s.set("metrics.minutesUsed", 7);
	await s.set("general.country", "com");
	assert.equal(await stamp(storage), 0);
});

test("materialising a default value (settings page does this just by opening) does not bump", async () => {
	const { s, storage } = await fresh();
	const key = "general.blindLoading"; // default false
	s.get(key); // exists via defaults
	await s.set(key, false);
	assert.equal(await stamp(storage), 0);
});

test("writing 'false' to a setting that has no default yet (settings page does this) does not bump", async () => {
	const { s, storage } = await fresh();
	assert.equal(s.get("thorvarium.darktheme"), undefined);
	await s.set("thorvarium.darktheme", false);
	assert.equal(await stamp(storage), 0);
	await s.set("thorvarium.darktheme", true); // ...but really turning it on is an edit
	assert.ok((await stamp(storage)) > 0);
});

test("a real user edit bumps the timestamp", async () => {
	const { s, storage } = await fresh();
	const before = Date.now();
	await s.set("general.toolbarBackgroundColor", "#123456");
	assert.ok((await stamp(storage)) >= before);
});

test("fresh device vs populated shared file: the file's settings win", async () => {
	const { s, storage } = await fresh();
	await s.set("general.versionInfoPopup", "4.5"); // what the first page load does
	await s.set("general.blindLoading", false); // what opening the settings page does
	const local = { settings: await storage.get("settings"), settingsModifiedAt: await stamp(storage), hiddenItems: {}, pinnedItems: {}, tombstones: { hidden: {}, pinned: {} } };
	const remote = { settings: { general: { hideKeywords: [{ contains: "x" }] }, discord: { active: true } }, settingsModifiedAt: Date.now() - 3600_000, hiddenItems: {}, pinnedItems: {}, tombstones: { hidden: {}, pinned: {} } };
	const m = mergeState(local, remote, Date.now());
	assert.equal(m.settingsFromRemote, true);
	assert.deepEqual(m.state.settings.general.hideKeywords, [{ contains: "x" }]);
	assert.equal(m.state.settings.discord.active, true);
});

test("secrets and device identity are never in the shared file", () => {
	const settings = { crypto: { privateKey: {}, rsaPrivateKey: {} }, general: { uuid: "u", fingerprint: { id: 1 }, cid: "c", patreon: { tier: 3 }, deviceName: "pc", country: "com", versionInfoPopup: "4.5", highlightColor: { color: "#fff" } }, checkout: { currentASIN: "A" }, hiddenTab: { lastGC: 1, active: true } };
	const out = stripLocalOnly(settings);
	assert.equal(out.crypto, undefined);
	assert.equal(out.checkout, undefined);
	assert.equal(out.hiddenTab.lastGC, undefined);
	assert.equal(out.hiddenTab.active, true);
	for (const k of ["uuid", "fingerprint", "cid", "patreon", "deviceName", "country", "versionInfoPopup"]) assert.equal(out.general[k], undefined, k);
	assert.equal(out.general.highlightColor.color, "#fff");
	assert.equal(isLocalOnlySetting("crypto.rsaPrivateKey"), true);
	assert.equal(isLocalOnlySetting("general.highlightColor.color"), false);
});

test("legacy server-era keys are purged from stored settings on load", async () => {
	const { s } = await fresh({ settings: { general: { uuid: "old", fingerprint: { id: 1 }, cid: "c", patreon: { tier: 3 }, deviceName: "x", uuidError: "e", blindLoading: true }, discord: { guid: "g", active: true } } });
	assert.equal(s.get("general.uuid", false), undefined);
	assert.equal(s.get("general.fingerprint", false), undefined);
	assert.equal(s.get("general.patreon", false), undefined);
	assert.equal(s.get("discord.guid", false), undefined);
	assert.equal(s.get("general.blindLoading"), true, "real settings must survive the purge");
	assert.equal(s.get("discord.active"), true);
});
