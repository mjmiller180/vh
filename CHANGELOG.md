<!-- Last compiled at 2026-11-04_2317 -->
<!-- Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved. -->
<!-- https://toolsmyths.com -->
<!-- SPDX-License-Identifier: LicenseRef-Proprietary -->

# Changelog

## [VineTools 4.5] - 2026-11

### Renamed
- The extension is now **VineTools**, a separate extension. User-visible names, the sync file (`vinetools-sync.json`) and the
  docs were renamed; internal identifiers (CSS classes, storage keys, file names) are unchanged so saved data keeps working.
- Attributions that no licence requires were removed (About tab, source comments); the required notices are in `NOTICE`.
- Every source file carries the project copyright header (`npm run stamp`, checked by `npm run check`).

### Removed
- All communication with api.vinehelper.ovh (HTTPS + WebSocket), api.llamastories.com (Brenda) and PayPal.
- UUID / device fingerprint / hashed customer id / request signing, news, reviews tools, Item Explorer,
  notification monitor, checkout recorder, variants, price + carousel, bookmark / first-seen, Patreon gating,
  sounds, confetti, chart.js, socket.io, splide, Premium + Debug settings tabs.
- `alarms` and `notifications` permissions; the CSP now allows only `self` + discord.com for connections.

### Added
- Discord webhooks to your own server (keyword / AFA / RFY / zero ETV / manual), each switchable.
- Folder sync (settings + hidden/pinned lists) through a Google Drive for desktop folder.
- Blur keywords on the normal Vine page (previously only worked in the monitor).
- `tests/` (unit + end-to-end), `tools/` (reference + no-external guards), README.

### Changed
- Every feature that remains works without a Patreon tier (`isPremiumUser()` is always true).
- Service worker rewritten: context menu, Discord POST, folder sync.

---

## Earlier notes (analysis phase)

Notes from the analysis phase, kept for history.

## [Initial State] - 2026-01-24

### Extension Information
- **Version**: 3.8.7
- **Manifest Version**: 3
- **Source**: Sideloaded from official release (GitHub repository now closed)
- **Status**: Unmodified original version

### Manifest Configuration
- **Update URL**: `https://clients2.google.com/service/update2/crx` (auto-update enabled)
- **Permissions**: alarms, contextMenus, storage, tabs, notifications
- **Host Permissions**: All Amazon domains (12 countries)
- **Background**: Service worker (vh_service_worker_di.js)

### File Inventory

#### JavaScript Files (Total: 90+)
**Main Entry Points**:
- scripts/vh_service_worker_di.js (background service worker)
- scripts/bootloaderLoader.js (content script, document_end)
- scripts/preboot_inj.js + prebootLoader.js (content script, document_start)
- scripts/review.js (review pages)
- scripts/checkoutMonitoringLoader.js (checkout pages)

**Core Services** (scripts/core/services/):
- BrendaAnnounce.js (Discord integration)
- DeviceFingerprintMgr.js
- DeviceMgr.js
- Environment.js
- HiddenListMgr.js
- Internationalization.js
- PinnedListMgr.js
- RFYNotifier.js
- SettingsMgrCompat.js
- SettingsMgrDI.js

**Notification Monitor** (scripts/notifications-monitor/):
- core/: MonitorCore.js, NotificationMonitor.js, V2, V3
- stream/: ServerCom.js, Websocket.js, WebsocketRelay*, NewItemStreamProcessing.js
- services/: ItemsMgr.js, PinMgr.js, TierMgr.js, TileCounter.js, ErrorAlertManager.js
- debug/: Memory debuggers, heap snapshot helpers

**UI Components** (scripts/ui/):
- components/: Grid.js, Tile.js, Toolbar.js, Page.js, ScreenNotifier.js, NotificationsSoundPlayer.js
- controllers/: ModalMgr.js, News.js, Pagination.js, TileSizer.js
- templates/: 20 HTML template files

**Vendor Libraries** (scripts/vendor/):
- chart.js (charting library)
- socket.io (WebSocket client)
- splide (carousel/slider)
- canvas-confetti (celebration effects)
- @kurkle/color (color utilities)
- vine-styling/ (40+ optional CSS files)

#### CSS Files (Total: 44)
**Core CSS** (resource/css/):
1. grid.css
2. icon.css
3. icon_chrome.css (+ icon_firefox.css, icon_ios.css)
4. listView.css
5. main.css
6. modal.css
7. notification.css
8. toolbar.css
9. vinehelper.css

**Vendor CSS** (scripts/vendor/vine-styling/):
- **Desktop** (21 files): dark-theme, item sizing, category styling, pagination, etc.
- **Mobile** (3 files): iOS bugfixes, mobile-specific styles

**Loaded by Content Scripts** (manifest.json lines 76-84):
- grid.css, icon.css, icon_chrome.css, main.css, modal.css, notification.css, toolbar.css, vinehelper.css

#### HTML Pages
**Extension Pages** (page/):
- settings.html (main settings page)
- notification_monitor_light.html
- item_explorer.html
- item_explorer_statistics.html
- reviews_manage.html
- reviews_templates.html
- Plus 10 template files (settings_*.tpl.html)

**Popup**:
- popup/homepage.html

#### Other Resources
- resource/image/ (extension icons and UI images)
- resource/sound/ (notification sounds)

