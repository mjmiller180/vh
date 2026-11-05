<!-- Last compiled at 2026-11-05_1200 -->
<!-- Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved. -->
<!-- https://toolsmyths.com -->
<!-- SPDX-License-Identifier: LicenseRef-Proprietary -->

# VineTools

A browser extension for Amazon Vine. **It never contacts any server of its own or any
third party.** The only traffic it adds on top of Amazon's own is a POST to *your* Discord webhook, if you
switch that on.

## Install

1. `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick this folder.
2. Open a Vine page once (this sets your country), then open the extension's settings from its toolbar icon.

## What it does

Kept (all local): hidden / pinned tabs, keyword highlight / hide / **blur**, ETV display (when you reveal an
ETV), list view, tile sizing, all the style options, keyboard shortcuts, "copy ASIN" and "add keyword" context
menu, skip-Prime-ad at checkout, and every option that used to be Patreon-gated and works without a server
(ETV modifier, hide recommendations / side cart / categories / opt-out button, verbose pagination, modal
navigation, custom CSS, force Tango...). Nothing is gated any more.

Not included, because they depended on a central server: community ETV and order statistics, "first discovered" and
the bookmark marker, variants, price and image carousel, the notification monitor and its WebSocket, reviews
tools, Item Explorer / statistics, news, device fingerprint / UUID / account, Patreon, Brenda ("Send to Brenda"),
checkout recording, sounds, confetti.

## SmartSkip (Settings -> Keyboard)

Press **k** on a Vine page and VineTools pages through the queue on a timer, stopping at the first page that has an item
you have **not pinned** (items already hidden are ignored). **Space** pauses / resumes (resuming re-checks the page you
are on, so pin or hide what it found and press Space to carry on), **Escape** stops and shows the totals, the previous-page
key applies the brake (and also goes back one page), and the next-page / hide-all keys hand control back to you (scanning resumes on the next page).
The queue, keys, delays (never below 2 seconds), and a page limit are configurable. The session lives in the tab only and
nothing is sent anywhere. Automated paging is outside what Amazon's Vine terms expect from normal use, so treat it as a
convenience you run at your own risk and keep the delays generous.

## Google Sheet, review tools and Drive pictures (Settings → Google)

- **Orders → sheet.** Open Vine → Orders: new orders are added to the DASHBOARD tab of your sheet (date, order number,
  picture, ORDERED, title, ETV). The button above the list ("Send all orders to the sheet") does every page.
- **Delivery date.** At checkout and on the "Order placed" page, VineTools remembers the estimated delivery date; when the
  order shows up on the Orders page the new row gets it in DELIVERY DATE. (Neither page shows the order number, so the
  rows themselves still come from the Orders page.)
- **Reviews → sheet.** Open Vine → Reviews (Awaiting / Reviewed): status, quality score and review link are filled in on the
  matching rows. Anything you set by hand (TAKEN DOWN ...) is left alone.
- **Review form.** On Amazon's "write a review" page: formatting toolbar (bold, italic ... with Unicode letters, bullets,
  numbering), saved phrases and templates, automatic drafts, paste or drop pictures, "Add from Google Drive…". Pressing
  Submit records the star rating, date, review title and text on the sheet (columns "REVIEW TITLE" and "REVIEW TEXT").
- The order/review sync reads **amazon.com** only (other sites write dates and amounts differently).
- Everything is off until you switch it on; try it on a copy of your sheet first (see `docs/GOOGLE_INTEGRATION.md`).

## Discord (Settings → Discord)

Turn on **Send items to my Discord**, paste your webhook URL (Discord: Channel settings → Integrations →
Webhooks), then switch on whichever triggers you want, each with its own on/off, optional own URL and message:

| Trigger | Fires when |
|---|---|
| Keyword match | an item title matches one of your *highlight* keywords |
| AFA / RFY | you browse that queue and an item appears |
| Zero ETV | an item's ETV is revealed (by you) and is $0 |
| Manual button | you click the Discord button on an item's toolbar |

An item is sent **once per trigger** (remembered 14 days), so reloading a page doesn't repeat it. If an item
matches several triggers going to the same webhook it is sent once, using keyword > zero ETV > RFY > AFA.
Messages are JSON with placeholders `$QUEUE_NAME $TITLE $IMG_URL $ASIN $VH_URL $VINE_SEARCH_URL $AMZ_URL
$KEYWORD $ETV` (values are escaped for you). Only `discord.com` / `discordapp.com` webhook URLs are accepted.

Automatic triggers run while you browse Vine pages; there is no background monitor.

## Sync with a Google Drive folder (Settings → Sync)

Choose a folder inside **Google Drive for desktop** (e.g. `G:\My Drive\Amz Vine\Sync`). The extension keeps one
file there, `vinetools-sync.json`, with your settings, hidden items and pinned items; Drive uploads it, and every
computer pointing at the same folder merges with it:

* hidden / pinned lists: the most recent action per item wins (un-hide and un-pin propagate);
* settings: the computer that changed them last wins; country and the usage counter stay per-computer;
* a sync runs when a Vine page opens, shortly after you hide / pin / change a setting, and on **Sync now**;
* a sync file that can't be parsed is never overwritten.

Things worth knowing:

* **The file is plain JSON in your Drive and includes your Discord webhook URLs**, so treat the folder like a
  password store. The tab-to-tab encryption keys and per-computer values (country, usage counter, leftovers of the
  old server accounts) are never written to it.
* **A brand-new computer adopts the file's settings**; it never overwrites them with defaults. Only real edits you
  make on a computer count as "newest" (opening the settings page does not).
* **"Last edit wins" depends on each computer's clock being roughly right.** A clock that is far ahead will win
  settings conflicts.
* **Choose the folder from the full settings page** (not the toolbar popup: it closes when Chrome's folder dialog
  opens). Chrome may ask you to allow access again after a restart; a "Folder sync needs attention" message then
  appears on Vine pages. Open Settings -> Sync and press **Sync now** once.
* "Delete all hidden items", importing a list, and **Show all** are treated as real un-hides, so they propagate to
  your other computers instead of being quietly undone by the next sync.
* **Factory reset** makes the computer look like a fresh install, so the next sync brings your settings and lists
  back from the folder. Press "Stop syncing" first if you really want to start over.
* A sync file that cannot be read is never overwritten.

## Checks

```bash
npm run check      # every file reference resolves + nothing can reach a non-Amazon/non-Discord host
npm run test:unit  # merge logic, webhook validation, sync engine (two simulated computers)
npm run test:e2e   # real Chromium + this extension + a fixture Vine page + a mock Discord
npm test           # all of the above
```

`tools/check-no-external.cjs` fails if any file mentions another host, uses a network call outside the three
approved files, or the manifest asks for more hosts / permissions. `NETWORK_AUDIT.md` documents what the original
3.8.7 sent and to whom. Old notes are in `docs/old-notes/`.

## Licence and credits

`LICENSE` covers the project code; everything derived from or bundled with other people's work (the extension this one grew out of,
vine-styling, icons, ...) and its licence is listed in `NOTICE`.
