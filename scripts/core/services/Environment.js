// Last compiled at 2026-11-04_2317
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
import { Logger } from "/scripts/core/utils/Logger.js";
var logger = new Logger();

import { Internationalization } from "/scripts/core/services/Internationalization.js";
var i13n = new Internationalization();

import { SettingsMgr } from "/scripts/core/services/SettingsMgrCompat.js";
var Settings = new SettingsMgr();


import { CryptoKeys } from "/scripts/core/utils/CryptoKeys.js";
var cryptoKeys = new CryptoKeys();

import { isFirefox, isSafari } from "/scripts/core/utils/BrowserDetection.js";


/**
 * Environment file, used to load and store global variables
 */

class Environment {
	static #instance = null;

	data = {};
	loaded = false;

	#vvpContext = null;

	constructor() {
		if (Environment.#instance) {
			// Return the existing instance if it already exists
			return Environment.#instance;
		}
		// Initialize the instance if it doesn't exist
		Environment.#instance = this;

		logger.add("ENV: Initializing environment...");

		this.#init();
	}

	async #init() {
		this.#isUltraVinerRunning();
		this.#loadAppVersion();

		logger.add("ENV: Waiting for settings to load...");
		await Settings.waitForLoad();
		logger.add("ENV: Settings loaded.");

		await this.#loadCountryCode();
		await cryptoKeys.waitForLoad();

		//If the DOM is loaded, load the vvpContext
		while (!this.#isVVPContextLoaded()) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		logger.add("ENV: VVP context data available.");
		this.#readVVPContext();
		this.#loadBrowsingContext();
		this.loaded = true;
		logger.add("ENV: Loading vvp-context data completed.");
	}

	#isVVPContextLoaded() {
		return document.querySelector(`script[data-a-state='{"key":"vvp-context"}']`) !== null;
	}

	async waitForLoad() {
		while (!this.loaded) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		return true;
	}

	#isUltraVinerRunning() {
		let regex = /^.+?amazon\..+\/vine\/.*ultraviner.*?$/;
		this.data.ultraviner = regex.test(window.location.href);
	}
	#loadAppVersion() {
		let manifest = chrome.runtime.getManifest();
		this.data.appVersion = manifest.version;
	}

	async #loadCountryCode() {
		if (Settings.get("general.country", false) === null) {
			const code = i13n.getCountryCode();
			if (code) {
				await Settings.set("general.country", code);
			}
		}
	}

	#loadBrowsingContext() {
		//Try to obtain the queue from the vvpContext
		this.data.vineQueue = this.#readQueue(null);

		//If the queue was not obtained from the vvpContext, try to obtain it from the URL
		if (!this.data.vineQueue) {
			this.#readQueueFromURL("all_items");
		}

		//Determine if we are currently searching for an item
		let regex, arrMatches;
		const currentUrl = window.location.href;
		regex = /^.+?amazon\..+\/vine\/vine-items(?:.*?)(?:[?&]search=(.+?))(?:[#&].*?)?$/;
		arrMatches = currentUrl.match(regex);
		this.data.vineSearch = false;
		if (arrMatches != null) {
			if (arrMatches[1] == undefined) {
				this.data.vineSearch = false;
			} else {
				this.data.vineSearch = true;
				this.data.vineQueue = null;
			}
		}

		let arrQueues = { potluck: "RFY", last_chance: "AFA", encore: "AI", all_items: "ALL" };
		if (this.data.vineQueue != null) {
			this.data.vineQueueAbbr = arrQueues[this.data.vineQueue];
		}

		//Determine what page number we are on:
		regex = /&page=(\d+)?/;
		const match = currentUrl.match(regex);
		if (match) {
			this.data.vinePageNumber = match[1] ? parseInt(match[1]) : 1;
		} else {
			this.data.vinePageNumber = 1;
		}
	}

	getTierLevel(defaultStatus = "silver") {
		if (!this.data.tierLevel) {
			this.data.tierLevel = this.#readTierLevel();
		}
		return this.data.tierLevel ? this.data.tierLevel : defaultStatus;
	}

	#readTierLevel() {
		let status;
		try {
			if (!this.#vvpContext) {
				this.#readVVPContext();
			}
			status = this.#vvpContext?.voiceDetails.tierStatus == "TIER2" ? "gold" : "silver";
		} catch (err) {
			status = null;
		}
		return status;
	}

	#readVVPContext() {
		try {
			if (this.#vvpContext === null) {
				this.#vvpContext = JSON.parse(
					document.querySelector(`script[data-a-state='{"key":"vvp-context"}']`).innerHTML
				);
			}
			return this.#vvpContext;
		} catch (err) {
			return {};
		}
	}

	getMarketplaceId() {
		if (!this.#vvpContext) {
			this.#readVVPContext();
		}
		return this.#vvpContext?.marketplaceId;
	}

	getCustomerId() {
		if (!this.#vvpContext) {
			this.#readVVPContext();
		}
		return this.#vvpContext?.customerId;
	}

	getVoiceDetails(key) {
		if (!this.#vvpContext) {
			this.#readVVPContext();
		}
		return this.#vvpContext?.voiceDetails[key];
	}

	#readQueue(defaultQueue = null) {
		try {
			if (!this.#vvpContext) {
				this.#readVVPContext();
			}
			if (this.#vvpContext?.queueKey) {
				this.data.vineBrowsingListing = true;
			}
			return this.#vvpContext?.queueKey || defaultQueue;
		} catch (err) {
			return defaultQueue;
		}
	}

	#readQueueFromURL(defaultQueue = null) {
		//Determine if we are browsing a queue
		const currentUrl = window.location.href;
		let regex = /^.+?amazon\..+\/vine\/vine-items(?:\?(queue|search)=(.+?))?(?:[#&].*)?$/;
		let arrMatches = currentUrl.match(regex);
		if (arrMatches != null) {
			this.data.vineBrowsingListing = true;
			if (arrMatches[1] == "queue" && arrMatches[2] != undefined) {
				this.data.vineQueue = arrMatches[2];
			} else if (arrMatches[1] == undefined) {
				this.data.vineQueue = defaultQueue; //Default queue
			} else {
				this.data.vineQueue = defaultQueue; //Could be a ?search, (but not a &search).
			}
		}
	}

	getSilverTierLimit() {
		if (!this.data.silverTierLimit) {
			this.data.silverTierLimit = this.#readSilverTierLimit();
		}
		return this.data.silverTierLimit;
	}

	#readSilverTierLimit() {
		const rawText = document.querySelector("#vvp-vine-participation-content ul>li").innerText;
		const regex = new RegExp("^.+?[0-9]{1}.+?([0-9,.]+).+", "m");
		const match = rawText.match(regex);
		if (match) {
			return parseFloat(match[1]);
		}
	}

	isAmazonCheckoutEnabled() {
		try {
			if (!this.#vvpContext) {
				this.#readVVPContext();
			}
			return this.#vvpContext?.isCheckoutEnabled;
		} catch (err) {
			return false;
		}
	}

	isFirefox() {
		return isFirefox();
	}

	isSafari() {
		return isSafari();
	}

	isMobileView() {
		return document.querySelector("header#nav-main.nav-mobile") !== null;
	}
}

export { Environment };
