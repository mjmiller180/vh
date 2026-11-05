/** Helper class with function to detect browsers
 *
 */
export function isSafari() {
	return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
}

export function isFirefox() {
	return navigator.userAgent.includes("Firefox");
}

export function isChromium() {
	return navigator.userAgent.includes("Chrome") || navigator.userAgent.includes("Chromium");
}

export function isMobileBrowser() {
	// Check if we're in a browser environment (not service worker)
	if (typeof window === "undefined" || !navigator) {
		return false;
	}
	// Check for touch capability
	const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;

	// Check for mobile-specific features
	const hasMobileFeatures = "orientation" in window || window.devicePixelRatio > 1 || window.innerWidth <= 768;

	return hasTouch && hasMobileFeatures;
}
