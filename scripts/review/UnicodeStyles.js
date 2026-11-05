// Last compiled at 2026-11-05_0130
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/**
 * Text styling with Unicode look-alike letters (Amazon reviews are plain text, so bold/italic/... are done with
 * the "Mathematical Alphanumeric Symbols" and a few combining marks). Pure functions, unit tested in Node.
 * Every function works on code points, never on UTF-16 halves.
 */

const A = 0x41, a = 0x61, ZERO = 0x30;
const range = (start, count) => Array.from({ length: count }, (_, i) => String.fromCodePoint(start + i));
const alphabet = (upper, lower, digits) => ({ upper: range(upper, 26), lower: range(lower, 26), digits: digits ? range(digits, 10) : null });

const SETS = {
	bold: alphabet(0x1d5d4, 0x1d5ee, 0x1d7ec), // 𝗔𝗮𝟬 (sans-serif bold)
	italic: alphabet(0x1d608, 0x1d622, null), // 𝘈𝘢
	serif: (() => {
		const s = alphabet(0x1d434, 0x1d44e, null); // 𝐴𝑎 (math italic); the one hole in the block is h
		s.lower[7] = "ℎ";
		return s;
	})(),
	cursive: alphabet(0x1d4d0, 0x1d4ea, null), // 𝓐𝓪 (bold script)
	monospace: alphabet(0x1d670, 0x1d68a, 0x1d7f6), // 𝙰𝚊𝟶
};

const SUPERSCRIPT = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
	a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ", i: "ⁱ", j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ", n: "ⁿ", o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ" };

const UNDERLINE = "̲";
const STRIKE = "̶";

/** plain char -> styled char, per style name (only for the styles that map characters one to one) */
const FORWARD = {};
for (const [name, s] of Object.entries(SETS)) {
	const m = new Map();
	for (let i = 0; i < 26; i++) {
		m.set(String.fromCharCode(A + i), s.upper[i]);
		m.set(String.fromCharCode(a + i), s.lower[i]);
	}
	if (s.digits) for (let i = 0; i < 10; i++) m.set(String.fromCharCode(ZERO + i), s.digits[i]);
	FORWARD[name] = m;
}
FORWARD.wide = new Map();
for (let c = 0x21; c <= 0x7e; c++) FORWARD.wide.set(String.fromCharCode(c), String.fromCodePoint(c + 0xfee0));
FORWARD.superscript = new Map(Object.entries(SUPERSCRIPT));

/** styled char -> plain char (every style together) */
const BACKWARD = new Map();
for (const m of Object.values(FORWARD)) for (const [plain, styled] of m) BACKWARD.set(styled, plain);

export const STYLE_NAMES = ["bold", "italic", "serif", "cursive", "monospace", "wide", "superscript", "underline", "strikethrough"];

const cpArray = (text) => Array.from(String(text ?? ""));
const isLetterOrDigit = (ch) => /[\p{L}\p{N}]/u.test(ch);

/** Remove every kind of styling this module can add (letters/digits back to ASCII, combining marks, list markers). */
export function stripStyles(text) {
	return cpArray(text)
		.filter((ch) => ch !== UNDERLINE && ch !== STRIKE)
		.map((ch) => BACKWARD.get(ch) ?? ch)
		.join("");
}

const COMBINING = { underline: UNDERLINE, strikethrough: STRIKE };

/** True when every letter/digit of `text` is already in that style (and there is at least one). */
export function isStyled(text, style) {
	const chars = cpArray(text).filter((c) => c !== UNDERLINE && c !== STRIKE ? true : false);
	if (COMBINING[style]) {
		const all = cpArray(text);
		const marks = COMBINING[style];
		let seen = 0;
		for (let i = 0; i < all.length; i++) {
			if (all[i] === marks || all[i] === UNDERLINE || all[i] === STRIKE) continue;
			if (!isLetterOrDigit(all[i])) continue;
			seen++;
			if (all[i + 1] !== marks) return false;
		}
		return seen > 0;
	}
	const fwd = FORWARD[style];
	if (!fwd) return false;
	const styled = new Set(fwd.values());
	let seen = 0;
	for (const ch of chars) {
		if (!isLetterOrDigit(ch) && !styled.has(ch)) continue;
		if (/[^\u0000-\u007f]/.test(ch) && !styled.has(ch)) continue; // some other script: ignore
		seen++;
		if (!styled.has(ch)) return false;
	}
	return seen > 0;
}

/** Apply a character style. Any earlier style is removed first, so styles replace each other instead of stacking. */
export function applyStyle(text, style) {
	const plain = stripStyles(text);
	if (COMBINING[style]) {
		return cpArray(plain)
			.map((ch) => (/\s/.test(ch) ? ch : ch + COMBINING[style]))
			.join("");
	}
	const fwd = FORWARD[style];
	if (!fwd) throw new Error("Unknown style: " + style);
	return cpArray(plain)
		.map((ch) => fwd.get(ch) ?? ch)
		.join("");
}

/** Click on a style button: remove the style when the whole selection already has it, otherwise apply it. */
export function toggleStyle(text, style) {
	return isStyled(text, style) ? stripStyles(text) : applyStyle(text, style);
}

const BULLET = "● ";
const BULLET_RE = /^(\s*)(?:● |\d+\) )/;

/** "● " in front of every non-empty line; lines that already start with a bullet or number are left as they are. */
export function bulletLines(text) {
	return String(text ?? "")
		.split("\n")
		.map((line) => (line.trim() === "" || BULLET_RE.test(line) ? line : BULLET + line))
		.join("\n");
}

/** "1) ", "2) " ... in front of every non-empty line, counting from `start`; an existing bullet/number is replaced. */
export function numberLines(text, start = 1) {
	let n = start;
	return String(text ?? "")
		.split("\n")
		.map((line) => (line.trim() === "" ? line : `${n++}) ` + line.replace(BULLET_RE, "$1")))
		.join("\n");
}

/** Both list markers off again. */
export function unlistLines(text) {
	return String(text ?? "")
		.split("\n")
		.map((line) => line.replace(BULLET_RE, "$1"))
		.join("\n");
}
