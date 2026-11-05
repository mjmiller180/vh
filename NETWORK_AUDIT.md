# Network audit

## Status of this build (after stripping)

Verified with `npm test`: a Vine page load makes **zero** requests other than Amazon's own, and the settings
page makes none. The only other destination possible is the user's own `discord.com` webhook (service worker,
`scripts/background/DiscordSender.js`, URL re-validated there). `tools/check-no-external.cjs` fails the build if
this ever stops being true, and it reports 49 violations when run on the original 3.8.7.

Everything below documents the **original 3.8.7** (what was removed).

Extra finding while testing the original: `scripts/ui/templates/popup_changelog.html` loaded a PayPal donate
button and a 1x1 PayPal tracking pixel whenever the "new version" popup was shown, and the notification
monitor's debug code referenced `via.placeholder.com`. Both are gone.

---

## Original 3.8.7: who this extension talks to

Audited from the code in this repo (VH Chrome 3-8-7, manifest version 4.5) by static
reading. Nothing here was observed on the wire yet; "when it fires" is from the code.
Items I did not fully trace are marked **(unverified)**.

## 1. Destinations

| Host | Protocol | Who | What for |
|---|---|---|---|
| `api.vinehelper.ovh` | HTTPS POST (JSON) | Vine Helper's server | Everything in section 3. Single choke point: `Environment.getAPIUrl()` (`scripts/core/services/Environment.js:246`), plus one direct use at `:232`. |
| `wss://api.vinehelper.ovh` | WebSocket (socket.io) | Vine Helper's server | Live new-item stream, opened from the **service worker**. Section 4. |
| `api.llamastories.com` | HTTPS POST / GET | "Brenda" Discord bot service (third party) | "Send to Brenda" announce (`BrendaAnnounce.js:13,65`) and token check (`page/settings_loadsave.js:589`). Sends your `discord.guid` token plus item info. |
| Discord webhook URL **you** type in | HTTPS | Your own Discord | `WebhookQueue.js`. User-configured, not phoning home. |
| `*.amazon.*` | HTTPS | Amazon | Normal operation (and the monitor's background page fetching). |

Static / click-only references (no automatic traffic found): `vinehelper.ovh` favicon
(monitor page only, `MonitorCore.js:292-296`), links to paypal / patreon / github / reddit
/ discord.gg / vine-wiki.com / apple sign-in in settings pages, `via.placeholder.com`
**(unverified – where it is used)**. No analytics/ads/crash-reporting libraries were found.

## 2. Identity attached to (almost) every request

`api_version, app_version, country, uuid, fid, cid`, plus a signature `s` and your
exported public key `pk` (`CryptoKeys`).

- `uuid` – issued by the server on first run (`action: get_uuid`).
- `fid` – device-fingerprint id returned by the server after `upload_fingerprint`.
- `cid` – SHA-256 of `country + your Amazon customerId` (`Environment.getCID`). One-way,
  but stable, so it links every request to your Amazon account.
- Fingerprint input (SHA-256 hashed before sending): CPU cores, device memory, screen
  size/depth, pixel ratio, languages, timezone, locale, `performance.memory`, canvas,
  WebGL and installed-font fingerprints (`DeviceFingerprintMgr.js`), plus a generated
  device name.

## 3. Server calls (`api.vinehelper.ovh`) by action

| action | When it fires | Data sent (besides identity) | Source |
|---|---|---|---|
| `get_uuid` | First run, automatic | – | `Environment.js:212` |
| `upload_fingerprint` | First run / if fingerprint missing, automatic | fingerprint hash, device name | `DeviceFingerprintMgr.js:94` |
| `get_info` | **Every Vine page load** (skipped if page came from cache). No setting found that gates it. | For every item on the page: ASIN, title, thumbnail URL, queue, enrollment GUID, parent/pre-release flags; plus your tier (silver/gold), queue, page number | `bootloader.js:1414-1469` |
| `record_etv` | When an ETV is revealed | ASIN, parent ASIN, title, thumbnail, queue, enrollment GUID, ETV value, variations | `bootloader.js:1869` |
| `record_order` | After an order attempt, and on checkout / thank-you pages | ASIN, parent ASIN, status, error | `bootloader.js:1957`, `checkoutMonitoring.js:225` (this one omits `cid`) |
| `record_unavailable` | Item reported unavailable | ASIN, reason | `bootloader.js:2041` |
| `date` | Bookmark feature | – | `bootloader.js:1090` |
| `save_hidden_list` | Each hide/unhide | ASINs changed. Whether gated by `hiddenTab.remote` **(unverified)** | `HiddenListMgr.js:189` |
| `save_pinned_list` | Each pin/unpin | ASINs changed. Gating **(unverified)** | `PinnedListMgr.js:238` |
| `reload_pinned_items` | Reload-pinned button | – | `Page.js:303` |
| `get_variants_info` | Variant button (premium-gated in code) | parent ASIN | `VariantButton.js:211` |
| `get_recordedreview`, `record_review` | Review pages (premium-gated in code) | ASINs, review done flag | `bootloader.js:398,439`, `review.js:337` |
| `get_user_stats` | Opening Settings > About | – | `settings_loadsave.js:146` |
| `load_hidden_list`, `save_hidden_list` | Settings load/save buttons | hidden list | `settings_loadsave.js:451,474` |
| `save_keywords`, `get_keywords` | Settings buttons (after confirm prompt) | **your keyword lists** | `settings_loadsave.js:1021,1046` |
| `item_explorer*`, `item_explorer_stats` | Item Explorer pages | queries | `page/item_explorer*.js` |
| `delete_device` | Settings, manual | device id | `DeviceFingerprintMgr.js:129` |

## 4. WebSocket

`Websocket.js` (in `notifications-monitor/`) is imported by the **service worker**
(`vh_service_worker_di.js:6`), not only by the `#monitor` page. The worker calls
`initializeWebsocket()` at startup and on every `masterCheck` alarm (every 0.2 min). It
connects only if `notification.connectionMode == "1"` and `notification.active` is true.
Defaults are `"0"` and `false` (`SettingsMgrDI.js:316-318`), so it should be **off unless
those were switched on in your stored settings** (I cannot see those). When on, the
handshake sends `uuid, fid, cid, app_version, country` and the server pushes items back.

## 5. Correction to the earlier notes

`HANDOFF_PROMPT.md` / `PROJECT_NOTES.md` say the Discord webhooks are separate from
`notifications-monitor/`. They are not: the webhooks (KWsMatch, AFA, RFY, zeroETV) are
queued by `notifications-monitor/stream/NewItemStreamProcessing.js` via `WebhookQueue.js`,
fed by items arriving from the monitor stream. Deleting that folder as planned would
remove them. The "Send to Brenda" button is separate (and goes to `llamastories.com`).
