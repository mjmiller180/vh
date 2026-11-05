import { Logger } from "/scripts/core/utils/Logger.js";
var logger = new Logger();

import { SettingsMgr } from "/scripts/core/services/SettingsMgrCompat.js";
var Settings = new SettingsMgr();

import { Environment } from "/scripts/core/services/Environment.js";
var env = new Environment();

import { Internationalization } from "/scripts/core/services/Internationalization.js";
var i13n = new Internationalization();

import { CryptoKeys } from "/scripts/core/utils/CryptoKeys.js";
var cryptoKeys = new CryptoKeys();

import { Item } from "/scripts/core/models/Item.js";

import { ModalMgr } from "/scripts/ui/controllers/ModalMgr.js";
var modalMgr = new ModalMgr();

import { Template } from "/scripts/core/utils/Template.js";
var Tpl = new Template();

import { clickDynamicSeeDetailsButton, drawButton } from "/scripts/core/utils/DynamicModalHelper.js";

class VariantButton {
	#arrVariants = [];
	#tile;
	#eventListeners = [];

	/**
	 * Generate a new VariantButton instance.
	 * A VariantButton is attached to a Tile instance (parent) and contains a collection of Variant instances (children)
	 * @param {Tile} tileInstance
	 */
	constructor(tileInstance) {
		this.#tile = tileInstance;
		this.#arrVariants = [];
		this.#eventListeners = [];
	}

	/**
	 * Initialize the VariantButton by creating the DOM elements.
	 * This must be called after construction and awaited before adding variants.
	 */
	async initialize() {
		//Insert a span to contain both buttons
		const span = this.#tile.getDOM().querySelector(".vh-btn-container");
		const asin = this.#tile.getAsin();
		// Check if the container exists before trying to append
		if (!span) {
			logger.add(`TILE: Cannot add variant button - .vh-btn-container not found for ASIN: ${asin}`);
			return;
		}

		// Check if variant button already exists
		if (span.querySelector(".vh-btn-variants")) {
			// Variant button already exists, don't add another one
			return;
		}

		//Create the drop down button
		let prom = await Tpl.loadFile("scripts/ui/templates/btn_show_variants.html");
		let content = Tpl.render(prom, true);

		//Insert the content into the span
		span.appendChild(content);

		//Add data-recommendation-id to the buy now button
		const btnShowVariants = span.querySelector(".vh-btn-variants");
		if (!btnShowVariants) {
			logger.add(`TILE: Cannot find .vh-btn-variants button for ASIN: ${asin}`);
			return;
		}

		if (asin) {
			btnShowVariants.dataset.asin = asin;
		}

		//If using darktheme, invert the icon's color
		if (Settings.get("thorvarium.darktheme")) {
			const indicatorIcon = btnShowVariants.querySelector(".vh-indicator-icon");
			if (indicatorIcon) {
				indicatorIcon.style.filter = "invert(1)";
			}
		}

		//Add event listener to the buy now button
		const clickHandler = this.btnShowVariantsClick.bind(this);
		btnShowVariants.addEventListener("click", clickHandler);

		// Track this listener for cleanup
		this.#eventListeners.push({ element: btnShowVariants, event: "click", handler: clickHandler });

		// Log for memory debugging
		if (window.MEMORY_DEBUGGER && Settings.get("general.debugMemory")) {
			console.log(`🎯 Added variant button click listener for ASIN: ${asin}`);
		}
	}

	async addVariant(asin, title, etv) {
		//Check if the variant already exists
		if (this.#arrVariants.find((variant) => variant.asin === asin)) {
			return;
		}
		this.#arrVariants.push({ asin, title, etv });

		// Update the count after adding the variant
		this.#updateVariantCount();
	}

