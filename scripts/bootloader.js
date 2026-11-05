/*global chrome*/

import { Logger } from "/scripts/core/utils/Logger.js";
var logger = new Logger();

logger.add("BOOT: Bootloader starting.");

import { isSafari, isMobileBrowser } from "/scripts/core/utils/BrowserDetection.js";

// TODO: This bootloader needs refactoring to use dependency injection
// Currently using compatibility layer for SettingsMgr as first step
// Future work:
// - Create a DI container instance at the top
// - Register all services in the container
// - Use container.resolve() instead of direct instantiation
// See scripts/infrastructure/DIContainer.js for the DI implementation
import { SettingsMgr } from "/scripts/core/services/SettingsMgrCompat.js";
var Settings = new SettingsMgr();

import { Internationalization } from "/scripts/core/services/Internationalization.js";
var i13n = new Internationalization();

import { Environment } from "/scripts/core/services/Environment.js";
var env = new Environment();

import { Template } from "/scripts/core/utils/Template.js";
var Tpl = new Template();

import { YMDHiStoISODate } from "/scripts/core/utils/DateHelper.js";

import { openDynamicModal } from "/scripts/core/utils/DynamicModalHelper.js";

import { CryptoKeys } from "/scripts/core/utils/CryptoKeys.js";
var cryptoKeys = new CryptoKeys();

import { Page } from "/scripts/ui/components/Page.js";
var page = new Page();

import { RFYNotifier } from "/scripts/core/services/RFYNotifier.js";

import { isPageLogin, isPageCaptcha, isPageDog } from "/scripts/core/utils/DOMHelper.js";

import { HiddenListMgr } from "/scripts/core/services/HiddenListMgr.js";
var HiddenList = new HiddenListMgr();

import { HookMgr } from "/scripts/core/utils/HookMgr.js";
var hookMgr = new HookMgr();

import { Item } from "/scripts/core/models/Item.js";
import { ModalMgr } from "/scripts/ui/controllers/ModalMgr.js";
var DialogMgr = new ModalMgr();

import { News } from "/scripts/ui/controllers/News.js";

import { NotificationMonitorV3 } from "/scripts/notifications-monitor/core/NotificationMonitorV3.js";

import { Pagination } from "/scripts/ui/controllers/Pagination.js";
var pagination = new Pagination();
import { PinnedListMgr } from "/scripts/core/services/PinnedListMgr.js";
var PinnedList = new PinnedListMgr();

import { ScreenNotification, ScreenNotifier } from "/scripts/ui/components/ScreenNotifier.js";
var Notifications = new ScreenNotifier();

import { Tile } from "/scripts/ui/components/Tile.js";

import { TileSizer } from "/scripts/ui/controllers/TileSizer.js";
var tileSizer = new TileSizer();

import { Toolbar } from "/scripts/ui/components/Toolbar.js";

import { Tooltip } from "/scripts/ui/components/Tooltip.js";
import { unescapeHTML } from "/scripts/core/utils/StringHelper.js";

var tooltip = new Tooltip();

const ultraviner = env.data.ultraviner; //If Ultravine is detected, Vine Helper will deactivate itself to avoid conflicts.

//Constants
env.data.NOT_DISCARDED_ORDER_SUCCESS = -4;
env.data.NOT_DISCARDED = 0;
env.data.DISCARDED_ORDER_FAILED = 4;

const VERSION_MAJOR_CHANGE = 3;
const VERSION_MINOR_CHANGE = 2;
const VERSION_REVISION_CHANGE = 1;
const VERSION_NO_CHANGE = 0;

//Timing variable used to wait until the status change before proceeding with further code
var toolbarsDrawn = false;
var productUpdated = false;

const DEBUGGER_TITLE = "Vine Helper - Debugger";
const VINE_INFO_TITLE = "Vine Helper update info";
const GDPR_TITLE = "Vine Helper - GDPR";

var notificationMonitor = null;
var channel = new BroadcastChannel("vinehelper-notification-monitor");
var promotionId = null; //Amazon checkout process
var checkoutAsin = null; //Amazon checkout process
var monkeyPatcherLoaded = false; //Will turn to true when inj.js is loaded

//Do not run the extension if ultraviner is running
if (!ultraviner) {
	init();
}

//#########################
//### Helper functions

// Helper function to show the grid and clean up BlindLoading
function showGridContainer() {
	const gridContainer = document.querySelector("#vvp-items-grid-container");
	if (!gridContainer) return;

	// Signal that VineHelper is ready to show content
	window.vhReadyToShow = true;

	// Add attribute to body to allow CSS to show the containers
	document.body.setAttribute("data-vh-ready", "true");

	// Clean up the MutationObserver if BlindLoading was enabled
	if (window.vhBlindLoadingObserver) {
		window.vhBlindLoadingObserver.disconnect();
		window.vhBlindLoadingObserver = null;
	}

	// Show the grid (remove any inline styles that might have been set)
	gridContainer.style.visibility = "";
	gridContainer.style.opacity = "";
	gridContainer.style.display = "";

	// Also ensure the parent containers are visible
	const itemsGrid = document.querySelector("#vvp-items-grid");
	if (itemsGrid) {
		itemsGrid.style.visibility = "";
		itemsGrid.style.opacity = "";
		itemsGrid.style.display = "";
	}

	const itemsContainer = document.querySelector(".vvp-items-container");
	if (itemsContainer) {
		itemsContainer.style.visibility = "";
		itemsContainer.style.opacity = "";
		itemsContainer.style.display = "";
	}
}

//#########################
//### Main flow

//Initiate the extension
async function init() {
	//if (window.location.href.endsWith("#AR")) {
	//Check if page is dogpage
	if (isPageDog(document)) {
		channel.postMessage(await cryptoKeys.encryptJSON({ type: "dogpage" }));
		return;
	}
	if (isPageCaptcha(document)) {
		channel.postMessage(await cryptoKeys.encryptJSON({ type: "captchapage" }));
		return;
	}
	if (isPageLogin(document)) {
		console.log("loginpage detected");
		channel.postMessage(await cryptoKeys.encryptJSON({ type: "loginpage" }));
		return;
	}
	//}

	//Add a div to the body to indicate VH's status(es)
	const divStatus = document.createElement("div");
	divStatus.id = "vh-status";
	divStatus.style.display = "none";
	document.body.appendChild(divStatus);

	hookMgr.hookBind("productsUpdated", () => {
		//Add a div to the body with a data-status attribute to indicate the products
		//have been updated.
		const div = document.getElementById("vh-status");
		div.setAttribute("data-status", "productsUpdated");
	});

	//Wait for the config to be loaded before running this script
	logger.add("BOOT: Waiting on preboot to complete...");
	await Settings.waitForLoad();
	logger.add("BOOT: Config available. Begining init() function");

	if (Settings.get("thorvarium.darktheme")) {
		document.getElementsByTagName("body")[0].classList.add("darktheme");
	}

	//If the UUID is not set, display a toaster notification that the UUID request failed.
	await env.waitForUUID();
	if (!Settings.get("general.uuid", false)) {
		const err = Settings.get("general.uuidError", false);

		//Display a toaster notification that the UUID request failed.
		const notification = new ScreenNotification();
		notification.title = "UUID request failed";
		if (err === "VPN") {
			notification.content =
				"Vine Helper failed to create an account for this device. Please ensure you are not using a VPN or proxy (including iCloud Private Relay). If the issue persist, please contact the developer.";
		} else if (err === "Banned") {
			notification.content = "This device is banned from Vine Helper. Please contact the developer.";
		} else {
			notification.content = `Vine Helper failed to create an account for this device for an unknown reason(${err}). If the issue persist, please contact the developer.`;
		}
		Notifications.pushNotification(notification);
	}

	//### Run the boot sequence
	initAddNotificationMonitorLink();
	hidePageContent();
	showGDPRPopup();
	await initFlushTplCache(); //And display the version changelog popup
	initInjectScript();
	checkURL();

	//Check if we want to display the notifications monitor
	const currentUrl = window.location.href;
	let regex = /^[^#]+#monitor.*$/;
	let arrMatches = currentUrl.match(regex);
	if (arrMatches != null) {
		env.data.monitorActive = true;
		if (Settings.get("notification.monitor.listView")) {
			logger.add("BOOT: Loading listView stylesheet");
			loadStyleSheet("resource/css/listView.css");
		}

		//Initate the notifications monitor
		// CRITICAL: Clean up any existing instance to prevent memory leaks
		if (notificationMonitor) {
			console.log("🧹 Cleaning up existing NotificationMonitor instance before creating new one");
			try {
				notificationMonitor.destroy();
			} catch (error) {
				console.error("Error destroying previous NotificationMonitor:", error);
			}
			notificationMonitor = null;

			// Force garbage collection hint
			if (window.gc) {
				window.gc();
			}
		}

		notificationMonitor = new NotificationMonitorV3();
		await notificationMonitor.initialize();

		// Show the grid for notification monitor
		showGridContainer();

		hookMgr.hookExecute("productsUpdated", null);
		return; //Do not initialize the page as normal
	}

	// If a search has been performed, unescape the HTML encoded characters for the line
	// X item(s) matching "[SEARCH STRING WITH HTML ENCODED CHARACTERS]"
	const gridContainer = document.querySelector("#vvp-items-grid-container");
	if (gridContainer) {
		for (const node of gridContainer.childNodes) {
			if (node.nodeName === "P") {
				const matchingSearchText = node.textContent;

				if (matchingSearchText) {
					node.textContent = unescapeHTML(unescapeHTML(matchingSearchText));
				}
			}
		}
	}

	// If a search has been performed, unescape the HTML encoded characters for the text in the search box
	const searchTextInput = document.querySelector("#vvp-search-text-input");
	if (searchTextInput) {
		searchTextInput.value = unescapeHTML(unescapeHTML(searchTextInput.value));
	}

	if (Settings.get("general.blindLoading")) {
		// Hide the grid during initial processing to prevent flicker
		// This prevents users from seeing tiles being rearranged, sorted, and filtered
		if (gridContainer) {
			gridContainer.style.display = "none";
			logger.add("BOOT: Blind loading enabled - hiding grid during initial processing");
		}
	}

	if (Settings.get("general.listView")) {
		logger.add("BOOT: Loading listView stylesheet");
		loadStyleSheet("resource/css/listView.css");
	} else {
		initTileSizeWidget();
	}
	await initCreateTabs(); //Create the 4 grids/tabs
	logger.add("BOOT: Waiting for environment to load");
	await env.waitForLoad(); // Ensure environment is loaded before creating toolbars
	logger.add("BOOT: Environment loaded");
	await initTilesAndDrawToolbars(); //Create the tiles, and move the locally hidden tiles to the hidden tab
	fetchProductsDatav5(); //Obtain the data to fill the toolbars with it.

	displayAccountData();
	displayReviewListData();
	loadPinnedList();
	initSetPageTitle();
	initInsertTopPagination();
	await initInsertBookmarkButton();
	initFixPreviousButton();
	initModalNagivation();
	page.updateTileCounts();

	hookMgr.hookExecute("EndOfBootloader", null);

	HiddenList.garbageCollection();
}

async function initTileSizeWidget() {
	if (Settings.get("general.tileSize.active")) {
		const container = document.querySelector("#vvp-items-grid-container");
		if (container) {
			if (Settings.get("general.tileSize.enabled")) {
				//Inject the GUI for the tile sizer widget
				tileSizer.injectGUI(container);
			}
		}
	}

	//Display full descriptions
	//Not all of them are loaded at this stage and some get skipped.
	//container.querySelector(".a-truncate-full").classList.remove("a-offscreen");
	//container.querySelector(".a-truncate-cut").style.display = "none";

	//Set the slider default value
	//Wait until the items are loaded.
	if (!Settings.get("general.listView")) {
		hookMgr.hookBind("tilesUpdated", () => {
			tileSizer.adjustAll();
		});
	}
}

//If we are on the Review List page, display additional info
async function displayReviewListData() {
	if (!Settings.isPremiumUser(2) || !Settings.get("general.reviewSubmissionMarker")) {
		return;
	}

	let regex = /^.+?amazon\..+\/vine\/vine-reviews.*$/;
	let arrMatches = window.location.href.match(regex);
	if (arrMatches == null) return;

	//Add a column into the table
	const table = document.querySelector("table.vvp-reviews-table");
	if (!table) return;

	const rows = table.querySelectorAll("tr");
	const arrAsin = [];
	rows.forEach((row, idx) => {
		// Header row (idx === 0)
		if (idx === 0) {
			const th = document.createElement("th");
			th.textContent = "Submitted";
			// Insert before "Review status"
			const reviewStatusTh = row.querySelector("#vvp-reviews-table--review-content-heading");
			row.insertBefore(th, reviewStatusTh);
			return;
		}

		// Data rows
		const td = document.createElement("td");
		td.className = "vvp-reviews-table--select-col";

		// Find "Review item" link in this row
		const reviewLink = row.querySelector('a[name="vvp-reviews-table--review-item-btn"]');
		if (reviewLink) {
			const url = new URL(reviewLink.href);
			const asin = url.searchParams.get("asin");
			if (asin) {
				arrAsin.push(asin);
				const input = document.createElement("input");
				input.type = "checkbox";
				input.id = "review_" + asin;
				input.addEventListener("click", (e) => {
					notifyServerOfReviewCompleted(asin, input.checked);
				});
				td.appendChild(input);
			}
		}

		// Insert before "Review status" column
		const reviewStatusTd = row.querySelector(".vvp-reviews-table--text-col:nth-of-type(4)");
		row.insertBefore(td, reviewStatusTd);
	});

	//Fetch the reviews from the server
	const data = {
		api_version: 5,
		app_version: env.data.appVersion,
		action: "get_recordedreview",
		country: i13n.getCountryCode(),
		uuid: await Settings.get("general.uuid", false),
		fid: await Settings.get("general.fingerprint.id", false),
		cid: await env.getCID(),
		arr_asin: arrAsin,
	};
	const s = await cryptoKeys.signData(data);
	data.s = s;
	data.pk = await cryptoKeys.getExportedPublicKey();
	const response = await fetch(env.getAPIUrl(), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(data),
	});
	const responseData = await response.json();
	if (responseData["ok"] === "ok") {
		for (const asin of arrAsin) {
			const reviewed = responseData["arr_asin"][asin];
			const chkReview = document.getElementById("review_" + asin);
			if (chkReview) {
				chkReview.checked = reviewed;
			}
		}
	}
}

