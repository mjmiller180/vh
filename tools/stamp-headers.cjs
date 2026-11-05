#!/usr/bin/env node
// Puts the project copyright header on every source file and keeps its "Last compiled at" time current.
//
//   node tools/stamp-headers.cjs           add/refresh headers (files whose content changed since HEAD get "now")
//   node tools/stamp-headers.cjs --check   exit 1 if any file lacks the header or has a malformed one
//
// The header (4 lines, comment syntax chosen by file type):
//   Last compiled at YYYY-MM-DD_HHMM        <- most recent edit of the file, America/New_York
//   Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
//   https://toolsmyths.com
//   SPDX-License-Identifier: LicenseRef-Proprietary
//
// Rules:
//  * a file with no header gets one stamped "now" (adding it is an edit)
//  * a file whose content (ignoring the header) differs from HEAD gets "now"
//  * a file whose content is unchanged since HEAD keeps its existing stamp (so running twice changes nothing)
//  * third-party code (scripts/vendor/), old notes and the generated test fixture are never touched
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CHECK = process.argv.includes("--check");
const TZ = "America/New_York";

const COPYRIGHT = "Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.";
const URL_LINE = "https://toolsmyths.com";
const SPDX = "SPDX-License-Identifier: LicenseRef-Proprietary";
const STAMP_RE = /^\d{4}-\d{2}-\d{2}_\d{4}$/;

const EXCLUDE = [/^scripts\/vendor\//, /^docs\/old-notes\//, /^tests\/e2e\/fixture-vine\.html$/, /^node_modules\//];
const STYLE = {
	".js": "line", ".cjs": "line", ".mjs": "line",
	".html": "html", ".md": "html",
	".css": "css",
};
const wrap = (style, text) => (style === "html" ? `<!-- ${text} -->` : style === "css" ? `/* ${text} */` : `// ${text}`);

function git(...args) {
	return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function nowStamp() {
	const p = Object.fromEntries(
		new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
			.formatToParts(new Date())
			.map((x) => [x.type, x.value])
	);
	return `${p.year}-${p.month}-${p.day}_${p.hour}${p.minute}`;
}

/** Split content into { shebang, header: [4 lines] | null, body }. */
function parse(content, style) {
	let shebang = "";
	let rest = content;
	if (rest.startsWith("#!")) {
		const i = rest.indexOf("\n");
		shebang = rest.slice(0, i + 1);
		rest = rest.slice(i + 1);
	}
	const lines = rest.split("\n");
	const idx = lines.findIndex((l, i) => i < 8 && l.includes("Last compiled at"));
	if (idx === 0 && lines.length >= 4 && lines[3].includes("SPDX-License-Identifier")) {
		let body = lines.slice(4).join("\n");
		if (style === "html" && body.startsWith("\n")) body = body.slice(1); // blank line we add after markdown headers
		return { shebang, header: lines.slice(0, 4), body };
	}
	return { shebang, header: null, body: rest };
}

function build(shebang, style, stamp, body, ext) {
	const h = [`Last compiled at ${stamp}`, COPYRIGHT, URL_LINE, SPDX].map((t) => wrap(style, t)).join("\n");
	return shebang + h + "\n" + (ext === ".md" ? "\n" : "") + body;
}

function eligibleFiles() {
	return git("ls-files", "-z")
		.split("\0")
		.filter(Boolean)
		.filter((f) => STYLE[path.extname(f)] && !EXCLUDE.some((r) => r.test(f)))
		.filter((f) => fs.existsSync(path.join(ROOT, f)));
}

function headBody(file, style) {
	try {
		const txt = git("show", `HEAD:${file}`);
		return parse(txt, style).body;
	} catch (e) {
		return null; // new file
	}
}

const problems = [];
let changed = 0;
const stamp = nowStamp();

for (const file of eligibleFiles()) {
	const ext = path.extname(file);
	const style = STYLE[ext];
	const full = path.join(ROOT, file);
	const content = fs.readFileSync(full, "utf8");
	const { shebang, header, body } = parse(content, style);

	if (CHECK) {
		if (!header) {
			problems.push(`${file}: missing copyright header (run: npm run stamp)`);
			continue;
		}
		const text = header.map((l) => l.replace(/^<!-- | -->$|^\/\/ |^\/\* | \*\/$/g, ""));
		if (!STAMP_RE.test(text[0].replace("Last compiled at ", ""))) problems.push(`${file}: bad 'Last compiled at' stamp`);
		if (text[1] !== COPYRIGHT || text[2] !== URL_LINE || text[3] !== SPDX) problems.push(`${file}: header text differs from the standard header`);
		continue;
	}

	const prevBody = headBody(file, style);
	let useStamp = stamp;
	if (header && prevBody !== null && prevBody === body) {
		// content unchanged since HEAD: keep the existing stamp (normalise syntax only)
		useStamp = header[0].replace(/^<!-- | -->$|^\/\/ |^\/\* | \*\/$/g, "").replace("Last compiled at ", "");
		if (!STAMP_RE.test(useStamp)) useStamp = stamp;
	}
	const next = build(shebang, style, useStamp, body, ext);
	if (next !== content) {
		fs.writeFileSync(full, next);
		changed++;
	}
}

if (CHECK) {
	if (problems.length) {
		console.error(`stamp-headers: ${problems.length} problem(s)`);
		problems.slice(0, 40).forEach((p) => console.error("  " + p));
		if (problems.length > 40) console.error(`  ... and ${problems.length - 40} more`);
		process.exit(1);
	}
	console.log("stamp-headers: all source files carry the standard header");
} else {
	console.log(`stamp-headers: ${changed} file(s) written`);
}
