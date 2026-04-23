# HUD UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform LearnCaption from a tabbed window app into a minimal HUD overlay with four-column layout, full subtitle history, and adaptive word detail.

**Architecture:** Four fixed columns (L1 icon bar 36px, L2 secondary panel 120px, subtitle area flex:1, R scroll column 32px). L2 toggles between empty/drag, source picker, and settings. Subtitle area keeps full meeting history with auto-scroll. Word detail adapts between bottom panel (tall window) and independent Tauri popover window (short window).

**Tech Stack:** React 19, TypeScript, Tauri 2, @tauri-apps/api

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/App.tsx` | Rewrite | Four-column layout, L1/L2 state, calibration gate |
| `src/components/Sidebar.tsx` | Create | L1 icon bar + L2 secondary panel |
| `src/components/ScrollColumn.tsx` | Create | R column: scroll track + jump button |
| `src/components/SubtitleWindow.tsx` | Modify | Remove MAX_LINES, add scroll detection, progressive opacity |
| `src/components/WordDetail.tsx` | Modify | Add compact popover mode |
| `src/components/WordPopover.tsx` | Create | Independent Tauri window for word detail |
| `src/components/Token.tsx` | Keep | No changes |
| `src/components/VocabCalibration.tsx` | Minor modify | Remove outer chrome (background, padding), render as content-only |
| `src/components/VocabBook.tsx` | Delete | Moved to future web version |
| `src/components/ReviewPage.tsx` | Delete | Moved to future web version |
| `src/components/SourceBadge.tsx` | Delete | Replaced by L1 source indicator |
| `src-tauri/tauri.conf.json` | Modify | Default height, minHeight, alwaysOnTop |
| `src-tauri/src/commands/settings.rs` | Modify | Add toggle_always_on_top command |
| `src-tauri/src/commands/capture.rs` | Modify | Remove set_always_on_top calls (now user-controlled) |
| `src-tauri/src/commands/pipeline.rs` | Modify | Remove set_always_on_top calls |
| `src-tauri/src/lib.rs` | Modify | Register new command |
| `src/App.css` | Modify | Add custom scrollbar hiding |

---

### Task 1: Tauri Config and Always-On-Top Command

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/src/commands/settings.rs`
- Modify: `src-tauri/src/commands/capture.rs:45-47,85-87`
- Modify: `src-tauri/src/commands/pipeline.rs:66-68,167-168`
- Modify: `src-tauri/src/lib.rs:76`

- [ ] **Step 1: Update tauri.conf.json window defaults**

```json
{
  "windows": [
    {
      "label": "main",
      "title": "LearnCaption",
      "width": 900,
      "height": 200,
      "minWidth": 500,
      "minHeight": 120,
      "decorations": false,
      "transparent": true,
      "alwaysOnTop": true
    }
  ]
}
```

Change `height` from 620 to 200, `minHeight` from 400 to 120, `alwaysOnTop` from false to true.

- [ ] **Step 2: Add toggle_always_on_top command in settings.rs**

Add at the end of `src-tauri/src/commands/settings.rs`:

```rust
#[tauri::command]
pub fn toggle_always_on_top(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri::Manager;
    let win = app.get_webview_window("main").ok_or("window not found")?;
    let current = win.is_always_on_top().map_err(|e| e.to_string())?;
    let new_val = !current;
    win.set_always_on_top(new_val).map_err(|e| e.to_string())?;
    Ok(new_val)
}
```

- [ ] **Step 3: Remove set_always_on_top from capture.rs and pipeline.rs**

In `src-tauri/src/commands/capture.rs`, remove lines 45-47:
```rust
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_always_on_top(true);
    }
```

And lines 85-87:
```rust
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_always_on_top(false);
    }
```

In `src-tauri/src/commands/pipeline.rs`, remove the equivalent `set_always_on_top(true)` in `start_recording` and `set_always_on_top(false)` in `stop_recording`.

- [ ] **Step 4: Register new command in lib.rs**

Add `commands::settings::toggle_always_on_top` to the `invoke_handler` list.

- [ ] **Step 5: Build and verify**

