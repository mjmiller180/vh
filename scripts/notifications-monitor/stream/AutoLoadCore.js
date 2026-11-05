/*global chrome*/

import { isPageLogin, isPageCaptcha, isPageDog } from "/scripts/core/utils/DOMHelper.js";
import { Item } from "/scripts/core/models/Item.js";

class AutoLoadCore {
	_monitor = null;

	constructor(monitor) {
		if (this.constructor === AutoLoadCore) {
			throw new Error("Cannot instantiate abstract class AutoLoadCore directly");
		}
		this._monitor = monitor;
	}

	/**
	 * Get the next execution time from the autoload timer
	 * @returns {Date|null} The next execution time, or null if not set
	 */
	#getNextExecuteTime() {
		// Check if this instance has getNextExecuteTime directly (AutoLoad instance)
		// or if we need to access it via _monitor._autoLoad (AutoLoadCore instance)
		if (typeof this.getNextExecuteTime === "function") {
			// We're in AutoLoad instance, call directly
			return this.getNextExecuteTime();
		} else if (
			this._monitor &&
			this._monitor._autoLoad &&
			typeof this._monitor._autoLoad.getNextExecuteTime === "function"
		) {
			// We're in AutoLoadCore, access via monitor
			return this._monitor._autoLoad.getNextExecuteTime();
		}
		return null;
	}

	/**
	 * Format the next execution time as a time string
	 * @param {Date|null} nextExecuteTime - The next execution time
	 * @returns {string} Formatted time string or "(tba)" if no time is set
	 */
	#formatNextLoadText(nextExecuteTime) {
		if (!nextExecuteTime) {
			return "(tba)";
		}
		const nextHours = String(nextExecuteTime.getHours()).padStart(2, "0");
		const nextMinutes = String(nextExecuteTime.getMinutes()).padStart(2, "0");
		const nextSeconds = String(nextExecuteTime.getSeconds()).padStart(2, "0");
		return `~${nextHours}:${nextMinutes}:${nextSeconds}`;
	}

	/**
	 * Update the next assisted load date element in the DOM
	 * @param {string} nextLoadText - The text to set
	 */
	async #updateNextLoadElement(nextLoadText) {
		// Wait for element to appear if it doesn't exist yet
		while (!document.getElementById("date_next_assisted_load")) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		const nextLoadElement = document.getElementById("date_next_assisted_load");
		if (nextLoadElement) {
			nextLoadElement.innerText = nextLoadText;
		}
	}

	/**
	 * Broadcast assisted load dates to all monitors (master and slaves)
	 * @param {string} lastLoadText - The last load text (or "(tba)" if not updating)
	 * @param {string} nextLoadText - The next load text
	 */
	async #broadcastAssistedLoadDates(lastLoadText, nextLoadText) {
		if (this._monitor && this._monitor._channel) {
			this._monitor._channel.postMessage(
				await this._monitor._cryptoKeys.encryptJSON({
					type: "updateAssistedLoadDates",
					lastLoadText: lastLoadText,
					nextLoadText: nextLoadText,
				})
			);
		}
	}

	/**
	 * Update the "Next assisted load" date in the notification monitor header
	 * Broadcasts the update to all monitors (master and slaves)
	 * This is called when the timer is set/reset, not necessarily when a page is loaded
	 */
	async #updateNextAssistedLoadDate() {
		const nextExecuteTime = this.#getNextExecuteTime();
		const nextLoadText = this.#formatNextLoadText(nextExecuteTime);

		// Update the DOM element
		await this.#updateNextLoadElement(nextLoadText);

		// Broadcast the update to all monitors (master and slaves)
		// Use updateAssistedLoadDates with lastLoadText as "(tba)" since we're only updating next
		await this.#broadcastAssistedLoadDates("(tba)", nextLoadText);
	}

	/**
	 * Update the "Last assisted load" and "Next assisted load" dates in the notification monitor header
	 * Broadcasts the update to all monitors (master and slaves)
	 * @param {string} queue - The queue name (AI, RFY, AFA, ALL)
	 * @param {number} page - The page number
	 */
	async #updateLastAssistedLoadDate(queue, page) {
		// Format current time as HH:MM:SS
		const now = new Date();
		const hours = String(now.getHours()).padStart(2, "0");
		const minutes = String(now.getMinutes()).padStart(2, "0");
		const seconds = String(now.getSeconds()).padStart(2, "0");
		const timeStr = `${hours}:${minutes}:${seconds}`;

		// Format last load text as "12:34:32; AI (p. 8)"
		const lastLoadText = `${timeStr}; ${queue} (p. ${page})`;

		// Get next execution time and format it
		const nextExecuteTime = this.#getNextExecuteTime();
		const nextLoadText = this.#formatNextLoadText(nextExecuteTime);

		// Broadcast the update to all monitors (master and slaves)
		await this.#broadcastAssistedLoadDates(lastLoadText, nextLoadText);

		// Also update locally
		const lastLoadElement = document.getElementById("date_last_assisted_load");
		if (lastLoadElement) {
			lastLoadElement.innerText = lastLoadText;
		}

		// Update next load element (don't wait for it, element should exist by now)
		const nextLoadElement = document.getElementById("date_next_assisted_load");
		if (nextLoadElement) {
			nextLoadElement.innerText = nextLoadText;
		}
	}

	/**
	 * Public method to update the next assisted load date
	 * Called when the timer is set/reset, not necessarily when a page is loaded
	 */
	async updateNextAssistedLoadDate() {
		await this.#updateNextAssistedLoadDate();
	}

	async fetchAutoLoadUrl(url, queue, page, DOMCallback = null, VHCallback = null) {
		// Check if notification.active is enabled
		if (!this._monitor._settings.get("notification.active")) {
			return;
		}

		if (this._monitor._settings.get("general.debugServercom")) {
			console.log(`${new Date().toLocaleString()} - Reloading page: ${queue} page ${page}`);
		}

		//Fetch the url
		const userAgent = navigator.userAgent;
		const acceptLanguage = navigator.language || navigator.languages?.join(",") || "en-US,en;q=0.9";
		const headers = {
			"User-Agent": userAgent,
			Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
			"Accept-Language": acceptLanguage,
			"Accept-Encoding": "gzip, deflate, br",
			"Cache-Control": "no-cache",
			Pragma: "no-cache",
			"Sec-Fetch-Dest": "document",
			"Sec-Fetch-Mode": "navigate",
			"Sec-Fetch-Site": "none",
			"Sec-Fetch-User": "?1",
			"Upgrade-Insecure-Requests": "1",
		};
		const response = await fetch(url, { headers: headers });
		const html = await response.text();

		//Parse the HTML
		const parser = new DOMParser();
		const doc = parser.parseFromString(html, "text/html");

		//check if the page is a dogpage
		if (isPageDog(doc)) {
			throw new Error("dog_page");
		}

		//Check if the page is a captchapage
		if (isPageCaptcha(doc)) {
			throw new Error("captcha_page");
		}

		//Check if the page is a loginpage
		if (isPageLogin(doc)) {
			throw new Error("login_page");
		}

		// Update the last assisted load timestamp
		await this.#updateLastAssistedLoadDate(queue, page);

		//Get all the tiles
		const tiles = doc.querySelectorAll("#vvp-items-grid .vvp-item-tile");
		const items = []; //Array of items to be sent to the server
		for (const tile of tiles) {
			const input = tile.querySelector("input");
			const recommendationId = input.dataset.recommendationId;
			//Match the string following vine.enrollment.
			const enrollment_guid = Item.getEnrollmentGuidFromRecommendationId(recommendationId);
			const asin = input.dataset.asin;
			const title = tile.querySelector(".a-truncate-full").textContent;
			const is_parent_asin = input.dataset.isParentAsin;
			const is_pre_release = input.dataset.isPreRelease;
			const thumbnail = tile.querySelector("img").src;
			const recommendationType = input.dataset.recommendationType;
			const queue = Item.getQueueFromData(recommendationType, recommendationId);
			items.push({
				asin: asin,
				title: title,
				thumbnail: thumbnail,
				is_parent_asin: is_parent_asin == "true",
				is_pre_release: is_pre_release == "true",
				enrollment_guid: enrollment_guid,
				queue: queue,
			});
		}
		if (DOMCallback) {
			DOMCallback.call(this, items);
		}

		//Forward the items to the server
		const arrQueue = { AI: "encore", RFY: "potluck", AFA: "last_chance", ALL: "all_items" };

		const content = {
			api_version: 5,
			app_version: this._monitor._env.data.appVersion,
			action: "get_info",
			country: this._monitor._i13nMgr.getCountryCode(),
			uuid: await this._monitor._settings.get("general.uuid", false),
			fid: await this._monitor._settings.get("general.fingerprint.id", false),
			cid: await this._monitor._env.getCID(),
			tier: this._monitor._tierMgr.getTier(),
			queue: arrQueue[queue] || null,
			items: items,
			request_variants: false,
			p: page,
		};
		content.s = await this._monitor._cryptoKeys.signData(content);
		content.pk = await this._monitor._cryptoKeys.getExportedPublicKey();
		const self = this; // Store this context for use in callbacks
		fetch(this._monitor._env.getAPIUrl(), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(content),
		})
			.then(async (response) => {
				if (response.ok && VHCallback) {
					const responseData = await response.json();
					VHCallback.call(self, responseData["products"]);
				}
				//Log the number of items sent to the server
				if (self._monitor._settings.get("general.debugServercom")) {
					console.log(
						`${new Date().toLocaleString()} - ${items.length} items from ${queue}:${page} sent to the server.`
					);
				}
			})
			.catch((error) => {
				console.error(`[AutoLoadCore] Fetch failed:`, error);
			});
	}
}

export { AutoLoadCore };
