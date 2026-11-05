/*global chrome*/

import { Streamy } from "../../core/utils/Streamy.js";
import { compileKeywordObjects } from "../../core/utils/KeywordCompiler.js";
import { findMatch } from "../../core/utils/KeywordMatcher.js";
import { SettingsMgr } from "../../core/services/SettingsMgrCompat.js";
import { Item } from "../../core/models/Item.js";
import { YMDHiStoISODate, DateToUnixTimeStamp } from "../../core/utils/DateHelper.js";
import { WebhookQueue } from "./WebhookQueue.js";
import { Internationalization } from "../../core/services/Internationalization.js";
import { removeSpecialHTML } from "../../core/utils/StringHelper.js";

/**
 * NewItemStreamProcessing handles real-time item processing with keyword matching.
 *
 * This class uses the simplified KeywordCompiler/KeywordMatcher pattern where:
 * - Keywords are compiled once on initialization
 * - Keywords are recompiled when settings change
 * - No complex caching logic is needed
 */
class NewItemStreamProcessing {
	constructor(settingsManager = null, monitor = null) {
		this.settingsManager = settingsManager || new SettingsMgr();
		this.monitor = monitor;
		this.webhookQueue = new WebhookQueue(this.settingsManager);
		this.dataStream = new Streamy();

		this.outputFunctions = {
			broadcast: () => {},
			push: () => {},
		};

		// Compiled keywords - compiled once and reused
		this.compiledHideKeywords = null;
		this.compiledHighlightKeywords = null;
		this.compiledBlurKeywords = null;

		// Settings that affect behavior
		this.hideListEnabled = false;
		this.pushNotifications = false;
		this.pushNotificationsAFA = false;

		// Diagnostic: Track processing counts per ASIN
		this.processingCounts = new Map();

		this.setupPipeline();
		this.initialize();
	}

	async initialize() {
		this.i13nMgr = new Internationalization();
		const countryCode = this.settingsManager.get("general.country");
		if (countryCode != null) {
			this.i13nMgr.setCountryCode(countryCode);
		}
		await this.compileKeywords();
	}

	async compileKeywords() {
		await this.settingsManager.waitForLoad();

		// Get keywords from settings - all should be arrays
		const hideKeywords = this.settingsManager.get("general.hideKeywords") || [];
		const highlightKeywords = this.settingsManager.get("general.highlightKeywords") || [];
		const blurKeywordsRaw = this.settingsManager.get("general.blurKeywords") || [];

		// Convert blur keywords array to keyword objects
		const blurKeywords = Array.isArray(blurKeywordsRaw)
			? blurKeywordsRaw.filter((kw) => kw && kw.length > 0).map((kw) => ({ contains: kw }))
			: [];

		// Debug logging for keyword loading
		if (this.settingsManager.get("general.debugKeywords")) {
			console.log("[NewItemStreamProcessing] Loading keywords from settings:", {
				highlightKeywordsRaw: highlightKeywords,
				blurKeywordsRaw: blurKeywordsRaw,
				blurKeywordsParsed: blurKeywords,
				highlightCount: highlightKeywords.length,
				blurCount: blurKeywords.length,
				timestamp: Date.now(),
			});
		}

		// Compile keywords into arrays of compiled keyword objects
		this.compiledHideKeywords = hideKeywords.length > 0 ? compileKeywordObjects(hideKeywords) : null;
		this.compiledHighlightKeywords = highlightKeywords.length > 0 ? compileKeywordObjects(highlightKeywords) : null;
		this.compiledBlurKeywords = blurKeywords.length > 0 ? compileKeywordObjects(blurKeywords) : null;

		// Update behavior settings
		this.hideListEnabled = this.settingsManager.get("notification.hideList");
		this.pushNotifications = this.settingsManager.get("notification.pushNotifications");
		this.pushNotificationsAFA = this.settingsManager.get("notification.pushNotificationsAFA");

		this.webhookKWsMatchEnabled = this.settingsManager.get("discord.webhook.KWsMatch.active");
		this.webhookKWsMatchUrl = this.settingsManager.get("discord.webhook.KWsMatch.url");
		this.webhookAFAEnabled = this.settingsManager.get("discord.webhook.AFA.active");
		this.webhookAFAUrl = this.settingsManager.get("discord.webhook.AFA.url");
		this.webhookRFYEnabled = this.settingsManager.get("discord.webhook.RFY.active");
		this.webhookRFYUrl = this.settingsManager.get("discord.webhook.RFY.url");

		// Debug logging
		if (this.settingsManager.get("general.debugKeywords")) {
			console.log("[NewItemStreamProcessing] Keywords compiled:", {
				hideKeywordsCount: hideKeywords.length,
				highlightKeywordsCount: highlightKeywords.length,
				blurKeywordsCount: blurKeywords.length,
				timestamp: Date.now(),
			});
		}
	}

