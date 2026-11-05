/*global chrome*/

import { ChromeStorageAdapter } from "/scripts/infrastructure/StorageAdapter.js";
import { Item, WITH_VARIANT } from "/scripts/core/models/Item.js";
import { initializeServices, getSettingsManager } from "/scripts/infrastructure/SettingsFactoryEnhanced.js";
import { Websocket } from "/scripts/notifications-monitor/stream/Websocket.js";
import { WebsocketRelaySW } from "/scripts/notifications-monitor/stream/WebsocketRelaySW.js";
import { Internationalization } from "/scripts/core/services/Internationalization.js";
import { isSafari } from "/scripts/core/utils/BrowserDetection.js";
var i13n = new Internationalization();

// Initialize services
let storage = new ChromeStorageAdapter("local");
let Settings = null;
let notificationsData = {};
let masterCheckInterval = 0.2; //Firefox shutdown the background script after 30seconds.
let websocket = null;

// Register message handlers IMMEDIATELY to avoid race conditions
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.action === "keywordsUpdated") {
		// Clear keyword cache in settings manager
		if (Settings && Settings.clearKeywordCache) {
			Settings.clearKeywordCache();
			if (Settings && Settings.get("general.debugServiceWorker")) {
				console.log("[ServiceWorker] Keyword cache cleared after update");
			}
		}
	}
});

// Initialize DI services on startup
(async function initializeServiceWorker() {
	try {
		// Initialize settings using direct storage to avoid circular dependency
		// We'll use ChromeStorageAdapter directly during initialization, then switch to
		// ServiceWorkerStorageAdapter after initialization is complete
		await initializeServices();
		Settings = getSettingsManager();
		await Settings.waitForLoad();

		let countryCode = Settings.get("general.country");
		while (countryCode === null) {
			await new Promise((r) => setTimeout(r, 500));
			countryCode = Settings.get("general.country");
		}
		i13n.setCountryCode(countryCode);

		///Every minute, increment the metrics.minutesUsed setting
		setInterval(async () => {
			await Settings.refresh();
			Settings.set("metrics.minutesUsed", Settings.get("metrics.minutesUsed") + 1, false);
		}, 60000);

		//Websocket
		initializeWebsocket();
	} catch (error) {
		console.error("[ServiceWorker] Failed to initialize DI services:", error);
		// Service workers cannot recover from this error - DI is required
		throw error;
	}
})();

// NOTE: Keywords in the service worker are NOT mission-critical
// The service worker only uses keywords for:
// 1. Adding new keywords via context menu (right-click)
// 2. Clearing keyword cache when keywords are updated
// All actual keyword matching happens in content scripts and the notification monitor
// If the service worker goes offline, keyword functionality continues to work

//#####################################################
//## CONTEXT MENU
//#####################################################

let selectedWord = "";
// Create static context menu items
chrome.runtime.onInstalled.addListener(() => {
	if (!chrome.contextMenus) {
		console.warn("[ServiceWorker] chrome.contextMenus API not available");
		return;
	}

	try {
		// Clear existing menu items before creating new ones
		chrome.contextMenus.removeAll();

		const patterns = [
			"https://*.amazon.com/vine/*",
			"https://*.amazon.co.uk/vine/*",
			"https://*.amazon.co.jp/vine/*",
			"https://*.amazon.de/vine/*",
			"https://*.amazon.fr/vine/*",
			"https://*.amazon.it/vine/*",
			"https://*.amazon.es/vine/*",
			"https://*.amazon.ca/vine/*",
			"https://*.amazon.com.au/vine/*",
			"https://*.amazon.com.br/vine/*",
			"https://*.amazon.com.mx/vine/*",
			"https://*.amazon.sg/vine/*",
		];

		chrome.contextMenus.create({
			id: "copy-asin",
			title: "Copy ASIN",
			contexts: ["all"],
			documentUrlPatterns: patterns,
		});
		chrome.contextMenus.create({
			id: "add-to-highlightKeywords",
			title: "Add to highlight keywords",
			contexts: ["all"],
			documentUrlPatterns: patterns,
		});
		chrome.contextMenus.create({
			id: "add-to-hideKeywords",
			title: "Add to hide keywords",
			contexts: ["all"],
			documentUrlPatterns: patterns,
		});
	} catch (error) {
		console.error("[ServiceWorker] Error creating context menus:", error);
	}
});

