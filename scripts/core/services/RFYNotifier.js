import { Environment } from "/scripts/core/services/Environment.js";
import { CryptoKeys } from "/scripts/core/utils/CryptoKeys.js";
const cryptoKeys = new CryptoKeys();

var env = new Environment();

class RFYNotifier {
	static #arrItems = {};
	static #channel = new BroadcastChannel("vinehelper-notification-monitor");

	constructor() {
		throw new Error("This is a static class, do not instantiate it.");
	}

	static async syncRFYPageData(items) {
		//Empty the array of items before adding the new items
		RFYNotifier.#arrItems = {};
		for (const item of items) {
			RFYNotifier.#arrItems[item.asin] = {
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

	static async syncRFYServerData(items) {
		//Add the data from the server to the array of items
		for (const [key, values] of Object.entries(items)) {
			if (!RFYNotifier.#arrItems[key]) {
				console.warn(`Key ${key} not found in #arrItems, skipping`);
				continue;
			}
			RFYNotifier.#arrItems[key].etv_min = values.etv_min;
			RFYNotifier.#arrItems[key].etv_max = values.etv_max;
			RFYNotifier.#arrItems[key].date_added = values.date_added;
			RFYNotifier.#arrItems[key].discovered = values.discovered;
			RFYNotifier.#arrItems[key].hidden = values.hidden;
			RFYNotifier.#arrItems[key].variants = values.variants;
			RFYNotifier.#arrItems[key].order_success = values.order_success;
			RFYNotifier.#arrItems[key].order_failed = values.order_failed;
			RFYNotifier.#arrItems[key].order_unavailable = values.order_unavailable;
			RFYNotifier.#arrItems[key].price = values.price;
			RFYNotifier.#arrItems[key].additional_img = values.additional_img;
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
			if (!RFYNotifier.#arrItems[asin]) {
				delete potluckItems[asin];
			}
		}

		for (const [asin, item] of Object.entries(RFYNotifier.#arrItems)) {
			//If the item did not exist in the potluckItems, add it to the potluckItems.
			if (!potluckItems[asin]) {
				potluckItems[asin] = item;

				//Build a data packet to be injected in serverCom as a new item
				const data = {
					type: "newPreprocessedItem",
					item: {
						asin: asin,
						reason: "new item in RFY (manual load)",
						etv_min: item.etv_min,
						etv_max: item.etv_max,
						tier: env.getTierLevel(),
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
				RFYNotifier.#channel.postMessage(await cryptoKeys.encryptJSON(data));
			}
		}

		//Save the potluckItems to local storage
		chrome.storage.local.set({ ["potluckItems"]: potluckItems });
	}
}

export { RFYNotifier };
