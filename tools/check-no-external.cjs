#!/usr/bin/env node
// Last compiled at 2026-11-05_0049
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
// Guard: this build must not talk to anything except Amazon (and the user's own Discord webhook).
// Fails (exit 1) when:
//  - a source file contains a URL to a host outside the allow-list
//  - a network primitive (fetch, XHR, WebSocket, sendBeacon, EventSource, importScripts) is used in a
//    file that is not explicitly approved for it
//  - the manifest allows hosts / permissions beyond the approved set
//  - an HTML page loads anything (script/img/link/iframe/form) from a remote host
// Plain <a href> links the user has to click are allowed (they send nothing by themselves).
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const SKIP = new Set([".git", "node_modules", "tests", "tools"]);

const HOST_ALLOW = [/(^|\.)amazon\.[a-z.]+$/, /(^|\.)media-amazon\.com$/, /^(discord|discordapp)\.com$/, /(^|\.)(discord|discordapp)\.com$/, /^www\.w3\.org$/];
// Google API hosts are only acceptable inside the Google client code. (Naming a host in code is not enough to
// reach it from the service worker, whose requests the manifest CSP connect-src governs, so this guard checks the
// manifest separately. Content scripts are NOT limited by the extension CSP, which is why the primitive check
// below matters.)
const GOOGLE_API_HOSTS = ["sheets.googleapis.com"]; //(add www.googleapis.com only when the Drive API is wired in)
const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const GOOGLE_DIR = "scripts/background/google/";
const hostOk = (h) => HOST_ALLOW.some((r) => r.test(h.toLowerCase())) || h.includes("*.amazon.") || h.includes("${") || h.includes("{{");

