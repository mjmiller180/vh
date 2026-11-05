/**
 * @interface WebsocketRelayInterface
 * @property {function} relayMessage - Relay a message to the monitor.
 */
class WebsocketRelayInterface {
	relayMessage(message) {
		throw new Error("Method not implemented");
	}
}

export { WebsocketRelayInterface };
