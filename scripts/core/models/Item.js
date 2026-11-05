// Last compiled at 2026-11-05_1508
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
import { Internationalization } from "../services/Internationalization.js";

/**
 * This class represents a Vine item.
 * It is used as a data packet to send between various internal components of VineSmyths.
 * The goal is to enforce a standardized item throughout internal communications.
 *
 * Note: Is is not always filled completely depending on the context and the required information.
 * But at minimum, each item has to contain: ASIN, queue, is_parent_asin and enrollment_guid.
 */
class Item {
	data = {};
	i13nMgr = new Internationalization();
	constructor(coreAttributes) {
		// Validate input exists
		if (!coreAttributes) {
			console.error("[Item] Constructor called with invalid data");
			throw new Error("Item constructor requires data object");
		}

		// Validate required fields
		const requiredFields = {
			asin: coreAttributes.asin,
			queue: coreAttributes.queue,
			is_parent_asin: coreAttributes.is_parent_asin,
			enrollment_guid: coreAttributes.enrollment_guid,
		};

		const missingFields = Object.entries(requiredFields)
			.filter(([, value]) => value === undefined)
			.map(([field]) => field);

		if (missingFields.length > 0) {
			console.error(`[Item] Missing required fields: ${missingFields.join(", ")}`, coreAttributes);
			throw new Error(`Missing required fields: ${missingFields.join(", ")}`);
		}

		// Core information
		this.data.asin = coreAttributes.asin;
		this.data.queue = coreAttributes.queue;
		this.data.is_parent_asin =
			coreAttributes.is_parent_asin === true || coreAttributes.is_parent_asin === "true" ? true : false;
		this.data.is_pre_release =
			coreAttributes.is_pre_release === true || coreAttributes.is_pre_release === "true" ? true : false; //Default to false if undefined
		this.data.enrollment_guid = coreAttributes.enrollment_guid;

		//Optional data
		this.data.title = coreAttributes.title;
		this.data.img_url = coreAttributes.img_url; //Thumbnail
		this.data.etv_min = coreAttributes.etv_min || null;
		this.data.etv_max = coreAttributes.etv_max || null;
		this.data.price = coreAttributes.price || null;
		this.data.search = coreAttributes.search; //Search string based on the title
		this.data.tier = coreAttributes.tier; //Lowest tier known to have seen the item
		this.data.date = coreAttributes.date; //Date the item was transmitted
		this.data.date_added = coreAttributes.date_added; //Date the item was added to server
		this.data.KW = coreAttributes.KW; //The keyword we matched
		this.data.KWsMatch = coreAttributes.KWsMatch; //Do we match a highlight keyword?
		this.data.BlurKW = coreAttributes.BlurKW; //The keyword we matched
		this.data.BlurKWsMatch = coreAttributes.BlurKWsMatch; //Do we match a blur keyword?
		this.data.unavailable = coreAttributes.unavailable; //Is the item unavailable?
		this.data.timestamp = coreAttributes.timestamp; //Timestamp of the item (? from the stream processing)
		this.data.variants = coreAttributes.variants; //Variants of the item (?useful?)
		this.data.variant_asin = coreAttributes.variant_asin; //If we are trying to open a variant ASIN, this extra field will be added to the item as both the parent and the variant ASIN are needed.
		this.data.additional_img = coreAttributes.additional_img || []; //Additional images for the item
	}

	//Setters
	setTitle(title) {
		this.data.title = title;
	}
	setPrice(price) {
		this.data.price = price;
	}
	setAdditionalImages(additional_img) {
		this.data.additional_img = additional_img;
	}
	setImgUrl(img_url) {
		this.data.img_url = img_url;
	}
	setEtvMin(etv_min) {
		this.data.etv_min = etv_min;
	}
	setEtvMax(etv_max) {
		this.data.etv_max = etv_max;
	}
	setSearch(search) {
		this.data.search = search;
	}
	setTier(tier) {
		this.data.tier = tier;
	}
	setVariants(variants) {
		this.data.variants = variants;
	}
	setUnavailable(unavailable) {
		this.data.unavailable = unavailable;
	}
	setDate(date) {
		this.data.date = date;
	}
	setDateAdded(date_added) {
		this.data.date_added = date_added;
	}
	setKW(KW) {
		this.data.KW = KW;
	}
	setKWsMatch(KWsMatch) {
		this.data.KWsMatch = KWsMatch;
	}
	setBlurKW(BlurKW) {
		this.data.BlurKW = BlurKW;
	}
	setBlurKWsMatch(BlurKWsMatch) {
		this.data.BlurKWsMatch = BlurKWsMatch;
	}
	setTimestamp(timestamp) {
		this.data.timestamp = timestamp;
	}

