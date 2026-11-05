// Last compiled at 2026-11-04_2317
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/*global chrome*/
/**
 * Sends item notifications to the user's OWN Discord webhook(s).
 *
 * Triggers (each one can be switched on/off in Settings > Discord, each with its own message):
 *   keyword  - the item title matches a highlight keyword
 *   afa      - the item is listed in the "Additional items for all" queue
 *   rfy      - the item is listed in the "Recommended for you" queue
 *   zeroETV  - the item's ETV is known to be 0
 *   manual   - the Discord button on the item toolbar
 *
 * Automatic triggers are evaluated on the normal Vine pages, as the page is browsed. An item is
 * only sent once per trigger (remembered for DEDUPE_DAYS), so reloading a page does not re-send it.
 * The POST itself is done by the service worker (scripts/background/DiscordSender.js).
 * Nothing here talks to any server other than the webhook URL the user configured.
 */

import { Logger } from "/scripts/core/utils/Logger.js";
const logger = new Logger();

import { SettingsMgr } from "/scripts/core/services/SettingsMgrCompat.js";
const Settings = new SettingsMgr();

import { Environment } from "/scripts/core/services/Environment.js";
const env = new Environment();

import { Internationalization } from "/scripts/core/services/Internationalization.js";
const i13n = new Internationalization();

import { Item } from "/scripts/core/models/Item.js";
import { ScreenNotifier, ScreenNotification } from "/scripts/ui/components/ScreenNotifier.js";
const Notifications = new ScreenNotifier();

import {
	DEFAULT_TEMPLATE,
	WEBHOOK_TYPES,
	validateWebhookUrl,
	renderTemplate,
	dedupeKey,
	pruneSent,
} from "/scripts/core/utils/WebhookUtil.js";

const SENT_KEY = "discordSent";
const DEDUPE_DAYS = 14;
const QUEUE_ABBR = { potluck: "RFY", last_chance: "AFA", encore: "AI", all_items: "ALL" };

// "Already sent" memory: {key: ts} in chrome.storage.local, shared by every tab.
// Every read-modify-write happens under a Web Lock, so two tabs (or two tiles) can never both claim the same
// item, and a failed send can be rolled back in storage (not just in memory).
function withSentLock(fn) {
	if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request("vh-discord-sent", fn);
	return fn();
}

/** Atomically mark `keys` as sent. Returns the subset that was NOT already marked (the ones we now own). */
function claimSent(keys) {
	return withSentLock(async () => {
		const data = await chrome.storage.local.get(SENT_KEY);
		const sent = pruneSent(data[SENT_KEY], Date.now(), DEDUPE_DAYS * 24 * 3600 * 1000);
		const claimed = keys.filter((k) => !sent[k]);
		if (claimed.length === 0) return [];
		for (const k of claimed) sent[k] = Date.now();
		await chrome.storage.local.set({ [SENT_KEY]: sent });
		return claimed;
	});
}

/** Undo a claim (the message could not be delivered) so the next page load tries again. */
function releaseSent(keys) {
	return withSentLock(async () => {
		const data = await chrome.storage.local.get(SENT_KEY);
		const sent = data[SENT_KEY] || {};
		let changed = false;
		for (const k of keys) {
			if (sent[k] !== undefined) {
				delete sent[k];
				changed = true;
			}
		}
		if (changed) await chrome.storage.local.set({ [SENT_KEY]: sent });
	});
}

function toast(title, content, lifespan = 8) {
	const note = new ScreenNotification();
	note.title = title;
	note.lifespan = lifespan;
	note.content = content;
	Notifications.pushNotification(note);
}

/** The webhook URL for a trigger: its own URL if set, else the shared default URL. */
function urlFor(type) {
	const key = WEBHOOK_TYPES[type].settingKey;
	const own = (Settings.get(`discord.webhook.${key}.url`) || "").trim();
	return own || (Settings.get("discord.webhook.default.url") || "").trim();
}

function isTypeEnabled(type) {
	const key = WEBHOOK_TYPES[type].settingKey;
	return !!Settings.get("discord.active") && !!Settings.get(`discord.webhook.${key}.active`);
}

/** Build an Item from the tile's "See details" button data. Returns null if anything is missing. */
function itemFromTile(tile) {
	const asin = tile.getAsin();
	const btn = tile.getDOM().querySelector(`input[data-asin="${CSS.escape(asin)}"]`);
	if (!btn) return null;
	const queue = Item.getQueueFromData(btn.dataset.recommendationType, btn.dataset.recommendationId) || env.data.vineQueue;
	try {
		return new Item({
			asin,
			queue: queue || "encore",
			title: tile.getTitle(),
			img_url: tile.getThumbnailURL(),
			is_parent_asin: btn.dataset.isParentAsin,
			is_pre_release: btn.dataset.isPreRelease,
			enrollment_guid: Item.getEnrollmentGuidFromRecommendationId(btn.dataset.recommendationId || ""),
		});
	} catch (e) {
		logger.add("DISCORD: cannot build item for " + asin + ": " + e.message);
		return null;
	}
}

