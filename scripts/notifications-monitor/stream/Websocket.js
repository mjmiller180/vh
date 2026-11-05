/*global chrome*/

const DEBUG_MODE = false;
const VINE_HELPER_API_V5_WS_URL = "wss://api.vinehelper.ovh";
//const VINE_HELPER_API_V5_WS_URL = "ws://127.0.0.1:3000";
const WSReconnectInterval = 10 * 1000; //10 seconds

import { io } from "/scripts/vendor/socket.io/client-dist/socket.io.esm.min.js";
import { SettingsMgr } from "/scripts/core/services/SettingsMgrCompat.js";
import { Internationalization } from "/scripts/core/services/Internationalization.js";

var Settings = new SettingsMgr();
var i13n = new Internationalization();

class Websocket {
	static #instance = null;

	#socket = null;
	#socket_connecting = false;
	#reconnectTimer = null;
	#socketHandlers = null;
	#messageRelayer = null;

	/**
	 * Constructor
	 * @param {WebsocketRelayInterface} messageRelayer Instance of one of the WebsocketRelay classes. Used to relay messages to the monitor.
	 */
	constructor(messageRelayer) {
		if (Websocket.#instance) {
			return Websocket.#instance;
		}
		Websocket.#instance = this;
		this.#messageRelayer = messageRelayer;
		this.#init();
		this.#createReconnectTimer();
	}

	async #init() {
		try {
			await Settings.refresh();
			i13n.setCountryCode(DEBUG_MODE ? "com" : await Settings.get("general.country"));
		} catch (e) {
			//Will catch an error from ChromeStorageAdapter.get() if the storage is not accessible
			this.#messageRelayer.relayMessage({ type: "outOfContext" });
		}

		if (!Settings.get("notification.active")) {
			this.#socket?.disconnect();
			return;
		}

		// If the socket is already connected, do not connect again
		if (this.#socket?.connected) {
			return;
		}

		if (i13n.getCountryCode() === null) {
			console.error("Country not known, refresh/load a vine page.");
			return; //If the country is not known, do not connect
		}

		if (this.#socket_connecting) {
			if (Settings.get("general.debugWebsocket")) {
				console.log(`${new Date().toLocaleString()} - WS already connecting, skipping.`);
			}
			return;
		}

		// Clean up any existing socket instance before creating a new one
		if (this.#socket) {
			this.#cleanupSocketListeners();
			this.#socket.removeAllListeners();
			this.#socket.disconnect();
			this.#socket = null;
		}

