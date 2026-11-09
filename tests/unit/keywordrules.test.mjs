// Last compiled at 2026-11-09_1710
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
// Auto-hide rule building, merging and conflict analysis (scripts/keywords/KeywordRules.js).
import test from "node:test";
import assert from "node:assert/strict";
import { compileKeywordObjects } from "../../scripts/core/utils/KeywordCompiler.js";
import { findMatch } from "../../scripts/core/utils/KeywordMatcher.js";
import {
	MAX_ALTERNATIVES, tokenizeTitle, brandFromByLine, suggest, buildRule, splitTopLevel, addRule, sortKeywordList,
	groupNames, cleanEntry, analyse, narrowNewRule, narrowOtherRules,
} from "../../scripts/keywords/KeywordRules.js";

const entry = (contains, extra = {}) => ({ contains, without: "", etv_min: "", etv_max: "", ...extra });
const matches = (rule, title) => !!findMatch(title, compileKeywordObjects([rule]));
const TUNDRA = "Toyota Tundra Sequoia Floor Mats Custom Fit All Weather Liners 2022-2024";

test("tokenizeTitle flags stop words and numbers", () => {
	const t = tokenizeTitle(TUNDRA);
	assert.equal(t[0].norm, "toyota");
	assert.equal(t.find((x) => x.norm === "fit").stop, true);
	assert.equal(t.find((x) => x.norm === "2022-2024").number, true);
});

test("brandFromByLine strips the 'by'", () => {
	assert.equal(brandFromByLine("by Brotherhood"), "Brotherhood");
});

test("suggest puts the brand first and offers toyota tundra", () => {
	const s = suggest(TUNDRA, "Brotherhood");
	assert.equal(s[0].kind, "brand");
	assert.ok(s.some((x) => x.label === "Toyota Tundra"));
});

test("a word with plural: toyota matches toyotas", () => {
	const r = buildRule({ words: ["toyota"] });
	assert.ok(matches(entry(r.contains), "Toyotas floor mats"));
});

test("toyota tundra / sequoia phrases share the first slot", () => {
	const r = buildRule({ phrases: [[["toyota"], ["tundra"]], [["toyota"], ["sequoia"]]] });
	assert.equal(r.contains, "toyotas?\\b.*\\b(tundras?|sequoias?)");
	assert.ok(matches(entry(r.contains), "Toyota Camry Tundra Mats"), "gaps are allowed");
	assert.ok(matches(entry(r.contains), "Floor mats for Toyota Sequoia"));
	assert.ok(!matches(entry(r.contains), "Sequoia for Toyota"), "order matters");
	assert.ok(!matches(entry(r.contains), "Toyota Camry mats"));
});

test("brands are matched as written, with flexible spaces", () => {
	const r = buildRule({ brands: ["Brother hood"] });
	assert.ok(matches(entry(r.contains), "Brother   hood Mat"));
});

test("buildRule returns null with nothing selected", () => {
	assert.equal(buildRule({}), null);
});

test("splitTopLevel respects parentheses", () => {
	assert.deepEqual(splitTopLevel("a|b(c|d)|e"), ["a", "b(c|d)", "e"]);
});

test("addRule merges into a rule of the same group, then reports exists", () => {
	const list = [entry("cat", { group: "Pets" })];
	const r = addRule(list, entry("dog", { group: "Pets" }));
	assert.equal(r.action, "merged");
	assert.equal(r.list[0].contains, "cat|dog");
	assert.equal(addRule(r.list, entry("dog", { group: "Pets" })).action, "exists");
});

test("addRule starts a new rule in the group beyond the alternative cap", () => {
	let list = [];
	for (let i = 0; i < MAX_ALTERNATIVES; i++) list = addRule(list, entry("w" + i, { group: "G" })).list;
	assert.equal(list.length, 1);
	const r = addRule(list, entry("extra", { group: "G" }));
	assert.equal(r.action, "added");
	assert.equal(r.list.length, 2);
	assert.equal(r.list[1].group, "G");
});

test("addRule does not merge rules with different groups or exclusions", () => {
	const list = [entry("cat", { group: "Pets" })];
	assert.equal(addRule(list, entry("car", { group: "Cars" })).action, "added");
	assert.equal(addRule(list, entry("dog", { group: "Pets", without: "toy" })).action, "added");
});

test("cleanEntry keeps a non-empty group only; sort puts ungrouped last", () => {
	assert.equal("group" in cleanEntry(entry("a", { group: "" })), false);
	const sorted = sortKeywordList([entry("z"), entry("b", { group: "B" }), entry("a", { group: "A" })]);
	assert.deepEqual(sorted.map((e) => e.contains), ["a", "b", "z"]);
	assert.deepEqual(groupNames(sorted), ["A", "B"]);
});

test("analyse finds highlight conflicts and skips pinned items", () => {
	const a = analyse({
		kind: "hide",
		entry: entry("toyota.*\\btundras?"),
		items: [
			{ asin: "A", title: "Toyota Tundra Mats" },
			{ asin: "B", title: "Toyota Tundra Cover" },
			{ asin: "C", title: "Honda Mats" },
		],
		hide: [],
		highlight: [entry("cover")],
		pinned: new Set(["A"]),
	});
	assert.deepEqual(a.matches.map((x) => x.asin), ["A", "B"]);
	assert.deepEqual(a.pinned.map((x) => x.asin), ["A"]);
	assert.deepEqual(a.conflicts.map((x) => x.asin), ["B"]);
	assert.equal(a.conflicts[0].alternative, "cover");
});

test("narrowNewRule excludes the highlighted alternatives, and the result no longer matches them", () => {
	const e = entry("toyota.*\\btundras?");
	const a = analyse({ kind: "hide", entry: e, items: [{ asin: "B", title: "Toyota Tundra Cover" }], hide: [], highlight: [entry("cover")], pinned: new Set() });
	const n = narrowNewRule(e, a.conflicts);
	assert.ok(!matches(n, "Toyota Tundra Cover"));
	assert.ok(matches(n, "Toyota Tundra Mats"));
});

test("narrowOtherRules keeps the other rules from hitting what the new rule covers", () => {
	const other = [entry("mats?")];
	const out = narrowOtherRules(other, [{ ruleIndex: 0, alternative: "mats?" }], "tundras?");
	assert.ok(!matches(out[0], "Tundra Mats"));
	assert.ok(matches(out[0], "Honda Mats"));
});