// Store the word sent by the content script
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
	if (message.action === "setWord" && message.word) {
		selectedWord = message.word; // Update the selected word
	}
	if (message.action === "addWord" && message.word) {
		const confirmedWord = message.word;

		const newKeyword = {
			contains: confirmedWord,
			without: "",
			etv_min: "",
			etv_max: "",
		};

		if (message.list === "Hide") {
			const arrHide = await Settings.get("general.hideKeywords");
			let newArrHide = [...arrHide, newKeyword];

			//Sort the list
			newArrHide.sort((a, b) => {
				if (a.contains.toLowerCase() < b.contains.toLowerCase()) return -1;
				if (a.contains.toLowerCase() > b.contains.toLowerCase()) return 1;
				return 0;
			});

			Settings.set("general.hideKeywords", newArrHide);
		} else if (message.list === "Highlight") {
			const arrHighlight = await Settings.get("general.highlightKeywords");
			let newArrHighlight = [...arrHighlight, newKeyword];

			//Sort the list
			newArrHighlight.sort((a, b) => {
				if (a.contains.toLowerCase() < b.contains.toLowerCase()) return -1;
				if (a.contains.toLowerCase() > b.contains.toLowerCase()) return 1;
				return 0;
			});

			Settings.set("general.highlightKeywords", newArrHighlight);
		}
	}
	sendResponse({ success: true });
});

// Handle context menu clicks and save the word
if (chrome.contextMenus && chrome.contextMenus.onClicked) {
	chrome.contextMenus.onClicked.addListener((info, tab) => {
		if (info.menuItemId === "copy-asin") {
			chrome.tabs.sendMessage(tab.id, { action: "copyASIN" });
			return;
		}

		if (!selectedWord) {
			console.error("No word selected!");
			return;
		}

		const list = info.menuItemId === "add-to-hideKeywords" ? "Hide" : "Highlight";

		chrome.tabs.sendMessage(tab.id, { action: "showPrompt", word: selectedWord, list: list });
	});
} else {
	console.warn("[ServiceWorker] chrome.contextMenus API not available");
}

//#####################################################
//## BROADCAST MESSAGE PROCESSING
//#####################################################

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
	// Handle broadcast messages (including pushNotification)
	if (message.type !== undefined) {
		processBroadcastMessage(message, sender, sendResponse);
		return true; // Indicate that sendResponse will be called asynchronously
	}
});

function processBroadcastMessage(data, sender, sendResponse) {
	if (data.type == "saveToLocalStorage") {
		storage
			.set(data.key, data.value)
			.then(() => {
				sendResponse({ success: true });
			})
			.catch((error) => {
				console.log("Service worker caught error:", error);
				console.log("Error message:", error.message);
				console.log("Error name:", error.name);
				sendResponse({ success: false, error: error.message });
			});
		return true; // Indicate that sendResponse will be called asynchronously
	}
	if (data.type == "clearLocalStorage") {
		storage
			.clear()
			.then(() => {
				sendResponse({ success: true });
			})
			.catch((error) => {
				sendResponse({ success: false, error: error.message });
			});
		return true; // Indicate that sendResponse will be called asynchronously
	}

	if (data.type == "pushNotification") {
		try {
			// ServerCom sends { type: "pushNotification", item: {...}, title: ... }
			// where item contains all the item data from item.getAllInfo()
			if (!data.item) {
				throw new Error("pushNotification message missing item data");
			}

			const item = new Item({
				asin: data.item.asin,
				queue: data.item.queue,
				is_parent_asin: data.item.is_parent_asin,
				is_pre_release: data.item.is_pre_release,
				enrollment_guid: data.item.enrollment_guid,
			});
			item.setTitle(data.item.title);
			item.setImgUrl(data.item.img_url);
			item.setSearch(data.item.search);
			pushNotification(data.title, item);
		} catch (error) {
			console.error("[ServiceWorker] Cannot create item for push notification -", error.message, {
				data: data,
				source: "pushNotification message",
			});
		}
		return true;
	}

	if (data.type == "refreshSettings") {
		// Refresh settings in the service worker
		if (Settings && Settings.refresh) {
			Settings.refresh()
				.then(() => {
					if (sendResponse) {
						sendResponse({ success: true });
					}
				})
				.catch((error) => {
					console.error("[ServiceWorker] Failed to refresh settings:", error);
					if (sendResponse) {
						sendResponse({ success: false, error: error.message });
					}
				});

			//Send a message to all tabs to refresh the settings
			sendMessageToAllTabs({ type: "refreshSettings" });
		} else {
			console.warn("[ServiceWorker] Settings not available for refresh");
			if (sendResponse) {
				sendResponse({ success: false, error: "Settings not available" });
			}
		}
		return true; // Indicate that sendResponse will be called asynchronously
	}

	//Websocket messages
	if (websocket) {
		websocketMessageRelay(data);
		return true;
	}
}

