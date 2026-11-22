// Last compiled at 2026-11-21_1906
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
// Version number of the extension: one place (manifest.json), shown in the settings header ("VineSmyths 1.5"),
// and the newest "## [VineSmyths X.Y]" heading of CHANGELOG.md must be the same number.
//   node tools/version.cjs --check   (part of npm run check)
//   node tools/version.cjs --bump    (npm run bump: 1.5 -> 1.6, adds the CHANGELOG heading; run it for every new build)
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");
const MANIFEST = path.join(ROOT, "manifest.json");
const CHANGELOG = path.join(ROOT, "CHANGELOG.md");
const FORMAT = /^\d+\.\d+$/;
const HEADING = /^## \[VineSmyths (\d+\.\d+)\][^\n]*$/m;

const manifestVersion = () => JSON.parse(fs.readFileSync(MANIFEST, "utf8")).version;
const changelogVersion = () => fs.readFileSync(CHANGELOG, "utf8").match(HEADING)?.[1];

function check() {
	const m = manifestVersion();
	const c = changelogVersion();
	const problems = [];
	if (!FORMAT.test(m)) problems.push(`manifest.json version "${m}" is not MAJOR.MINOR (for example 1.5)`);
	if (c !== m) problems.push(`the newest CHANGELOG.md heading is "VineSmyths ${c}" but manifest.json says ${m} (run: npm run bump)`);
	if (problems.length) {
		console.error("check-version:\n  " + problems.join("\n  "));
		process.exit(1);
	}
	console.log(`check-version: ${m}`);
}

function bump() {
	const m = manifestVersion();
	if (!FORMAT.test(m)) throw new Error(`manifest.json version "${m}" is not MAJOR.MINOR`);
	const [major, minor] = m.split(".").map(Number);
	const next = `${major}.${minor + 1}`;
	const manifest = fs.readFileSync(MANIFEST, "utf8");
	fs.writeFileSync(MANIFEST, manifest.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${next}"`));
	const log = fs.readFileSync(CHANGELOG, "utf8");
	const date = new Date().toISOString().slice(0, 10);
	fs.writeFileSync(CHANGELOG, log.replace(HEADING, (first) => `## [VineSmyths ${next}] - ${date}\n\n### Added\n- \n\n${first}`));
	console.log(`version ${m} -> ${next} (manifest.json and CHANGELOG.md; fill in the new CHANGELOG section)`);
}

if (process.argv.includes("--bump")) bump();
else check();
