// Last compiled at 2026-11-05_0209
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
import { SettingsMgr } from "/scripts/core/services/SettingsMgrCompat.js";
const Settings = new SettingsMgr();

import { Internationalization } from "/scripts/core/services/Internationalization.js";
const i13n = new Internationalization();

import { validateWebhookUrl } from "/scripts/core/utils/WebhookUtil.js";
import { pickFolder, requestFolderPermission } from "/scripts/background/FolderSync.js";
import { recordListChange, requestSync } from "/scripts/core/services/SyncState.js";
import { normaliseListMap, restoreLocalOnly } from "/scripts/core/utils/SyncMerge.js";

/**
 * Replace a stored hidden/pinned list from the settings page (import / delete-all) the way the folder sync
 * expects: what disappeared gets a removal record, what appeared loses any older one. Without this the
 * next sync would quietly restore the old list from the shared file.
 */
async function replaceStoredList(kind, storageKey, incoming) {
	const prev = Object.keys(normaliseListMap((await chrome.storage.local.get(storageKey))[storageKey], kind));
	const next = normaliseListMap(incoming, kind);
	const nextKeys = Object.keys(next);
	const nextSet = new Set(nextKeys);
	await recordListChange(
		kind,
		prev.filter((a) => !nextSet.has(a)),
		nextKeys
	);
	await chrome.storage.local.set({ [storageKey]: next });
	requestSync(0);
}

import { compileKeywordObjects } from "/scripts/core/utils/KeywordCompiler.js";

import { isSafari } from "/scripts/core/utils/BrowserDetection.js";

//If "refreshSettings" is received, reload the settings and redraw.
//NOT an async function and never answers: an async listener returns a Promise, which Chromium treats as an
//immediate reply of `undefined`, stealing the answer meant for the service worker (e.g. the folder sync's
//result) whenever a settings tab or the toolbar popup happens to be open.
chrome.runtime.onMessage.addListener((request) => {
	if (request.type == "refreshSettings") {
		Settings.refresh()
			.then(() => initiateSettings(false)) //Redraw the settings page
			.catch((e) => console.error("[Settings] refresh failed", e));
	}
	return false;
});
function drawDiscord() {
	//Show or hide the discord options
	const opts = document.querySelector("#discordOptions");
	if (opts) opts.style.display = Settings.get("discord.active") ? "block" : "none";

	//Show whether each webhook URL is acceptable (only discord.com webhooks are)
	const types = ["default", "KWsMatch", "AFA", "RFY", "zeroETV", "manual"];
	for (const t of types) {
		const input = document.querySelector(`input[name='discord.webhook.${t}.url']`);
		const out = document.getElementById(`discordUrlStatus-${t}`);
		if (!input || !out) continue;
		const v = input.value.trim();
		if (v === "") {
			out.textContent = t === "default" ? "No default URL set." : "";
			out.style.color = "";
		} else {
			const r = validateWebhookUrl(v);
			out.textContent = r.ok ? "URL looks valid." : "URL not accepted: " + r.reason;
			out.style.color = r.ok ? "#2a7d2a" : "#c33";
		}
	}
}