	#updateVariantCount() {
		const span = this.#tile.getDOM().querySelector(".vh-btn-variants-count");
		if (span) {
			span.textContent = this.#arrVariants.length;
		} else {
			logger.add(`VariantButton: Cannot find .vh-btn-variants-count element for ASIN: ${this.#tile.getAsin()}`);
		}
	}

	async btnShowVariantsClick(event) {
		event.preventDefault();
		event.stopPropagation(); // Prevent event from bubbling up to NotificationMonitor

		//Find the asin from the data-asin attribute
		const asin = this.#tile.getAsin();

		// ### Display a modal listing all the variants
		let m = modalMgr.newModal("item-variants-" + asin);
		m.title = "Variants for item #" + asin;
		m.style = "min-width: 600px;";
		m.content = `<img src="${this.#tile.getThumbnailURL()}" alt="Thumbnail" style="width: 100px; height: 100px;float: left;margin-right: 10px;margin-bottom: 10px;" />`;
		m.content += `<br />${this.#tile.getTitle()}<br /><br /><table class="vh-table-variants">`;
		m.content += `<tr><th>Variant info</th><th>ETV</th><th>Action</th></tr>`;
		//Sort the variants by title
		this.#arrVariants.sort((a, b) => a.title.localeCompare(b.title));
		for (let variant of this.#arrVariants) {
			m.content += `<tr id="vh-variant-${variant.asin}"><td>`;
			try {
				const json = JSON.parse(variant.title);
				for (let key in json) {
					m.content += `<strong>${key}:</strong> ${json[key]}<br />`;
				}
			} catch (e) {
				m.content += `(No info available)<br />`;
			}
			m.content += `</td><td width="50px" class="etv">${variant.etv === null ? "" : variant.etv}</td><td width="150px">`;
			m.content += `<a href="#" class="vh-link-variant" data-asin="${variant.asin}">View ${variant.asin}</a>`;
			m.content += `</td></tr>`;
		}
		m.content += `</table>`;
		await m.show();

		//Add event listener to the links
		const links = document.querySelectorAll(`#modal-item-variants-${asin} .vh-link-variant`);
		for (let link of links) {
			const clickHandler = (event) => {
				event.preventDefault();
				//Close the modal
				m.close();

				const variantAsin = link.dataset.asin;

				//Find the main See Details button
				const seeDetails = this.#tile
					.getDOM()
					.querySelector(".vvp-details-btn input, .vvp-details-btn-mobile input");
				if (!seeDetails) {
					throw new Error(
						"See Details button not found in this.#tile.getDOM():" + this.#tile.getDOM().outerHTML
					);
				}
				const recommendationType = seeDetails.dataset.recommendationType;
				const recommendationId = seeDetails.dataset.recommendationId;
				const enrollmentGuid = Item.getEnrollmentGuidFromRecommendationId(recommendationId);
				let queue;
				if (recommendationType == "SEARCH") {
					//Check if the data-recommendation-id has 2 or 3 #
					queue = Item.guessQueueFromRecommendationId(recommendationId);
				} else {
					const queueNames = {
						VINE_FOR_ALL: "encore",
						VENDOR_VINE_FOR_ALL: "last_chance",
						VENDOR_TARGETED: "potluck",
					};
					queue = queueNames[recommendationType];
				}

				//Generate a See Details button
				const item = new Item({
					asin: seeDetails.dataset.asin,
					queue: queue || "encore",
					is_parent_asin: false,
					enrollment_guid: enrollmentGuid,
					is_pre_release: seeDetails.dataset.isPreRelease,
				});

				drawButton(item, variantAsin);
				clickDynamicSeeDetailsButton(variantAsin);
			};
			link.addEventListener("click", clickHandler);

			// Track this listener for cleanup
			this.#eventListeners.push({ element: link, event: "click", handler: clickHandler });
		}

		// ### Get the unavailable status for the variant items
		const data = {
			api_version: 5,
			app_version: env.data.appVersion,
			action: "get_variants_info",
			country: i13n.getCountryCode(),
			uuid: Settings.get("general.uuid", false),
			fid: Settings.get("general.fingerprint.id", false),
			cid: await env.getCID(),
			parent_asin: asin,
		};
		const s = await cryptoKeys.signData(data);
		data.s = s;
		data.pk = await cryptoKeys.getExportedPublicKey();

		const options = {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(data),
		};
		fetch(env.getAPIUrl(), options)
			.then((response) => response.json())
			.then(async function (response) {
				for (let variant of response.items) {
					const row = document.querySelector(`#vh-variant-${variant.asin}`);
					if (row) {
						if (variant.unavailable == 1) {
							row.style.textDecoration = "line-through";
						}
						if (variant.etv) {
							const etv = row.querySelector(".etv");
							if (etv) {
								etv.textContent = variant.etv;
							}
						}
					}
				}
			});
	}

	destroy() {
		// Remove all tracked event listeners and observers
		for (const listener of this.#eventListeners) {
			if (listener.type === "observer") {
				// Disconnect MutationObserver
				listener.instance.disconnect();
			} else {
				// Remove regular event listener
				listener.element.removeEventListener(listener.event, listener.handler);
			}
		}

		// Clear the array
		this.#eventListeners = [];
	}
}

export { VariantButton };
