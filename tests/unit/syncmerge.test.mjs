// Last compiled at 2026-11-04_2317
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
import test from "node:test";
import assert from "node:assert/strict";
import { mergeState, toFile, parseFile, stripLocalOnly, restoreLocalOnly } from "../../scripts/core/utils/SyncMerge.js";

const NOW = 1_800_000_000_000;
const D = 24 * 3600 * 1000;
const S = (o = {}) => ({ settings: { general: { country: "com", x: 1 }, metrics: { minutesUsed: 5 } }, settingsModifiedAt: 0, hiddenItems: {}, pinnedItems: {}, tombstones: { hidden: {}, pinned: {} }, ...o });

test("union of hidden items from two devices", () => {
	const a = S({ hiddenItems: { A1: NOW - D } });
	const b = S({ hiddenItems: { B1: NOW - 2 * D } });
	const m = mergeState(a, b, NOW);
	assert.deepEqual(Object.keys(m.state.hiddenItems).sort(), ["A1", "B1"]);
	assert.equal(m.changedLocal, true);
	assert.equal(m.changedRemote, true);
});

test("un-hide on one device propagates (tombstone newer than add)", () => {
	const a = S({ tombstones: { hidden: { A1: NOW - D }, pinned: {} } });           // A un-hid at -1d
	const b = S({ hiddenItems: { A1: NOW - 5 * D } });                                // B still has it from -5d
	const m = mergeState(a, b, NOW);
	assert.deepEqual(m.state.hiddenItems, {});
	assert.equal(m.state.tombstones.hidden.A1, NOW - D);
});

test("re-hide after un-hide wins (add newer than tombstone)", () => {
	const a = S({ hiddenItems: { A1: NOW - D } });
	const b = S({ tombstones: { hidden: { A1: NOW - 3 * D }, pinned: {} } });
	const m = mergeState(a, b, NOW);
	assert.deepEqual(Object.keys(m.state.hiddenItems), ["A1"]);
	assert.deepEqual(m.state.tombstones.hidden, {});
});

test("hidden items older than 90 days are not resurrected from the other side", () => {
	const a = S();
	const b = S({ hiddenItems: { OLD: NOW - 100 * D, NEW: NOW - D } });
	const m = mergeState(a, b, NOW);
	assert.deepEqual(Object.keys(m.state.hiddenItems), ["NEW"]);
});

test("pinned merge keeps item data and honours un-pin", () => {
	const item = (t, ts) => ({ date_added: ts, title: t, queue: "potluck" });
	const a = S({ pinnedItems: { P1: item("one", NOW - D) }, tombstones: { hidden: {}, pinned: { P2: NOW - D } } });
	const b = S({ pinnedItems: { P2: item("two", NOW - 4 * D), P3: item("three", NOW - 2 * D) } });
	const m = mergeState(a, b, NOW);
	assert.deepEqual(Object.keys(m.state.pinnedItems).sort(), ["P1", "P3"]);
	assert.equal(m.state.pinnedItems.P3.title, "three");
});

test("settings: newer side wins, local-only keys are kept", () => {
	const a = S({ settings: { general: { country: "com", x: 1 }, metrics: { minutesUsed: 5 } }, settingsModifiedAt: 100 });
	const b = S({ settings: { general: { country: "de", x: 2 }, metrics: { minutesUsed: 99 } }, settingsModifiedAt: 200 });
	const m = mergeState(a, b, NOW);
	assert.equal(m.state.settings.general.x, 2);
	assert.equal(m.state.settings.general.country, "com");
	assert.equal(m.state.settings.metrics.minutesUsed, 5);
	assert.equal(m.settingsFromRemote, true);
	// and the other way round
	const m2 = mergeState(b, a, NOW);
	assert.equal(m2.state.settings.general.x, 2);
	assert.equal(m2.state.settings.general.country, "de");
});

test("identical states report no change", () => {
	const a = S({ hiddenItems: { A1: NOW - D }, settingsModifiedAt: 5 });
	const m = mergeState(a, structuredClone(a), NOW);
	assert.equal(m.changedLocal, false);
	assert.equal(m.changedRemote, false);
});

