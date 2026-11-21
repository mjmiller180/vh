// Last compiled at 2026-11-21_1828
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
// The queue page a pin remembers (scripts/core/utils/SourceUrl.js).
import test from "node:test";
import assert from "node:assert/strict";
import { cleanSourceUrl } from "../../scripts/core/utils/SourceUrl.js";

test("a Vine items page is kept as it is (query included), without its #fragment", () => {
	assert.equal(cleanSourceUrl("https://www.amazon.com/vine/vine-items?queue=encore&pn=&cn=&page=15"), "https://www.amazon.com/vine/vine-items?queue=encore&pn=&cn=&page=15");
	assert.equal(cleanSourceUrl("https://www.amazon.com/vine/vine-items?queue=encore&page=2#monitor"), "https://www.amazon.com/vine/vine-items?queue=encore&page=2");
	assert.equal(cleanSourceUrl("https://www.amazon.co.uk/vine/vine-items"), "https://www.amazon.co.uk/vine/vine-items");
	assert.equal(cleanSourceUrl("https://www.amazon.com/vine/vine-items?search=dog%20toy"), "https://www.amazon.com/vine/vine-items?search=dog%20toy");
});

test("anything else is refused (it may have come from a synced file)", () => {
	for (const bad of [
		null,
		undefined,
		42,
		"",
		"javascript:alert(1)",
		"http://www.amazon.com/vine/vine-items?page=2",
		"https://evil.example/vine/vine-items?page=2",
		"https://www.amazon.com.evil.example/vine/vine-items",
		"https://www.amazon.com/dp/B0ABCDEFGH",
		"https://www.amazon.com/vine/account",
		"https://www.amazon.com/vine/vine-items?page=2 onclick=x",
		"https://www.amazon.com/vine/vine-items?" + "a".repeat(700),
	])
		assert.equal(cleanSourceUrl(bad), null, String(bad).slice(0, 60));
});
