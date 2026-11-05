(function () {
	//In the notification monitor, block the MutationObservers from holding references to the DOM nodes.
	if (window.location.href.match(/^[^#]+#monitor$/) != null) {
		// Monkey patch MutationObserver to prevent memory leaks
		const OriginalMutationObserver = window.MutationObserver;
		window.MutationObserver = function (callback) {
			// Create observer with wrapped callback that cleans up references
			const observer = new OriginalMutationObserver((mutations, obs) => {
				try {
					// Call original callback
					//callback(mutations, obs); //Do not call the original callback, or it will hold references to the DOM nodes.
				} finally {
					// Clear mutation records to prevent holding references
					mutations.forEach((mutation) => {
						mutation.target = null;
						mutation.previousSibling = null;
						mutation.nextSibling = null;
						mutation.addedNodes = null;
						mutation.removedNodes = null;
					});
				}
			});

			// Copy prototype methods
			observer.observe = OriginalMutationObserver.prototype.observe.bind(observer);
			observer.disconnect = OriginalMutationObserver.prototype.disconnect.bind(observer);
			observer.takeRecords = OriginalMutationObserver.prototype.takeRecords.bind(observer);

			return observer;
		};

		try {
			// Throttle querySelectorAll abuse
			const origQS = document.querySelectorAll.bind(document);
			document.querySelectorAll = function (sel) {
				if (typeof sel === "string" && /hover|tooltip|popover/i.test(sel)) {
					// Skip overly-chatty selectors
					return [];
				}
				return origQS(sel);
			};

			// Shield expensive style reads (offsetHeight/Width)
			const descH = Object.getOwnPropertyDescriptor(Element.prototype, "offsetHeight");
			if (descH && typeof descH.get === "function") {
				const origGetH = descH.get;
				Object.defineProperty(Element.prototype, "offsetHeight", {
					get() {
						try {
							if (this.classList && this.classList.contains("a-popover")) return 0;
						} catch {
							//Do nothing
						}
						return origGetH.call(this);
					},
				});
			}

			const descW = Object.getOwnPropertyDescriptor(Element.prototype, "offsetWidth");
			if (descW && typeof descW.get === "function") {
				const origGetW = descW.get;
				Object.defineProperty(Element.prototype, "offsetWidth", {
					get() {
						try {
							if (this.classList && this.classList.contains("a-popover")) return 0;
						} catch {
							//Do nothing
						}
						return origGetW.call(this);
					},
				});
			}

			console.log("AmazonUIJQuery patch: throttling heavy style recalcs.");
		} catch (e) {
			console.warn("Patch failed:", e);
		}

		// Block unwanted scroll, pointerleave, and mousedown listeners
		const origAdd = window.addEventListener;
		const origRemove = window.removeEventListener;

		const blockedTypes = ["scroll", "pointerenter", "pointerleave", "mousedown"];

		const whitelistPrefixes = [
			location.origin, // same-origin scripts (optional)
			"chrome-extension", // your extension world
		];

		const getCallerSource = () => {
			const stack = new Error().stack || "";
			const line = stack.split("\\n")[2] || "";
			return line;
		};

		window.addEventListener = function (type, listener, options) {
			if (blockedTypes.includes(type)) {
				const src = getCallerSource();
				const allowed = whitelistPrefixes.some((p) => src.includes(p));
				if (!allowed) {
					console.warn(`[VH ${type.toUpperCase()} BLOCKED]`, src);
					return; // ignore main-world event listeners
				}
			}
			return origAdd.call(this, type, listener, options);
		};

		window.removeEventListener = function (type, listener, options) {
			return origRemove.call(this, type, listener, options);
		};
	}
})();

/**
 * Unused as it's causing internal errors.
 * Unsure if there's actually a performance gain for high number of items.
 */
function disableAmzBootloader() {
	// A universal no-op proxy that safely absorbs any property or call
	const noopProxy = new Proxy(function () {}, {
		get: () => noopProxy,
		apply: () => noopProxy,
		set: () => true,
		has: () => true,
	});

	const stub = {
		load: () => noopProxy, // supports .js(), .css(), .log(), etc.
		when: () => ({ execute: () => {}, ready: () => {} }),
		now: () => {},
		require: () => ({}),
		register: () => {},
		trigger: () => {},
		namespace: undefined,
		attribution: undefined,
	};
	Object.freeze(stub);

	const defineSafe = (name) => {
		const desc = Object.getOwnPropertyDescriptor(window, name);
		if (!desc) {
			Object.defineProperty(window, name, {
				configurable: false,
				enumerable: false,
				writable: false,
				value: stub,
			});
		} else {
			try {
				Object.assign(window[name], stub);
			} catch {
				//Do nothing
			}
		}
	};

	["P", "AmazonUIPageJS", "aui", "CreateMonitor", "Profiler", "Scheduler"].forEach(defineSafe);

	console.log("[VH] stealth stub v2 active");
}
