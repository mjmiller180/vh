#!/usr/bin/env node
// Static check: every file the extension refers to exists.
//  - ES module imports (static + dynamic), absolute ("/scripts/..") and relative
//  - Template.loadFile("...") / chrome.runtime.getURL("...") string paths
//  - manifest.json entries
//  - <script src> / <link href> in the HTML pages
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const SKIP_DIRS = new Set([".git", "node_modules", "tests", "tools"]);
const problems = [];

function walk(dir, out = []) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (SKIP_DIRS.has(e.name)) continue;
		const p = path.join(dir, e.name);
		if (e.isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}
const rel = (p) => path.relative(ROOT, p);
function resolveRef(ref, fromFile) {
	if (/^(https?:|data:|chrome-extension:|#|mailto:|javascript:)/.test(ref)) return null;
	ref = ref.split("#")[0].split("?")[0];
	if (!ref) return null;
	return ref.startsWith("/") ? path.join(ROOT, ref) : path.resolve(path.dirname(fromFile), ref);
}
function check(ref, fromFile, kind) {
	const target = resolveRef(ref, fromFile);
	if (target && !fs.existsSync(target)) problems.push(`${rel(fromFile)}: ${kind} -> ${ref} (missing)`);
}

const files = walk(ROOT);
for (const f of files) {
	const ext = path.extname(f);
	if (f.includes(path.join("scripts", "vendor"))) continue;
	if ([".js", ".mjs"].includes(ext)) {
		const src = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
		for (const m of src.matchAll(/^\s*(?:import|export)\s[^"';]*?from\s*["']([^"']+)["']/gm)) check(m[1], f, "import");
		for (const m of src.matchAll(/^\s*import\s*["']([^"']+)["']/gm)) check(m[1], f, "import");
		for (const m of src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) check(m[1], f, "dynamic import");
		for (const m of src.matchAll(/loadFile\(\s*["']([^"']+)["']/g)) check("/" + m[1].replace(/^\//, ""), f, "template");
		for (const m of src.matchAll(/loadStyleSheet\(\s*["']([^"']+)["']/g)) check("/" + m[1].replace(/^\//, ""), f, "stylesheet");
		for (const m of src.matchAll(/getURL\(\s*["']([^"']+)["']\s*\)/g)) check("/" + m[1].replace(/^\.?\//, ""), f, "getURL");
	}
	if (ext === ".html") {
		const src = fs.readFileSync(f, "utf8");
		for (const m of src.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) check(m[1], f, "script src");
		for (const m of src.matchAll(/<link[^>]+href=["']([^"']+)["']/g)) check(m[1], f, "link href");
	}
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const mf = path.join(ROOT, "manifest.json");
const refs = [];
refs.push(manifest.background?.service_worker, manifest.action?.default_popup, manifest.options_ui?.page);
Object.values(manifest.icons || {}).forEach((i) => refs.push(i));
for (const c of manifest.content_scripts || []) [...(c.js || []), ...(c.css || [])].forEach((r) => refs.push(r));
refs.filter(Boolean).forEach((r) => check("/" + r, mf, "manifest"));

if (problems.length) {
	console.error(`${problems.length} broken reference(s):`);
	[...new Set(problems)].forEach((p) => console.error("  " + p));
	process.exit(1);
}
console.log("check-refs: all references resolve");
