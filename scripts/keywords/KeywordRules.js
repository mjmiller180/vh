// Last compiled at 2026-11-09_1710
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/**
 * Auto-hide / auto-highlight rules built from clicks on a product (pure functions, unit tested in Node).
 *
 * A keyword rule is {contains, without, etv_min, etv_max, group?}: `contains` is a regular expression (the matcher wraps it
 * as \b(...)\b, case-insensitive), `without` excludes titles that match it. This file:
 *   - cuts a title into word chips and suggests the interesting ones
 *   - builds the `contains` expression from what was clicked (words, phrases, brand)
 *   - decides whether a new rule joins an existing rule of the same group or becomes a new one
 *   - finds the conflicts a new rule would cause (highlight rules, existing hide rules, pinned items)
 */
import { compileKeywordObjects } from "../core/utils/KeywordCompiler.js";
import { findMatch } from "../core/utils/KeywordMatcher.js";

export const MAX_ALTERNATIVES = 10; // per rule: beyond this the next words start another rule in the same group
export const MAX_RULE_CHARS = 350;

// ------------------------------------------------------------------ titles -> chips
const STOP = new Set(
	"a an and are as at be by compatible compatibility designed fit fits for from in into is it its of on or our pack pcs pc piece pieces replacement replacements set that the their these this to up upgrade upgraded upgrading using with without x you your new for use used full size one two three four five".split(" ")
);

