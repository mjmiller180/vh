import { Logger } from "/scripts/core/utils/Logger.js";
var logger = new Logger();

import { SettingsMgr } from "/scripts/core/services/SettingsMgrCompat.js";
var Settings = new SettingsMgr();

// Lazy-load TitleDebugLogger only when debug is enabled
let titleDebugger = null;
const getTitleDebugger = async () => {
	if (!titleDebugger) {
		const { TitleDebugLogger } = await import("/scripts/ui/components/TitleDebugLogger.js");
		titleDebugger = TitleDebugLogger.getInstance();
	}
	return titleDebugger;
};

import { Environment } from "/scripts/core/services/Environment.js";
var env = new Environment();

import { Page } from "/scripts/ui/components/Page.js";

import { HiddenListMgr } from "/scripts/core/services/HiddenListMgr.js";
var HiddenList = new HiddenListMgr();

import { VariantButton } from "/scripts/ui/components/VariantButton.js";

import { StyleUtils } from "/scripts/ui/utils/StyleUtils.js";

import { YMDHiStoISODate } from "/scripts/core/utils/DateHelper.js";
import { unescapeHTML, escapeHTML } from "/scripts/core/utils/StringHelper.js";

import "/scripts/vendor/canvas-confetti/dist/confetti.browser.js";
import "/scripts/vendor/splide/dist/js/splide.min.js";

class Tile {
	#tileDOM;
	#grid;
	#toolbar;
	#hidden = false;

	#asin;
	#isPinned = false;
	#orderSuccess = 0;
	#orderFailed = 0;
	#orderUnavailable = false;
	#title = null;
	#thumbnailUrl = null;
	#variantButton = null;