async function initiateSettings(firstRun = false) {
	//Wait for the settings to be loaded.
	await Settings.waitForLoad();

	//If the browser is firefox, replace all the input[type="color"] with input[type="text"]
	if (navigator.userAgent.includes("Firefox") && typeof window.popupView !== "undefined") {
		document.querySelectorAll("input[type='color']").forEach(function (item) {
			item.type = "text";
		});
	}

	drawDiscord();

	document.getElementById("settingsLink").href = chrome.runtime.getURL("page/settings.html");

	//###################
	//#### UI interaction

	//When a checkbox in the legend of a fieldset if changed,
	//enable or disable all the field contained in that fieldset.
	document.querySelectorAll("fieldset").forEach((fieldset) => {
		const checkbox = fieldset.querySelector(':scope > legend input[type="checkbox"]');

		if (checkbox) {
			// Function to enable/disable the fieldset contents
			const toggleFieldsetContent = () => {
				const isChecked = checkbox.checked;
				const elements = fieldset.querySelectorAll("input, select, button, textarea");

				elements.forEach((element) => {
					// Skip the checkbox itself in the legend
					if (element !== checkbox) {
						const shouldDisable = !isChecked;
						element.disabled = shouldDisable;
					}
				});
			};

			// Add the event listener to the checkbox
			// Store event listener reference to prevent duplicates
			if (!checkbox._vineHelperToggleHandler) {
				checkbox._vineHelperToggleHandler = toggleFieldsetContent;
				checkbox.addEventListener("change", checkbox._vineHelperToggleHandler);
			}

			// Initial state check
			toggleFieldsetContent();
		}
	});

	//###################
	//## Load/save settings:

	//## TAB - GENERAL

	manageCheckboxSetting("general.topPagination");
	manageCheckboxSetting("general.verbosePagination");
	manageCheckboxSetting("general.detailsIcon");
	manageCheckboxSetting("general.displayETV");
	manageCheckboxSetting("general.displayPrice");
	manageCheckboxSetting("general.carousel.active");
	manageCheckboxSetting("general.displayModalETV");
	manageCheckboxSetting("general.displayFullTitleTooltip");
	manageCheckboxSetting("general.displayVariantIcon");
	manageCheckboxSetting("general.displayVariantButton");
	manageCheckboxSetting("general.displayFirstSeen");
	manageCheckboxSetting("general.bookmark");
	manageCheckboxSetting("hiddenTab.active");
	manageCheckboxSetting("hiddenTab.scrollToRFY", false);
	manageCheckboxSetting("pinnedTab.active");
	manageCheckboxSetting("unavailableTab.active");
	manageCheckboxSetting("general.modalNavigation");
	manageCheckboxSetting("general.searchOpenModal");
	manageCheckboxSetting("general.listView");
	manageCheckboxSetting("general.forceTango");
	manageCheckboxSetting("general.forceCheckoutNewTab");
	manageCheckboxSetting("general.scrollToRFY");
	manageCheckboxSetting("general.hideOptOutButton");
	manageCheckboxSetting("general.hideRecommendations");
	manageCheckboxSetting("general.hideSideCart");
	manageCheckboxSetting("general.hideCategoriesRFYAFA");
	manageCheckboxSetting("general.reviewToolbar");
	manageCheckboxSetting("general.reviewSubmissionMarker");
	manageCheckboxSetting("general.hideNoNews");
	manageCheckboxSetting("general.tileSize.enabled");
	manageCheckboxSetting("general.tileSize.active");
	manageCheckboxSetting("general.projectedAccountStatistics");
	manageCheckboxSetting("general.discoveryFirst");
	manageCheckboxSetting("general.blindLoading");
	manageCheckboxSetting("general.skipPrimeAd");
	manageCheckboxSetting("general.syncSettings");
	manageCheckboxSetting("general.highlightColor.active");
	manageColorPicker("general.highlightColor.color");
	manageCheckboxSetting("general.highlightColor.ignore0ETVhighlight");
	manageCheckboxSetting("general.highlightColor.ignoreUnknownETVhighlight");
	manageCheckboxSetting("general.zeroETVHighlight.active");
	manageColorPicker("general.zeroETVHighlight.color");
	manageCheckboxSetting("general.unknownETVHighlight.active");
	manageColorPicker("general.unknownETVHighlight.color");
	manageColorPicker("general.toolbarBackgroundColor");
	manageSlider("general.ETV.modifier");

	// Display on screen notifications settings
	manageCheckboxSetting("notification.screen.active");
	manageCheckboxSetting("notification.screen.thumbnail");
	manageInputText("notification.screen.position");
	manageSelectBox("general.hiddenItemsCacheSize");
	manageSelectBox("general.verbosePaginationStartPadding");
	manageSlider("general.ETV.modifier");

	//##TAB - SYSTEM
	document.getElementById("factoryReset")?.addEventListener("click", async function () {
		if (
			await confirmPrompt(
				"Reset all VineTools settings & local storage to default?\n\nThis deletes your settings, hidden items, pinned items, and the review phrases, templates and drafts on this computer.\n\nIf folder sync is set up, the next sync will bring your settings and lists BACK from the shared file (this computer is treated as a fresh install). To really start over, press 'Stop syncing' on the Sync tab first."
			)
		) {
			await chrome.storage.local.clear();
			alert(
				"All settings were deleted. RELOAD AMAZON VINE to restore default settings.\nDO NOT EDIT OPTIONS before you reload a Vine page."
			);
		}
	});
	document.getElementById("hiddenItemReset")?.addEventListener("click", async function () {
		if (
			await confirmPrompt(
				"Delete ALL hidden items?\n\nIf folder sync is set up, they are removed from the shared file and from your other computers too."
			)
		) {
			await replaceStoredList("hidden", "hiddenItems", {});
			alert("Hidden items emptied.");
		}
	});

	//##TAB - SYNC
	initSyncTab();

	//##TAB - GOOGLE
	manageInputText("google.sheet.id");
	manageInputText("google.sheet.tab");
	manageCheckboxSetting("google.sheet.enabled");
	initGoogleTab();

	//##TAB - DISCORD - WEBHOOKS:
	manageCheckboxSetting("discord.active");
	manageInputText("discord.webhook.default.url");
	for (const t of ["KWsMatch", "AFA", "RFY", "zeroETV", "manual"]) {
		manageCheckboxSetting(`discord.webhook.${t}.active`);
		manageInputText(`discord.webhook.${t}.url`);
		manageTextarea(`discord.webhook.${t}.content`);
	}
	//URLs are hidden unless hovered; re-validate whenever one changes.
	document.querySelectorAll("#discordOptions input[type='password']").forEach((input) => {
		input.onmouseenter = () => (input.type = "text");
		input.onmouseleave = () => (input.type = "password");
		input.addEventListener("input", drawDiscord);
		input.addEventListener("change", drawDiscord);
	});
	document.querySelector("#discordactive")?.addEventListener("change", () => setTimeout(drawDiscord, 1));
	drawDiscord();

	//##TAB - KEYWORDS
	manageCheckboxSetting("general.highlightKWFirst");
	manageKeywords("general.highlightKeywords");
	manageKeywords("general.hideKeywords");
	manageTextareaCSK("general.blurKeywords");
	manageCheckboxSetting("general.unblurImageOnHover");
	initiateTogglers();
	initiateTestKeywords();

	const keywordsTesting = document.querySelector("#keywords-testing");
	const pinKeywordsTesting = document.querySelector("#pin-keywords-testing");
	if (pinKeywordsTesting) {
		pinKeywordsTesting.addEventListener("click", function () {
			if (pinKeywordsTesting.classList.contains("vh-icon-pin")) {
				pinKeywordsTesting.classList.remove("vh-icon-pin");
				pinKeywordsTesting.classList.add("vh-icon-unpin");
				keywordsTesting.style.position = "fixed";
				keywordsTesting.style.bottom = "10px";
				keywordsTesting.style.left = "50%";
				keywordsTesting.style.transform = "translateX(-50%)";
				keywordsTesting.style.backgroundColor = "white";
			} else {
				pinKeywordsTesting.classList.remove("vh-icon-unpin");
				pinKeywordsTesting.classList.add("vh-icon-pin");
				keywordsTesting.style.position = "relative";
				keywordsTesting.style.bottom = "unset";
				keywordsTesting.style.left = "unset";
				keywordsTesting.style.transform = "unset";
				keywordsTesting.style.backgroundColor = "unset";
			}
		});
	}

	//##TAB - KEYBINDINGS

	manageCheckboxSetting("keyBindings.active");
	manageInputText("keyBindings.pauseFeed");
	manageInputText("keyBindings.nextPage");
	manageInputText("keyBindings.previousPage");
	manageInputText("keyBindings.RFYPage");
	manageInputText("keyBindings.AFAPage");
	manageInputText("keyBindings.ALLPage");
	manageInputText("keyBindings.AIPage");
	manageInputText("keyBindings.AIPage2");
	manageInputText("keyBindings.AIPage3");
	manageInputText("keyBindings.AIPage4");
	manageInputText("keyBindings.AIPage5");
	manageInputText("keyBindings.AIPage6");
	manageInputText("keyBindings.AIPage7");
	manageInputText("keyBindings.AIPage8");
	manageInputText("keyBindings.AIPage9");
	manageInputText("keyBindings.AIPage10");
	manageInputText("keyBindings.availableTab");
	manageInputText("keyBindings.unavailableTab");
	manageInputText("keyBindings.hiddenTab");
	manageInputText("keyBindings.pinnedTab");
	manageInputText("keyBindings.hideAll");
	manageInputText("keyBindings.showAll");
	manageInputText("keyBindings.hideAllNext");
	manageInputText("keyBindings.debug");
	manageInputText("keyBindings.firstPage");
	manageInputText("keyBindings.smartSkipStart");
	manageInputText("keyBindings.smartSkipPause");
	manageInputText("keyBindings.smartSkipStop");
	manageCheckboxSetting("smartSkip.enabled");
	manageSelectBox("smartSkip.startQueue");
	manageInputText("smartSkip.maxPages");
	manageInputText("smartSkip.delay.active.min");
	manageInputText("smartSkip.delay.active.max");
	manageInputText("smartSkip.delay.background.min");
	manageInputText("smartSkip.delay.background.max");

	//##TAB - STYLES

	manageCheckboxSetting("thorvarium.mobileios");
	manageCheckboxSetting("thorvarium.mobileandroid");
	manageCheckboxSetting("thorvarium.smallItems");
	manageCheckboxSetting("thorvarium.removeHeader");
	manageCheckboxSetting("thorvarium.removeFooter");
	manageCheckboxSetting("thorvarium.removeAssociateHeader");
	manageCheckboxSetting("thorvarium.darktheme", false);
	manageCheckboxSetting("thorvarium.ETVModalOnTop");
	manageCheckboxSetting("thorvarium.categoriesWithEmojis");
	manageCheckboxSetting("thorvarium.paginationOnTop");
	manageCheckboxSetting("thorvarium.collapsableCategories");
	manageCheckboxSetting("thorvarium.stripedCategories");
	manageCheckboxSetting("thorvarium.limitedQuantityIcon");
	manageCheckboxSetting("thorvarium.RFYAFAAITabs");
	manageTextarea("general.customCSS");

	//##TAB - ?

	//Make the save button follow the scroll in the keyword tab
	const highlightKeywordsTable = document.querySelector("#general\\.highlightKeywords table");
	const highlightSaveButton = document.querySelector("#general\\.highlightKeywords input[name='save']");
	const highlightAddButton = document.querySelector("#general\\.highlightKeywords input[name='add']");
	const hideKeywordsTable = document.querySelector("#general\\.hideKeywords table");
	const hideSaveButton = document.querySelector("#general\\.hideKeywords input[name='save']");
	const hideAddButton = document.querySelector("#general\\.hideKeywords input[name='add']");
	// Store scroll event listener reference to prevent duplicates
	if (!window._vineHelperScrollHandler) {
		window._vineHelperScrollHandler = () => {
			//if general.highlightKeywords table is displayed and the save button is not displayed in the current scroll position, make the scroll button position fixed

			if (
				isVisibleInViewport(highlightKeywordsTable, false, "highlightKeywordsTable") &&
				!isVisibleInViewport(highlightAddButton, true, "highlightAddButton")
			) {
				highlightSaveButton.style.position = "fixed";
				highlightSaveButton.style.bottom = "10px";
				highlightSaveButton.style.right = "10px";
			} else {
				highlightSaveButton.style.position = "relative";
			}

			if (
				isVisibleInViewport(hideKeywordsTable, false, "hideKeywordsTable") &&
				!isVisibleInViewport(hideAddButton, true, "hideAddButton")
			) {
				hideSaveButton.style.position = "fixed";
				hideSaveButton.style.bottom = "10px";
				hideSaveButton.style.right = "10px";
			} else {
				hideSaveButton.style.position = "relative";
			}
		};
		window.addEventListener("scroll", window._vineHelperScrollHandler);
	}

	//Import/Export JSON Settings
	const bulkImportJSONsettingsBtn = document.getElementById(`bulkImportJSONsettings`);
	if (bulkImportJSONsettingsBtn && !bulkImportJSONsettingsBtn._vineHelperClickHandler) {
		bulkImportJSONsettingsBtn._vineHelperClickHandler = async () => {
			displayMultiLinePopup("", "Paste your JSON content here...", "Import JSON", async (data) => {
				try {
					if (data == "") {
						throw new Error("Empty JSON data");
					}
					const json = JSON.parse(data);
					if (!json.settings) {
						throw new Error("Format Invalid");
					}
					const current = (await chrome.storage.local.get("settings")).settings;
					await chrome.storage.local.set({
						settings: restoreLocalOnly(json.settings, current), //keep this device's keys/country/counters
						settingsModifiedAt: Date.now(), //an import is a real edit: it must win the next sync
					});
					chrome.runtime.sendMessage({ type: "refreshSettings" }, () => void chrome.runtime.lastError);
					requestSync(0);
					return true; //Hide the popup
				} catch (err) {
					alert("JSON data incomplete or invalid.");
					return false; //Keep the popup visible
				}
			});
		};
		bulkImportJSONsettingsBtn.addEventListener("click", bulkImportJSONsettingsBtn._vineHelperClickHandler);
	}

	//Export JSON
	const bulkExportJSONsettingsBtn = document.getElementById(`bulkExportJSONsettings`);
	if (bulkExportJSONsettingsBtn && !bulkExportJSONsettingsBtn._vineHelperClickHandler) {
		bulkExportJSONsettingsBtn._vineHelperClickHandler = async () => {
			const json = await chrome.storage.local.get("settings");
			//Delete the settings.fingerprint.id
			delete json.settings.general.fingerprint;
			delete json.settings.crypto;
			displayMultiLinePopup(JSON.stringify(json));
		};
		bulkExportJSONsettingsBtn.addEventListener("click", bulkExportJSONsettingsBtn._vineHelperClickHandler);
	}

	//Import/Export JSON hidden items
	const bulkImportJSONhiddenBtn = document.getElementById(`bulkImportJSONhidden`);
	if (bulkImportJSONhiddenBtn && !bulkImportJSONhiddenBtn._vineHelperClickHandler) {
		bulkImportJSONhiddenBtn._vineHelperClickHandler = async () => {
			displayMultiLinePopup("", "Paste your JSON content here...", "Import JSON", async (data) => {
				try {
					if (data == "") {
						throw new Error("Empty JSON data");
					}
					const json = JSON.parse(data);
					if (!json.hiddenItems) {
						throw new Error("Format Invalid");
					}
					await replaceStoredList("hidden", "hiddenItems", json.hiddenItems);
					return true; //Hide the popup
				} catch (err) {
					alert("JSON data incomplete or invalid.");
					return false; //Keep the popup visible
				}
			});
		};
		bulkImportJSONhiddenBtn.addEventListener("click", bulkImportJSONhiddenBtn._vineHelperClickHandler);
	}

	//Export JSON
	const bulkExportJSONhiddenBtn = document.getElementById(`bulkExportJSONhidden`);
	if (bulkExportJSONhiddenBtn && !bulkExportJSONhiddenBtn._vineHelperClickHandler) {
		bulkExportJSONhiddenBtn._vineHelperClickHandler = async () => {
			const json = await chrome.storage.local.get("hiddenItems");
			displayMultiLinePopup(JSON.stringify(json));
		};
		bulkExportJSONhiddenBtn.addEventListener("click", bulkExportJSONhiddenBtn._vineHelperClickHandler);
	}

	//Import/Export JSON pinned items
	const bulkImportJSONpinnedBtn = document.getElementById(`bulkImportJSONpinned`);
	if (bulkImportJSONpinnedBtn && !bulkImportJSONpinnedBtn._vineHelperClickHandler) {
		bulkImportJSONpinnedBtn._vineHelperClickHandler = async () => {
			displayMultiLinePopup("", "Paste your JSON content here...", "Import JSON", async (data) => {
				try {
					if (data == "") {
						throw new Error("Empty JSON data");
					}
					const json = JSON.parse(data);
					if (!json.pinnedItems) {
						throw new Error("Format Invalid");
					}
					await replaceStoredList("pinned", "pinnedItems", json.pinnedItems);
					return true; //Hide the popup
				} catch (err) {
					alert("JSON data incomplete or invalid.");
					return false; //Keep the popup visible
				}
			});
		};
		bulkImportJSONpinnedBtn.addEventListener("click", bulkImportJSONpinnedBtn._vineHelperClickHandler);
	}

	//Export JSON
	const bulkExportJSONpinnedBtn = document.getElementById(`bulkExportJSONpinned`);
	if (bulkExportJSONpinnedBtn && !bulkExportJSONpinnedBtn._vineHelperClickHandler) {
		bulkExportJSONpinnedBtn._vineHelperClickHandler = async () => {
			const json = await chrome.storage.local.get("pinnedItems");
			displayMultiLinePopup(JSON.stringify(json));
		};
		bulkExportJSONpinnedBtn.addEventListener("click", bulkExportJSONpinnedBtn._vineHelperClickHandler);
	}

}

