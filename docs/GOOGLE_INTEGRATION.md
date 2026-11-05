<!-- Last compiled at 2026-11-04_2317 -->
<!-- Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved. -->
<!-- https://toolsmyths.com -->
<!-- SPDX-License-Identifier: LicenseRef-Proprietary -->

# Google Drive / Sheets integration (plan, not built yet)

## Fixed extension ID (already in place)

`manifest.json` has a `key`, so the extension ID is **`inedmhajkpnplhgpalmckbhbkdgbheck`** on every computer, whichever
folder it is loaded from. Google sign-in is tied to this ID, so one OAuth client works everywhere.

## Requirements (updated with the owner's answers)

1. **Any Google account.** Whoever uses the extension signs in with their own account. One person with several computers
   signs in to the **same** account on each; the extension finds its data there, so nothing is configured per computer.
2. **Orders recorded automatically, as completely as possible**, so almost nothing is typed by hand. The existing "Reviews"
   workbook (Order List = raw rows, DASHBOARD = the working view) is the model: its columns are the target layout.
   DASHBOARD must end up filled in (directly or through formulas over the order tab - either is fine as long as it
   shows correctly).
3. **Replace the folder sync** with the Drive API so settings / hidden / pinned sync on any computer without Drive for
   desktop (same merge logic as today: `SyncMerge.js`).
4. **Pictures from Google Drive when submitting a review** (folders per order and one shared folder have both been
   used, so the extension must cope with either).
5. **Sign-in through Chrome** (`chrome.identity.getAuthToken`): tokens stay fresh with no hourly prompts. Chrome only.

## What can be captured automatically

At request time (Vine page): title, ASIN / parent ASIN, thumbnail, queue (RFY / AFA / AI), ETV when revealed, product URL.
At checkout confirmation (thank-you page): order number, order date, price shown, order URL. After submitting a review
through the extension: review date, link, star rating, text, which pictures were attached (feeds Pics, Review status,
Review score, Star rating, Review notes, Review date, Review link on the DASHBOARD). Delivery status needs Amazon's
order page and may be filled when that page is visited. Anything the extension cannot see stays a manual column.

## Decision needed: personal use or other people too?

"Any Google account" is where Google's rules bite:

| Permission (scope) | What it allows | Review needed for public use? |
|---|---|---|
| `drive.file` | Only files **this app created** (or that the user explicitly picks) | No |
| `spreadsheets` | Read/write **every** spreadsheet in the account | Yes (sensitive scope verification) |
| `drive.readonly` | Read **every** file in Drive | Yes (restricted scope + paid security assessment) |

* **Recommended base:** `drive.file` only. The extension **creates** its own "VineTools" spreadsheet (Order List +
  DASHBOARD + helper tabs) and its sync file in the user's Drive, and finds them again on any computer signed in to the
  same account. No review needed, least access, safest for other users.
* **Cost:** it cannot write into a spreadsheet it did not create (e.g. your existing "Reviews" file) without the broader
  `spreadsheets` scope. For personal use that is fine (Google just shows an "unverified app" screen once); for other
  people it would need Google's verification. Existing rows could be imported once instead.
* **Pictures:** with `drive.file` the extension cannot browse existing photos. Options: (a) Google Picker, where the user
  selects the photos and Google grants access to just those (needs real-world testing inside Chrome's extension
  rules); (b) `drive.readonly` (personal use only / needs assessment for the public); (c) the extension uploads the
  photos itself into a folder it created, which then needs no extra permission.

## Phases

1. Sign-in + app-created Drive file; port the sync to it (keeps the folder sync as a fallback).
2. Order capture (Vine page + thank-you page) and Order List rows, columns matched by header name.
3. DASHBOARD created/maintained with the same status / review columns and formulas.
4. Review-page helper: attach pictures from Drive; write review date / link / rating back to the row.

## One-time setup the owner does (about 10 minutes)

1. console.cloud.google.com -> new project (e.g. "VineTools").
2. APIs & Services -> Library -> enable **Google Sheets API** and **Google Drive API**.
3. OAuth consent screen -> External -> add the accounts that will sign in as **test users** and the scopes chosen above.
   Then **Publish app** to "In production": a "Testing" app makes Google expire sign-ins every 7 days.
4. Credentials -> Create credentials -> OAuth client ID -> type **Chrome extension** -> Item ID
   `inedmhajkpnplhgpalmckbhbkdgbheck`.
5. Put the client ID into `manifest.json` (`oauth2.client_id`) and reload the extension.

## Not verifiable from the build sandbox

Real Google sign-in, Sheets/Drive calls against a real account, and Amazon's real review and thank-you pages (tests can
only imitate them). Google calls will be unit-tested against a mock and the page logic against fixtures; the first real run
is the owner's.

## Still to be answered

* The Order List details: is "Order details" a link to the order URL, what is the second "Order Number" column, and should
  titles be stored plain or HTML-escaped as in the current sheet?
* Personal use only, or other people too (decides the scopes above)?
