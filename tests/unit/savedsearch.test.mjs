// Last compiled at 2026-11-07_2157
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchUrl, sanitiseList, findSaved, addSaved, removeSaved, labelFor, MAX_SAVED } from "../../scripts/core/utils/SavedSearchLogic.js";

test("buildSearchUrl: the search text and queue/category stay, the page number and everything else go", () => {
	assert.equal(buildSearchUrl("https://www.amazon.com/vine/vine-items?search=dog"), "/vine/vine-items?search=dog");
	assert.equal(buildSearchUrl("https://www.amazon.com/vine/vine-items?queue=encore&search=dog%20toy&page=3&foo=1#x"), "/vine/vine-items?search=dog%20toy&queue=encore");
	assert.equal(buildSearchUrl("https://www.amazon.com/vine/vine-items?search=dog&queue=encore&pn=&cn=2345"), "/vine/vine-items?search=dog&queue=encore&cn=2345");
	assert.equal(buildSearchUrl("/vine/vine-items?search=cat"), "/vine/vine-items?search=cat", "relative addresses work");
	assert.equal(buildSearchUrl("https://www.amazon.de/-/en/vine/vine-items?search=Hund"), "/-/en/vine/vine-items?search=Hund", "a language prefix is kept");
});

test("buildSearchUrl: typed text wins over the address; no text or another page gives null", () => {
	assert.equal(buildSearchUrl("https://www.amazon.com/vine/vine-items?search=dog&queue=encore", "  cat  "), "/vine/vine-items?search=cat&queue=encore");
	assert.equal(buildSearchUrl("https://www.amazon.com/vine/vine-items?queue=encore"), null);
	assert.equal(buildSearchUrl("https://www.amazon.com/vine/vine-items?queue=encore", "  "), null);
	assert.equal(buildSearchUrl("https://www.amazon.com/vine/orders?search=dog"), null);
	assert.equal(buildSearchUrl("https://www.amazon.com/vine/vine-items/evil?search=dog"), null);
	assert.equal(buildSearchUrl("not a url at all %%%"), null);
	assert.equal(buildSearchUrl("https://www.amazon.com/vine/vine-items", "x".repeat(80)).length, "/vine/vine-items?search=".length + 50, "Amazon's box takes 50 characters");
});

test("buildSearchUrl: odd characters are encoded, never raw", () => {
	assert.equal(buildSearchUrl("https://www.amazon.com/vine/vine-items", `a&b=c "d" <e> #f`), "/vine/vine-items?search=a%26b%3Dc%20%22d%22%20%3Ce%3E%20%23f");
});

test("sanitiseList: only well-formed Vine search addresses survive (a sync can bring anything)", () => {
	const good = "/vine/vine-items?search=dog&queue=encore";
	const bad = ["javascript:alert(1)", "//evil.example/vine/vine-items?search=a", "https://evil.example/vine/vine-items?search=a", "/vine/vine-items?search=a<script>", "/vine/orders?search=a", "/vine/vine-items?search=", 5, null, { a: 1 }, "/vine/vine-items?search=" + "a".repeat(200), "/vine/vine-items?search=a b"];
	assert.deepEqual(sanitiseList([...bad, good, good.toUpperCase(), good]), [good], "bad ones dropped, duplicates (any case) collapsed");
	assert.deepEqual(sanitiseList("garbage"), []);
	assert.deepEqual(sanitiseList(undefined), []);
	assert.deepEqual(sanitiseList(["/-/en/vine/vine-items?search=Hund"]), ["/-/en/vine/vine-items?search=Hund"]);
});

test("add / find / remove: order is kept, duplicates and a full list are refused", () => {
	let list = [];
	for (const t of ["a", "b", "c"]) list = addSaved(list, `/vine/vine-items?search=${t}`).list;
	assert.deepEqual(list, ["/vine/vine-items?search=a", "/vine/vine-items?search=b", "/vine/vine-items?search=c"]);
	assert.deepEqual(addSaved(list, "/vine/vine-items?search=B"), { ok: false, reason: "exists" });
	assert.deepEqual(addSaved(list, "javascript:1"), { ok: false, reason: "invalid" });
	assert.equal(findSaved(list, "/vine/vine-items?search=B"), "/vine/vine-items?search=b");
	assert.equal(findSaved(list, "/vine/vine-items?search=zzz"), null);
	assert.equal(findSaved(list, null), null);
	assert.deepEqual(removeSaved(list, "/vine/vine-items?search=b"), ["/vine/vine-items?search=a", "/vine/vine-items?search=c"]);
	assert.deepEqual(removeSaved(list, "/vine/vine-items?search=nope"), list);
	const full = Array.from({ length: MAX_SAVED }, (_, i) => `/vine/vine-items?search=s${i}`);
	assert.deepEqual(addSaved(full, "/vine/vine-items?search=extra"), { ok: false, reason: "full" });
	assert.equal(addSaved(full.slice(1), "/vine/vine-items?search=extra").ok, true);
});

test("labelFor: the search text, plus the queue when there is one", () => {
	assert.equal(labelFor("/vine/vine-items?search=dog"), "dog");
	assert.equal(labelFor("/vine/vine-items?search=dog%20toy&queue=encore"), "dog toy [AI]");
	assert.equal(labelFor("/vine/vine-items?search=x&queue=potluck"), "x [RFY]");
	assert.equal(labelFor("/vine/vine-items?search=x&queue=last_chance"), "x [AFA]");
	assert.equal(labelFor("/vine/vine-items?search=x&queue=weird"), "x");
});