		this.#socket_connecting = true;
		this.#socket = io.connect(VINE_HELPER_API_V5_WS_URL, {
			query: {
				app_version: chrome.runtime.getManifest().version,
				countryCode: DEBUG_MODE ? "com" : i13n.getCountryCode(),
				uuid: await Settings.get("general.uuid", false),
				fid: await Settings.get("general.fingerprint.id", false),
				cid: await Settings.get("general.cid", false),
			}, // Pass the country code as a query parameter
			transports: ["websocket"],
			reconnection: false, //Handled manually every 30 seconds.
		});

		//## PASS ALL RECEIVED DATA TO THE MESSAGING CHANNEL #########################

		// Clean up any existing listeners before adding new ones
		this.#cleanupSocketListeners();

		// Define named handlers to reduce memory overhead and improve debugging
		this.#socketHandlers = {
			connect: () => {
				this.#socket_connecting = false;
				if (Settings.get("general.debugWebsocket")) {
					console.log(`${new Date().toLocaleString()} - WS Connected`);
				}
				this.#messageRelayer.relayMessage({ type: "wsStatus", status: "wsOpen" });
			},

			newItem: (data) => {
				// Debug logging for incoming item data
				if (Settings.get("general.debugWebsocket")) {
					console.log("[WebSocket] Received newItem", {
						asin: data.item?.asin,
						hasImgUrl: !!data.item?.img_url,
						imgUrl: data.item?.img_url,
						itemKeys: data.item ? Object.keys(data.item) : [],
					});
				}

				this.#messageRelayer.relayMessage({ type: "newPreprocessedItem", item: data.item });
			},

			last100: (data) => {
				this.#messageRelayer.relayMessage({ type: "last100", products: data.products });
			},

			newETV: (data) => {
				this.#messageRelayer.relayMessage({ type: "newETV", item: data.item });
			},

			newPrice: (data) => {
				this.#messageRelayer.relayMessage({ type: "newPrice", item: data.item });
			},

			newVariants: (data) => {
				this.#messageRelayer.relayMessage({ type: "newVariants", item: data });
			},

			unavailableItem: (data) => {
				this.#messageRelayer.relayMessage({ type: "unavailableItem", item: data.item });
			},

			reloadPage: async (data) => {
				this.#messageRelayer.relayMessage({ type: "fetchAutoLoadUrl", queue: data.queue, page: data.page });
			},

			//This is called when the server force-disconnects the client
			serverDisconnect: (data) => {
				// Server-initiated disconnect - stop reconnection and show specific message
				this.#socket_connecting = false;

				// Deactivate the reconnection timer when server disconnects us
				if (this.#reconnectTimer) {
					clearInterval(this.#reconnectTimer);
					this.#reconnectTimer = null;
				}

				if (Settings.get("general.debugWebsocket")) {
					console.log(`${new Date().toLocaleString()} - Server disconnected the client`);
				}
				this.#messageRelayer.relayMessage({
					type: "wsStatus",
					status: "wsError",
					error:
						data.message ||
						"Remotely disconnected, reload the page. Upgrade your membership to get more connections",
				});
			},

			connection_error: (error) => {
				// Only pass minimal error info to prevent retaining large error objects
				this.#messageRelayer.relayMessage({
					type: "wsStatus",
					status: "wsError",
					error: error.message || "Connection error",
				});
			},

			disconnect: () => {
				this.#socket_connecting = false;
				if (Settings.get("general.debugWebsocket")) {
					console.log(`${new Date().toLocaleString()} - Socket.IO Disconnected`);
				}
				this.#messageRelayer.relayMessage({ type: "wsStatus", status: "wsClosed" });
			},

			connect_error: (error) => {
				this.#socket_connecting = false;
				// Extract only the message to avoid retaining the full error object
				//If the error message is an object, serialize it to a string
				let errorMessage;
				if (typeof error.message === "object") {
					errorMessage = JSON.stringify(error.message);
				} else {
					errorMessage = error.message || "Unknown error";
				}
				this.#messageRelayer.relayMessage({ type: "wsStatus", status: "wsError", error: errorMessage });
				console.error(`${new Date().toLocaleString()} - Socket.IO error: ${errorMessage}`);
			},
		};

		// Attach all handlers
		Object.entries(this.#socketHandlers).forEach(([event, handler]) => {
			this.#socket.on(event, handler);
		});
	}

	#createReconnectTimer() {
		// Clear any existing intervals
		if (this.#reconnectTimer) {
			clearInterval(this.#reconnectTimer);
		}
		// Create interval to check connection every WSReconnectInterval minutes
		this.#reconnectTimer = setInterval(() => {
			this.#init();
		}, WSReconnectInterval); // Convert minutes to milliseconds
	}

	processMessage(message) {
		//The service worker is passing along a request to fetch the latest items
		if (message.type === "fetchLatestItems") {
			//Get the last 100 most recent items
			if (this.#socket?.connected) {
				this.#socket.emit("getLast100", {
					app_version: chrome.runtime.getManifest().version,
					uuid: Settings.get("general.uuid", false),
					fid: Settings.get("general.fingerprint.id", false),
					countryCode: DEBUG_MODE ? "com" : i13n.getCountryCode(),
					limit: message.limit || 100,
					request_variants: Settings.isPremiumUser(2) && Settings.get("general.displayVariantButton"),
				});
			} else {
				console.warn("Socket not connected - cannot fetch last 100 items");
			}
		}

		//The service worker is passing along a request to report the websocket status
		if (message.type === "wsStatus") {
			//if (this._monitor._isMasterMonitor) { //The websocket is always from the master monitor
			this.#messageRelayer.relayMessage({
				type: "wsStatus",
				status: this.#socket?.connected ? "wsOpen" : "wsClosed",
			});
			//}
		}

		if (message.type === "reloadRequest") {
			this.#socket.emit("reloadRequest", {
				uuid: message.uuid,
				fid: message.fid,
				countryCode: message.countryCode,
			});
		}

		//The notification monitor is being loaded, ensure the reconnect timer is running
		if (message.type === "wsConnect") {
			this.#messageRelayer.relayMessage({
				type: "wsStatus",
				status: "wsError",
				error: "Reconnecting a few seconds...",
			});
			this.#createReconnectTimer();
		}
	}

	isConnected() {
		return this.#socket?.connected || false;
	}

	emit(type, data) {
		this.#socket.emit(type, data);
	}

	disconnect() {
		this.#socket.disconnect();
	}

	destroyInstance() {
		// Clear the reconnect timer
		if (this.#reconnectTimer) {
			clearInterval(this.#reconnectTimer);
			this.#reconnectTimer = null;
		}

		// Remove all event listeners
		if (this.#socket) {
			this.#socket.removeAllListeners();
			this.#socket.disconnect();
			this.#socket = null;
		}

		this.#socket_connecting = false;
		Websocket.#instance = null;
	}

	/**
	 * Clean up socket event listeners before re-adding them
	 */
	#cleanupSocketListeners() {
		if (this.#socket && this.#socketHandlers) {
			// Remove all handlers using the same references
			Object.entries(this.#socketHandlers).forEach(([event, handler]) => {
				this.#socket.off(event, handler);
			});
		}
		// Clear the handlers object to free memory
		this.#socketHandlers = null;
	}
}

export { Websocket };
