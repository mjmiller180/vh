// Last compiled at 2026-11-05_0209
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/**
 * Sends what the Vine "Orders" and "Reviews" pages show to the Google Sheet (through the service worker).
 *  - on /vine/orders: new orders -> DASHBOARD rows (date, order #, picture, ORDERED, title, ETV)
 *  - on /vine/vine-reviews: review status / quality score / review link -> the REVIEW columns of the same rows
 * Nothing happens unless "add automatically" is switched on in the Google settings tab.
 * "Send all pages": one extra button on those pages walks every page of the list (Amazon's own pages, same site,
 * one request every couple of seconds) and sends them in batches.
 */
import { SettingsMgr } from "/scripts/core/services/SettingsMgrCompat.js";
const Settings = new SettingsMgr();

import { ScreenNotifier, ScreenNotification } from "/scripts/ui/components/ScreenNotifier.js";
const Notifications = new ScreenNotifier();

import { parseOrdersPage, parseReviewsPage, parsePagination } from "/scripts/core/utils/VineListParser.js";
import { pageKind, oldestFirst, chunk, toSheetOrders, describeOrdersResult, describeReviewsResult, pageCount, isCapped, isSupportedHost, MAX_PAGES } from "/scripts/core/utils/SheetSyncLogic.js";
import { escapeHTML } from "/scripts/core/utils/StringHelper.js";

const BATCH = 50;
const PAGE_DELAY_MS = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// `text` is plain text (it may contain Google's or Chrome's error messages): it is escaped before it is shown
function say(title, text, lifespan = 12) {
	const note = new ScreenNotification();
	note.title = title;
	note.lifespan = lifespan;
	note.content = escapeHTML(text);
	Notifications.pushNotification(note).catch((e) => console.error("[SheetSync] could not show a message:", e));
}

const send = (message) =>
	new Promise((resolve) => {
		try {
			chrome.runtime.sendMessage(message, (res) => resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : res));
		} catch (e) {
			resolve({ ok: false, error: String(e?.message || e) });
		}
	});

const marketplace = () => location.hostname; // e.g. www.amazon.com

class SheetSync {
	static #instance = null;
	#busy = false;

	constructor() {
		if (SheetSync.#instance) return SheetSync.#instance;
		SheetSync.#instance = this;
	}

	/** Call once the page has loaded (and the settings have been refreshed). */
	async onPageReady() {
		const kind = pageKind(location.pathname);
		if (!kind || !isSupportedHost(location.hostname)) return;
		if (!Settings.get("google.sheet.enabled")) return;
		this.#addButton(kind);
		await this.#syncPage(document, kind, true);
	}

	async #syncPage(doc, kind, announce) {
		if (this.#busy) return null;
		this.#busy = true;
		try {
			return kind === "orders" ? await this.#orders(doc, announce) : await this.#reviews(doc, announce);
		} finally {
			this.#busy = false;
		}
	}

	async #orders(doc, announce) {
		const parsed = oldestFirst(parseOrdersPage(doc));
		if (parsed.length === 0) return null;
		const res = await send({ type: "googleAddOrders", orders: toSheetOrders(parsed, marketplace()) });
		const msg = describeOrdersResult(res);
		if (msg && announce) say("VineTools", msg);
		return res;
	}

	async #reviews(doc, announce) {
		const parsed = parseReviewsPage(doc);
		if (parsed.length === 0) return null;
		const res = await send({ type: "googleUpdateReviews", reviews: parsed });
		const msg = describeReviewsResult(res);
		if (msg && announce) say("VineTools", msg);
		return res;
	}

	#addButton(kind) {
		if (document.getElementById("vt-sheet-sync-all")) return;
		const anchor = document.querySelector(".vvp-tab-content p, #vvp-body, .vvp-tab-content") || document.body;
		const btn = document.createElement("button");
		btn.id = "vt-sheet-sync-all";
		btn.type = "button";
		btn.textContent = kind === "orders" ? "Send all orders to the sheet" : "Update the sheet from all review pages";
		btn.style.cssText = "margin:6px 0;padding:4px 10px;cursor:pointer";
		btn.addEventListener("click", () => this.#syncAll(kind, btn));
		anchor.parentNode.insertBefore(btn, anchor);
	}

	/** Walks every page of this list (page 1..N of the same address) and sends them. */
	async #syncAll(kind, btn) {
		if (this.#busy) return say("VineTools", "The automatic sync of this page is still running. Try again in a moment.", 6);
		const label = btn.textContent;
		btn.disabled = true;
		const totals = { added: 0, skipped: 0, updated: 0, unmatched: 0, failed: null, capped: 0 };
		try {
			const pagination = parsePagination(document);
			const pages = pageCount(pagination);
			totals.capped = isCapped(pagination) ? pagination.pages : 0;
			const orders = [];
			const reviews = [];
			for (let n = 1; n <= pages; n++) {
				btn.textContent = `Reading page ${n} of ${pages}…`;
				const url = new URL(location.href);
				url.searchParams.set("page", String(n));
				let doc = document;
				if (n !== Number(new URL(location.href).searchParams.get("page") || 1)) {
					const r = await fetch(url.href, { credentials: "same-origin" });
					if (!r.ok) throw new Error(`Amazon answered ${r.status} for page ${n}`);
					doc = new DOMParser().parseFromString(await r.text(), "text/html");
					await sleep(PAGE_DELAY_MS);
				}
				(kind === "orders" ? orders : reviews).push(...(kind === "orders" ? parseOrdersPage(doc) : parseReviewsPage(doc)));
			}
			this.#busy = true;
			const batches = kind === "orders" ? chunk(toSheetOrders(oldestFirst(orders), marketplace()), BATCH) : chunk(reviews, BATCH);
			let i = 0;
			for (const part of batches) {
				btn.textContent = `Sending ${++i} of ${batches.length}…`;
				const res = await send(kind === "orders" ? { type: "googleAddOrders", orders: part } : { type: "googleUpdateReviews", reviews: part });
				if (!res || !res.ok) {
					totals.failed = describeOrdersResult(res) || (res && res.reason) || "the sheet did not answer";
					break;
				}
				totals.added += res.added || 0;
				totals.skipped += res.skipped || 0;
				totals.updated += res.updated || 0;
				totals.unmatched += res.unmatched || 0;
			}
		} catch (e) {
			totals.failed = String(e?.message || e);
		} finally {
			this.#busy = false;
			btn.disabled = false;
			btn.textContent = label;
		}
		const text = totals.failed
			? `Stopped: ${totals.failed}`
			: kind === "orders"
				? `Added ${totals.added} order(s); ${totals.skipped} were already on the sheet.`
				: `Updated ${totals.updated} row(s); ${totals.unmatched} review(s) have no matching row on the sheet.`;
		say("VineTools", text + (totals.capped && !totals.failed ? ` Only the first ${MAX_PAGES} of ${totals.capped} pages were read.` : ""), 30);
	}
}

export { SheetSync };