async function notifyServerOfReviewCompleted(asin, done) {
	//Wait for the settings to be loaded
	while (!Settings || !Settings.isLoaded()) {
		await new Promise((r) => setTimeout(r, 10));
	}

	if (!Settings.isPremiumUser(2)) {
		return;
	}

	//Update the server with the new ETV
	const content = {
		api_version: 5,
		app_version: env.data.appVersion,
		action: "record_review",
		country: await Settings.get("general.country", false),
		uuid: await Settings.get("general.uuid", false),
		fid: await Settings.get("general.fingerprint.id", false),
		cid: await Settings.get("general.cid", false),
		asin: asin,
		done: done,
	};
	const s = await cryptoKeys.signData(content);
	content.s = s;
	content.pk = await cryptoKeys.getExportedPublicKey();

	// Perform your fetch
	await fetch(env.getAPIUrl(), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(content),
	})
		.then((response) => response.json())
		.then((data) => {
			// Your fetch completed successfully
		})
		.catch((error) => {
			console.error("Fetch failed:", error);
		});
}

//If we are on the Account page, display additional info
function displayAccountData() {
	let regex = /^.+?amazon\..+\/vine\/account?$/;
	let arrMatches = window.location.href.match(regex);
	if (arrMatches == null) return;

	//Add the Evaluation Metric styling:
	displayAccountDataEvaluationMetrics();

	//Hide Opt out of Vine button
	displayAccountHideOptOutButton();

	//Add a container to the status table
	const statusBox = document.getElementById("vvp-current-status-box");
	if (!statusBox) {
		console.warn("[VineHelper] vvp-current-status-box element not found on account page");
		return;
	}

	statusBox.style.height = "auto";
	if (!statusBox.children || statusBox.children.length === 0) {
		console.warn("[VineHelper] vvp-current-status-box has no children");
		return;
	}

	let elem = statusBox.children[0];
	let parentContainer = document.createElement("div");
	parentContainer.classList.add("a-row");
	elem.append(parentContainer);

	let container = document.createElement("div");
	//container.classList.add("a-column");
	container.classList.add("theme-default");
	container.classList.add("vh-container");
	container.id = "account-extra-stats";
	parentContainer.append(container);

	let date;
	let div;
	div = document.createElement("div");

	// Create header
	const header = document.createElement("h4");
	header.textContent = "Vine Helper extra stats:";
	div.appendChild(header);

	// Create customer ID section
	const customerIdStrong = document.createElement("strong");
	customerIdStrong.textContent = "Customer Id: ";
	div.appendChild(customerIdStrong);

	const customerIdSpan = document.createElement("span");
	customerIdSpan.className = "masked-text";
	customerIdSpan.textContent = escapeHTML(env.getCustomerId());
	div.appendChild(customerIdSpan);

	// Add line breaks
	div.appendChild(document.createElement("br"));
	div.appendChild(document.createElement("br"));

	container.appendChild(div);

	const additionalStats = {
		acceptanceDate: "Acceptance date",
		statusEarnedDate: "Status earned date",
		reevaluationDate: "Re-evaluation date",
	};

	for (const [key, value] of Object.entries(additionalStats)) {
		date = new Date(env.getVoiceDetails(key)).toLocaleString(i13n.getLocale());
		div = document.createElement("div");

		// Create strong element for the label
		const strongLabel = document.createElement("strong");
		strongLabel.textContent = value + ":";
		div.appendChild(strongLabel);

		// Add line break
		div.appendChild(document.createElement("br"));

		// Add space and date
		div.appendChild(document.createTextNode(" " + date));

		// Add two line breaks
		div.appendChild(document.createElement("br"));
		div.appendChild(document.createElement("br"));

		container.appendChild(div);
	}

	div = document.createElement("div");

	// Create strong element for the label
	const reevalStrong = document.createElement("strong");
	reevalStrong.textContent = "Re-evaluation in progress:";
	div.appendChild(reevalStrong);

	// Add space and value
	div.appendChild(document.createTextNode(" " + escapeHTML(env.getVoiceDetails("isTierEvaluationInProgress"))));

	container.appendChild(div);
}

async function hidePageContent() {
	//Hide recommendation and browsing history
	if (Settings.isPremiumUser() && Settings.get("general.hideRecommendations") == true) {
		const rhf = document.getElementById("rhf");
		if (rhf) {
			rhf.style.display = "none";
		}
	}

	//Hide side cart
	if (Settings.isPremiumUser() && Settings.get("general.hideSideCart") == true) {
		//Firefox will load the side cart before VH run this code, and it will also reset the display value to the default.
		//So we need to wait for the side cart to be created, and then observe it to make sure it gets hidden again after it's modified.
		//Wait for nav-flyout-ewc to be created, without interupting the main thread
		(async () => {
			let sideCart, sideCartArrow;
			await new Promise((resolve) => {
				const interval = setInterval(() => {
					sideCart = document.getElementById("nav-flyout-ewc");
					sideCartArrow = document.querySelector(".nav-ewc-arrow");
					if (sideCart) {
						clearInterval(interval);
						resolve();
					}
				}, 100);
			});

			sideCart.style.display = "none";
			sideCartArrow.style.display = "none";

			//Observe the side cart style.display value to be alerted if it becomes something else than "none"
			const observer = new MutationObserver((mutations) => {
				mutations.forEach((mutation) => {
					if (mutation.type === "attributes" && mutation.attributeName === "style") {
						if (sideCart.style.display !== "none") {
							sideCart.style.display = "none"; // Force it back to hidden
						}
					}
				});
			});

			observer.observe(sideCart, { attributes: true });
		})();
	}

	//Hide category in RFY and AFA
	if (Settings.isPremiumUser() && Settings.get("general.hideCategoriesRFYAFA")) {
		//If the current page is RFY or AFA, hide the category
		await env.waitForLoad();
		if (["last_chance", "potluck"].indexOf(env.data.vineQueue) != -1) {
			const categories = document.getElementById("vvp-browse-nodes-container");
			if (categories) {
				categories.style.display = "none";
			}
		}
	}
}
function displayAccountHideOptOutButton() {
	if (Settings.isPremiumUser() && Settings.get("general.hideOptOutButton") == true) {
		const optOut = document.getElementById("vvp-opt-out-of-vine-button");
		if (optOut) {
			optOut.style.display = "none";
		}
	}
}

/**
 * Contribution from https://github.com/robartsd/VineTools/blob/main/evaluationMetrics.user.js
 */
function displayAccountDataEvaluationMetrics() {
	if (!Settings.get("general.projectedAccountStatistics")) {
		return false; //Setting not activated.
	}

	const periodEnd = new Date(parseInt(document.querySelector("#vvp-eval-end-stamp").innerText));

	if (document.querySelector("#vvp-evaluation-date-string > strong")) {
		document.querySelector("#vvp-evaluation-date-string > strong").innerText = periodEnd.toLocaleString();
	}

	const percent = Math.round(
		parseFloat(
			document.querySelector(
				"#vvp-perc-reviewed-metric-display p:nth-child(-n+2) *:is(strong, .a-size-extra-large)"
			).innerText
		)
	); //Vine seems to always round to whole percent but sometimes displays inaccurate tenths
	if (percent > 0) {
		const metricsBox = document.querySelector("#vvp-vine-activity-metrics-box, #vvp-vine-account-details-box");
		metricsBox.dataset.percent = percent;
		const count = parseInt(
			document
				.querySelector("#vvp-num-reviewed-metric-display p:nth-child(-n+2) *:is(strong, .a-size-extra-large)")
				.innerText.replaceAll(/\D+/g, "")
		); //review count should alwasy be integer remove possible thousands separator
		metricsBox.dataset.count = count;
		const orderCount = Math.round((count / percent) * 100);
		metricsBox.dataset.orderCountEstimate = orderCount;
		// order min/max estimate assumes that percentage is rounded down
		const orderMin = Math.floor((count / (percent + 1)) * 100) + 1;
		metricsBox.dataset.orderCountMin = orderMin;
		const orderMax = Math.max(Math.floor((count / percent) * 100), orderMin);
		metricsBox.dataset.orderCountMax = orderMax;
		const awaitingMin = orderMin - count;
		metricsBox.dataset.awaitingCountMin = awaitingMin;
		const awaitingMax = orderMax - count;
		metricsBox.dataset.awaitingCountMax = awaitingMax;
		const targetMin = Math.max(Math.ceil(orderMin * 0.9) - count, 0);
		metricsBox.dataset.targetMin = targetMin;
		const targetMax = Math.ceil(orderMax * 0.9) - count;
		metricsBox.dataset.targetMax = targetMax;
		const orderEstimate = orderMin == orderMax ? orderMax : `${orderMin}-${orderMax}`;
		const awaitingEstimate = awaitingMin == awaitingMax ? awaitingMax : `${awaitingMin}-${awaitingMax}`;
		const targetRequired = targetMin == targetMax ? targetMax : `${targetMin}-${targetMax}`;
		if (awaitingMax > 0) {
			const reviewElement = document.querySelector(
				"#vvp-num-reviewed-metric-display p:nth-child(-n+2):has(strong, .a-size-extra-large"
			);
			if (reviewElement) {
				reviewElement.replaceChildren();

				const countSpan = document.createElement("span");
				countSpan.className = "a-size-extra-large";
				countSpan.textContent = count + " ";
				reviewElement.appendChild(countSpan);

				reviewElement.appendChild(document.createTextNode(awaitingEstimate + " items await review"));
			}
		}

		if (targetMax > 0) {
			const percElement = document.querySelector(
				"#vvp-perc-reviewed-metric-display p:nth-child(-n+2):has(strong, .a-size-extra-large"
			);
			if (percElement) {
				percElement.replaceChildren();

				const percentSpan = document.createElement("span");
				percentSpan.className = "a-size-extra-large";
				percentSpan.textContent = percent + "%";
				percElement.appendChild(percentSpan);

				percElement.appendChild(
					document.createTextNode(` of ${orderEstimate} items; ${targetRequired} more required to reach 90%`)
				);
			}
		} else {
			const percElement = document.querySelector(
				"#vvp-perc-reviewed-metric-display p:nth-child(-n+2):has(strong, .a-size-extra-large"
			);
			if (percElement) {
				percElement.replaceChildren();

				const percentSpan = document.createElement("span");
				percentSpan.className = "a-size-extra-large";
				percentSpan.textContent = percent + "%";
				percElement.appendChild(percentSpan);

				percElement.appendChild(document.createTextNode(` of ${orderEstimate} items`));
			}
		}

		const periodStart = new Date(parseInt(document.querySelector("#vvp-eval-start-stamp").innerText));
		const periodFraction = (new Date().setUTCHours(0, 0, 0, 0) - periodStart) / (periodEnd - periodStart);
		if (periodFraction > 0 && periodFraction < 1) {
			const projectedCount = count / periodFraction;
			metricsBox.dataset.projectedReviewCount = projectedCount.toFixed(1);
			const projectedOrders = orderCount / periodFraction;
			metricsBox.dataset.projectedOrderCount = projectedOrders.toFixed(1);
			const projectedPercent = (projectedOrders - awaitingMax) / projectedOrders;
			metricsBox.dataset.projectedReviewPercent = (projectedPercent * 100).toFixed(1);
			const countBar = document.querySelector(
				"#vvp-num-reviewed-metric-display [class*='animated-progress'] span"
			);
			const percentBar = document.querySelector(
				"#vvp-perc-reviewed-metric-display [class*='animated-progress'] span"
			);

			if (projectedCount < 70) {
				countBar.style.backgroundColor = "red";
			} else if (projectedCount < 77) {
				countBar.style.backgroundColor = "orange";
			} else if (projectedCount < 80) {
				countBar.style.backgroundColor = "yellow";
			}

			if (projectedPercent < 0.8) {
				percentBar.style.backgroundColor = "red";
			} else if (projectedPercent < 0.88) {
				percentBar.style.backgroundColor = "orange";
			} else if (projectedPercent < 0.92) {
				percentBar.style.backgroundColor = "yellow";
			}
		}
	}
}

