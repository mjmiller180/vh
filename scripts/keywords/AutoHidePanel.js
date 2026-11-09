// Last compiled at 2026-11-09_1758
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/**
 * "Auto-hide" panel inside Amazon's Product Details modal: click words of the title to build an auto-hide (or highlight)
 * keyword rule, see what it would do to the items on the page, settle conflicts, add it, undo it.
 *
 * Clicks:  click = a word (any of the clicked words)   Ctrl+click = part of a phrase (in the order clicked, other words
 *          may sit between them)   "+ phrase" closes the phrase so the next Ctrl+clicks start another one
 * All the rule logic is in KeywordRules.js (unit tested); this file is only the page side. Everything that comes from the
 * page or from storage is put on the page with textContent.
 */
import { SettingsMgr } from "/scripts/core/services/SettingsMgrCompat.js";
const Settings = new SettingsMgr();

import { Page } from "/scripts/ui/components/Page.js";
import { PinnedListMgr } from "/scripts/core/services/PinnedListMgr.js";
const PinnedList = new PinnedListMgr();

import { tokenizeTitle, brandFromByLine, buildRule, addRule, planAdd, analyse, narrowNewRule, narrowOtherRules, groupNames, cleanEntry } from "/scripts/keywords/KeywordRules.js";

const KEYS = { hide: "general.hideKeywords", highlight: "general.highlightKeywords" };
const ID = "vs-autohide";

const el = (tag, props = {}, ...kids) => {
	const e = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (v == null) continue;
		if (k === "class") e.className = v;
		else if (k === "text") e.textContent = v;
		else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
		else e.setAttribute(k, v);
	}
	e.append(...kids.filter((x) => x != null));
	return e;
};

const asList = (v) => (Array.isArray(v) ? v : []).map((x) => cleanEntry(typeof x === "string" ? { contains: x } : x));

class AutoHidePanel {
	static #instance = null;
	#observer = null;
	#queued = false;

	constructor() {
		if (AutoHidePanel.#instance) return AutoHidePanel.#instance;
		AutoHidePanel.#instance = this;
	}

	/** Call once on a Vine items page: a panel is added every time Amazon builds the Product Details dialog. */
	install() {
		if (this.#observer) return;
		this.#observer = new MutationObserver(() => {
			if (this.#queued) return;
			this.#queued = true;
			requestAnimationFrame(() => {
				this.#queued = false;
				this.#scan();
			});
		});
		this.#observer.observe(document.body, { childList: true, subtree: true });
		this.#scan();
	}

	#scan() {
		for (const dialog of document.querySelectorAll(".a-popover-modal")) {
			const content = dialog.querySelector("#vvp-product-details-modal--content");
			if (!content || dialog.querySelector("." + ID)) continue;
			// First thing in the dialog's own scrolling area: Amazon's product block can be taller than its box, so anything
			// placed after it would overlap the picture or the option dropdowns.
			(dialog.querySelector(".a-popover-inner") || content.parentNode).prepend(this.#build(dialog));
		}
	}

	// ------------------------------------------------------------------ what the modal shows
	#readProduct(dialog) {
		const link = dialog.querySelector("#vvp-product-details-modal--product-title");
		const asin = (link?.getAttribute("href") || "").match(/\/dp\/([A-Z0-9]{10})/i)?.[1]?.toUpperCase() || null;
		let title = (link?.textContent || "").replace(/\s+/g, " ").trim();
		if (!title && asin) title = Page.instance?.getTileByASIN(asin)?.getTitle() || "";
		const brand = brandFromByLine(dialog.querySelector("#vvp-product-details-modal--by-line")?.textContent);
		return { asin, title, brand };
	}

