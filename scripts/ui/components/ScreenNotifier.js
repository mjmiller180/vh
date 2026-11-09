// Last compiled at 2026-11-05_0035
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
import { Template } from "/scripts/core/utils/Template.js";
var Tpl = new Template();

import { SettingsMgr } from "/scripts/core/services/SettingsMgrCompat.js";
const Settings = new SettingsMgr();

/** Notification, use to configure a notification
 *  will be fed to ScreenNotifier
 * */
class ScreenNotification {
	/** Constructor
	 * @var params {
	 *    id: int, //Unique ID of the notification
	 *    title: string, //Title of the notification
	 *    content: string, //Content of the notification
	 *    lifespan: int, //Time in seconds before the notification is removed. 0 = never
	 *    sound: string, //relative URL of the sound file to play.
	 *    template: string, //relative URL of the template file to use
	 *    title_only: bool, //If true, only the title will be displayed. Default: false
	 * }
	 */
	constructor(params) {
		this.id = 0;
		this.title = "";
		this.content = "";
		this.lifespan = 0; //Will not autodelete
		this.sound = null; //relative URL of the sound file to play.
		this.volume = 1;
		this.template = null; //relative URL of the template file to use
		this.title_only = false;
		this.template = "scripts/ui/templates/notification_default.html";

		if (typeof params === "object") {
			for (const key in params) {
				this[key] = params[key];
			}
		}
	}

	//Render the notification DOM.
	async render() {
		const prom = await Tpl.loadFile(this.template);
		Tpl.setVar("id", this.id);
		Tpl.setVar("title", this.title);
		Tpl.setVar("content", this.content);
		Tpl.setIf("titleonly", this.title_only);

		const notification = Tpl.render(prom, true);

		const positionSetting = Settings.get("notification.screen.position");
		if (positionSetting) {
			notification.addEventListener("mouseover", () => {
				notification.style.right = -positionSetting + "px";
			});
			notification.addEventListener("mouseout", () => {
				notification.style.right = "0px";
			});
		}

		return notification;
	}
}

/** Handle the display of notification */
class ScreenNotifier {
	static #instance = null;

	#noteCounter;
	#lastSoundPlayedAt;

	constructor() {
		if (ScreenNotifier.#instance) {
			return ScreenNotifier.#instance;
		}
		ScreenNotifier.#instance = this;

		this.#noteCounter = 0;
		this.#lastSoundPlayedAt = Date.now();
		this.#ready = this.#init();
	}

	#ready = null;

	/**
	 * Creates the container once the page is parsed. pushNotification() waits for this, so a message sent
	 * before the container exists is delayed instead of being silently dropped.
	 */
	async #init() {
		try {
			if (document.readyState === "loading") {
				await new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
			}
			if (document.getElementById("vh-notifications-container") === null) {
				await this.#injectContainer();
			}
		} catch (e) {
			console.error("[ScreenNotifier] could not create the container:", e);
		}
	}

	async #injectContainer() {
		const prom = await Tpl.loadFile("scripts/ui/templates/notification_container.html");
		const notificationContainer = Tpl.render(prom, true);

		// Initialize the toast notification position
		const positionSetting = Settings.get("notification.screen.position");
		if (positionSetting) {
			notificationContainer.style.right = positionSetting + "px";
		}

		document.body.append(notificationContainer);
	}
	async pushNotification(note) {
		await this.#ready; //(the container exists from here on)
		note.id = this.#noteCounter++;

		//Render the notification and insert it into the container
		let content = await note.render();
		const notificationsContainer = document.getElementById("vh-notifications-container");
		if (notificationsContainer) {
			notificationsContainer.insertBefore(content, notificationsContainer.firstChild);
		}

		// Bind the "close" link
		const closeLink = document.querySelector(`#vh-notification-${note.id} .vh-notification-close a`);
		if (closeLink) {
			closeLink.addEventListener("click", (event) => {
				event.stopPropagation(); // Prevent event bubbling to the toolbar
				const notificationElement = document.getElementById(`vh-notification-${note.id}`);
				if (notificationElement) {
					this.removeNote(notificationElement);
				}
			});
		}

		//Bind the "toggle"  click
		const collapseLink = document.querySelector("#vh-notification-" + note.id + " .vh-notification-toolbar");
		if (collapseLink) {
			collapseLink.addEventListener("click", function () {
				const containerPosition = document.getElementById("vh-notifications-container").style.right;
				const positionSetting = (Settings.get("notification.screen.position") || 0) + "px";
				if (containerPosition === positionSetting || containerPosition === "") {
					document.getElementById("vh-notifications-container").style.right = "-270px";
					document.querySelectorAll(".vh-notification-toggle").forEach(function (node) {
						node.classList.remove("vh-icon-toggler-right");
						node.classList.add("vh-icon-toggler-left");
					});
				} else {
					document.getElementById("vh-notifications-container").style.right = positionSetting;
					document.querySelectorAll(".vh-notification-toggle").forEach(function (node) {
						node.classList.remove("vh-icon-toggler-left");
						node.classList.add("vh-icon-toggler-right");
					});
				}
			});
		}
		//Activate the self dismissal
		if (note.lifespan > 0) {
			setTimeout(() => {
				this.removeNote(document.getElementById("vh-notification-" + note.id));
			}, note.lifespan * 1000);
		}

		//Play a sound
		if (note.sound != null) {
			if (Date.now() - this.#lastSoundPlayedAt > 30000) {
				// Don't play the notification sound again within 30 sec.
				this.#lastSoundPlayedAt = Date.now();
				const audioElement = new Audio(chrome.runtime.getURL(note.sound));
				const handleEnded = () => {
					audioElement.removeEventListener("ended", handleEnded); // Remove the event listener
					audioElement.remove(); // Remove the audio element from the DOM
				};
				audioElement.addEventListener("ended", handleEnded);
				audioElement.volume = Number(note.volume);
				audioElement.play();
			}
		}
	}

	async removeNote(obj) {
		if (obj == null) {
			return false;
		}
		return new Promise((resolve) => {
			let opacity = 1;
			let position = 0; // Assuming the initial left position is 0, adjust as needed.
			const duration = 100; // Animation duration in milliseconds.
			const frames = 20; // Number of frames for the animation.
			const interval = duration / frames; // Time per frame.
			const incrementOpacity = 1 / frames; // Opacity decrease per frame.
			const incrementPosition = 50 / frames; // Position change per frame.

			function animate() {
				opacity -= incrementOpacity;
				position += incrementPosition;

				if (opacity <= 0) {
					opacity = 0;
					obj.style.display = "none"; // Hide the element after animation
					resolve(); // Resolve the promise when done
				} else {
					obj.style.opacity = opacity;
					obj.style.transform = `translateX(${position}px)`;
					requestAnimationFrame(animate);
				}
			}

			animate();
		}).then(() => {
			obj.remove(); // Remove the element from the DOM
		});
	}
}

export { ScreenNotification, ScreenNotifier };
