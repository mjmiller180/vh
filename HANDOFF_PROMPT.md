# Vine Helper 3.8.7 Modification - Session Handoff Prompt

## CONTEXT SUMMARY

You're continuing work on modifying the Vine Helper Chrome Extension v3.8.7. The user sideloaded this version to avoid breaking changes in v3.9.5 that conflicted with their Tampermonkey script. The goal is to strip away unused features while preserving the user's actual workflow.

**Current Objective**: Remove ~500KB of unused code (notifications-monitor system, reviews, statistics) while keeping core functionality intact.

## KEY DECISIONS & RATIONALE

### Decision 1: Remove Entire notifications-monitor/ Folder ✅
**Rationale**: Analysis of [bootloader.js:220-256](scripts/bootloader.js#L220-L256) revealed that NotificationMonitorV3 ONLY loads when URL contains `#monitor`. The user never visits these URLs, so the entire system (WebSocket connections, assisted loading, ~70 files) is unused.

### Decision 2: Keep Discord Integration ✅
**Rationale**: User actively uses "Send to Brenda" feature ([BrendaAnnounce.js](scripts/core/services/BrendaAnnounce.js)) and webhooks to personal Discord. This code is in `core/services/`, NOT in `notifications-monitor/`.

### Decision 3: Toolbar Highlighting Uses General Settings ✅
**Rationale**: [Toolbar.js:49](scripts/ui/components/Toolbar.js#L49) uses `general.highlightKeywords`, not `notification.monitor.*` settings. Main Vine page functionality is completely independent of notification monitor.

### Decision 4: Version Spoofing Strategy ✅
**Rationale**: Server receives version from manifest.json ([Environment.js:91-94](scripts/core/services/Environment.js#L91-L94)). No code integrity checks detected. Plan: Update version to 3.9.7 to blend with current users.

## COMPLETED WORK

### Analysis Phase ✅
- Mapped entire extension architecture (90+ JS files, 44 CSS files)
- Identified load sequence: bootloader → tabs/toolbar → server data fetch
- Discovered notification monitor isolation (only loads with #monitor URL)
- Confirmed user's actual feature usage vs. assumptions
- Documented telemetry/tracking (version, UUID, fingerprint sent to api.vinehelper.ovh)

### User Feature Analysis ✅
**Actually Uses**:
- Hidden/Pinned tabs (HiddenListMgr.js, PinnedListMgr.js)
- Discord "Send to Brenda" (BrendaAnnounce.js)
- Webhooks to personal Discord server
- Toolbar highlighting with color customization
- Custom styling (general.* settings)

**Does NOT Use**:
- Notification Monitor page (#monitor URLs)
- Assisted loading (background page fetching)
- Review templates/saved reviews
- Item Explorer/Statistics (premium feature)
- Sound notifications
- WebSocket monitoring

### Documentation ✅
- PROJECT_NOTES.md - Updated with critical discoveries and removal plan
- CHANGELOG.md - Documented initial state and analysis findings
- HANDOFF_PROMPT.md - This file

## PENDING WORK - PHASE 1 REMOVALS

### Files to Delete (~500KB)

**1. notifications-monitor/ folder (70 files)**
```
scripts/notifications-monitor/
├── core/ (MonitorCore.js, NotificationMonitor.js, V1, V2, V3)
├── stream/ (WebSocket.js, ServerCom.js, AutoLoad*.js, NewItemStreamProcessing.js)
├── services/ (ItemsMgr.js, PinMgr.js, TierMgr.js, TileCounter.js)
└── debug/ (MemoryDebugger.js, HeapSnapshotHelper.js, etc.)
```

**2. Notification Monitor Pages**
- page/notification_monitor_light.html
- page/notification_monitor_light.js
- page/notification_monitor_light.css

**3. Review System**
- page/reviews_manage.html + .js
- page/reviews_templates.html + .js
- scripts/review.js
- scripts/review_inj.js
- scripts/ui/templates/review_toolbar.html

**4. Item Explorer & Statistics**
- page/item_explorer.html + .js + .css
- page/item_explorer_statistics.html + .js

**5. Chart.js Library (~250KB)**
- scripts/vendor/chart.js/* (all files)
- scripts/vendor/@kurkle/color/* (all files)

**6. Sound Notifications**
- resource/sound/* (entire folder)
- scripts/ui/components/NotificationsSoundPlayer.js

**7. Canvas Confetti**
- scripts/vendor/canvas-confetti/* (all files)

### Code Modifications Required

**1. manifest.json** [Line 7]
- Change: `"version": "3.8.7"` → `"version": "3.9.7"`
- Remove: References to deleted files in content_scripts
- Verify: CSP still includes Discord webhooks

**2. bootloader.js** [Lines 55, 220-256]
- Remove: `import { NotificationMonitorV3 } from "/scripts/notifications-monitor/core/NotificationMonitorV3.js";`
- Remove: Entire notification monitor initialization block (lines 220-256)
- Keep: All other initialization (tabs, toolbar, data fetch)

**3. settings_notifications.tpl.html**
- Remove: All `notification.monitor.*` settings sections
- Keep: Assisted loading settings (in case structure needed for future)
- Keep: General notification settings (if any)

## CRITICAL FILES TO PRESERVE

**Must Keep - Core Services**:
- scripts/core/services/BrendaAnnounce.js (Discord integration)
- scripts/core/services/HiddenListMgr.js (hidden tab)
- scripts/core/services/PinnedListMgr.js (pinned tab)
- scripts/core/services/Environment.js (UUID, telemetry)
- scripts/core/services/SettingsMgr*.js (settings system)

**Must Keep - UI Components**:
- scripts/ui/components/Toolbar.js (main page toolbar with highlighting)
- scripts/ui/components/Tile.js (product tiles)
- scripts/ui/components/Grid.js (tab grid system)
- scripts/ui/components/Page.js (page controller)

**Must Keep - Bootloader & Entry Points**:
- scripts/bootloader.js (modify, don't delete)
- scripts/bootloaderLoader.js
- scripts/preboot.js, prebootLoader.js, preboot_inj.js
- scripts/inj.js
- scripts/vh_service_worker_di.js

## ARCHITECTURE INSIGHTS

### Load Sequence
1. **Preboot** (document_start) - Loads settings, injects monkey patcher
2. **Bootloader** (document_end) - Checks for #monitor, creates tabs/toolbar
3. **Server Fetch** - Gets ETV data, order stats from api.vinehelper.ovh
4. **Render** - Populates toolbars with data, applies highlighting

### Dependency Chain
```
bootloader.js
  ├→ Environment.js (UUID, country detection)
  ├→ Page.js → Grid.js → Tile.js → Toolbar.js
  ├→ HiddenListMgr.js, PinnedListMgr.js
  └→ (REMOVED) NotificationMonitorV3 (only if #monitor in URL)
```

### Integration Points
- **Discord**: BrendaAnnounce.js + webhook in settings (separate from monitor)
- **Server**: api.vinehelper.ovh for ETV data (NOT WebSocket, uses fetch)
- **Telemetry**: Environment.js sends version, UUID, fingerprint on load

## TESTING CHECKLIST

After Phase 1 removals:
1. ✅ Extension loads without errors on main Vine page
2. ✅ Hidden/Pinned tabs work correctly
3. ✅ Toolbar highlighting displays with custom colors
4. ✅ "Send to Brenda" button works (Discord integration)
5. ✅ Webhooks still trigger (if applicable)
6. ✅ Settings page opens without errors
7. ✅ Version 3.9.7 appears in settings/about
8. ❌ Notification monitor page (#monitor) - Expected to break/be removed

## KNOWN ISSUES & BLOCKERS

**None identified** - Analysis complete, ready to proceed with removals.

## NEXT IMMEDIATE ACTIONS (Prioritized)

1. **Delete folders** (use Bash with `rm -rf` or file explorer)
   - scripts/notifications-monitor/
   - resource/sound/
   - scripts/vendor/chart.js/
   - scripts/vendor/@kurkle/color/
   - scripts/vendor/canvas-confetti/

2. **Delete individual files**
   - page/notification_monitor_light.* (html, js, css)
   - page/item_explorer.* (html, js, css)
   - page/item_explorer_statistics.* (html, js)
   - page/reviews_manage.* (html, js)
   - page/reviews_templates.* (html, js)
   - scripts/review.js, scripts/review_inj.js
   - scripts/ui/components/NotificationsSoundPlayer.js
   - scripts/ui/templates/review_toolbar.html

3. **Update manifest.json**
   - Version: 3.8.7 → 3.9.7
   - Remove review.js from content_scripts
   - Verify all file references still exist

4. **Modify bootloader.js**
   - Remove NotificationMonitorV3 import (line 55)
   - Remove monitor initialization block (lines 220-256)

5. **Test in Chrome**
   - Load modified extension in Developer Mode
   - Visit Amazon Vine page
   - Verify tabs, toolbar, highlighting work
   - Test Discord "Send to Brenda" button

6. **Update CHANGELOG.md**
   - Document Phase 1 removals
   - Record any issues encountered
   - Note file sizes saved

## CODEBASE LOCATIONS (Quick Reference)

- **Manifest**: `g:\My Drive\Amz Vine\Vine Helper\Extensions\VH Chrome 3-8-7\manifest.json`
- **Bootloader**: `scripts\bootloader.js`
- **Toolbar**: `scripts\ui\components\Toolbar.js`
- **Settings**: `page\settings_*.tpl.html`
- **Documentation**: `PROJECT_NOTES.md`, `CHANGELOG.md`

## DEVELOPMENT COMMANDS

```bash
# Navigate to extension directory
cd "g:\My Drive\Amz Vine\Vine Helper\Extensions\VH Chrome 3-8-7"

# Remove entire folders
rm -rf scripts/notifications-monitor
rm -rf resource/sound
rm -rf scripts/vendor/chart.js
rm -rf "scripts/vendor/@kurkle"
rm -rf scripts/vendor/canvas-confetti

# Or use PowerShell
Remove-Item -Recurse -Force "scripts\notifications-monitor"
```

---

**Ready to proceed?** Start with Phase 1 deletions, then modify bootloader.js and manifest.json. Test thoroughly before committing changes.
