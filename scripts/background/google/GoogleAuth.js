// Last compiled at 2026-11-05_0049
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/*global chrome*/
/**
 * Google sign-in through Chrome (chrome.identity). Chrome keeps the token fresh in the background, so there
 * are no hourly prompts. Needs the "identity" permission and the oauth2 block (client id + scopes) in the manifest.
 */
export function createGoogleAuth({ identity = globalThis.chrome?.identity, runtime = globalThis.chrome?.runtime } = {}) {
	return {
		/** @param {boolean} interactive true = may show Google's sign-in / consent window (needs a user gesture) */
		getToken(interactive) {
			return new Promise((resolve, reject) => {
				if (!identity?.getAuthToken) return reject(new Error("Sign-in is not available in this browser."));
				identity.getAuthToken({ interactive: !!interactive }, (result) => {
					const err = runtime?.lastError;
					const token = typeof result === "string" ? result : result?.token;
					if (err || !token) reject(new Error(err?.message || "The user is not signed in."));
					else resolve(token);
				});
			});
		},
		/** Drop a token Google rejected so the next getToken asks for a fresh one. */
		clearToken(token) {
			return new Promise((resolve) => {
				if (!identity?.removeCachedAuthToken) return resolve();
				identity.removeCachedAuthToken({ token }, () => resolve());
			});
		},
	};
}