//Determine if a query selector is visible in the scrolled area
function isVisibleInViewport(element, fullyInView = true, debug) {
	if (!element) {
		throw new Error("Element is not found: " + debug);
	}

	const rect = element.getBoundingClientRect();
	const windowHeight = window.innerHeight;

	// Element is at least partially visible if:
	// - Its top is in view (top >= 0 && top < windowHeight)
	// - Its bottom is in view (bottom > 0 && bottom <= windowHeight)
	// - Or it spans the entire viewport (top <= 0 && bottom >= windowHeight)
	if (fullyInView) {
		return rect.top >= 0 && rect.bottom <= windowHeight;
	} else {
		return (
			(rect.top >= 0 && rect.top < windowHeight) ||
			(rect.bottom > 0 && rect.bottom <= windowHeight) ||
			(rect.top <= 0 && rect.bottom >= windowHeight)
		);
	}
}

/**
 * Function to handle the collapsible fieldsets
 */
function initiateTogglers() {
	document.querySelectorAll("a.toggle").forEach((link) => {
		link.addEventListener("click", (event) => {
			const container = link.parentElement.parentElement.querySelector("div.toggle-container");
			const toggleIcon = link.querySelector("div");
			if (toggleIcon.classList.contains("vh-icon-toggler-down")) {
				toggleIcon.classList.remove("vh-icon-toggler-down");
				toggleIcon.classList.add("vh-icon-toggler-right");

				container.style.display = "none";
			} else {
				toggleIcon.classList.remove("vh-icon-toggler-right");
				toggleIcon.classList.add("vh-icon-toggler-down");

				container.style.display = "block";
			}
		});
	});
}

