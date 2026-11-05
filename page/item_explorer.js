import { ISODatetoYMDHiS } from "/scripts/core/utils/DateHelper.js";

import { Environment } from "/scripts/core/services/Environment.js";
var env = new Environment();

import { Internationalization } from "/scripts/core/services/Internationalization.js";
const i13n = new Internationalization();

import { Pagination } from "/scripts/ui/controllers/Pagination.js";
const pagination = new Pagination();

import { PinnedListMgr } from "/scripts/core/services/PinnedListMgr.js";
var PinnedList = new PinnedListMgr();

import { SettingsMgr } from "/scripts/core/services/SettingsMgrCompat.js";
const Settings = new SettingsMgr();

import { CryptoKeys } from "/scripts/core/utils/CryptoKeys.js";
const cryptoKeys = new CryptoKeys();

import { unescapeHTML, removeSpecialHTML } from "/scripts/core/utils/StringHelper.js";

import { Item, WITH_VARIANT } from "/scripts/core/models/Item.js";

import { isFirefox, isChromium, isSafari } from "/scripts/core/utils/BrowserDetection.js";

let secondsLeft = 10;

//If browser is firefox, load icon_firefox.css
if (isFirefox()) {
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.type = "text/css";
	link.href = "../resource/css/icon_firefox.css";
	document.head.appendChild(link);
}
//If the browser is chrome, load icon_chrome.css
if (isChromium()) {
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.type = "text/css";
	link.href = "../resource/css/icon_chrome.css";
	document.head.appendChild(link);
}
if (isSafari()) {
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.type = "text/css";
	link.href = "../resource/css/icon_ios.css";
	document.head.appendChild(link);
}

function loadStyleSheetContent(content, path = "injected") {
	if (content != "") {
		const style = document.createElement("style");
		style.textContent = "/*" + path + "*/\n" + content;
		document.head.appendChild(style);
	}
}

(async () => {
	await Settings.waitForLoad();

	//Check if the membership is valid
	if (Settings.isPremiumUser(3) == false) {
		displayError("You need to be a tier 3 Patreon subscriber to use this feature.");
		return;
	}

	if (Settings.isPremiumUser(2) && Settings.get("general.customCSS")) {
		loadStyleSheetContent(Settings.get("general.customCSS"));
	}

	const countryCode = Settings.get("general.country");

	if (countryCode != null) {
		i13n.setCountryCode(countryCode);
	}

	const searchBtn = document.getElementById("search-button");

	searchBtn.addEventListener("click", function () {
		if (searchBtn.disabled) {
			return;
		}

		queryDB();
		searchBtn.disabled = true;
	});

	document.getElementById("search-asin").addEventListener("keyup", function (event) {
		//If ENTER is pressed, search
		if (event.key === "Enter") {
			searchBtn.click();
		}
	});
	document.getElementById("search-title").addEventListener("keyup", function (event) {
		if (event.key === "Enter") {
			searchBtn.click();
		}
	});

	loadFormItemsStateFromURL();
})();

function disableSearch() {
	const searchBtn = document.getElementById("search-button");
	searchBtn.disabled = true;
	searchBtn.value = `Wait ${secondsLeft}s`;

	let countdownInterval = setInterval(() => {
		secondsLeft--;
		if (secondsLeft <= 0) {
			clearInterval(countdownInterval);
			enableSearch();
		} else {
			searchBtn.value = `Wait ${secondsLeft}s`;
		}
	}, 1000);

	const paginationContainerTop = document.getElementById("vh-pagination-top");
	const paginationContainerBottom = document.getElementById("vh-pagination-bottom");
	const links = document.querySelectorAll("ul.a-pagination li a");
	links.forEach((link) => {
		link.addEventListener("click", preventDefault);
		link.style.pointerEvents = "none";
	});
	paginationContainerTop.style.opacity = "0.5";
	paginationContainerBottom.style.opacity = "0.5";
}

function enableSearch() {
	const searchBtn = document.getElementById("search-button");
	searchBtn.disabled = false;
	searchBtn.value = "Search";
	const paginationContainerTop = document.getElementById("vh-pagination-top");
	const paginationContainerBottom = document.getElementById("vh-pagination-bottom");
	paginationContainerTop.style.opacity = "unset";
	paginationContainerBottom.style.opacity = "unset";

	const links = document.querySelectorAll("ul.a-pagination li a");
	links.forEach((link) => {
		link.removeEventListener("click", preventDefault);
		link.style.pointerEvents = "auto";
	});
}
function preventDefault(event) {
	alert("preventDefault");
	event.preventDefault();
	return false;
}

