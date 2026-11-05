/*global chrome*/

import { NewItemStreamProcessing } from "/scripts/notifications-monitor/stream/NewItemStreamProcessing.js";
import { Item } from "/scripts/core/models/Item.js";
import { isSafari } from "/scripts/core/utils/BrowserDetection.js";

class ServerCom {
	static #instance = null;

	_monitor = null;
	#streamProcessor = null;

	#serviceWorkerStatusTimer = null;
	#statusTimer = null;
	#channelMessageHandler = null;
	#wsStatusTimer = null;
	fetch100 = false;
	#dataBuffer = [];
	#outOfContext = false; // Flag to indicate if the monitor is out of context, require a page refresh to reset.

	constructor(monitor) {
		this._monitor = monitor;

		if (ServerCom.#instance) {
			return ServerCom.#instance;
		}
		ServerCom.#instance = this;

		// Initialize the stream processor
		// It will create its own SettingsMgr instance via the singleton pattern
		this.#streamProcessor = new NewItemStreamProcessing(null, monitor);

		//Create a timer to check if the master monitor is still running
		this.#serviceWorkerStatusTimer = window.setInterval(() => {
			this.#updateMonitorMode();
			this.updateWebsocketStatus(false);
		}, 10000);

		this.#createEventListeners();

		// Bind the dataBuffering function to preserve this context
		this.#streamProcessor.setBroadcastFunction((data) => this.#dataBuffering(data));

		// .bind(this) is required here to preserve the correct 'this' context when #pushNotification
		// is called by the stream processor. Without bind, 'this' would refer to the stream processor
		// instance instead of the ServerCom instance, causing errors when accessing this._monitor
		// for settings and other ServerCom properties.
		this.#streamProcessor.setNotificationPushFunction(this.#pushNotification.bind(this));
	}

	/**
	 * Helper method to safely create and validate Item instances
	 * @param {Object} data - The data to create the Item from
	 * @param {string} context - Context for error logging
	 * @returns {Item|null} Valid Item instance or null if invalid
	 */
	#createValidatedItem(data, context) {
		if (!data) {
			console.error(`[ServerCom] ${context}: No data provided`);
			return null;
		}

		try {
			const item = new Item(data);
			return item;
		} catch (error) {
			// Item constructor already logs the specific error with data
			console.error(`[ServerCom] ${context}: ${error.message}`);
			return null;
		}
	}

	#createEventListeners() {
		this.#channelMessageHandler = async (event) => {
			// Check if event.data is already valid JSON
			let data;
			if (event.data && typeof event.data === "string") {
				try {
					data = await this._monitor._cryptoKeys.decryptToJSON(event.data);
				} catch (error) {
					console.error("Error decrypting message:", error);
					console.log("event is: ", event);
				}
			} else {
				data = event.data;
			}

			this.processBroadcastMessage(data);
		};

		//Capture message received from the monitor (For Safari)
		this._monitor._channel.addEventListener("message", this.#channelMessageHandler);

		//Capture messages received from service worker (For non-Safari, released code)
		chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
			this.processBroadcastMessage(message);
		});

		//Capture messages received from service worker (For non-Safari, github code)
		window.addEventListener("message", this.#channelMessageHandler);
	}

	/**
	 * Check the status of the master monitor and the WebSocket connection.
	 * Called once upon loading the monitor V2 or V3, and when the master monitor is promoted.
	 */
	updateWebsocketStatus(updateMonitorMode = true) {
		//Check the status of the master monitor.
		if (updateMonitorMode) {
			this.#updateMonitorMode();
		}

		//Obtain the status of the WebSocket connection.
		//Create a timer which will toggle the status of the WebSocket connection.
		if (this._monitor._isMasterMonitor) {
			this.#wsStatusTimer = window.setTimeout(() => {
				this.#setMasterMonitorStatus(false, "SW failed to respond, reload the page if the problem persists.");
			}, 2000);
			this._monitor._sendMessageToWebsocket({ type: "wsStatus" });
		}
	}

	#clearWsStatusTimer() {
		window.clearTimeout(this.#wsStatusTimer);
		this.#wsStatusTimer = null;
	}

	/**
	 * Process a message received from the Websocket.
	 * @param {Object} data
	 * @returns
	 */
	async processBroadcastMessage(data) {
		if (data.type == undefined) {
			return false;
		}

		if (data.type == "masterMonitorPong") {
			window.clearTimeout(this.#statusTimer);
			this.#statusTimer = null;
			this.#setMasterMonitorStatus(true, "Running as slave ...");
		}
		if (data.type == "newETV") {
			this._monitor.setETVFromASIN(data.item.asin, data.item.etv);
		}
		if (data.type == "newPrice") {
			this._monitor.setPriceFromASIN(data.item.asin, data.item.price);
			if (data.item.additional_img && Array.isArray(data.item.additional_img)) {
				this._monitor.setAdditionalImagesFromASIN(data.item.asin, data.item.additional_img);
			}
		}
		if (data.type == "newTier") {
			this._monitor.setTierFromASIN(data.item.asin, data.item.tier);
		}
		if (data.type == "wsStatus" && data.status == "wsOpen") {
			this.#clearWsStatusTimer();
			this.#setWebSocketStatus(true);
		}
		if (data.type == "wsStatus" && data.status == "wsError") {
			this.#clearWsStatusTimer();
			this.#setWebSocketStatus(false, data.error);
		}
		if (data.type == "wsStatus" && data.status == "wsClosed") {
			this.#clearWsStatusTimer();
			this.#setWebSocketStatus(false);
		}

		if (data.type == "unavailableItem") {
			this._monitor.markItemUnavailable(data.item.asin);
		}

		if (data.type == "outOfContext") {
			this.#outOfContext = true;
			this.#setMasterMonitorStatus(false, "Monitor out of context, reload the page.");
			this.#setWebSocketStatus(false, "Monitor out of context, reload the page.");
		}

		// Process the item as received from the websocket
		// Send the item to the stream processing, to come out to the #dataBuffering function,
		// which will pass them to the processBroadcastMessage as newItem, as the type is set by this function.
		if (data.type == "newPreprocessedItem") {
			if (this._monitor._settings.get("general.debugServercom")) {
				console.log("[ServerCom] newPreprocessedItem", data);
			}
			const item = this.#createValidatedItem(data.item, "newPreprocessedItem from WebSocket");
			if (item) {
				// Diagnostic logging for duplicate processing detection
				if (this._monitor._settings.get("general.debugDuplicates")) {
					const timestamp = Date.now();
					console.log("[ServerCom] Sending item to stream processor:", {
						asin: item.data?.asin,
						title: item.data?.title?.substring(0, 50) + "...",
						enrollment_guid: item.data?.enrollment_guid,
						source: "newPreprocessedItem",
						reason: data.item.reason || "no reason provided",
						timestamp,
						timestampMs: timestamp,
					});

					// Check if reason indicates enrollment_guid change
					if (data.item.reason && data.item.reason.includes("enrollment_guid")) {
						console.warn("[ServerCom] ENROLLMENT_GUID CHANGE DETECTED:", {
							asin: item.data?.asin,
							reason: data.item.reason,
							new_enrollment_guid: item.data?.enrollment_guid,
							timestamp: new Date().toISOString(),
						});
					}
				}

				this.#streamProcessor.input({
					index: 0,
					type: "newItem",
					domain: this._monitor._settings.get("general.country"),
					item: item,
					reason: data.item.reason,
				});
			}
		}

		// Received from #dataBuffering function, the data is the result of the output of the stream processing.
		if (data.type == "newItem") {
			if (this._monitor._settings.get("general.debugServercom")) {
				console.log("[ServerCom] newItem", data);
			}
			//The broadcastChannel will pass the item as an object, not an instance of Item.
			if (!(data.item instanceof Item)) {
				data.item = this.#createValidatedItem(
					data.item?.data,
					`newItem from BroadcastChannel (reason: ${data.reason || "unknown"})`
				);
				if (!data.item) return;
			}
			await this._monitor.addTileInGrid(data.item, data.reason);
		}

		if (data.type == "last100") {
			this.#processLast100Items(data.products);
		}
		if (data.type == "fetch100") {
			let itemIndex = 0;
			for (const itemData of JSON.parse(data.data)) {
				if (itemData.type == "newItem") {
					const item = this.#createValidatedItem(itemData.item?.data, `fetch100 batch item ${itemIndex}`);

					if (item) {
						await this._monitor.addTileInGrid(item, "Fetch latest");
					} else {
						console.error(
							`[ServerCom] fetch100: item is null at index ${itemIndex}, data: ${JSON.stringify(itemData)}`
						);
					}
					itemIndex++;
				} else if (itemData.type == "fetchRecentItemsEnd") {
					this._monitor.fetchRecentItemsEnd();
				}
			}
		}
		if (data.type == "newVariants") {
			this._monitor.addVariants(data.item);
		}
		if (data.type == "fetchAutoLoadUrl") {
			const queue = data.queue;
			const page = data.page;
			const queueTable = { AI: "encore", AFA: "last_chance", RFY: "potluck", ALL: "all_items" };
			const url = `https://www.amazon.${this._monitor._i13nMgr.getDomainTLD()}/vine/vine-items?queue=${queueTable[queue]}&page=${page}`;

			if (this._monitor._autoLoad) {
				try {
					await this._monitor._autoLoad.fetchAutoLoadUrl(url, queue, page);
				} catch (error) {
					if (error.message == "dog_page") {
						this._monitor._autoLoad.dogPageDetected();
					} else if (error.message == "captcha_page") {
						this._monitor._autoLoad.captchaPageDetected();
					} else if (error.message == "login_page") {
						this._monitor._autoLoad.loginPageDetected();
					}
				}
			}
		}

		if (data.type == "updateAssistedLoadDates") {
			// Update last load text if provided (skip if "(tba)" to avoid overwriting existing value)
			if (data.lastLoadText && data.lastLoadText !== "(tba)") {
				const lastLoadElement = document.getElementById("date_last_assisted_load");
				if (lastLoadElement) {
					lastLoadElement.innerText = data.lastLoadText;
				}
			}

			// Always update next load text
			if (data.nextLoadText) {
				const nextLoadElement = document.getElementById("date_next_assisted_load");
				if (nextLoadElement) {
					nextLoadElement.innerText = data.nextLoadText;
				}
			}
		}
	}

	/**
	 * Set the status label and icon of the WebSocket.
	 * @param {boolean} status
	 * @param {string} message
	 */
	#setWebSocketStatus(status, message = null) {
		const icon = document.querySelector("#statusWS div.vh-switch-32");
		const description = document.querySelector("#descriptionWS");

		// Add null checks to prevent errors when elements don't exist
		if (!icon || !description) {
			console.warn("[ServerCom] WebSocket status elements not found in DOM");
			return;
		}

		if (status) {
			icon.classList.remove("vh-icon-switch-off");
			icon.classList.add("vh-icon-switch-on");
			description.innerText = "Listening to live feed...";
			this._wsErrorMessage = null;
		} else {
			icon.classList.remove("vh-icon-switch-on");
			icon.classList.add("vh-icon-switch-off");
			if (message) {
				this._wsErrorMessage = message;
				description.innerText = message;
			} else if (this._wsErrorMessage == null) {
				description.innerText = "Not connected. Retrying in <10 sec...";
			}
		}
	}

	/**
	 * Update the status of the monitor.
	 * Will check:
	 * - if the monitor is active
	 * - if there is a defined country
	 * - if the master monitor is responding
	 * - if the monitor is running as master (or slave)
	 */
	async #updateMonitorMode() {
		if (!this._monitor._settings.get("notification.active")) {
			this.#setMasterMonitorStatus(false, "You need to enable the notifications monitor.");
		} else if (this._monitor._i13nMgr.getCountryCode() === null) {
			this.#setMasterMonitorStatus(false, "Your country has not been detected, load a vine page first.");
		} else if (this._monitor._i13nMgr.getDomainTLD() === null) {
			this.#setMasterMonitorStatus(
				false,
				"No valid country found. You current country is detected as: '" +
					this._monitor._i13nMgr.getCountryCode() +
					"', which is not currently supported by Vine Helper. Reach out so we can add it!"
			);
		} else if (this._monitor._settings.get("notification.active")) {
			//Send a message to the service worker to check if it is still running
			this.#statusTimer = window.setTimeout(() => {
				this.#setMasterMonitorStatus(false, "Master monitor not responding, reload the page.");
			}, 500);
			try {
				this._monitor._channel.postMessage(
					await this._monitor._cryptoKeys.encryptJSON({ type: "masterMonitorPing" })
				);
				if (this._monitor._isMasterMonitor) {
					clearTimeout(this.#statusTimer);
					this.#statusTimer = null;
					const context =
						isSafari() || this._monitor._settings.get("notification.connectionMode") == "0" ? "Tab" : "SW";
					this.#setMasterMonitorStatus(true, "Running as master (" + context + ")...");
				} else {
					//Will be set when we receive a pong from the master monitor.
				}
			} catch (e) {
				//Page out of context, let the display show an error.
			}
		}
	}

	/**
	 * Set the status label and icon of the master monitor.
	 * @param {boolean} status
	 * @param {string} desc
	 */
	#setMasterMonitorStatus(status, desc = "") {
		const icon = document.querySelector("#statusSW div.vh-switch-32");
		const description = document.querySelector("#descriptionSW");

		if (status && !this.#outOfContext) {
			icon.classList.remove("vh-icon-switch-off");
			icon.classList.add("vh-icon-switch-on");
		} else {
			icon.classList.remove("vh-icon-switch-on");
			icon.classList.add("vh-icon-switch-off");
		}

		if (this.#outOfContext) {
			description.textContent = "Monitor out of context, reload the page.";
		} else {
			description.textContent = desc;
		}
	}

	//#####################################################
	//## ITEM PROCESSING FUNCTIONS
	//#####################################################

	async #dataBuffering(data) {
		if (!this.fetch100) {
			this._monitor._channel.postMessage(await this._monitor._cryptoKeys.encryptJSON(data));
			this.processBroadcastMessage(data);
			return;
		}
		this.#dataBuffer.push(data);
		if (data.type == "fetchRecentItemsEnd") {
			// Stringify once and reuse to avoid duplicate memory allocation
			const stringifiedBuffer = JSON.stringify(this.#dataBuffer);
			this._monitor._channel.postMessage(
				await this._monitor._cryptoKeys.encryptJSON({ type: "fetch100", data: stringifiedBuffer })
			);
			this.processBroadcastMessage({ type: "fetch100", data: stringifiedBuffer });
			this.#dataBuffer = [];
			this.fetch100 = false;
		}
	}

	async #processLast100Items(arrProducts) {
		arrProducts.sort((a, b) => {
			const dateA = new Date(a.date);
			const dateB = new Date(b.date);
			return dateB - dateA;
		});
		this.fetch100 = true;
		for (let i = arrProducts.length - 1; i >= 0; i--) {
			const item = this.#createValidatedItem(arrProducts[i], `processLast100Items at index ${i}`);
			if (!item) {
				console.error(
					`[ServerCom] processLast100Items: item is null at index ${i}, data: ${JSON.stringify(arrProducts[i])}`
				);
				continue;
			}

			//Only display notification for products with a title and image url
			//And that are more recent than the latest notification received.
			if (item.data.img_url == "" || item.data.title == "") {
				if (this._monitor._settings.get("general.debugServercom")) {
					console.log("FETCH LATEST: item without title or image url: " + item.data.asin);
				}
				continue;
			}

			this.#streamProcessor.input({
				index: i,
				type: "newItem",
				domain: this._monitor._settings.get("general.country"),
				item: item,
				fetchLatest: true,
			});
		}
		this.#streamProcessor.input({ type: "fetchRecentItemsEnd" });
	}

	//#####################################################
	//## PUSH NOTIFICATIONS
	//#####################################################

	#pushNotification(notificationTitle, item) {
		if (!(item instanceof Item)) {
			throw new Error("item is not an instance of Item");
		}

		// Debug logging for OS notification being sent
		if (this._monitor._settings.get("general.debugKeywords")) {
			const itemInfo = item.getAllInfo();
			console.log("[NotificationMonitor] Sending OS notification:", {
				title: notificationTitle,
				asin: itemInfo.asin,
				itemTitle: itemInfo.title,
				queue: itemInfo.queue,
				isKeywordMatch: notificationTitle.includes("match KW"),
				timestamp: new Date().toISOString(),
			});
		}

		chrome.runtime.sendMessage({
			type: "pushNotification",
			item: item.getAllInfo(),
			title: notificationTitle,
		});
	}

	destroy() {
		// Clear the service worker status timer to prevent memory leak
		if (this.#serviceWorkerStatusTimer) {
			window.clearInterval(this.#serviceWorkerStatusTimer);
			this.#serviceWorkerStatusTimer = null;
		}

		// Clear the status timer if it exists
		if (this.#statusTimer) {
			window.clearTimeout(this.#statusTimer);
			this.#statusTimer = null;
		}

		// Remove channel event listener
		if (this._monitor._channel && this.#channelMessageHandler) {
			this._monitor._channel.removeEventListener("message", this.#channelMessageHandler);
			this.#channelMessageHandler = null;
		}

		// Clear static instance reference
		ServerCom.#instance = null;
	}
}

export { ServerCom };