async function showGDPRPopup() {
	if (Settings.get("general.GDPRPopup", false) == true || Settings.get("general.GDPRPopup", false) == undefined) {
		const prom = await Tpl.loadFile("scripts/ui/templates/popup_gdpr.html");
		let content = Tpl.render(prom);

		let m = DialogMgr.newModal("gdpr");
		m.title = GDPR_TITLE;
		m.content = content;
		m.show();

		await Settings.set("general.GDPRPopup", false);
	}
}
async function initFlushTplCache() {
	if (env.data.appVersion == null) {
		return false;
	}

	//Show version info popup : new version
	if (env.data.appVersion != Settings.get("general.versionInfoPopup", false)) {
		logger.add("BOOT: Flushing template cache");
		await Tpl.flushLocalStorage(); //Delete all template from cache

		let notification = new ScreenNotification();
		notification.title = "Template cache flushed.";
		notification.lifespan = 3;
		notification.content = "";
		notification.title_only = true;
		Notifications.pushNotification(notification);

		if (
			compareVersion(Settings.get("general.versionInfoPopup", false), env.data.appVersion) >
			VERSION_REVISION_CHANGE
		) {
			/*
			//First installs don't need v3.5 warning.
			if (!Settings.get("general.versionInfoPopup", false)) {
				await Settings.set("general.warning350", true);
			}
			if (!Settings.get("general.warning350", false)) {
				let warning = DialogMgr.newModal("warning");
				warning.title = "/!\\ Warning";
				warning.content =
					"Vine Helper 3.5.0 requires a <strong><u>reload of ALL VINE RELATED TABS</u></strong>, incuding the notifications monitor(s). <br /><br />Failure to do so will likely lead to a loss of all locally stored hidden and pinned items.";
				warning.show();
				await Settings.set("general.warning350", true);
				return;
			}
			*/
			const prom = await Tpl.loadFile("scripts/ui/templates/popup_changelog.html");
			Tpl.setVar("appVersion", env.data.appVersion);
			let content = Tpl.render(prom);

			let m = DialogMgr.newModal("changelog");
			m.title = VINE_INFO_TITLE;
			m.content = content;
			m.show();

			//Recalculate the CID
			await env.getCID(true);
		}

		await Settings.set("general.versionInfoPopup", env.data.appVersion);
	}
}

function initInjectScript() {
	//Inject the script to fix the infinite loading wheel into the main environment.
	const scriptTag = document.createElement("script");

	scriptTag.setAttribute("data-country-code", i13n.getCountryCode());

	//Inject the infinite loading wheel fix to the "main world"
	scriptTag.src = chrome.runtime.getURL("scripts/inj.js");
	scriptTag.onload = function () {
		this.remove();
	};
	// see also "Dynamic values in the injected code" section in this answer
	(document.head || document.documentElement).appendChild(scriptTag);
	logger.add("BOOT: Script injected");
}

