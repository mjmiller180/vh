// Last compiled at 2026-11-05_1508
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/**
 * "Add from Google Drive…" window on the review form. Lists pictures/videos (newest first, or inside a folder, or by
 * name) with small previews; the ticked ones are downloaded and handed to the upload box.
 * All Google traffic goes through the service worker (read only); this file only draws and asks.
 * File names and folder names come from Drive and are always put on the page with textContent.
 */
const send = (message) =>
	new Promise((resolve) => {
		try {
			chrome.runtime.sendMessage(message, (res) => resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : res || { ok: false, error: "No answer" }));
		} catch (e) {
			resolve({ ok: false, error: String(e?.message || e) });
		}
	});

const CSS = `
.vsd-modal{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100001;display:flex;align-items:center;justify-content:center}
.vsd-panel{background:#fff;color:#111;width:min(860px,94vw);max-height:88vh;display:flex;flex-direction:column;border-radius:8px;padding:14px;gap:8px}
.vsd-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.vsd-grid{overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;min-height:120px}
.vsd-item{border:1px solid #ccc;border-radius:6px;padding:4px;cursor:pointer;background:#fafafa;position:relative;display:flex;flex-direction:column;gap:2px}
.vsd-item.sel{outline:3px solid #2196f3}
.vsd-item img,.vsd-thumb{width:100%;height:100px;object-fit:cover;background:#e5e5e5;display:block}
.vsd-name{font-size:.75em;word-break:break-all}
.vsd-msg{font-size:.9em;color:#555;min-height:1.2em}
.vsd-panel button,.vsd-panel input{font-size:1em;padding:3px 8px}
`;

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

function reasonText(res) {
	if (res.reason === "signin") return "Sign in to Google first: VineSmyths settings, Google tab, \"Sign in to Google\".";
	if (res.reason === "disabled") return "Pictures from Google Drive are switched off in VineSmyths' settings (Google tab).";
	return String(res.error || "Something went wrong").slice(0, 200);
}

