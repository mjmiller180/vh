// Last compiled at 2026-11-05_1508
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/**
 * Tools on Amazon's "write a review" form (all of it runs in the page, nothing is sent anywhere except the optional
 * Google Sheet update after you press Submit):
 *   - formatting toolbar (bold, italic, ... with Unicode letters; bullets, numbering; clear)
 *   - saved phrases and templates (kept in this browser)
 *   - autosave of the title and text per product, and a way to get the last draft back
 *   - paste / drag and drop pictures and videos into Amazon's upload box
 *   - after Submit: star rating, review date and status go to the DASHBOARD row (when the sheet link is switched on)
 * Everything the owner or Amazon wrote is put on the page with textContent / value, never as HTML.
 */
import { toggleStyle, stripStyles, bulletLines, numberLines, unlistLines } from "/scripts/review/UnicodeStyles.js";
import { openDrivePicker } from "/scripts/review/DrivePicker.js";
import { createDraftStore, createSnippetStore, draftKeyFor, pickImages, newId, todayIso } from "/scripts/review/ReviewData.js";

const SELECTORS = {
	text: "#reviewText",
	title: "#reviewTitle",
	form: "#in-context-ryp-form",
	media: "input#media[type=file]",
	dropZone: ".in-context-ryp__form-field--mediaUploadInput",
	stars: '[data-testid="in-context-ryp__form-field--starRating-single"]',
};

const STYLE_BUTTONS = [
	{ style: "bold", label: "B", title: "Bold" },
	{ style: "italic", label: "I", title: "Italic" },
	{ style: "serif", label: "𝑆", title: "Serif italic" },
	{ style: "cursive", label: "𝓒", title: "Cursive" },
	{ style: "monospace", label: "𝙼", title: "Monospace" },
	{ style: "wide", label: "Ｗ", title: "Wide" },
	{ style: "superscript", label: "ᵃ", title: "Superscript" },
	{ style: "underline", label: "U̲", title: "Underline" },
	{ style: "strikethrough", label: "S̶", title: "Strikethrough" },
];

const CSS = `
.vs-toolbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 6px}
.vs-toolbar button,.vs-toolbar select{font-size:1em;padding:2px 8px;border:1px solid #bbb;border-radius:4px;background:#f8f8f8;cursor:pointer}
.vs-toolbar button:hover{background:#e8e8e8}
.vs-status{margin-left:auto;font-size:.85em;color:#555}
.vs-drop{outline:3px dashed #2196f3;outline-offset:3px}
.vs-hint{font-size:.85em;color:#555;margin:4px 0}
.vs-modal{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100000;display:flex;align-items:center;justify-content:center}
.vs-panel{background:#fff;color:#111;max-width:640px;width:92%;max-height:80vh;overflow:auto;border-radius:8px;padding:16px}
.vs-row{display:flex;gap:8px;align-items:flex-start;border-bottom:1px solid #ddd;padding:8px 0}
.vs-row .vs-name{font-weight:bold;min-width:9em}.vs-row .vs-preview{flex:1;white-space:pre-wrap;color:#444;font-size:.9em}
`;

function el(tag, props = {}, children = []) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (k === "class") node.className = v;
		else if (k === "text") node.textContent = v;
		else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
		else node.setAttribute(k, v);
	}
	for (const c of children) node.append(c);
	return node;
}

/** Wait (without polling) until a selector exists. */
function waitFor(selector, ms = 20000) {
	return new Promise((resolve) => {
		const found = document.querySelector(selector);
		if (found) return resolve(found);
		const obs = new MutationObserver(() => {
			const n = document.querySelector(selector);
			if (n) {
				obs.disconnect();
				clearTimeout(timer);
				resolve(n);
			}
		});
		obs.observe(document.documentElement, { childList: true, subtree: true });
		const timer = setTimeout(() => {
			obs.disconnect();
			resolve(null);
		}, ms);
	});
}

