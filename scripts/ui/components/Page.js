// Last compiled at 2026-11-05_1508
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
import { Logger } from "/scripts/core/utils/Logger.js";
var logger = new Logger();

import { Environment } from "/scripts/core/services/Environment.js";
var env = new Environment();

import { Template } from "/scripts/core/utils/Template.js";
var Tpl = new Template();

import { SettingsMgr } from "/scripts/core/services/SettingsMgrCompat.js";
var Settings = new SettingsMgr();

import { Internationalization } from "/scripts/core/services/Internationalization.js";
var i13n = new Internationalization();

import { TileSizer } from "/scripts/ui/controllers/TileSizer.js";
var tileSizer = new TileSizer();

import { Item } from "/scripts/core/models/Item.js";

import { unescapeHTML } from "/scripts/core/utils/StringHelper.js";

import { PinnedListMgr } from "/scripts/core/services/PinnedListMgr.js";
var PinnedList = new PinnedListMgr();

import { HiddenListMgr } from "/scripts/core/services/HiddenListMgr.js";
var HiddenList = new HiddenListMgr();

import { CryptoKeys } from "/scripts/core/utils/CryptoKeys.js";
var cryptoKeys = new CryptoKeys();

import { Tile } from "/scripts/ui/components/Tile.js";

import { Grid } from "/scripts/ui/components/Grid.js";

class Page {
	currentTab = "vvp-items-grid";
	arrGrid = [];
	static instance = null;

	constructor() {
		if (Page.instance) {
			return Page.instance;
		}
		Page.instance = this;
	}

	addGrid(id, gridDOM) {
		this.arrGrid[id] = new Grid(id, gridDOM, this);
	}

	getGrid(id) {
		return this.arrGrid[id];
	}

	getTileByASIN(asin) {
		if (!asin) {
			return null;
		}

		//Loop through the arrGrid and get the tile from the grid
		for (const gridId in this.arrGrid) {
			const grid = this.arrGrid[gridId];
			const tile = grid.getTileByASIN(asin);
			if (tile) {
				return tile;
			}
		}
		return null;
	}

	updateTileCounts() {
		//Calculate how many tiles within each grids
		if (Settings.get("unavailableTab.active") || Settings.get("hiddenTab.active")) {
			const tab1 = document.getElementById("vh-available-count");
			if (tab1) {
				const count = this.getGrid("vvp-items-grid").getTileCount(true);
				tab1.innerText = count;
			}
		}
		if (Settings.get("unavailableTab.active")) {
			const tab2 = document.getElementById("vh-unavailable-count");
			if (tab2) {
				const count = this.getGrid("tab-unavailable").getTileCount(true);
				tab2.innerText = count;
			}
		}
		if (Settings.get("hiddenTab.active")) {
			const tab3 = document.getElementById("vh-hidden-count");
			if (tab3) {
				const count = this.getGrid("tab-hidden").getTileCount(true);
				tab3.innerText = count;
			}
		}
		if (Settings.get("pinnedTab.active")) {
			const tab4 = document.getElementById("vh-pinned-count");
			if (tab4) {
				const count = this.getGrid("tab-pinned").getTileCount(true);
				tab4.innerText = count;
			}
		}
	}