/**
 * Test a title against all keywords
 */
function initiateTestKeywords() {
	const titleObj = document.querySelector("#testTitle");
	titleObj.addEventListener("keyup", (event) => {
		const title = titleObj.value;
		testKeyword("general.highlightKeywords", title);
		testKeyword("general.hideKeywords", title);
	});

	document.querySelector("#testTitleAgain").addEventListener("click", (event) => {
		const keyUpEvent = new Event("keyup");
		titleObj.dispatchEvent(keyUpEvent);
	});
}

import { findMatch } from "../scripts/core/utils/KeywordMatcher.js";
function testKeyword(key, title) {
	const keyE = CSS.escape(key);

	const lines = document.querySelectorAll(`#${keyE} table>tr`);
	for (let i = 1; i < lines.length; i++) {
		const containsObj = lines[i].querySelector(`td input[name="contains"]`);
		const contains = containsObj.value.trim();

		// Compile and test the keyword
		const compiledKeywords = compileKeywordObjects([{ contains: contains, without: "", etv_min: "", etv_max: "" }]);
		if (findMatch(title, compiledKeywords, null, null)) {
			containsObj.style.background = "lightgreen";
		} else {
			containsObj.style.background = "white";
		}

		const withoutObj = lines[i].querySelector(`td input[name="without"]`);
		const without = withoutObj.value.trim();

		// Test the 'without' field as if it were a 'contains' field
		const compiledWithout = compileKeywordObjects([{ contains: without, without: "", etv_min: "", etv_max: "" }]);
		if (findMatch(title, compiledWithout, null, null)) {
			withoutObj.style.background = "lightgreen";
		} else {
			withoutObj.style.background = "white";
		}
	}
}

/**
 * This function convert both ways */
function keywordsTypeToSettingKey(type) {
	switch (type) {
		case "highlight":
			return "general.highlightKeywords";
		case "hidden":
			return "general.hideKeywords";
		case "blur":
			return "general.blurKeywords";

		//Reverse
		case "general.highlightKeywords":
			return "highlight";
		case "general.hideKeywords":
			return "hidden";
		case "general.blurKeywords":
			return "blur";
	}
	return null;
}