	//#####################################################
	//## PIPELINE
	//#####################################################

	filterHideItem(rawData) {
		if (!rawData.item) {
			return true; //Skip this filter
		}
		const data = rawData.item.data;
		if (data.title === undefined) {
			return true; //Skip this filter
		}

		// KEYWORD PRIORITY: Only check hide keywords if the item is NOT highlighted
		// This ensures highlight keywords take precedence over hide keywords
		if (this.hideListEnabled && !data.KWsMatch && this.compiledHideKeywords) {
			const hideKeyword = findMatch(data.title, this.compiledHideKeywords, data.etv_min, data.etv_max);
			if (hideKeyword !== null) {
				if (this.settingsManager.get("general.debugKeywords")) {
					console.log("[NewItemStreamProcessing] Item hidden by keyword:", {
						asin: data.asin,
						title: data.title,
						keyword: hideKeyword?.contains ?? "",
						timestamp: Date.now(),
					});
				}
				return false; //Do not display the notification as it matches the hide list.
			}
		}
		return true;
	}

	transformIsHighlight(rawData) {
		if (!rawData.item) {
			return rawData; //Skip this transformer
		}
		const data = rawData.item.data;

		if (data.title === undefined) {
			return rawData; //Skip this transformer if no title
		}

		// Diagnostic logging for duplicate processing
		if (this.settingsManager.get("general.debugDuplicates")) {
			const timestamp = Date.now();
			const asin = data.asin;

			// Track processing count
			const currentCount = this.processingCounts.get(asin) || 0;
			this.processingCounts.set(asin, currentCount + 1);

			if (this.settingsManager.get("general.debugKeywords")) {
				console.log("[NewItemStreamProcessing] transformIsHighlight called:", {
					asin: asin,
					title: data.title?.substring(0, 50) + "...",
					enrollment_guid: data.enrollment_guid,
					processingCount: currentCount + 1,
					isDuplicate: currentCount > 0,
					timestamp,
					timestampMs: timestamp,
					reason: rawData.reason || "no reason",
					callStack: new Error().stack.split("\n").slice(2, 5).join(" <- "),
				});
			}

			// Warn if this is a duplicate processing
			if (currentCount > 0) {
				console.warn(
					`[NewItemStreamProcessing] DUPLICATE PROCESSING DETECTED for ASIN ${asin} - processed ${currentCount + 1} times`,
					{
						enrollment_guid: data.enrollment_guid,
						reason: rawData.reason,
						timestamp: new Date().toISOString(),
					}
				);
			}
		}

		// Check highlight keywords using the compiled keywords
		if (this.compiledHighlightKeywords) {
			const matchedKeyword = findMatch(data.title, this.compiledHighlightKeywords, data.etv_min, data.etv_max);
			rawData.item.data.KWsMatch = matchedKeyword !== null;
			rawData.item.data.KW = matchedKeyword?.contains ?? "";

			if (matchedKeyword && this.settingsManager.get("general.debugKeywords")) {
				console.log("[NewItemStreamProcessing] Item highlighted by keyword:", {
					asin: data.asin,
					title: data.title,
					keyword: matchedKeyword,
					timestamp: Date.now(),
				});
			}
		} else {
			rawData.item.data.KWsMatch = false;
			rawData.item.data.KW = false;
		}

		return rawData;
	}

