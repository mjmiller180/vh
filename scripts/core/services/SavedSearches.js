// Last compiled at 2026-11-07_2157
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/**
 * Saved searches on the Vine items pages:
 *  - "Save Search" next to the search box saves what is in the box (or the page's own search); on a saved search the
 *    same button reads "Remove Search"
 *  - the saved searches are links in the header between the Vine logo and the Messages / Help links, two per column,
 *    filling top then bottom, then the next column
 * The list is the setting savedSearches.items, so it is synced with the other settings. Everything shown from storage is
 * put on the page with textContent and only well-formed Vine addresses become links.
 */
import { SettingsMgr } from "/scripts/core/services/SettingsMgrCompat.js";
const Settings = new SettingsMgr();

import { buildSearchUrl, sanitiseList, findSaved, addSaved, removeSaved, labelFor, MAX_SAVED } from "/scripts/core/utils/SavedSearchLogic.js";

const SETTING = "savedSearches.items";

class SavedSearches {
	static #instance = null;
	#box = null;
	#button = null;
	#flashTimer = null;

	constructor() {
		if (SavedSearches.#instance) return SavedSearches.#instance;
		SavedSearches.#instance = this;
	}

	/** Call once on a Vine page (does nothing on pages that are not the items list). */
	install() {
		if (this.#box) return;
		const logo = document.getElementById("vvp-logo-link");
		const searchBar = document.querySelector(".vvp-container-search");
		if (!logo || !searchBar || !buildSearchUrl(location.href, "x")) return; // "x": only the address is checked here

		this.#box = document.createElement("div");
		this.#box.id = "vs-saved-searches";
		this.#box.setAttribute("aria-label", "Saved searches");
		logo.insertAdjacentElement("afterend", this.#box);

		this.#button = document.createElement("span");
		this.#button.id = "vs-save-search";
		this.#button.className = "a-button a-button-search";
		this.#button.setAttribute("role", "button");
		this.#button.tabIndex = 0;
		const inner = document.createElement("span");
		inner.className = "a-button-inner";
		const text = document.createElement("span");
		text.className = "a-button-text";
		inner.append(text);
		this.#button.append(inner);
		searchBar.insertBefore(this.#button, searchBar.firstChild);

		this.#button.addEventListener("click", () => this.#toggle());
		this.#button.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				this.#toggle();
			}
		});
		document.getElementById("vvp-search-text-input")?.addEventListener("input", () => this.#render());
		this.#render();
	}

	#list() {
		return sanitiseList(Settings.get(SETTING));
	}

	/** The saved-search address for what the box + page say right now (null: nothing to save). */
	#current() {
		const typed = document.getElementById("vvp-search-text-input")?.value ?? "";
		return buildSearchUrl(location.href, typed.trim() ? typed : undefined);
	}

	#render() {
		const list = this.#list();
		const current = this.#current();
		const here = buildSearchUrl(location.href); // the search this page is showing
		this.#box.replaceChildren(
			...list.map((url) => {
				const a = document.createElement("a");
				a.className = "vs-search-chip";
				a.href = url; // (only entries that passed sanitiseList get here)
				a.textContent = labelFor(url);
				a.title = labelFor(url);
				if (here && url.toLowerCase() === here.toLowerCase()) a.classList.add("vs-current");
				return a;
			})
		);
		if (this.#flashTimer) return; // a short message is showing on the button
		this.#button.firstChild.firstChild.textContent = findSaved(list, current) ? "Remove Search" : "Save Search";
	}

	#flash(message) {
		const label = this.#button.firstChild.firstChild;
		label.textContent = message;
		clearTimeout(this.#flashTimer);
		this.#flashTimer = setTimeout(() => {
			this.#flashTimer = null;
			this.#render();
		}, 2200);
	}

	async #toggle() {
		const current = this.#current();
		if (!current) return this.#flash("Type a search first");
		const list = this.#list();
		if (findSaved(list, current)) {
			await Settings.set(SETTING, removeSaved(list, current));
		} else {
			const res = addSaved(list, current, MAX_SAVED);
			if (!res.ok) return this.#flash(res.reason === "full" ? `List full (${MAX_SAVED})` : "Cannot save this one");
			await Settings.set(SETTING, res.list);
		}
		this.#render();
	}
}

export { SavedSearches };