/** Words of a title, in order, each once: {text, norm, stop, number} */
export function tokenizeTitle(title) {
	const seen = new Set();
	const out = [];
	for (const m of String(title ?? "").matchAll(/[\p{L}\p{N}]+(?:[-'’.\/][\p{L}\p{N}]+)*\+?/gu)) {
		const text = m[0].replace(/['’]s$/i, "");
		const norm = text.toLowerCase();
		if (seen.has(norm)) continue;
		seen.add(norm);
		out.push({ text, norm, stop: STOP.has(norm) || norm.length < 2, number: /^[\d.\-\/]+$/.test(norm) });
	}
	return out;
}

/** The brand from the modal's "by Brotherhood" line (or null). */
export function brandFromByLine(text) {
	const m = String(text ?? "").replace(/\s+/g, " ").trim().match(/^by\s+(.{1,60})$/i);
	return m ? m[1].trim() : null;
}

/**
 * A few suggestions to click first: the brand, then distinctive words / neighbouring pairs from the main part of the title
 * (before the first "|" or ","). Only chips; nothing is chosen for the user.
 * @returns {{kind: "brand"|"word"|"phrase", label: string, tokens: string[]}[]}
 */
export function suggest(title, brand) {
	const out = [];
	if (brand) out.push({ kind: "brand", label: brand, tokens: [brand] });
	const main = String(title ?? "").split(/[|,]/)[0];
	const toks = [...main.matchAll(/[\p{L}\p{N}]+(?:[-'’.\/][\p{L}\p{N}]+)*\+?/gu)].map((m) => m[0]);
	const good = (t) => !STOP.has(t.toLowerCase()) && /^\p{L}[\p{L}\p{N}\-'’.]{2,}$/u.test(t);
	const seen = new Set();
	for (let i = 0; i < toks.length && out.length < 8; i++) {
		if (!good(toks[i])) continue;
		if (i + 1 < toks.length && good(toks[i + 1]) && !seen.has((toks[i] + " " + toks[i + 1]).toLowerCase())) {
			const label = `${toks[i]} ${toks[i + 1]}`;
			seen.add(label.toLowerCase());
			out.push({ kind: "phrase", label, tokens: [toks[i], toks[i + 1]] });
		}
		if (!seen.has(toks[i].toLowerCase())) {
			seen.add(toks[i].toLowerCase());
			out.push({ kind: "word", label: toks[i], tokens: [toks[i]] });
		}
	}
	return out.slice(0, 8);
}

// ------------------------------------------------------------------ clicks -> expression
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");

/** One word as an expression: escaped, plural tolerant for plain words ("tundra" -> "tundras?"). */
export function tokenPattern(token, { plural = true } = {}) {
	const t = String(token).trim();
	const esc = escapeRegex(t);
	return plural && /^\p{L}{3,}$/u.test(t) && !/s$/i.test(t) ? esc + "s?" : esc;
}

const slotPattern = (alts, opts) => {
	const parts = alts.map((a) => tokenPattern(a, opts));
	return parts.length === 1 ? parts[0] : `(${parts.join("|")})`;
};

/**
 * @param {{words?: string[], phrases?: string[][][], brands?: string[]}} sel
 *   words:   single words, any one of them matches
 *   phrases: each phrase is a list of slots, each slot a list of alternative words: [[["Toyota"],["Tundra","Sequoia"]]] means
 *            Toyota, later, Tundra or Sequoia (that order, other words allowed between)
 *   brands:  brand names, matched as written (spaces may be any run of spaces), no plural ending
 * @returns {{contains: string, summary: string}|null}
 */
export function buildRule(sel, opts = {}) {
	const words = [...new Set((sel.words || []).map((w) => String(w).trim()).filter(Boolean))];
	const phrases = (sel.phrases || []).map((p) => p.map((slot) => [...new Set(slot.map((w) => String(w).trim()).filter(Boolean))]).filter((s) => s.length));
	const brands = [...new Set((sel.brands || []).map((b) => String(b).trim()).filter(Boolean))];

	const alts = [];
	const said = [];
	// phrases: several that begin with the same slot share it: toyota.*\b(tundra|sequoia)
	const real = phrases.filter((p) => p.length >= 2);
	const single = phrases.filter((p) => p.length === 1).map((p) => ({ words: p[0] }));
	for (const s of single) words.push(...s.words);
	const byFirst = new Map();
	for (const p of real) {
		const k = p[0].map((x) => x.toLowerCase()).sort().join("|");
		if (!byFirst.has(k)) byFirst.set(k, []);
		byFirst.get(k).push(p);
	}
	for (const group of byFirst.values()) {
		const first = slotPattern(group[0][0], opts);
		const tails = group.map((p) => p.slice(1).map((s) => slotPattern(s, opts)).join("\\b.*\\b"));
		const uniqueTails = [...new Set(tails)];
		alts.push(`${first}\\b.*\\b${uniqueTails.length === 1 ? uniqueTails[0] : `(${uniqueTails.join("|")})`}`);
		for (const p of group) said.push(p.map((s) => s.join("/")).join(" … "));
	}
	for (const w of [...new Set(words)]) alts.push(tokenPattern(w, opts));
	for (const b of brands) alts.push(b.split(/\s+/).map((x) => escapeRegex(x)).join("\\s+"));
	if (!alts.length) return null;
	const parts = [];
	if (said.length) parts.push(said.map((s) => `${s} (in that order)`).join("; "));
	if (new Set(words).size) parts.push(`any of: ${[...new Set(words)].join(", ")}`);
	if (brands.length) parts.push(`brand: ${brands.join(", ")}`);
	return { contains: alts.join("|"), summary: `Titles containing ${parts.join(" — or — ")}` };
}

// ------------------------------------------------------------------ expressions: split, compare, merge
/** The alternatives at the top level of an expression ("a|(b|c)|d" -> ["a", "(b|c)", "d"]). */
export function splitTopLevel(rule) {
	const out = [];
	let depth = 0;
	let inClass = false;
	let cur = "";
	for (let i = 0; i < rule.length; i++) {
		const c = rule[i];
		if (c === "\\") {
			cur += c + (rule[++i] ?? "");
			continue;
		}
		if (inClass) {
			if (c === "]") inClass = false;
		} else if (c === "[") inClass = true;
		else if (c === "(") depth++;
		else if (c === ")") depth = Math.max(0, depth - 1);
		else if (c === "|" && depth === 0) {
			out.push(cur);
			cur = "";
			continue;
		}
		cur += c;
	}
	out.push(cur);
	return out.filter((x) => x !== "");
}

const lower = (s) => String(s ?? "").toLowerCase();
const groupKey = (g) => lower(g).trim();

/** The expression, grouped list entry or not, as one clean entry. */
export function cleanEntry(e) {
	return { contains: String(e?.contains ?? ""), without: String(e?.without ?? ""), etv_min: e?.etv_min ?? "", etv_max: e?.etv_max ?? "", ...(groupKey(e?.group) ? { group: String(e.group).trim() } : {}) };
}

/** Group, then expression (ungrouped rules last), case-insensitive. */
export function sortKeywordList(list) {
	return [...list].sort((a, b) => {
		const ga = groupKey(a.group), gb = groupKey(b.group);
		if (ga !== gb) return ga === "" ? 1 : gb === "" ? -1 : ga < gb ? -1 : 1;
		return lower(a.contains) < lower(b.contains) ? -1 : lower(a.contains) > lower(b.contains) ? 1 : 0;
	});
}

export const groupNames = (list) => [...new Set(list.map((e) => String(e.group ?? "").trim()).filter(Boolean))].sort((a, b) => lower(a).localeCompare(lower(b)));

/**
 * Add a rule to the list: into an existing rule of the same group (same `without`, room left under the caps) or as a new rule.
 * @returns {{list: object[], action: "merged"|"added"|"exists", index: number}}
 */
export function addRule(list, entry, caps = { alternatives: MAX_ALTERNATIVES, chars: MAX_RULE_CHARS }) {
	const base = list.map(cleanEntry);
	const e = cleanEntry(entry);
	const newAlts = splitTopLevel(e.contains);
	const has = (rule, alt) => splitTopLevel(rule).some((x) => lower(x) === lower(alt));
	// already there (in any rule)?
	const existing = base.findIndex((r) => r.without === e.without && newAlts.every((a) => has(r.contains, a)));
	if (existing >= 0) return { list: sortKeywordList(base), action: "exists", index: existing };
	// a rule of the same group with room
	if (groupKey(e.group)) {
		let best = -1;
		base.forEach((r, i) => {
			if (groupKey(r.group) !== groupKey(e.group) || r.without !== e.without) return;
			const add = newAlts.filter((a) => !has(r.contains, a));
			const alts = splitTopLevel(r.contains).length + add.length;
			const chars = r.contains.length + add.reduce((n, a) => n + a.length + 1, 0);
			if (alts > caps.alternatives || chars > caps.chars) return;
			if (best < 0 || splitTopLevel(r.contains).length > splitTopLevel(base[best].contains).length) best = i; // fill the fullest one that still fits
		});
		if (best >= 0) {
			const r = base[best];
			const add = newAlts.filter((a) => !has(r.contains, a));
			const merged = { ...r, contains: [r.contains, ...add].join("|") };
			const next = base.map((x, i) => (i === best ? merged : x));
			const sorted = sortKeywordList(next);
			return { list: sorted, action: "merged", index: sorted.findIndex((x) => x === merged) };
		}
	}
	const sortedList = sortKeywordList([...base, e]);
	return { list: sortedList, action: "added", index: sortedList.findIndex((x) => x.contains === e.contains && x.without === e.without) };
}

/** Where a new rule would go, for showing "Add to: ..." before anything is saved. */
export function planAdd(list, entry, caps) {
	const r = addRule(list, entry, caps);
	return { action: r.action, target: r.list[r.index] };
}

// ------------------------------------------------------------------ conflicts
const compile = (rules) => compileKeywordObjects(rules.map((r) => ({ contains: r.contains, without: r.without || "", etv_min: "", etv_max: "" })));
const hits = (compiled, title) => findMatch(title, compiled, null, null);

/** The top-level alternative of `rule` that matches `title` (the part to exclude when the other rule must win). */
export function matchingAlternative(rule, title) {
	for (const alt of splitTopLevel(rule.contains)) {
		const c = compile([{ contains: alt, without: rule.without }]);
		if (hits(c, title)) return alt;
	}
	return null;
}

/**
 * What a new rule would do to the items on the page.
 * @param {{kind: "hide"|"highlight", entry: object, items: {asin: string, title: string}[], hide: object[], highlight: object[], pinned: Set<string>}} p
 * @returns {{matches: object[], pinned: object[], conflicts: {asin: string, title: string, ruleIndex: number, alternative: string|null}[], alreadyCovered: {asin: string, title: string, ruleIndex: number}[]}}
 */
export function analyse({ kind, entry, items, hide = [], highlight = [], pinned = new Set() }) {
	const mine = compile([entry]);
	const matches = items.filter((it) => hits(mine, it.title));
	const otherList = kind === "hide" ? highlight : hide; // the list whose items this rule could take away from / give to
	const otherRules = otherList.map(cleanEntry);
	const other = compile(otherRules);
	const sameList = (kind === "hide" ? hide : highlight).map(cleanEntry);
	const same = compile(sameList);
	const out = { matches, pinned: [], conflicts: [], alreadyCovered: [] };
	for (const it of matches) {
		if (kind === "hide" && pinned.has(it.asin)) {
			out.pinned.push(it);
			continue; // a pinned item is never auto-hidden: nothing to decide
		}
		const o = other.findIndex((c) => hits([c], it.title));
		if (o >= 0) out.conflicts.push({ asin: it.asin, title: it.title, ruleIndex: o, alternative: matchingAlternative(otherRules[o], it.title) });
		const s = same.findIndex((c) => hits([c], it.title));
		if (s >= 0) out.alreadyCovered.push({ asin: it.asin, title: it.title, ruleIndex: s });
	}
	return out;
}

/** "Keep the other list's rule winning": exclude what it matched in the new rule's `without`. */
export function narrowNewRule(entry, conflicts) {
	const alts = [...new Set(conflicts.map((c) => c.alternative).filter(Boolean))];
	const without = [...splitTopLevel(entry.without || ""), ...alts.filter((a) => !splitTopLevel(entry.without || "").map(lower).includes(lower(a)))].join("|");
	return { ...entry, without };
}

/** "The new rule wins": the other list's rules that matched get the new rule's expression in their `without`. */
export function narrowOtherRules(otherList, conflicts, newContains) {
	const idx = new Set(conflicts.map((c) => c.ruleIndex));
	return otherList.map((r, i) => {
		if (!idx.has(i)) return r;
		const w = splitTopLevel(r.without || "");
		return { ...r, without: [...w, ...splitTopLevel(newContains).filter((a) => !w.map(lower).includes(lower(a)))].join("|") };
	});
}