function placeholders(item, tile, extra = {}) {
	const queue = item.data.queue;
	return {
		QUEUE_NAME: QUEUE_ABBR[queue] || queue || "",
		TITLE: tile.getTitle() || "",
		IMG_URL: tile.getThumbnailURL() || "",
		ASIN: item.data.asin,
		VH_URL: item.getVHOpenModalURL(),
		VINE_SEARCH_URL: item.getVineSearchURL(tile.getTitle() || item.data.asin),
		AMZ_URL: item.getAmazonURL(),
		KEYWORD: extra.keyword || "",
		ETV: extra.etv ?? "",
	};
}

function send(type, tile, item, extra) {
	const key = WEBHOOK_TYPES[type].settingKey;
	const url = urlFor(type);
	const check = validateWebhookUrl(url);
	if (!check.ok) {
		return Promise.resolve({ ok: false, error: "Webhook URL: " + check.reason });
	}
	const template = Settings.get(`discord.webhook.${key}.content`) || DEFAULT_TEMPLATE;
	const rendered = renderTemplate(template, placeholders(item, tile, extra));
	if (!rendered.ok) return Promise.resolve({ ok: false, error: rendered.error });

	return new Promise((resolve) => {
		try {
			chrome.runtime.sendMessage({ type: "discordSend", url, body: rendered.body }, (res) => {
				void chrome.runtime.lastError;
				resolve(res || { ok: false, error: "service worker did not answer" });
			});
		} catch (e) {
			resolve({ ok: false, error: e.message });
		}
	});
}

class DiscordWebhook {
	/** Is the manual toolbar button available? (master switch on, manual trigger on, a valid URL) */
	isManualAvailable() {
		return isTypeEnabled("manual") && validateWebhookUrl(urlFor("manual")).ok;
	}

	/**
	 * Called by the toolbar every time a tile's highlight/ETV state is (re)computed.
	 * @param {Tile} tile
	 * @param {{keyword: string|null, zeroETV: boolean, hidden: boolean, etv?: any}} info
	 */
	async onTileProcessed(tile, info) {
		try {
			if (!Settings.get("discord.active")) return;
			if (env.data.vineSearch || !env.data.vineQueue) return; // only real queue listings
			if (info.hidden) return;
			const asin = tile.getAsin();
			if (!asin) return;

			const triggers = [];
			if (info.keyword) triggers.push(["keyword", { keyword: info.keyword }]);
			if (env.data.vineQueue === "last_chance") triggers.push(["afa", {}]);
			if (env.data.vineQueue === "potluck") triggers.push(["rfy", {}]);
			if (info.zeroETV) triggers.push(["zeroETV", { etv: 0 }]);
			const wanted = triggers.filter(([type]) => isTypeEnabled(type) && validateWebhookUrl(urlFor(type)).ok);
			if (wanted.length === 0) return;

			if (await tile.isHidden()) return; // hidden through the hidden list

			// Claim first (atomic, persisted): avoids double sends across tiles, tabs and quick navigations.
			const keys = wanted.map(([type]) => dedupeKey(type, asin));
			const claimed = new Set(await claimSent(keys));
			const pending = wanted.filter(([type]) => claimed.has(dedupeKey(type, asin)));
			if (pending.length === 0) return;

			// An item that triggers several rules for the same webhook URL is sent once,
			// using the highest-priority rule (keyword > zero ETV > RFY > AFA).
			const priority = ["keyword", "zeroETV", "rfy", "afa"];
			pending.sort((a, b) => priority.indexOf(a[0]) - priority.indexOf(b[0]));
			const seenUrls = new Set();
			const item = itemFromTile(tile);
			if (!item) {
				await releaseSent([...claimed]);
				return;
			}
			for (const [type, extra] of pending) {
				const url = urlFor(type);
				if (seenUrls.has(url)) continue;
				seenUrls.add(url);
				const res = await send(type, tile, item, extra);
				if (!res.ok) {
					await releaseSent([...claimed]); // allow a retry on the next page load
					logger.add(`DISCORD: ${type} webhook failed for ${asin}: ${res.error}`);
					break;
				}
			}
		} catch (e) {
			logger.add("DISCORD: onTileProcessed error: " + e.message);
		}
	}

	/** Toolbar button: send this item now, regardless of the dedupe memory. */
	async sendManual(tile) {
		const item = itemFromTile(tile);
		if (!item) {
			toast("Discord", "Could not read this item's data from the page.");
			return false;
		}
		const res = await send("manual", tile, item, {});
		if (res.ok) {
			if (!Settings.get("notification.reduce")) toast("Discord", `Sent ${item.data.asin} to your Discord.`, 5);
			return true;
		}
		toast("Discord - send failed", String(res.error || "unknown error"), 12);
		return false;
	}
}

export { DiscordWebhook };
