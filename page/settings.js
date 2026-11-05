// Last compiled at 2026-11-04_2317
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
import { SettingsMgr } from "/scripts/core/services/SettingsMgrCompat.js";
const Settings = new SettingsMgr();

import { Internationalization } from "/scripts/core/services/Internationalization.js";
const i13n = new Internationalization();

import { initiateSettings } from "/page/settings_loadsave.js";

import { Template } from "/scripts/core/utils/Template.js";
var Tpl = new Template();

import { isSafari } from "/scripts/core/utils/BrowserDetection.js";

//If browser is firefox, load icon_firefox.css
if (navigator.userAgent.includes("Firefox")) {
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.type = "text/css";
	link.href = "../resource/css/icon_firefox.css";
	document.head.appendChild(link);
}
//If the browser is chrome, load icon_chrome.css
if (navigator.userAgent.includes("Chrome") || navigator.userAgent.includes("Chromium")) {
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.type = "text/css";
	link.href = "../resource/css/icon_chrome.css";
	document.head.appendChild(link);
}
if (navigator.userAgent.includes("Safari")) {
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

//Render the main layout
(async () => {
	// Clear template cache and variables when opening settings
	await Tpl.flushLocalStorage();

	const promMainTpl = await Tpl.loadFile("/page/settings_main.tpl.html", true);
	const promTab1 = await Tpl.loadFile("/page/settings_general.tpl.html", true);
	const promTab2 = await Tpl.loadFile("/page/settings_notifications.tpl.html", true);
	const promTab3 = await Tpl.loadFile("/page/settings_system.tpl.html", true);
	const promTab4 = await Tpl.loadFile("/page/settings_styles.tpl.html", true);
	const promTab5 = await Tpl.loadFile("/page/settings_discord.tpl.html", true);
	const promTab6 = await Tpl.loadFile("/page/settings_keywords.tpl.html", true);
	const promTab7 = await Tpl.loadFile("/page/settings_keybindings.tpl.html", true);
	const promTab8 = await Tpl.loadFile("/page/settings_sync.tpl.html", true);

	// Clear any existing template variables before setting new ones
	Tpl.clearVariables();
	// Set Safari detection before loading premium template so it can be used within the template
	Tpl.setIf("isSafari", isSafari());
	Tpl.setVar("APP_VERSION", getAppVersion());
	Tpl.setVar("TAB1", Tpl.render(promTab1));
	Tpl.setVar("TAB2", Tpl.render(promTab2));
	Tpl.setVar("TAB3", Tpl.render(promTab3));
	Tpl.setVar("TAB4", Tpl.render(promTab4));
	Tpl.setVar("TAB5", Tpl.render(promTab5));
	Tpl.setVar("TAB6", Tpl.render(promTab6));
	Tpl.setVar("TAB7", Tpl.render(promTab7));
	Tpl.setVar("TAB8", Tpl.render(promTab8));

	await Settings.waitForLoad();

	//Load the custom CSS if the user is a premium user
	if (Settings.isPremiumUser(2) && Settings.get("general.customCSS")) {
		loadStyleSheetContent(Settings.get("general.customCSS"));
	}

	let domainTLD = "";
	const countryCode = Settings.get("general.country");
	if (countryCode != null) {
		i13n.setCountryCode(countryCode);
		domainTLD = i13n.getDomainTLD();
	}
	Tpl.setIf("country_known", countryCode != null);

	document.body.replaceChildren();
	const mainContent = Tpl.render(promMainTpl, true);
	document.body.appendChild(mainContent);

	if (countryCode != null) {
		initTabs();
		initiateSettings(true); //page/settings_loadsave.js, initialize the loading and saving code for the page
	}
})();

function getAppVersion() {
	const manifest = chrome.runtime.getManifest();
	return manifest.version;
}

//Tab management
function initTabs() {
	console.log("Initializing tabs");
	//Bind the click event for the tabs
	document.querySelectorAll("#tabs-index > ul li").forEach(function (item) {
		item.onclick = function (event) {
			const currentTab = this.querySelector("a").href.split("#").pop();
			selectTab(currentTab);
			this.classList.add("active");
			return false;
		};
	});
	//Set the first tab as active
	document.querySelector("#tabs-index > ul li:first-child").click();
}

function selectTab(tab) {
	//Hide all tabs
	document.querySelectorAll("#tabs-content .tab").forEach(function (item) {
		item.style.display = "none";
	});

	document.querySelectorAll("#tabs-index > ul li").forEach(function (item) {
		item.classList.remove("active");
	});

	//Display the current tab
	document.querySelector("#" + tab).style.display = "flex";
}
