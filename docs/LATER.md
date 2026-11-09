<!-- Last compiled at 2026-11-09_1434 -->
<!-- Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved. -->
<!-- https://toolsmyths.com -->
<!-- SPDX-License-Identifier: LicenseRef-Proprietary -->

# Possibly later

Ideas that were discussed and deliberately not built yet. Nothing here is promised; they are kept so they are not lost.

## On hold (owner's decision)

* **Drive-API folder sync.** Replace the folder sync (which needs Google Drive for desktop) with the Drive API so settings,
  hidden and pinned items sync on any computer. On hold; the folder sync keeps working meanwhile.

## Possibly later

* **Review notes beside the review form.** Show the product's GENERAL REVIEW NOTES (column M of the DASHBOARD, looked up
  by ASIN) in a small read-only panel next to the text box while writing a review.
* **Fill empty pictures on existing rows.** Rows entered by hand with an empty `=image("")` could get their picture from the
  Orders page (match by ASIN, write only where the cell is still empty, never replace a pasted picture).
* **PICS column.** Set it automatically when pictures are attached to a review.
* **Review date / star rating for reviews not submitted through the extension.** The Reviews list pages show neither.
* **Phrases and templates across computers.** They are kept in one browser only; they could ride along with the folder sync.
* **ETV changes after the row was added.** Existing rows are not updated.
* **Other Amazon marketplaces.** The order / review sync reads amazon.com only (D/M/YYYY dates, "16,99 €" amounts).
* **Review submitted from the form for a re-ordered ASIN or a row whose title has no product link.** Nothing is written
  (the form only knows the ASIN); the next Reviews-page sync fills the row.
* **Refused submissions.** If Amazon refuses a review on submit, the stars and date are still recorded; detecting success
  needs Amazon's live page.
* **Saved searches on narrow windows.** Extra columns are clipped instead of wrapped.
