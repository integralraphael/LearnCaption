# LearnCaption HUD UI Redesign

## Overview

Redesign the LearnCaption desktop app from a tabbed window into a minimal HUD overlay for use during Google Meet calls. The app floats above all windows, displays real-time captions with vocab annotations, and keeps controls out of the way.

## Window Behavior

- **Always on top** by default (toggleable in settings)
- **No native decorations** (already `decorations: false`)
- **Semi-transparent background** with backdrop blur (`rgba(15,23,42,0.85)` + `blur(12px)`)
- **Draggable** via the left sidebar area (L2 panel acts as drag handle when empty)
- **Resizable** from all edges (existing Tauri behavior)
- **Wide and short** form factor — optimized for minimal vertical footprint over Google Meet

## Layout: Fixed Four-Column Structure

```
| L1 36px | L2 120px | Subtitle flex:1 | R 32px |
```

All four columns have fixed widths except the subtitle area which fills remaining space. The subtitle area position never changes regardless of menu state.

### L1: Icon Bar (36px)

Vertical strip with 4 icon buttons (26x26px, 6px border-radius):

| Position | Icon | Idle State | Recording State |
|----------|------|------------|-----------------|
| Top | ▶/⏸ | Green ▶ (start) | Yellow ⏸ (pause) |
| 2nd | ⏹ | Gray, disabled | Red, active (stop & end meeting) |
| 3rd | 🌐 | Blue (open source panel) | Green dot indicator (source locked) |
| Bottom | ⚙ | Dim gray (open settings) | Same |

- Clicking 🌐 or ⚙ toggles the corresponding content in the L2 panel
- Clicking the same icon again, or clicking a different icon, closes the current L2 content
- During recording, the source icon becomes a status indicator (green dot with glow) and is not clickable

### L2: Secondary Panel (120px, always reserved)

This space is always present in the layout. When no menu is active, it shows a faint drag handle (`⋮⋮`) and the entire area is a drag region for moving the window.

**Source panel** (when 🌐 is active):
- Header: "来源" (uppercase, small)
- Google Meet — selected by default, green dot + checkmark
- Whisper — option with purple dot

**Settings panel** (when ⚙ is active):
- Header: "设置" (uppercase, small)
- 🎯 词汇校准 — opens calibration mode (replaces main content area)
- 📌 置顶 — toggle switch for always-on-top

### Subtitle Area (flex: 1)

The main content area displaying real-time captions.

**History behavior:**
- Keep ALL lines from the current meeting (remove `MAX_LINES = 3` truncation)
- Lines are stored in state, not re-fetched from DB (they already arrive via events)
- Display as many lines as the window height allows, bottom-aligned
- Newest lines at the bottom with full opacity
- Older lines fade progressively (opacity decreasing as lines get older)
- Auto-scroll follows new lines by default

**Scroll behavior:**
- User can scroll up to view history
- Scrolling up disables auto-follow
- New lines continue to arrive but don't force scroll
- The R column's ↓ button appears when not at bottom

**Word interaction:**
- Clicking a highlighted word opens WordDetail (see Word Detail section)
- Phrase selection via mouse drag (existing behavior)

### R: Right Column (32px)

- **Scroll progress track** — thin vertical bar (4px wide) showing current scroll position within all history lines
- **Scroll thumb** — indicates viewport position within history
- **↓ Jump button** (24x24px) — appears at bottom of R column only when user has scrolled up from latest. Click jumps directly to bottom (no animation) and re-enables auto-follow. Hidden when already at bottom.

## Word Detail: Adaptive Display

The word detail panel adapts based on available vertical space:

### Threshold: 250px window height

**Below 250px → Independent popover window:**
- Create a new Tauri `WebviewWindow` (frameless, transparent, always-on-top)
- Position above the clicked word in the main window
- Contains: word, ECDICT definition, AI translation, action buttons (🔊, + Add to vocab)
- Closes on: click ✕, click outside, or clicking another word
- Does not affect main window size or layout

**250px and above → Bottom panel:**
- WordDetail renders below the subtitle area within the main window
- Separated by a horizontal divider line
- Same content as current implementation: ECDICT + AI translation side by side, action buttons
- Closes on ✕ click

## Vocabulary Calibration

When triggered (first launch if not calibrated, or via Settings → 词汇校准):

- **Replaces** the L2 + Subtitle + R area content (L1 icon bar remains visible but buttons grayed out)
- Shows the existing calibration UI: horizontal card scroll, split line, slider, confirm button
- On confirm: saves threshold to settings, restores normal layout
- The calibration component itself (VocabCalibration.tsx) keeps its current logic — only the container/layout changes

## Removed Features

The following are removed from the desktop app (planned for future web version):

- **VocabBook page** — vocabulary list and management
- **ReviewPage** — meeting transcript review
- **Navigation tabs** — Subtitles/Vocab/Review tab bar
- **Top navigation bar** — replaced by L1 icon bar

Components to delete: `VocabBook.tsx`, `ReviewPage.tsx`. The nav bar in App.tsx is replaced by the L1 sidebar.

## Component Changes Summary

| Component | Action |
|-----------|--------|
| `App.tsx` | Rewrite: remove tabs/nav, implement 4-column layout, manage L2 panel state |
| `SubtitleWindow.tsx` | Modify: remove MAX_LINES cap, add scroll detection, progressive opacity |
| `WordDetail.tsx` | Modify: support both bottom-panel and popover-window modes |
| `Token.tsx` | Keep as-is |
| `SourceBadge.tsx` | Remove (replaced by L1 source indicator) |
| `VocabBook.tsx` | Delete |
| `ReviewPage.tsx` | Delete |
| `VocabCalibration.tsx` | Keep logic, adapt to render within the 4-column layout |
| `tauri.conf.json` | Update: set `alwaysOnTop: true` as default |

## Tauri Configuration Changes

```json
{
  "windows": [{
    "label": "main",
    "title": "LearnCaption",
    "width": 900,
    "height": 200,
    "minWidth": 500,
    "minHeight": 120,
    "decorations": false,
    "transparent": true,
    "alwaysOnTop": true
  }]
}
```

- Default height reduced from 620 to 200 (HUD form factor)
- minHeight reduced from 400 to 120
- alwaysOnTop set to true by default

## Popover Window (Tauri)

For the independent word detail popover, create a new webview window:

- Label: `word-detail`
- Size: ~280x200, auto-height based on content
- Decorations: false
- Transparent: true
- AlwaysOnTop: true
- Position: calculated from clicked word's screen coordinates
- Communicate with main window via Tauri events (`word-detail-close`, `vocab-added`)

## Visual Reference

Mockups are available in `.superpowers/brainstorm/` directory:
- `design-final.html` — main layout with all 4 columns, 4 states
- `design-missing-states.html` — popover window, bottom panel, calibration mode