Run: `cd src-tauri && cargo check`
Expected: compiles without errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/src/commands/settings.rs src-tauri/src/commands/capture.rs src-tauri/src/commands/pipeline.rs src-tauri/src/lib.rs
git commit -m "feat: HUD window config and toggle_always_on_top command"
```

---

### Task 2: Delete Removed Components

**Files:**
- Delete: `src/components/VocabBook.tsx`
- Delete: `src/components/ReviewPage.tsx`
- Delete: `src/components/SourceBadge.tsx`

- [ ] **Step 1: Delete the three files**

```bash
rm src/components/VocabBook.tsx src/components/ReviewPage.tsx src/components/SourceBadge.tsx
```

- [ ] **Step 2: Verify no other files import them**

```bash
grep -rn "VocabBook\|ReviewPage\|SourceBadge" src/ --include="*.tsx" --include="*.ts"
```

Expected: only hits in `src/App.tsx` (which will be rewritten in Task 5). No action needed on those imports yet.

- [ ] **Step 3: Commit**

```bash
git add -u src/components/VocabBook.tsx src/components/ReviewPage.tsx src/components/SourceBadge.tsx
git commit -m "chore: remove VocabBook, ReviewPage, SourceBadge (moved to future web version)"
```

---

### Task 3: Sidebar Component (L1 + L2)

**Files:**
- Create: `src/components/Sidebar.tsx`

- [ ] **Step 1: Create Sidebar.tsx**

```tsx
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";

type CaptureMode = "none" | "whisper" | "browser";
type L2Panel = "none" | "source" | "settings";

interface Props {
  captureMode: CaptureMode;
  onStart: (source: "whisper" | "browser") => void;
  onPause: () => void;
  onStop: () => void;
  onRecalibrate: () => void;
}

