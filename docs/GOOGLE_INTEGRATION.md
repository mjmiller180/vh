<!-- Last compiled at 2026-11-05_0035 -->
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

## Decisions made

* **Personal use for now.** If it is ever shared it will be with a few people, as a standalone extension, each linking their
  own Google account. So the broader `spreadsheets` permission is acceptable (Google shows an "unverified app" screen once);
  it writes straight into the existing "Reviews" workbook. `drive.file` is used for the app's own files (the sync file).
* **DASHBOARD is the target.** The "Order List" tab was only scratch space for building links; the extension writes rows
  to DASHBOARD directly, matching columns by header text.
* **Pictures:** existing photos live both in per-order folders and in a shared folder; reading them needs `drive.readonly`
  (personal use only) - to be decided when the review-page work starts.

## DASHBOARD columns (owner's spec) and where each value comes from

| Col | Header | Value | Source |
|---|---|---|---|
| A | ORDER DATE | date the order was placed | order confirmation / order page |
| B | ORDER # | order number, linked to `https://www.amazon.com/your-orders/order-details?orderID=<n>` | order page |
| C | IMAGE | `=IMAGE("<thumbnail url>")` | Vine tile thumbnail |
| D | STATUS | always starts as `ORDERED` | extension |
| E | TITLE (PRODUCT LINK) | title linked to `https://www.amazon.com/dp/<ASIN>` | Vine tile / order page |
| F | ETV | estimated tax value | revealed ETV / order page |
| G | DELIVERY STATUS | no longer used | - |
| H | DELIVERY DATE | manual | - |
| I | PICS | pictures ready (manual; later set automatically when pictures are attached) | manual / review helper |
| J | REVIEW SATUS (sic) | status of the submitted review | reviews list / review helper |
| K | REVIEW SCORE | shown in the submitted reviews list | reviews list |
| L | STAR RATING | the star rating given | review form |
| M | GENERAL REVIEW NOTES | notes for writing the review (manual) | manual |
| N | REVIEW DATE | date the review was submitted | reviews page / review helper |
| O | REVIEW LINK | link from the submitted reviews list | reviews list |

## Status

* **Built and unit tested (against an in-memory fake of the Sheets API):** `scripts/core/utils/DashboardRow.js` (column
  mapping by header, date serials, linked cells, IMAGE formula, ORDERED) and `scripts/background/google/SheetsClient.js`
  (first empty row, copies formatting + dropdowns from the last row, one cell per write so manual columns/formulas are never
  cleared, duplicate order numbers skipped, token refresh on 401, retry on 429/5xx, dry run). Not wired into the extension
  yet, so it cannot reach Google.
* **Blocked on the owner:** (1) the OAuth client ID (setup below); (2) saved samples of the Amazon pages the extension has
  to read: order confirmation, Your Orders list, one order details page (shows the ETV), the review form with the photo
  upload area, and the submitted-reviews list.
* **Next, once those arrive:** sign-in + settings tab (sheet ID, tab name, dry run, "test on a copy"), order capture ->
  rows, review helper -> review columns and pictures, Drive-API sync.

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