async function checkURL() {
	//Ensure inj.js is loaded
	while (!monkeyPatcherLoaded) {
		await new Promise((r) => setTimeout(r, 50));
	}

	//Check the current URL for the following pattern:
	///vine/vine-items#openModal;${asin};${is_parent_asin};${is_pre_release};${enrollment_guid}
	const currentUrl = window.location.href;
	let regex = /^[^#]+#openModal;(.+?)$/;
	let arrMatches = currentUrl.match(regex);
	if (arrMatches != null) {
		logger.add("BOOT: Open modal URL detected.");
		//We have an open modal URL
		const options = JSON.parse(decodeURIComponent(arrMatches[1]));
		openDynamicModal(options);
	}

	//Check the URL if we have to generate a checkoutform.
	let regex2 = /^[^#]+#checkoutForm;(.+?)$/;
	let arrMatches2 = currentUrl.match(regex2);
	if (arrMatches2 != null && env.isAmazonCheckoutEnabled()) {
		logger.add("BOOT: Checkout form URL detected.");
		const params = JSON.parse(decodeURIComponent(arrMatches2[1]));
		generateCheckoutForm(params.asin, params.promotionId, params.offerListingId);
	}
}

function initSetPageTitle() {
	//Update the page title
	let currentUrl = window.location.href;
	let regex = /^.+?amazon\..+\/vine\/.*[?&]search=(.*?)(?:[&#].*)?$/;
	let arrMatches = currentUrl.match(regex);
	if (arrMatches?.length) {
		document.title = "Vine - S: " + decodeURIComponent(arrMatches[1]);
	} else if (env.data.vineQueue != null) {
		document.title = "Vine - " + env.data.vineQueueAbbr;
	}

	//Add the category, is any, that is currently being browsed to the title of the page.
	regex = /^.+?amazon\..+\/vine\/.*[?&]pn=(.*?)(?:[&]cn=(.*?))?(?:[&].*)?$/;
	arrMatches = currentUrl.match(regex);
	if (arrMatches?.length === 3) {
		const selector = arrMatches[2] == undefined ? ".parent-node" : ".child-node";
		const selectedNode = document.querySelector(`#vvp-browse-nodes-container > ${selector} > a.selectedNode`);

		// Check if the element exists to avoid errors
		if (selectedNode) {
			// Get the text content of the element
			const selectedNodeText = selectedNode.textContent;
			document.title = document.title + " - " + selectedNodeText;
		}
	}
}

function initAddNotificationMonitorLink() {
	if (env.isMobileView()) {
		const header = document.querySelector("#vvp-header");
		const a = document.createElement("a");
		a.id = "vvp-mobile-header-link";
		a.classList.add("a-link-normal");
		a.style.display = "flex";
		a.style.alignItems = "center";
		a.style.gap = "0.25rem";
		a.href = "/vine/vine-items?queue=encore#monitor";
		a.target = "_blank";

		// Create icon div
		const iconDiv = document.createElement("div");
		iconDiv.className = "vh-icon-16 vh-icon-vh";
		a.appendChild(iconDiv);

		// Add text
		a.appendChild(document.createTextNode(" NM"));

		header.appendChild(a);
	} else {
		const ul = document.querySelector("ul.vvp-header-links-container");
		if (ul) {
			const li = document.createElement("li");
			li.classList.add("vvp-header-link");
			ul.appendChild(li);

			const a = document.createElement("a");
			//a.href = chrome.runtime.getURL("page/notifications.html");
			a.href = "/vine/vine-items?queue=encore#monitor";
			a.target = "_blank";
			a.style.display = "flex";
			a.style.alignItems = "center";
			a.style.gap = "0.25rem";

			// Create icon div
			const iconDiv = document.createElement("div");
			iconDiv.className = "vh-icon-16 vh-icon-vh";
			a.appendChild(iconDiv);

			// Add text
			a.appendChild(document.createTextNode(" Notifications Monitor"));

			li.appendChild(a);
		}
	}
}

/**
 * Load the pinned list from the local storage and add the tiles to the grid.
 * If the pinned list is cloud stored, it will be loaded when the get_info API request comes back.
 * @returns
 */
async function loadPinnedList() {
	if (document.getElementById("vvp-items-grid-container") == null) {
		//There is no listing on this page
		return;
	}

	//Populate the Pinned tab
	if (Settings.get("pinnedTab.active") && (!Settings.get("pinnedTab.remote") || !Settings.isPremiumUser(1))) {
		logger.add("GRID: Loading locally stored pinned list");
		let mapPin = new Map();
		mapPin = await PinnedList.getList();
		//Sort the map by date_added descending
		mapPin = new Map([...mapPin].sort((a, b) => a[1].date_added - b[1].date_added));
		mapPin.forEach(async (value, key) => {
			const tile = page.getTileByASIN(key);
			if (tile) {
				tile.setPinned(true);
			}
			const item = new Item({
				asin: key,
				queue: value.queue,
				title: value.title,
				img_url: value.thumbnail,
				is_parent_asin: value.is_parent_asin,
				enrollment_guid: value.enrollment_guid,
				unavailable: value.unavailable,
				is_pre_release: value.is_pre_release ? true : false,
			});
			page.addPinnedTile(item);
		});
	}
}

async function initCreateTabs() {
	//Create the Discard grid
	logger.add("BOOT: Creating tabs system");

	document.querySelector("body").classList.add("vh-listing-view");

	//Create the grid instances
	page.addGrid("vvp-items-grid", document.getElementById("vvp-items-grid"));

	var tabSystem = Settings.get("unavailableTab.active") || Settings.get("hiddenTab.active");
	if (tabSystem) {
		await page.createGridInterface();
	}

	if (Settings.get("hiddenTab.active")) {
		page.addGrid("tab-hidden", document.getElementById("tab-hidden"));
	}

	if (Settings.get("unavailableTab.active")) {
		page.addGrid("tab-unavailable", document.getElementById("tab-unavailable"));
	}

	if (Settings.get("pinnedTab.active")) {
		page.addGrid("tab-pinned", document.getElementById("tab-pinned"));
	}

	logger.add("BOOT: Grid system completed");
}

function initInsertTopPagination() {
	//Top pagination
	if (Settings.get("general.topPagination")) {
		const container = document.getElementById("vvp-items-grid-container");
		if (container == null) {
			//There is no listing on this page
			return;
		}
		container.querySelector(".topPagination")?.remove();
		container.querySelector(".topPaginationVerbose")?.remove();

		let currentPageDOM = document.querySelector("ul.a-pagination li.a-selected"); //If Null there is no pagination on the page
		if (
			Settings.isPremiumUser() &&
			Settings.get("general.verbosePagination") &&
			env.data.vineQueueAbbr == "AI" &&
			currentPageDOM != undefined
		) {
			//Fetch total items from the page
			const totalItemsElement = container.querySelector("p:last-of-type");
			if (!totalItemsElement) {
				return;
			}
			const totalText = totalItemsElement.innerText || totalItemsElement.textContent;
			const TOTAL_ITEMS = parseInt(totalText.match(/of ([\d,]+)/)[1].replace(/,/g, ""));
			const ITEM_PER_PAGE = 36;
			const currentPageText = currentPageDOM.innerText || currentPageDOM.textContent;
			const CURRENT_PAGE = parseInt(currentPageText.replace(/,/g, ""));

			const URL = window.location.pathname + window.location.search; //Sample URL to be modified
			pagination.setStartPagePadding(parseInt(Settings.get("general.verbosePaginationStartPadding")));
			let paginationObj = pagination.generatePagination(URL, TOTAL_ITEMS, ITEM_PER_PAGE, CURRENT_PAGE);

			// Always create a new p element at the top for verbose pagination
			const p = document.createElement("p");
			//Insert the p as the first element of container
			container.insertBefore(p, container.firstChild);
			p.appendChild(paginationObj);
		} else {
			// Clone the bottom pagination to the top of the listing
			let paginationElement = document.querySelector(".a-pagination");
			if (paginationElement != null) {
				let parentElement = paginationElement.parentNode;
				parentElement.style.marginTop = "10px";

				// Clone the parent element
				let clonedElement = parentElement.cloneNode(true);
				clonedElement.classList.add("topPagination");
				const desktopContainer = container.querySelector("p");
				if (desktopContainer) {
					desktopContainer.appendChild(clonedElement);
				} else {
					const p = document.createElement("p");
					const tileSizeToolContainer = document.querySelector("#vh-tile-size-tool-container");
					if (tileSizeToolContainer) {
						container.insertBefore(p, tileSizeToolContainer.nextSibling);
					} else {
						container.insertBefore(p, container.firstChild);
					}
					p.appendChild(clonedElement);
				}
			}
		}
	}
}

async function setBookmarkDate(timeOffset) {
	//Fetch the current date/time from the server
	const data = {
		api_version: 5,
		app_version: env.data.appVersion,
		action: "date",
		country: i13n.getCountryCode(),
		uuid: await Settings.get("general.uuid", false),
		fid: await Settings.get("general.fingerprint.id", false),
		cid: await env.getCID(),
	};
	const s = await cryptoKeys.signData(data);
	data.s = s;
	data.pk = await cryptoKeys.getExportedPublicKey();

	const options = {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(data),
	};
	fetch(env.getAPIUrl(), options)
		.then((response) => response.json())
		.then(async function (response) {
			await Settings.set(
				"general.bookmarkDate",

				new Date(YMDHiStoISODate(response.date).getTime() - timeOffset).toString()
			);

			//Update the tooltip
			document.querySelectorAll("#bookmark button").forEach((button) => {
				button.title = "Currently set to: " + Settings.get("general.bookmarkDate");
			});

			let note = new ScreenNotification();
			note.title = "Marker set !";
			note.lifespan = 30;
			note.content =
				"Marker set for <br />" +
				Settings.get("general.bookmarkDate") +
				"<br />Newer items will be highlighted.";
			await Notifications.pushNotification(note);
		});
}

async function initInsertBookmarkButton() {
	//Insert bookmark button
	if (Settings.get("general.displayFirstSeen") && Settings.get("general.bookmark")) {
		page.removeElements("button.bookmark");
		const prom = await Tpl.loadFile("scripts/ui/templates/bookmark.html");
		Tpl.setVar("date", Settings.get("general.bookmarkDate"));
		let bookmarkContent = Tpl.render(prom, true);

		const container = document.querySelector(".vvp-items-button-and-search-container");
		if (container) {
			container.parentNode.insertBefore(bookmarkContent, container.nextSibling);
		}
		const button0 = document.querySelector("button.bookmarknow");
		if (button0) {
			button0.addEventListener("click", function (event) {
				setBookmarkDate(0);
			});
		}
		const button3 = document.querySelector("button.bookmark3");
		if (button3) {
			button3.addEventListener("click", function (event) {
				setBookmarkDate(3 * 60 * 60 * 1000);
			});
		}

		const button12 = document.querySelector("button.bookmark12");
		if (button12) {
			button12.addEventListener("click", function (event) {
				setBookmarkDate(12 * 60 * 60 * 1000);
			});
		}

		const button24 = document.querySelector("button.bookmark24");
		if (button24) {
			button24.addEventListener("click", function (event) {
				setBookmarkDate(24 * 60 * 60 * 1000);
			});
		}
	}
}

function initFixPreviousButton() {
	//Place the text-content of the Previous button before the other child elements.
	//This is to enable the first letter of the previous button to be styled for the keybinding.

	let textContent = "";
	document.querySelectorAll("ul.a-pagination li:first-child a").forEach(function (item) {
		if (item.childNodes[3] != undefined) {
			textContent = item.childNodes[3].nodeValue;
			item.childNodes[3].nodeValue = "";
		}
	});

	//console.log(text);
	page.removeElements(".vh-pagination-previous");

	document
		.querySelectorAll("div:not([class*='topPaginationVerbose']) > ul.a-pagination li:first-child a")
		.forEach((div) => {
			const span = document.createElement("span");
			span.className = "vh-pagination-previous";
			span.textContent = textContent;

			div.appendChild(span);
		});
}
async function initTilesAndDrawToolbars() {
	//Browse each items from the Regular grid
	//- Create an array of all the products listed on the page
	//- Create an empty toolbar for the item tile
	//- Create the tooltip to display full titles when hovering item names
	const arrObj = document.querySelectorAll(".vvp-item-tile:not(.pinned)");
	let tile = null;
	let a = null;
	for (let i = 0; i < arrObj.length; i++) {
		try {
			tile = await generateTile(arrObj[i]);

			// Always create toolbar, even for tiles without ASINs
			// Some tiles may have ASINs in the DOM but fail extraction
			let t = new Toolbar(tile);

			if (!tile.getAsin()) {
				logger.add("WARNING: Creating toolbar for tile without extracted ASIN");
			}

			//Add tool tip to the truncated item title link
			if (Settings.get("general.displayFullTitleTooltip")) {
				const titleDOM = arrObj[i].querySelector(".a-link-normal");
				//If the item does not have a title link, do not display the tooltip.
				if (titleDOM) {
					tooltip.addTooltip(titleDOM, unescapeHTML(unescapeHTML(tile.getTitle())));
				}
			}

			//Wrap the See Details button in a span with the class vh-see-details-container
			const seeDetails =
				arrObj[i].querySelector(".vvp-details-btn") || arrObj[i].querySelector(".vvp-details-btn-mobile");
			if (seeDetails) {
				const span = document.createElement("span");
				span.classList.add("vh-btn-container");
				span.style.display = "flex";
				seeDetails.insertAdjacentElement("beforebegin", span);

				//Move the seeDetails button as a child span
				span.appendChild(seeDetails);
			}

			//Generate the toolbar
			await t.createProductToolbar();
		} catch (e) {
			logger.add("Error processing tile: " + e.message);
			continue; // Skip this tile and continue with others
		}
	}
	logger.add("done creating toolbars.");

	// Scroll to the RFY/AFA/AI header
	if (Settings.get("general.scrollToRFY")) {
		var scrollTarget = document.getElementById("vvp-items-button-container");
		if (scrollTarget) {
			// Use instant scroll instead of smooth to avoid visible scrolling
			scrollTarget.scrollIntoView({ behavior: "instant", block: "start" });
		}
	}

	toolbarsDrawn = true;
	hookMgr.hookExecute("tilesUpdated", null);
}

//This function will return an array of all the product on the page, with their description and thumbnail url
async function getAllProductsData() {
	let arrUrl = []; //Will be use to store the URL identifier of the listed products.
	const arrObj = document.querySelectorAll(".vvp-item-tile:not(.pinned)");
	if (arrObj.length == 0) {
		return [];
	}

	for (let i = 0; i < arrObj.length; i++) {
		let tile = Tile.getTileFromDom(arrObj[i]);
		if (!tile) {
			continue; // Skip tiles that couldn't be created
		}
		tile.initiateTile(); //Do not await this.

		const asin = tile.getAsin();
		if (!asin) {
			continue; // Skip tiles without ASIN
		}
		const btn = arrObj[i].querySelector(`input[data-asin="${asin}"]`);
		if (!btn) {
			continue;
		}
		const isParent = btn.dataset.isParentAsin == "true";
		const isPreRelease = btn.dataset.isPreRelease == "true";
		const enrollmentGUID = Item.getEnrollmentGuidFromRecommendationId(btn.dataset.recommendationId);
		const title = tile.getTitle();
		const thumbnail = tile.getThumbnailURL();

		//Get the queue from the item's information
		const recommendationId = btn.dataset.recommendationId;
		const recommendationType = btn.dataset.recommendationType;
		const queue = Item.getQueueFromData(recommendationType, recommendationId);

		//Do not query product info for product without a title or a thumbnail.
		if (title && thumbnail) {
			arrUrl.push({
				asin: asin,
				title: title,
				thumbnail: thumbnail,
				is_parent_asin: isParent,
				is_pre_release: isPreRelease,
				enrollment_guid: enrollmentGUID,
				queue: queue,
			});
		}
	}
	return arrUrl;
}

//Convert the regular tile to the Vine Helper version.
async function generateTile(obj) {
	const grid = page.getGrid("vvp-items-grid");
	const tile = new Tile(obj, grid);
	// Check if tile was created without ASIN
	if (!tile.getAsin()) {
		logger.add("WARNING: Tile without ASIN, attempting to continue with DOM setup");
	} else {
		grid.addTile(tile);
	}

	//Add a container for the image and place the image in it.
	let img = obj.querySelector(".vvp-item-tile-content img"); // Get the img element
	if (!img) {
		logger.add("WARNING: No image found for tile");
		return tile;
	}
	let imgContainer = document.createElement("div"); // Create a new div element
	imgContainer.classList.add("vh-img-container"); // Add the 'vh-img-container' class to the div
	img.parentNode.insertBefore(imgContainer, img); // Insert the imgContainer before the img element

	// Remove (detach) the img from its parent node
	//img.parentNode.removeChild(img); //No need to detach the img.
	imgContainer.appendChild(img); // Move the img into the imgContainer

	//If the listing are set to listview, move the image container before its parent item.
	if (Settings.get("general.listView")) {
		imgContainer.style.width = "100px";
		//imgContainer.parentNode.removeChild(imgContainer);
		//obj.insertBefore(imgContainer, obj.firstChild);
		obj.prepend(imgContainer);
		obj.classList.add("vh-listview");

		//Display the full titles
		/*
		//Don't work because a-offscreen class are still in the process of being applied when this code run.
		const full = obj.querySelector(".a-truncate-full");
		console.log(full);
		console.log(full.classList);
		full.classList.remove("a-offscreen");
		console.log(full.classList);
		obj.querySelector(".a-truncate-cut").classList.add("a-offscreen");
		*/
	} else {
		obj.classList.add("vh-gridview");
	}

	//If small items stylesheet are used, add a class to resize-down the thumnails.
	if (Settings.get("thorvarium.smallItems")) {
		document.querySelector("#vh-tabs").classList.add("smallitems");
	}
	if (
		(Settings.get("thorvarium.mobileios") || Settings.get("thorvarium.mobileandroid")) &&
		!Settings.get("general.tileSize.enabled")
	) {
		document.querySelector("#vh-tabs").classList.add("smallitems");
	}

	//Move the hidden item to the hidden tab
	await tile.setLocalTileVisibility();
	if (Settings.get("hiddenTab.active") && (await tile.isHidden())) {
		logger.add("BOOT: The item is locally hidden, move it to the hidden grid.");
		await tile.moveToGrid(page.getGrid("tab-hidden"), false); //This is the main sort, do not animate it
	}

	//Add the variant icon to the tile
	if (Settings.isPremiumUser(2) && Settings.get("general.displayVariantIcon")) {
		//Check if the item is a parent ASIN (as variants)
		let buttonInput = obj.querySelector(".a-button-input");
		if (!buttonInput) {
			logger.add("WARNING: No button input found for variant check");
		} else {
			let variant = buttonInput.getAttribute("data-is-parent-asin");

			if (variant === "true") {
				// Find the image container in the DOM
				let imgContainerDOM = obj.querySelector(".vh-img-container");
				if (imgContainerDOM) {
					// Create the div element and add a class
					let div = document.createElement("div");
					div.classList.add("vh-variant-indicator-container");
					imgContainerDOM.appendChild(div);

					// Create the <a> element with a link that does nothing
					let alink = document.createElement("a");
					alink.href = "#";
					alink.setAttribute("onclick", "return false;");
					alink.setAttribute("title", "The item has variant(s).");
					alink.style.cursor = "default";
					div.appendChild(alink);

					// Create another div element for the icon and add classes
					let iconDiv = document.createElement("div");
					iconDiv.classList.add("vh-indicator-icon", "vh-icon-choice");
					alink.appendChild(iconDiv);
				}
			}
		}
	}

	return tile;
}

//Get data from the server about the products listed on this page
async function fetchProductsDatav5() {
	//Check if the page is loaded from cache
	if (!isSafari() && !isMobileBrowser()) {
		const nav = performance.getEntriesByType("navigation")[0];
		if (nav && nav.type === "navigate" && nav.transferSize === 0) {
			logger.add("FETCH: Page loaded from cache, skipping fetch.");
			return false;
		}
	}

	const arrProductsData = await getAllProductsData();
	if (arrProductsData.length == 0) {
		const gridContainer = document.querySelector("#vvp-items-grid-container");
		if (gridContainer) {
			if (!Settings.get("general.blindLoading")) {
				// Only show immediately if blind loading is disabled
				gridContainer.style.display = "block";
			} else {
				// Even with blind loading, we need to show the grid if there are no products
				showGridContainer();
			}
		}
		//return false; //No product on this page
	}

	logger.add("FETCH: Waiting on UUID to be available...");
	while ((await Settings.get("general.uuid", false)) == null) {
		await new Promise((r) => setTimeout(r, 100));
	}

	logger.add("FETCH: Waiting on environment to be loaded...");
	await env.waitForLoad();

	logger.add("FETCH: Fetching data from VineHelper's server...");
	const requestVariants = Settings.isPremiumUser(2) && Settings.get("general.displayVariantButton");
	const content = {
		api_version: 5,
		app_version: env.data.appVersion,
		action: "get_info",
		country: i13n.getCountryCode(),
		uuid: await Settings.get("general.uuid", false),
		fid: await Settings.get("general.fingerprint.id", false),
		cid: await env.getCID(),
		tier: env.getTierLevel(),
		queue: env.data.vineQueue || null,
		items: arrProductsData,
		request_variants: requestVariants,
		p: env.data.vinePageNumber || null,
	};
	content.s = await cryptoKeys.signData(content);
	content.pk = await cryptoKeys.getExportedPublicKey();

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 5000); // timeout in ms.

	fetch(env.getAPIUrl(), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(content),
		signal: controller.signal,
	})
		.then((response) => response.json())
		.then(serverProductsResponse)
		.catch(function (err) {
			if (err.name === "AbortError") {
				logger.add("FETCH: Server request timed out after 5 seconds");
			} else {
				logger.add("FETCH: Server request failed");
			}
			// Show grid on error
			showGridContainer();
		})
		.finally(() => {
			clearTimeout(timeoutId);
		});

	//If the queue is RFY, sync the RFY
	if (env.data.vineQueue === "potluck" && Settings.get("notification.RFYReload.active")) {
		RFYNotifier.syncRFYPageData(arrProductsData);
	}
}

//Process the results obtained from the server
//Update each tile with the data pertaining to it.
async function serverProductsResponse(data) {
	logger.add("FETCH: Response received from VineHelper's server...");
	if (data["invalid_uuid"] == true) {
		let note = new ScreenNotification();
		note.title = "UUID Error";
		note.lifespan = 30;
		note.content = "UUID is invalid, refresh the page to request a new one.";
		Notifications.pushNotification(note);

		// Show grid on error
		showGridContainer();
		Settings.set("general.uuid", null); //Cancel the UUID, so the next load can regenerate a new one.
		//Do no complete this execution
		return false;
	}

	if (Settings.get("hiddenTab.active")) {
		logger.add("FETCH: Waiting on hidden items list to be loaded...");
		while (!HiddenList.listLoaded) {
			await new Promise((r) => setTimeout(r, 10));
		}
		logger.add("FETCH: Hidden items list loaded...");
	}

	const timenow = data["current_time"];
	//Display notification from the server
	if (Array.isArray(data["notification"])) {
		if (data["notification"].length > 0) {
			data["notification"].forEach((msg) => {
				let note = new ScreenNotification();
				note.title = "Server message";
				note.lifespan = 10;
				note.content = msg;
				Notifications.pushNotification(note);
			});
		}
	}

	//Display news
	logger.add("FETCH: Displaying news...");
	if (data["news"] !== undefined) {
		const newsHandler = new News(data["news"]);
	}

	// Move missingASINs declaration before any usage
	let missingASINs = [];

	logger.add("FETCH: Waiting toolbars to be drawn...");
	while (toolbarsDrawn == false) {
		await new Promise((r) => setTimeout(r, 10));
	}
	logger.add("FETCH: Interface loaded, processing fetch data...");
	try {
		// Get all ASINs from the page
		const grid = page.getGrid("vvp-items-grid");
		if (grid) {
			const allTiles = grid.getAllTiles();
			const allPageASINs = Object.keys(allTiles).filter((a) => a);
			const serverASINs = Object.keys(data["products"]);
			missingASINs = allPageASINs.filter((asin) => !serverASINs.includes(asin));
		}
	} catch (error) {
		logger.add("ERROR: Failed to get tiles from grid: " + error.message);
	}

	//For each product provided by the server, modify the local listings
	let processedCount = 0;
	for (const [key, values] of Object.entries(data["products"])) {
		try {
			processedCount++;
			logger.add("DRAW: Processing ASIN #" + key);
			let tile = page.getTileByASIN(key);

			if (tile == null) {
				logger.add("No tile matching " + key);
				continue; //Continue the loop with the next item - FIXED: was 'return'
			}

			// Debug: Check tile state
			//Load the ETV value
			if (values.etv_min != null) {
				logger.add("DRAW: Setting ETV");
				const toolbar = tile.getToolbar();
				if (toolbar) {
					toolbar.setETV(values.etv_min, values.etv_max);
				}
			} else {
				logger.add("DRAW: No ETV value found");
				const toolbar = tile.getToolbar();
				if (toolbar) {
					toolbar.unknownETV();
				}
			}

			if (values.date_added != null) {
				logger.add("DRAW: Setting Date");
				tile.setDateAdded(timenow, values.date_added);
			}

			if (values.discovered) {
				logger.add("DRAW: Marking as discovered");
				tile.markAsDiscovered();
			}

			if (Settings.isPremiumUser(3)) {
				if (values.price != null) {
					logger.add("DRAW: Setting Price");
					const toolbar = tile.getToolbar();
					if (toolbar) {
						toolbar.setPrice(values.price);
					}
				}

				if (values.additional_img && Array.isArray(values.additional_img)) {
					tile.setAdditionalImages(values.additional_img);
				}
			}

			//If there is a remote value for the hidden item, ensure it is sync'ed up with the local list
			if (Settings.isPremiumUser(1) && Settings.get("hiddenTab.remote") && values.hidden != null) {
				if (values.hidden == true && !(await tile.isHidden())) {
					logger.add("DRAW: Remote is ordering to hide item");
					await tile.hideTile(false, false, false); //Will update the placement and list
				} else if (values.hidden == false && (await tile.isHidden())) {
					logger.add("DRAW: Remote is ordering to show item");
					//await tile.showTile(false, false, false); //Will update the placement and list
				}
			}
			if (Settings.get("unavailableTab.active")) {
				logger.add("DRAW: Setting orders");
				tile.setOrders(values.order_success, values.order_failed);
				tile.setUnavailable(values.order_unavailable);

				//Assign the tiles to the proper grid
				if (Settings.get("hiddenTab.active") && (await tile.isHidden())) {
					//The hidden tiles were already moved, keep the there.
				} else if (tile.getUnavailable()) {
					logger.add("DRAW: moving the tile to Unavailable (failed order(s))");
					await tile.moveToGrid(page.getGrid("tab-unavailable"), false); //This is the main sort, do not animate it
				}

				logger.add("DRAW: Updating the toolbar");
				const toolbar = tile.getToolbar();
				if (toolbar) {
					try {
						toolbar.updateVisibilityIcon();
					} catch (visError) {
						logger.add("WARN: Failed to update visibility icon: " + visError.message);
					}
				}
				logger.add("DRAW: Done updating the toolbar");
			}

			//Process variants
			if (Settings.isPremiumUser(2) && Settings.get("general.displayVariantButton")) {
				if (values.variants && values.variants.length > 0) {
					logger.add("DRAW: Processing variants");

					//Add variants to the tile
					for (const [k, val] of Object.entries(values.variants)) {
						await tile.addVariant(val.asin, val.title, val.etv);
					}
				}
			}
		} catch (error) {
			logger.add("ERROR: Failed to process tile data: " + error.message);
		}
	}
	// Process tiles that the server didn't return data for as unknown ETV
	try {
		if (typeof missingASINs !== "undefined" && missingASINs.length > 0) {
			for (const asin of missingASINs) {
				const tile = page.getTileByASIN(asin);
				if (tile && tile.getToolbar()) {
					tile.getToolbar().unknownETV();
					tile.colorizeHighlight();
				}
			}
		}
	} catch (error) {
		logger.add("WARN: Failed to process missing ASINs: " + error.message);
	}

	//Loading remote stored pinned items
	if (Settings.isPremiumUser(1) && Settings.get("pinnedTab.active") && Settings.get("pinnedTab.remote")) {
		if (data["pinned_products"] != undefined) {
			logger.add("DRAW: Loading remote pinned products");
			for (let i = data["pinned_products"].length - 1; i >= 0; i--) {
				//Get the tile
				const tile = page.getTileByASIN(data["pinned_products"][i]["asin"]);
				if (tile) {
					tile.setPinned(true);
				}

				const item = new Item({
					asin: data["pinned_products"][i]["asin"],
					queue: data["pinned_products"][i]["queue"],
					title: data["pinned_products"][i]["title"],
					img_url: data["pinned_products"][i]["img_url"],
					is_parent_asin: data["pinned_products"][i]["is_parent_asin"],
					is_pre_release: data["pinned_products"][i]["is_pre_release"] ? true : false,
					enrollment_guid: data["pinned_products"][i]["enrollment_guid"],
					unavailable: data["pinned_products"][i]["unavailable"],
				});
				await page.addPinnedTile(item);
			}
		}
	}

	//Update Patreon tier
	if (Settings.get("general.patreon.tier") != data["patreon_membership_tier"]) {
		Settings.set("general.patreon.tier", data["patreon_membership_tier"]);
	}

	page.updateTileCounts();
	logger.add("Done updating products");
	productUpdated = true;
	hookMgr.hookExecute("productsUpdated", null);

	// Show the grid after all processing is complete
	showGridContainer();

	//If the queue is RFY, sync the RFY
	if (env.data.vineQueue === "potluck" && Settings.get("notification.RFYReload.active")) {
		RFYNotifier.syncRFYServerData(data["products"]);
	}
}

//#########################
//## Triggered functions (from clicks or whatever)

//Messaging from accross tabs and context
//Messages sent via window.postMessage({}, "*");
//Most requests comes from the inj.js file, which is in a different scope/context.
var arrVariations = null;
var modalASIN = null;
var modalParentASIN = null;
window.addEventListener("message", async function (event) {
	//Do not run the extension if ultraviner is running
	if (ultraviner) {
		return false;
	}

	// We only accept messages from ourselves
	if (event.source != window || event.data.type == undefined) {
		return false;
	}

	//Amazon checkout process
	if (event.data.type == "promotionId") {
		promotionId = event.data.promotionId;
		checkoutAsin = event.data.asin;
		modalASIN = event.data.asin;
		modalParentASIN = event.data.parent_asin;
		// Try to find and update the form for 3 seconds
		let attempts = 0;
		const maxAttempts = 60; // 3 seconds at 50ms intervals
		const interval = setInterval(() => {
			const checkoutBuyNowForm = document.querySelector("#vvp-checkout-buy-now");
			const requestProductBtn = document.querySelector(
				"#vvp-product-details-modal--request-btn input[type='submit']"
			);
			if (checkoutBuyNowForm && requestProductBtn) {
				if (window.location.hash === "#monitor" || Settings.get("general.forceCheckoutNewTab")) {
					checkoutBuyNowForm.target = "_blank";
				}

				// Set up a beforeunload listener to save data when page is about to unload
				const requestProductBtnClick = async (e) => {
					await Settings.set("checkout.currentASIN", modalASIN);
					await Settings.set("checkout.currentParentASIN", modalParentASIN);
					requestProductBtn.removeEventListener("click", requestProductBtnClick);
				};
				requestProductBtn.addEventListener("click", requestProductBtnClick);

				clearInterval(interval);
			} else if (++attempts >= maxAttempts) {
				clearInterval(interval);
				console.log("Could not find checkout form after 3 seconds");
			}
		}, 50);
	}

	//Amazon checkout process (only use if the notification monitor is loaded)
	//This is an alternate backup method to flagging the form as target=_blank
	/*
	if (
		event.data.type == "offerListingId" &&
		env.isAmazonCheckoutEnabled() &&
		notificationMonitor !== null &&
		!Settings.get("general.forceTango")
	) {
		//Open a new tab to the form generating url
		const offerListingId = event.data.offerListingId;
		const params = {
			asin: checkoutAsin,
			promotionId: promotionId,
			offerListingId: offerListingId,
		};
		window.open(
			`https://www.amazon.${i13n.getDomainTLD()}/vine/vine-items#checkoutForm;${encodeURIComponent(
				JSON.stringify(params)
			)}`,
			"_blank"
		);
	}
	*/

	//Sometime, mostly for debugging purpose, the Service worker can try to display notifications.
	if (event.data.type == "rawNotification") {
		let note = new ScreenNotification();
		note.title = "System";
		note.lifespan = 10;
		note.content = event.data.content;
		await Notifications.pushNotification(note);
	}

	//If we got back a message after we fixed an infinite wheel spin.
	if (event.data.type == "infiniteWheelFixed") {
		//console.log("Content script received message: " + event.data.text);

		//Show a notification
		let note = new ScreenNotification();
		note.title = "Infinite spinner fixed!";
		note.lifespan = 10;
		note.content = "Vine Helper fixed an item bugged an infinite spinner: " + event.data.text;
		await Notifications.pushNotification(note);
	}

	//If we got back a message after we found variations
	if (event.data.type == "variations") {
		//Make an array of all the asin values
		arrVariations = event.data.data.map((variation) => {
			return {
				asin: variation.asin,
				dimensions: encodeURIComponent(JSON.stringify(variation.dimensions)),
			};
		});

		if (Settings.isPremiumUser(2) && Settings.get("general.displayVariantButton")) {
			//Get the tile from the ASIN
			const tile = page.getTileByASIN(event.data.asin);
			if (tile) {
				for (const variation of arrVariations) {
					await tile.addVariant(variation.asin, decodeURIComponent(variation.dimensions), null);
				}
			}
		}
	}

	//If we got back a message after we found an ETV.
	if (event.data.type == "etv") {
		//Send the ETV info to the server
		let tileASIN = event.data.data.parent_asin;
		if (tileASIN === null) {
			tileASIN = event.data.data.asin;
		}

		//Update the tile with the new ETV
		const tile = page.getTileByASIN(tileASIN);
		if (tile) {
			const toolbar = tile.getToolbar();
			if (toolbar) {
				toolbar.setETV(event.data.data.etv, event.data.data.etv);
			}
		}

		//Update the server with the new ETV
		const content = {
			api_version: 5,
			app_version: env.data.appVersion,
			action: "record_etv",
			country: i13n.getCountryCode(),
			uuid: await Settings.get("general.uuid", false),
			fid: await Settings.get("general.fingerprint.id", false),
			cid: await env.getCID(),
			asin: event.data.data.asin,
			parent_asin: event.data.data.parent_asin,
			queue: env.data.vineQueue,
			title: event.data.data.title,
			thumbnail: event.data.data.thumbnail,
			enrollment_guid: event.data.data.enrollment_guid,
			etv: event.data.data.etv,
			variations: arrVariations,
		};
		const s = await cryptoKeys.signData(content);
		content.s = s;
		content.pk = await cryptoKeys.getExportedPublicKey();

		arrVariations = null;

		await fetch(env.getAPIUrl(), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(content),
		});

		//The notifications monitors does not instanciate a grid as there is no tabs.
		//But the ETV will be received from the server
		if (!notificationMonitor) {
			//Update the product tile ETV in the Toolbar
			const tile = page.getTileByASIN(tileASIN);
			if (tile) {
				const toolbar = tile.getToolbar();
				if (toolbar) {
					toolbar.setETV(event.data.data.etv, event.data.data.etv, true);
				}
			} else {
				//This can happen when we force an open modal for an item that is not present on the page
				//console.error("Unable to find the tile for ASIN " + tileASIN);
			}
		}

		//Show a notification
		if (!Settings.get("notification.reduce") && !env.isMobileView()) {
			const note = new ScreenNotification();
			note.title = "ETV data shared";
			note.lifespan = 2;
			note.content =
				"Vine Helper shared the ETV value of " +
				event.data.data.etv +
				" for item " +
				event.data.data.asin +
				".";
			await Notifications.pushNotification(note);
		}

		if (Settings.get("general.displayModalETV")) {
			if (env.isMobileView()) {
				document.getElementById("product-details-sheet-tax-value").classList.remove("aok-hidden");
				document.getElementById("product-details-sheet-tax-value").style.display = "block";
				document.getElementById("product-details-sheet-tax-spinner").style.display = "none";
				document.getElementById("product-details-sheet-tax-value-string").innerText = event.data.data.etv;
			} else {
				document.getElementById("vvp-product-details-modal--tax-value").style.display = "block";
				document.getElementById("vvp-product-details-modal--tax-spinner").style.display = "none";
				document.getElementById("vvp-product-details-modal--tax-value-string").innerText = event.data.data.etv;
			}
		}
	}

	//If we got back a message after an order was attempted or placed.
	if (event.data.type == "order") {
		let tileASIN;
		if (event.data.data.parent_asin === null) {
			tileASIN = event.data.data.asin;
		} else {
			tileASIN = event.data.data.parent_asin;
		}

		if (
			event.data.data.status == "success" ||
			event.data.data.error == "CROSS_BORDER_SHIPMENT" ||
			event.data.data.error == "ITEM_NOT_IN_ENROLLMENT"
		) {
			//Report the order status to the server
			const content = {
				api_version: 5,
				app_version: env.data.appVersion,
				action: "record_order",
				country: i13n.getCountryCode(),
				uuid: await Settings.get("general.uuid", false),
				fid: await Settings.get("general.fingerprint.id", false),
				cid: await env.getCID(),
				asin: event.data.data.asin,
				parent_asin: event.data.data.parent_asin,
				order_status: event.data.data.status,
				order_error: event.data.data.error,
			};

			const s = await cryptoKeys.signData(content);
			content.s = s;
			content.pk = await cryptoKeys.getExportedPublicKey();

			//Form the full URL
			await fetch(env.getAPIUrl(), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(content),
			});

			//The notifications monitors does not implement the regularGrid
			if (!notificationMonitor) {
				//Update the product tile ETV in the Toolbar
				let tile = page.getTileByASIN(tileASIN);
				if (tile) {
					const toolbar = tile.getToolbar();
					if (toolbar) {
						toolbar.createOrderWidget(event.data.data.status == "success");
					}
				} else {
					//This can happen when we force an open modal for an item that is not present on the page
					//console.error("Unable to find the tile for ASIN " + tileASIN);
				}
			}
		}

		const note = new ScreenNotification();
		if (event.data.data.status == "success") {
			//Show a notification
			note.title = "Successful order detected!";
			note.lifespan = 15;
			note.content = "Item " + event.data.data.asin + " ordered.";
		} else {
			//Show a notification

			note.title = "Failed order detected.";
			note.lifespan = 15;
			note.content =
				"Item " + event.data.data.asin + " failed to order with error " + event.data.data.error + ".";
		}
		await Notifications.pushNotification(note);
	}

	if (event.data.type == "error") {
		//Show a notification
		let note = new ScreenNotification();
		note.title = "Product unavailable.";
		note.lifespan = 10;
		note.content =
			"<strong>Type:</strong> " +
			event.data.data.errorType +
			"<br/><strong>Details:</strong> " +
			event.data.data.error;
		await Notifications.pushNotification(note);

		if (event.data.data.errorType == "ITEM_NOT_IN_ENROLLMENT") {
			recordUnavailableProduct(event.data.data.asin, "ITEM_NOT_IN_ENROLLMENT");
		}
	}

	if (event.data.type == "injLoaded") {
		monkeyPatcherLoaded = true;
		if (Settings.isPremiumUser(2) && Settings.get("general.forceTango")) {
			window.postMessage({ type: "forceTango" }, "/"); //Post to inj.js
		}
	}
});

