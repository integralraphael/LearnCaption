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
