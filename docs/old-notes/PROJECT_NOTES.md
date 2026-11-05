# Vine Helper 3.8.7 Modification Project

## Project Overview
Modifying Vine Helper Chrome Extension v3.8.7 to strip away unnecessary features and potentially create a lightweight companion extension for CSS/styling to improve performance.

## Current Status
- **Extension Version**: 3.8.7 (will update to 3.9.7 to avoid detection)
- **Current State**: Analysis complete - ready to begin removals
- **Next Step**: Remove confirmed unused features (reviews, notification monitor, statistics)

## Goals
1. **Primary**: Strip away unnecessary features from VH 3.8.7
2. **Secondary**: Potentially create a companion extension for CSS/styling to reduce load
3. **Future**: Install modified extension outside Developer Mode using Chrome Enterprise Policies

## Background Context
- User runs a Tampermonkey userscript alongside Vine Helper
- VH update to v3.9.5 broke the userscript
- Reverted to v3.8.7 by sideloading
- GitHub repository is no longer available (closed by developers)
- HelpWiki documentation is outdated but provides feature overview

## Extension Structure Analysis

### File Organization
```
VH Chrome 3-8-7/
├── manifest.json (Manifest V3)
├── scripts/
│   ├── Core scripts (bootloader, service worker, etc.)
│   ├── core/ (models, services, utils)
│   ├── infrastructure/ (DI container, adapters)
│   ├── notifications-monitor/ (WebSocket, item stream processing)
│   ├── ui/ (components, controllers, templates)
│   └── vendor/ (chart.js, socket.io, splide, vine-styling CSS)
├── resource/css/ (10 core CSS files)
├── page/ (extension pages: settings, notification monitor, reviews)
└── popup/ (extension popup interface)
```

### Content Scripts Loaded (from manifest)
**CSS Files (8 total)**:
- grid.css
- icon.css, icon_chrome.css
- main.css
- modal.css
- notification.css
- toolbar.css
- vinehelper.css

**JavaScript Files**:
- bootloaderLoader.js (document_end)
- preboot_inj.js, prebootLoader.js (document_start)
- review.js (on review pages)
- checkoutMonitoringLoader.js (on checkout pages)

### Key Features (from HelpWiki)
1. **Notification Monitor** - Tracks new items via WebSocket, community sharing
2. **Hidden/Pinned Tabs** - Item filtering and bookmarking
3. **Infinite Spinner Fix** - Fixes Amazon Vine variant issues (Type 1, 2, 3)
4. **Review Templates & Saved Reviews** - Review management tools
5. **Discord Integration (Brenda)** - Announce items to Discord
6. **Toolbar UI** - Main interface for actions
7. **Community Data Sharing** - ETV ranges, order success/failure stats
8. **Custom Styling** - 40+ optional CSS files for themes/customization

## Potential Components to Extract/Remove

### High Priority - Performance Impact
- **CSS/Styling System** (40+ optional CSS files in vendor/vine-styling/)
  - Dark theme, item sizing, category styling, etc.
  - Could become standalone companion extension

- **Chart.js & Analytics** (Large vendor library)
  - Used for statistics/graphs
  - May not be essential to core functionality

### Medium Priority - Modular Features
- **Discord Integration (Brenda)** - If not used
- **Review Templates & Management** - Self-contained feature
- **Sound Notifications** - Optional enhancement
- **Canvas Confetti** - Visual celebration effects

### Core Features to Keep
- ✅ Notification monitoring (WebSocket for new items)
- ✅ Hidden/Pinned item management
- ✅ Infinite spinner fix
- ✅ Core toolbar and grid UI
- ✅ Settings management
- ✅ Community data sharing (if desired)

## Questions Answered ✅

### User Actually Uses:
- ✅ **Hidden/Pinned tabs** - Core workflow feature
- ✅ **Discord "Send to Brenda"** - BrendaAnnounce.js (announce button on items)
- ✅ **Webhooks** - Personal Discord server notifications
- ✅ **Toolbar highlighting** - Uses `general.*` settings (NOT notification.monitor.*)
- ✅ **Custom styling/themes** - Color customization in General settings

### User Does NOT Use:
- ❌ **Notification Monitor page** - Never visits URLs with #monitor
- ❌ **Assisted loading** - Doesn't use background page fetching
- ❌ **Review templates/saved reviews** - Doesn't write reviews with VH
- ❌ **Item Explorer/Statistics** - Never seen it (premium feature)
- ❌ **Sound notifications** - Disabled
- ❌ **WebSocket monitoring** - Only works with #monitor page

## Implementation Strategy (CHOSEN: Aggressive Stripping)

Based on analysis, proceeding with aggressive feature removal while preserving user's actual workflow.

## Future Plans
1. **Immediate**: Identify used vs. unused features
2. **Short-term**: Remove unnecessary code, test functionality
3. **Medium-term**: Consider CSS companion extension
4. **Long-term**: Implement Chrome Enterprise Policies for production use

## Notes
- Extension is obfuscated/minified in some areas
- No access to original source repository
- Must be careful not to break existing functionality
- Tampermonkey script compatibility is critical

