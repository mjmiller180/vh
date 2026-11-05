<!-- Last compiled at 2026-11-05_0138 -->
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
* **Pictures:** existing photos live both in per-order folders and in a shared folder, so the extension reads Drive with
  `drive.readonly` (restricted scope: fine for personal use, Google shows its "unverified app" screen once).

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

* **Built and tested against fakes (the sandbox cannot sign in to Google or reach Amazon):**
  * Orders: the Vine **Orders** page (`/vine/orders`) has everything per order - title, ASIN (product link), thumbnail, order
    date, Fair market value (= ETV) and the order number (link to Order details) - so no other Amazon page is needed.
    New orders are added oldest-first; an order number already on the sheet is never added again. "Send all orders" walks
    every page of the list (one request every 2 s, Amazon's own pages).
  * Reviews: the Vine **Reviews** pages (Awaiting / Reviewed) update REVIEW SATUS (LIVE / NOT SUBMITTED / REJECTED /
    PENDING APPROVAL), REVIEW SCORE, REVIEW LINK, and STATUS -> COMPLETED when a review goes live. The row is found by the
    ASIN in the TITLE cell's link (and the order date when an ASIN appears twice). Values you set by hand (TAKEN DOWN,
    DECLINE TO REVIEW, UNABLE TO REVIEW) are never replaced, unchanged cells are not rewritten.
  * Review form: pressing Submit writes star rating (as stars), today's date, PENDING APPROVAL / PENDING.
  * Pictures: "Add from Google Drive..." on the review form (Drive read only: newest pictures anywhere, a start folder, folder
    browsing, search by name; previews are fetched by the service worker so the Amazon page never contacts Google).
  * The sheet's REVIEW columns are strict dropdowns: only the exact list values are written.
* **Not verifiable here:** real Google sign-in, real Sheets/Drive calls, Amazon's live pages. Do the first run on a COPY of
  the sheet (the settings page has a dry-run preview). Drive thumbnails use the `thumbnailLink` Google returns; if Google
  refuses them with a bearer token the picker still lists the files by name.
* **Blocked on the owner:** the OAuth client ID (setup below). Because Drive was added, the OAuth consent screen needs the
  `drive.readonly` scope too, and after upgrading press "Sign in to Google" once more.
* **Still to do:** Drive-API replacement for the folder sync (settings / hidden / pinned on any computer).

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
