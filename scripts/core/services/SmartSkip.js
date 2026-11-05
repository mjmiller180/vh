// Last compiled at 2026-11-05_1558
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/**
 * SmartSkip: press the start key (default "k") on a Vine page and it pages through the queue on a timer, stopping
 * at the first page that has an item you have not pinned and that was not already hidden.
 *
 *   start key   begin a session (opens page 1 of the configured queue)
 *   Space       pause / resume (resume re-checks the current page)
 *   Escape      stop and show the session totals
 *   previous    "brake": stop scanning but keep the session
 *   next / hide-all keys: you are taking over; scanning continues on the next page you load
 *
 * Pinned = in the pinned list; hidden items were already moved out of the Available grid, so only the Available
 * grid is looked at. The session lives in sessionStorage (this tab only) and is never sent anywhere.
 */
import { Logger } from "/scripts/core/utils/Logger.js";
const logger = new Logger();

import { SettingsMgr } from "/scripts/core/services/SettingsMgrCompat.js";
const Settings = new SettingsMgr();

import { Environment } from "/scripts/core/services/Environment.js";
const env = new Environment();

import { Internationalization } from "/scripts/core/services/Internationalization.js";
const i13n = new Internationalization();

import { Page } from "/scripts/ui/components/Page.js";
import { PinnedListMgr } from "/scripts/core/services/PinnedListMgr.js";

import {
	clampRange,
	pickDelay,
	formatDuration,
	decidePage,
	newSession,
	parseState,
	keyMatches,
	startUrl,
} from "/scripts/core/utils/SmartSkipLogic.js";

const STORAGE_KEY = "vs.smartskip";
const isTabActive = () => !document.hidden && document.hasFocus();

class SmartSkip {
	static #instance = null;
	#timer = null;
	#titleTimer = null;
	#originalTitle = null;
	#box = null;
	#installed = false;
	#final = null; //how the last session ended, shown in the status box for a while: {title, lines, until}
	#pageReady = false; //true once this page's tiles are processed (onPageReady has run)

