// Last compiled at 2026-11-05_0138
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/**
 * Read-only Google Drive client for the review picture picker: list pictures/videos and folders, fetch a thumbnail,
 * download one file. Everything that touches the network is injected so it is unit tested in Node.
 * Reads only (GET); nothing in Drive is ever created, changed or deleted.
 */
const BASE = "https://www.googleapis.com";
const ID_RE = /^[A-Za-z0-9_-]{10,}$/;
const THUMB_HOST_RE = /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//i;
export const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
export const FOLDER_MIME = "application/vnd.google-apps.folder";

export class DriveError extends Error {
	constructor(status, message) {
		super(message);
		this.name = "DriveError";
		this.status = status;
	}
}

/** A Drive folder URL or a bare folder ID -> the ID, or null. */
export function extractFolderId(input) {
	if (typeof input !== "string") return null;
	const v = input.trim();
	if (ID_RE.test(v)) return v;
	const m = v.match(/^https:\/\/drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders\/|folderview\?id=|open\?id=)([A-Za-z0-9_-]{10,})/);
	return m ? m[1] : null;
}

/** Text for a Drive query string literal: backslash and single quote are escaped. */
export const queryText = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export function toBase64(bytes) {
	let bin = "";
	const step = 0x8000;
	for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
	return btoa(bin);
}

export function createDriveClient({ fetchFn = globalThis.fetch?.bind(globalThis), getToken, clearToken = async () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), baseUrl = BASE }) {
	async function get(url, { binary = false } = {}) {
		let refreshed = false;
		for (let attempt = 0; attempt < 4; attempt++) {
			const token = await getToken();
			const res = await fetchFn(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
			if (res.ok) return binary ? res : res.json();
			if (res.status === 401 && !refreshed) {
				refreshed = true;
				await clearToken(token);
				continue;
			}
			if ((res.status === 429 || res.status >= 500) && attempt < 3) {
				await sleep(1000 * 2 ** attempt);
				continue;
			}
			let message = `HTTP ${res.status}`;
			try {
				message = (await res.json())?.error?.message || message;
			} catch (e) {}
			throw new DriveError(res.status, message);
		}
		throw new DriveError(0, "Too many retries");
	}

	const FIELDS = "nextPageToken,files(id,name,mimeType,modifiedTime,size,thumbnailLink)";

	return {
		/**
		 * Pictures, videos and (when browsing a folder) sub-folders.
		 * @param {{folderId?: string, search?: string, pageToken?: string, pageSize?: number}} opts
		 *   no folderId = pictures/videos anywhere in Drive, newest first; search = name contains
		 */
		async listFiles({ folderId, search, pageToken, pageSize = 40 } = {}) {
			if (folderId !== undefined && !ID_RE.test(folderId) && folderId !== "root") throw new DriveError(400, "Invalid folder");
			const media = "(mimeType contains 'image/' or mimeType contains 'video/')";
			const parts = ["trashed = false"];
			if (folderId) {
				parts.push(`'${folderId}' in parents`);
				parts.push(`(${media} or mimeType = '${FOLDER_MIME}')`);
			} else parts.push(media);
			if (search && String(search).trim()) parts.push(`name contains '${queryText(String(search).trim().slice(0, 100))}'`);
			const qs = new URLSearchParams({
				q: parts.join(" and "),
				fields: FIELDS,
				orderBy: folderId ? "folder,modifiedTime desc" : "modifiedTime desc",
				pageSize: String(Math.min(100, Math.max(1, pageSize))),
				supportsAllDrives: "true",
				includeItemsFromAllDrives: "true",
			});
			if (pageToken) qs.set("pageToken", String(pageToken).slice(0, 2000));
			const res = await get(`${baseUrl}/drive/v3/files?${qs}`);
			return {
				files: (res.files || []).map((f) => ({
					id: f.id,
					name: f.name,
					mimeType: f.mimeType,
					isFolder: f.mimeType === FOLDER_MIME,
					modifiedTime: f.modifiedTime,
					size: f.size ? Number(f.size) : null,
					thumbnailLink: THUMB_HOST_RE.test(f.thumbnailLink || "") ? f.thumbnailLink : null,
				})),
				nextPageToken: res.nextPageToken || null,
			};
		},

		/** Name of a folder (for the path shown above the list). */
		async folderName(folderId) {
			if (!ID_RE.test(folderId)) throw new DriveError(400, "Invalid folder");
			const f = await get(`${baseUrl}/drive/v3/files/${folderId}?fields=id,name&supportsAllDrives=true`);
			return f.name || "";
		},

		/** A small picture (data for an <img>), from the thumbnail link a listing returned. */
		async thumbnail(link) {
			if (!THUMB_HOST_RE.test(String(link || ""))) throw new DriveError(400, "Not a thumbnail address");
			const res = await get(String(link).replace(/=s\d+$/, "") + "=s240", { binary: true });
			const type = (res.headers?.get?.("content-type") || "image/jpeg").split(";")[0];
			if (!/^image\//.test(type)) throw new DriveError(415, "Not a picture");
			return { mimeType: type, bytes: new Uint8Array(await res.arrayBuffer()) };
		},

		/** The whole file (refused above MAX_DOWNLOAD_BYTES, and only pictures/videos). */
		async download(fileId) {
			if (!ID_RE.test(fileId)) throw new DriveError(400, "Invalid file");
			const meta = await get(`${baseUrl}/drive/v3/files/${fileId}?fields=id,name,mimeType,size&supportsAllDrives=true`);
			if (!/^(image|video)\//.test(meta.mimeType || "")) throw new DriveError(415, "Only pictures and videos can be added");
			if (Number(meta.size) > MAX_DOWNLOAD_BYTES) throw new DriveError(413, "That file is larger than 25 MB");
			const res = await get(`${baseUrl}/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, { binary: true });
			const bytes = new Uint8Array(await res.arrayBuffer());
			if (bytes.length > MAX_DOWNLOAD_BYTES) throw new DriveError(413, "That file is larger than 25 MB");
			return { name: meta.name || "picture", mimeType: meta.mimeType, bytes };
		},
	};
}