function generateUrl() {
	const asin = document.getElementById("search-asin").value;
	const title = document.getElementById("search-title").value;
	const orderBy = document.getElementById("vh-order-by-select").value;
	const etvMin = document.getElementById("search-etv-min").value;
	const etvMax = document.getElementById("search-etv-max").value;
	const queue = document.getElementById("vh-queue-select").value;
	const unavailable = document.getElementById("unavailable-select").value;
	return (
		"/page/item_explorer.html?asin=" +
		encodeURI(asin) +
		"&title=" +
		encodeURI(title) +
		"&orderBy=" +
		encodeURI(orderBy) +
		"&etvMin=" +
		encodeURI(etvMin) +
		"&etvMax=" +
		encodeURI(etvMax) +
		"&queue=" +
		encodeURI(queue) +
		"&unavailable=" +
		encodeURI(unavailable)
	);
}

function loadFormItemsStateFromURL() {
	const asin = document.getElementById("search-asin");
	const title = document.getElementById("search-title");
	const orderBy = document.getElementById("vh-order-by-select");
	const etvMin = document.getElementById("search-etv-min");
	const etvMax = document.getElementById("search-etv-max");
	const queue = document.getElementById("vh-queue-select");
	const unavailable = document.getElementById("unavailable-select");
	//If the URL contains the parameters, load them
	if (window.location.search) {
		const urlParams = new URLSearchParams(window.location.search);
		asin.value = urlParams.get("asin");
		title.value = urlParams.get("title");
		orderBy.value = urlParams.get("orderBy");
		etvMin.value = urlParams.get("etvMin");
		etvMax.value = urlParams.get("etvMax");
		queue.value = urlParams.get("queue");
		unavailable.value = urlParams.get("unavailable");
		queryDB(parseInt(urlParams.get("page")));
	}
}