//CSK: Comma Separated Keywords
function manageTextareaCSK(key) {
	const val = Settings.get(key);
	const keywordType = keywordsTypeToSettingKey(key);
	const obj = document.querySelector(`textarea[name='${key}']`);
	if (obj == null) {
		console.log("Textarea name='" + key + "' does not exist");
		return;
	}
	obj.value = val === undefined ? "" : val.join(", ");
	obj.addEventListener("change", async function () {
		let arr = [];
		arr = obj.value
			.split(",")
			.map((item) => item.trim())
			.filter((item) => item !== "");
		if (arr.length == 1 && arr[0] == "") {
			arr = [];
		}

		Settings.set(key, arr);
	});

}

function keywordsToJSON(key) {
	const keyE = CSS.escape(key);
	let arrContent = [];
	const lines = document.querySelectorAll(`#${keyE} table>tr`);
	for (let i = 1; i < lines.length; i++) {
		const contains = lines[i].querySelector(`td input[name="contains"]`).value.trim();
		const without = lines[i].querySelector(`td input[name="without"]`).value.trim();
		const etv_min = lines[i].querySelector(`td input[name="etv_min"]`).value.trim();
		const etv_max = lines[i].querySelector(`td input[name="etv_max"]`).value.trim();

		//Validate that contains and without have valid regex syntax
		try {
			new RegExp(contains);
		} catch (e) {
			alert("Invalid regex syntax: " + contains);
			lines[i].querySelector(`td input[name="contains"]`).focus();
		}
		try {
			new RegExp(without);
		} catch (e) {
			alert("Invalid regex syntax: " + without);
			lines[i].querySelector(`td input[name="without"]`).focus();
		}

		//Skip empty lines
		if (contains == "" && without == "" && etv_min == "" && etv_max == "") {
			continue;
		}
		arrContent.push({
			contains: contains,
			without: without,
			etv_min: etv_min,
			etv_max: etv_max,
		});
	}
	return arrContent;
}
function keywordsToCSV(key) {
	const keyE = CSS.escape(key);
	const lines = document.querySelectorAll(`#${keyE} table>tr`);

	//Create a CSV string of all the "contains" entries
	let csv = "";
	for (let i = 1; i < lines.length; i++) {
		const contains = lines[i].querySelector(`td input[name="contains"]`).value.trim();
		csv += contains + ",";
	}
	return csv;
}

function manageKeywords(key) {
	const val = Settings.get(key);
	const keywordType = keywordsTypeToSettingKey(key);
	const keyE = CSS.escape(key);

	//Build the keywords GUI
	const btnAdd = document.querySelector(`#${keyE} input[name="add"]`);
	if (btnAdd && !btnAdd._vineHelperClickHandler) {
		btnAdd._vineHelperClickHandler = () => {
			manageKeywordsAddLine(key, "", "", "", "");
		};
		btnAdd.addEventListener("click", btnAdd._vineHelperClickHandler);
	}

	const btnSave = document.querySelector(`#${keyE} input[name="save"]`);
	if (btnSave && !btnSave._vineHelperClickHandler) {
		btnSave._vineHelperClickHandler = async () => {
			btnSave.disabled = true;
			const arrContent = keywordsToJSON(key);
			await Settings.set(key, arrContent);

			await new Promise((r) => setTimeout(r, 500)); //Wait to give user-feedback.
			btnSave.disabled = false;
		};
		btnSave.addEventListener("click", btnSave._vineHelperClickHandler);
	}

	//Sort the list
	if (typeof val[0] == "object") {
		val.sort((a, b) => {
			if (a.contains.toLowerCase() < b.contains.toLowerCase()) return -1;
			if (a.contains.toLowerCase() > b.contains.toLowerCase()) return 1;
			return 0;
		});
	}

	//Clear the list
	const table = document.querySelector(`#${keyE} table`);
	if (table) {
		const headerRow = table.querySelector("tr:first-child");
		if (headerRow) {
			table.replaceChildren(headerRow);
		} else {
			table.replaceChildren();
		}
	}

	//Populate the list
	for (let i = 0; i < val.length; i++) {
		if (typeof val[i] == "string") {
			//Load the old data format
			manageKeywordsAddLine(key, val[i], "", "", "");
		} else if (typeof val[i] == "object") {
			//Load the new data format
			manageKeywordsAddLine(key, val[i].contains, val[i].without, val[i].etv_min, val[i].etv_max);
		}
	}


	document.getElementById(`bulkDelete${keywordType}keywords`).addEventListener("click", async () => {
		if (await confirmPrompt("Delete all?")) {
			//Remove all the existing lines
			const rows = document.querySelectorAll(`#${keyE} table>tr`);
			rows.forEach((row, idx) => {
				if (idx === 0) return; // Skip header row
				row.remove();
			});
		}
	});

	//Import CSV
	document.getElementById(`bulkImportCSV${keywordType}keywords`).addEventListener("click", async () => {
		displayMultiLinePopup("", "Paste your CSV content here...", "Import CSV", (data) => {
			let arr = [];
			arr = data
				.split(",")
				.map((item) => item.trim())
				.filter((item) => item !== "");
			for (let i = 0; i < arr.length; i++) {
				manageKeywordsAddLine(key, arr[i], "", "", "");
			}
			return true;
		});
	});

	//Import JSON
	document.getElementById(`bulkImportJSON${keywordType}keywords`).addEventListener("click", async () => {
		displayMultiLinePopup("", "Paste your JSON content here...", "Import JSON", (data) => {
			try {
				const json = JSON.parse(data);
				for (let i = 0; i < json.length; i++) {
					manageKeywordsAddLine(key, json[i].contains, json[i].without, json[i].etv_min, json[i].etv_max);
				}
				return true; //Hide the popup
			} catch (err) {
				alert("JSON data incomplete or invalid.");
				return false; //Keep the popup visible
			}
		});
	});

	//Export CSV
	document.getElementById(`bulkExportCSV${keywordType}keywords`).addEventListener("click", async () => {
		const csv = keywordsToCSV(key);
		displayMultiLinePopup(csv);
	});

	//Export JSON
	document.getElementById(`bulkExportJSON${keywordType}keywords`).addEventListener("click", async () => {
		const json = keywordsToJSON(key);
		displayMultiLinePopup(JSON.stringify(json));
	});
}

