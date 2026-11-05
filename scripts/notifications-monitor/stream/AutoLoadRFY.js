/*global chrome*/

import { AutoLoadCore } from "./AutoLoadCore.js";

class AutoLoadRFY extends AutoLoadCore {
	static #instance = null;

	#RFYPageReloadTimer = null;
	#RFYPageReloadTimerRenew = false;
	#arrItems = {}; //Items in RFY
	#lastLoad = 0;

	constructor(monitor) {
		super(monitor);
		if (AutoLoadRFY.#instance) {
			return AutoLoadRFY.#instance;
		}
		AutoLoadRFY.#instance = this;
	}

	checkIfRFYPageNeedsReload() {
		if (
			!this._monitor._isMasterMonitor ||
			!this._monitor._settings.get("notification.active") ||
			!this._monitor._settings.get("notification.RFYReload.active")
		) {
			//console.log("RFY page reload not needed, not master monitor or notification.active is disabled");
			return;
		}
		//If the is no running timer, create a new one
		if (this.#RFYPageReloadTimer == null) {
			setTimeout(
				() => {
					this.#getRFY();
				},
				Math.floor(Math.random() * 30000)
			);

			this.#createRFYPageReloadTimer();
		} else {
			//A timer is already set, do nothing but mark it for renewal
			this.#RFYPageReloadTimerRenew = true;
		}
	}

	async #getRFY() {
		// Check if notification.active is enabled
		if (!this._monitor._settings.get("notification.active")) {
			return;
		}

		//Do not load the page if it was loaded less than 2 minutes ago
		if (Date.now() - this.#lastLoad < 1000 * 60 * 2) {
			return;
		}
		this.#lastLoad = Date.now();

		//Load RFY page
		try {
			const url = `https://www.amazon.${this._monitor._i13nMgr.getDomainTLD()}/vine/vine-items?queue=potluck&page=1`;
			await this.fetchAutoLoadUrl(
				url,
				"RFY",
				1,
				this.#syncRFYPageData.bind(this),
				this.#syncRFYServerData.bind(this)
			);
		} catch (error) {
			if (error.message == "dog_page") {
				this.#dogPageDetected();
			} else if (error.message == "captcha_page") {
				this.#captchaPageDetected();
			} else if (error.message == "login_page") {
				this.#loginPageDetected();
			}
		}
	}

	#dogPageDetected() {
		console.log(`${new Date().toLocaleString()} - Dog page detected.`);
		clearTimeout(this.#RFYPageReloadTimer);
		this.#resetReloadTimer(1000 * 60 * 60 * 24); //24 hours
	}

	//Check if the page is a captchapage
	#captchaPageDetected() {
		console.log(`${new Date().toLocaleString()} - Captcha page detected.`);
		clearTimeout(this.#RFYPageReloadTimer);
		this.#resetReloadTimer(1000 * 60 * 60); //1 hour
	}

	//Check if the page is a loginpage
	#loginPageDetected() {
		console.log(`${new Date().toLocaleString()} - Login page detected.`);
		clearTimeout(this.#RFYPageReloadTimer);
		this.#resetReloadTimer(1000 * 60 * 60); //1 hour
	}

	#createRFYPageReloadTimer() {
		//Random delay between 2 and 4 minutes
		const delay = Math.floor(Math.random() * (1000 * 60 * 4 - 1000 * 60 * 2 + 1) + 1000 * 60 * 2);
		this.#resetReloadTimer(delay);
		//console.log("RFY page reload needed, creating timer with delay of", delay, "ms");
	}

	#resetReloadTimer(delay) {
		this.#RFYPageReloadTimerRenew = false;
		this.#RFYPageReloadTimer = setTimeout(() => {
			clearTimeout(this.#RFYPageReloadTimer);
			this.#RFYPageReloadTimer = null;

			this.#getRFY();

			//If the timer was marked for renewal, create a new timer
			//This happen if an item is added while the timer is running
			if (this.#RFYPageReloadTimerRenew) {
				this.#createRFYPageReloadTimer();
				return;
			} else {
				//console.log("RFY page reload no longer needed.");
			}
		}, delay);
	}

	async #syncRFYPageData(items) {
		//Empty the array of items before adding the new items
		this.#arrItems = {};
		for (const item of items) {
			this.#arrItems[item.asin] = {
				asin: item.asin,
				title: item.title,
				thumbnail: item.thumbnail,
				is_parent_asin: item.is_parent_asin,
				is_pre_release: item.is_pre_release,
				enrollment_guid: item.enrollment_guid,
				queue: item.queue,
				price: item.price,
				additional_img: item.additional_img,
			};
		}
	}

	async #syncRFYServerData(items) {
		//Add the data from the server to the array of items
		for (const [key, values] of Object.entries(items)) {
			if (!this.#arrItems[key]) {
				console.warn(`Key ${key} not found in #arrItems, skipping`);
				continue;
			}
			this.#arrItems[key].etv_min = values.etv_min;
			this.#arrItems[key].etv_max = values.etv_max;
			this.#arrItems[key].date_added = values.date_added;
			this.#arrItems[key].discovered = values.discovered;
			this.#arrItems[key].hidden = values.hidden;
			this.#arrItems[key].variants = values.variants;
			this.#arrItems[key].order_success = values.order_success;
			this.#arrItems[key].order_failed = values.order_failed;
			this.#arrItems[key].order_unavailable = values.order_unavailable;
			this.#arrItems[key].price = values.price;
			this.#arrItems[key].additional_img = values.additional_img;
		}

		//Retreive the potluck items from local storage
		let potluckItems = await chrome.storage.local.get("potluckItems");

		if (!potluckItems || !potluckItems.potluckItems || Object.keys(potluckItems.potluckItems).length === 0) {
			potluckItems = {};
		} else {
			potluckItems = potluckItems.potluckItems;
		}

		//Delete the items from potluckItems which are not in the item array
		for (const asin of Object.keys(potluckItems)) {
			if (!this.#arrItems[asin]) {
				delete potluckItems[asin];
			}
		}

		for (const [asin, item] of Object.entries(this.#arrItems)) {
			//If the item did not exist in the potluckItems, broadcast it to the notification monitor
			if (!potluckItems[asin]) {
				potluckItems[asin] = item;

				//Build a data packet to be injected in serverCom as a new item
				const data = {
					type: "newPreprocessedItem",
					item: {
						asin: asin,
						reason: "new item in RFY (autoload)",
						etv_min: item.etv_min,
						etv_max: item.etv_max,
						tier: this._monitor._tierMgr.getTier(),
						queue: "potluck",
						title: item.title,
						timestamp: Date.now(),
						date: new Date().toISOString().slice(0, 19).replace("T", " "),
						date_added: item.date_added,
						img_url: item.thumbnail,
						is_parent_asin: item.is_parent_asin,
						is_pre_release: item.is_pre_release,
						enrollment_guid: item.enrollment_guid,
						variants: item.variants,
						price: item.price,
						addtitional_img: item.additional_img,
					},
				};

				//Send the item to the monitor.
				this._monitor._serverComMgr.processBroadcastMessage(data);
			}
		}

		//Save the potluckItems to local storage
		chrome.storage.local.set({ ["potluckItems"]: potluckItems });
	}
}

export { AutoLoadRFY };
