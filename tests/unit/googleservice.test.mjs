// Last compiled at 2026-11-05_0049
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
// The Google service layer (sign-in, test connection, add orders) against fakes.
import test from "node:test";
import assert from "node:assert/strict";
import { extractSpreadsheetId, createGoogleSheetsService } from "../../scripts/background/google/GoogleSheetsService.js";

const ID = "1o1zOgVLvMNbmqvcSjWJ9wgfpEkrwlNBndEgRzSVMBpI";

test("extractSpreadsheetId: accepts a sheet URL or a bare ID, rejects anything else", () => {
	assert.equal(extractSpreadsheetId(ID), ID);
	assert.equal(extractSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=drivesdk&ouid=1`), ID);
	assert.equal(extractSpreadsheetId(`  https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0  `), ID);
	for (const bad of ["", "   ", "short", "https://evil.example/spreadsheets/d/" + ID, "https://docs.google.com/document/d/" + ID, null, undefined, 42]) {
		assert.equal(extractSpreadsheetId(bad), null, String(bad));
	}
});

const makeService = ({ cfg, tokenFails = false, clientOverrides = {} } = {}) => {
	const calls = [];
	const auth = {
		getToken: async (interactive) => {
			calls.push(["getToken", interactive]);
			if (tokenFails && !interactive) throw new Error("The user is not signed in.");
			return "tok";
		},
		clearToken: async () => calls.push(["clearToken"]),
	};
	const client = {
		loadDashboard: async (...a) => { calls.push(["loadDashboard", ...a]); return { orders: new Map([["112-8085227-2269802", 5]]), headerRow: 1, colMap: { orderNumber: 1, title: 4 }, lastDataRow: 5 }; },
		addOrders: async (...a) => { calls.push(["addOrders", ...a]); return { added: 1, skipped: 0, requests: [{ x: 1 }] }; },
		...clientOverrides,
	};
	const service = createGoogleSheetsService({ getConfig: () => cfg, auth, makeClient: () => client });
	return { service, calls };
};
const CFG = { enabled: true, id: `https://docs.google.com/spreadsheets/d/${ID}/edit`, tab: "DASHBOARD" };
const ORDER = { orderNumber: "112-8085227-2269802", orderDate: "2026-01-06", asin: "B0FZ9Y2B2T", title: "T" };

test("signIn asks Chrome for an interactive token", async () => {
	const { service, calls } = makeService({ cfg: CFG });
	assert.deepEqual(await service.signIn(), { ok: true });
	assert.deepEqual(calls[0], ["getToken", true]);
});

test("test(): reads the sheet only and reports what it found", async () => {
	const { service, calls } = makeService({ cfg: CFG });
	const r = await service.test();
	assert.equal(r.ok, true);
	assert.equal(r.orders, 1);
	assert.ok(r.columns.includes("orderNumber"));
	assert.ok(!calls.some((c) => c[0] === "addOrders"), "test() must never write");
	assert.deepEqual(calls.find((c) => c[0] === "loadDashboard").slice(1), [ID, "DASHBOARD"]);
});

test("not configured / not signed in / disabled are reported, not thrown", async () => {
	assert.equal((await makeService({ cfg: { enabled: true, id: "nope", tab: "DASHBOARD" } }).service.test()).reason, "not-configured");
	assert.equal((await makeService({ cfg: { enabled: true, id: ID, tab: "" } }).service.test()).reason, "not-configured");
	const signedOut = await makeService({ cfg: CFG, tokenFails: true, clientOverrides: { loadDashboard: async () => { throw new Error("The user is not signed in."); } } }).service.test();
	assert.deepEqual([signedOut.ok, signedOut.reason], [false, "signin"]);
	const off = await makeService({ cfg: { ...CFG, enabled: false } }).service.addOrders([ORDER]);
	assert.deepEqual([off.ok, off.reason], [false, "disabled"]);
});

test("addOrders: dry run is allowed even while disabled and never writes; a real call writes", async () => {
	const dry = makeService({ cfg: { ...CFG, enabled: false }, clientOverrides: { addOrders: async (id, tab, orders, opts) => ({ dryRun: opts.dryRun, added: orders.length, skipped: 0, requests: [{ r: 1 }] }) } });
	const d = await dry.service.addOrders([ORDER], { dryRun: true });
	assert.deepEqual([d.ok, d.dryRun, d.added], [true, true, 1]);

	const live = makeService({ cfg: CFG });
	const r = await live.service.addOrders([ORDER]);
	assert.deepEqual([r.ok, r.added, r.skipped], [true, 1, 0]);
	assert.equal(live.calls.find((c) => c[0] === "addOrders")[1], ID, "uses the parsed spreadsheet id");
});

test("errors from the client become {ok:false,error,status} without a stack or token", async () => {
	const { SheetsError } = await import("../../scripts/background/google/SheetsClient.js");
	const { service } = makeService({ cfg: CFG, clientOverrides: { addOrders: async () => { throw new SheetsError(403, "The caller does not have permission"); } } });
	const r = await service.addOrders([ORDER]);
	assert.deepEqual([r.ok, r.status, r.error], [false, 403, "The caller does not have permission"]);
	assert.equal(JSON.stringify(r).includes("tok"), false);
});

test("bad orders are rejected before anything is sent", async () => {
	const { service, calls } = makeService({ cfg: CFG });
	const r = await service.addOrders([{ ...ORDER, orderNumber: "bad" }], {});
	assert.equal(r.ok, false);
	assert.match(r.error, /order number/i);
	assert.ok(!calls.some((c) => c[0] === "addOrders" || c[0] === "loadDashboard"));
});

test("a token request that never answers times out instead of hanging the settings page", async () => {
	const never = new Promise(() => {});
	const hang = { getToken: () => never, clearToken: async () => {} };
	const { SheetsError } = await import("../../scripts/background/google/SheetsClient.js");
	const { createSheetsClient } = await import("../../scripts/background/google/SheetsClient.js");
	const service = createGoogleSheetsService({
		getConfig: () => CFG,
		auth: hang,
		tokenTimeoutMs: 40,
		signInTimeoutMs: 40,
		makeClient: (deps) => createSheetsClient({ ...deps, fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ sheets: [] }) }) }),
	});
	const t0 = Date.now();
	const r = await service.test();
	assert.deepEqual([r.ok, r.reason], [false, "signin"]);
	const s = await service.signIn();
	assert.deepEqual([s.ok, s.reason], [false, "signin"]);
	assert.ok(Date.now() - t0 < 2000, "must not hang");
	void SheetsError;
});

test("typed settings are used by test() and dry runs only; a real write ignores them", async () => {
	const typed = { id: ID, tab: "COPY OF DASHBOARD" };
	const empty = { enabled: true, id: "", tab: "" };
	const a = makeService({ cfg: empty });
	assert.equal((await a.service.test(typed)).ok, true);
	assert.deepEqual(a.calls.find((c) => c[0] === "loadDashboard").slice(1), [ID, "COPY OF DASHBOARD"]);
	const b = makeService({ cfg: empty });
	assert.equal((await b.service.addOrders([ORDER], { dryRun: true, config: typed })).ok, true);
	const c = makeService({ cfg: empty });
	assert.deepEqual((await c.service.addOrders([ORDER], { config: typed })).reason, "not-configured", "a real write must not trust typed values");
});
