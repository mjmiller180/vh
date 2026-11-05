/*global chrome*/

import { AutoLoadCore } from "./AutoLoadCore.js";

class AutoLoad extends AutoLoadCore {
	static #instance = null;

	#reloadTimer = null;
	#channelMessageHandler = null;
	#nextExecuteTime = null;
	#speedBoost = 1.0; //1.0 = no speed boost, 0.5 = 50% speed boost, 2.0 = 200% speed boost

	constructor(monitor) {
		super(monitor);
		if (AutoLoad.#instance) {
			return AutoLoad.#instance;
		}
		AutoLoad.#instance = this;

		this.#setReloadTimer(true);
		this.#createListener();
	}

	async resetReloadTimer(interval) {
		// Clear any existing timer first
		if (this.#reloadTimer) {
			clearTimeout(this.#reloadTimer);
			this.#reloadTimer = null;
		}

		// Update next execute time
		this.#nextExecuteTime = new Date(Date.now() + interval);

		// Update the next assisted load date display
		await this.updateNextAssistedLoadDate();

		this.#reloadTimer = setTimeout(
			() => {
				clearTimeout(this.#reloadTimer);
				this.#reloadTimer = null;
				this.#nextExecuteTime = null;
				this.#setReloadTimer();
			},
			interval //in ms
		);
	}

	/**
	 * Get the next execution time for the autoload timer
	 * @returns {Date|null} The next execution time, or null if no timer is set
	 */
	getNextExecuteTime() {
		return this.#nextExecuteTime;
	}

	/**
	 * Restart the autoload timer
	 * Called when notification.active is enabled
	 */
	async restartTimer() {
		// Clear any existing timer
		if (this.#reloadTimer) {
			clearTimeout(this.#reloadTimer);
			this.#reloadTimer = null;
			this.#nextExecuteTime = null;
		}
		// Start a new timer
		await this.#setReloadTimer(true);
	}

	#createListener() {
		// Store reference to handler for cleanup
		this.#channelMessageHandler = async (event) => {
			const data = await this._monitor._cryptoKeys.decryptToJSON(event.data);
			this.processMessage(data);
		};

		//The SW is reporting that a tab was detected to be a dog page, delay the auto-load timer for 24 hours.
		this._monitor._channel.addEventListener("message", this.#channelMessageHandler);
	}

	processMessage(message) {
		if (message.type === "dogpage") {
			this.resetReloadTimer(1000 * 60 * 60 * 24); //24 hours
		}
		//The SW is reporting that a tab was detected to be a captcha page, delay the auto-load timer for 1 hour.
		if (message.type === "captchapage") {
			this.resetReloadTimer(1000 * 60 * 60); //1 hour
		}
		//The SW is reporting that a tab was detected to be a login page, delay the auto-load timer for 1 hour.
		if (message.type === "loginpage") {
			this.resetReloadTimer(1000 * 60 * 60); //1 hour
		}
	}

	dogPageDetected() {
		console.log(`${new Date().toLocaleString()} - Dog page detected.`);
		this.resetReloadTimer(1000 * 60 * 60 * 24); //24 hours
	}

	//Check if the page is a captchapage
	captchaPageDetected() {
		console.log(`${new Date().toLocaleString()} - Captcha page detected.`);
		this.resetReloadTimer(1000 * 60 * 60); //1 hour
	}

	//Check if the page is a loginpage
	loginPageDetected() {
		console.log(`${new Date().toLocaleString()} - Login page detected.`);
		this.resetReloadTimer(1000 * 60 * 60); //1 hour
	}

	async #setReloadTimer(firstTime = false) {
		// Clear any existing timers first
		if (this.#reloadTimer) {
			clearTimeout(this.#reloadTimer);
			this.#reloadTimer = null;
			this.#nextExecuteTime = null;
		}

		// Check if notification.active is enabled
		if (!this._monitor._settings.get("notification.active")) {
			// If disabled, set a longer timer to check again later
			await this.resetReloadTimer(1000 * 60 * 15); //15 minutes
			return;
		}

		if (!this.#isTimeWithinRange()) {
			//console.log(`${new Date().toLocaleString()} - Auto-load is not active at this time`);
			await this.resetReloadTimer(1000 * 60 * 15); //15 minutes
			return;
		}

		//Send a websocket request
		if (!firstTime && this._monitor._i13nMgr.getCountryCode()) {
			//console.log("sending Reload request");
			this._monitor._sendMessageToWebsocket({
				type: "reloadRequest",
				uuid: await this._monitor._settings.get("general.uuid", false),
				fid: await this._monitor._settings.get("general.fingerprint.id", false),
				countryCode: this._monitor._i13nMgr.getCountryCode(),
			});
		}

		//Create an interval between 5 and 10 minutes to check with the server if a page needs to be refreshed
		if (this.#speedBoost <= 1) {
			this.#speedBoost = 1.0;
		}
		let min = this._monitor._settings.get("notification.autoload.min") * (1 / this.#speedBoost);
		let max = this._monitor._settings.get("notification.autoload.max") * (1 / this.#speedBoost);
		if (!min || min > 5) {
			min = 5;
		}
		if (!max || max > 10) {
			max = 10;
		}
		//const timer = 30 * 1000; //30 seconds
		const timer = Math.floor(Math.random() * (max * 60 * 1000 - min * 60 * 1000 + 1) + min * 60 * 1000); //In milliseconds
		const executeTime = new Date(Date.now() + timer);
		this.#nextExecuteTime = executeTime;

		//console.log(`${new Date().toLocaleString()} - Auto-load timer will execute at ${executeTime.toLocaleString()} (in ${Math.round(timer / 1000 / 60, 1)} minutes)`);

		// Update the next assisted load date display
		await this.updateNextAssistedLoadDate();

		this.#reloadTimer = setTimeout(async () => {
			this.#setReloadTimer(); //Create a new timer
		}, timer);

		//Reset the speed boost
		this.#speedBoost = 1.0;
	}

	#isTimeWithinRange() {
		//Check if the current time is within the auto-load time range
		const now = new Date();
		const start = new Date();
		const startTime = this._monitor._settings.get("notification.autoload.hourStart"); //03:00
		let [startHour, startMinute] = startTime.split(":").map(Number);
		if (startHour < 0 || startHour > 24) {
			console.log(`${new Date().toLocaleString()} - Invalid start hour: ${startHour}, setting to 3am`);
			startHour = 3;
		}
		if (startMinute < 0 || startMinute > 59) {
			console.log(`${new Date().toLocaleString()} - Invalid start minute: ${startMinute}, setting to 0`);
			startMinute = 0;
		}

		start.setHours(startHour);
		start.setMinutes(startMinute);
		start.setSeconds(0);

		const end = new Date();
		const endTime = this._monitor._settings.get("notification.autoload.hourEnd"); //17:00
		let [endHour, endMinute] = endTime.split(":").map(Number);
		if (endHour < 0 || endHour > 24) {
			console.log(`${new Date().toLocaleString()} - Invalid end hour: ${endHour}, setting to 17pm`);
			endHour = 17;
		}
		if (endMinute < 0 || endMinute > 59) {
			console.log(`${new Date().toLocaleString()} - Invalid end minute: ${endMinute}, setting to 0`);
			endMinute = 0;
		}
		end.setHours(endHour);
		end.setMinutes(endMinute);
		end.setSeconds(0);

		//Calculate the number of hours between the start and end times
		const hoursBetween = end.getTime() - start.getTime();
		const hours = Math.abs(hoursBetween / (1000 * 60 * 60));
		if (hours < 8) {
			console.log(
				`${new Date().toLocaleString()} - Auto-load time range is less than 8 hours, setting to 3am to 17hrs`
			);
			//Make the start time 3am and the end time 17hrs
			start.setHours(3);
			end.setHours(17);
		}

		// Handle case where start time is in the previous day (e.g., 23:00 to 09:00)
		if (start > end) {
			// If current time is before end time, we're in the next day
			if (now < end) {
				start.setDate(start.getDate() - 1);
			}
			// If current time is after start time, we're still in the same day
			else if (now >= start) {
				end.setDate(end.getDate() + 1);
			}
		}

		if (now < start || now > end) {
			return false;
		}
		return true;
	}

	setSpeedBoost(ratio = 2) {
		this.#speedBoost = ratio;
		if (this.#speedBoost <= 1) {
			this.#speedBoost = 1.0;
		}
	}

	/**
	 * Clean up resources to prevent memory leaks
	 */
	destroy() {
		// Clear timer

		if (this.#reloadTimer) {
			clearTimeout(this.#reloadTimer);
			this.#reloadTimer = null;
		}

		// Remove event listener
		if (this.#channelMessageHandler && this._monitor._channel) {
			this._monitor._channel.removeEventListener("message", this.#channelMessageHandler);
			this.#channelMessageHandler = null;
		}

		// Clear static instance reference
		AutoLoad.#instance = null;
	}
}

export { AutoLoad };
