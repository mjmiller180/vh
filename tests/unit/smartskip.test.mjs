// Last compiled at 2026-11-05_0049
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
// SmartSkip decision logic (pure functions).
import test from "node:test";
import assert from "node:assert/strict";
import { MIN_DELAY_MS, DEFAULT_MAX_PAGES, HARD_MAX_PAGES, normaliseMaxPages, clampRange, pickDelay, formatDuration, decidePage, newSession, parseState, keyMatches, startUrl } from "../../scripts/core/utils/SmartSkipLogic.js";

test("delays: parsed from strings, never below the safety floor, max never below min", () => {
	assert.deepEqual(clampRange("2500", "4000", { min: 2500, max: 4000 }), { min: 2500, max: 4000 });
	assert.deepEqual(clampRange(100, 200, { min: 2500, max: 4000 }), { min: MIN_DELAY_MS, max: MIN_DELAY_MS });
	assert.deepEqual(clampRange(5000, 3000, { min: 2500, max: 4000 }), { min: 5000, max: 5000 });
	assert.deepEqual(clampRange("abc", undefined, { min: 2500, max: 4000 }), { min: 2500, max: 4000 });
});

test("pickDelay stays within the range (inclusive) and is deterministic for a given random source", () => {
	const r = { min: 2500, max: 4000 };
	assert.equal(pickDelay(r, () => 0), 2500);
	assert.equal(pickDelay(r, () => 0.999999), 4000);
	for (let i = 0; i < 200; i++) {
		const v = pickDelay(r);
		assert.ok(v >= 2500 && v <= 4000);
	}
	assert.equal(pickDelay({ min: 3500, max: 3500 }), 3500);
});

test("formatDuration", () => {
	assert.equal(formatDuration(0), "0s");
	assert.equal(formatDuration(-5), "0s");
	assert.equal(formatDuration(59_000), "59s");
	assert.equal(formatDuration(125_000), "2m 5s");
});

test("decidePage: unpinned items stop the scan; all-pinned / empty pages are skipped; the page limit stops after exactly N pages", () => {
	assert.equal(decidePage({ unpinnedCount: 1, seen: 1, maxPages: 300 }), "found");
	assert.equal(decidePage({ unpinnedCount: 0, seen: 1, maxPages: 300 }), "skip");
	assert.equal(decidePage({ unpinnedCount: 0, seen: 299, maxPages: 300 }), "skip");
	assert.equal(decidePage({ unpinnedCount: 0, seen: 300, maxPages: 300 }), "limit", "the 300th page is the last one scanned");
	assert.equal(decidePage({ unpinnedCount: 5, seen: 300, maxPages: 300 }), "found", "new items on the last allowed page are still reported");
	assert.equal(decidePage({ unpinnedCount: 0, seen: 2, maxPages: 2 }), "limit");
});

test("the page limit can never be switched off by a blank or junk setting", () => {
	for (const bad of ["", "   ", "abc", null, undefined, NaN, -5, 0, "0"]) assert.equal(normaliseMaxPages(bad), DEFAULT_MAX_PAGES, String(bad));
	assert.equal(normaliseMaxPages("25"), 25);
	assert.equal(normaliseMaxPages(99999), HARD_MAX_PAGES);
	assert.equal(decidePage({ unpinnedCount: 0, seen: DEFAULT_MAX_PAGES, maxPages: "garbage" }), "limit");
});

test("state: sanitised on read, so tampered or corrupt sessionStorage cannot inject anything", () => {
	const s = newSession(1000);
	assert.deepEqual(parseState(JSON.stringify(s)), s);
	assert.equal(parseState(null), null);
	assert.equal(parseState("{not json"), null);
	assert.equal(parseState(JSON.stringify({ status: "<img onerror=x>" })), null);
	const t = parseState(JSON.stringify({ status: "running", seen: "7", skips: -3, found: "<b>9</b>", consecutive: 1e99, startedAt: "x", extra: "ignored" }));
	assert.deepEqual(t, { status: "running", seen: 7, skips: 0, found: 0, consecutive: 0, startedAt: 0 });
});

test("state keeps a real epoch-millisecond start time (it was being zeroed by the sanitiser)", () => {
	const now = 1793850000000;
	assert.equal(parseState(JSON.stringify(newSession(now))).startedAt, now);
	assert.equal(parseState(JSON.stringify({ ...newSession(now), startedAt: 1e20 })).startedAt, 0);
});

test("keyMatches: case-insensitive, 'Space' alias, empty binding never matches", () => {
	assert.ok(keyMatches("k", "k"));
	assert.ok(keyMatches("K", "k"));
	assert.ok(keyMatches(" ", "Space"));
	assert.ok(keyMatches(" ", " "));
	assert.ok(keyMatches("Escape", "Escape"));
	assert.ok(!keyMatches("k", ""));
	assert.ok(!keyMatches("", ""));
	assert.ok(!keyMatches("x", "k"));
});

test("startUrl: marketplace aware, queue whitelisted", () => {
	assert.equal(startUrl("com", "encore"), "https://www.amazon.com/vine/vine-items?queue=encore&pn=&cn=&page=1");
	assert.equal(startUrl("co.uk", "potluck"), "https://www.amazon.co.uk/vine/vine-items?queue=potluck&pn=&cn=&page=1");
	assert.equal(startUrl("com", "evil&x=1"), "https://www.amazon.com/vine/vine-items?queue=encore&pn=&cn=&page=1");
	assert.equal(startUrl("evil.example/", "encore"), "https://www.amazon.com/vine/vine-items?queue=encore&pn=&cn=&page=1");
});