async function queryDB(page = 1) {
	const asin = document.getElementById("search-asin").value;
	const title = document.getElementById("search-title").value;
	const orderBy = document.getElementById("vh-order-by-select").value;
	const queue = document.getElementById("vh-queue-select").value;
	const etvMin = document.getElementById("search-etv-min").value;
	const etvMax = document.getElementById("search-etv-max").value;
	const unavailable = document.getElementById("unavailable-select").value;

	const content = {
		api_version: 5,
		app_version: env.data.appVersion,
		action: "item_explorer",
		country: i13n.getCountryCode(),
		uuid: Settings.get("general.uuid", false),
		cid: await env.getCID(),
		asin: asin,
		title: title,
		orderBy: orderBy,
		queue: queue,
		page: page,
		etvMin: etvMin,
		etvMax: etvMax,
		unavailable: unavailable,
	};
	const s = await cryptoKeys.signData(content);
	content.s = s;
	content.pk = await cryptoKeys.getExportedPublicKey();
	fetch(env.getAPIUrl(), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(content),
	})
		.then(async (response) => {
			const data = await response.json();
			if (!response.ok) {
				throw new Error(data.error || "Server error");
			}
			return data;
		})
		.then(serverProductsResponse)
		.catch(function (error) {
			displayError("Error fetching data from server: " + error.message);
		});
}
function openSeeDetails(item) {
	if (!(item instanceof Item)) {
		throw new Error("item is not an instance of Item");
	}

	window.open(item.getVHOpenModalURL(WITH_VARIANT), "_blank");
}
function serverProductsResponse(data) {
	if (data["invalid_uuid"] == true) {
		displayError("Invalid UUID or Patreon subscription insufficient.");
		//Do no complete this execution
		return false;
	}
	const container = document.getElementById("vh-item-explorer-content");
	container.replaceChildren();

	const stats = document.createElement("div");
	stats.id = "vh-item-explorer-stats";
	stats.style.fontSize = "8pt;";
	stats.textContent = `Query time: ${data.query_time}ms - Result(s): ${data.total_items}`;
	container.appendChild(stats);

	secondsLeft = parseInt(data.wait_time);

	//Create the table structure using DOM methods
	const table = document.createElement("table");
	table.id = "vh-item-table";

	// Create header rows
	const headerRow1 = document.createElement("tr");
	const headerRow2 = document.createElement("tr");

	// First header row
	const headers1 = [
		{ text: "ASIN", rowspan: 2 },
		{ text: "Title", rowspan: 2 },
		{ text: "ETV", rowspan: 2 },
		{ text: "Queue", rowspan: 2 },
		{
			html: "<a href='#' title='Unavailable' style='cursor: default;'><div class='vh-icon-32 vh-icon-declined'></div></a>",
			rowspan: 2,
		},
		{ text: "Orders", colspan: 2 },
		{ text: "Date created", rowspan: 2 },
		{ text: "Last broadcast", rowspan: 2 },
	];

	headers1.forEach((header) => {
		const th = document.createElement("th");
		if (header.text) {
			th.textContent = header.text;
		} else if (header.html) {
			// Use DOMParser for safe HTML parsing
			const parser = new DOMParser();
			const doc = parser.parseFromString(header.html, "text/html");
			const elements = Array.from(doc.body.children);
			elements.forEach((element) => {
				th.appendChild(element.cloneNode(true));
			});
		}
		if (header.rowspan) th.setAttribute("rowspan", header.rowspan);
		if (header.colspan) th.setAttribute("colspan", header.colspan);
		headerRow1.appendChild(th);
	});

	// Second header row
	const headers2 = [
		{ html: '<div class="vh-icon-32 vh-icon-order-success"></div>', style: "padding:2px" },
		{ html: '<div class="vh-icon-32 vh-icon-order-failed"></div>', style: "padding:2px" },
	];

	headers2.forEach((header) => {
		const th = document.createElement("th");
		if (header.html) {
			// Use DOMParser for safe HTML parsing
			const parser = new DOMParser();
			const doc = parser.parseFromString(header.html, "text/html");
			const elements = Array.from(doc.body.children);
			elements.forEach((element) => {
				th.appendChild(element.cloneNode(true));
			});
		}
		if (header.style) th.style.cssText = header.style;
		headerRow2.appendChild(th);
	});

	table.appendChild(headerRow1);
	table.appendChild(headerRow2);
	container.appendChild(table);
	const paginationContainerTop = document.getElementById("vh-pagination-top");
	const paginationContainerBottom = document.getElementById("vh-pagination-bottom");

	if (data["items"] == null || data["items"].length == 0) {
		const row = document.createElement("tr");
		const cell = document.createElement("td");
		cell.setAttribute("colspan", "9");
		cell.style.textAlign = "center";
		cell.textContent = "No items found";
		row.appendChild(cell);
		table.appendChild(row);

		paginationContainerTop.replaceChildren();
		paginationContainerBottom.replaceChildren();
		disableSearch();
		return;
	}

	for (const [key, values] of Object.entries(data["items"])) {
		let searchStyle = "";
		let searchUrl;
		values.title = unescapeHTML(unescapeHTML(values.title));
		if (
			Settings.get("general.searchOpenModal") &&
			values.is_parent_asin != null &&
			values.enrollment_guid != null &&
			values.queue != "potluck"
		) {
			const item = new Item({
				asin: key,
				queue: values.queue,
				is_parent_asin: values.is_parent_asin,
				is_pre_release: values.is_pre_release,
				enrollment_guid: values.enrollment_guid,
			});
			searchUrl = item.getVHOpenModalURL();
		} else {
			if (values.queue == "potluck") {
				searchStyle = "opacity: 0.4;";
			}
			let truncatedTitle =
				values.title.length > 40 ? values.title.substr(0, 40).split(" ").slice(0, -1).join(" ") : values.title;
			truncatedTitle = removeSpecialHTML(truncatedTitle);
			//Remove single letter words
			truncatedTitle = truncatedTitle
				.split(" ")
				.filter((word) => word.length > 1)
				.join(" ");
			const search_url_slug = encodeURIComponent(truncatedTitle);
			searchUrl = `https://www.amazon.${i13n.getDomainTLD()}/vine/vine-items?search=${search_url_slug}`;
		}

		// Create table row using DOM methods instead of innerHTML
		const row = document.createElement("tr");
		row.dataset.asin = values.asin;
		row.dataset.queue = values.queue;
		row.dataset.isParentAsin = values.is_parent_asin;
		row.dataset.enrollmentGuid = values.enrollment_guid;
		row.dataset.title = values.title;
		row.dataset.thumbnail = values.img_url;

		// ASIN cell
		const asinCell = document.createElement("td");
		asinCell.className = "asin";

		const thumbnailContainer = document.createElement("div");
		thumbnailContainer.className = "thumbnailContainer";

		const img = document.createElement("img");
		img.src = values.img_url;
		thumbnailContainer.appendChild(img);

		const iconsContainer = document.createElement("div");
		iconsContainer.className = "iconsContainer";

		const searchLink = document.createElement("a");
		searchLink.href = searchUrl;
		searchLink.target = "_blank";
		const searchIcon = document.createElement("div");
		searchIcon.className = "vh-icon-16 vh-icon-search";
		searchIcon.style.cssText = `margin-left: 5px;${searchStyle}`;
		searchLink.appendChild(searchIcon);
		iconsContainer.appendChild(searchLink);

		if (Settings.get("pinnedTab.active") && values.queue != "potluck") {
			const pinIcon = document.createElement("div");
			pinIcon.className = "vh-icon-16 vh-icon-pin";
			pinIcon.style.marginLeft = "5px";
			pinIcon.dataset.asin = values.asin;
			pinIcon.dataset.queue = values.queue;
			pinIcon.dataset.isParentAsin = values.is_parent_asin;
			pinIcon.dataset.isPreRelease = values.is_pre_release ? "true" : "false";
			pinIcon.dataset.enrollmentGuid = values.enrollment_guid;
			pinIcon.dataset.title = values.title;
			pinIcon.dataset.thumbnail = values.img_url;
			iconsContainer.appendChild(pinIcon);
		}

		thumbnailContainer.appendChild(iconsContainer);
		asinCell.appendChild(thumbnailContainer);
		asinCell.appendChild(document.createTextNode(values.asin));

		const asinLink = document.createElement("a");
		asinLink.href = `https://www.amazon.${i13n.getDomainTLD()}/dp/${values.asin}`;
		asinLink.target = "_blank";
		const newtabIcon = document.createElement("div");
		newtabIcon.className = "vh-icon-16 vh-icon-newtab";
		newtabIcon.style.marginLeft = "5px";
		asinLink.appendChild(newtabIcon);
		asinCell.appendChild(asinLink);

		if (values.is_parent_asin) {
			const br = document.createElement("br");
			asinCell.appendChild(br);
			const span = document.createElement("span");
			span.style.fontSize = "8pt";
			span.textContent = "(";
			const variantLink = document.createElement("a");
			variantLink.href = "#";
			variantLink.className = "load-variants";
			variantLink.dataset.asin = values.asin;
			variantLink.textContent = "load variants";
			span.appendChild(variantLink);
			span.appendChild(document.createTextNode(")"));
			asinCell.appendChild(span);
		}

		row.appendChild(asinCell);

		// Title cell
		const titleCell = document.createElement("td");
		titleCell.appendChild(document.createTextNode(values.title));
		if (values.queue !== "potluck") {
			const br = document.createElement("br");
			titleCell.appendChild(br);
			const span = document.createElement("span");
			span.textContent = "(";
			const detailsLink = document.createElement("a");
			detailsLink.href = "#";
			detailsLink.className = "open-see-details";
			detailsLink.dataset.asin = values.asin;
			detailsLink.dataset.queue = values.queue;
			detailsLink.dataset.isParentAsin = values.is_parent_asin;
			detailsLink.dataset.enrollmentGuid = values.enrollment_guid;
			detailsLink.textContent = "see details";
			span.appendChild(detailsLink);
			span.appendChild(document.createTextNode(")"));
			titleCell.appendChild(span);
		}
		row.appendChild(titleCell);

		// ETV cell
		const etvCell = document.createElement("td");
		etvCell.style.textAlign = "right";
		etvCell.textContent = values.etv == null ? "N/A" : values.etv;
		row.appendChild(etvCell);

		// Queue cell
		const queueCell = document.createElement("td");
		queueCell.textContent = queueToAbbr(values.queue);
		row.appendChild(queueCell);

		// Unavailable cell
		const unavailableCell = document.createElement("td");
		unavailableCell.style.textAlign = "center";
		if (values.unavailable) {
			const unavailableLink = document.createElement("a");
			unavailableLink.href = "#";
			unavailableLink.title = "Unavailable";
			unavailableLink.style.cursor = "default";
			const unavailableIcon = document.createElement("div");
			unavailableIcon.className = "vh-icon-16 vh-icon-declined";
			unavailableLink.appendChild(unavailableIcon);
			unavailableCell.appendChild(unavailableLink);
		}
		row.appendChild(unavailableCell);

		// Order success cell
		const orderSuccessCell = document.createElement("td");
		orderSuccessCell.style.textAlign = "center";
		orderSuccessCell.textContent = values.order_success;
		row.appendChild(orderSuccessCell);

		// Order failed cell
		const orderFailedCell = document.createElement("td");
		orderFailedCell.style.textAlign = "center";
		orderFailedCell.textContent = values.order_failed;
		row.appendChild(orderFailedCell);

		// Date added cell
		const dateAddedCell = document.createElement("td");
		dateAddedCell.textContent = ISODatetoYMDHiS(values.date_added);
		row.appendChild(dateAddedCell);

		// Last broadcast cell
		const lastBroadcastCell = document.createElement("td");
		lastBroadcastCell.textContent =
			values.last_broadcast == null ? "never" : ISODatetoYMDHiS(values.last_broadcast);
		row.appendChild(lastBroadcastCell);

		table.appendChild(row);
	}

	paginationContainerTop.replaceChildren();
	paginationContainerBottom.replaceChildren();
	paginationContainerTop.appendChild(
		pagination.generatePagination(generateUrl(), data["total_items"], 50, data["page"], true)
	);
	paginationContainerBottom.appendChild(
		pagination.generatePagination(generateUrl(), data["total_items"], 50, data["page"], true)
	);

	//Add pinned item listerner
	if (Settings.get("pinnedTab.active")) {
		const pinnedItems = document.querySelectorAll(".vh-icon-pin");
		pinnedItems.forEach((pinIcon) => {
			pinIcon.addEventListener("click", () => {
				const coreAttributes = {
					asin: pinIcon.getAttribute("data-asin"),
					queue: pinIcon.getAttribute("data-queue"),
					is_parent_asin: pinIcon.getAttribute("data-is-parent-asin"),
					is_pre_release: pinIcon.getAttribute("data-is-pre-release"),
					enrollment_guid: pinIcon.getAttribute("data-enrollment-guid"),
				};
				const item = new Item(coreAttributes);
				item.setTitle(pinIcon.getAttribute("data-title"));
				item.setImgUrl(pinIcon.getAttribute("data-thumbnail"));

				PinnedList.addItem(item);

				pinIcon.style.opacity = "0.4";
			});
		});
	}

	//Add event listener to the see details link
	const seeDetails = document.querySelectorAll(".open-see-details");
	seeDetails.forEach((itemDOM) => {
		itemDOM.addEventListener("click", (event) => {
			event.preventDefault();
			const item = new Item({
				asin: itemDOM.getAttribute("data-asin"),
				queue: itemDOM.getAttribute("data-queue"),
				is_parent_asin: itemDOM.getAttribute("data-is-parent-asin"),
				is_pre_release: itemDOM.getAttribute("data-is-pre-release"),
				enrollment_guid: itemDOM.getAttribute("data-enrollment-guid"),
			});
			openSeeDetails(item);
		});
	});

	//Add event listener to the load variants link
	const loadVariants = document.querySelectorAll(".load-variants");
	loadVariants.forEach((itemDOM) => {
		itemDOM.addEventListener("click", async (event) => {
			event.preventDefault();
			const tr = itemDOM.parentElement.parentElement.parentElement;
			const asin = itemDOM.getAttribute("data-asin");

			//Delete the link
			itemDOM.parentElement.remove();

			//Query the API for the variants
			const content = {
				api_version: 5,
				version: env.data.appVersion,
				action: "item_explorer_variants",
				country: i13n.getCountryCode(),
				uuid: Settings.get("general.uuid", false),
				cid: await env.getCID(),
				asin: asin,
			};
			const s = await cryptoKeys.signData(content);
			content.s = s;
			content.pk = await cryptoKeys.getExportedPublicKey();
			fetch(env.getAPIUrl(), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(content),
			})
				.then(async (response) => {
					const data = await response.json();
					if (!response.ok) {
						throw new Error(data.error || "Server error");
					}
					return data;
				})
				.then((data) => {
					//Delete all pre-existing variant rows for that asin
					const variantRows = document.querySelectorAll(`.variant-row-${asin}`);
					variantRows.forEach((row) => {
						row.remove();
					});

					//Sort the variants by title
					data.variants.sort((a, b) => a.title.localeCompare(b.title));

					if (data.variants.length === 0) {
						const noVariantsRow = document.createElement("tr");
						const noVariantsCell = document.createElement("td");
						noVariantsCell.setAttribute("colspan", "9");
						noVariantsCell.style.textAlign = "center";
						noVariantsCell.textContent = "Variant(s) not discovered yet.";
						noVariantsRow.appendChild(noVariantsCell);
						tr.insertAdjacentElement("afterend", noVariantsRow);
					} else {
						//Create the new rows.
						for (const variant of data.variants) {
							const variantRow = document.createElement("tr");
							variantRow.className = `variant-row-${asin}`;
							variantRow.style.fontSize = "8pt";

							// ASIN cell
							const asinCell = document.createElement("td");
							asinCell.appendChild(document.createTextNode(variant.asin));
							const variantLink = document.createElement("a");
							variantLink.href = `https://www.amazon.${i13n.getDomainTLD()}/dp/${variant.asin}`;
							variantLink.target = "_blank";
							const newtabIcon = document.createElement("div");
							newtabIcon.className = "vh-icon-12 vh-icon-newtab";
							newtabIcon.style.marginLeft = "5px";
							variantLink.appendChild(newtabIcon);
							asinCell.appendChild(variantLink);
							variantRow.appendChild(asinCell);

							// Title cell
							const titleCell = document.createElement("td");
							titleCell.appendChild(document.createTextNode(variant.title));
							if (tr.getAttribute("data-queue") !== "potluck") {
								const span = document.createElement("span");
								span.textContent = " (";
								const detailsLink = document.createElement("a");
								detailsLink.href = "#";
								detailsLink.className = "open-variant-see-details";
								detailsLink.dataset.asin = tr.getAttribute("data-asin");
								detailsLink.dataset.variantAsin = variant.asin;
								detailsLink.dataset.queue = tr.getAttribute("data-queue");
								detailsLink.dataset.isParentAsin = "false";
								detailsLink.dataset.enrollmentGuid = tr.getAttribute("data-enrollment-guid");
								detailsLink.textContent = "see details";
								span.appendChild(detailsLink);
								span.appendChild(document.createTextNode(")"));
								titleCell.appendChild(span);
							}
							variantRow.appendChild(titleCell);

							// ETV cell
							const etvCell = document.createElement("td");
							etvCell.style.textAlign = "right";
							etvCell.textContent = variant.etv;
							variantRow.appendChild(etvCell);

							// Empty cells
							const emptyCell = document.createElement("td");
							emptyCell.setAttribute("colspan", "6");
							variantRow.appendChild(emptyCell);

							//Insert the row after the tr
							tr.insertAdjacentElement("afterend", variantRow);
						}

						//Clear all existing event listeners
						const seeDetailsVariants = document.querySelectorAll(".open-variant-see-details");
						seeDetailsVariants.forEach((itemDOM) => {
							itemDOM.removeEventListener("click", (event) => {
								event.preventDefault();
							});
						});

						//Add event listener to the see details link
						seeDetailsVariants.forEach((itemDOM) => {
							itemDOM.addEventListener("click", (event) => {
								event.preventDefault();
								const item = new Item({
									asin: itemDOM.getAttribute("data-asin"),
									queue: itemDOM.getAttribute("data-queue"),
									is_parent_asin: itemDOM.getAttribute("data-is-parent-asin"),
									is_pre_release: itemDOM.getAttribute("data-is-pre-release"),
									enrollment_guid: itemDOM.getAttribute("data-enrollment-guid"),
									variant_asin: itemDOM.getAttribute("data-variant-asin"),
								});
								openSeeDetails(item);
							});
						});
					}
				});
		});
	});

	disableSearch();
}

function displayError(message) {
	const container = document.getElementById("vh-item-explorer-content");
	// Clear existing content safely
	container.replaceChildren();

	// Create new elements safely
	const div = document.createElement("div");
	div.className = "notice";
	div.textContent = message;
	container.appendChild(div);
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
