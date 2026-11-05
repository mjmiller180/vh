// Last compiled at 2026-11-05_0209
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
import test from "node:test";
import assert from "node:assert/strict";
import { applyStyle, stripStyles, removeStyle, toggleStyle, isStyled, bulletLines, numberLines, unlistLines, STYLE_NAMES } from "../../scripts/review/UnicodeStyles.js";

test("bold / italic / monospace / serif / cursive / wide / superscript give the expected letters", () => {
	assert.equal(applyStyle("Abc 123", "bold"), "𝗔𝗯𝗰 𝟭𝟮𝟯");
	assert.equal(applyStyle("Abc", "italic"), "𝘈𝘣𝘤");
	assert.equal(applyStyle("Ah", "serif"), "𝐴ℎ", "the hole in the math-italic block is filled");
	assert.equal(applyStyle("Ab", "cursive"), "𝓐𝓫");
	assert.equal(applyStyle("Ab1", "monospace"), "𝙰𝚋𝟷");
	assert.equal(applyStyle("Ab!", "wide"), "Ａｂ！");
	assert.equal(applyStyle("a2-b", "superscript"), "ᵃ²⁻ᵇ");
});

test("underline and strikethrough add combining marks after letters and digits, not after spaces", () => {
	assert.equal(applyStyle("ab c", "underline"), "a̲b̲ c̲");
	assert.equal(applyStyle("ab", "strikethrough"), "a̶b̶");
});

test("stripStyles is the exact inverse of every style (round trip)", () => {
	const plain = "Hello World 2026 - great product!";
	for (const s of ["bold", "italic", "serif", "cursive", "monospace", "underline", "strikethrough"]) assert.equal(stripStyles(applyStyle(plain, s)), plain, s);
	// wide and superscript are taken back by removeStyle (stripStyles leaves them: real text uses those characters)
	assert.equal(removeStyle(applyStyle(plain, "wide"), "wide"), plain);
	assert.equal(removeStyle(applyStyle("great product 2026", "superscript"), "superscript"), "great product 2026");
	assert.equal(stripStyles("plain text"), "plain text");
});

test("styles replace each other instead of stacking", () => {
	assert.equal(applyStyle(applyStyle("Hi", "bold"), "italic"), applyStyle("Hi", "italic"));
	assert.equal(applyStyle(applyStyle("Hi", "underline"), "bold"), applyStyle("Hi", "bold"));
});

test("toggleStyle: second click on the same style removes it; a different style replaces it", () => {
	const once = toggleStyle("Nice one", "bold");
	assert.equal(once, "𝗡𝗶𝗰𝗲 𝗼𝗻𝗲");
	assert.ok(isStyled(once, "bold"));
	assert.equal(toggleStyle(once, "bold"), "Nice one");
	assert.equal(toggleStyle(once, "italic"), "𝘕𝘪𝘤𝘦 𝘰𝘯𝘦");
	assert.ok(!isStyled("plain", "bold"));
	assert.ok(!isStyled("", "bold"));
	assert.ok(!isStyled("Ab", "bold"), "half styled is not styled");
	assert.equal(toggleStyle("ab", "underline"), "a̲b̲");
	assert.equal(toggleStyle("a̲b̲", "underline"), "ab");
});

test("other scripts and emoji pass through untouched; surrogate pairs are never split", () => {
	assert.equal(applyStyle("日本語 😀", "bold"), "日本語 😀");
	assert.equal(stripStyles(applyStyle("a😀b", "bold")), "a😀b");
	assert.equal(applyStyle("😀", "underline"), "😀", "emoji get no mark");
	assert.equal(applyStyle("👍🏽", "strikethrough"), "👍🏽", "a skin-tone emoji is not split by a mark");
	assert.equal(applyStyle("a👍🏽b", "underline"), "a\u0332👍🏽b\u0332");
});

test("bullet and numbered lists: per non-empty line, idempotent, switchable, removable", () => {
	assert.equal(bulletLines("one\n\ntwo"), "● one\n\n● two");
	assert.equal(bulletLines(bulletLines("one\ntwo")), "● one\n● two");
	assert.equal(numberLines("one\n\ntwo\nthree"), "1) one\n\n2) two\n3) three");
	assert.equal(numberLines("● one\n● two", 4), "4) one\n5) two", "a bullet is replaced, numbering can restart anywhere");
	assert.equal(numberLines("1) a\n2) b", 1), "1) a\n2) b");
	assert.equal(unlistLines("● a\n2) b\n  3) c\nplain"), "a\nb\n  c\nplain");
	assert.equal(bulletLines(""), "");
});

test("unknown style is an error, not silently ignored", () => {
	assert.throws(() => applyStyle("a", "sparkly"), /Unknown style/);
});

test("characters the user typed are never converted by styling or clearing (m², full-width Japanese)", () => {
	assert.equal(stripStyles("area 5 m² and １２３ＡＢＣ"), "area 5 m² and １２３ＡＢＣ");
	assert.equal(applyStyle("価格１２３円 m²", "bold"), "価格１２３円 𝗺²", "only the plain letters change");
	assert.equal(applyStyle("price 5 m²", "bold"), "𝗽𝗿𝗶𝗰𝗲 𝟱 𝗺²");
	assert.equal(toggleStyle(toggleStyle("price 5 m²", "bold"), "bold"), "price 5 m²");
});

test("superscript can be toggled off even when the text has letters it has no glyph for", () => {
	const once = toggleStyle("Hi", "superscript");
	assert.equal(once, "Hⁱ");
	assert.equal(toggleStyle(once, "superscript"), "Hi");
	assert.equal(toggleStyle(toggleStyle("Quiz", "superscript"), "superscript"), "Quiz");
});

test("underline then strikethrough: each button removes only its own mark", () => {
	const u = applyStyle("ab", "underline");
	const both = applyStyle(u, "underline") + ""; // (applying again keeps one mark)
	assert.equal(both, u);
	const struck = u.replace("b\u0332", "b\u0332\u0336");
	assert.equal(removeStyle(struck, "underline"), "ab\u0336");
	assert.equal(removeStyle(struck, "strikethrough"), "a\u0332b\u0332");
});
