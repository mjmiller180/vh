class WebhookQueue {
	static #instance;
	#arrWebhookQueue = [];
	#queueTimer = null;
	#settingsMgr = null;
	constructor(settingsMgr) {
		if (WebhookQueue.#instance) {
			return WebhookQueue.#instance;
		}
		WebhookQueue.#instance = this;
		this.#settingsMgr = settingsMgr;
	}

	/** This method queue the webhook and will retry if it fails */

	queue(url, options) {
		this.#arrWebhookQueue.push({ url, options });
		if (!this.#queueTimer) {
			this.#queueTimer = setInterval(() => {
				this.#processWebhookQueue();
			}, 3000);
		}
		this.#processWebhookQueue();
	}

	async #processWebhookQueue() {
		while (this.#arrWebhookQueue.length > 0) {
			const { url, options } = this.#arrWebhookQueue.shift();

			try {
				const { status } = await fetch(url, options);

				if (status === 429 && this.#settingsMgr.isPremiumUser(3)) {
					// Rate limit exceeded - keep in queue and wait
					console.warn("Rate limit exceeded, keeping webhook in queue");
					this.#arrWebhookQueue.unshift({ url, options });
					break; // Exit loop to wait for next interval
				}
			} catch (error) {
				console.error("Error sending webhook:", error);
			}
		}
	}
}

export { WebhookQueue };
