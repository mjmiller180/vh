/**
 * Relay messages from the tab handled websocket to the monitor (For Safari)
 * This class is injected to the websocket
 */

import { WebsocketRelayInterface } from "/scripts/notifications-monitor/stream/WebsocketRelayInterface.js";
import { CryptoKeys } from "/scripts/core/utils/CryptoKeys.js";

/**
 * @implements {WebsocketRelayInterface}
 */
class WebsocketRelayMonitor extends WebsocketRelayInterface {
	#monitor = null;
	#cryptoKeys = null;
	/**
	 * Constructor
	 * @param {MonitorCore} monitor instance of MonitorCore
	 */
	constructor(monitor) {
		super();
		this.#monitor = monitor;
		this.#cryptoKeys = new CryptoKeys();
	}

	/**
	 * Relay a message to the monitor
	 * @param {object} message The message to relay
	 */
	async relayMessage(message) {
		// Only log if debug is enabled
		if (this.#monitor._settings.get("general.debugWebsocket")) {
			// Only log message type for performance - avoid logging large arrays
			if (message.type === "last100") {
				console.log(`Relaying message type: ${message.type}, products: ${message.products?.length || 0}`);
			} else {
				console.log("Relaying message", message);
			}
		}
		this.#monitor._channel.postMessage(await this.#cryptoKeys.encryptJSON(message));
		this.#monitor._serverComMgr.processBroadcastMessage(message);
	}
}

export { WebsocketRelayMonitor };
