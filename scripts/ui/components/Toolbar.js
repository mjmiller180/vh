import { Logger } from "/scripts/core/utils/Logger.js";
var logger = new Logger();

import { SettingsMgr } from "/scripts/core/services/SettingsMgrCompat.js";
var Settings = new SettingsMgr();

import { Environment } from "/scripts/core/services/Environment.js";
var env = new Environment();

import { ModalMgr } from "/scripts/ui/controllers/ModalMgr.js";
var dialogMgr = new ModalMgr();

import { Internationalization } from "/scripts/core/services/Internationalization.js";
var i13n = new Internationalization();

import { Item } from "/scripts/core/models/Item.js";

import { PinnedListMgr } from "/scripts/core/services/PinnedListMgr.js";
var PinnedList = new PinnedListMgr();

import { Template } from "/scripts/core/utils/Template.js";
var Tpl = new Template();

import { compileKeywordObjects } from "/scripts/core/utils/KeywordCompiler.js";
import { findMatch } from "/scripts/core/utils/KeywordMatcher.js";
import { escapeHTML } from "/scripts/core/utils/StringHelper.js";
import { DiscordWebhook } from "/scripts/core/services/DiscordWebhook.js";
const discord = new DiscordWebhook();

import { ScreenNotifier, ScreenNotification } from "/scripts/ui/components/ScreenNotifier.js";
var Notifications = new ScreenNotifier();

class Toolbar {
	#tile;
	#toolbarDOM;

	#pinDebounceTimer = null;
	#pinDebounceClickable = true;

	// Pre-compiled keywords for performance
	#compiledHighlightKeywords = null;
	#compiledHideKeywords = null;

	constructor(tileInstance) {
		this.#tile = tileInstance;
		this.#tile.setToolbar(this);

		// Compile highlight keywords
		const highlightKeywords = Settings.get("general.highlightKeywords");
		if (highlightKeywords && highlightKeywords.length > 0) {
			this.#compiledHighlightKeywords = compileKeywordObjects(highlightKeywords);
		} else {
			this.#compiledHighlightKeywords = [];
		}

		// Compile hide keywords
		const hideKeywords = Settings.get("general.hideKeywords");
		if (hideKeywords && hideKeywords.length > 0) {
			this.#compiledHideKeywords = compileKeywordObjects(hideKeywords);
		} else {
			this.#compiledHideKeywords = [];
		}
	}

	getTile() {
		return this.#tile;
	}