//#####################################################
//## WEBSOCKET (For non-Safari browsers)
//#####################################################

function initializeWebsocket() {
	if (!isSafari() && Settings && Settings.get("notification.connectionMode") == "1") {
		if (!websocket || !websocket.isConnected()) {
			const messageRelayer = new WebsocketRelaySW(sendMessageToAllTabs);
			websocket = new Websocket(messageRelayer);
		}
	} else {
		//Terminate the websocket connection
		if (websocket) {
			websocket.disconnect();
			websocket = null;
		}
	}
}

const processedMessages = new Set();
function websocketMessageRelay(message) {
	//Prevent duplicate messages from being processed (theorical fix for multiple identical messages being sent)
	// Create unique message ID
	const messageId = `${message.type}_${Date.now()}_${JSON.stringify(message)}`;

	if (processedMessages.has(messageId)) {
		console.log(`[Service Worker] Duplicate message ignored: ${message.type}`);
		return;
	}

	processedMessages.add(messageId);

	// Clean up old message IDs (keep only last 100)
	if (processedMessages.size > 100) {
		const toDelete = Array.from(processedMessages).slice(0, processedMessages.size - 100);
		toDelete.forEach((id) => processedMessages.delete(id));
	}

	if (
		message.type === "fetchLatestItems" ||
		message.type === "wsStatus" ||
		message.type === "reloadRequest" ||
		message.type === "wsConnect"
	) {
		if (Settings && Settings.get("general.debugServiceWorker")) {
			console.log("Relaying message to websocket", message);
		}
		websocket.processMessage(message);
		return;
	}
}

//#####################################################
//## BUSINESS LOGIC
//#####################################################

// Alarm for master check, keeps the service worker alive
chrome.alarms.create("masterCheck", { periodInMinutes: masterCheckInterval });
chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name === "masterCheck") {
		// Only send messages if Settings is initialized
		if (Settings) {
			initializeWebsocket();
			sendMessageToAllTabs({ type: "masterCheck" });
		}
	}
});

async function sendMessageToAllTabs(data) {
	if (Settings && Settings.get("general.debugServiceWorker")) {
		console.log("Sending message to all tabs", data);
	}
	try {
		const tabs = await chrome.tabs.query({});
		const regex = /^.+?amazon\.([a-z.]+).*\/vine\/.*$/;
		tabs.forEach((tab) => {
			if (tab) {
				//Check to make sure this is a VineHelper tab:
				const match = regex.exec(tab.url);
				//Edge Canari Mobile does not support tab.url
				if (tab.url == undefined || match) {
					if (Settings && Settings.get("general.debugServiceWorker")) {
						console.log("Sending to tab id " + tab.id, data);
					}
					sendMessageToTab(tab.id, data);
				}
			}
		});
	} catch (error) {
		console.error("Error querying tabs:", error);
	}
}

function sendMessageToTab(tabId, data) {
	//Check if the scripting permission is enabled
	chrome.permissions.contains({ permissions: ["scripting"] }, (result) => {
		if (result) {
			//Try sending message via scripting (new method, as Safari does not support tab messaging)
			try {
				chrome.scripting.executeScript({
					target: { tabId: tabId },
					func: (data) => {
						window.postMessage(data, "*");
					},
					args: [data],
				});
			} catch (e) {
				console.error("Error sending message to tab via scripting:", e);
			}
		} else {
			//Try sending a message via tab (classic method)
			try {
				chrome.tabs.sendMessage(tabId, data, (response) => {
					if (chrome.runtime.lastError) {
						console.error("Error sending message to tab:", chrome.runtime.lastError.message);
					}
				});
			} catch (e) {
				console.error("Error sending message to tab:", e);
			}
		}
	});
}