	constructor() {
		if (SmartSkip.#instance) return SmartSkip.#instance;
		SmartSkip.#instance = this;
	}

	//## settings (strings from the settings page are parsed defensively)
	#enabled() {
		return Settings.get("smartSkip.enabled") !== false;
	}
	#maxPages() {
		return Settings.get("smartSkip.maxPages");
	}
	#delay() {
		const get = (p) => Settings.get(`smartSkip.delay.${p}`);
		return {
			active: clampRange(get("active.min"), get("active.max"), { min: 2500, max: 4000 }),
			background: clampRange(get("background.min"), get("background.max"), { min: 3500, max: 3500 }),
		};
	}
	#key(name) {
		return Settings.get(`keyBindings.${name}`);
	}

	//## session state
	#load() {
		try {
			return parseState(sessionStorage.getItem(STORAGE_KEY));
		} catch (e) {
			return null;
		}
	}
	#save(state) {
		try {
			sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		} catch (e) {}
	}
	#clear() {
		try {
			sessionStorage.removeItem(STORAGE_KEY);
		} catch (e) {}
	}

	/** Start listening for the keys. Call once per Vine page. */
	install() {
		if (this.#installed) return;
		this.#installed = true;
		document.addEventListener("keydown", (e) => this.#onKeyDown(e));
		window.addEventListener("focus", () => this.#resetTitle());
		setInterval(() => this.#draw(), 1000);
	}

	/** Called when the page's tiles are processed and the pinned/hidden state is final. */
	async onPageReady() {
		if (!this.#enabled()) return;
		this.#pageReady = true;
		this.#draw();
		const state = this.#load();
		if (state && state.status === "running") await this.#evaluate(state, true);
	}

	#onKeyDown(e) {
		if (!this.#enabled()) return;
		if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
		const el = document.activeElement;
		if (el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.nodeName) || el.isContentEditable)) return;

		const state = this.#load();
		// The stop key always works while a session exists, even if keyboard shortcuts were switched off meanwhile,
		// so a running session can never be left without a way to stop it.
		if (state && keyMatches(e.key, this.#key("smartSkipStop"))) return this.#terminate("SmartSkip stopped");
		if (!Settings.get("keyBindings.active")) return;

		if (!state) {
			if (!e.repeat && keyMatches(e.key, this.#key("smartSkipStart"))) this.#start();
			return;
		}
		if (keyMatches(e.key, this.#key("smartSkipPause"))) {
			// Space must still activate a focused button / link (toolbar, Amazon modal), and holding it must not flap.
			if (el && el.closest && el.closest("button, a, [role='button']")) return;
			e.preventDefault(); //only while a session exists, so the space bar scrolls normally otherwise
			if (!e.repeat) this.#togglePause(state);
		} else if (keyMatches(e.key, this.#key("previousPage"))) {
			this.#clearTimer();
			this.#resetTitle();
			this.#update(state, { status: "braked" });
		} else if (
			[this.#key("nextPage"), this.#key("hideAll"), this.#key("hideAllNext")].some((k) => keyMatches(e.key, k))
		) {
			//You are taking over: stop the pending auto-page, keep the session; scanning resumes on the next page load.
			this.#clearTimer();
			this.#resetTitle();
			this.#update(state, { status: "running", consecutive: 0 });
		}
	}

	#start() {
		this.#save(newSession());
		window.location.href = startUrl(i13n.getDomainTLD(), Settings.get("smartSkip.startQueue"));
	}

	#togglePause(state) {
		if (state.status === "running") {
			// pause whether or not a page-turn is pending (also while this page is still being processed)
			this.#clearTimer();
			this.#update(state, { status: "paused" });
			return;
		}
		// paused / braked / found: resume. Before this page is ready, only mark it running: onPageReady will evaluate it.
		this.#resetTitle();
		const next = this.#update(state, { status: "running" });
		if (this.#pageReady) this.#evaluate(next, false);
	}

	#update(state, patch) {
		const next = { ...state, ...patch };
		this.#save(next);
		this.#draw();
		return next;
	}

	/** Items in the Available grid that are not pinned. */
	async #scan() {
		const grid = Page.instance?.getGrid("vvp-items-grid");
		const tiles = grid ? Object.values(grid.getAllTiles() || {}) : [];
		const pinned = await new PinnedListMgr().getList();
		const unpinned = tiles.filter((t) => t && t.getAsin() && !pinned.has(t.getAsin())).length;
		return { available: tiles.length, unpinned };
	}

	async #evaluate(state, countPage) {
		if (!env.data.vineBrowsingListing || env.data.vineSearch) {
			return this.#terminate("SmartSkip stopped: this is not a queue page");
		}
		let st = state;
		if (countPage) st = this.#update(st, { seen: st.seen + 1 });

		const { unpinned } = await this.#scan();
		const verdict = decidePage({ unpinnedCount: unpinned, seen: st.seen, maxPages: this.#maxPages() });

		if (verdict === "limit") return this.#terminate("SmartSkip stopped: page limit reached");

		if (verdict === "found") {
			st = this.#update(st, { status: "found", consecutive: 0, found: countPage ? st.found + unpinned : st.found });
			this.#announce();
			return;
		}

		st = this.#update(st, { skips: st.skips + 1, consecutive: st.consecutive + 1 });
		this.#scheduleNext();
	}

	#nextLink() {
		const nav = document.querySelector("#vvp-items-grid-container nav ul");
		if (!nav || nav.querySelector("li.a-last.a-disabled")) return null;
		return nav.querySelector("li.a-last a") || nav.querySelector("li:last-child a");
	}

	#scheduleNext() {
		if (!this.#nextLink()) return this.#terminate("SmartSkip finished: end of the queue");
		const range = isTabActive() ? this.#delay().active : this.#delay().background;
		this.#clearTimer();
		this.#timer = setTimeout(() => {
			this.#timer = null;
			const cur = this.#load();
			if (!cur || cur.status !== "running") return;
			const link = this.#nextLink();
			if (link) link.click();
			else this.#terminate("SmartSkip finished: end of the queue");
		}, pickDelay(range));
	}

	#clearTimer() {
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = null;
	}

	#announce() {
		// the status box says FOUND NEW ITEMS (and what to do); a background tab also gets a pulsing title
		this.#startTitlePulse("NEW ITEM FOUND!");
	}

	#terminate(title) {
		const st = this.#load();
		this.#clearTimer();
		this.#resetTitle();
		this.#clear();
		// the session is over: the same status box shows how it ended and the totals for 30 seconds
		this.#final = st
			? { title, until: Date.now() + 30000, lines: [`Pages seen: ${st.seen}`, `Skipped: ${st.skips}`, `Items found: ${st.found}`, `Time: ${formatDuration(Date.now() - st.startedAt)}`] }
			: null;
		this.#draw();
		logger.add("SMARTSKIP: " + title);
	}

	//## title pulse while the tab is in the background
	#startTitlePulse(msg) {
		if (this.#titleTimer || isTabActive()) return;
		this.#originalTitle = document.title;
		let on = false;
		this.#titleTimer = setInterval(() => {
			document.title = on ? this.#originalTitle : `🎯 ${msg}`;
			on = !on;
		}, 1000);
	}
	#resetTitle() {
		if (this.#titleTimer) clearInterval(this.#titleTimer);
		this.#titleTimer = null;
		if (this.#originalTitle !== null) document.title = this.#originalTitle;
		this.#originalTitle = null;
	}

	//## status box (all text via textContent: nothing from storage is ever parsed as HTML)
	#draw() {
		const st = this.#load();
		if (st) this.#final = null; // a new session replaces the old result
		const showFinal = !st && this.#final && Date.now() < this.#final.until;
		if (!st && !showFinal) {
			this.#final = null;
			if (this.#box) this.#box.style.display = "none";
			return;
		}
		if (!this.#box) {
			this.#box = document.createElement("div");
			this.#box.id = "vs-smartskip";
			this.#box.style.cssText =
				"position:fixed;bottom:10px;right:10px;background:rgba(0,0,0,0.9);color:white;padding:12px;border-radius:8px;z-index:9999;font-family:monospace;font-size:12px;line-height:1.4;box-shadow:0 4px 10px rgba(0,0,0,0.5);border:1px solid #444;min-width:180px;pointer-events:none;";
			document.body.appendChild(this.#box);
		}
		const text0 = (text, style) => {
			const d = document.createElement("div");
			d.textContent = text;
			if (style) d.style.cssText = style;
			return d;
		};
		if (showFinal) {
			this.#box.replaceChildren(
				text0(`SmartSkip [${isTabActive() ? "ACTIVE" : "BG"}]`, "color:cyan;font-weight:bold;border-bottom:1px solid #444;margin-bottom:5px;padding-bottom:3px;"),
				text0(this.#final.title, "color:#ffff00;margin-bottom:5px;font-weight:bold;"),
				...this.#final.lines.map((l) => text0(l, "font-size:10px;color:#aaa;"))
			);
			this.#box.style.display = "block";
			return;
		}
		const label = {
			running: this.#timer ? `SCANNING (${st.consecutive})` : "ARMED (continues on the next page)",
			paused: "PAUSED",
			braked: "BRAKE APPLIED",
			found: "FOUND NEW ITEMS",
		}[st.status];
		const color = { running: "cyan", paused: "#ffff00", braked: "#ff4444", found: "#00ff00" }[st.status];

		const line = (text, style) => {
			const d = document.createElement("div");
			d.textContent = text;
			if (style) d.style.cssText = style;
			return d;
		};
		this.#box.replaceChildren(
			line(`SmartSkip [${isTabActive() ? "ACTIVE" : "BG"}]`, "color:cyan;font-weight:bold;border-bottom:1px solid #444;margin-bottom:5px;padding-bottom:3px;"),
			line(label, `color:${color};margin-bottom:5px;font-weight:bold;`),
			line(`Seen: ${st.seen} | Skips: ${st.skips}`, "font-size:10px;color:#aaa;"),
			line(`Runtime: ${formatDuration(Date.now() - st.startedAt)} | Found: ${st.found}`, "font-size:10px;color:#aaa;"),
			...(st.status === "found" ? [line("Pin or hide the new items, then press Space to keep scanning.", "margin-top:6px;color:#00ff00;max-width:220px;")] : []),
			...(st.status === "paused" ? [line("Space = resume, Esc = stop", "margin-top:6px;color:#ffff00;")] : [])
		);
		this.#box.style.display = "block";
	}
}

export { SmartSkip };