async function recordUnavailableProduct(asin, reason) {
	const content = {
		api_version: 5,
		app_version: env.data.appVersion,
		action: "record_unavailable",
		country: i13n.getCountryCode(),
		uuid: await Settings.get("general.uuid", false),
		fid: await Settings.get("general.fingerprint.id", false),
		cid: await env.getCID(),
		asin: asin,
		reason: reason,
	};
	const s = await cryptoKeys.signData(content);
	content.s = s;
	content.pk = await cryptoKeys.getExportedPublicKey();

	//Form the full URL
	await fetch(env.getAPIUrl(), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(content),
	});
}

//Generate the checkout form for the Amazon checkout process
async function generateCheckoutForm(asin, promotionId, offerListingId) {
	const form = document.createElement("form");
	form.method = "POST";
	form.action = `https://www.amazon.${i13n.getDomainTLD()}/checkout/entry/buynow?pipelineType=Chewbacca`;
	form.style.display = "none";

	// Create form inputs safely
	const inputs = [
		{ name: "offerListingID", value: offerListingId },
		{ name: "vinePromotionId", value: promotionId },
		{ name: "asin", value: asin },
		{ name: "skipCart", value: "1" },
		{ name: "quantity", value: "1" },
		{ name: "vineProgramType", value: "VINE" },
	];

	inputs.forEach(({ name, value }) => {
		const input = document.createElement("input");
		input.type = "text";
		input.name = name;
		input.value = value;
		form.appendChild(input);
	});

	document.body.appendChild(form);
	form.submit();
	form.remove();
}