export function Sidebar({ captureMode, onStart, onPause, onStop, onRecalibrate }: Props) {
  const [activePanel, setActivePanel] = useState<L2Panel>("none");
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [selectedSource, setSelectedSource] = useState<"whisper" | "browser">("browser");

  const recording = captureMode !== "none";

  const togglePanel = (panel: L2Panel) => {
    setActivePanel((cur) => (cur === panel ? "none" : panel));
  };

  const handleTogglePin = async () => {
    try {
      const newVal = await invoke<boolean>("toggle_always_on_top");
      setAlwaysOnTop(newVal);
    } catch (e) {
      console.error("toggle_always_on_top failed:", e);
    }
  };

  const handlePlayPause = () => {
    if (recording) {
      onPause();
    } else {
      onStart(selectedSource);
    }
  };

  return (
    <div style={{ display: "flex", height: "100%" }}>
      {/* L1: Icon bar */}
      <div
        style={{
          width: "36px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "12px 4px",
          gap: "14px",
          borderRight: "1px solid rgba(255,255,255,0.04)",
          flexShrink: 0,
        }}
      >
        {/* Play / Pause */}
        <button
          onClick={handlePlayPause}
          style={{
            ...iconBtn,
            background: recording
              ? "rgba(251,191,36,0.12)"
              : "rgba(52,211,153,0.12)",
            color: recording ? "#fbbf24" : "#34d399",
          }}
          title={recording ? "暂停" : "开始"}
        >
          {recording ? "⏸" : "▶"}
        </button>

        {/* Stop */}
        <button
          onClick={onStop}
          disabled={!recording}
          style={{
            ...iconBtn,
            background: recording
              ? "rgba(239,68,68,0.1)"
              : "rgba(255,255,255,0.03)",
            color: recording ? "#ef4444" : "#334155",
            cursor: recording ? "pointer" : "default",
            opacity: recording ? 1 : 0.5,
          }}
          title="停止"
        >
          ⏹
        </button>

        {/* Source */}
        {recording ? (
          <div
            style={{
              ...iconBtn,
              background: "transparent",
              cursor: "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title={captureMode === "browser" ? "Google Meet" : "Whisper"}
          >
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: captureMode === "browser" ? "#34d399" : "#818cf8",
                boxShadow: `0 0 8px ${captureMode === "browser" ? "#34d399" : "#818cf8"}`,
              }}
            />
          </div>
        ) : (
          <button
            onClick={() => togglePanel("source")}
            style={{
              ...iconBtn,
              background:
                activePanel === "source"
                  ? "rgba(96,165,250,0.2)"
                  : "rgba(96,165,250,0.1)",
              color: "#60a5fa",
              border:
                activePanel === "source"
                  ? "1px solid rgba(96,165,250,0.4)"
                  : "1px solid transparent",
            }}
            title="来源"
          >
            🌐
          </button>
        )}

        <div style={{ flex: 1 }} />

        {/* Settings */}
        <button
          onClick={() => togglePanel("settings")}
          style={{
            ...iconBtn,
            background:
              activePanel === "settings"
                ? "rgba(255,255,255,0.1)"
                : "rgba(255,255,255,0.03)",
            color:
              activePanel === "settings"
                ? "#e2e8f0"
                : "rgba(255,255,255,0.25)",
            border:
              activePanel === "settings"
                ? "1px solid rgba(255,255,255,0.2)"
                : "1px solid transparent",
          }}
          title="设置"
        >
          ⚙
        </button>
      </div>

      {/* L2: Secondary panel */}
      <div
        data-tauri-drag-region
        style={{
          width: "120px",
          borderRight: "1px solid rgba(255,255,255,0.04)",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          cursor: activePanel === "none" ? "grab" : "default",
        }}
      >
        {activePanel === "none" && (
          <div
            data-tauri-drag-region
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              data-tauri-drag-region
              style={{
                color: "rgba(255,255,255,0.06)",
                fontSize: "20px",
                letterSpacing: "4px",
                userSelect: "none",
              }}
            >
              ⋮⋮
            </span>
          </div>
        )}

        {activePanel === "source" && (
          <div style={{ padding: "10px 6px", display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={panelHeader}>来源</div>
            <div
              onClick={() => setSelectedSource("browser")}
              style={{
                ...sourceItem,
                background:
                  selectedSource === "browser"
                    ? "rgba(52,211,153,0.1)"
                    : "transparent",
                border:
                  selectedSource === "browser"
                    ? "1px solid rgba(52,211,153,0.2)"
                    : "1px solid transparent",
              }}
            >
              <div style={{ ...dot, background: "#34d399" }} />
              <span style={{ color: selectedSource === "browser" ? "#e2e8f0" : "#64748b", fontSize: "11px" }}>
                Google Meet
              </span>
              {selectedSource === "browser" && (
                <span style={{ color: "#34d399", fontSize: "9px", marginLeft: "auto" }}>✓</span>
              )}
            </div>
            <div
              onClick={() => setSelectedSource("whisper")}
              style={{
                ...sourceItem,
                background:
                  selectedSource === "whisper"
                    ? "rgba(129,140,248,0.1)"
                    : "transparent",
                border:
                  selectedSource === "whisper"
                    ? "1px solid rgba(129,140,248,0.2)"
                    : "1px solid transparent",
              }}
            >
              <div style={{ ...dot, background: "#818cf8" }} />
              <span style={{ color: selectedSource === "whisper" ? "#e2e8f0" : "#64748b", fontSize: "11px" }}>
                Whisper
              </span>
              {selectedSource === "whisper" && (
                <span style={{ color: "#818cf8", fontSize: "9px", marginLeft: "auto" }}>✓</span>
              )}
            </div>
          </div>
        )}

        {activePanel === "settings" && (
          <div style={{ padding: "10px 6px", display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={panelHeader}>设置</div>
            <div onClick={onRecalibrate} style={settingsItem}>
              <span style={{ color: "#94a3b8", fontSize: "11px" }}>🎯 词汇校准</span>
            </div>
            <div onClick={handleTogglePin} style={{ ...settingsItem, justifyContent: "space-between" }}>
              <span style={{ color: "#94a3b8", fontSize: "11px" }}>📌 置顶</span>
              <div
                style={{
                  width: "28px",
                  height: "15px",
                  borderRadius: "8px",
                  background: alwaysOnTop ? "#34d399" : "#334155",
                  position: "relative",
                  transition: "background 0.2s",
                }}
              >
                <div
                  style={{
                    width: "11px",
                    height: "11px",
                    borderRadius: "50%",
                    background: "white",
                    position: "absolute",
                    top: "2px",
                    transition: "right 0.2s",
                    right: alwaysOnTop ? "2px" : "15px",
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  width: "26px",
  height: "26px",
  borderRadius: "6px",
  border: "1px solid transparent",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "12px",
  cursor: "pointer",
  padding: 0,
  fontFamily: "inherit",
};

const panelHeader: React.CSSProperties = {
  color: "#475569",
  fontSize: "9px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  padding: "2px 6px",
};

const sourceItem: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  padding: "6px",
  borderRadius: "5px",
  cursor: "pointer",
};

const dot: React.CSSProperties = {
  width: "5px",
  height: "5px",
  borderRadius: "50%",
  flexShrink: 0,
};

const settingsItem: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "6px",
  borderRadius: "5px",
  cursor: "pointer",
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors (component is not yet imported, but should type-check standalone).

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: add Sidebar component with L1 icon bar and L2 panel"
```

---

### Task 4: ScrollColumn Component (R column)

**Files:**
- Create: `src/components/ScrollColumn.tsx`

- [ ] **Step 1: Create ScrollColumn.tsx**

```tsx
interface Props {
  /** 0..1 fraction of how far down the user has scrolled */
  scrollFraction: number;
  /** 0..1 fraction of viewport relative to total content height */
  thumbSize: number;
  /** True when user is not at the bottom */
  showJump: boolean;
  onJumpToLatest: () => void;
}

export function ScrollColumn({ scrollFraction, thumbSize, showJump, onJumpToLatest }: Props) {
  const thumbHeight = Math.max(thumbSize * 100, 10); // minimum 10% so it's visible
  const thumbTop = scrollFraction * (100 - thumbHeight);

  return (
    <div
      style={{
        width: "32px",
        borderLeft: "1px solid rgba(255,255,255,0.04)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "8px 2px",
        flexShrink: 0,
        gap: "6px",
      }}
    >
      {/* Scroll track */}
      <div
        style={{
          flex: 1,
          width: "4px",
          background: "rgba(255,255,255,0.04)",
          borderRadius: "2px",
          position: "relative",
        }}
      >
        {/* Thumb */}
        <div
          style={{
            position: "absolute",
            top: `${thumbTop}%`,
            width: "4px",
            height: `${thumbHeight}%`,
            background: "rgba(255,255,255,0.15)",
            borderRadius: "2px",
            transition: "top 0.1s",
          }}
        />
      </div>

      {/* Jump to latest */}
      {showJump && (
        <button
          onClick={onJumpToLatest}
          style={{
            width: "24px",
            height: "24px",
            borderRadius: "6px",
            background: "rgba(96,165,250,0.2)",
            border: "1px solid rgba(96,165,250,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#60a5fa",
            fontSize: "11px",
            cursor: "pointer",
            flexShrink: 0,
            padding: 0,
          }}
          title="回到最新"
        >
          ↓
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/components/ScrollColumn.tsx
git commit -m "feat: add ScrollColumn component with progress track and jump button"
```

---

### Task 5: Modify SubtitleWindow for Full History and Scroll Detection

**Files:**
- Modify: `src/components/SubtitleWindow.tsx`

- [ ] **Step 1: Rewrite SubtitleWindow.tsx**

Replace the entire file content:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { AnnotatedLine, WordToken } from "../types/subtitle";
import { Token } from "./Token";

interface Props {
  onWordClick?: (token: WordToken, sentenceText: string) => void;
  onPhraseSelect?: (phrase: string, sentenceText: string) => void;
  /** Called on scroll changes so parent can drive ScrollColumn */
  onScrollState?: (state: { fraction: number; thumbSize: number; atBottom: boolean }) => void;
}

export function SubtitleWindow({ onWordClick, onPhraseSelect, onScrollState }: Props) {
  const [lines, setLines] = useState<AnnotatedLine[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoFollowRef = useRef(true);

  useEffect(() => {
    let active = true;
    let unlistenFn: (() => void) | undefined;
    listen<AnnotatedLine>("subtitle-line", (e) => {
      if (!active) return;
      const incoming = e.payload;
      setLines((prev) => {
        switch (incoming.action) {
          case "update":
            if (prev.length === 0) return [incoming];
            return [...prev.slice(0, -1), incoming];
          case "new_block":
          case "append":
          default:
            return [...prev, incoming];
        }
      });
    }).then((f) => { unlistenFn = f; });
    return () => {
      active = false;
      unlistenFn?.();
    };
  }, []);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (autoFollowRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
    reportScroll();
  }, [lines]);

  const reportScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el || !onScrollState) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const maxScroll = scrollHeight - clientHeight;
    const atBottom = maxScroll <= 0 || scrollTop >= maxScroll - 5;
    onScrollState({
      fraction: maxScroll > 0 ? scrollTop / maxScroll : 1,
      thumbSize: scrollHeight > 0 ? clientHeight / scrollHeight : 1,
      atBottom,
    });
  }, [onScrollState]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const maxScroll = scrollHeight - clientHeight;
    const atBottom = maxScroll <= 0 || scrollTop >= maxScroll - 5;
    autoFollowRef.current = atBottom;
    reportScroll();
  };

  const handleMouseUp = () => {
    if (!onPhraseSelect) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || text.split(/\s+/).length < 2) return;
    const node = sel?.anchorNode;
    const lineEl = (node instanceof HTMLElement ? node : node?.parentElement)?.closest("[data-raw-text]");
    const rawText = lineEl?.getAttribute("data-raw-text") ?? "";
    onPhraseSelect(text, rawText);
    sel?.removeAllRanges();
  };

  /** Called by parent to jump to latest */
  const jumpToLatest = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      autoFollowRef.current = true;
      reportScroll();
    }
  }, [reportScroll]);

  // Expose jumpToLatest via ref-like pattern: attach to component
  // Parent calls this via the onScrollState callback pattern instead

  // Attach jumpToLatest to a ref the parent can call
  const jumpRef = useRef(jumpToLatest);
  jumpRef.current = jumpToLatest;

  // Progressive opacity: last 3 lines full, older lines fade
  const getLineOpacity = (index: number) => {
    const fromEnd = lines.length - 1 - index;
    if (fromEnd < 3) return 1;
    // Fade from 0.5 down to 0.2 for older lines
    return Math.max(0.2, 0.5 - (fromEnd - 3) * 0.05);
  };

  return (
    <>
      <style>{`
        .lc-subtitle-area::-webkit-scrollbar { display: none; }
        .lc-line[data-speaker]::before {
          content: attr(data-speaker);
          display: inline-block;
          background: var(--speaker-color, #64748b);
          color: #fff;
          font-size: 11px;
          font-weight: 600;
          padding: 1px 6px;
          border-radius: 4px;
          margin-right: 6px;
          line-height: 1.6;
          flex-shrink: 0;
          align-self: center;
          user-select: none;
        }
      `}</style>
      <div
        ref={containerRef}
        className="lc-subtitle-area"
        onScroll={handleScroll}
        onMouseUp={handleMouseUp}
        data-jump-to-latest
        style={{
          flex: 1,
          overflowY: "auto",
          scrollbarWidth: "none",
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
        }}
      >
        {lines.length === 0 ? (
          <span style={{ color: "#334155", fontSize: "13px", textAlign: "center" }}>
            等待开始录制…
          </span>
        ) : (
          lines.map((line, i) => (
            <div
              className="lc-line"
              key={line.lineId + "-" + i}
              data-raw-text={line.rawText}
              {...(line.speaker ? { "data-speaker": line.speaker } : {})}
              style={{
                lineHeight: "2.2",
                fontSize: "14px",
                color: "#e2e8f0",
                opacity: getLineOpacity(i),
                marginBottom: "2px",
                flexWrap: "wrap",
                display: "flex",
                alignItems: "flex-start",
                ...(line.speakerColor
                  ? ({ "--speaker-color": line.speakerColor } as React.CSSProperties)
                  : {}),
              }}
            >
              {line.tokens.map((token, j) => (
                <Token
                  key={j}
                  token={token}
                  onClick={
                    onWordClick
                      ? (t) => onWordClick(t, line.rawText)
                      : undefined
                  }
                />
              ))}
            </div>
          ))
        )}
      </div>
    </>
  );
}

// Export a helper to get the jump function from the DOM
export function jumpSubtitleToLatest() {
  const el = document.querySelector("[data-jump-to-latest]");
  if (el) {
    el.scrollTop = el.scrollHeight;
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/components/SubtitleWindow.tsx
git commit -m "feat: SubtitleWindow full history, auto-scroll, progressive opacity"
```

---

### Task 6: Rewrite App.tsx with Four-Column Layout

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Rewrite App.tsx**

Replace the entire file:

```tsx
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import type { WordToken } from "./types/subtitle";
import { Sidebar } from "./components/Sidebar";
import { SubtitleWindow, jumpSubtitleToLatest } from "./components/SubtitleWindow";
import { ScrollColumn } from "./components/ScrollColumn";
import { WordDetail } from "./components/WordDetail";
import { VocabCalibration } from "./components/VocabCalibration";

type CaptureMode = "none" | "whisper" | "browser";

export default function App() {
  const [modelReady, setModelReady] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [calibrated, setCalibrated] = useState<boolean | null>(null);
  const [captureMode, setCaptureMode] = useState<CaptureMode>("none");

  // Word detail
  const [clickedWord, setClickedWord] = useState<string | null>(null);
  const [clickedContext, setClickedContext] = useState("");
  const [clickedIsPhrase, setClickedIsPhrase] = useState(false);

  // Scroll state for ScrollColumn
  const [scrollState, setScrollState] = useState({
    fraction: 1,
    thumbSize: 1,
    atBottom: true,
  });

  // Window height for adaptive word detail
  const [windowHeight, setWindowHeight] = useState(window.innerHeight);

  useEffect(() => {
    invoke<boolean>("check_model").then(setModelReady);
    invoke<string | null>("get_setting", { key: "vocab_calibrated" }).then((v) =>
      setCalibrated(v === "true")
    );
    const u1 = listen<number>("model-download-progress", (e) =>
      setDownloadProgress(e.payload)
    );
    const u2 = listen("model-download-done", () => setModelReady(true));
    return () => {
      u1.then((f) => f());
      u2.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const onResize = () => setWindowHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleStart = async (source: "whisper" | "browser") => {
    if (source === "whisper") {
      await invoke("start_recording");
      setCaptureMode("whisper");
    } else {
      await invoke("start_browser_capture");
      setCaptureMode("browser");
    }
  };

  const handlePause = async () => {
    // For now, pause = stop (true pause can be added later)
    await handleStop();
  };

  const handleStop = async () => {
    if (captureMode === "whisper") await invoke("stop_recording");
    else if (captureMode === "browser") await invoke("stop_browser_capture");
    setCaptureMode("none");
  };

  const handleWordClick = (token: WordToken, sentenceText: string) => {
    const cleaned = token.text.replace(/^[^\w]+|[^\w]+$/g, "");
    if (cleaned.length > 0) {
      setClickedWord(cleaned.toLowerCase());
      setClickedContext(sentenceText);
      setClickedIsPhrase(false);
    }
  };

  const handlePhraseSelect = (phrase: string, ctx: string) => {
    setClickedWord(phrase.toLowerCase());
    setClickedContext(ctx);
    setClickedIsPhrase(true);
  };

  const useBottomPanel = windowHeight >= 250;

  // ── Vocab calibration ──
  if (modelReady && calibrated === false) {
    return (
      <div style={styles.root}>
        <Sidebar
          captureMode="none"
          onStart={() => {}}
          onPause={() => {}}
          onStop={() => {}}
          onRecalibrate={() => {}}
        />
        <div style={{ flex: 1, overflow: "auto" }}>
          <VocabCalibration onComplete={() => setCalibrated(true)} />
        </div>
        <div style={{ width: "32px", borderLeft: "1px solid rgba(255,255,255,0.04)", flexShrink: 0 }} />
      </div>
    );
  }

  // ── Model download ──
  if (!modelReady) {
    return (
      <div style={{ ...styles.root, alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", maxWidth: "360px" }}>
          <h1 style={{ color: "#e2e8f0", fontSize: "20px", marginBottom: "8px" }}>
            LearnCaption
          </h1>
          <p style={{ color: "#94a3b8", marginBottom: "24px", fontSize: "13px" }}>
            Downloading Whisper model (~500 MB) on first launch.
          </p>
          {downloadProgress > 0 ? (
            <>
              <div style={{ background: "#1e293b", borderRadius: "6px", height: "6px", width: "100%", marginBottom: "8px" }}>
                <div style={{ background: "#60a5fa", height: "6px", borderRadius: "6px", width: `${downloadProgress * 100}%`, transition: "width 0.3s" }} />
              </div>
              <p style={{ color: "#94a3b8", fontSize: "13px" }}>
                {Math.round(downloadProgress * 100)}%
              </p>
            </>
          ) : (
            <button
              onClick={() => invoke("start_model_download")}
              style={styles.primaryBtn}
            >
              Download Model
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Main HUD ──
  return (
    <div style={styles.root}>
      <Sidebar
        captureMode={captureMode}
        onStart={handleStart}
        onPause={handlePause}
        onStop={handleStop}
        onRecalibrate={() => setCalibrated(false)}
      />

      {/* Main content area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <SubtitleWindow
          onWordClick={handleWordClick}
          onPhraseSelect={handlePhraseSelect}
          onScrollState={setScrollState}
        />

        {/* Bottom word detail panel (when window is tall enough) */}
        {clickedWord && useBottomPanel && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "0 16px" }}>
            <WordDetail
              word={clickedWord}
              context={clickedContext}
              isPhrase={clickedIsPhrase}
              onClose={() => setClickedWord(null)}
            />
          </div>
        )}
      </div>

      <ScrollColumn
        scrollFraction={scrollState.fraction}
        thumbSize={scrollState.thumbSize}
        showJump={!scrollState.atBottom}
        onJumpToLatest={jumpSubtitleToLatest}
      />

      {/* TODO Task 7: Popover window for short mode */}
    </div>
  );
}

const styles = {
  root: {
    background: "rgba(15,23,42,0.85)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    minHeight: "100vh",
    display: "flex",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
    color: "#e2e8f0",
  } as React.CSSProperties,
  primaryBtn: {
    background: "#1e3a5f",
    border: "none",
    color: "#60a5fa",
    padding: "6px 14px",
    borderRadius: "8px",
    fontSize: "12px",
    cursor: "pointer",
  } as React.CSSProperties,
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Run the app and verify layout**

Run: `npm run tauri dev`

Verify:
- Window starts at 900x200, always on top
- Four columns visible: L1 icons | L2 empty with ⋮⋮ | subtitle area | R scroll column
- L2 area is draggable (moves the window)
- ▶ button starts browser capture, changes to ⏸
- ⏹ stops capture
- 🌐 toggles source panel in L2
- ⚙ toggles settings panel in L2
- Settings → 置顶 toggle works
- Settings → 词汇校准 shows calibration UI

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: rewrite App.tsx with four-column HUD layout"
```

---

### Task 7: Adapt VocabCalibration for Embedded Layout

**Files:**
- Modify: `src/components/VocabCalibration.tsx`

- [ ] **Step 1: Remove outer wrapper styles**

In `VocabCalibration.tsx`, change the root `<div>` style from:

```tsx
    <div style={{
      background: "#0f172a",
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px 16px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
    }}>
```

To:

```tsx
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "16px",
      height: "100%",
    }}>
```

The parent (App.tsx) already provides the background, font, and full-height container.

- [ ] **Step 2: Verify calibration still works**

Run: `npm run tauri dev`

Click ⚙ → 词汇校准. Verify the calibration UI renders correctly within the four-column layout, cards scroll, slider works, confirm saves and returns to subtitle view.

- [ ] **Step 3: Commit**

```bash
git add src/components/VocabCalibration.tsx
git commit -m "fix: adapt VocabCalibration for embedded four-column layout"
```

---

### Task 8: Word Popover Window (Short Mode)

**Files:**
- Create: `src/components/WordPopover.tsx`
- Modify: `src/App.tsx`

This is the independent Tauri window for word detail when the main window is too short.

- [ ] **Step 1: Create WordPopover.tsx**

```tsx
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface PopoverOptions {
  word: string;
  context: string;
  isPhrase: boolean;
  /** Screen coordinates of the clicked word */
  anchorX: number;
  anchorY: number;
}

let popoverWindow: WebviewWindow | null = null;

export async function openWordPopover(opts: PopoverOptions) {
  // Close existing popover
  await closeWordPopover();

  const mainWin = getCurrentWindow();
  const mainPos = await mainWin.outerPosition();
  const scaleFactor = await mainWin.scaleFactor();

  // Position above the clicked word
  const popoverWidth = 300;
  const popoverHeight = 220;
  const x = Math.round(mainPos.x / scaleFactor + opts.anchorX - popoverWidth / 2);
  const y = Math.round(mainPos.y / scaleFactor - popoverHeight - 8);

  popoverWindow = new WebviewWindow("word-detail", {
    url: `index.html?popover=true&word=${encodeURIComponent(opts.word)}&context=${encodeURIComponent(opts.context)}&isPhrase=${opts.isPhrase}`,
    width: popoverWidth,
    height: popoverHeight,
    x: Math.max(0, x),
    y: Math.max(0, y),
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    focus: true,
    resizable: false,
    skipTaskbar: true,
  });

  // Close when the popover window loses focus
  popoverWindow.onFocusChanged(({ payload: focused }) => {
    if (!focused) closeWordPopover();
  });
}

export async function closeWordPopover() {
  if (popoverWindow) {
    try {
      await popoverWindow.close();
    } catch {
      // Already closed
    }
    popoverWindow = null;
  }
}
```

- [ ] **Step 2: Update App.tsx to use popover in short mode**

In App.tsx, replace the `{/* TODO Task 7: Popover window for short mode */}` comment. Update `handleWordClick` to branch on `useBottomPanel`:

Add import at top:
```tsx
import { openWordPopover, closeWordPopover } from "./components/WordPopover";
```

Replace the `handleWordClick` function:
```tsx
  const handleWordClick = (token: WordToken, sentenceText: string) => {
    const cleaned = token.text.replace(/^[^\w]+|[^\w]+$/g, "");
    if (cleaned.length === 0) return;
    const word = cleaned.toLowerCase();

    if (useBottomPanel) {
      setClickedWord(word);
      setClickedContext(sentenceText);
      setClickedIsPhrase(false);
    } else {
      // Get click position for popover placement
      const selection = window.getSelection();
      const range = selection?.getRangeAt(0);
      const rect = range?.getBoundingClientRect();
      openWordPopover({
        word,
        context: sentenceText,
        isPhrase: false,
        anchorX: rect?.left ?? 200,
        anchorY: rect?.top ?? 0,
      });
    }
  };

  const handlePhraseSelect = (phrase: string, ctx: string) => {
    if (useBottomPanel) {
      setClickedWord(phrase.toLowerCase());
      setClickedContext(ctx);
      setClickedIsPhrase(true);
    } else {
      openWordPopover({
        word: phrase.toLowerCase(),
        context: ctx,
        isPhrase: true,
        anchorX: 200,
        anchorY: 0,
      });
    }
  };
```

Also add cleanup on close:
```tsx
  // Close popover when switching to bottom panel mode
  useEffect(() => {
    if (useBottomPanel) closeWordPopover();
  }, [useBottomPanel]);
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Test both modes**

Run: `npm run tauri dev`

1. Resize window tall (>250px) → click a word → bottom panel shows
2. Resize window short (<250px) → click a word → independent popover window appears above
3. Click outside popover → it closes

Note: The popover window loads `index.html?popover=true` which currently renders the full app. A proper popover route would need a small addition to `main.tsx` or the App component to detect the query param and render only WordDetail. This can be refined after the core layout is working.

- [ ] **Step 5: Commit**

```bash
git add src/components/WordPopover.tsx src/App.tsx
git commit -m "feat: adaptive word detail — bottom panel or independent popover window"
```

---

### Task 9: Update App.css and Final Cleanup

**Files:**
- Modify: `src/App.css`
- Modify: `src/App.tsx` (remove dead imports if any)

- [ ] **Step 1: Update App.css**

Replace the content of `src/App.css`:

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { background: transparent; overflow: hidden; }
button { font-family: inherit; }

/* Hide scrollbars globally but keep scroll functionality */
::-webkit-scrollbar { width: 0; height: 0; }
```

- [ ] **Step 2: Verify no dead imports remain**

Run: `grep -rn "VocabBook\|ReviewPage\|SourceBadge" src/ --include="*.tsx" --include="*.ts"`

Expected: no results. If any remain in App.tsx, remove them.

- [ ] **Step 3: Full build check**

Run: `cd src-tauri && cargo check && cd .. && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/App.css src/App.tsx
git commit -m "chore: final cleanup — update CSS, remove dead imports"
```

---

### Task 10: End-to-End Verification

- [ ] **Step 1: Fresh dev start**

Run: `npm run tauri dev`

- [ ] **Step 2: Verify all states**

Checklist:
1. Window starts as HUD (900x200), always on top, semi-transparent
2. L1 icons: ▶ ⏹ 🌐 ⚙ all visible and properly styled
3. L2 area is empty with ⋮⋮ handle, dragging it moves the window
4. Click 🌐 → source panel appears in L2 with Google Meet selected
5. Click 🌐 again → panel closes
6. Click ⚙ → settings panel with 词汇校准 and 置顶 toggle
7. Toggle 置顶 → window drops from always-on-top and back
8. Click 词汇校准 → calibration UI replaces main area
9. Complete calibration → returns to subtitle view
10. Click ▶ → starts browser capture (or whisper), icon changes to ⏸
11. Subtitles appear in main area, new lines auto-scroll to bottom
12. Scroll up → older lines visible with faded opacity, ↓ button appears in R column
13. Click ↓ → jumps to bottom, ↓ disappears
14. Click ⏹ → capture stops
15. Click a highlighted word in tall mode → bottom panel with WordDetail
16. Resize window short → click word → popover window appears above

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A && git commit -m "fix: end-to-end verification fixes"
```

Only commit if there were actual fixes. If everything passed, skip this step.