// Files allowed to call a given primitive, with the reason.
const PRIMITIVE_ALLOW = {
	"scripts/background/DiscordSender.js": { fetch: "POSTs to the user's Discord webhook (URL validated)" },
	"scripts/core/utils/Template.js": { fetch: "loads the extension's own template files (chrome.runtime.getURL)" },
	"scripts/background/google/SheetsClient.js": { fetch: "calls the Google Sheets API with the user's own token (fetchFn is injected; the host is fixed in BASE)" },
	"scripts/inj.js": { fetch: "wraps Amazon's own fetch (origFetch) to read Amazon's responses" },
};
const PRIMITIVES = [
	["fetch", /(?<![\w.])fetch\w*\s*\(|globalThis\.fetch\b|window\.fetch\b|self\.fetch\b/],
	["XMLHttpRequest", /XMLHttpRequest/],
	["WebSocket", /new\s+WebSocket\s*\(/],
	["sendBeacon", /sendBeacon\s*\(/],
	["EventSource", /new\s+EventSource\s*\(/],
	["importScripts", /importScripts\s*\(/],
	["new Image(src)", /new\s+Image\s*\(\s*\)[^;]*\.src\s*=\s*["'`]https?:/],
];

const problems = [];
function walk(dir, out = []) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (SKIP.has(e.name)) continue;
		const p = path.join(dir, e.name);
		if (e.isDirectory()) {
			if (p.includes(path.join("scripts", "vendor"))) continue; // CSS themes only; checked below
			walk(p, out);
		} else out.push(p);
	}
	return out;
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");

for (const f of walk(ROOT)) {
	const ext = path.extname(f);
	if (![".js", ".mjs", ".html", ".css", ".json"].includes(ext)) continue;
	const r = rel(f);
	if (/\.md$/.test(r) || r === "package.json") continue;
	let src = fs.readFileSync(f, "utf8");

	// ---- 1. URL literals
	const isHtml = ext === ".html";
	let scan = src;
	if (isHtml) scan = src.replace(/<a\b[^>]*>/gi, (m) => m.replace(/https?:\/\//g, "link://")); // click-only links
	if (ext === ".js") scan = scan.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); // comments
	// manifest.json: OAuth scope names look like URLs but are identifiers, not addresses anything connects to
	// (the approved ones are validated separately below); the approved Sheets host may appear in the CSP.
	if (r === "manifest.json") scan = scan.replace(/https:\/\/www\.googleapis\.com\/auth\/[a-z._]+/g, "");
	if (isHtml) scan = scan.replace(/<!--[\s\S]*?-->/g, ""); // comments (the copyright header carries a URL)
	if (ext === ".css") scan = scan.replace(/\/\*[\s\S]*?\*\//g, "");
	for (const m of scan.matchAll(/(https?|wss?):\/\/([A-Za-z0-9*._${}-]+)/g)) {
		const googleOk = (r.startsWith(GOOGLE_DIR) || r === "manifest.json") && GOOGLE_API_HOSTS.includes(m[2].toLowerCase());
		if (!hostOk(m[2]) && !googleOk) problems.push(`${r}: URL to non-allowed host "${m[2]}"`);
	}

	// ---- 2. network primitives
	if (ext === ".js" || ext === ".mjs") {
		const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
		for (const [name, re] of PRIMITIVES) {
			if (re.test(code)) {
				const allowed = PRIMITIVE_ALLOW[r];
				if (!allowed || !allowed[name]) problems.push(`${r}: uses ${name} (not an approved file)`);
			}
		}
	}

	// ---- 3. html loading remote resources
	if (isHtml) {
		for (const m of src.matchAll(/<(script|img|link|iframe|form|source|video|audio|embed|object)\b[^>]*?(?:src|href|action|data)=["'](https?:)?\/\/([^"'/]+)/gi)) {
			problems.push(`${r}: <${m[1]}> loads from remote host ${m[3]}`);
		}
	}
}

// ---- manifest
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const perms = new Set(manifest.permissions || []);
for (const bad of ["alarms", "notifications", "webRequest", "cookies", "history", "downloads", "management", "nativeMessaging"]) {
	if (perms.has(bad)) problems.push(`manifest.json: permission "${bad}" is not needed`);
}
for (const hp of manifest.host_permissions || []) {
	const h = hp.replace(/^\*:\/\/|^https?:\/\//, "").split("/")[0];
	if (!hostOk(h)) problems.push(`manifest.json: host_permission for ${hp}`);
}
// Google sign-in: allowed only with exactly the approved scopes (and the identity permission is then expected).
if (perms.has("identity")) {
	for (const sc of manifest.oauth2?.scopes || []) if (!GOOGLE_SCOPES.includes(sc)) problems.push(`manifest.json oauth2 scope not approved: ${sc}`);
	if (!manifest.oauth2) problems.push('manifest.json has "identity" but no oauth2 block');
} else if (manifest.oauth2) {
	problems.push('manifest.json has an oauth2 block without the "identity" permission');
}
const csp = manifest.content_security_policy?.extension_pages || "";
const connect = (csp.match(/connect-src([^;]*)/) || [, ""])[1].trim().split(/\s+/).filter(Boolean);
for (const c of connect) {
	if (c === "'self'") continue;
	const h = c.replace(/^(https?|wss?):\/\//, "");
	if (!hostOk(h) && !GOOGLE_API_HOSTS.includes(h)) problems.push(`manifest.json CSP connect-src allows ${c}`);
	if (/ovh|llamastories/.test(c)) problems.push(`manifest.json CSP connect-src allows ${c}`);
}
if (!csp) problems.push("manifest.json: no extension_pages CSP");
for (const w of manifest.web_accessible_resources || []) {
	for (const m of w.matches || []) {
		const h = m.replace(/^\*:\/\//, "").split("/")[0];
		if (!hostOk(h)) problems.push(`manifest.json web_accessible_resources matches ${m}`);
	}
}

if (problems.length) {
	console.error(`check-no-external: ${problems.length} problem(s)`);
	[...new Set(problems)].forEach((p) => console.error("  " + p));
	process.exit(1);
}
console.log("check-no-external: OK (reachable: Amazon, the user's own Discord webhook, and the Google Sheets API after sign-in)");
