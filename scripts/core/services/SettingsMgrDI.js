/**
 * Settings Manager with Dependency Injection
 *
 * This is a refactored version of SettingsMgr that:
 * - Uses dependency injection instead of singleton pattern
 * - Accepts a storage adapter for testability
 * - Maintains backward compatibility with existing API
 * - Can be gradually adopted throughout the codebase
 */

// Use relative import for better testability
import { Logger } from "../utils/Logger.js";

export class SettingsMgrDI {
	#storageAdapter;
	#logger;
	#defaultSettings;
	#settings;
	#isLoaded = false;
	#loadPromise;

	constructor(storageAdapter, logger = new Logger()) {
		this.#storageAdapter = storageAdapter;
		this.#logger = logger;
		this.#settings = {};
		this.#getDefaultSettings();

		// Initialize settings on construction
		this.#loadPromise = this.#initializeSettings();
	}

	async #initializeSettings() {
		try {
			await this.#loadSettingsFromStorage();
			this.#isLoaded = true;
			this.#logger.add("SettingsMgr: Settings loaded.");
			return true;
		} catch (error) {
			this.#logger.add(`SettingsMgr: Failed to load settings: ${error.message}`);
			throw error;
		}
	}

	// Return true if the user has a valid premium membership on Patreon
	isPremiumUser(tier = 2) {
		return parseInt(this.get("general.patreon.tier")) >= tier;
	}

	async waitForLoad() {
		return this.#loadPromise;
	}

	isLoaded() {
		return this.#isLoaded;
	}

	async refresh() {
		await this.#loadSettingsFromStorage(true);
	}

	get(settingPath, undefinedReturnDefault = true) {
		let answer = this.#getFromObject(this.#settings, settingPath);

		// If the value is not found in the settings, check if we should return the default value
		if (answer == undefined && undefinedReturnDefault) {
			answer = this.#getFromObject(this.#defaultSettings, settingPath);
		}

		return answer;
	}

	#getFromObject(obj, settingPath) {
		const pathArray = settingPath.split(".");
		return pathArray.reduce((prev, curr) => prev && prev[curr], obj);
	}

	async set(settingPath, value, broadcastChanges = true) {
		// Don't go through the hassle of updating the value if it did not change
		if (this.get(settingPath, false) == value) {
			return false;
		}

		const pathArray = settingPath.split(".");
		const lastKey = pathArray.pop();

		// Traverse the object and create missing intermediate objects if needed
		let current = this.#settings;
		for (let key of pathArray) {
			if (!current[key]) {
				current[key] = {};
			}
			current = current[key];
		}

		// Set the final value
		current[lastKey] = value;

		//console.log(`[${performance.now().toFixed(3)}] SettingsMgr: Setting ${settingPath} to ${value}`);
		await this.#save(broadcastChanges);

		return true;
	}

	async #save(broadcastChanges = true) {
		try {
			await this.#storageAdapter.set("settings", this.#settings);
			//console.log(`[${performance.now().toFixed(3)}] SettingsMgr: Settings saved to storage`);
		} catch (e) {
			// Enhanced error handling for Safari and other browsers
			const isQuotaError =
				e.name === "QuotaExceededError" ||
				(e.message &&
					(e.message.includes("Exceeded storage quota") ||
						e.message.includes("QUOTA_BYTES quota exceeded") ||
						e.message.includes("quota exceeded")));

			if (isQuotaError) {
				this.#logger.add("SettingsMgr: Storage quota exceeded, attempting cleanup...");

				try {
					await this.#storageAdapter.set("hiddenItems", []);
					await this.#save();
				} catch (retryError) {
					this.#logger.add(`SettingsMgr: Storage quota cleanup failed: ${retryError.message}`);
					return false;
				}
			} else {
				// Some other error occurred - log it instead of showing alert
				this.#logger.add(`SettingsMgr: Storage error: ${e.name} - ${e.message}`);
				console.error("SettingsMgr storage error:", e);
				return false;
			}
		}

		//Send a message to the service worker to notify all tabs to refresh the settings

		if (broadcastChanges && this.get("general.syncSettings", false)) {
			try {
				chrome.runtime.sendMessage({ type: "refreshSettings" }, (response) => {
					if (chrome.runtime.lastError) {
						// Service worker is not available or has been terminated
						if (
							chrome.runtime.lastError.message.includes("Could not establish connection") ||
							chrome.runtime.lastError.message.includes("Receiving end does not exist")
						) {
							//Happens when the service worker itself is modifying settings.
							//console.warn("SettingsMgr: Service worker not available, settings updated locally only");
						} else {
							console.error(
								"SettingsMgr: Failed to send message to service worker:",
								chrome.runtime.lastError.message
							);
						}
					}
				});
			} catch (e) {
				// This catch block handles synchronous errors
				console.warn("SettingsMgr: Failed to send message to service worker:", e.message);
			}
		}
		return true;
	}

	async #loadSettingsFromStorage(skipMigration = false) {
		const settings = await this.#storageAdapter.get("settings");

		// If no settings exist already, create the default ones
		if (!settings?.general || Object.keys(settings).length === 0) {
			// Will generate default settings
			try {
				await this.#storageAdapter.clear();
			} catch (error) {
				console.log("SettingsMgr: Failed to clear storage:", error);
			}
			this.#settings = { ...this.#defaultSettings };
			await this.#save();
		} else {
			this.#settings = { ...settings };
		}

		if (!skipMigration) {
			await this.#migrate();
		}
	}

	async #migrate() {
		// V3.5.0 - Remove compiled keywords (no longer needed)
		const generalSettings = this.#settings.general || {};
		let hasCompiledKeywords = false;

		// Check for any compiled keyword keys
		const compiledKeys = ["hideKeywords_compiled", "highlightKeywords_compiled", "blurKeywords_compiled"];
		for (const key of compiledKeys) {
			if (generalSettings[key] !== undefined) {
				delete generalSettings[key];
				hasCompiledKeywords = true;
			}
		}

		if (hasCompiledKeywords) {
			this.#logger.add("SettingsMgr: Removed legacy compiled keywords from storage");
			console.log("SettingsMgr: Removed legacy compiled keywords from storage");
			await this.#save();
		}
	}

	#getDefaultSettings() {
		this.#defaultSettings = {
			unavailableTab: {
				active: true,
			},

			general: {
				bookmark: false,
				bookmarkColor: "#90ee90",
				bookmarkDate: 0,
				blindLoading: false,
				blurKeywords: [],
				unblurImageOnHover: false,
				carousel: {
					active: false,
				},
				country: null,
				customCSS: "",
				detailsIcon: true,
				deviceName: null,
				discoveryFirst: true,
				displayETV: true,
				displayPrice: false,
				displayFirstSeen: true,
				displayFullTitleTooltip: false,
				displayModalETV: false,
				displayVariantIcon: false,
				displayVariantButton: false,
				ETV: {
					modifier: 1,
				},
				fingerprint: null,
				forceCheckoutNewTab: false,
				forceTango: false, //if true, force isTangoEligible to false
				GDPRPopup: true,
				hiddenItemsCacheSize: 4,
				hideCategoriesRFYAFA: false,
				hideKeywords: [],
				hideNoNews: true,
				scrollToRFY: false,
				hideOptOutButton: false,
				hideRecommendations: false,
				hideSideCart: false,
				highlightColor: {
					active: true,
					color: "#FFE815",
					ignore0ETVhighlight: false,
					ignoreUnknownETVhighlight: false,
				},
				highlightKeywords: [],
				highlightKWFirst: true,
				listView: false,
				modalNavigation: false,
				searchOpenModal: false,
				patreon: {
					tier: 0,
				},
				projectedAccountStatistics: false,
				reviewToolbar: true,
				reviewSubmissionMarker: false,
				tileSize: {
					active: true,
					enabled: true,
					fontSize: 14,
					iconSize: 14,
					titleSpacing: 50,
					toolbarFontSize: 10,
					verticalSpacing: 20,
					width: 236,
				},
				topPagination: true,
				toolbarBackgroundColor: "#FFFFFF",
				skipPrimeAd: false,
				syncSettings: false,
				unknownETVHighlight: {
					active: false,
					color: "#FF3366",
				},
				uuid: null,
				verbosePagination: false,
				verbosePaginationStartPadding: 5,
				versionInfoPopup: 0,
				zeroETVHighlight: {
					active: true,
					color: "#64af4b",
				},
				debugTabTitle: false,
				debugPlaceholders: false,
				debugStackTraces: false,
				debugTitleDisplay: false,
				debugMemory: false,
				debugBulkOperations: false,
				debugMemoryAutoSnapshot: false,
				debugKeywords: false,
				debugSettings: false,
				debugStorage: false,
				debugVisibility: false,
				debugTileCounter: false,
				debugSound: false,
				debugDuplicates: false,
				debugItemProcessing: false,
				debugWebsocket: false,
				debugServercom: false,
				debugServiceWorker: false,
				debugCoordination: false,
			},
			metrics: {
				minutesUsed: 0,
			},
			notification: {
				active: false,
				connectionMode: "0",
				hideList: true,
				autoload: {
					min: 2,
					max: 5,
					hourStart: "03:00",
					hourEnd: "17:00",
					speedBoost: 3.0,
				},
				RFYReload: {
					active: false,
					tabId: null,
					last: 0,
				},
				monitor: {
					"24hrsFormat": false,
					displayPrice: false,
					autoTruncate: true,
					autoTruncateLimit: 1000,
					mouseoverPause: false,
					pauseOverlay: false,
					bump0ETV: true,
					carousel: {
						active: false,
					},
					ETV: {
						modifier: 1,
					},
					filterQueue: -1,
					filterType: -1,
					placeholders: true,
					highlight: {
						color: "#FFE815",
						colorActive: true,
						sound: "0",
						volume: 1,
						ignore0ETVhighlight: false,
						ignoreUnknownETVhighlight: false,
					},
					hideAddsToHiddenList: false,
					hideDuplicateThumbnail: false,
					hideGoldNotificationsForSilverUser: false,
					listView: false,
					openLinksInNewTab: "1",
					preventUnload: true,
					regular: {
						sound: "0",
						volume: 1,
					},
					sortType: "date_desc",
					tileSize: {
						fontSize: 14,
						iconSize: 14,
						titleSpacing: 50,
						toolbarFontSize: 10,
						verticalSpacing: 20,
						width: 236,
					},
					unknownETV: {
						color: "#FF3366",
						colorActive: false,
					},
					zeroETV: {
						color: "#64af4b",
						colorActive: true,
						sound: "0",
						volume: 1,
					},
					rfy: {
						color: "#7199FF",
						colorActive: false,
						sound: "0",
						volume: 1,
					},
				},
				pushNotifications: false,
				pushNotificationsAFA: false,
				reduce: false,
				screen: {
					active: false,
					regular: {
						sound: "0",
						volume: 1,
					},
					thumbnail: true,
				},
				soundCooldownDelay: 2000,
			},

			keyBindings: {
				active: true,
				AFAPage: "a",
				AIPage: "i",
				ALLPage: "l",
				debug: "d",
				hideAll: "h",
				nextPage: "n",
				pauseFeed: "f",
				previousPage: "p",
				RFYPage: "r",
				showAll: "s",
			},

			hiddenTab: {
				active: true,
				remote: false,
			},

			pinnedTab: {
				active: true,
				remote: false,
			},

			discord: {
				active: false,
				guid: null,

				webhook: {
					KWsMatch: {
						active: false,
						url: "",
						method: "POST",
						content: `{
"content": "New item in $QUEUE_NAME!",
"embeds": [{
	"title": "$TITLE",
	"url": "$VH_URL",
	"thumbnail":  {
		"url": "$IMG_URL"
	}
}]
}`,
					},
					AFA: {
						active: false,
						url: "",
						method: "POST",
						content: `{
"content": "New item in $QUEUE_NAME!",
"embeds": [{
	"title": "$TITLE",
	"url": "$VH_URL",
	"thumbnail":  {
		"url": "$IMG_URL"
	}
}]
}`,
					},
					RFY: {
						active: false,
						url: "",
						method: "POST",
						content: `{
"content": "New item in $QUEUE_NAME!",
"embeds": [{
	"title": "$TITLE",
	"url": "$VH_URL",
	"thumbnail":  {
		"url": "$IMG_URL"
	}
}]
}`,
					},
					zeroETV: {
						active: false,
						url: "",
						method: "POST",
						content: `{
"content": "0 ETV item in $QUEUE_NAME!",
"embeds": [{
	"title": "$TITLE",
	"url": "$VH_URL",
	"thumbnail":  {
		"url": "$IMG_URL"
	}
}]
}`,
					},
				},
			},

			thorvarium: {
				categoriesWithEmojis: false,
				collapsableCategories: false,
				ETVModalOnTop: false,
				limitedQuantityIcon: false,
				mediumItems: true,
				mobileandroid: false,
				mobileios: false,
				moreDescriptionText: false,
				paginationOnTop: false,
				removeAssociateHeader: false,
				removeFooter: false,
				removeHeader: false,
				RFYAFAAITabs: false,
				smallItems: false,
				stripedCategories: false,
			},
		};
	}
}
