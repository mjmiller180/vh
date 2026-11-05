// Last compiled at 2026-11-04_2317
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/*global chrome*/
/**
 * VineTools service worker.
 *
 * What is left in here:
 *  - context menu: copy ASIN / add selected word to the highlight or hide keywords
 *  - settings refresh relay between tabs
 *  - "discordSend": POST a message to the user's own Discord webhook
 *  - "folderSync": sync settings + hidden/pinned lists with the folder chosen in the settings
 * There is no websocket, API or notification code: nothing here talks to any third-party server.
 */

import { ChromeStorageAdapter } from "/scripts/infrastructure/StorageAdapter.js";
import { initializeServices, getSettingsManager } from "/scripts/infrastructure/SettingsFactoryEnhanced.js";
import { sendWebhook } from "/scripts/background/DiscordSender.js";
import { createBrowserFolderSync } from "/scripts/background/FolderSync.js";

let Settings = null;
let selectedWord = "";

const storage = new ChromeStorageAdapter();

//#####################################################
//## TABS
//#####################################################

const VINE_TLDS = ["com", "co.uk", "co.jp", "de", "fr", "it", "es", "ca", "com.au", "com.br", "com.mx", "sg"];

async function sendMessageToAllTabs(data) {
	let tabs = [];
	try {
		tabs = await chrome.tabs.query({ url: VINE_TLDS.map((tld) => `*://*.amazon.${tld}/*vine/*`) });
	} catch (e) {
		return;
	}
	for (const tab of tabs) {
		try {
			chrome.tabs.sendMessage(tab.id, data, () => void chrome.runtime.lastError);
		} catch (e) {}
	}
}

//#####################################################
//## FOLDER SYNC
//#####################################################

const folderSync = createBrowserFolderSync(({ settings }) => {
	// Storage changed underneath us: refresh this worker's copy too (otherwise a later "add keyword"
	// from the context menu would write the stale settings back) and tell the open Vine tabs.
	if (Settings && Settings.refresh) Settings.refresh().catch(() => {});
	sendMessageToAllTabs({ type: "refreshSettings" });
});

//#####################################################
//## MESSAGES
//#####################################################

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.type === "discordSend") {
		sendWebhook(message.url, message.body).then(sendResponse);
		return true; // async response
	}

	if (message.type === "folderSync") {
		folderSync.syncNow(message.reason || "manual").then(sendResponse);
		return true;
	}

	if (message.type === "folderSyncStatus") {
		folderSync.getStatus().then(sendResponse);
		return true;
	}

	if (message.type === "refreshSettings") {
		if (Settings && Settings.refresh) {
			Settings.refresh()
				.then(() => sendResponse({ success: true }))
				.catch((error) => sendResponse({ success: false, error: error.message }));
			sendMessageToAllTabs({ type: "refreshSettings" });
		} else {
			sendResponse({ success: false, error: "Settings not available" });
		}
		return true;
	}

	if (message.type === "saveToLocalStorage") {
		storage
			.set(message.key, message.value)
			.then(() => sendResponse({ success: true }))
			.catch((error) => sendResponse({ success: false, error: error.message }));
		return true;
	}

	if (message.type === "clearLocalStorage") {
		storage
			.clear()
			.then(() => sendResponse({ success: true }))
			.catch((error) => sendResponse({ success: false, error: error.message }));
		return true;
	}

	if (message.action === "keywordsUpdated") {
		if (Settings && Settings.clearKeywordCache) Settings.clearKeywordCache();
		sendResponse({ success: true });
		return false;
	}

	if (message.action === "setWord" && message.word) {
		selectedWord = message.word;
		sendResponse({ success: true });
		return false;
	}

	if (message.action === "addWord" && message.word) {
		addKeyword(message.list, message.word).then(() => sendResponse({ success: true }));
		return true;
	}

	return false;
});

async function addKeyword(list, word) {
	if (!Settings) return;
	const settingKey = list === "Hide" ? "general.hideKeywords" : list === "Highlight" ? "general.highlightKeywords" : null;
	if (!settingKey) return;
	const current = (await Settings.get(settingKey)) || [];
	const next = [...current, { contains: word, without: "", etv_min: "", etv_max: "" }];
	next.sort((a, b) => a.contains.toLowerCase().localeCompare(b.contains.toLowerCase()));
	await Settings.set(settingKey, next);
	folderSync.syncNow("settings"); // no-op unless a folder is configured
}

//#####################################################
//## CONTEXT MENU
//#####################################################

chrome.runtime.onInstalled.addListener(() => {
	if (!chrome.contextMenus) return;
	try {
		chrome.contextMenus.removeAll();
		const patterns = VINE_TLDS.map((tld) => `https://*.amazon.${tld}/vine/*`);
		chrome.contextMenus.create({ id: "copy-asin", title: "Copy ASIN", contexts: ["all"], documentUrlPatterns: patterns });
		chrome.contextMenus.create({
			id: "add-to-highlightKeywords",
			title: "Add to highlight keywords",
			contexts: ["all"],
			documentUrlPatterns: patterns,
		});
		chrome.contextMenus.create({
			id: "add-to-hideKeywords",
			title: "Add to hide keywords",
			contexts: ["all"],
			documentUrlPatterns: patterns,
		});
	} catch (error) {
		console.error("[ServiceWorker] Error creating context menus:", error);
	}
});

if (chrome.contextMenus && chrome.contextMenus.onClicked) {
	chrome.contextMenus.onClicked.addListener((info, tab) => {
		if (info.menuItemId === "copy-asin") {
			chrome.tabs.sendMessage(tab.id, { action: "copyASIN" });
			return;
		}
		if (!selectedWord) return;
		const list = info.menuItemId === "add-to-hideKeywords" ? "Hide" : "Highlight";
		chrome.tabs.sendMessage(tab.id, { action: "showPrompt", word: selectedWord, list });
	});
}

//#####################################################
//## STARTUP
//#####################################################

(async function initializeServiceWorker() {
	try {
		await initializeServices();
		Settings = getSettingsManager();
		await Settings.waitForLoad();
	} catch (error) {
		console.error("[ServiceWorker] Failed to initialize services:", error);
	}
})();
