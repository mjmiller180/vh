// Last compiled at 2026-11-05_0138
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/**
 * The layer the service worker calls: reads the Google settings, signs in, tests the connection and adds orders.
 * Everything chrome-specific is injected (auth, getConfig, makeClient) so it is unit tested in Node.
 * Results are plain objects: {ok:true,...} or {ok:false, reason|error, status?} - never a thrown error, never a token.
 */
import { buildOrderValidation } from "./orderValidation.js";
import { extractFolderId, toBase64 } from "./DriveClient.js";

const ID_RE = /^[A-Za-z0-9_-]{20,}$/;

/** A Google Sheets URL or a bare spreadsheet ID -> the ID, or null. */
export function extractSpreadsheetId(input) {
	if (typeof input !== "string") return null;
	const v = input.trim();
	if (ID_RE.test(v)) return v;
	const m = v.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:[/?#].*)?$/);
	return m ? m[1] : null;
}

/** Reject if `promise` has not settled after `ms` (Chrome's token request can hang when sign-in is not possible). */
function withTimeout(promise, ms, message) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(message)), ms);
		promise.then(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			(e) => {
				clearTimeout(timer);
				reject(e);
			}
		);
	});
}

export function createGoogleSheetsService({ getConfig, auth, makeClient, makeDrive, getDriveConfig = () => ({}), tokenTimeoutMs = 15000, signInTimeoutMs = 180000 }) {
	// `override` (the values typed in the settings page) is only ever used by the read-only calls: test() and dry runs.
	const config = (override) => {
		const cfg = { ...(getConfig() || {}), ...(override && typeof override === "object" ? { id: override.id, tab: override.tab } : {}) };
		const id = extractSpreadsheetId(cfg.id);
		const tab = typeof cfg.tab === "string" ? cfg.tab.trim() : "";
		return { enabled: !!cfg.enabled, id, tab, valid: !!id && tab.length > 0 };
	};
	const client = () =>
		makeClient({
			getToken: () => withTimeout(auth.getToken(false), tokenTimeoutMs, "Google did not answer: you are not signed in."),
			clearToken: (t) => auth.clearToken(t),
		});

	const tokenGetter = () => ({
		getToken: () => withTimeout(auth.getToken(false), tokenTimeoutMs, "Google did not answer: you are not signed in."),
		clearToken: (t) => auth.clearToken(t),
	});
	// Pictures from Drive: only when switched on in the settings; reads only.
	const drive = async (fn) => {
		const cfg = getDriveConfig() || {};
		if (!cfg.enabled) return { ok: false, reason: "disabled" };
		try {
			return { ok: true, ...(await fn(makeDrive(tokenGetter()), cfg)) };
		} catch (e) {
			return fail(e);
		}
	};

	const fail = (e) => {
		const message = String(e?.message || e);
		if (/not signed in|sign-in|OAuth2|interactive|did not approve/i.test(message)) return { ok: false, reason: "signin", error: message };
		return { ok: false, error: message, ...(e?.status ? { status: e.status } : {}) };
	};

	return {
		/** Pictures/videos and folders for the picker. `folderId` may be a Drive URL or ID; empty = pictures anywhere in Drive. */
		driveList({ folderId, search, pageToken } = {}) {
			return drive(async (d, cfg) => {
				const wanted = folderId === "start" ? extractFolderId(cfg.folder || "") || undefined : folderId === undefined || folderId === null || folderId === "" ? undefined : folderId;
				if (wanted !== undefined && wanted !== "root" && !extractFolderId(wanted)) throw new Error("That is not a Drive folder");
				const res = await d.listFiles({ folderId: wanted, search, pageToken });
				const name = wanted && wanted !== "root" ? await d.folderName(wanted).catch(() => "") : wanted === "root" ? "My Drive" : "";
				return { ...res, folderId: wanted || null, folderName: name };
			});
		},
		driveThumb({ link } = {}) {
			return drive(async (d) => {
				const t = await d.thumbnail(link);
				return { mimeType: t.mimeType, base64: toBase64(t.bytes) };
			});
		},
		driveFile({ id } = {}) {
			return drive(async (d) => {
				const f = await d.download(id);
				return { name: f.name, mimeType: f.mimeType, base64: toBase64(f.bytes) };
			});
		},

		/** Must be called from a user click (Chrome shows Google's window). */
		async signIn() {
			try {
				await withTimeout(auth.getToken(true), signInTimeoutMs, "Sign-in timed out. Please try again.");
				return { ok: true };
			} catch (e) {
				return fail(e);
			}
		},

		/** Reads the sheet only: finds the header row and counts the orders already there. Writes nothing. */
		async test(override) {
			const cfg = config(override);
			if (!cfg.valid) return { ok: false, reason: "not-configured" };
			try {
				const dash = await client().loadDashboard(cfg.id, cfg.tab);
				return { ok: true, orders: dash.orders.size, headerRow: dash.headerRow + 1, lastDataRow: dash.lastDataRow + 1, columns: Object.keys(dash.colMap) };
			} catch (e) {
				return fail(e);
			}
		},

		/** @param {object[]} orders  @param {{dryRun?: boolean}} opts  dryRun returns what WOULD be written */
		/** Review status / score / link from the Vine reviews pages -> the matching DASHBOARD rows. */
		async updateReviews(reviews, { dryRun = false, config: override } = {}) {
			const cfg = config(dryRun ? override : undefined);
			if (!cfg.valid) return { ok: false, reason: "not-configured" };
			if (!dryRun && !cfg.enabled) return { ok: false, reason: "disabled" };
			if (!Array.isArray(reviews) || reviews.length === 0) return { ok: false, error: "No reviews to update" };
			if (reviews.length > 200) return { ok: false, error: "Too many reviews in one request (max 200)" };
			const clean = [];
			for (const r of reviews) {
				if (!r || !/^[A-Z0-9]{10}$/i.test(String(r.asin || ""))) continue;
				clean.push({
					asin: String(r.asin).toUpperCase(),
					orderDate: typeof r.orderDate === "string" ? r.orderDate : undefined,
					status: typeof r.status === "string" ? r.status.slice(0, 60) : "",
					score: typeof r.score === "string" ? r.score.slice(0, 30) : "",
					starRating: Number.isInteger(r.starRating) && r.starRating >= 1 && r.starRating <= 5 ? r.starRating : undefined,
					reviewDate: typeof r.reviewDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.reviewDate) ? r.reviewDate : undefined,
					reviewLink: typeof r.reviewLink === "string" && /^https:\/\/www\.amazon\.[a-z.]{2,7}\/[^\s]*$/i.test(r.reviewLink) ? r.reviewLink : "",
				});
			}
			if (clean.length === 0) return { ok: false, error: "No valid reviews to update" };
			try {
				const res = await client().updateReviews(cfg.id, cfg.tab, clean, { dryRun });
				return { ok: true, ...res };
			} catch (e) {
				return fail(e);
			}
		},

		async addOrders(orders, { dryRun = false, config: override } = {}) {
			const cfg = config(dryRun ? override : undefined); //a real write only ever uses the saved settings
			if (!cfg.valid) return { ok: false, reason: "not-configured" };
			if (!dryRun && !cfg.enabled) return { ok: false, reason: "disabled" };
			const check = buildOrderValidation(orders);
			if (!check.ok) return { ok: false, error: check.error };
			try {
				const res = await client().addOrders(cfg.id, cfg.tab, orders, { dryRun });
				return { ok: true, ...res };
			} catch (e) {
				return fail(e);
			}
		},
	};
}