//#####################################################
//## MESSAGES LISTENERS
//#####################################################
//Message from within the context of the extension
//Messages sent via: chrome.tabs.sendMessage(tab.id, data);
//In this case, all messages are coming from the service_worker or notification-monitor files.
channel.addEventListener("message", async (event) => {
	processMessage(await cryptoKeys.decryptToJSON(event.data));
});
chrome.runtime.onMessage.addListener(async (data, sender, sendResponse) => {
	processMessage(data, sender, sendResponse);
});
window.addEventListener("message", (event) => {
	processMessage(event.data);
});

// Deduplicate the data. If the same data was already provided within 1 second, ignore it.
// Simple deduplication: track the last processed ASIN
let lastProcessedASIN = null;

function checkMessageDuplicate(data) {
	// Only check for newItem messages
	if (data.type !== "newItem") {
		return false;
	}

	const asin = data.item?.data?.asin;
	if (!asin) {
		return false;
	}

	// Check if this is the same ASIN as the previous one
	if (asin === lastProcessedASIN) {
		return true; // duplicate
	}

	// Update last processed ASIN
	lastProcessedASIN = asin;
	return false; // not duplicate
}

async function processMessage(data, sender = null, sendResponse = null) {
	if (data.type == undefined && data.action == undefined) {
		return false;
	}

	//If we received a request for a hook execution
	if (data.type == "hookExecute") {
		if (sendResponse) {
			sendResponse({ success: true });
		}
		hookMgr.hookExecute(data.hookname, data);
	}

	// Handle memory debugging commands from settings page
	if (data.type === "MEMORY_DEBUG_COMMAND") {
		handleMemoryDebugCommand(data, sendResponse);
		return true; // Keep message channel open for async response
	}

	// Handle TileCounter debugging commands from settings page
	if (data.type === "TILECOUNTER_DEBUG_COMMAND") {
		handleTileCounterDebugCommand(data, sendResponse);
		return true; // Keep message channel open for async response
	}

	// Handle settings refresh requests
	if (data.type === "refreshSettings") {
		try {
			// Refresh settings in the content script
			if (Settings && Settings.refresh) {
				await Settings.refresh();

				/*
				if (!Settings.get("notification.reduce")) {
					let noteSettingRefresh = new ScreenNotification();
					noteSettingRefresh.title = "Settings refreshed";
					noteSettingRefresh.title_only = true;
					noteSettingRefresh.lifespan = 3;
					Notifications.pushNotification(noteSettingRefresh);
				}
				*/

				if (sendResponse) {
					sendResponse({ success: true });
				}
			} else {
				console.warn("[ContentScript] Settings not available for refresh");
				if (sendResponse) {
					sendResponse({ success: false, error: "Settings not available" });
				}
			}
		} catch (error) {
			console.error("[ContentScript] Failed to refresh settings:", error);
			if (sendResponse) {
				sendResponse({ success: false, error: error.message });
			}
		}
		return true; // Keep message channel open for async response
	}

	if (data.type === "newItem") {
		if (sendResponse) {
			sendResponse({ success: true });
		}
		const isDuplicate = checkMessageDuplicate(data);
		if (isDuplicate) {
			// Ignore duplicate message - same ASIN as previous
			return false;
		}
		if (
			!notificationMonitor &&
			data.index < 10 && //Limit the notification to the top 10 most recents
			env.data.vineBrowsingListing && //Only show notification on listing pages
			!env.data.monitorActive && //Do not display on screen notification in the notifications monitor
			Settings.get("notification.screen.active")
		) {
			let {
				date,
				asin,
				queue,
				title,
				search,
				img_url,
				domain,
				etv,
				is_parent_asin,
				is_pre_release,
				enrollment_guid,
			} = data.item.data;

			//Generate the content to be displayed in the notification
			const prom = await Tpl.loadFile("scripts/ui/templates/notification_new_item.html");

			const item = new Item(data.item.data);
			if (
				Settings.isPremiumUser() &&
				Settings.get("general.searchOpenModal") &&
				is_parent_asin != null &&
				enrollment_guid != null
			) {
				Tpl.setVar("url", item.getVHOpenModalURL());
			} else {
				Tpl.setVar("url", item.getVineSearchURL());
			}
			Tpl.setIf("show_image", Settings.get("notification.screen.thumbnail"));
			Tpl.setVar("date", date);
			Tpl.setVar("search", search);
			Tpl.setVar("asin", asin);
			Tpl.setVar("description", title);
			Tpl.setVar("img_url", img_url);
			Tpl.setVar("queue", queue);
			Tpl.setVar("is_parent_asin", is_parent_asin);
			Tpl.setVar("is_pre_release", is_pre_release);
			Tpl.setVar("enrollment_guid", enrollment_guid);
			Tpl.setVar("domain", i13n.getDomainTLD());

			//Generate the notification
			let note2 = new ScreenNotification();
			note2.title = "New item detected !";
			note2.lifespan = 60;

			//Play the notification sound
			if (
				Settings.get("notification.screen.regular.volume") > 0 &&
				Settings.get("notification.screen.regular.sound") != "0"
			) {
				note2.sound = "resource/sound/" + Settings.get("notification.screen.regular.sound") + ".mp3";
				note2.volume = Settings.get("notification.screen.regular.volume");
			}
			note2.content = Tpl.render(prom);
			Notifications.pushNotification(note2);
		}
	}

	if (data.action === "showPrompt" && data.word) {
		showCustomPrompt(data.word, data.list).then((result) => {
			// Send the word to the background script
			chrome.runtime.sendMessage({ action: "addWord", word: result.word, list: data.list });
		});
		return true; // Keep the message channel open for the async response
	}

	if (data.action === "copyASIN") {
		//if (sendResponse) {
		//sendResponse({ success: true });
		//}
		if (selectedASIN) {
			navigator.clipboard.writeText(selectedASIN);
			alert("ASIN " + selectedASIN + " copied to clipboard");
		} else {
			alert("No ASIN detected. :(");
		}
	}
}