	transformIsBlur(rawData) {
		// Always log entry to this transformer when debugging
		if (this.settingsManager.get("general.debugKeywords")) {
			console.log("[NewItemStreamProcessing] transformIsBlur called:", {
				hasItem: !!rawData.item,
				hasData: !!rawData.item?.data,
				hasTitle: !!rawData.item?.data?.title,
				asin: rawData.item?.data?.asin,
				titlePreview: rawData.item?.data?.title?.substring(0, 50) + "...",
				timestamp: Date.now(),
			});
		}

		if (!rawData.item) {
			return rawData; //Skip this transformer
		}
		const data = rawData.item.data;
		if (data.title == undefined) {
			return rawData; //Skip this transformer
		}

		// Check blur keywords using the compiled keywords
		if (this.compiledBlurKeywords) {
			const blurKeyword = findMatch(data.title, this.compiledBlurKeywords);
			rawData.item.data.BlurKWsMatch = blurKeyword !== null;
			rawData.item.data.BlurKW = blurKeyword?.contains ?? "";

			// Debug logging for blur keyword matching
			if (this.settingsManager.get("general.debugKeywords")) {
				console.log("[NewItemStreamProcessing] Blur keyword check:", {
					asin: data.asin,
					title: data.title,
					compiledBlurKeywords: this.compiledBlurKeywords,
					blurKeywordFound: blurKeyword,
					BlurKWsMatch: rawData.item.data.BlurKWsMatch,
					BlurKW: rawData.item.data.BlurKW,
					timestamp: Date.now(),
				});
			}
		} else {
			rawData.item.data.BlurKWsMatch = false;
			rawData.item.data.BlurKW = false;

			if (this.settingsManager.get("general.debugKeywords")) {
				console.log("[NewItemStreamProcessing] No blur keywords configured");
			}
		}

		return rawData;
	}

	transformSearchPhrase(rawData) {
		if (!rawData.item) {
			return rawData; //Skip this transformer
		}
		const data = rawData.item.data;
		if (data.title == undefined) {
			return rawData; //Skip this transformer
		}

		// Extract search phrase by taking only words that contain only letters and numbers
		// Split by spaces and filter out words with special characters
		/*
		const words = data.title.split(/\s+/);
		const cleanWords = words.filter((word) => /^[a-zA-Z0-9]+$/.test(word));
		const truncatedTitle = cleanWords.slice(0, 6).join(" ").substring(0, 40).trim();
		*/
		let truncatedTitle =
			data.title.length > 40 ? data.title.substr(0, 40).split(" ").slice(0, -1).join(" ") : data.title;
		truncatedTitle = removeSpecialHTML(truncatedTitle);
		//Remove single letter words
		truncatedTitle = truncatedTitle
			.split(" ")
			.filter((word) => word.length > 1)
			.join(" ");

		rawData.item.data.search = truncatedTitle;
		return rawData;
	}

	transformUnixTimestamp(rawData) {
		if (!rawData.item) {
			return rawData; //Skip this transformer
		}
		const data = rawData.item.data;
		rawData.item.data.timestamp = this.dateToUnixTimestamp(data.date);
		return rawData;
	}