/** @param {{attach: (files: File[]) => void}} deps */
export function openDrivePicker({ attach }) {
	if (document.querySelector(".vsd-modal")) return;
	const style = document.createElement("style");
	style.textContent = CSS;
	const mk = (tag, props = {}, kids = []) => {
		const n = document.createElement(tag);
		for (const [k, v] of Object.entries(props)) {
			if (k === "class") n.className = v;
			else if (k === "text") n.textContent = v;
			else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
			else n.setAttribute(k, v);
		}
		n.append(...kids);
		return n;
	};

	const selected = new Map(); // id -> name
	let view = { folderId: null, search: "", next: null, trail: [] }; // trail: where "Up" goes back to
	let token = 0; // a newer listing makes older answers irrelevant

	const msg = mk("div", { class: "vsd-msg", "aria-live": "polite" });
	const grid = mk("div", { class: "vsd-grid" });
	const where = mk("strong", { text: "Newest pictures" });
	const search = mk("input", { type: "search", placeholder: "Search by file name", "aria-label": "Search by file name" });
	const addBtn = mk("button", { type: "button", text: "Add 0 pictures", disabled: "" });
	const more = mk("button", { type: "button", text: "Load more", hidden: "" });
	const close = () => {
		queue.length = 0; // no more thumbnails for a window that is gone
		modal.remove();
		style.remove();
	};
	const updateAdd = () => {
		addBtn.textContent = `Add ${selected.size} picture${selected.size === 1 ? "" : "s"}`;
		addBtn.disabled = selected.size === 0;
	};

	// thumbnails: three at a time, never blocking the list
	const queue = [];
	let running = 0;
	const pump = () => {
		while (running < 3 && queue.length) {
			const job = queue.shift();
			running++;
			send({ type: "googleDriveThumb", link: job.link }).then((res) => {
				running--;
				if (res.ok && job.img.isConnected) job.img.src = `data:${res.mimeType};base64,${res.base64}`;
				pump();
			});
		}
	};

	const card = (f) => {
		if (f.isFolder) {
			return mk("div", { class: "vsd-item", role: "button", tabindex: "0", onclick: () => openFolder(f) }, [
				mk("div", { class: "vsd-thumb", text: "📁" }),
				mk("div", { class: "vsd-name", text: f.name }),
			]);
		}
		const img = mk("img", { alt: "", class: "vsd-thumb" });
		if (f.thumbnailLink) queue.push({ link: f.thumbnailLink, img });
		const c = mk("div", { class: "vsd-item", role: "checkbox", tabindex: "0", "aria-checked": "false", title: f.name }, [img, mk("div", { class: "vsd-name", text: f.name })]);
		const toggle = () => {
			const on = !selected.has(f.id);
			if (on) selected.set(f.id, f.name);
			else selected.delete(f.id);
			c.classList.toggle("sel", on);
			c.setAttribute("aria-checked", String(on));
			updateAdd();
		};
		c.addEventListener("click", toggle);
		c.addEventListener("keydown", (e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), toggle()));
		if (selected.has(f.id)) {
			c.classList.add("sel");
			c.setAttribute("aria-checked", "true");
		}
		return c;
	};

	// folderId: null = newest pictures anywhere, "start" = the folder from the settings, otherwise a folder ID
	async function load({ folderId = view.folderId, name, searchText = view.search, append = false } = {}) {
		const mine = ++token;
		if (!append) {
			view.folderId = folderId;
			view.search = searchText;
			grid.textContent = "";
			queue.length = 0;
			where.textContent = name || (view.search ? `Search: ${view.search}` : folderId ? "Folder" : "Newest pictures");
		}
		msg.textContent = "Loading…";
		more.hidden = true;
		const res = await send({ type: "googleDriveList", folderId: view.folderId, search: view.search || undefined, pageToken: append ? view.next : undefined });
		if (mine !== token) return;
		if (!res.ok) {
			msg.textContent = reasonText(res);
			return;
		}
		if (!append && res.folderName && !view.search) where.textContent = res.folderName;
		view.next = res.nextPageToken;
		for (const f of res.files) grid.append(card(f));
		msg.textContent = res.files.length || append ? "" : "Nothing here.";
		more.hidden = !res.nextPageToken;
		pump();
	}
	const openFolder = (f) => {
		view.trail.push({ folderId: view.folderId, name: where.textContent });
		load({ folderId: f.id, name: f.name, searchText: "" });
	};

	const bar = mk("div", { class: "vsd-bar" }, [
		mk("button", { type: "button", text: "Newest", onclick: () => ((view.trail = []), load({ folderId: null, searchText: "" })) }),
		mk("button", { type: "button", text: "My folder", onclick: () => ((view.trail = []), load({ folderId: "start", searchText: "" })) }),
		mk("button", { type: "button", text: "↑ Up", onclick: () => { const t = view.trail.pop(); load(t ? { folderId: t.folderId, name: t.name, searchText: "" } : { folderId: null, searchText: "" }); } }),
		search,
		mk("button", { type: "button", text: "Search", onclick: () => load({ folderId: view.folderId, searchText: search.value.trim() }) }),
		where,
	]);
	search.addEventListener("keydown", (e) => e.key === "Enter" && load({ folderId: view.folderId, searchText: search.value.trim() }));
	more.addEventListener("click", () => load({ append: true }));
	addBtn.addEventListener("click", async () => {
		addBtn.disabled = true;
		const files = [];
		let n = 0;
		for (const [id, name] of selected) {
			msg.textContent = `Downloading ${++n} of ${selected.size}…`;
			const res = await send({ type: "googleDriveFile", id });
			if (!res.ok) {
				msg.textContent = `${name}: ${reasonText(res)}`;
				addBtn.disabled = false;
				return;
			}
			files.push(new File([b64ToBytes(res.base64)], res.name || name, { type: res.mimeType }));
		}
		close();
		attach(files);
	});

	const modal = mk("div", { class: "vsd-modal", onclick: (e) => e.target === modal && close() }, [
		mk("div", { class: "vsd-panel", role: "dialog", "aria-label": "Pictures from Google Drive" }, [
			mk("div", { class: "vsd-bar" }, [mk("h3", { text: "Pictures from Google Drive", style: "margin:0;flex:1" }), mk("button", { type: "button", text: "Close", onclick: close })]),
			bar,
			grid,
			msg,
			mk("div", { class: "vsd-bar" }, [more, addBtn]),
		]),
	]);
	document.head.append(style);
	document.body.append(modal);
	updateAdd();
	load({ folderId: null });
}
