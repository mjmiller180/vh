import test from "node:test";
import assert from "node:assert/strict";
import { validateWebhookUrl, renderTemplate, DEFAULT_TEMPLATE, pruneSent, withSafeMentions } from "../../scripts/core/utils/WebhookUtil.js";

const GOOD = "https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-123";

test("accepts discord webhooks", () => {
	assert.equal(validateWebhookUrl(GOOD).ok, true);
	assert.equal(validateWebhookUrl("https://discordapp.com/api/webhooks/1/abc").ok, true);
	assert.equal(validateWebhookUrl("https://ptb.discord.com/api/v10/webhooks/1/abc").ok, true);
});

test("rejects everything else (this is the exfiltration guard)", () => {
	for (const bad of [
		"", "   ", null, undefined, 42,
		"http://discord.com/api/webhooks/1/abc",
		"https://evil.example.com/api/webhooks/1/abc",
		"https://discord.com.evil.example/api/webhooks/1/abc",
		"https://anything.discord.com/api/webhooks/1/abc",
		"https://cdn.discordapp.com/api/webhooks/1/abc",
		"https://evildiscord.com/api/webhooks/1/abc",
		"https://discord.com/other/path",
		"https://user:pw@discord.com/api/webhooks/1/abc",
		"https://api.vinehelper.ovh/",
		"javascript:alert(1)",
	]) {
		assert.equal(validateWebhookUrl(bad).ok, false, String(bad));
	}
});

test("template substitution is JSON-safe", () => {
	const r = renderTemplate(DEFAULT_TEMPLATE, {
		QUEUE_NAME: "RFY",
		TITLE: 'Bob\'s "Best" Mug\nwith \\ slash',
		VH_URL: "https://www.amazon.com/vine/vine-items?queue=encore#openModal;%7B%7D",
		IMG_URL: "https://m.media-amazon.com/images/I/x.jpg",
	});
	assert.equal(r.ok, true);
	const parsed = JSON.parse(r.body);
	assert.equal(parsed.embeds[0].title, 'Bob\'s "Best" Mug\nwith \\ slash');
	assert.equal(parsed.content, "New item in RFY!");
});

test("long titles are truncated, invalid templates are reported", () => {
	const r = renderTemplate('{"t":"$TITLE"}', { TITLE: "x".repeat(1000) });
	assert.equal(JSON.parse(r.body).t.length, 250);
	assert.equal(renderTemplate("{not json $TITLE", { TITLE: "a" }).ok, false);
});

test("unknown placeholders are left alone, longer names win", () => {
	const r = renderTemplate('{"a":"$ETV_MAX","b":"$ETV","c":"$NOPE"}', { ETV: "1", ETV_MAX: "9" });
	assert.deepEqual(JSON.parse(r.body), { a: "9", b: "1", c: "$NOPE" });
});

test("pruneSent", () => {
	assert.deepEqual(pruneSent({ a: 1000, b: 9000 }, 10000, 2000), { b: 9000 });
});

test("mentions are disabled unless the template sets allowed_mentions itself", () => {
	const safe = JSON.parse(withSafeMentions('{"content":"@everyone look"}'));
	assert.deepEqual(safe.allowed_mentions, { parse: [] });
	const custom = '{"content":"hi","allowed_mentions":{"parse":["users"]}}';
	assert.equal(withSafeMentions(custom), custom);
	assert.equal(withSafeMentions("[1,2]"), "[1,2]");
	assert.throws(() => withSafeMentions("{not json"));
});