	transformPostNotification(rawData) {
		if (!rawData.item || !this.monitor || !this.monitor._isMasterMonitor) {
			return rawData; //Skip this transformer
		}
		const data = rawData.item.data;
		if (data.asin == undefined) {
			return rawData; //Skip this transformer
		}

		//If the new item match a highlight keyword, push a real notification.
		const KWNotification = this.pushNotifications && data.KWsMatch;
		const AFANotification = this.pushNotificationsAFA && data.queue == "last_chance";

		if (KWNotification || AFANotification) {
			//Create a new clean item with just the info needed to display the notification
			const item = new Item({
				asin: data.asin,
				queue: data.queue,
				is_parent_asin: data.is_parent_asin,
				is_pre_release: data.is_pre_release,
				enrollment_guid: data.enrollment_guid,
			});
			item.setTitle(data.title);
			item.setImgUrl(data.img_url);
			item.setSearch(data.search);

			if (KWNotification) {
				// Debug logging for OS notification triggered by keyword match
				if (this.settingsManager.get("general.debugKeywords")) {
					console.log("[NewItemStreamProcessing] OS notification triggered for keyword match:", {
						asin: data.asin,
						title: data.title,
						keyword: data.KW,
						KWsMatch: data.KWsMatch,
						timestamp: new Date().toISOString(),
					});
				}
				this.outputFunctions.push("Vine Helper - New item match KW!", item);
			} else if (AFANotification) {
				this.outputFunctions.push("Vine Helper - New AFA item", item);
			}
		}
		return rawData;
	}

	transformWebhook(rawData) {
		if (!rawData.item || rawData.fetchLatest || !this.monitor || !this.monitor._isMasterMonitor) {
			return rawData; //Skip this transformer
		}
		const data = rawData.item.data;
		const webhookKW = this.webhookKWsMatchEnabled && data.KWsMatch;
		const webhookAFA = this.webhookAFAEnabled && data.queue == "last_chance";
		const webhookRFY = this.webhookRFYEnabled && data.queue == "potluck";

		if (!webhookKW && !webhookAFA && !webhookRFY) {
			return rawData; //Skip this transformer
		}

		//Generate Vine Helper's URL to open the item
		const item = new Item(data);
		const VH_URL = item.getVHOpenModalURL();
		const VINE_SEARCH_URL = item.getVineSearchURL();
		const AMZ_URL = item.getAmazonURL();

		//Convert the queue (ie.: potluck, encore, last_chance, all_items) to the common abbreviation (ie.: RFY, AI, AFA, ALL)
		const QUEUE_NAME = queueToAbbr(data.queue);
		const TITLE = data.title;
		const IMG_URL = data.img_url;
		const ASIN = data.asin;

		//JSON data
		let body;
		const baseBody = `{
			"content": "New item in $QUEUE_NAME!",
			"embeds": [
				{
					"title": "$TITLE",
					"url": "$VH_URL",
					"thumbnail":  {
						"url": "$IMG_URL"
					}
				}
			]
		}`;

		if (webhookKW) {
			if (this.settingsManager.isPremiumUser(3)) {
				body = this.settingsManager.get("discord.webhook.KWsMatch.content");
			} else {
				body = baseBody;
			}
			body = body.replaceAll("$QUEUE_NAME", QUEUE_NAME);
			body = body.replaceAll("$TITLE", TITLE);
			body = body.replaceAll("$IMG_URL", IMG_URL);
			body = body.replaceAll("$ASIN", ASIN);
			body = body.replaceAll("$VH_URL", VH_URL);
			body = body.replaceAll("$VINE_SEARCH_URL", VINE_SEARCH_URL);
			body = body.replaceAll("$AMZ_URL", AMZ_URL);

			//Send the data to the webhook
			this.webhookQueue.queue(this.webhookKWsMatchUrl, {
				method: this.settingsManager.isPremiumUser(3)
					? this.settingsManager.get("discord.webhook.KWsMatch.method")
					: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: body,
			});
		}
		if (webhookAFA) {
			if (this.settingsManager.isPremiumUser(3)) {
				body = this.settingsManager.get("discord.webhook.AFA.content");
			} else {
				body = baseBody;
			}
			body = body.replaceAll("$QUEUE_NAME", QUEUE_NAME);
			body = body.replaceAll("$TITLE", TITLE);
			body = body.replaceAll("$IMG_URL", IMG_URL);
			body = body.replaceAll("$ASIN", ASIN);
			body = body.replaceAll("$VH_URL", VH_URL);
			body = body.replaceAll("$VINE_SEARCH_URL", VINE_SEARCH_URL);
			body = body.replaceAll("$AMZ_URL", AMZ_URL);

			//Send the data to the webhook
			this.webhookQueue.queue(this.webhookAFAUrl, {
				method: this.settingsManager.isPremiumUser(3)
					? this.settingsManager.get("discord.webhook.AFA.method")
					: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: body,
			});
		}
		if (webhookRFY) {
			if (this.settingsManager.isPremiumUser(3)) {
				body = this.settingsManager.get("discord.webhook.RFY.content");
			} else {
				body = baseBody;
			}
			body = body.replaceAll("$QUEUE_NAME", QUEUE_NAME);
			body = body.replaceAll("$TITLE", TITLE);
			body = body.replaceAll("$IMG_URL", IMG_URL);
			body = body.replaceAll("$ASIN", ASIN);
			body = body.replaceAll("$VH_URL", VH_URL);
			body = body.replaceAll("$VINE_SEARCH_URL", VINE_SEARCH_URL);
			body = body.replaceAll("$AMZ_URL", AMZ_URL);

			//Send the data to the webhook
			this.webhookQueue.queue(this.webhookRFYUrl, {
				method: this.settingsManager.isPremiumUser(3)
					? this.settingsManager.get("discord.webhook.RFY.method")
					: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: body,
			});
		}
		return rawData;
	}