	constructor(obj, gridInstance) {
		this.#tileDOM = obj;
		this.#grid = gridInstance;
		this.#toolbar = null;

		// Extract ASIN early for logging
		const asinElement = this.#tileDOM.querySelector("div[data-asin]");
		if (asinElement) {
			this.#asin = asinElement.dataset.asin;
		}

		// Log tile creation for memory debugging
		if (window.MEMORY_DEBUGGER && Settings.get("general.debugMemory")) {
			console.log(`🏗️ Creating tile for ASIN: ${this.#asin}`);
		}
		this.#asin = this.#findasin();
		this.#orderSuccess = 0;
		this.#orderFailed = 0;

		// Check if ASIN extraction failed
		if (!this.#asin) {
			logger.add("WARNING: Creating Tile with null ASIN - tile will have limited functionality");
			console.warn("VineHelper: Tile created without ASIN", obj);
			// Mark the tile DOM to indicate it has no ASIN
			this.#tileDOM.classList.add("vh-no-asin");
			this.#tileDOM.dataset.vhNoAsin = "true";
		}

		logger.add("Created Tile: " + this.#asin + " to grid: " + gridInstance?.getId());
	}

	//#################
	//## Private method
	#findasin() {
		try {
			return Tile.getASINFromDom(this.#tileDOM);
		} catch (e) {
			logger.add("Error finding ASIN: " + e.message);
			return null;
		}
	}

	//#################
	//## Public methods

	async addVariant(asin, title, etv) {
		// Only add button if it doesn't exist
		if (!this.#variantButton) {
			this.#variantButton = new VariantButton(this);
			await this.#variantButton.initialize();
		}

		await this.#variantButton.addVariant(asin, title, etv);
	}

	getVariantButton() {
		return this.#variantButton;
	}

	isPinned() {
		return this.#isPinned;
	}

	setPinned(isPinned) {
		this.#isPinned = isPinned;

		if (this.#asin) {
			const pinIcon = this.#tileDOM.querySelector("#vh-pin-icon-" + this.#asin);
			if (pinIcon) {
				pinIcon.classList.toggle("vh-icon-pin", !isPinned);
				pinIcon.classList.toggle("vh-icon-unpin", isPinned);
			}
		}
	}

	async animateVanish() {
		const defaultOpacity = window.getComputedStyle(this.#tileDOM).opacity;

		// Animate opacity to 0 (hide)
		await this.#animateOpacity(this.#tileDOM, 0, 150);

		// Reset styles
		this.#tileDOM.style.opacity = defaultOpacity;
		this.#tileDOM.style.height = "100%";
	}

	setToolbar = function (toolbarInstance) {
		this.#toolbar = toolbarInstance;
	};
	getToolbar() {
		return this.#toolbar;
	}

	setOrders(success, failed) {
		const successElement = this.#tileDOM.querySelector(".vh-order-success");
		const failedElement = this.#tileDOM.querySelector(".vh-order-failed");
		if (successElement) {
			successElement.textContent = success;
		}
		if (failedElement) {
			failedElement.textContent = failed;
		}

		this.#orderSuccess = success;
		this.#orderFailed = failed;
	}

	setUnavailable(orderUnavailable) {
		this.#orderUnavailable = orderUnavailable;
	}

	getUnavailable() {
		return this.#orderUnavailable;
	}

	getOrderSuccess() {
		return this.#orderSuccess;
	}
	getOrderFailed() {
		return this.#orderFailed;
	}

	wasOrdered() {
		return this.#orderSuccess > 0 || this.#orderFailed > 0;
	}

	getStatus() {
		if (Settings.get("unavailableTab.active")) {
			if (this.#orderSuccess > 0 && this.#orderSuccess > this.#orderFailed)
				return env.data.NOT_DISCARDED_ORDER_SUCCESS;

			if (this.#orderFailed > 0 && this.#orderFailed > this.#orderSuccess) return env.data.DISCARDED_ORDER_FAILED;
		}
		return env.data.NOT_DISCARDED;
	}

	getAsin() {
		return this.#asin;
	}

	getDOM() {
		return this.#tileDOM;
	}

	getGrid() {
		return this.#grid;
	}

	getGridId() {
		return this.#grid.getId();
	}
	getTitle() {
		if (this.#title == null) {
			this.#title = this.#getTitleFromDom(this.#tileDOM);
			// Debug logging
			const settings = new SettingsMgr();
			if (settings.get("general.debugKeywords")) {
				console.log("[Tile] Title retrieved from DOM:", {
					asin: this.getAsin(),
					title: this.#title.substring(0, 100) + (this.#title.length > 100 ? "..." : ""),
					domElement: this.#tileDOM,
				});
			}
			// Title debug logging - only if debug is enabled
			if (Settings.get("general.debugTitleDisplay")) {
				getTitleDebugger().then((logger) => logger.logDOMExtraction(this.#asin, "getTitle", this.#title));
			}
		}
		return this.#title;
	}

	getThumbnailURL() {
		if (this.#thumbnailUrl == null) {
			this.#thumbnailUrl = this.#getThumbnailURLFromDom(this.#tileDOM);
		}
		return this.#thumbnailUrl;
	}

	markAsDiscovered() {
		const container = this.#tileDOM.querySelector(".vh-img-container");

		const newCorner = document.createElement("div");
		newCorner.classList.add("vh-new-corner-discovered");
		//Add a span into the div
		const span = document.createElement("span");
		span.innerHTML = "FIRST<br>DISCOVERY";
		newCorner.appendChild(span);

		//Insert newCorner as the first child of the container
		container.insertBefore(newCorner, container.firstChild);

		if (Settings.get("general.discoveryFirst")) {
			logger.add("Tile: markAsDiscovered: discoveryFirst");
			//Move the highlighted item to the top of the grid
			this.getGrid().getDOM().insertBefore(this.getDOM(), this.getGrid().getDOM().firstChild);
		}

		//Confetti animation
		//Wait 1 seconds for the item to take their final position
		setTimeout(() => {
			this.explodeConfettiFromDiv(this.getDOM());
		}, 1000);
	}

	explodeConfettiFromDiv(div) {
		if (!div) return;

		const rect = div.getBoundingClientRect();

		if (rect.top == 0 && rect.left == 0) {
			return; //div not visible.
		}

		// Create confetti from three sides
		const positions = [
			// Left side
			{ x: rect.left / window.innerWidth, y: rect.top / window.innerHeight },
			{ x: rect.left / window.innerWidth, y: (rect.top + rect.height / 2) / window.innerHeight },
			{ x: rect.left / window.innerWidth, y: rect.bottom / window.innerHeight },
			// Top side
			{ x: (rect.left + rect.width / 4) / window.innerWidth, y: rect.top / window.innerHeight },
			{ x: (rect.left + rect.width / 2) / window.innerWidth, y: rect.top / window.innerHeight },
			{ x: (rect.left + (rect.width * 3) / 4) / window.innerWidth, y: rect.top / window.innerHeight },
			// Right side
			{ x: rect.right / window.innerWidth, y: rect.top / window.innerHeight },
			{ x: rect.right / window.innerWidth, y: (rect.top + rect.height / 2) / window.innerHeight },
			{ x: rect.right / window.innerWidth, y: rect.bottom / window.innerHeight },
		];

		positions.forEach((pos) => {
			confetti({
				particleCount: 15, // Reduced particle count per origin point
				spread: 45,
				startVelocity: 15, // Reduced velocity for shorter distance
				decay: 0.9, // Faster decay
				gravity: 0.8, // Reduced gravity
				ticks: 100, // Controls animation duration (~500ms)
				origin: pos,
				colors: ["#ff0", "#ff4500", "#ff1493", "#00ffff", "#00ff00"],
				scalar: 0.8, // Smaller particles
				drift: 0, // No sideways drift
				disableForReducedMotion: true,
			});
		});
	}

	setDateAdded(timenow, mysqlDate) {
		if (mysqlDate == undefined || !Settings.get("general.displayFirstSeen")) {
			return false;
		}

		let serverCurrentDate = YMDHiStoISODate(timenow);
		let itemDateAdded = YMDHiStoISODate(mysqlDate);
		let bookmarkDate = new Date(Settings.get("general.bookmarkDate"));
		if (isNaN(serverCurrentDate.getTime()) || isNaN(itemDateAdded.getTime())) {
			logger.add(
				"! Time firstseen wrong: serverCurrentDate:" +
					serverCurrentDate +
					" itemDateAdded:" +
					itemDateAdded +
					"preformated current time: " +
					timenow +
					"preformatted item time" +
					mysqlDate
			);
			return;
		}
		//Add the data-date attribute to the tile
		// Convert to local time and store in dataset
		this.#tileDOM.dataset.date = new Date(itemDateAdded).toLocaleString();

		let textDate = this.#timeSince(serverCurrentDate, itemDateAdded);
		const dateAddedMessage = `${textDate} ago`;

		let dateAddedDiv = document.createElement("div");
		dateAddedDiv.classList.add("vh-date-added"); // Add the class
		dateAddedDiv.textContent = dateAddedMessage;

		// Find the container and append the new div
		const container = this.#tileDOM.querySelector(".vh-img-container");
		if (container) {
			container.appendChild(dateAddedDiv);
		} else {
			logger.add(`TILE: Cannot add date - .vh-img-container not found for ASIN: ${this.#asin}`);
		}

		//Highlight the tile background if the bookmark date is in the past
		if (
			Settings.get("general.bookmark") &&
			itemDateAdded > bookmarkDate &&
			Settings.get("general.bookmarkDate") != 0
		) {
			logger.add("TILE: The item is more recent than the time marker, highlight its toolbar.");
			const statusContainer = this.#tileDOM.querySelector(".vh-status-container");
			if (statusContainer) {
				statusContainer.style.backgroundColor = Settings.get("general.bookmarkColor");
			}
			this.#tileDOM.classList.add("vh-new-item-highlight");
		}
	}

	async initiateTile() {
		// Check if blur should be applied based on pre-computed blur keyword match
		// The blur keyword matching is done in NewItemStreamProcessing.js
		// dataset.blurkw contains the actual blur keyword if matched, or empty/undefined if not
		const shouldBlur = this.#tileDOM.dataset.blurkw && this.#tileDOM.dataset.blurkw !== "false";

		// Debug logging for blur keyword application
		if (Settings.get("general.debugKeywords")) {
			console.log("[Tile.initiateTile] Applying blur based on pre-computed match", {
				asin: this.getAsin(),
				title: this.getTitle(),
				shouldBlur: shouldBlur,
				dataBlurKw: this.#tileDOM.dataset.blurkw,
			});
		}

		if (Settings.isPremiumUser() && shouldBlur) {
			// Get the blur keyword from the DOM data (set during stream processing)
			const blurKeyword = this.#tileDOM.dataset.blurkw || "blur keyword";

			logger.add("TILE: The item matches blur keyword, applying blur");
			const img = this.#tileDOM.querySelector("img");
			if (img) {
				if (Settings.get("general.unblurImageOnHover")) {
					img.classList.add("dynamic-blur");
				} else {
					img.classList.add("blur");
				}
			}
			this.#tileDOM.querySelector(".vvp-item-product-title-container")?.classList.add("dynamic-blur");
			this.#tileDOM.dataset.blurredKeyword = escapeHTML(blurKeyword);
		} else {
			this.#tileDOM.dataset.blurredKeyword = "";
		}

		//Unescape titles and ensure they remain visible
		const truncateFull = this.getDOM().querySelector(".a-truncate-full");
		const truncateCut = this.getDOM().querySelector(".a-truncate-cut");

		// Log initial tile creation - only if debug is enabled
		if (Settings.get("general.debugTitleDisplay")) {
			getTitleDebugger().then((logger) =>
				logger.logTileCreation(
					this.#asin,
					truncateFull || truncateCut,
					truncateFull?.innerText || truncateCut?.innerText
				)
			);
		}

		// Get the title text - try multiple sources
		let titleText = truncateFull?.innerText || truncateCut?.innerText;

		// If both are empty, try to get from the link's data-tooltip
		if (!titleText) {
			const linkElement = this.getDOM().querySelector(".a-link-normal");
			titleText = linkElement?.getAttribute("data-tooltip") || "";
			if (Settings.get("general.debugTitleDisplay")) {
				getTitleDebugger().then((logger) =>
					logger.logDOMExtraction(this.#asin, "data-tooltip fallback", titleText)
				);
			}
		}

		// If still empty, get from the tile's stored title
		if (!titleText) {
			titleText = this.getTitle();
			if (Settings.get("general.debugTitleDisplay")) {
				getTitleDebugger().then((logger) =>
					logger.logDOMExtraction(this.#asin, "getTitle fallback", titleText)
				);
			}
		}

		// Apply unescaped text to both spans
		if (titleText) {
			const unescapedText = unescapeHTML(unescapeHTML(titleText));

			// Set text content for both spans
			if (truncateFull) {
				truncateFull.innerText = unescapedText;
				// Ensure it stays visible by removing a-offscreen if Amazon adds it
				truncateFull.classList.remove("a-offscreen");
				if (Settings.get("general.debugTitleDisplay")) {
					getTitleDebugger().then((logger) =>
						logger.log(this.#asin, "TITLE_SET", {
							element: "truncateFull",
							text: unescapedText.substring(0, 100),
							length: unescapedText.length,
						})
					);
				}
			}
			if (truncateCut) {
				truncateCut.innerText = unescapedText;
				// Ensure it's visible
				truncateCut.style.visibility = "visible";
				truncateCut.style.display = "";
				if (Settings.get("general.debugTitleDisplay")) {
					getTitleDebugger().then((logger) =>
						logger.log(this.#asin, "TITLE_SET", {
							element: "truncateCut",
							text: unescapedText.substring(0, 100),
							length: unescapedText.length,
						})
					);
				}
			}

			//Move the banners inside the image container, at the end of it (after the carousel if it exists)
			const imgContainer = this.#tileDOM.querySelector(".vh-img-container");
			const banners = this.#tileDOM.querySelector(".vvp-item-badges");
			if (banners) {
				imgContainer.appendChild(banners);
			}

			// Only apply title restoration on Amazon pages where the issue occurs
			//(is this a made up problem?)
			// Skip on Notification Monitor where titles display correctly
			const isNotificationMonitor = window.location.href.includes("#monitor");
			const isAmazonVinePage = window.location.href.includes("/vine/vine-items") && !isNotificationMonitor;

			if (isAmazonVinePage) {
				// Store the original title for restoration
				this.#tileDOM.dataset.vhOriginalTitle = unescapedText;

				// Use a simpler periodic check instead of MutationObserver
				// This avoids memory leaks and is much simpler
				if (!Tile.titleRestorationInterval) {
					Tile.titleRestorationInterval = setInterval(() => {
						// Check all tiles with stored titles
						const tilesWithStoredTitles = document.querySelectorAll(
							".vvp-item-tile[data-vh-original-title]"
						);

						tilesWithStoredTitles.forEach((tileElement) => {
							const storedTitle = tileElement.dataset.vhOriginalTitle;
							if (storedTitle) {
								// Check both title elements
								const truncateFull = tileElement.querySelector(".a-truncate-full");
								const truncateCut = tileElement.querySelector(".a-truncate-cut");

								// Restore if text was cleared
								if (truncateFull && !truncateFull.innerText) {
									truncateFull.innerText = storedTitle;
									truncateFull.classList.remove("a-offscreen");

									if (Settings.get("general.debugTitleDisplay")) {
										console.log(
											`🔄 [TitleFix] Restored title for ASIN: ${tileElement.dataset.asin}`
										);
									}
								}

								if (truncateCut && !truncateCut.innerText) {
									truncateCut.innerText = storedTitle;
									truncateCut.style.visibility = "visible";
									truncateCut.style.display = "";

									if (Settings.get("general.debugTitleDisplay")) {
										console.log(
											`🔄 [TitleFix] Restored title for ASIN: ${tileElement.dataset.asin}`
										);
									}
								}
							}
						});
					}, 2000); // Check every 2 seconds

					if (Settings.get("general.debugTitleDisplay")) {
						console.log("🔄 [TitleFix] Started periodic title restoration");
					}
				}
			}
		}
		//Assign the ASIN to the tile content
		if (this.#asin) {
			this.getDOM().closest(".vvp-item-tile").dataset.asin = this.#asin;
		}
	}

	async #initCarousel(additionalImages) {
		if (!Settings.isPremiumUser(3)) {
			return;
		}

		if (additionalImages.length <= 1) {
			return;
		}

		//Find the img of the tile
		const img = this.#tileDOM.querySelector("img");

		//Detach the image from is container
		img.parentNode.removeChild(img);

		//Delete any pre-existing carousel
		const existingCarousel = this.#tileDOM.querySelector("#thumbnail-carousel-" + this.#asin);
		if (existingCarousel) {
			existingCarousel.remove();
		}

		//Find the image container
		const imgContainer = this.#tileDOM.querySelector(".vh-img-container");

		//Create the carousel
		const carousel = document.createElement("section");
		carousel.id = "thumbnail-carousel-" + this.#asin;
		carousel.classList.add("splide");
		carousel.setAttribute("aria-label", "Carousel of thumbnails.");

		const track = document.createElement("div");
		track.classList.add("splide__track");
		carousel.appendChild(track);

		const list = document.createElement("ul");
		list.classList.add("splide__list");
		track.appendChild(list);

		const slide1 = document.createElement("li");
		slide1.classList.add("splide__slide");
		list.appendChild(slide1);

		slide1.appendChild(img);

		//Add the additional images
		for (let i = 1; i < additionalImages.length; i++) {
			const slide = document.createElement("li");
			slide.classList.add("splide__slide");
			list.appendChild(slide);

			const img = document.createElement("img");
			img.src = additionalImages[i];
			img.alt = "thumbnail " + i;
			slide.appendChild(img);
		}

		//Attach the carousel to the image container
		imgContainer.insertBefore(carousel, imgContainer.firstChild);

		//Initialize the carousel
		new Splide("#thumbnail-carousel-" + this.#asin, {
			gap: 1,
			rewind: true,
			pagination: false,
		}).mount();
	}

	setAdditionalImages(images) {
		if (!Settings.isPremiumUser(3) || !Settings.get("general.carousel.active")) {
			return false;
		}
		this.#initCarousel(images);
	}

	colorizeHighlight() {
		const zeroETV = this.#tileDOM.dataset.typeZeroETV === "1" && Settings.get("general.zeroETVHighlight.active");
		const highlight = this.#tileDOM.dataset.typeHighlight === "1" && Settings.get("general.highlightColor.active");
		const unknownETV =
			this.#tileDOM.dataset.typeUnknownETV === "1" && Settings.get("general.unknownETVHighlight.active");

		// Debug logging
		if (Settings.get("general.debugKeywords")) {
			console.log("[Tile] colorizeHighlight called:", {
				asin: this.#asin,
				typeHighlight: this.#tileDOM.dataset.typeHighlight,
				typeZeroETV: this.#tileDOM.dataset.typeZeroETV,
				typeUnknownETV: this.#tileDOM.dataset.typeUnknownETV,
				highlightColorActive: Settings.get("general.highlightColor.active"),
				zeroETVHighlightActive: Settings.get("general.zeroETVHighlight.active"),
				unknownETVHighlightActive: Settings.get("general.unknownETVHighlight.active"),
				willHighlight: highlight,
				willHighlightZeroETV: zeroETV,
				willHighlightUnknownETV: unknownETV,
			});
		}

		// Use StyleUtils to handle background styling
		if (zeroETV && highlight && !Settings.get("general.highlightColor.ignore0ETVhighlight")) {
			const color1 = Settings.get("general.zeroETVHighlight.color");
			const color2 = Settings.get("general.highlightColor.color");
			const gradient = StyleUtils.createStripedGradient(color1, color2);
			StyleUtils.applyBackground(this.#tileDOM, gradient, true);
		} else if (unknownETV && highlight && !Settings.get("general.highlightColor.ignoreUnknownETVhighlight")) {
			const color1 = Settings.get("general.unknownETVHighlight.color");
			const color2 = Settings.get("general.highlightColor.color");
			const gradient = StyleUtils.createStripedGradient(color1, color2);
			StyleUtils.applyBackground(this.#tileDOM, gradient, true);
		} else if (highlight) {
			StyleUtils.applyBackground(this.#tileDOM, Settings.get("general.highlightColor.color"), false);
		} else if (zeroETV) {
			StyleUtils.applyBackground(this.#tileDOM, Settings.get("general.zeroETVHighlight.color"), false);
		} else if (unknownETV) {
			StyleUtils.applyBackground(this.#tileDOM, Settings.get("general.unknownETVHighlight.color"), false);
		} else {
			// Clear any existing styling
			StyleUtils.clearBackgrounds(this.#tileDOM);
		}
	}

	async moveToGrid(g, animate = false) {
		if (g === null) {
			return false;
		}

		//If we are asking to move the tile to the same grid, don't do anything
		if (g.getId() == this.#grid.getId()) return false;

		if (animate) {
			await this.#grid.removeTileAnimate(this);
		} else {
			await this.#grid.removeTile(this); //Avoiding the await keep the method synchronous
		}

		this.#grid = g; //Update the new grid as the current one
		await this.#grid.addTile(this);

		return true;
	}

	async setLocalTileVisibility() {
		this.#hidden = await HiddenList.isHidden(this.#asin);
	}

	async isHidden() {
		if (!Settings.get("hiddenTab.active") || !this.#asin) {
			return false;
		}

		return this.#hidden;
	}

	async hideTile(animate = true, updateLocalStorage = true, skipHiddenListMgr = false) {
		this.#hidden = true;

		//Add the item to the list of hidden items
		if (!this.#asin) {
			logger.add("WARNING: Cannot hide tile without ASIN");
			return;
		}

		if (!skipHiddenListMgr) {
			HiddenList.addItem(this.#asin, updateLocalStorage);
		}

		//Move the tile
		await this.moveToGrid(Page.instance.getGrid("tab-hidden"), animate);

		if (this.#toolbar) {
			this.#toolbar.updateVisibilityIcon();
		}

		//Refresh grid counts
		this.getGrid().getPage().updateTileCounts();
	}

	async showTile(animate = true, updateLocalStorage = true) {
		this.#hidden = false;

		//Remove the item from the array of hidden items
		if (!this.#asin) {
			logger.add("WARNING: Cannot show tile without ASIN");
			return;
		}

		HiddenList.removeItem(this.#asin, updateLocalStorage);

		//Move the tile
		await this.moveToGrid(Page.instance.getGrid("vvp-items-grid"), animate);

		if (this.#toolbar) {
			this.#toolbar.updateVisibilityIcon();
		}

		//Refresh grid counts
		this.getGrid().getPage().updateTileCounts();
	}

	#timeSince(timenow, date) {
		const units = [
			{ value: 31536000, unit: "year" },
			{ value: 2592000, unit: "month" },
			{ value: 86400, unit: "day" },
			{ value: 3600, unit: "hr" },
			{ value: 60, unit: "min" },
			{ value: 1, unit: "sec" },
		];

		var seconds = Math.floor((timenow - date) / 1000);
		for (const { value, unit } of units) {
			const interval = seconds / value;
			if (interval >= 1) {
				const plural = Math.floor(interval) > 1 ? "s" : "";
				return Math.floor(interval) + ` ${unit}${plural}`;
			}
		}
		return `${Math.floor(seconds)} secs`;
	}

	// Function to animate opacity
	#animateOpacity(element, targetOpacity, duration) {
		return new Promise((resolve) => {
			const startOpacity = parseFloat(getComputedStyle(element).opacity);
			const opacityChange = targetOpacity - startOpacity;
			const startTime = performance.now();

			function animate(time) {
				const elapsed = time - startTime;
				const progress = Math.min(elapsed / duration, 1);
				element.style.opacity = startOpacity + opacityChange * progress;

				if (progress < 1) {
					requestAnimationFrame(animate);
				} else {
					element.style.display = "none"; // Optionally hide the element
					resolve();
				}
			}

			requestAnimationFrame(animate);
		});
	}

	/**
	 * Clean up all event listeners before removing the tile
	 */
	destroy() {
		// CRITICAL FIX: Clear the stored title from dataset to prevent memory leaks
		if (this.#tileDOM && this.#tileDOM.dataset) {
			delete this.#tileDOM.dataset.vhOriginalTitle;
		}

		// CRITICAL FIX: Clear any direct references on the tile DOM
		if (this.#tileDOM) {
			this.#tileDOM.vhTileInstance = null;
		}

		// Mark the tile as cleaned up in MemoryDebugger
		if (window.MEMORY_DEBUGGER) {
			window.MEMORY_DEBUGGER.markElementRemoved(this.#tileDOM);
		}

		// CRITICAL FIX: Clear the DOM reference to help garbage collection
		this.#tileDOM = null;

		// CRITICAL FIX: Check if shared observer should be cleaned up
		if (Tile.titleRestorationInterval) {
			// Check if there are any tiles left in the document that might need the observer
			const remainingTiles = document.querySelectorAll(".vvp-item-tile[data-vh-original-title]");
			if (remainingTiles.length === 0) {
				console.log("🧹 [TitleFix] No tiles with stored titles remain, cleaning up interval");
				clearInterval(Tile.titleRestorationInterval);
				Tile.titleRestorationInterval = null;
			}
		}
	}
	#getTitleFromDom(tileDom) {
		let textElement = tileDom.querySelector(".a-truncate-full");
		const title = textElement ? textElement.textContent : "";

		// Debug logging
		const settings = new SettingsMgr();
		const asinElement = tileDom.querySelector("[data-asin]");
		const asin = asinElement ? asinElement.dataset.asin : "unknown";

		if (settings.get("general.debugKeywords")) {
			console.log("[getTitleFromDom] Extracting title:", {
				asin: asin,
				title: title.substring(0, 100) + (title.length > 100 ? "..." : ""),
				textElement: textElement,
				tileDom: tileDom,
			});
		}

		// Title debug logging - only if debug is enabled
		if (asin !== "unknown" && settings.get("general.debugTitleDisplay")) {
			getTitleDebugger().then((logger) => logger.logDOMExtraction(asin, "getTitleFromDom", title));
		}

		return title;
	}
	#getThumbnailURLFromDom(tileDom) {
		//Preload.
		let imgElement = tileDom.querySelector(".vvp-item-tile-content > img");
		let url = imgElement ? imgElement.getAttribute("src") : null;

		if (url == undefined) {
			//Post load of VH added an image container.
			imgElement = tileDom.querySelector(".vh-img-container > img");
			url = imgElement ? imgElement.getAttribute("src") : null;
		}

		return url == undefined ? null : url;
	}
	static getASINFromDom(tileDom) {
		const seeDetailsBtn = tileDom.querySelector("input[type='submit']");
		let asin = null;
		if (seeDetailsBtn) {
			asin = seeDetailsBtn.getAttribute("data-asin");
			if (asin) {
				//logger.add("TILE: Extracted ASIN from See details button: " + asin);
				return asin;
			} else {
				// Fallback: Try to extract ASIN from data-recommendation-id attribute
				// Format: "ATVPDKIKX0DER#B0DWXBZW8K#vine.enrollment...."
				const recommendationId = tileDom.getAttribute("data-recommendation-id");
				if (recommendationId) {
					const parts = recommendationId.split("#");
					if (parts.length >= 2 && parts[1]) {
						// The ASIN is the second part
						//logger.add("TILE: Extracted ASIN from data-recommendation-id: " + parts[1]);
						return parts[1];
					}
				}
			}
		}

		//Extract the ASIN from the URL
		const url = tileDom.querySelector("a.a-link-normal")?.href;
		if (url) {
			const regex = /\/dp\/([A-Z0-9]{10})/;
			asin = url.match(regex)[1];
			if (asin) {
				//logger.add("TILE: Extracted ASIN from URL: " + asin);
				return asin;
			}
		}

		// If all methods fail, log a warning and return null instead of throwing
		logger.add(
			"TILE: WARNING - Could not extract ASIN from tile. Tile HTML: " + tileDom.outerHTML.substring(0, 200)
		);
		console.warn("VineHelper: Could not extract ASIN from tile", tileDom);
		return null;
	}

	static getTileFromDom(tileDom) {
		const asin = Tile.getASINFromDom(tileDom);
		if (!asin) {
			logger.add("TILE: WARNING - getTileFromDom called with tile that has no ASIN");
			return null;
		}
		return Page.instance.getTileByASIN(asin);
	}
}

export { Tile };
