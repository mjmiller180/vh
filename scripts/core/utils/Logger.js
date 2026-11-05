import { isMobileBrowser } from "./BrowserDetection.js";

class Logger {
	static #instance = null;
	#arrEvents;
	#startTime;
	#mobileBrowser;

	constructor() {
		//Singleton
		if (Logger.#instance) {
			// Return the existing instance if it already exists
			return Logger.#instance;
		}
		// Initialize the instance if it doesn't exist
		Logger.#instance = this;

		this.#arrEvents = [];
		this.#startTime = Date.now();
		this.#mobileBrowser = isMobileBrowser();
	}

	add(desc) {
		this.#arrEvents.push({ time: Date.now() - this.#startTime, event: desc });
		if (this.#mobileBrowser) {
			console.log(desc);
		}
	}

	getContentRaw() {
		return this.#arrEvents;
	}

	async getContent() {
		try {
			await this.#generateStorageUsageForDebug();
		} catch (error) {
			console.error("Error generating runtime json");
		} finally {
			return JSON.stringify(this.getContentRaw(), null, 2).replaceAll("\n", "<br/>\n");
		}
	}

	#bytesToSize(bytes, decimals = 2) {
		if (!Number(bytes)) {
			return "0 Bytes";
		}

		const kbToBytes = 1024;
		const dm = decimals < 0 ? 0 : decimals;
		const sizes = ["Bytes", "KB", "MB", "GB", "TB"];

		const index = Math.floor(Math.log(bytes) / Math.log(kbToBytes));

		return `${parseFloat((bytes / Math.pow(kbToBytes, index)).toFixed(dm))} ${sizes[index]}`;
	}

	async #generateStorageUsageForDebug() {
		try {
			const items = await this.#getStorageItems();
			for (let key in items) {
				try {
					let itemCount = "";
					const keyLength = await this.#getStorageKeyLength(key);
					const bytesUsed = await this.#getStorageKeySizeinBytes(key);

					if (key != "settings") {
						itemCount = `representing ${keyLength} items`;
					}
					this.add(`Storage used by ${key}: ${this.#bytesToSize(bytesUsed)} ${itemCount}`);
				} catch (error) {
					console.error(`Error retrieving storage data for ${key}: ${error.message}`);
				}
			}
		} catch (error) {
			console.error("Error fetching storage items:", error.message);
		}
	}

	// Helper function to get storage items as a promise
	#getStorageItems() {
		return new Promise((resolve, reject) => {
			chrome.storage.local.get(null, (items) => {
				if (chrome.runtime.lastError) {
					reject(new Error(chrome.runtime.lastError.message));
				} else {
					resolve(items);
				}
			});
		});
	}

	#getStorageKeySizeinBytes(key) {
		return new Promise((resolve, reject) => {
			chrome.storage.local.get(key, function (items) {
				if (chrome.runtime.lastError) {
					reject(new Error(chrome.runtime.lastError.message));
				} else {
					const storageSize = JSON.stringify(items[key]).length;
					resolve(storageSize);
				}
			});
		});
	}

	#getStorageKeyLength(key) {
		return new Promise((resolve, reject) => {
			chrome.storage.local.get(key, (items) => {
				if (chrome.runtime.lastError) {
					reject(new Error(chrome.runtime.lastError.message));
				} else {
					let itemSize;
					if (key == "hiddenItems" || key == "pinnedItems") {
						itemSize = this.#deserialize(items[key]).size;
					} else if (Array.isArray(items[key])) {
						itemSize = items[key].length;
					} else if (items[key] && typeof items[key] === 'object') {
						itemSize = Object.keys(items[key]).length;	// Generic object
					} else {
						itemSize = "n/a";
					}

					resolve(itemSize);
				}
			});
		});
	}
	#deserialize(source) {
		// Accept either a JSON string or an already-parsed obj
		// & conv numeric timestamp-looking values to date objs
		if (!source) return new Map();

		let obj;
		if (typeof source === 'string') {
			try {
				obj = JSON.parse(source);
			} catch (error) {
				return new Map();
			}
		} else if (typeof source === 'object') {
			obj = source;
		} else {
			return new Map();
		}

		return new Map(Object.entries(obj).map(([key, value]) => {
			// Normalize numeric-looking values
			const num = (typeof value === 'number')
				? value
				: (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN);

			if (!Number.isNaN(num)) {
				const absInt = Math.abs(Math.trunc(num));
				const digits = String(absInt).length;
				if (digits <= 10) {
					return [key, new Date(num * 1000)];	// seconds -> ms
				}
				return [key, new Date(num)];			// assuming already in ms
			}

			return [key, value];
		}));
	}
}

export { Logger };
