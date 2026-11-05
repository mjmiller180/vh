/**
 * This script is used to notify the content script when the URL changes.
 * It is used to detect when the user navigates to the thank you page.
 */
(function () {
	const _pushState = history.pushState;
	const _replaceState = history.replaceState;

	function notify(url) {
		// dispatch custom event that content scripts/page scripts can listen to
		window.dispatchEvent(new CustomEvent("locationchange", { detail: { url } }));
	}

	history.pushState = function (state, title, url) {
		const result = _pushState.apply(this, arguments);
		notify(url || location.href);
		return result;
	};

	history.replaceState = function (state, title, url) {
		const result = _replaceState.apply(this, arguments);
		notify(url || location.href);
		return result;
	};

	window.addEventListener("popstate", () => notify(location.href));
})();