### Features Enabled (Default Configuration)
- ✅ Notification monitoring (WebSocket connection to api.vinehelper.ovh)
- ✅ Community data sharing
- ✅ Hidden/Pinned item tabs
- ✅ Infinite spinner fixes (Types 1, 2, 3)
- ✅ ETV display
- ✅ Order confirmation system
- ✅ Review templates and saved reviews
- ✅ Discord integration (Brenda)
- ✅ Toolbar UI with all actions
- ✅ Custom styling options
- ✅ Voting system (.ca and .co.uk)
- ✅ Checkout monitoring

### External Connections (CSP)
- api.vinehelper.ovh (HTTPS + WSS)
- api.llamastories.com
- Amazon media domains
- Amazon site domains (all regions)
- PayPal domains (for donations display)

### Known Issues
- None documented yet (unmodified state)

---

## [Analysis Phase] - 2026-01-24

### Documentation Added
- PROJECT_NOTES.md - Project tracking and planning documentation
- CHANGELOG.md - This file, tracking all modifications
- HelpWiki.md - Copied official documentation from VH wiki

### Critical Discoveries

#### Discovery 1: Notification Monitor is Isolated (bootloader.js:220-256)
The Notification Monitor system ONLY loads when URL contains `#monitor`. Main Vine pages DO NOT use:
- NotificationMonitorV3 class
- WebSocket connections (Websocket.js)
- Assisted loading (AutoLoad.js)
- Any code in notifications-monitor/ folder

**Impact**: Can remove entire notifications-monitor/ folder (~70 files) without affecting main Vine page functionality.

#### Discovery 2: Toolbar Uses General Settings (Toolbar.js:49)
Main Vine page highlighting uses `general.highlightKeywords` from General settings tab.
The `notification.monitor.*` settings only apply to the #monitor page.

**Impact**: User's color customization is independent of notification monitor system.

#### Discovery 3: Discord Integration is Separate
"Send to Brenda" feature uses BrendaAnnounce.js in core/services/, NOT notifications-monitor/.

**Impact**: Discord integration preserved when removing notification monitor.

#### Discovery 4: Version Spoofing Possible (Environment.js:91-94)
Version is read from manifest.json at runtime and sent to api.vinehelper.ovh.

**Impact**: Can update manifest.json version from 3.8.7 to 3.9.7 to appear current to server.

#### Discovery 5: Telemetry Identified
**Data sent to api.vinehelper.ovh**:
- App version (manifest.json)
- UUID (user identifier)
- Fingerprint ID (device identifier)
- CID (one-way hash of Customer ID)
- Country code

**No code integrity checks detected** - Server sees version but not code modifications.

### User Feature Analysis

**Features Actually Used**:
- ✅ Hidden/Pinned tabs (HiddenListMgr.js, PinnedListMgr.js)
- ✅ Discord "Send to Brenda" (BrendaAnnounce.js)
- ✅ Webhooks to personal Discord server
- ✅ Toolbar highlighting with color customization (general.* settings)
- ✅ Custom styling/themes

**Features NOT Used** (safe to remove):
- ❌ Notification Monitor page (never visits #monitor URLs)
- ❌ Assisted loading (background page fetching)
- ❌ Review templates/saved reviews
- ❌ Item Explorer/Statistics (premium feature)
- ❌ Sound notifications
- ❌ WebSocket monitoring

### Planned Removals (~500KB estimated savings)

**Phase 1 - Core Removals**:
1. Entire notifications-monitor/ folder (~70 files)
   - WebSocket.js, ServerCom.js
   - NotificationMonitor V1/V2/V3
   - AutoLoad.js, AutoLoadCore.js, AutoLoadRFY.js
   - Stream processing, debug modules

2. Notification Monitor Pages
   - notification_monitor_light.html/js/css

3. Review System
   - reviews_manage.html/js
   - reviews_templates.html/js
   - review.js, review_inj.js

4. Item Explorer & Statistics
   - item_explorer.html/js/css
   - item_explorer_statistics.html/js

5. Chart.js Library (~250KB)
   - vendor/chart.js/*
   - vendor/@kurkle/color/*

6. Sound Notifications
   - resource/sound/* folder
   - NotificationsSoundPlayer.js

7. Canvas Confetti
   - vendor/canvas-confetti/*

**Phase 2 - Manifest & Code Updates**:
- Update manifest.json version to 3.9.7
- Remove deleted file references from manifest
- Remove NotificationMonitorV3 import from bootloader.js
- Remove notification monitor initialization block (bootloader.js:220-256)
- Clean up settings_notifications.tpl.html (remove monitor settings)

### Status
- Analysis: ✅ Complete
- Code modifications: ⏳ Pending
- Testing: ⏳ Pending

---

## [Unreleased] - Modifications In Progress

### Changed
_(No changes to code files yet - analysis phase only)_

### Removed
_(Removals will begin in next session)_

### Notes
- Ready to proceed with Phase 1 removals
- All critical dependencies identified and documented
- User workflow preserved with planned changes

---

## Future Sections (Template)

<!--
## [Version] - YYYY-MM-DD

### Added
- New files, features, or functionality

### Changed
- Modifications to existing code
- Configuration changes
- Updated dependencies

### Removed
- Deleted files
- Removed features
- Stripped functionality

### Fixed
- Bug fixes
- Performance improvements

### Security
- Security-related changes

### Notes
- Additional context about changes
- Testing results
- Compatibility notes
-->