//Key bindings/keyboard shortcuts for navigation
window.addEventListener("keyup", async function (e) {
	//Do not run the extension if ultraviner is running
	if (ultraviner) {
		return;
	}

	if (!Settings.get("keyBindings.active") || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) {
		return false;
	}

	let nodeName = document.activeElement.nodeName;
	let excl = ["INPUT", "TEXTAREA", "SELECT", "LI"];
	if (excl.indexOf(nodeName) != -1) {
		return false;
	}

	if (Settings.get("general.modalNavigation") && (e.key == "ArrowRight" || e.key == "ArrowLeft")) {
		logger.add("Arrow key detected.");
		handleModalNavigation(e);
	}

	//Debug: secret keybind to generate dummy hidden items
	/*
	//Don't forget to comment this.updateArrChange({ in the addItem function in HiddenListMgr.js
	if (e.key == "g") {
		if (this.confirm("Generate 20,000 dummy items in local storage? (Will take ~1min)")) {
			for (let i = 0; i < 20000; i++) {
				const fakeAsin = (() => {
					let result = "";
					const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
					const charactersLength = characters.length;
					for (let i = 0; i < 10; i++) {
						result += characters.charAt(Math.floor(Math.random() * charactersLength));
					}

					return result;
				})();
				if (i % 1000 == 0) {
					console.log("Generated " + i + " items");
				}
				await HiddenList.addItem(fakeAsin, false, false);
			}
			HiddenList.saveList(false);
			this.alert("20,000 items generated");
		}
	}
	*/

	const keybindingMap = {
		[Settings.get("keyBindings.pauseFeed")]: () => {
			const pauseFeedBtn = document.getElementById("pauseFeed-fixed");
			if (pauseFeedBtn) {
				pauseFeedBtn.click();
			}
		},
		[Settings.get("keyBindings.hideAll")]: page.hideAllItems.bind(page),
		[Settings.get("keyBindings.showAll")]: page.showAllItems.bind(page),
		[Settings.get("keyBindings.hideAllNext")]: page.hideAllItemsNext.bind(page),
		[Settings.get("keyBindings.nextPage")]: () =>
			document.querySelector("#vvp-items-grid-container nav ul li:last-child a")?.click(),
		[Settings.get("keyBindings.previousPage")]: () =>
			document.querySelector("#vvp-items-grid-container nav ul li:first-child a")?.click(),
		[Settings.get("keyBindings.debug")]: async () => {
			let content = await logger.getContent();
			let regex = /\s*{<br\/>\n\s*"time": ([0-9]+),<br\/>\n\s*"event": "(.+?)"<br\/>\n\s*}(?:,<br\/>\n)?/gm;
			const content2 = content.replace(regex, `<strong>$1ms:</strong> $2<br/>\n`);
			let m = DialogMgr.newModal("debug");
			m.title = DEBUGGER_TITLE;
			m.content = content2;
			m.show();
		},
		[Settings.get("keyBindings.RFYPage")]: () => (window.location.href = "/vine/vine-items?queue=potluck"),
		[Settings.get("keyBindings.AFAPage")]: () => (window.location.href = "/vine/vine-items?queue=last_chance"),
		[Settings.get("keyBindings.ALLPage")]: () => (window.location.href = "/vine/vine-items?queue=all_items"),
		[Settings.get("keyBindings.AIPage")]: () => (window.location.href = "/vine/vine-items?queue=encore"),
		[Settings.get("keyBindings.ALLPage")]: () => (window.location.href = "/vine/vine-items?queue=all_items"),
		[Settings.get("keyBindings.AIPage2")]: () =>
			(window.location.href = "/vine/vine-items?queue=encore&pn=&cn=&page=2"),
		[Settings.get("keyBindings.AIPage3")]: () =>
			(window.location.href = "/vine/vine-items?queue=encore&pn=&cn=&page=3"),
		[Settings.get("keyBindings.AIPage4")]: () =>
			(window.location.href = "/vine/vine-items?queue=encore&pn=&cn=&page=4"),
		[Settings.get("keyBindings.AIPage5")]: () =>
			(window.location.href = "/vine/vine-items?queue=encore&pn=&cn=&page=5"),
		[Settings.get("keyBindings.AIPage6")]: () =>
			(window.location.href = "/vine/vine-items?queue=encore&pn=&cn=&page=6"),
		[Settings.get("keyBindings.AIPage7")]: () =>
			(window.location.href = "/vine/vine-items?queue=encore&pn=&cn=&page=7"),
		[Settings.get("keyBindings.AIPage8")]: () =>
			(window.location.href = "/vine/vine-items?queue=encore&pn=&cn=&page=8"),
		[Settings.get("keyBindings.AIPage9")]: () =>
			(window.location.href = "/vine/vine-items?queue=encore&pn=&cn=&page=9"),
		[Settings.get("keyBindings.AIPage10")]: () =>
			(window.location.href = "/vine/vine-items?queue=encore&pn=&cn=&page=10"),
		[Settings.get("keyBindings.availableTab")]: () => {
			const tab = document.querySelector('#tabs ul a[href="#vvp-items-grid"]');
			if (tab) {
				tab.click();
			}
		},
		[Settings.get("keyBindings.unavailableTab")]: () => {
			const tab = document.querySelector('#tabs ul a[href="#tab-unavailable"]');
			if (tab) {
				tab.click();
			}
		},
		[Settings.get("keyBindings.hiddenTab")]: () => {
			const tab = document.querySelector('#tabs ul a[href="#tab-hidden"]');
			if (tab) {
				tab.click();
			}
		},
		[Settings.get("keyBindings.pinnedTab")]: () => {
			const tab = document.querySelector('#tabs ul a[href="#tab-pinned"]');
			if (tab) {
				tab.click();
			}
		},
		[Settings.get("keyBindings.firstPage")]: () => {
			const currentUrl = window.location.href;
			const regex = /&page=\d+$/;
			const match = currentUrl.match(regex);
			if (match) {
				const newUrl = currentUrl.replace(regex, "&page=1");
				window.location.href = newUrl;
			}
		},
	};

	//Only allow the hideAll, hideAllNext and showAll keybinding if the hiddenTab is activated.
	if (
		(e.key.toLowerCase() == Settings.get("keyBindings.hideAll") ||
			e.key.toLowerCase() == Settings.get("keyBindings.hideAllNext") ||
			e.key.toLowerCase() == Settings.get("keyBindings.showAll")) &&
		!Settings.get("hiddenTab.active")
	) {
		return false;
	}

	const cb = keybindingMap[e.key.toLowerCase()];
	if (typeof cb === "function") {
		// Block certain keybindings in the notification monitor that would redirect the page;
		if (window.location.href.includes("#monitor")) {
			const blockedKeys = [
				Settings.get("keyBindings.nextPage"),
				Settings.get("keyBindings.previousPage"),
				Settings.get("keyBindings.firstPage"),
				Settings.get("keyBindings.RFYPage"),
				Settings.get("keyBindings.AFAPage"),
				Settings.get("keyBindings.AIPage"),
				Settings.get("keyBindings.ALLPage"),
				Settings.get("keyBindings.AIPage2"),
				Settings.get("keyBindings.AIPage3"),
				Settings.get("keyBindings.AIPage4"),
				Settings.get("keyBindings.AIPage5"),
				Settings.get("keyBindings.AIPage6"),
				Settings.get("keyBindings.AIPage7"),
				Settings.get("keyBindings.AIPage8"),
				Settings.get("keyBindings.AIPage9"),
				Settings.get("keyBindings.AIPage10"),
				Settings.get("keyBindings.availableTab"),
				Settings.get("keyBindings.unavailableTab"),
				Settings.get("keyBindings.hiddenTab"),
				Settings.get("keyBindings.pinnedTab"),
				Settings.get("keyBindings.hideAllNext"),
			];
			// Normalize and filter out undefined/null
			const blocked = blockedKeys
				.filter((k) => k !== undefined && k !== null && k !== "")
				.map((k) => String(k).toLowerCase());
			if (blocked.indexOf(e.key.toLowerCase()) !== -1) {
				return false; // Block this key while on the notification monitor
			}
		}

		cb();
	}
});

function compareVersion(oldVer, newVer) {
	//Sometimes newVer is not populated for some odd reason. Assume no version change.
	if (newVer == null) return VERSION_NO_CHANGE;

	if (oldVer == null || oldVer == undefined || oldVer === 0 || oldVer === true) {
		return VERSION_MAJOR_CHANGE;
	}
	if (oldVer == false || oldVer == newVer) return VERSION_NO_CHANGE;

	const regex = /^([0-9]+)\.([0-9]+)(?:\.([0-9]+))?$/;
	const arrOldVer = oldVer.match(regex);
	const arrNewVer = newVer.match(regex);

	if (arrOldVer[1] != arrNewVer[1]) return VERSION_MAJOR_CHANGE;
	if (arrOldVer[2] != arrNewVer[2]) return VERSION_MINOR_CHANGE;
	if (arrOldVer.length == 4 && arrNewVer.length == 4) {
		if (arrOldVer[3] != arrNewVer[3]) {
			return VERSION_REVISION_CHANGE;
		} else {
			return VERSION_NO_CHANGE;
		}
	} else {
		return VERSION_REVISION_CHANGE;
	}
}

function escapeHTML(value) {
	let val = String(value);
	val = val.replace(/[&<>"'`=/]/g, function (match) {
		return {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&#39;",
			"/": "&#x2F;",
			"`": "&#x60;",
			"=": "&#x3D;",
		}[match];
	});
	return val;
}

