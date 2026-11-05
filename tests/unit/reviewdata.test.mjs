// Last compiled at 2026-11-05_1508
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
import test from "node:test";
import assert from "node:assert/strict";
import { createDraftStore, createSnippetStore, draftKeyFor, pickImages, todayIso } from "../../scripts/review/ReviewData.js";

const memory = () => {
	const data = {};
	return {
		data,
		get: async (k) => ({ [k]: structuredClone(data[k]) }),
		set: async (o) => {
			await new Promise((r) => setTimeout(r, Math.random() * 5)); // make races visible
			Object.assign(data, structuredClone(o));
		},
	};
};

test("draftKeyFor: by ASIN, by edit id, otherwise by path", () => {
	assert.equal(draftKeyFor("https://www.amazon.com/review/create-review?encoding=UTF&channel=vine-portal&asin=b0hcvx7xdg"), "asin:B0HCVX7XDG");
	assert.equal(draftKeyFor("https://www.amazon.com/reviews/edit-review/edit?asin=B0AAAAAAAA"), "asin:B0AAAAAAAA");
	assert.equal(draftKeyFor("https://www.amazon.com/reviews/edit-review/R1ABC?x=1"), "edit:R1ABC");
	assert.equal(draftKeyFor("https://www.amazon.com/review/review-your-purchases"), "page:/review/review-your-purchases");
	assert.equal(draftKeyFor("not a url"), "page:unknown");
	assert.equal(draftKeyFor("https://www.amazon.com/review/create-review?asin=bad"), "page:/review/create-review");
});

test("drafts: saved per key, expire after 30 days, at most 60 kept, concurrent saves do not lose each other", async () => {
	let t = 1_000_000;
	const st = memory();
	const d = createDraftStore(st, () => t);
	await Promise.all([d.put("a", { title: "A", text: "1" }), d.put("b", { title: "B", text: "2" })]);
	assert.equal((await d.get("a")).text, "1");
	assert.equal((await d.get("b")).title, "B");
	assert.equal(await d.get("missing"), null);
	t += 31 * 24 * 3600 * 1000;
	assert.equal(await d.get("a"), null, "expired");
	for (let i = 0; i < 70; i++) {
		t += 1000;
		await d.put("k" + i, { title: "", text: "x" + i });
	}
	assert.equal(Object.keys(st.data["vs.review.drafts"]).length, 60);
	assert.equal((await d.get("k69")).text, "x69");
	assert.equal(await d.get("k0"), null, "oldest dropped");
	await d.put("s", { title: "t", text: "x", submittedAt: 5 });
	assert.equal((await d.get("s")).submittedAt, 5);
});

test("drafts: very long text is capped; junk in storage is ignored", async () => {
	const st = memory();
	st.data["vs.review.drafts"] = ["not", "an", "object"];
	const d = createDraftStore(st);
	await d.put("a", { title: "x".repeat(900), text: "y".repeat(50000) });
	const got = await d.get("a");
	assert.equal(got.title.length, 500);
	assert.equal(got.text.length, 20000);
});

test("snippets: add / rename / remove, validated on read, concurrent adds all land", async () => {
	const st = memory();
	const s = createSnippetStore(st, "vs.review.templates");
	await Promise.all(["a", "b", "c"].map((id) => s.add({ id, name: "N" + id, text: "T" + id })));
	assert.deepEqual((await s.list()).map((x) => x.id).sort(), ["a", "b", "c"]);
	await s.rename("b", "Bee");
	assert.equal((await s.list()).find((x) => x.id === "b").name, "Bee");
	await s.remove("a");
	assert.deepEqual((await s.list()).map((x) => x.id).sort(), ["b", "c"]);
	st.data["vs.review.templates"] = [{ id: "ok", name: "n", text: "t" }, null, { id: 5 }, "junk"];
	assert.deepEqual((await s.list()).map((x) => x.id), ["ok"]);
	st.data["vs.review.templates"] = "garbage";
	assert.deepEqual(await s.list(), []);
});

test("pickImages keeps only image files; todayIso is local YYYY-MM-DD", () => {
	const files = [{ type: "image/png", name: "a" }, { type: "text/plain" }, { type: "image/jpeg" }, { type: "video/mp4" }];
	assert.equal(pickImages({ files }).length, 2);
	assert.deepEqual(pickImages(null), []);
	assert.equal(todayIso(new Date(2026, 10, 5, 23, 59)), "2026-11-05");
	assert.equal(todayIso(new Date(2026, 0, 3)), "2026-01-03");
});