## CRITICAL DISCOVERIES 🔍

### Discovery 1: Notification Monitor is Isolated
**Location**: [bootloader.js:220-256](scripts/bootloader.js#L220-L256)

The Notification Monitor system ONLY loads when the URL contains `#monitor`:
```javascript
let regex = /^[^#]+#monitor.*$/;
if (arrMatches != null) {
    notificationMonitor = new NotificationMonitorV3();
    return; //Do not initialize the page as normal
}
```

**Impact**: Main Vine pages do NOT use:
- WebSocket connections
- Notification monitoring system
- Assisted loading (AutoLoad)
- Any code in `notifications-monitor/` folder

### Discovery 2: Toolbar Uses General Settings
**Location**: [Toolbar.js:49](scripts/ui/components/Toolbar.js#L49)

Main page highlighting uses `general.*` settings, NOT `notification.monitor.*`:
```javascript
const highlightKeywords = Settings.get("general.highlightKeywords");
```

**Impact**: The color settings in General tab control main Vine page, notification.* settings only affect #monitor page.

### Discovery 3: Discord Integration is Separate
**Location**: [scripts/core/services/BrendaAnnounce.js](scripts/core/services/BrendaAnnounce.js)

"Send to Brenda" feature is in `core/services/`, NOT in `notifications-monitor/`:
- BrendaAnnounce.js handles the announcement queue
- Triggered by toolbar button click
- Posts to VH Discord server feeds

**Impact**: Can remove entire notifications-monitor folder without breaking Discord integration.

### Discovery 4: Version Spoofing Possible
**Location**: [Environment.js:91-94](scripts/core/services/Environment.js#L91-L94)

Version is read from manifest.json at runtime:
```javascript
let manifest = chrome.runtime.getManifest();
this.data.appVersion = manifest.version;
```

**Impact**: Can update manifest.json version to 3.9.7 to appear current to server.

### Discovery 5: Telemetry & Tracking
**Sent to api.vinehelper.ovh**:
- App version (from manifest.json)
- UUID (user identifier)
- Fingerprint ID (device identifier)
- CID (one-way hash of Customer ID)
- Country code

**No code integrity checks found** - server sees version number but not code modifications.

## Removal Plan - Phase 1

### 🗑️ High Priority Removals (~500KB savings)

1. **Entire notifications-monitor/ folder** (~70 files)
   - WebSocket connections (Websocket.js)
   - Notification Monitor V1/V2/V3
   - Assisted loading (AutoLoad*.js)
   - Stream processing (NewItemStreamProcessing.js, ServerCom.js)
   - Debug modules (MemoryDebugger, HeapSnapshot, etc.)

2. **Notification Monitor Pages**
   - page/notification_monitor_light.html
   - page/notification_monitor_light.js
   - page/notification_monitor_light.css

3. **Review System**
   - page/reviews_manage.html/js
   - page/reviews_templates.html/js
   - scripts/review.js
   - scripts/review_inj.js
   - UI templates: review_toolbar.html

4. **Item Explorer & Statistics** (Premium feature user doesn't have)
   - page/item_explorer.html/js/css
   - page/item_explorer_statistics.html/js

5. **Chart.js Library** (~250KB)
   - scripts/vendor/chart.js/*
   - scripts/vendor/@kurkle/color/*

6. **Sound Notifications**
   - resource/sound/* folder
   - scripts/ui/components/NotificationsSoundPlayer.js

7. **Canvas Confetti** (celebration effects)
   - scripts/vendor/canvas-confetti/*

### ✅ Must Keep

1. **Core Services**
   - BrendaAnnounce.js (Discord integration)
   - HiddenListMgr.js, PinnedListMgr.js
   - Environment.js, SettingsMgr
   - Internationalization.js

2. **UI Components**
   - Toolbar.js (main page toolbar with highlighting)
   - Tile.js, Grid.js, Page.js
   - Pagination.js, TileSizer.js

3. **Bootloader** (with NotificationMonitor import removed)
   - bootloader.js
   - bootloaderLoader.js

4. **Utilities**
   - KeywordMatcher/Compiler (for highlighting)
   - Template system
   - DOM/Date/String helpers

5. **Webhooks** (user's Discord notifications)
   - Need to verify if separate from notifications-monitor

### 🔄 Modifications Required

1. **manifest.json**
   - Update version: "3.8.7" → "3.9.7"
   - Remove references to deleted files
   - Keep CSP for Discord webhooks

2. **bootloader.js**
   - Remove: `import { NotificationMonitorV3 } from ...`
   - Remove: notification monitor initialization block (lines 220-256)
   - Keep: rest of main Vine page initialization

3. **Settings pages**
   - Remove notification.monitor.* settings from settings_notifications.tpl.html
   - Keep general.* highlighting settings
   - Keep Discord/Webhook settings

## Helpful Resources
- HelpWiki.md contains feature documentation (outdated but useful)
- manifest.json defines all entry points and permissions
- Chrome Enterprise Policy installation guide (TBD)
- Bootloader.js analysis reveals load sequence and dependencies