test("empty remote (first sync) pushes everything and changes nothing locally", () => {
	const a = S({ hiddenItems: { A1: NOW - D }, settingsModifiedAt: 5 });
	const m = mergeState(a, {}, NOW);
	assert.equal(m.changedLocal, false);
	assert.equal(m.changedRemote, true);
	assert.deepEqual(m.state.hiddenItems, a.hiddenItems);
});

test("file round trip never contains local-only settings and rejects junk", () => {
	const f = toFile(S({ settings: { general: { country: "com", x: 1 }, metrics: { m: 1 }, sync: { folderName: "z" } } }), NOW);
	assert.equal(f.settings.metrics, undefined);
	assert.equal(f.settings.general.country, undefined);
	assert.equal(f.settings.sync, undefined);
	assert.equal(parseFile(JSON.parse(JSON.stringify(f))).settings.general.x, 1);
	assert.throws(() => parseFile({ nope: 1 }));
	assert.throws(() => parseFile(null));
});

test("old tombstones are pruned", () => {
	const a = S({ tombstones: { hidden: { X: NOW - 200 * D }, pinned: {} } });
	const m = mergeState(a, S(), NOW);
	assert.deepEqual(m.state.tombstones.hidden, {});
});

// ---- review finding I4: odd timestamps / legacy shapes must never make the merge drop a user's items
import { normaliseListMap, toTimestamp } from "../../scripts/core/utils/SyncMerge.js";

test("toTimestamp: numbers, numeric strings, ISO dates; unknown -> 0 (never NaN)", () => {
	assert.equal(toTimestamp(123), 123);
	assert.equal(toTimestamp("456"), 456);
	assert.equal(toTimestamp("2026-01-02T00:00:00Z"), Date.parse("2026-01-02T00:00:00Z"));
	for (const bad of [null, undefined, {}, [], "garbage", NaN, Infinity]) assert.equal(toTimestamp(bad), 0, String(bad));
});

test("hidden items with ISO-string / junk timestamps survive a merge instead of being dropped", () => {
	const local = S({ hiddenItems: { A: new Date(NOW - D).toISOString(), B: {}, C: null, D: NOW - 2 * D } });
	const m = mergeState(local, S(), NOW);
	assert.deepEqual(Object.keys(m.state.hiddenItems).sort(), ["A", "B", "C", "D"]);
	// the original values are kept untouched (we never rewrite the user's data format)
	assert.equal(m.state.hiddenItems.A, local.hiddenItems.A);
});

test("a pinned item with a string date_added survives; an un-pin newer than it still wins", () => {
	const local = S({ pinnedItems: { P1: { date_added: new Date(NOW - 3 * D).toISOString(), title: "x" }, P2: { title: "no date" } } });
	const m = mergeState(local, S({ tombstones: { hidden: {}, pinned: { P1: NOW - D } } }), NOW);
	assert.deepEqual(Object.keys(m.state.pinnedItems), ["P2"]);
});

test("items of unknown age are kept (not expired by the 90 day rule) unless explicitly removed", () => {
	const m = mergeState(S({ hiddenItems: { X: "???" } }), S(), NOW);
	assert.deepEqual(Object.keys(m.state.hiddenItems), ["X"]);
	const m2 = mergeState(S({ hiddenItems: { X: "???" } }), S({ tombstones: { hidden: { X: NOW - D }, pinned: {} } }), NOW);
	assert.deepEqual(m2.state.hiddenItems, {});
});

test("normaliseListMap understands object, JSON string, [[asin,value]] pairs and legacy [{asin,...}] arrays", () => {
	assert.deepEqual(normaliseListMap({ A: 1 }, "hidden"), { A: 1 });
	assert.deepEqual(normaliseListMap(JSON.stringify({ A: 1 }), "hidden"), { A: 1 });
	assert.deepEqual(normaliseListMap([["A", 5], ["B", 6]], "hidden"), { A: 5, B: 6 });
	assert.deepEqual(normaliseListMap([{ asin: "A", date: "2024-01-01" }], "hidden"), { A: "2024-01-01" });
	assert.deepEqual(normaliseListMap([{ asin: "P", title: "t", thumbnail: "u" }], "pinned"), { P: { title: "t", thumbnail: "u" } });
	for (const junk of [null, undefined, "not json", 42, true]) assert.deepEqual(normaliseListMap(junk, "hidden"), {});
});