function displayMultiLinePopup(content, placeholder = "", callbackLabel = null, callback = null) {
	//Create a popup with a textarea for multi-line input
	const popup = document.createElement("div");
	popup.style.position = "fixed";
	popup.style.top = "50%";
	popup.style.left = "50%";
	popup.style.transform = "translate(-50%, -50%)";
	popup.style.backgroundColor = "white";
	popup.style.border = "1px solid black";
	popup.style.width = "90%";
	popup.style.height = "200px";
	popup.style.padding = "20px";
	popup.style.paddingTop = "40px";
	popup.style.paddingBottom = "40px";

	// Create textarea
	const textarea = document.createElement("textarea");
	textarea.id = "textInput";
	textarea.style.width = "100%";
	textarea.style.height = "100%";
	textarea.style.marginLeft = "0";
	textarea.placeholder = placeholder;
	textarea.textContent = content;
	popup.appendChild(textarea);

	// Create close button
	const closeButton = document.createElement("button");
	closeButton.id = "closePopup";
	closeButton.style.position = "absolute";
	closeButton.style.top = "5px";
	closeButton.style.right = "5px";
	closeButton.textContent = "X";
	popup.appendChild(closeButton);

	// Create callback button if needed
	if (callbackLabel != null) {
		const callbackButton = document.createElement("button");
		callbackButton.id = "import";
		callbackButton.style.position = "absolute";
		callbackButton.style.bottom = "10px";
		callbackButton.style.right = "10px";
		callbackButton.textContent = callbackLabel;
		popup.appendChild(callbackButton);
	}

	document.body.appendChild(popup);

	document.getElementById("closePopup").addEventListener("click", () => {
		popup.remove();
	});

	if (callbackLabel != null) {
		document.getElementById("import").addEventListener("click", () => {
			if (callback != null) {
				const ret = callback(document.getElementById("textInput").value);
				if (ret) {
					popup.remove();
				}
			} else {
				popup.remove();
			}
		});
	}
}

function manageRadio(key) {
	const keyE = CSS.escape(key);

	document.querySelectorAll(`input[name="${keyE}"]`).forEach((elem) => {
		if (elem.value == Settings.get(key)) {
			elem.checked = true;
		}

		elem.addEventListener("click", () => {
			Settings.set(key, elem.value);
		});
	});
}
function manageKeywordsAddLine(key, contains, without, etv_min, etv_max) {
	const keyE = CSS.escape(key);
	const table = document.querySelector(`#${keyE} table`);
	const tr = document.createElement("tr");
	table.append(tr);

	const td1 = document.createElement("td");
	tr.append(td1);
	const input1 = document.createElement("input");
	input1.type = "text";
	input1.style.width = "98%";
	input1.name = "contains";
	input1.value = contains;
	td1.append(input1);

	const td2 = document.createElement("td");
	tr.append(td2);
	const input2 = document.createElement("input");
	input2.type = "text";
	input2.style.width = "98%";
	input2.name = "without";
	input2.value = without;
	td2.append(input2);

	const td3 = document.createElement("td");
	tr.append(td3);
	const input3 = document.createElement("input");
	input3.type = "text";
	input3.name = "etv_min";
	input3.style.width = "90%";
	input3.value = etv_min;
	td3.append(input3);

	const td4 = document.createElement("td");
	tr.append(td4);
	const input4 = document.createElement("input");
	input4.type = "text";
	input4.name = "etv_max";
	input4.style.width = "90%";
	input4.value = etv_max;
	td4.append(input4);

	const td5 = document.createElement("td");
	tr.append(td5);
	const input5 = document.createElement("input");
	input5.type = "button";
	input5.classList.add("vh-icon-trash");
	input5.name = "remove";
	input5.value = " ";
	input5.addEventListener("click", async () => {
		if (await confirmPrompt("Delete?")) {
			tr.remove();
		}
	});
	td5.append(input5);
}

function manageTextarea(key) {
	const val = Settings.get(key);
	const obj = document.querySelector(`textarea[name='${key}']`);
	if (obj == null) {
		console.log("Textarea name='" + key + "' does not exist");
		return;
	}
	obj.value = val;
	// Store event listener reference to prevent duplicates
	if (!obj._vineHelperChangeHandler) {
		obj._vineHelperChangeHandler = async function () {
			Settings.set(key, obj.value);
		};
		obj.addEventListener("change", obj._vineHelperChangeHandler);
	}
}

function manageInputText(key) {
	const val = Settings.get(key);
	// Find the field by its name; fall back to the older "input inside <label for=key>" layout.
	const obj = document.querySelector(`input[name='${CSS.escape(key)}']`) || document.querySelector(`label[for='${key}'] input`);
	if (obj == null) {
		console.log("Item input name='" + key + "' does not exist");
		return;
	}
	obj.value = val == null ? "" : val;

	// Store event listener reference to prevent duplicates
	if (!obj._vineHelperChangeHandler) {
		obj._vineHelperChangeHandler = async function () {
			Settings.set(key, obj.value);
		};
		obj.addEventListener("change", obj._vineHelperChangeHandler);
	}
}

function manageTimeSetting(key) {
	const val = Settings.get(key);
	const obj = document.querySelector(`input[name='${key}']`);
	if (obj == null) {
		console.log("Time input name='" + key + "' does not exist");
		return;
	}
	obj.value = val == null ? "03:00" : val;

	// Store event listener reference to prevent duplicates
	if (!obj._vineHelperChangeHandler) {
		obj._vineHelperChangeHandler = async function () {
			Settings.set(key, obj.value);
		};
		obj.addEventListener("change", obj._vineHelperChangeHandler);
	}
}

function manageColorPicker(key) {
	const val = Settings.get(key);
	const keyE = CSS.escape(key);
	const obj = document.querySelector(`input[name='${keyE}']`);
	if (obj == null) {
		console.log("Color picker input name='" + key + "' does not exist");
		return;
	}
	obj.value = val == null ? "" : val;

	// Store event listener reference to prevent duplicates
	if (!obj._vineHelperChangeHandler) {
		obj._vineHelperChangeHandler = async function () {
			Settings.set(key, obj.value);
		};
		obj.addEventListener("change", obj._vineHelperChangeHandler);
	}
}