	/** The tiles on the page that are shown now (the main grid), with their titles and whether they are pinned. */
	#pageItems() {
		const grid = Page.instance?.getGrid("vvp-items-grid");
		const tiles = grid ? Object.values(grid.getAllTiles() || {}) : [];
		const pinned = new Set();
		const items = [];
		for (const t of tiles) {
			const asin = t.getAsin();
			if (!asin) continue;
			items.push({ asin, title: t.getTitle() || "", tile: t });
			if (t.isPinned() || (PinnedList.isPinned && PinnedList.isPinned(asin))) pinned.add(asin);
		}
		return { items, pinned };
	}

	// ------------------------------------------------------------------ the panel
	#build(dialog) {
		const state = {
			kind: "hide",
			words: [], // clicked words, in order
			current: [], // the phrase being built (Ctrl+click)
			phrases: [], // closed phrases
			brand: false,
			unless: "",
			group: "",
			override: null, // the user edited the expression by hand
			resolution: null, // "keep" | "win" | null
			product: { asin: null, title: "", brand: null },
			done: null, // after Add: what to undo
		};

		const root = el("div", { class: ID });
		const toggle = el("button", { type: "button", class: "vs-ah-toggle", title: "Add auto-hide or highlight keywords from this title", text: "Hide / Highlight" });
		const body = el("div", { class: "vs-ah-body", hidden: "" });
		root.append(toggle, body);

		// While the panel is open "Request product" is off, so a click meant for the panel can never request the item.
		// Amazon's handler listens on the outer span, so the click is stopped before it gets there.
		const lock = (on) => {
			const btn = dialog.querySelector("#vvp-product-details-modal--request-btn");
			if (!btn) return;
			btn.classList.toggle("a-button-disabled", on);
			btn.classList.toggle("vs-ah-locked", on);
			const input = btn.querySelector("input");
			if (input) input.disabled = on;
			if (on) dialog.dataset.vsLocked = "1";
			else delete dialog.dataset.vsLocked;
		};
		if (!dialog.dataset.vsLockGuard) {
			dialog.dataset.vsLockGuard = "1";
			dialog.addEventListener(
				"click",
				(e) => {
					if (dialog.dataset.vsLocked && e.target.closest?.("#vvp-product-details-modal--request-btn, [data-action='vvp-request-product']")) {
						e.preventDefault();
						e.stopImmediatePropagation();
					}
				},
				true
			);
		}
		const closePanel = () => {
			body.hidden = true;
			lock(false);
		};
		toggle.addEventListener("click", () => {
			if (!body.hidden) return closePanel();
			if (body.hidden) {
				lock(true);
				state.product = this.#readProduct(dialog);
				state.words = [];
				state.current = [];
				state.phrases = [];
				state.brand = false;
				state.unless = "";
				state.override = null;
				state.resolution = null;
				state.done = null;
				body.hidden = false;
				render();
				root.scrollIntoView({ block: "nearest" });
			}
		});

		const current = () => {
			const key = KEYS[state.kind];
			return { key, list: asList(Settings.get(key)), hide: asList(Settings.get(KEYS.hide)), highlight: asList(Settings.get(KEYS.highlight)) };
		};

		const buildEntry = () => {
			const low = (w) => w.toLowerCase();
			const phrases = [...state.phrases, state.current].filter((p) => p.length).map((p) => p.map((w) => [low(w)]));
			const built = buildRule({ words: state.words.map(low), phrases, brands: state.brand && state.product.brand ? [state.product.brand] : [] });
			if (!built) return null;
			let without = "";
			const un = state.unless.split(",").map((s) => s.trim()).filter(Boolean);
			if (un.length) without = buildRule({ words: un })?.contains || "";
			return { entry: { contains: state.override ?? built.contains, without, etv_min: "", etv_max: "", ...(state.group.trim() ? { group: state.group.trim() } : {}) }, built, un };
		};

		const validRegex = (s) => {
			try {
				new RegExp(s);
				return true;
			} catch (e) {
				return false;
			}
		};

		const render = () => {
			body.replaceChildren();
			const { list, hide, highlight } = current();
			const kindWord = state.kind === "hide" ? "hide" : "highlight";

			// hide | highlight
			body.append(
				el(
					"div",
					{ class: "vs-ah-row" },
					...["hide", "highlight"].map((k) =>
						el("button", {
							type: "button",
							class: "vs-ah-mode" + (state.kind === k ? " vs-ah-on" : ""),
							text: k === "hide" ? "Auto-hide" : "Highlight",
							onclick: () => {
								state.kind = k;
								state.resolution = null;
								state.done = null;
								render();
							},
						})
					)
				)
			);

			if (!state.product.title) {
				body.append(el("p", { class: "vs-ah-note", text: "The title has not loaded yet. Close the panel and open it again in a moment." }));
				return;
			}
			body.append(
				el("p", { class: "vs-ah-help", text: "Click a word = any of the clicked words. Ctrl+click words = a phrase, in the order clicked (other words may sit between). “+ phrase” starts another phrase." })
			);

			// chips
			const chips = el("div", { class: "vs-ah-chips" });
			const phraseIndex = (w) => state.current.indexOf(w);
			for (const t of tokenizeTitle(state.product.title).slice(0, 60)) {
				const inWords = state.words.includes(t.text);
				const inPhrase = state.current.includes(t.text) || state.phrases.some((p) => p.includes(t.text));
				chips.append(
					el(
						"button",
						{
							type: "button",
							class: "vs-ah-chip" + (inWords ? " vs-ah-word" : "") + (inPhrase ? " vs-ah-phrase" : "") + (t.stop ? " vs-ah-stop" : ""),
							title: "Click: word. Ctrl+click: phrase.",
							onclick: (ev) => {
								const w = t.text;
								if (ev.ctrlKey || ev.metaKey) {
									const i = phraseIndex(w);
									if (i >= 0) state.current.splice(i, 1);
									else state.current.push(w);
								} else {
									const i = state.words.indexOf(w);
									if (i >= 0) state.words.splice(i, 1);
									else state.words.push(w);
								}
								state.override = null;
								state.resolution = null;
								render();
							},
						},
						t.text,
						phraseIndex(t.text) >= 0 ? el("sup", { text: String(phraseIndex(t.text) + 1) }) : null
					)
				);
			}
			body.append(chips);

			const row2 = el("div", { class: "vs-ah-row" });
			if (state.product.brand)
				row2.append(
					el("button", {
						type: "button",
						class: "vs-ah-chip" + (state.brand ? " vs-ah-word" : ""),
						text: (state.kind === "hide" ? "Hide this brand: " : "Highlight this brand: ") + state.product.brand,
						onclick: () => {
							state.brand = !state.brand;
							state.override = null;
							state.resolution = null;
							render();
						},
					})
				);
			row2.append(
				el("button", {
					type: "button",
					class: "vs-ah-small",
					text: "+ phrase",
					disabled: state.current.length < 2 ? "" : null,
					onclick: () => {
						if (state.current.length >= 2) state.phrases.push(state.current);
						state.current = [];
						state.override = null;
						render();
					},
				}),
				el("button", {
					type: "button",
					class: "vs-ah-small",
					text: "Clear",
					onclick: () => {
						Object.assign(state, { words: [], current: [], phrases: [], brand: false, override: null, resolution: null, done: null });
						render();
					},
				})
			);
			body.append(row2);
			if (state.phrases.length)
				body.append(el("div", { class: "vs-ah-phrases", text: "Phrases: " + state.phrases.map((p) => p.join(" … ")).join("   |   ") }));

			const be = buildEntry();
			if (!be) {
				body.append(el("p", { class: "vs-ah-note", text: "Pick at least one word, phrase or the brand." }));
				if (state.done) body.append(this.#doneBox(state, render));
				return;
			}

			// unless + group
			const unless = el("input", { type: "text", class: "vs-ah-text", placeholder: "e.g. kit, bundle", value: state.unless });
			unless.addEventListener("change", () => {
				state.unless = unless.value;
				state.resolution = null;
				render();
			});
			const groups = groupNames(list);
			const dl = el("datalist", { id: ID + "-groups" }, ...groups.map((g) => el("option", { value: g })));
			const group = el("input", { type: "text", class: "vs-ah-text", list: ID + "-groups", placeholder: "(no group)", value: state.group });
			group.addEventListener("change", () => {
				state.group = group.value;
				render();
			});
			body.append(el("label", { class: "vs-ah-field" }, "…but not if the title also contains: ", unless), el("label", { class: "vs-ah-field" }, "Group: ", group, dl));

			// expression
			const expr = el("input", { type: "text", class: "vs-ah-text vs-ah-expr", value: be.entry.contains, "aria-label": "Rule expression" });
			expr.addEventListener("change", () => {
				state.override = expr.value;
				state.resolution = null;
				render();
			});
			const exprOk = validRegex(be.entry.contains) && validRegex(be.entry.without);
			body.append(
				el("p", { class: "vs-ah-summary", text: be.built.summary + (be.un.length ? `, but not if it also contains ${be.un.join(", ")}` : "") + "." }),
				el("label", { class: "vs-ah-field" }, "Rule (editable): ", expr)
			);
			if (!exprOk) {
				body.append(el("p", { class: "vs-ah-warn", text: "That is not a valid expression." }));
				return;
			}

			// where it would go + what it does on this page
			const plan = planAdd(list, be.entry);
			body.append(
				el("p", {
					class: "vs-ah-note",
					text:
						plan.action === "exists"
							? "Already in your list."
							: plan.action === "merged"
							? `Will be added to an existing rule${plan.target.group ? ` in the group “${plan.target.group}”` : ""}.`
							: `Will be added as a new rule${be.entry.group ? ` in the group “${be.entry.group}”` : ""}.`,
				})
			);

			const { items, pinned } = this.#pageItems();
			const a = analyse({ kind: state.kind, entry: be.entry, items: items.map(({ asin, title }) => ({ asin, title })), hide, highlight, pinned });
			const shown = a.matches.filter((m) => state.kind === "highlight" || !pinned.has(m.asin));
			const info = el("div", { class: "vs-ah-preview" }, el("strong", { text: `On this page: ${shown.length} item${shown.length === 1 ? "" : "s"} would be ${state.kind === "hide" ? "hidden" : "highlighted"}.` }));
			const ul = el("ul", {}, ...shown.slice(0, 6).map((m) => el("li", { text: m.title })));
			if (shown.length) info.append(ul);
			if (shown.length > 6) info.append(el("div", { text: `… and ${shown.length - 6} more` }));
			if (state.kind === "hide" && a.pinned.length)
				info.append(el("div", { class: "vs-ah-note", text: `${a.pinned.length} pinned item${a.pinned.length === 1 ? "" : "s"} match but stay visible: pinning overrides hide keywords for the pinned item.` }));
			if (a.alreadyCovered.length)
				info.append(el("div", { class: "vs-ah-note", text: `${a.alreadyCovered.length} of these already match a rule in this list.` }));
			body.append(info);

			// conflicts
			const otherName = state.kind === "hide" ? "highlight" : "hide";
			if (a.conflicts.length) {
				const box = el("div", { class: "vs-ah-conflict" }, el("strong", { text: `Conflict: ${a.conflicts.length} of these also match your ${otherName} keywords. Choose which wins:` }));
				box.append(el("ul", {}, ...a.conflicts.slice(0, 4).map((c) => el("li", { text: `${c.title}  —  ${otherName} rule “${c.alternative ?? "?"}”` }))));
				const opts = [
					["keep", `Keep the ${otherName} keyword: leave those items out of this new rule`],
					["win", `The new rule wins: edit the ${otherName} rule so it no longer matches them`],
				];
				for (const [v, label] of opts) {
					const r = el("input", { type: "radio", name: ID + "-res", value: v });
					r.checked = state.resolution === v;
					r.addEventListener("change", () => {
						state.resolution = v;
						render();
					});
					box.append(el("label", { class: "vs-ah-radio" }, r, " " + label));
				}
				box.append(el("div", { class: "vs-ah-note", text: "Or press Cancel to add nothing." }));
				body.append(box);
			}

			const needsChoice = a.conflicts.length > 0 && !state.resolution;
			const add = el("button", {
				type: "button",
				class: "vs-ah-go",
				text: state.kind === "hide" ? "Add auto-hide rule" : "Add highlight rule",
				disabled: needsChoice || plan.action === "exists" ? "" : null,
				onclick: async () => {
					add.disabled = true;
					await this.#apply(state, { ...current(), entry: be.entry, analysis: a, items, pinned });
					render();
				},
			});
			const cancel = el("button", {
				type: "button",
				class: "vs-ah-small",
				text: "Cancel",
				onclick: closePanel,
			});
			body.append(el("div", { class: "vs-ah-row" }, add, cancel));
			if (needsChoice) body.append(el("div", { class: "vs-ah-note", text: "Choose which keyword wins to continue." }));
			if (state.done) body.append(this.#doneBox(state, render));
		};

		return root;
	}

	#doneBox(state, render) {
		const d = state.done;
		return el(
			"div",
			{ class: "vs-ah-done" },
			el("span", { text: d.message + " " }),
			el("button", {
				type: "button",
				class: "vs-ah-small",
				text: "Undo",
				onclick: async () => {
					await Settings.set(KEYS.hide, d.before.hide);
					await Settings.set(KEYS.highlight, d.before.highlight);
					for (const t of d.tilesHidden) await t.showTile(false, false);
					for (const t of d.tilesMarked) {
						delete t.getDOM().dataset.keywordHighlight;
						t.getDOM().dataset.typeHighlight = "0";
					}
					state.done = null;
					render();
				},
			})
		);
	}

	/** Save the rule (and the other list when "the new rule wins"), then act on the tiles of this page. */
	async #apply(state, { hide, highlight, entry, analysis, items, pinned }) {
		const before = { hide, highlight };
		const other = state.kind === "hide" ? highlight : hide;
		let own = state.kind === "hide" ? hide : highlight;
		let newOther = other;
		let finalEntry = entry;
		if (analysis.conflicts.length && state.resolution === "keep") finalEntry = narrowNewRule(entry, analysis.conflicts);
		if (analysis.conflicts.length && state.resolution === "win") newOther = narrowOtherRules(other, analysis.conflicts, entry.contains);

		const res = addRule(own, finalEntry);
		const nextHide = state.kind === "hide" ? res.list : newOther;
		const nextHighlight = state.kind === "hide" ? newOther : res.list;
		const changed = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
		if (changed(hide, nextHide)) await Settings.set(KEYS.hide, nextHide);
		if (changed(highlight, nextHighlight)) await Settings.set(KEYS.highlight, nextHighlight);

		// the page: Toolbar compiled its rules when the page loaded, so act on the tiles now
		const after = analyse({ kind: state.kind, entry: finalEntry, items: items.map(({ asin, title }) => ({ asin, title })), hide: [], highlight: nextHighlight, pinned });
		const byAsin = new Map(items.map((i) => [i.asin, i.tile]));
		const tilesHidden = [];
		const tilesMarked = [];
		for (const m of after.matches) {
			const tile = byAsin.get(m.asin);
			if (!tile) continue;
			if (state.kind === "hide") {
				if (pinned.has(m.asin) || after.conflicts.some((c) => c.asin === m.asin)) continue;
				await tile.hideTile(false, false, true);
				tilesHidden.push(tile);
			} else {
				tile.getDOM().dataset.keywordHighlight = true;
				tile.getDOM().dataset.typeHighlight = "1";
				tilesMarked.push(tile);
			}
		}
		const verb = state.kind === "hide" ? "Hid" : "Highlighted";
		const n = state.kind === "hide" ? tilesHidden.length : tilesMarked.length;
		state.done = {
			before: JSON.parse(JSON.stringify(before)),
			tilesHidden,
			tilesMarked,
			message: `${res.action === "merged" ? "Added to an existing rule" : "Rule added"}. ${verb} ${n} item${n === 1 ? "" : "s"} on this page.`,
		};
	}
}

export { AutoHidePanel };