	//Create the bare bone structure of the toolbar
	async createProductToolbar() {
		// Use a fallback ID if ASIN is not available
		const asin = this.#tile.getAsin() || `no-asin-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		const toolbarId = "vh-toolbar-" + asin;
		let anchorTo = this.#tile.getDOM().querySelector(".vvp-item-tile-content"); //.vvp-item-tile-content should be the first child

		if (!anchorTo) {
			throw new Error("Cannot find .vvp-item-tile-content to attach toolbar");
		}

		//Load the toolbar template
		logger.add("DRAW: Creating #" + toolbarId);
		const prom = await Tpl.loadFile("scripts/ui/templates/toolbar.html");
		Tpl.setVar("toolbarId", toolbarId);
		Tpl.setVar("asin", asin);
		Tpl.setIf("announce", discord.isManualAvailable());
		if (Settings.get("unavailableTab.active")) {
			logger.add("DRAW-UPDATE-TOOLBAR: Create order widget");
			Tpl.setVar("orderWidget", await this.createOrderWidget());
		} else {
			Tpl.setVar("orderWidget", "");
		}

		if (Settings.get("general.listView")) {
			Tpl.setVar("flexDirection", "row");
		} else {
			Tpl.setVar("flexDirection", "column");
		}
		Tpl.setIf("details", Settings.get("general.detailsIcon"));
		Tpl.setIf("pinned", Settings.get("pinnedTab.active"));
		Tpl.setVar("pinnedClass", this.#tile.isPinned() ? "vh-icon-unpin" : "vh-icon-pin");
		Tpl.setIf("toggleview", Settings.get("hiddenTab.active"));
		this.#toolbarDOM = Tpl.render(prom, true);

		//Attach the toolbar to the tile's .vvp-item-tile-content container.
		anchorTo.insertAdjacentElement("afterbegin", this.#toolbarDOM);
		const container = this.#toolbarDOM.querySelector(`.vh-status-container`);
		if (container) {
			container.style.backgroundColor = Settings.get("general.toolbarBackgroundColor");
		}

		const container2 = this.#toolbarDOM.querySelector(`.vh-status-container2`);

		const etvToolbar = this.#toolbarDOM.querySelector(`.vh-toolbar-etv`);
		if (etvToolbar && !Settings.get("general.listView")) {
			etvToolbar.style.display = "none";
		}

		// "Send to my Discord" button
		const announceLink = this.#toolbarDOM.querySelector(".vh-announce-link[id^='vh-announce-link-']");
		if (announceLink) {
			announceLink.addEventListener("click", async (e) => {
				e.preventDefault();
				const ok = await discord.sendManual(this.#tile);
				if (ok) announceLink.style.opacity = "0.4";
			});
		}

		// If the small tiles will be shown, hide the ETV icon to gain space
		if (
			Settings.get("thorvarium.smallItems") ||
			Settings.get("thorvarium.mobileios") ||
			Settings.get("thorvarium.mobileandroid")
		) {
			let etvIcons = document.querySelectorAll(".vh-icon-etv");
			etvIcons.forEach((icon) => {
				icon.style.display = "none";
			});
		}

		//Display the hide link
		if (Settings.get("hiddenTab.active")) {
			let h = this.#toolbarDOM.querySelector(`#vh-hide-link-${this.#tile.getAsin()}`);
			if (h) {
				h.addEventListener("click", async (event) => {
					// A hide/display item button was pressed
					let asin = this.#tile.getAsin(); // Directly access ASIN from the context
					let tile = this.getTile().getGrid().getPage().getTileByASIN(asin);
					let gridId = tile.getGridId();

					switch (
						gridId // Current Grid
					) {
						case "vvp-items-grid":
						case "tab-unavailable":
							tile.hideTile();
							break;
						case "tab-hidden":
							tile.showTile();
							break;
					}

					this.getTile().getGrid().getPage().updateTileCounts();
				});
			}

			this.updateVisibilityIcon();
		}

		//Details icon
		if (Settings.get("general.detailsIcon")) {
			let detailsIcon = this.#toolbarDOM.querySelector(`#vh-details-link-${this.#tile.getAsin()}`);
			if (detailsIcon) {
				detailsIcon.addEventListener("click", async (event) => {
					//Get the details from the parent dom element matching .vvp-item-tile
					let tileDOM = this.#tile.getDOM();
					let details = tileDOM.closest(".vvp-item-tile").dataset;

					//Display modal windows with the details.
					let m = dialogMgr.newModal("item-details-" + this.#tile.getAsin());
					m.title = "Item " + this.#tile.getAsin();
					m.content = `
			<ul style="margin-bottom: 10px;">
				<li>First Seen: ${details.date}</li>
				<li>Highlight Keyword matching: ${details.highlightedKeyword}</li>
				<li>Hide Keyword matching: ${details.hideKeyword}</li>
				<li>Blur Keyword matching: ${details.blurredKeyword}</li>
			</ul>
		`;
					m.show();
				});
			}
		}

		//Pinned items event handler
		if (Settings.get("pinnedTab.active")) {
			let h2 = document.getElementById(`vh-pin-link-${this.#tile.getAsin()}`);

			if (h2) {
				h2.addEventListener("click", async (event) => {
					const target = event.target;
					//Debounce the pin click event
					if (!this.#pinDebounceClickable) {
						return false;
					}
					this.#pinDebounceClickable = false;
					target.classList.add("vh-disabled"); //Visually disable the pin click
					this.#pinDebounceTimer = setTimeout(async () => {
						this.#pinDebounceClickable = true;
						target.classList.remove("vh-disabled");
						clearTimeout(this.#pinDebounceTimer);
					}, 1000);
					//End of debounce

					// A hide/display item button was pressed
					let asin = this.#tile.getAsin(); // Directly access ASIN
					let tile = this.getTile().getGrid().getPage().getTileByASIN(asin);

					// Get the item title and thumbnail
					let title = tile.getTitle();
					let thumbnail = tile.getThumbnailURL();

					const btn = document.querySelector(`input[data-asin="${asin}"]`);

					if (btn) {
						//Check if the item is already pinned
						if (tile.isPinned()) {
							//Unpin the item
							tile.setPinned(false);
							await this.getTile().getGrid().getPage().removePinnedTile(asin);
						} else {
							//Pin the item
							tile.setPinned(true);
							const is_parent_asin = btn.dataset.isParentAsin;
							const enrollment_guid = btn.dataset.recommendationId.match(
								/#vine\.enrollment\.([a-f0-9-]+)/i
							)[1];

							try {
								const item = new Item({
									asin: asin,
									queue: env.data.vineQueue,
									title: title,
									img_url: thumbnail,
									is_parent_asin: is_parent_asin,
									enrollment_guid: enrollment_guid,
								});
								PinnedList.addItem(item);
								await this.getTile().getGrid().getPage().addPinnedTile(item);
							} catch (error) {
								console.error("[Toolbar] Cannot create item for pinning -", error.message, {
									source: "pin button click",
									asin: asin,
									queue: env.data.vineQueue,
									is_parent_asin: is_parent_asin,
									enrollment_guid: enrollment_guid,
								});
							}
						}

						this.getTile().getGrid().getPage().updateTileCounts();
					}
				});
			}
		}
	}

	updateVisibilityIcon() {
		if (!Settings.get("hiddenTab.active")) {
			return false;
		}

		if (!this.#toolbarDOM) {
			return false;
		}

		let icon = this.#toolbarDOM.querySelector(`#vh-hide-link-${this.#tile.getAsin()} div.vh-toolbar-icon`);
		let gridId = this.#tile.getGridId();

		if (icon) {
			// Remove classes
			icon.classList.remove("vh-icon-hide", "vh-icon-show");

			// Add classes based on gridId
			switch (gridId) {
				case "vvp-items-grid":
				case "tab-unavailable":
					icon.classList.add("vh-icon-hide");
					break;
				case "tab-hidden":
					icon.classList.add("vh-icon-show");
					break;
			}
		}
	}

	setETV(etv1, etv2, onlyIfEmpty = false) {
		// Check if toolbar DOM exists
		if (!this.#toolbarDOM) {
			logger.add(`TOOLBAR: Cannot set ETV - toolbar DOM is null for ASIN: ${this.#tile.getAsin()}`);
			return false;
		}

		let span = this.#toolbarDOM.querySelector(".vh-toolbar-etv .etv");

		// Check if the ETV span exists
		if (!span) {
			logger.add(`TOOLBAR: Cannot set ETV - .vh-toolbar-etv .etv not found for ASIN: ${this.#tile.getAsin()}`);
			return false;
		}

		if (onlyIfEmpty && span.textContent !== "") {
			return false;
		}

		let etv1ToFormat = etv1;
		let etv2ToFormat = etv2;
		if (Settings.isPremiumUser(2)) {
			etv1ToFormat = etv1 * Settings.get("general.ETV.modifier");
			etv2ToFormat = etv2 * Settings.get("general.ETV.modifier");
		}
		const formattedETV1 = new Intl.NumberFormat(i13n.getLocale(), {
			style: "currency",
			currency: i13n.getCurrency(),
		}).format(etv1ToFormat);
		const formattedETV2 = new Intl.NumberFormat(i13n.getLocale(), {
			style: "currency",
			currency: i13n.getCurrency(),
		}).format(etv2ToFormat);

		const originalETV = etv1 === etv2 ? etv2 : `${etv1}-${etv2}`;
		const newETV = etv1 === etv2 ? formattedETV2 : `${formattedETV1}-${formattedETV2}`;
		span.textContent = newETV;
		span.title = `ETV: ${originalETV}`;

		this.processHighlight(etv1, etv2);

		// Trigger change event manually
		let changeEvent = new Event("change", { bubbles: true });
		span.dispatchEvent(changeEvent);

		if (Settings.get("general.displayETV")) {
			const etvToolbar = this.#toolbarDOM.querySelector(".vh-toolbar-etv");
			if (etvToolbar) {
				etvToolbar.style.display = "flex";
			}
		}
	}

	setPrice(price) {
		if (!Settings.isPremiumUser(3) || !Settings.get("general.displayPrice")) {
			return false;
		}

		const etvToolbar = this.#toolbarDOM.querySelector(".vh-toolbar-etv");
		if (etvToolbar) {
			etvToolbar.style.display = "flex";
		}

		const formattedPrice = new Intl.NumberFormat(i13n.getLocale(), {
			style: "currency",
			currency: i13n.getCurrency(),
		}).format(price);

		let span = this.#toolbarDOM.querySelector(".vh-toolbar-etv .price");
		if (span) {
			span.textContent = formattedPrice;
			span.classList.add("defined");

			//If list view mode, add a margin-left and margin-right to the span
			if (Settings.get("general.listView")) {
				span.style.marginLeft = "20px";
				span.style.marginRight = "20px";
			}
		}
	}

	unknownETV() {
		this.processHighlight(null, null);
	}

	//Why is this method in the toolbar class and not the tile class? Who coded this?!
	processHighlight(etv1, etv2) {
		logger.add("Toolbar: processHighlight");

		let checkHideList = false;
		let match;
		let matchedKeyword = null;
		const oldHighlight = this.#tile.getDOM().dataset.highlightedKeyword;
		this.#tile.getDOM().dataset.highlightedKeyword = "";
		const highlightKeywords = Settings.get("general.highlightKeywords");
		if (highlightKeywords?.length > 0) {
			// Debug logging
			const title = this.#tile.getTitle();
			const asin = this.#tile.getAsin();
			if (Settings.get("general.debugKeywords")) {
				console.log("[Toolbar] Processing highlight for item:", {
					asin: asin,
					title: title.substring(0, 100) + (title.length > 100 ? "..." : ""),
					keywordsCount: highlightKeywords.length,
				});
			}

			// Use pre-compiled keywords for matching
			match = findMatch(title, this.#compiledHighlightKeywords, etv1, etv2);
			if (!match) {
				logger.add("Toolbar: processHighlight: no match");
				//No match now, remove the highlight
				this.#tile.getDOM().dataset.keywordHighlight = false;
				this.#tile.getDOM().dataset.typeHighlight = "0";

				checkHideList = true;
			} else {
				logger.add("Toolbar: processHighlight: match");
				//Match found, keep the highlight
				const matchString = typeof match === "object" ? match.contains || match.word || "" : match;

				if (Settings.get("general.debugKeywords")) {
					console.log("[Toolbar] Highlight match found:", {
						asin: this.#tile.getAsin(),
						title: this.#tile.getTitle().substring(0, 100),
						matchedKeyword: matchString,
						matchObject: match,
					});
				}

				matchedKeyword = matchString;
				this.#tile.getDOM().dataset.highlightedKeyword = escapeHTML(matchString);
				this.#tile.getDOM().dataset.keywordHighlight = true;
				this.#tile.getDOM().dataset.typeHighlight = "1";

				if (Settings.get("general.highlightKWFirst") && !oldHighlight) {
					logger.add("Toolbar: processHighlight: highlightKWFirst");
					//Move the highlighted item to the top of the grid
					this.#tile
						.getGrid()
						.getDOM()
						.insertBefore(this.#tile.getDOM(), this.#tile.getGrid().getDOM().firstChild);
				}
			}
		} else {
			this.#tile.getDOM().dataset.keywordHighlight = false;
			this.#tile.getDOM().dataset.typeHighlight = "0";
			checkHideList = true;
		}

		this.#tile.getDOM().dataset.hideKeyword = "";
		if (checkHideList) {
			//Check if the item should be hidden
			const hideKeywords = Settings.get("general.hideKeywords");
			if (Settings.get("hiddenTab.active") && hideKeywords?.length > 0) {
				// Use pre-compiled keywords for matching
				match = findMatch(this.#tile.getTitle(), this.#compiledHideKeywords, etv1, etv2);
				if (match) {
					logger.add("Toolbar: processHide: hide match");
					this.#tile.hideTile(false, false, true); //Do not save, skip the hidden manager: just move the tile.

					document.getElementById("vh-hide-link-" + this.#tile.getAsin()).style.display = "none";

					//Add a data-hide-keyword attribute to the tile
					const hideMatchString = typeof match === "object" ? match.contains || match.word || "" : match;
					this.#tile.getDOM().dataset.hideKeyword = escapeHTML(hideMatchString);
				}
			}
		}

		if (etv1 === null && etv2 === null) {
			logger.add("Toolbar: processHighlight: unknownETV");
			this.#tile.getDOM().dataset.unknownETV = true;
			this.#tile.getDOM().dataset.zeroETV = false;
			this.#tile.getDOM().dataset.typeUnknownETV = "1";
			this.#tile.getDOM().dataset.typeZeroETV = "0";
		} else if (parseFloat(etv1) == 0 || parseFloat(etv2) == 0) {
			logger.add("Toolbar: processHighlight: zeroETV");
			this.#tile.getDOM().dataset.zeroETV = true;
			this.#tile.getDOM().dataset.unknownETV = false;
			this.#tile.getDOM().dataset.typeZeroETV = "1";
			this.#tile.getDOM().dataset.typeUnknownETV = "0";
		} else {
			this.#tile.getDOM().dataset.zeroETV = false;
			this.#tile.getDOM().dataset.unknownETV = false;
			this.#tile.getDOM().dataset.typeZeroETV = "0";
			this.#tile.getDOM().dataset.typeUnknownETV = "0";
		}

		logger.add("Toolbar: processHighlight: colorize");
		this.#tile.colorizeHighlight();

		//Tell the Discord webhooks about this item (they decide if anything needs to be sent)
		discord.onTileProcessed(this.#tile, {
			keyword: matchedKeyword,
			zeroETV: this.#tile.getDOM().dataset.typeZeroETV === "1",
			hidden: !!this.#tile.getDOM().dataset.hideKeyword,
		});
	}

	//Create the order widget part of the toolbar
	//Can ben called by bootloader when receiving order messages
	async createOrderWidget(status = null) {
		if (status !== null) {
			// Get the current order info
			let success = status ? this.#tile.getOrderSuccess() + 1 : this.#tile.getOrderSuccess();
			let failed = !status ? this.#tile.getOrderFailed() + 1 : this.#tile.getOrderFailed();
			this.#tile.setOrders(success, failed);
		}

		// Generate the HTML for the widget
		let prom = await Tpl.loadFile("scripts/ui/templates/widget_order.html");
		Tpl.setVar("order_success", "-");
		Tpl.setVar("order_failed", "-");
		let content = Tpl.render(prom, false);
		return content;
	}
}

export { Toolbar };