	setupPipeline() {
		const filterHideitem = this.dataStream.filter((rawData) => this.filterHideItem(rawData));
		const transformIsHighlight = this.dataStream.transformer((rawData) => this.transformIsHighlight(rawData));
		const transformIsBlur = this.dataStream.transformer((rawData) => this.transformIsBlur(rawData));
		const transformSearchPhrase = this.dataStream.transformer((rawData) => this.transformSearchPhrase(rawData));
		const transformUnixTimestamp = this.dataStream.transformer((rawData) => this.transformUnixTimestamp(rawData));
		const transformPostNotification = this.dataStream.transformer((rawData) =>
			this.transformPostNotification(rawData)
		);
		const transformWebhook = this.dataStream.transformer((rawData) => this.transformWebhook(rawData));

		this.dataStream
			.pipe(transformIsHighlight) //Highlight keywords first...
			.pipe(filterHideitem) // ... then figure out if we can hide the item
			.pipe(transformIsBlur)
			.pipe(transformSearchPhrase)
			.pipe(transformUnixTimestamp)
			.pipe(transformPostNotification)
			.pipe(transformWebhook)
			.output((data) => {
				//Broadcast the notification
				this.outputFunctions.broadcast(data, "notification");
			});
	}

	dateToUnixTimestamp(dateString) {
		// Use the proper date parsing utilities instead of Safari-incompatible string concatenation
		const date = YMDHiStoISODate(dateString);
		return DateToUnixTimeStamp(date);
	}

	setBroadcastFunction(fct) {
		this.outputFunctions.broadcast = fct;
	}

	setNotificationPushFunction(fct) {
		this.outputFunctions.push = fct;
	}

	input(data) {
		// Diagnostic logging for stream input
		if (this.settingsManager.get("general.debugKeywords") && data.item) {
			const timestamp = Date.now();
			console.log("[NewItemStreamProcessing] Stream input received:", {
				asin: data.item.data?.asin,
				title: data.item.data?.title?.substring(0, 50) + "...",
				type: data.type,
				reason: data.reason,
				timestamp,
				timestampMs: timestamp,
			});
		}
		this.dataStream.input(data);
	}

	// Expose compiled keywords for testing
	getCompiledKeywords() {
		return {
			hideKeywords: this.compiledHideKeywords,
			highlightKeywords: this.compiledHighlightKeywords,
			blurKeywords: this.compiledBlurKeywords,
		};
	}
}

function queueToAbbr(queue) {
	const arr = {
		potluck: "RFY",
		encore: "AI",
		last_chance: "AFA",
		all_items: "ALL",
	};

	return arr[queue];
}

export { NewItemStreamProcessing };