	//Getters
	getCoreInfo() {
		return {
			asin: this.data.asin,
			queue: this.data.queue,
			is_parent_asin: this.data.is_parent_asin,
			is_pre_release: this.data.is_pre_release,
			enrollment_guid: this.data.enrollment_guid,
		};
	}

	getCoreInfoWithVariant() {
		return {
			...this.getCoreInfo(),
			variant_asin: this.data.variant_asin,
		};
	}

	getAllInfo() {
		return {
			...this.data,
		};
	}

	getRecommendationType() {
		const recommendationTypes = {
			potluck: "VENDOR_TARGETED",
			last_chance: "VENDOR_VINE_FOR_ALL",
			encore: "VINE_FOR_ALL",
			all_items: "ALL_ITEMS",
		};

		return recommendationTypes[this.data.queue] || null;
	}

	getRecommendationString(env) {
		if (this.getRecommendationType() == "VENDOR_TARGETED") {
			return (
				env.getMarketplaceId() +
				"#" +
				this.data.asin +
				"#" +
				env.getCustomerId() +
				"#vine.enrollment." +
				this.data.enrollment_guid
			);
		}
		return env.getMarketplaceId() + "#" + this.data.asin + "#vine.enrollment." + this.data.enrollment_guid;
	}

	static guessQueueFromRecommendationId(recommendationId) {
		const numHashes = (recommendationId.match(/#/g) || []).length;
		if (numHashes == 2) {
			return "encore";
		} else if (numHashes == 3) {
			return "potluck";
		}
	}
	static getEnrollmentGuidFromRecommendationId(recommendationId) {
		return recommendationId.split("#vine.enrollment.")[1];
	}

	/**
	 * Return the queue name based on the recommendationType and the recommendationId
	 * @param {string} recommendationType VINE_FOR_ALL, VENDOR_VINE_FOR_ALL, VENDOR_TARGETED, SEARCH, ALL_ITEMS
	 * @param {string} recommendationId The recommendationId of the item
	 * @returns The queue name
	 */
	static getQueueFromData(recommendationType, recommendationId) {
		if (recommendationType == "SEARCH") {
			return Item.guessQueueFromRecommendationId(recommendationId);
		} else {
			const queueNames = {
				VINE_FOR_ALL: "encore",
				VENDOR_VINE_FOR_ALL: "last_chance",
				VENDOR_TARGETED: "potluck",
				ALL_ITEMS: "all_items",
			};
			return queueNames[recommendationType];
		}
	}

	getAmazonURL() {
		return `https://www.amazon.${this.i13nMgr.getDomainTLD()}/dp/${this.data.asin}`;
	}

	getVineSearchURL(search) {
		search = search || this.data.search;
		return `https://www.amazon.${this.i13nMgr.getDomainTLD()}/vine/vine-items?search=${encodeURIComponent(search)}`;
	}

	getVHOpenModalURL(withVariant = false) {
		const modalInfo = withVariant ? this.getCoreInfoWithVariant() : this.getCoreInfo();
		const queryparams = this.data.search ? `search=${encodeURIComponent(this.data.search)}` : "queue=encore";
		return `https://www.amazon.${this.i13nMgr.getDomainTLD()}/vine/vine-items?${queryparams}#openModal;${encodeURIComponent(JSON.stringify(modalInfo))}`;
	}
}

const WITH_VARIANT = true;

export { Item, WITH_VARIANT };
