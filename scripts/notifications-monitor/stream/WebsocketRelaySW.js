/**
 * Relay messages from the Service Worker handled websocket to the monitor (For non-Safari browsers)
 * This class is injected to the websocket
 */

import { WebsocketRelayInterface } from "/scripts/notifications-monitor/stream/WebsocketRelayInterface.js";

/**
 * @implements {WebsocketRelayInterface}
 */
class WebsocketRelaySW extends WebsocketRelayInterface {
	#fctPostMessage = null;

	/**
	 * Constructor
	 * @param {function} fctPostMessage Function to post the message to the monitor.
	 */
	constructor(fctPostMessage) {
		super();
		this.#fctPostMessage = fctPostMessage;
	}

	/**
	 * Relay a message to the monitor
	 * @param {object} message The message to relay
	 */
	relayMessage(message) {
		this.#fctPostMessage(message);
	}
}

export { WebsocketRelaySW };