	async createGridInterface() {
		//Clean up interface (in case of the extension being reloaded)
		let tab0 = document.querySelector("ul#vh-tabs");
		if (tab0) tab0.remove();
		let tab2 = document.querySelector("div#tab-unavailable");
		if (tab2) tab2.remove();
		let tab3 = document.querySelector("div#tab-hidden");
		if (tab3) tab3.remove();
		let tab4 = document.querySelector("div#tab-pinned");
		if (tab4) tab4.remove();
		let tbs = document.querySelectorAll(".vh-status");
		tbs.forEach(function (toolbar) {
			toolbar.remove();
		});

		if (this.getGrid("vvp-items-grid") == undefined) {
			console.log("No listing on this page, not drawing tabs.");
			return false; // No listing on this page
		}

		//Implement the tab system.
		let tabs = document.createElement("div");
		tabs.setAttribute("id", "vh-tabs");
		tabs.classList.add("theme-default");

		let itemsGrid = this.getGrid("vvp-items-grid").getDOM();
		if (!itemsGrid) {
			return; //No items on this page
		}
		itemsGrid.parentNode.insertBefore(tabs, itemsGrid);
		itemsGrid.parentNode.removeChild(itemsGrid);
		itemsGrid.classList.add("tab-grid");
		tabs.appendChild(itemsGrid);

		let tplTabs = await Tpl.loadFile("scripts/ui/templates/tabs.html");

		Tpl.setIf("not_mobile", true);
		if (Settings.get("thorvarium.mobileandroid") || Settings.get("thorvarium.mobileios")) {
			Tpl.setVar("available", "A");
			Tpl.setVar("unavailable", "U");
			Tpl.setVar("hidden", "H");
			Tpl.setVar("pinned", "P");
		} else {
			Tpl.setVar("available", "Available");
			Tpl.setVar("unavailable", "Unavailable");
			Tpl.setVar("hidden", "Hidden");
			Tpl.setVar("pinned", "Pinned");
		}
		//If ordering system enabled
		Tpl.setIf("unavailable", Settings.get("unavailableTab.active"));

		//If the hidden tab system is activated
		Tpl.setIf("hidden", Settings.get("hiddenTab.active"));

		//If the hidden tab system is activated
		Tpl.setIf("pinned", Settings.get("pinnedTab.active"));

		const tabsContent = Tpl.render(tplTabs, true);
		tabs.insertBefore(tabsContent, tabs.firstChild);

		if (Settings.get("hiddenTab.active")) {
			//Add the toolbar for Hide All & Show All
			//Delete the previous one if any exist:
			this.removeElements("#vh-tabs .hidden-toolbar");

			//Generate the html for the hide all and show all widget
			let prom = await Tpl.loadFile("scripts/ui/templates/widget_hideall.html");
			Tpl.setVar("class", Settings.get("thorvarium.darktheme") ? "invert" : "");
			if (Settings.get("thorvarium.mobileandroid") || Settings.get("thorvarium.mobileios")) {
				Tpl.setIf("not_mobile", false);
				Tpl.setIf("mobile", true);
			} else {
				Tpl.setIf("not_mobile", true);
				Tpl.setIf("mobile", false);
			}
			let content = Tpl.render(prom, true);
			if (content == null) {
				logger.add("!!ERROR: Unable to fetch view/widget_hideall.html. Skipping.");
			} else {
				let clonedContent = content.cloneNode(true);

				// Prepend content to #vh-tabs
				let vtabs = document.querySelector("#vh-tabs");
				vtabs.insertBefore(content, vtabs.firstChild);
				vtabs.appendChild(clonedContent);
				clonedContent.style.marginTop = "5px";

				// Add event listeners to .vh-hideall and .vh-showall elements AND vh-hideallnext
				document.querySelectorAll(".vh-hideall").forEach((element) => {
					element.addEventListener("click", () => this.hideAllItems());
				});

				document.querySelectorAll(".vh-hideallnext").forEach((element) => {
					element.addEventListener("click", () => this.hideAllItemsNext());
				});

				document.querySelectorAll(".vh-showall").forEach((element) => {
					element.addEventListener("click", () => this.showAllItems());
				});
			}
		}

		//Actiate the tab system
		//Bind the click event for the tabs
		document.querySelectorAll("#tabs > ul li").forEach((item) => {
			item.onclick = (event) => {
				this.currentTab = item.querySelector("a").href.split("#").pop();
				this.#selectCurrentTab();
				item.classList.add("active");
			};
		});
		//Prevent links from being clickable
		document.querySelectorAll("#tabs > ul li a").forEach(function (item) {
			item.onclick = function (event) {
				event.preventDefault();
			};
		});
		this.#selectCurrentTab(true);
	}

	async addPinnedTile(item) {
		if (!(item instanceof Item)) {
			throw new Error("item is not an instance of Item");
		}

		const { asin, title, img_url, is_parent_asin, is_pre_release, enrollment_guid, unavailable } = item.data;

		//Check if the pin already exist:
		if (document.getElementById("vh-pin-" + asin) != undefined) return false;

		let templateFile;
		if (Settings.get("general.listView")) {
			templateFile = "pinned_tile_listview.html";
		} else {
			templateFile = "pinned_tile_gridview.html";
		}
		let prom2 = await Tpl.loadFile("scripts/ui/templates/" + templateFile);

		let truncatedTitle = title.length > 40 ? title.substr(0, 40).split(" ").slice(0, -1).join(" ") : title;

		// These characters were breaking search, resulting in zero results
		truncatedTitle = unescapeHTML(unescapeHTML(truncatedTitle)).replace(/[&,±]/g, " ");

		const search_url_slug = encodeURIComponent(truncatedTitle);

		const recommendationType = item.getRecommendationType();
		const recommendationId = item.getRecommendationString(env);

		Tpl.setVar("id", asin);
		Tpl.setVar("domain", i13n.getDomainTLD());
		Tpl.setVar("search_url_slug", search_url_slug);
		Tpl.setVar("img_url", img_url);
		Tpl.setVar("asin", asin);
		Tpl.setVar("description", title);
		Tpl.setVar("is_parent_asin", is_parent_asin);
		Tpl.setVar("is_pre_release", is_pre_release);
		Tpl.setVar("enrollment_guid", enrollment_guid);
		Tpl.setVar("recommendationType", recommendationType);
		Tpl.setVar("recommendationId", recommendationId);

		let content = Tpl.render(prom2, true);
		document.getElementById("tab-pinned").insertBefore(content, document.getElementById("tab-pinned").firstChild);

		tileSizer.adjustAll(content);

		if (unavailable) {
			this.#disableItem(content);
		}

		//Bind the click event for the unpin button
		document.querySelector("#vh-pin-" + asin + " .unpin-link").onclick = (e) => {
			e.preventDefault();

			this.removePinnedTile(asin);
			// updateTileCounts() is already called by tile.setPinned(false) in removePinnedTile
		};
	}

