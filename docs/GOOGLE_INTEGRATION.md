# Google Sheets / Drive integration (plan, not built yet)

## Fixed extension ID (already in place)

`manifest.json` has a `key`, so the extension ID is **`inedmhajkpnplhgpalmckbhbkdgbheck`** on every computer,
no matter which folder it is loaded from. Google sign-in is tied to this ID, so one OAuth client works everywhere.
(Verified: Chromium loads the extension with exactly this ID.)

## What is wanted

1. **Log orders** to the "Reviews" spreadsheet (Order List tab) - product, order date, ETV (fair market value),
   product URL, order URL, order number.
2. **Replace the folder sync** with the Drive API, so settings / hidden / pinned sync on any computer without
   Drive for desktop. Same merge logic as today (`SyncMerge.js`), different storage.
3. **Add pictures from Google Drive when submitting a review** (pick images from Drive on Amazon's review page
   and attach them to the review form).

## Google access

| Need | OAuth scope | Notes |
|---|---|---|
| Append to the existing sheet | `spreadsheets` (sensitive) | `drive.file` cannot see a sheet the app didn't create. |
| Sync file | `drive.file` | Only files this app created. Visible in Drive, same client on every computer. |
| Pick existing pictures | `drive.readonly` (restricted) | Needed to list/download images you already have. The code would only read the folder you configure and the files you pick. |

Extension changes needed: `identity` permission, an `oauth2` block in the manifest, connect-src + host permission
for `https://sheets.googleapis.com` and `https://www.googleapis.com` only, and an update of
`tools/check-no-external.cjs` so those two hosts are allowed **only** in the Google client files.

## One-time setup you will do (about 10 minutes)

1. console.cloud.google.com -> new project (e.g. "Vine Helper local").
2. APIs & Services -> Library -> enable **Google Sheets API** and **Google Drive API**.
3. OAuth consent screen -> External -> add the Google account(s) you will sign in with as **test users**, add the
   scopes above. Then **Publish app** (to "In production"): an unpublished "Testing" app makes Google expire the
   sign-in every 7 days. For personal use Google just shows an "unverified app" screen once (Advanced -> continue).
4. Credentials -> Create credentials -> OAuth client ID -> type **Chrome extension** -> Item ID
   `inedmhajkpnplhgpalmckbhbkdgbheck`.
5. Put the generated client ID into `manifest.json` (`oauth2.client_id`), reload the extension.

Sign-in uses `chrome.identity.getAuthToken`: Chrome keeps the token fresh in the background (no hourly prompts).
It needs Chrome (not other Chromium browsers) and the Google account the sheet is shared with.

## Not verifiable from this sandbox

Real Google sign-in, the Sheets/Drive calls against your account, and Amazon's real review form (the test fixture
can only imitate it). Google calls will be unit-tested against a mock and the review-page attach logic against a
fixture, but the first real run is yours.
