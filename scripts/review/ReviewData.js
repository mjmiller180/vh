// Last compiled at 2026-11-05_1508
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/** Storage and small pure helpers for the review form tools (no DOM, unit tested in Node). */

const DRAFTS_KEY = "vs.review.drafts";
const MAX_DRAFTS = 60;
const DRAFT_TTL_MS = 30 * 24 * 3600 * 1000;
const MAX_SNIPPETS = 200;
const MAX_TEXT = 20000;

/** One draft per product: the ASIN in the address, else the whole path (edit pages). */
export function draftKeyFor(href) {
	try {
		const u = new URL(href);
		const asin = u.searchParams.get("asin");
		if (asin && /^[A-Z0-9]{10}$/i.test(asin)) return "asin:" + asin.toUpperCase();
		const m = u.pathname.match(/\/edit-review\/([^/?#]+)/);
		return m ? "edit:" + m[1].slice(0, 80) : "page:" + u.pathname.slice(0, 80);
	} catch (e) {
		return "page:unknown";
	}
}

export function newId() {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function todayIso(d = new Date()) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Image files out of a paste event's clipboardData (any DataTransfer-like object). */
export function pickImages(dataTransfer) {
	const out = [];
	for (const f of Array.from(dataTransfer?.files || [])) if (/^image\//.test(f.type)) out.push(f);
	return out;
}

// storage.local is read-modify-written: queue the writes of this page so two quick saves cannot lose each other
const queues = new WeakMap();
function serial(storage, fn) {
	const prev = queues.get(storage) || Promise.resolve();
	const next = prev.then(fn, fn);
	queues.set(storage, next.catch(() => {}));
	return next;
}

export function createDraftStore(storage, now = () => Date.now()) {
	const read = async () => {
		const o = (await storage.get(DRAFTS_KEY))[DRAFTS_KEY];
		return o && typeof o === "object" && !Array.isArray(o) ? o : {};
	};
	return {
		async get(key) {
			const d = (await read())[key];
			return d && now() - (d.at || 0) < DRAFT_TTL_MS ? d : null;
		},
		put(key, draft) {
			return serial(storage, async () => {
				const all = await read();
				all[key] = { title: String(draft.title ?? "").slice(0, 500), text: String(draft.text ?? "").slice(0, MAX_TEXT), at: now(), ...(draft.submittedAt ? { submittedAt: draft.submittedAt } : {}) };
				const keep = Object.entries(all)
					.filter(([, d]) => now() - (d.at || 0) < DRAFT_TTL_MS)
					.sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
					.slice(0, MAX_DRAFTS);
				await storage.set({ [DRAFTS_KEY]: Object.fromEntries(keep) });
			});
		},
	};
}

/** Saved phrases / templates: [{id, name, text}] under one storage key. */
export function createSnippetStore(storage, storageKey) {
	const read = async () => {
		const v = (await storage.get(storageKey))[storageKey];
		return Array.isArray(v) ? v.filter((s) => s && typeof s.id === "string" && typeof s.name === "string" && typeof s.text === "string") : [];
	};
	const write = (list) => storage.set({ [storageKey]: list });
	return {
		list: read,
		add: (s) =>
			serial(storage, async () => {
				const list = await read();
				if (list.length >= MAX_SNIPPETS) throw new Error("Too many saved items");
				list.push({ id: s.id, name: String(s.name).slice(0, 60), text: String(s.text).slice(0, MAX_TEXT) });
				await write(list);
			}),
		rename: (id, name) =>
			serial(storage, async () => {
				const list = await read();
				const s = list.find((x) => x.id === id);
				if (s) s.name = String(name).slice(0, 60);
				await write(list);
			}),
		remove: (id) =>
			serial(storage, async () => {
				await write((await read()).filter((x) => x.id !== id));
			}),
	};
}