	async #disableItem(notif) {
		if (!notif) {
			return false;
		}

		//Remove the banner if it already existed
		notif.querySelector(".unavailable-banner")?.remove();

		//Add a new banner
		const banner = document.createElement("div");
		banner.classList.add("unavailable-banner");
		banner.innerText = "Unavailable";
		banner.style.isolation = "isolate"; // This prevents the banner from inheriting the filter effects
		const imgContainer = notif.querySelector(".vh-img-container");
		imgContainer.insertBefore(banner, imgContainer.firstChild);

		notif.style.opacity = "0.5";
		notif.style.filter = "brightness(0.7)";
	}

	async removePinnedTile(asin) {
		PinnedList.removeItem(asin);
		const pinnedTile = document.getElementById("vh-pin-" + asin);
		if (pinnedTile) {
			pinnedTile.remove();
		}

		//If it exists, mark the tile in the available grid as unpinned
		const tile = this.getTileByASIN(asin);
		//console.log("Removing pinned tile", asin, tile);
		if (tile) {
			tile.setPinned(false);
		}
	}

	async hideAllItems() {
		let arrTile = [];
		HiddenList.loadFromLocalStorage(); //Refresh the list in case it was altered in a different tab

		//Find out what the current active tab is
		let currentTab2 = "#vvp-items-grid";
		if (
			document.querySelector("#tab-unavailable") &&
			document.querySelector("#tab-unavailable").style.display !== "none"
		) {
			currentTab2 = "#tab-unavailable";
		}

		const vvpItemTiles = document.querySelectorAll(currentTab2 + " .vvp-item-tile");
		for (const vvpItemTile of vvpItemTiles) {
			let asin = Tile.getASINFromDom(vvpItemTile);
			if (!asin) {
				console.warn("VineSmyths: Skipping tile without ASIN in hideAllItems");
				continue; // Skip this tile if no ASIN found
			}
			arrTile.push({ asin: asin, hidden: true });
			let tile = this.getTileByASIN(asin); // Obtain the real tile
			if (tile && !tile.isPinned()) {
				await tile.hideTile(false, false); // Do not update local storage
			}
		}
		HiddenList.saveList();

		// Scoll to the RFY/AFA/AI header
		if (Settings.get("hiddenTab.scrollToRFY")) {
			var scrollTarget = document.getElementById("vvp-items-button-container");
			if (scrollTarget) {
				scrollTarget.scrollIntoView({ behavior: "instant", block: "start" });
			}
		}
	}

	async hideAllItemsNext() {
		await this.hideAllItems();

		// Add a small delay to ensure all DOM operations complete before navigation
		// This helps with Firefox Android click handling issues
		await new Promise((resolve) => setTimeout(resolve, 50));

		try {
			const nextLi = document.querySelector("#vvp-items-grid-container nav ul li:last-child a");
			if (nextLi) {
				const nextPage = nextLi.getAttribute("href");
				window.location = nextPage;
			}
		} catch (e) {
			//Do nothing
		}
	}

	async showAllItems() {
		let arrTile = [];
		HiddenList.loadFromLocalStorage(); //Refresh the list in case it was altered in a different tab

		const vvpItemTiles = document.querySelectorAll("#tab-hidden .vvp-item-tile");
		for (const vvpItemTile of vvpItemTiles) {
			let asin = Tile.getASINFromDom(vvpItemTile);
			if (!asin) {
				console.warn("VineSmyths: Skipping tile without ASIN in showAllItems");
				continue; // Skip this tile if no ASIN found
			}
			arrTile.push({ asin: asin, hidden: false });
			let tile = this.getTileByASIN(asin); //Obtain the real tile
			if (tile) {
				await tile.showTile(false, false); //Do not update local storage
			}
		}
		HiddenList.saveList();

		// Scoll to the RFY/AFA/AI header
		if (Settings.get("hiddenTab.scrollToRFY")) {
			var scrollTarget = document.getElementById("vvp-items-button-container");
			if (scrollTarget) {
				scrollTarget.scrollIntoView({ behavior: "instant", block: "start" });
			}
		}
	}

	#selectCurrentTab(firstRun = false) {
		//Hide all tabs
		document.querySelectorAll(".tab-grid").forEach(function (item) {
			item.style.display = "none";
		});

		if (!firstRun) {
			document.querySelectorAll("#tabs > ul li").forEach(function (item) {
				item.classList.remove("active");
			});
		} else {
			document.querySelector("#tabs > ul li:first-child").classList.add("active");
		}

		//Display the current tab
		document.querySelector("#" + this.currentTab).style.display = "grid";
	}

	/** Remove an element from the DOM, ignore if it does not exist
	 * @param selector CSS style selector of the element to remove
	 */
	removeElements(selector) {
		let elementsToRemove = document.querySelectorAll(selector);

		elementsToRemove.forEach(function (element) {
			element.remove();
		});
	}
}

export { Page };