//#####################################################
//## PUSH NOTIFICATIONS
//#####################################################

try {
	if (!isSafari()) {
		chrome.permissions.contains({ permissions: ["notifications"] }, (result) => {
			chrome.notifications.onClicked.addListener((notificationId) => {
				if (Settings && Settings.get("general.debugServiceWorker")) {
					console.log("[ServiceWorker] Notification clicked", {
						notificationId,
						data: notificationsData[notificationId],
					});
				}

				const { asin, queue, is_parent_asin, enrollment_guid, search, is_pre_release } =
					notificationsData[notificationId] || {};

				let url;
				const tld = i13n.getDomainTLD() || "com";

				// Check if we should open modal (requires all necessary data)
				if (
					Settings &&
					Settings.get("general.searchOpenModal") &&
					is_parent_asin != null &&
					enrollment_guid != null
				) {
					try {
						// Create the openModal URL like the old code did
						const item = new Item({
							asin: asin,
							queue: queue,
							is_parent_asin: is_parent_asin,
							is_pre_release: is_pre_release,
							enrollment_guid: enrollment_guid,
						});
						url = item.getVHOpenModalURL(WITH_VARIANT);
						if (Settings && Settings.get("general.debugServiceWorker")) {
							console.log("[ServiceWorker] Opening modal URL:", url);
						}
					} catch (error) {
						console.error("[ServiceWorker] Cannot create modal URL, falling back to search", error);
						// Fall back to search URL
						if (search) {
							url = `https://www.amazon.${tld}/vine/vine-items?search=${encodeURIComponent(search)}`;
						}
					}
				} else if (search) {
					// Use search string (item title) not ASIN
					url = `https://www.amazon.${tld}/vine/vine-items?search=${encodeURIComponent(search)}`;
				} else {
					// Last resort: just open vine items page
					url = `https://www.amazon.${tld}/vine/vine-items`;
					console.warn("[ServiceWorker] No search string available for notification", {
						notificationData: notificationsData[notificationId],
					});
				}

				if (Settings && Settings.get("general.debugServiceWorker")) {
					console.log("[ServiceWorker] Opening URL from notification click:", url);
				}
				chrome.tabs.create({ url: url });
				chrome.notifications.clear(notificationId);
				delete notificationsData[notificationId];
			});
		});
	}
} catch (err) {
	//Not supported, probably safari.
}

async function pushNotification(title, item) {
	if (isSafari()) {
		return false;
	}

	// Handle both object with methods and plain object formats
	// If item is an Item instance, get the data from getAllInfo()
	const itemData = item.getAllInfo ? item.getAllInfo() : item;

	// Use ASIN-based notification ID to prevent duplicates
	const notificationId = `notification_${itemData.asin}`;
	const iconUrl = chrome.runtime.getURL("resource/image/icon-128.png");

	// Store notification data
	notificationsData[notificationId] = {
		asin: itemData.asin,
		queue: itemData.queue,
		is_parent_asin: itemData.is_parent_asin,
		enrollment_guid: itemData.enrollment_guid,
		search: itemData.search,
		is_pre_release: itemData.is_pre_release,
	};

	// Get the product image URL if available
	const imageUrl = itemData.img_url;

	// Debug logging for notification images
	if (Settings && Settings.get("general.debugServiceWorker")) {
		console.log("[ServiceWorker] Notification image data", {
			asin: itemData.asin,
			title: itemData.title,
			imageUrl: imageUrl,
			hasImgUrl: !!itemData.img_url,
			itemDataKeys: Object.keys(itemData),
			fullItemData: itemData,
		});

		if (!imageUrl) {
			console.warn("[ServiceWorker] No image URL for notification");
		}
	}

	const notificationOptions = {
		type: "basic",
		iconUrl: imageUrl || iconUrl, // Use product image as icon if available, fallback to extension icon
		title: title,
		message: itemData.title || "",
		priority: 2,
		silent: false,
	};

	if (Settings && Settings.get("general.debugServiceWorker")) {
		console.log("[ServiceWorker] Creating notification", {
			asin: itemData.asin,
			type: notificationOptions.type,
			iconUrl: notificationOptions.iconUrl,
			hasProductImage: !!imageUrl,
		});
	}

	chrome.notifications.create(notificationId, notificationOptions);
}
