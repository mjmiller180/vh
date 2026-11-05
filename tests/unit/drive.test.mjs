// Last compiled at 2026-11-05_0209
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
import test from "node:test";
import assert from "node:assert/strict";
import { createDriveClient, extractFolderId, queryText, toBase64, DriveError, MAX_DOWNLOAD_BYTES } from "../../scripts/background/google/DriveClient.js";
import { createGoogleSheetsService } from "../../scripts/background/google/GoogleSheetsService.js";

const FOLDER_ID = "1IMVtFclNmqTsp-hGxDmvvTdfUpm-3Z62";

function fakeDrive() {
	const calls = [];
	const bytes = new Uint8Array([1, 2, 3, 4, 250, 251]);
	const handler = async (url, opts = {}) => {
		calls.push({ url, auth: opts.headers?.Authorization, method: opts.method });
		const u = new URL(url);
		const ok = (o) => ({ ok: true, status: 200, json: async () => o, headers: { get: () => null } });
		const fail = (status, message) => ({ ok: false, status, json: async () => ({ error: { message } }), headers: { get: () => null } });
		if (calls.failNext?.length) return fail(calls.failNext.shift(), "x");
		if (u.host === "lh3.googleusercontent.com") return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer, headers: { get: (h) => (h === "content-type" ? "image/jpeg" : null) } };
		if (u.pathname === "/drive/v3/files") {
			return ok({
				files: [
					{ id: "folderAAAAAA1", name: "Order 111-0000001", mimeType: "application/vnd.google-apps.folder", modifiedTime: "2026-10-01T00:00:00Z" },
					{ id: "photoBBBBBB02", name: "20261025_155816.jpg", mimeType: "image/jpeg", size: "5577234", modifiedTime: "2026-10-25T20:27:02Z", thumbnailLink: "https://lh3.googleusercontent.com/abc=s220" },
					{ id: "photoCCCCCC03", name: "evil.jpg", mimeType: "image/jpeg", thumbnailLink: "https://evil.example/t=s220" },
				],
				nextPageToken: "NEXT",
			});
		}
		const m = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
		if (m && u.searchParams.get("alt") === "media") return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer, headers: { get: () => "image/jpeg" } };
		if (m) {
			const meta = { photoBBBBBB02: { id: m[1], name: "p.jpg", mimeType: "image/jpeg", size: "6" }, bigFileAAAA01: { id: m[1], name: "big.jpg", mimeType: "image/jpeg", size: String(MAX_DOWNLOAD_BYTES + 1) }, docFileAAAAA1: { id: m[1], name: "doc", mimeType: "application/pdf", size: "5" } }[m[1]];
			if (m[1] === FOLDER_ID) return ok({ id: FOLDER_ID, name: "Amz Vine" });
			return meta ? ok(meta) : fail(404, "File not found");
		}
		throw new Error("unexpected " + url);
	};
	return { handler, calls, bytes };
}
const client = (f, extra = {}) => createDriveClient({ fetchFn: f.handler, getToken: async () => "tok", clearToken: async () => {}, sleep: async () => {}, ...extra });

test("extractFolderId / queryText / toBase64", () => {
	assert.equal(extractFolderId(`https://drive.google.com/drive/folders/${FOLDER_ID}?usp=sharing`), FOLDER_ID);
	assert.equal(extractFolderId(`https://drive.google.com/drive/u/1/folders/${FOLDER_ID}`), FOLDER_ID);
	assert.equal(extractFolderId(FOLDER_ID), FOLDER_ID);
	for (const bad of ["", "short", "https://evil.example/drive/folders/" + FOLDER_ID, null, "../../x"]) assert.equal(extractFolderId(bad), null, String(bad));
	assert.equal(queryText("it's a \\ test"), "it\\'s a \\\\ test");
	assert.equal(toBase64(new Uint8Array([72, 105])), "SGk=");
	assert.equal(toBase64(new Uint8Array(70000)).length > 90000, true, "big arrays do not blow the call stack");
});