function manageSlider(key) {
	const val = Settings.get(key);
	const volumeObj = document.querySelector(`label[for='${key}'] input`);
	if (volumeObj == null) {
		console.log("Slider input name='" + key + "' does not exist");
		return;
	}
	volumeObj.value = Number(val == null ? 0 : val);
	const keyE = CSS.escape(key);
	const textDisplayObj = document.querySelector(`span#${keyE}Value`);
	if (textDisplayObj) {
		textDisplayObj.textContent = (volumeObj.value * 100).toFixed(0) + "%";
	}
	const textDisplayObj2 = document.querySelector(`span#${keyE}Multiplicator`);
	if (textDisplayObj2) {
		textDisplayObj2.textContent = (Number(volumeObj.value) * 1).toFixed(1) + "x";
	}

	// Store event listener reference to prevent duplicates
	if (!volumeObj._vineHelperChangeHandler) {
		volumeObj._vineHelperChangeHandler = async function () {
			Settings.set(key, volumeObj.value);
			const keyE = CSS.escape(key);
			const textDisplayObj = document.querySelector(`span#${keyE}Value`);
			if (textDisplayObj) {
				textDisplayObj.textContent = (volumeObj.value * 100).toFixed(0) + "%";
			}
			const textDisplayObj2 = document.querySelector(`span#${keyE}Multiplicator`);
			if (textDisplayObj2) {
				textDisplayObj2.textContent = (Number(volumeObj.value) * 1).toFixed(1) + "x";
			}
		};
		volumeObj.addEventListener("change", volumeObj._vineHelperChangeHandler);
	}
}
function managePlayButton(btnId, selectName, volumeName) {
	const btn = document.getElementById(btnId);
	btn.addEventListener("click", function () {
		const volumeObj = document.querySelector(`label[for='${volumeName}'] input`);
		const selectObj = document.querySelector(`label[for='${selectName}'] select`);
		if (selectObj.value == "0") {
			return false;
		}

		const audioFilePath = "resource/sound/" + selectObj.value + ".mp3";
		const audioElement = new Audio(chrome.runtime.getURL(audioFilePath));
		const handleEnded = () => {
			audioElement.removeEventListener("ended", handleEnded); // Remove the event listener
			audioElement.remove(); // Remove the audio element from the DOM
		};
		audioElement.addEventListener("ended", handleEnded);
		audioElement.volume = Number(volumeObj.value);
		audioElement.play();
	});
}

function manageSelectBox(key) {
	const val = Settings.get(key);
	const keyE = CSS.escape(key);
	const selectObj = document.querySelector(`label[for='${keyE}'] select`);

	for (let i = 0; i < selectObj.options.length; i++) {
		if (selectObj.options[i].value == val) {
			selectObj.options[i].selected = true;
		}
	}

	// Store event listener reference to prevent duplicates
	if (!selectObj._vineHelperChangeHandler) {
		selectObj._vineHelperChangeHandler = async function () {
			Settings.set(key, selectObj.value);
		};
		selectObj.addEventListener("change", selectObj._vineHelperChangeHandler);
	}
}

function manageCheckboxSetting(key, def = null) {
	let val = Settings.get(key);

	// If the setting doesn't exist and we have a default, use it and save it
	if (val === undefined && def !== null) {
		val = def;
		Settings.set(key, val); // Save the default value
	}

	if (val === undefined || val === null) {
		console.log("Setting " + key + " does not exist and no default provided");
		return;
	}

	const keyE = CSS.escape(key);
	const checkObj = document.querySelector(`input[name='${keyE}']`);
	if (checkObj == null) {
		console.log("Checkbox input name='" + key + "' does not exist");
		return;
	}

	checkObj.checked = val === true;

	//Trigger the change event so the fieldset will update accordingly.
	const event = new Event("change");
	checkObj.dispatchEvent(event);

	//Saving the change
	// Store event listener reference to prevent duplicates
	if (!checkObj._vineHelperChangeHandler) {
		checkObj._vineHelperChangeHandler = function (event) {
			console.log("[Settings] Checkbox changed for key: " + key);
			Settings.set(key, event.target.checked);
		};
		checkObj.addEventListener("change", checkObj._vineHelperChangeHandler);
	}

	//Clicking the label will check the checkbox
	const obj = document.querySelector(`label[for='${keyE}']`);
	if (!obj) {
		console.error("Label for '" + keyE + "' does not exist");
		return;
	}
	obj.onclick = async function (event) {
		if (event.target.nodeName == "INPUT") {
			return false;
		}

		//Change the value
		const element = document.querySelector(`input[name='${keyE}']`);
		element.click();
	}.bind(keyE);
}

//##TAB - GOOGLE: sign in, test the connection, preview what would be written (all through the service worker)
function initGoogleTab() {
	const $ = (id) => document.getElementById(id);
	if (!$("googleSignIn")) return;
	const ask = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (res) => resolve(res)));
	const show = (status, result = "") => {
		$("googleStatus").textContent = status;
		$("googleResult").textContent = result;
	};
	const explain = (res) => {
		if (!res) return "No answer from the extension's background page.";
		if (res.reason === "signin") return "Not signed in to Google yet: press \"1. Sign in to Google\".";
		if (res.reason === "not-configured") return "Enter the spreadsheet URL (or ID) and the tab name first.";
		if (res.reason === "disabled") return "Automatic adding is switched off.";
		return "Failed: " + (res.error || "unknown error") + (res.status ? ` (HTTP ${res.status})` : "");
	};
	// what is typed right now (it is only saved when the field loses focus): used by the read-only buttons
	const typedConfig = () => ({
		id: document.querySelector("input[name='google.sheet.id']")?.value || "",
		tab: document.querySelector("input[name='google.sheet.tab']")?.value || "",
	});
	const settle = () => Promise.resolve();

	if (typeof window.popupView !== "undefined") {
		for (const id of ["googleSignIn", "googleTest", "googlePreview"]) $(id).disabled = true;
		show("Open the full settings page (not the toolbar popup) to sign in and test: Google's window cannot open from the popup.");
		return;
	}

	$("googleSignIn").onclick = async () => {
		show("Opening Google's sign-in window...");
		const res = await ask({ type: "googleSignIn" });
		show(res?.ok ? "Signed in." : explain(res));
	};

	$("googleTest").onclick = async () => {
		show("Reading the sheet (nothing is written)...");
		await settle();
		const res = await ask({ type: "googleTest", config: typedConfig() });
		if (!res?.ok) return show(explain(res));
		show(
			`Connected. ${res.orders} order(s) already on the sheet. Header row ${res.headerRow}, last data row ${res.lastDataRow}.`,
			"Columns found: " + res.columns.join(", ")
		);
	};

	$("googlePreview").onclick = async () => {
		show("Building a sample row (nothing is written)...");
		await settle();
		const sample = {
			orderNumber: "000-0000000-0000000",
			orderDate: new Date().toISOString().slice(0, 10),
			asin: "B000000000",
			title: "VineTools preview order",
			imageUrl: "https://m.media-amazon.com/images/I/31Vs7ybz1SL._SS210_.jpg",
			etv: 12.34,
		};
		const res = await ask({ type: "googleAddOrders", orders: [sample], dryRun: true, config: typedConfig() });
		if (!res?.ok) return show(explain(res));
		show(`Preview only: ${res.added} row would be added, ${res.skipped} skipped. Nothing was written.`, JSON.stringify(res.requests, null, 1).slice(0, 6000));
	};
}

