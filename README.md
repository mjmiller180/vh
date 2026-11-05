# Vine Helper (local-only build)

A stripped-down build of Vine Helper 3.8.7 for Amazon Vine. **It never contacts Vine Helper's servers or any
other third party.** The only traffic it adds on top of Amazon's own is a POST to *your* Discord webhook, if you
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

Removed because they needed Vine Helper's server: community ETV and order statistics, "first discovered" and
the bookmark marker, variants, price and image carousel, the notification monitor and its WebSocket, reviews
tools, Item Explorer / statistics, news, device fingerprint / UUID / account, Patreon, Brenda ("Send to Brenda"),
checkout recording, sounds, confetti.

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
file there, `vine-helper-sync.json`, with your settings, hidden items and pinned items; Drive uploads it, and every
computer pointing at the same folder merges with it:

* hidden / pinned lists: the most recent action per item wins (un-hide and un-pin propagate);
* settings: the computer that changed them last wins; country and the usage counter stay per-computer;
* a sync runs when a Vine page opens, shortly after you hide / pin / change a setting, and on **Sync now**;
* a sync file that can't be parsed is never overwritten.

Chrome may ask you to allow folder access again after a restart; if the Sync tab says "needs permission", press
**Sync now** once (that click is what lets Chrome show its prompt).

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