test("listFiles: newest media anywhere vs inside a folder; names are escaped; thumbnails only from Google's image host", async () => {
	const f = fakeDrive();
	const all = await client(f).listFiles({ search: "it's" });
	const q = new URL(f.calls[0].url).searchParams;
	assert.match(q.get("q"), /trashed = false and \(mimeType contains 'image\/' or mimeType contains 'video\/'\) and name contains 'it\\'s'/);
	assert.ok(!/in parents/.test(q.get("q")));
	assert.equal(q.get("orderBy"), "modifiedTime desc");
	assert.equal(all.nextPageToken, "NEXT");
	assert.equal(all.files[0].isFolder, true);
	assert.equal(all.files[1].thumbnailLink, "https://lh3.googleusercontent.com/abc=s220");
	assert.equal(all.files[2].thumbnailLink, null, "a thumbnail link to another host is dropped");
	assert.equal(all.files[1].size, 5577234);
	await client(f).listFiles({ folderId: FOLDER_ID, pageToken: "T1" });
	const q2 = new URL(f.calls[1].url).searchParams;
	assert.match(q2.get("q"), new RegExp(`'${FOLDER_ID}' in parents and \\(\\(mimeType contains 'image/'`));
	assert.equal(q2.get("pageToken"), "T1");
	assert.equal(f.calls[1].auth, "Bearer tok");
	await assert.rejects(() => client(f).listFiles({ folderId: "x' or '1'='1" }), DriveError);
});

test("thumbnail: only googleusercontent.com, only pictures; download: media only, size limited, ids validated", async () => {
	const f = fakeDrive();
	const t = await client(f).thumbnail("https://lh3.googleusercontent.com/abc=s220");
	assert.equal(t.mimeType, "image/jpeg");
	assert.equal(new URL(f.calls.at(-1).url).pathname, "/abc=s240", "asks for the small size");
	await assert.rejects(() => client(f).thumbnail("https://evil.example/x"), /thumbnail/);
	await assert.rejects(() => client(f).thumbnail("http://lh3.googleusercontent.com/x"), /thumbnail/);
	const d = await client(f).download("photoBBBBBB02");
	assert.deepEqual([...d.bytes], [...f.bytes]);
	assert.equal(d.mimeType, "image/jpeg");
	await assert.rejects(() => client(f).download("bigFileAAAA01"), (e) => e.status === 413);
	await assert.rejects(() => client(f).download("docFileAAAAA1"), (e) => e.status === 415);
	await assert.rejects(() => client(f).download("../etc"), (e) => e.status === 400);
	await assert.rejects(() => client(f).download("missingFile001"), (e) => e.status === 404);
});

test("HTTP: 401 refreshes the token once, 429/5xx are retried (reads only), errors never contain the token", async () => {
	const f = fakeDrive();
	let cleared = 0;
	f.calls.failNext = [401];
	await client(f, { clearToken: async () => cleared++ }).listFiles();
	assert.equal(cleared, 1);
	f.calls.failNext = [429, 503];
	assert.ok((await client(f).listFiles()).files.length);
	f.calls.failNext = [403];
	await assert.rejects(() => client(f).listFiles(), (e) => e instanceof DriveError && e.status === 403 && !/tok/.test(e.message));
	assert.ok(f.calls.every((c) => c.method === "GET"), "Drive is only ever read");
});

const service = (f, cfg = { enabled: true, folder: `https://drive.google.com/drive/folders/${FOLDER_ID}` }) =>
	createGoogleSheetsService({
		getConfig: () => ({}),
		auth: { getToken: async () => "tok", clearToken: async () => {} },
		makeClient: () => {
			throw new Error("sheets not used");
		},
		makeDrive: (deps) => createDriveClient({ ...deps, fetchFn: f.handler, sleep: async () => {} }),
		getDriveConfig: () => cfg,
	});

test("service: Drive calls are refused unless switched on; 'start' means the configured folder; bad folders are rejected", async () => {
	const f = fakeDrive();
	assert.deepEqual(await service(f, { enabled: false }).driveList({}), { ok: false, reason: "disabled" });
	assert.equal(f.calls.length, 0, "nothing reaches Google while it is off");
	const start = await service(f).driveList({ folderId: "start" });
	assert.equal(start.ok, true);
	assert.equal(start.folderName, "Amz Vine");
	assert.match(new URL(f.calls[0].url).searchParams.get("q"), new RegExp(`'${FOLDER_ID}' in parents`));
	const none = await service(f, { enabled: true, folder: "" }).driveList({ folderId: "start" });
	assert.equal(none.ok, true);
	assert.ok(!/in parents/.test(new URL(f.calls.at(-1).url).searchParams.get("q")), "no folder set -> newest pictures anywhere");
	const bad = await service(f).driveList({ folderId: "../../evil" });
	assert.equal(bad.ok, false);
});

test("service: thumbnail and file come back as base64; failures are plain results", async () => {
	const f = fakeDrive();
	const th = await service(f).driveThumb({ link: "https://lh3.googleusercontent.com/abc=s220" });
	assert.deepEqual([th.ok, th.mimeType, th.base64], [true, "image/jpeg", toBase64(f.bytes)]);
	const file = await service(f).driveFile({ id: "photoBBBBBB02" });
	assert.deepEqual([file.ok, file.name, file.base64], [true, "p.jpg", toBase64(f.bytes)]);
	const nope = await service(f).driveFile({ id: "docFileAAAAA1" });
	assert.deepEqual([nope.ok, nope.status], [false, 415]);
	const noToken = createGoogleSheetsService({ getConfig: () => ({}), auth: { getToken: async () => { throw new Error("The user is not signed in."); } }, makeClient: () => {}, makeDrive: (d) => createDriveClient({ ...d, fetchFn: f.handler }), getDriveConfig: () => ({ enabled: true }) });
	assert.equal((await noToken.driveList({})).reason, "signin");
});

test("thumbnail hosts: only lh3-lh6.googleusercontent.com get the token; a 401 there does not drop the cached token (M7)", async () => {
	const f = fakeDrive();
	for (const bad of ["https://lh7.googleusercontent.com/x", "https://docs.googleusercontent.com/x", "https://evil.googleusercontent.com.example/x", "https://googleusercontent.com/x"]) {
		await assert.rejects(() => client(f).thumbnail(bad), /thumbnail/, bad);
	}
	const calls = f.calls.length;
	assert.equal(calls, 0, "no request was made for a refused address");
	let cleared = 0;
	f.calls.failNext = [401];
	await assert.rejects(() => client(f, { clearToken: async () => cleared++ }).thumbnail("https://lh3.googleusercontent.com/abc=s220"), (e) => e.status === 401);
	assert.equal(cleared, 0, "the Drive token is still good; only this thumbnail was refused");
});