function formatTime(ms) {
	return ms ? new Date(ms).toLocaleString() : "never";
}

//##TAB - SYNC: choose the shared (Google Drive) folder and trigger a sync
function initSyncTab() {
	const $ = (id) => document.getElementById(id);
	if (!$("syncChooseFolder")) return;

	const ask = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (res) => resolve(res)));

	async function refresh() {
		const st = (await ask({ type: "folderSyncStatus" })) || {};
		$("syncFolderName").textContent = st.configured ? st.folderName : "not set";
		const permText = {
			granted: "granted",
			prompt: "needs permission (press Sync now)",
			denied: "denied (choose the folder again)",
		};
		$("syncPermission").textContent = st.configured ? permText[st.permission] || String(st.permission) : "-";
		$("syncLastSync").textContent = formatTime(st.lastSync);
		$("syncError").textContent = st.lastError || "";
		$("syncNowButton").disabled = !st.configured;
		$("syncForgetFolder").disabled = !st.configured;
	}

	function describe(res) {
		if (!res) return "No answer from the extension's background page.";
		if (res.ok) {
			const parts = [];
			if (res.pulled) parts.push("updated this computer from the folder");
			if (res.pushed) parts.push("updated the folder");
			if (!parts.length) parts.push("already in sync");
			return `Done: ${parts.join(" and ")}. (${res.hidden} hidden, ${res.pinned} pinned)`;
		}
		if (res.reason === "not-configured") return "Choose a folder first.";
		if (res.reason === "permission") return "Chrome needs your permission to use the folder again.";
		return "Sync failed: " + (res.error || res.reason);
	}

	if (typeof window.popupView !== "undefined") {
		// The toolbar popup closes as soon as a native dialog (folder picker / permission prompt) takes focus,
		// so those actions only work in the full settings page.
		$("syncChooseFolder").textContent = "Open full settings to choose / sync...";
		$("syncChooseFolder").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("page/settings.html") });
		$("syncNowButton").style.display = "none";
		$("syncForgetFolder").style.display = "none";
		refresh();
		return;
	}

	$("syncChooseFolder").onclick = async () => {
		try {
			await pickFolder();
		} catch (e) {
			if (e.name !== "AbortError") $("syncResult").textContent = "Could not use that folder: " + e.message;
			return;
		}
		$("syncResult").textContent = "Syncing...";
		const res = await ask({ type: "folderSync", reason: "choose" });
		$("syncResult").textContent = describe(res);
		await refresh();
	};

	$("syncNowButton").onclick = async () => {
		$("syncResult").textContent = "Syncing...";
		//Re-grant access if Chrome dropped it (needs this click as the user gesture)
		const perm = await requestFolderPermission();
		if (perm !== "granted") {
			$("syncResult").textContent = "Folder access was not granted.";
			await refresh();
			return;
		}
		const res = await ask({ type: "folderSync", reason: "manual" });
		$("syncResult").textContent = describe(res);
		await refresh();
	};

	$("syncForgetFolder").onclick = async () => {
		const { handleStore } = await import("/scripts/background/FolderSync.js");
		await handleStore.clear();
		$("syncResult").textContent = "Stopped syncing. The file in the folder was left untouched.";
		await refresh();
	};

	refresh();
}

function confirmPrompt(message) {
	return new Promise((resolve) => {
		// Create overlay
		const overlay = document.createElement("div");
		overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 9998;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

		// Create confirm box
		const confirmBox = document.createElement("div");
		confirmBox.style.cssText = `
            background: white;
            padding: 20px;
            border-radius: 5px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            z-index: 9999;
            min-width: 300px;
        `;

		// Add message
		const messageDiv = document.createElement("div");
		messageDiv.textContent = message;
		messageDiv.style.marginBottom = "20px";
		confirmBox.appendChild(messageDiv);

		// Add buttons container
		const buttonContainer = document.createElement("div");
		buttonContainer.style.cssText = `
            display: flex;
            justify-content: flex-end;
            gap: 10px;
        `;

		// Create buttons
		const okButton = document.createElement("button");
		okButton.textContent = "OK";
		okButton.style.cssText = `
            padding: 5px 15px;
            cursor: pointer;
            background: #4CAF50;
            border: none;
            color: white;
            border-radius: 3px;
        `;

		const cancelButton = document.createElement("button");
		cancelButton.textContent = "Cancel";
		cancelButton.style.cssText = `
            padding: 5px 15px;
            cursor: pointer;
            background: #f44336;
            border: none;
            color: white;
            border-radius: 3px;
        `;

		// Add buttons to container
		buttonContainer.appendChild(cancelButton);
		buttonContainer.appendChild(okButton);
		confirmBox.appendChild(buttonContainer);

		// Add confirm box to overlay
		overlay.appendChild(confirmBox);

		// Add overlay to body
		document.body.appendChild(overlay);

		// Handle button clicks
		const cleanup = () => {
			document.body.removeChild(overlay);
			document.removeEventListener("keydown", handleKeyPress);
		};

		const handleConfirm = () => {
			cleanup();
			resolve(true);
		};

		const handleCancel = () => {
			cleanup();
			resolve(false);
		};

		// Add click handlers
		okButton.addEventListener("click", handleConfirm);
		cancelButton.addEventListener("click", handleCancel);

		// Handle keyboard events
		const handleKeyPress = (e) => {
			if (e.key === "Enter") {
				handleConfirm();
			} else if (e.key === "Escape") {
				handleCancel();
			}
		};

		document.addEventListener("keydown", handleKeyPress);

		// Focus OK button
		okButton.focus();
	});
}


export { initiateSettings };