/** Setting an input's value the way React notices it. */
function setNativeValue(input, value) {
	const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
	Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Replace [start,end) of a textarea; setRangeText leaves React's value tracker alone, so the input event is seen as a change. */
function replaceRange(ta, start, end, text, select = "select") {
	ta.setRangeText(text, start, end, select);
	ta.dispatchEvent(new Event("input", { bubbles: true }));
}

export async function startReviewTools() {
	const { settings } = await chrome.storage.local.get("settings");
	if (settings?.reviewTools?.enabled === false) return;
	const ta = await waitFor(SELECTORS.text);
	if (!ta || ta.dataset.vsTools) return;
	ta.dataset.vsTools = "1";

	const style = el("style", { text: CSS });
	document.head.append(style);

	const drafts = createDraftStore(chrome.storage.local);
	const phrases = createSnippetStore(chrome.storage.local, "vs.review.phrases");
	const templates = createSnippetStore(chrome.storage.local, "vs.review.templates");
	const key = draftKeyFor(location.href);

	const status = el("span", { class: "vs-status", "aria-live": "polite" });
	const say = (msg) => {
		status.textContent = msg;
	};

	// ---------- toolbar
	const hold = (e) => e.preventDefault(); // keep the selection in the textarea when a button is pressed
	const button = (label, title, onclick) => el("button", { type: "button", title, text: label, onmousedown: hold, onclick });

	const withSelection = (fn, { wholeLineWhenEmpty = false } = {}) => () => {
		let { selectionStart: s, selectionEnd: e, value } = ta;
		if (s === e) {
			if (!wholeLineWhenEmpty) return say("Select some text first.");
			s = s === 0 ? 0 : value.lastIndexOf("\n", s - 1) + 1; // (lastIndexOf with -1 would find a newline at 0)
			const nl = value.indexOf("\n", e);
			e = nl < 0 ? value.length : nl;
		}
		const next = fn(value.slice(s, e));
		replaceRange(ta, s, e, next);
		ta.focus();
	};

	const toolbar = el("div", { class: "vs-toolbar", "data-vs": "toolbar" });
	for (const b of STYLE_BUTTONS) toolbar.append(button(b.label, b.title, withSelection((t) => toggleStyle(t, b.style))));
	toolbar.append(
		button("●", "Bullet list", withSelection(bulletLines, { wholeLineWhenEmpty: true })),
		button("1.", "Numbered list", withSelection((t) => numberLines(t, 1), { wholeLineWhenEmpty: true })),
		button("1.↺", "Number the selected lines again from 1", withSelection((t) => numberLines(unlistLines(t), 1), { wholeLineWhenEmpty: true })),
		button("Tx", "Clear all styling and list marks from the selection", withSelection((t) => unlistLines(stripStyles(t)), { wholeLineWhenEmpty: true }))
	);

	// phrases + templates
	const insertAtCaret = (text) => {
		replaceRange(ta, ta.selectionStart, ta.selectionEnd, text, "end");
		ta.focus();
	};
	const snippetSelect = (store, placeholder, onPick) => {
		const sel = el("select", { title: placeholder, "aria-label": placeholder });
		const fill = async () => {
			sel.textContent = "";
			sel.append(el("option", { value: "", text: placeholder }));
			for (const s of await store.list()) sel.append(el("option", { value: s.id, text: s.name }));
		};
		sel.addEventListener("change", async () => {
			const s = (await store.list()).find((x) => x.id === sel.value);
			sel.value = "";
			if (s) onPick(s);
		});
		fill();
		return { sel, fill };
	};
	const phraseUi = snippetSelect(phrases, "Insert phrase…", (s) => insertAtCaret(s.text));
	const templateUi = snippetSelect(templates, "Insert template…", (s) => {
		if (ta.value.trim() && !confirm("Replace what you have written with the template?\n(Cancel inserts it at the cursor instead)")) return insertAtCaret(s.text);
		setNativeValue(ta, s.text);
	});
	const saveSnippet = (store, ui, what) => async () => {
		const { selectionStart: s, selectionEnd: e, value } = ta;
		const text = s === e ? value : value.slice(s, e);
		if (!text.trim()) return say(`Nothing to save as a ${what}.`);
		const name = prompt(`Name for this ${what}:`, text.split("\n")[0].slice(0, 40));
		if (!name || !name.trim()) return;
		await store.add({ id: newId(), name: name.trim().slice(0, 60), text });
		await ui.fill();
		say(`Saved ${what} "${name.trim()}".`);
	};
	toolbar.append(
		phraseUi.sel,
		templateUi.sel,
		button("＋P", "Save the selection as a phrase", saveSnippet(phrases, phraseUi, "phrase")),
		button("＋T", "Save the whole text (or the selection) as a template", saveSnippet(templates, templateUi, "template")),
		button("Manage…", "Rename or delete phrases and templates", () => manage())
	);

	// draft restore + status
	const restoreBtn = button("Restore draft", "Put the last saved draft of this review back", async () => {
		const d = await drafts.get(key);
		if (!d) return say("No saved draft.");
		setNativeValue(ta, d.text || "");
		const t = document.querySelector(SELECTORS.title);
		if (t) setNativeValue(t, d.title || "");
		say("Draft restored.");
	});
	restoreBtn.hidden = true;
	toolbar.append(restoreBtn, status);

	const placeToolbar = () => {
		if (toolbar.isConnected) return;
		const host = ta.closest('[data-testid="review-text-textarea"]') || ta.parentElement;
		host.insertBefore(toolbar, ta);
	};
	placeToolbar();
	setInterval(placeToolbar, 1500); // the page may re-render its form: put the toolbar back if it was dropped

	// ---------- manage window
	function manage() {
		const close = () => modal.remove();
		const body = el("div", { class: "vs-panel" });
		const modal = el("div", { class: "vs-modal", onclick: (e) => e.target === modal && close() }, [body]);
		const render = async () => {
			body.textContent = "";
			body.append(el("h3", { text: "Phrases and templates" }), button("Close", "Close", close));
			for (const [label, store, ui] of [["Phrases", phrases, phraseUi], ["Templates", templates, templateUi]]) {
				body.append(el("h4", { text: label }));
				const list = await store.list();
				if (!list.length) body.append(el("p", { class: "vs-hint", text: "None yet." }));
				for (const s of list) {
					body.append(
						el("div", { class: "vs-row" }, [
							el("span", { class: "vs-name", text: s.name }),
							el("span", { class: "vs-preview", text: s.text.length > 200 ? s.text.slice(0, 200) + "…" : s.text }),
							button("Insert", "Insert at the cursor", () => {
								insertAtCaret(s.text);
								close();
							}),
							button("Rename", "Rename", async () => {
								const n = prompt("New name:", s.name);
								if (n && n.trim()) {
									await store.rename(s.id, n.trim().slice(0, 60));
									await ui.fill();
									render();
								}
							}),
							button("Delete", "Delete", async () => {
								if (confirm(`Delete "${s.name}"?`)) {
									await store.remove(s.id);
									await ui.fill();
									render();
								}
							}),
						])
					);
				}
			}
		};
		document.body.append(modal);
		render();
	}

	// ---------- autosave
	const titleInput = await waitFor(SELECTORS.title, 5000);
	let timer = null;
	const saveNow = async () => {
		const text = ta.value;
		const title = titleInput ? titleInput.value : "";
		if (!text.trim() && !title.trim()) return;
		await drafts.put(key, { title, text });
		say("Draft saved " + new Date().toLocaleTimeString());
	};
	const later = () => {
		clearTimeout(timer);
		timer = setTimeout(() => saveNow().catch(() => say("Could not save the draft.")), 700);
	};
	ta.addEventListener("input", later);
	titleInput?.addEventListener("input", later);
	const existing = await drafts.get(key);
	if (existing && !existing.submittedAt) {
		if (!ta.value.trim() && !(titleInput && titleInput.value.trim())) {
			setNativeValue(ta, existing.text || "");
			if (titleInput) setNativeValue(titleInput, existing.title || "");
			say("Draft restored.");
		}
	} else if (existing) {
		restoreBtn.hidden = false; // a draft that was already submitted is only restored on request
	}

	// ---------- pictures and videos
	let uploading = Promise.resolve();
	const attach = (files) => {
		const input = document.querySelector(SELECTORS.media);
		if (!input) return say("The upload box was not found on this page.");
		const list = files.filter((f) => /^(image|video)\//.test(f.type));
		if (!list.length) return say("Those are not pictures or videos.");
		// one file at a time: Amazon's box handles each change event as one upload
		uploading = uploading.then(async () => {
			for (const f of list) {
				const dt = new DataTransfer();
				dt.items.add(f);
				input.files = dt.files;
				input.dispatchEvent(new Event("change", { bubbles: true }));
				say(`Added ${f.name || "a file"}`);
				await new Promise((r) => setTimeout(r, 1500));
			}
		});
	};
	// Exposed so the Google Drive picker (and tests) can hand files over the same way.
	window.__vsAttachFiles = attach;

	document.addEventListener("paste", (e) => {
		const imgs = pickImages(e.clipboardData);
		if (imgs.length) {
			e.preventDefault();
			attach(imgs);
		}
	});
	const zone = document.querySelector(SELECTORS.dropZone);
	if (zone) {
		const hint = el("div", { class: "vs-hint", text: "You can also paste (Ctrl+V) or drop pictures here." });
		zone.parentNode.insertBefore(hint, zone.nextSibling);
		zone.addEventListener("dragover", (e) => {
			e.preventDefault();
			zone.classList.add("vs-drop");
		});
		zone.addEventListener("dragleave", () => zone.classList.remove("vs-drop"));
		zone.addEventListener("drop", (e) => {
			e.preventDefault();
			zone.classList.remove("vs-drop");
			attach([...(e.dataTransfer?.files || [])]);
		});
		zone.parentNode.insertBefore(
			el("div", { class: "vs-toolbar" }, [
				...(settings?.google?.drive?.enabled ? [button("Add from Google Drive…", "Pick pictures from your Google Drive", () => openDrivePicker({ attach }))] : []),
				button("Paste picture from clipboard", "Add the picture you copied", async () => {
					try {
						const files = [];
						for (const item of await navigator.clipboard.read()) {
							const type = item.types.find((t) => t.startsWith("image/"));
							if (type) files.push(new File([await item.getType(type)], `pasted-${Date.now()}.${type.split("/")[1]}`, { type }));
						}
						files.length ? attach(files) : say("No picture on the clipboard.");
					} catch (err) {
						say("Chrome did not allow reading the clipboard: use Ctrl+V instead.");
					}
				}),
			]),
			hint
		);
	}

	// ---------- on Submit: keep the draft marked, tell the sheet
	const form = document.querySelector(SELECTORS.form);
	form?.addEventListener(
		"submit",
		() => {
			clearTimeout(timer); // a save still waiting from the last keystroke would rewrite the draft without its "submitted" mark
			const stars = [...document.querySelectorAll(SELECTORS.stars)];
			const rating = stars.findIndex((s) => s.getAttribute("aria-checked") === "true") + 1;
			const title = titleInput ? titleInput.value.trim() : "";
			if (!ta.value.trim() || !title) return; // the form itself will complain; nothing to record
			drafts.put(key, { title, text: ta.value, submittedAt: Date.now() }).catch(() => {});
			const asin = new URL(location.href).searchParams.get("asin");
			if (asin && rating >= 1 && rating <= 5) {
				try {
					chrome.runtime.sendMessage({ type: "googleUpdateReviews", reviews: [{ asin, status: "Pending approval", score: "Pending", starRating: rating, reviewDate: todayIso(), reviewTitle: title, reviewText: ta.value }] }, () => void chrome.runtime.lastError);
				} catch (e) {}
			}
		},
		true
	);
}