// Memory debugging command handler
async function handleMemoryDebugCommand(data, sendResponse) {
	try {
		// Check if memory debugger is available
		const debuggerReady = await window.MEMORY_DEBUGGER_READY;
		if (!debuggerReady) {
			sendResponse({
				success: false,
				error: "Memory debugger not initialized. Please enable memory debugging and reload the page.",
			});
			return;
		}

		const { command, params } = data;
		let result;

		switch (command) {
			case "takeSnapshot":
				result = debuggerReady.takeSnapshot(params.name);
				sendResponse({ success: true, data: result });
				break;

			case "generateReport":
				result = debuggerReady.generateReport();
				sendResponse({ success: true, data: result });
				break;

			case "detectLeaks":
				result = debuggerReady.detectLeaks();
				sendResponse({ success: true, data: result });
				break;

			case "checkDetachedNodes":
				result = debuggerReady.checkDetachedNodes();
				sendResponse({ success: true, data: result });
				break;

			case "cleanup":
				result = debuggerReady.cleanup();
				sendResponse({ success: true, data: result });
				break;

			default:
				sendResponse({ success: false, error: `Unknown command: ${command}` });
		}
	} catch (error) {
		console.error("Memory debug command error:", error);
		sendResponse({ success: false, error: error.message });
	}
}

// TileCounter debugging command handler
async function handleTileCounterDebugCommand(data, sendResponse) {
	try {
		// Check if TileCounter debugger is available
		if (!window.tileCounterDebugger) {
			// Check if we're in notification monitor context
			if (!window.location.href.includes("#monitor")) {
				sendResponse({
					success: false,
					error: "TileCounter debugger is only available in the Notification Monitor. Please open the Notification Monitor tab and try again.",
				});
				return;
			}

			sendResponse({
				success: false,
				error: "TileCounter debugger not initialized. Please enable TileCounter debugging in settings and reload the page.",
			});
			return;
		}

		const { command, params } = data;
		let result;

		switch (command) {
			case "startMonitoring":
				result = window.tileCounterDebugger.startMonitoring();
				sendResponse(result);
				break;

			case "stopMonitoring":
				result = window.tileCounterDebugger.stopMonitoring();
				sendResponse(result);
				break;

			case "getMetrics":
				result = window.tileCounterDebugger.getMetrics();
				sendResponse(result);
				break;

			case "generateReport":
				result = window.tileCounterDebugger.generateReport();
				sendResponse(result);
				break;

			case "clearData":
				result = window.tileCounterDebugger.clearData();
				sendResponse(result);
				break;

			default:
				sendResponse({ success: false, error: `Unknown command: ${command}` });
		}
	} catch (error) {
		console.error("TileCounter debug command error:", error);
		sendResponse({ success: false, error: error.message });
	}
}

function getRandomNumber(min, max) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * ========================================================================
 * ================ EXPERIMENTAL FEATURE: MODAL NAVIGATION ================
 * ========================================================================
 */

/**
 * Tracks the index of the current active tile within the grid
 * Defaulted it to -1 to indicate no active tile initially (on load)
 *
 * @type {number}
 */
let modalNavigatorCurrentIndex = -1;

/**
 * Tracks the index of the current active tile we want to navigate to
 * Defaulted to 0 to start from the first tile, unless another is clicked
 *
 * @type {number}
 */
let modalNavigatorNextIndex = 0;

/**
 * Handles the click event on the detail button and stores both the index and ASIN code.
 *
 * @param {number} index - The index of the current tile
 * @param {string} asin - The ASIN code associated with the product/tile
 */
function modalNavigatorHandleTileButtonClick(index, asin) {
	modalNavigatorCurrentIndex = index;
	logger.add("[DEBUG] Tile clicked, current index: " + modalNavigatorCurrentIndex + " with ASIN: " + asin);
}

/**
 * Closes popup modal and returns the Promise when it's finished
 *
 * @param {HTMLElement} modal - The modal that we need to close
 * @returns {Promise<void>} - A promise that resolves after it's closed
 */
function modalNavigatorCloseModal(modal) {
	return new Promise((resolve) => {
		logger.add("[DEBUG] Closing modal...");
		modal.querySelector('button[data-action="a-popover-close"]').click();
		setTimeout(() => {
			logger.add("[DEBUG] Modal closed!");
			resolve();
		}, 300);
	});
}

async function initModalNagivation() {
	if (!Settings.isPremiumUser() || !Settings.get("general.modalNavigation")) {
		return false;
	}

	//Wait for the interface to be loaded and product to have been sorted
	while (productUpdated == false) {
		await new Promise((r) => setTimeout(r, 10));
	}

	// Check if the grid container exists (pages without items won't have it)
	if (!page.getGrid("vvp-items-grid")) {
		return false;
	}

	/**
	 * Attach the 'click' eventListener to each yellow "See Details" button in the grid
	 */
	page.getGrid("vvp-items-grid")
		.getDOM()
		.querySelectorAll(".vvp-item-tile")
		.forEach((tile, index) => {
			const modalNavigatorButton = tile.querySelector(".vvp-details-btn input");
			if (modalNavigatorButton) {
				const modalNavigatorAsin = modalNavigatorButton.getAttribute("data-modalNavigatorAsin");

				modalNavigatorButton.addEventListener("click", function () {
					modalNavigatorHandleTileButtonClick(index, modalNavigatorAsin);
				});
			}
		});
}

async function handleModalNavigation(event) {
	/**
	 * Let's check if the modal is open by looking for the (active) modal element on the page
	 * If not, let's exit since there is nothing to click
	 */
	let modalNavigatorModal = document.querySelector('.a-popover-modal[aria-hidden="false"]');

	// Check if the grid container exists (pages without items won't have it)
	if (!page.getGrid("vvp-items-grid")) {
		logger.add("[DEBUG] No grid container found; ignoring!");
		return;
	}

	const itemCount = page.getGrid("vvp-items-grid").getDOM().querySelectorAll(".vvp-item-tile").length;
	if (!modalNavigatorModal) {
		logger.add("[DEBUG] Modal not open, nothing to navigate through; ignoring!");
		return;
	}

	if (modalNavigatorCurrentIndex === -1) {
		logger.add("[DEBUG] There is no active tile; exiting");
		return; // Exit if there's no current tile tracked
	}

	/**
	 * Figure out the previous/next index based on keyPress
	 * We'll use the {document[...].length} to find the first/last item so we'll not run out of bounds
	 */
	if (event.key === "ArrowRight") {
		modalNavigatorNextIndex = (modalNavigatorCurrentIndex + 1) % itemCount;
	} else if (event.key === "ArrowLeft") {
		modalNavigatorNextIndex = (modalNavigatorCurrentIndex - 1 + itemCount) % itemCount;
	} else {
		logger.add("[DEBUG] No left/right arrowkey pressed; exiting");
		return;
	}

	logger.add("[DEBUG] Next index in the grid: " + modalNavigatorNextIndex);

	// Close the modalNavigatorModal, await it, then continue
	await modalNavigatorCloseModal(modalNavigatorModal);

	/**
	 * Target the button with the correct {data-asin} and click it, baby!
	 * HOWEVER, we require a delay of 600ms right now, perhaps fixable in a later release
	 */
	setTimeout(() => {
		const modalNavigatorNextTile = page.getGrid("vvp-items-grid").getDOM().querySelectorAll(".vvp-item-tile")[
			modalNavigatorNextIndex
		];
		const modalNavigatorNextButton = modalNavigatorNextTile.querySelector(".vvp-details-btn input");
		const modalNavigatorNextAsin = modalNavigatorNextButton.getAttribute("data-asin");

		if (modalNavigatorNextButton) {
			logger.add("[DEBUG] Trying to open modal with ASIN: " + modalNavigatorNextAsin);
			modalNavigatorNextButton.click();
		} else {
			logger.add("[DEBUG] There is no such button, broken? ASIN: " + modalNavigatorNextAsin);
		}
	}, 600);

	// Finally update the current index
	modalNavigatorCurrentIndex = modalNavigatorNextIndex;
	logger.add("[DEBUG] Updated the current index to: " + modalNavigatorCurrentIndex);
}

//#####################################################
//## STYLESHEETS
//#####################################################

async function loadStyleSheet(path, injected = true) {
	if (injected) {
		const prom = await Tpl.loadFile(path);
		let content = Tpl.render(prom);

		loadStyleSheetContent(content, path); //Put content between <style></style>
	} else {
		loadStyleSheetExternal(path); //Insert as an external stylesheet.
	}
}
function loadStyleSheetContent(content, path = "injected") {
	if (content != "") {
		const style = document.createElement("style");
		style.textContent = "/*" + path + "*/\n" + content;
		document.head.appendChild(style);
	}
}

//#####################################################
//## CONTEXT MENU
//#####################################################

let selectedASIN = null;
document.addEventListener("contextmenu", async (event) => {
	// Try to obtain the word that was right clicked on
	const range = getCaretPositionFromPoint(event.clientX, event.clientY);
	let word = null;

	const tileContent = range.startContainer?.parentElement?.closest(".vvp-item-tile");
	if (tileContent) {
		const asin = tileContent.dataset.asin;
		selectedASIN = asin;
	} else {
		selectedASIN = null;
	}

	if (range && range.startContainer?.nodeType === Node.TEXT_NODE) {
		const textNode = range.startContainer;
		const offset = range.startOffset;
		const text = textNode.textContent;

		// Extract the word around the cursor
		const before = text.slice(0, offset).match(/\b\w+$/) || [""];
		const after = text.slice(offset).match(/^\w+/) || [""];
		word = (before[0] + after[0]).toLowerCase();
	}

	if (word) {
		// Send the word to the background script
		chrome.runtime.sendMessage({ action: "setWord", word: word });
	}
});

function getCaretPositionFromPoint(x, y) {
	if (document.caretRangeFromPoint) {
		// Chrome or browsers supporting caretRangeFromPoint
		return document.caretRangeFromPoint(x, y);
	} else {
		// Firefox
		const position = document.caretPositionFromPoint(x, y);
		if (position) {
			const range = document.createRange();
			range.setStart(position.offsetNode, position.offset);
			range.setEnd(position.offsetNode, position.offset);
			return range;
		}
	}

	// Fallback for other browsers
	const range = document.createRange();
	const selection = window.getSelection();

	if (selection.rangeCount > 0) {
		return selection.getRangeAt(0);
	}

	return range;
}

// Custom dialog implementation
function showCustomPrompt(word, list, callback) {
	return new Promise((resolve) => {
		// Remove existing prompt
		const existingPrompt = document.querySelector("#custom-prompt");
		if (existingPrompt) existingPrompt.remove();

		// Create the dialog elements
		const promptOverlay = document.createElement("div");
		promptOverlay.id = "custom-prompt";
		promptOverlay.style.position = "fixed";
		promptOverlay.style.top = "0";
		promptOverlay.style.left = "0";
		promptOverlay.style.width = "100%";
		promptOverlay.style.height = "100%";
		promptOverlay.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
		promptOverlay.style.zIndex = "9999";
		promptOverlay.style.display = "flex";
		promptOverlay.style.alignItems = "center";
		promptOverlay.style.justifyContent = "center";

		const promptBox = document.createElement("div");
		promptBox.style.backgroundColor = "#fff";
		promptBox.style.padding = "20px";
		promptBox.style.borderRadius = "8px";
		promptBox.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.2)";
		promptBox.style.textAlign = "center";

		// Create prompt content safely
		const promptText = document.createElement("p");
		promptText.style.marginBottom = "20px";
		promptText.appendChild(document.createTextNode("Add the following word to the "));
		const strongElement = document.createElement("strong");
		strongElement.textContent = list;
		promptText.appendChild(strongElement);
		promptText.appendChild(document.createTextNode(" list:"));
		promptBox.appendChild(promptText);

		// Create input
		const wordInput = document.createElement("input");
		wordInput.id = "word-input";
		wordInput.type = "text";
		wordInput.value = word;
		wordInput.style.width = "100%";
		wordInput.style.padding = "8px";
		wordInput.style.marginBottom = "20px";
		promptBox.appendChild(wordInput);

		// Create confirm button
		const confirmButton = document.createElement("button");
		confirmButton.id = "confirm-button";
		confirmButton.style.marginRight = "10px";
		confirmButton.textContent = "Confirm";
		promptBox.appendChild(confirmButton);

		// Create cancel button
		const cancelButton = document.createElement("button");
		cancelButton.id = "cancel-button";
		cancelButton.textContent = "Cancel";
		promptBox.appendChild(cancelButton);

		promptOverlay.appendChild(promptBox);
		document.body.appendChild(promptOverlay);

		// Handle confirm and cancel buttons
		document.getElementById("confirm-button").addEventListener("click", () => {
			const editedWord = document.getElementById("word-input").value;
			promptOverlay.remove();
			resolve({ confirmed: true, word: editedWord });
		});

		document.getElementById("cancel-button").addEventListener("click", () => {
			promptOverlay.remove();
			resolve({ confirmed: false, word: null });
		});
	});
}
