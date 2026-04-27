import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";

export function TopBar() {
  const [pinned, setPinned] = useState(true);

  const handleClose = () => getCurrentWindow().close();
  const handleMinimize = () => getCurrentWindow().minimize();

  const handleTogglePin = async () => {
    try {
      const next = await invoke<boolean>("toggle_always_on_top");
      setPinned(next);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <>
      <style>{`
        .lc-top-bar { position: relative; }
        .lc-top-controls { opacity: 0; transition: opacity 0.15s; }
        .lc-top-bar:hover .lc-top-controls { opacity: 1; }
        .lc-traffic-btn { position: relative; display: flex; align-items: center; justify-content: center; }
        .lc-traffic-btn .lc-traffic-icon { opacity: 0; font-size: 7px; font-weight: 900; line-height: 1; color: rgba(0,0,0,0.5); pointer-events: none; }
        .lc-top-controls:hover .lc-traffic-btn .lc-traffic-icon { opacity: 1; }
      `}</style>
      <div
        className="lc-top-bar"
        data-tauri-drag-region
        style={{
          height: "28px",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
          userSelect: "none",
          cursor: "grab",
        }}
      >
        {/* Window controls — hidden until hover */}
        <div
          className="lc-top-controls"
          style={{ display: "flex", alignItems: "center", gap: "8px", paddingLeft: "8px" }}
        >
          {/* Close */}
          <button onClick={handleClose} title="关闭" className="lc-traffic-btn"
            style={{ width: "14px", height: "14px", borderRadius: "50%", background: "#FF5F57", border: "none", cursor: "default", padding: 0, flexShrink: 0 }}
          >
            <span className="lc-traffic-icon">✕</span>
          </button>
          {/* Minimize */}
          <button onClick={handleMinimize} title="最小化" className="lc-traffic-btn"
            style={{ width: "14px", height: "14px", borderRadius: "50%", background: "#FFBD2E", border: "none", cursor: "default", padding: 0, flexShrink: 0 }}
          >
            <span className="lc-traffic-icon">−</span>
          </button>
          {/* Pin toggle */}
          <button onClick={handleTogglePin} title={pinned ? "取消置顶" : "置顶"} className="lc-traffic-btn"
            style={{ width: "14px", height: "14px", borderRadius: "50%", background: pinned ? "#28C840" : "#475569", border: "none", cursor: "default", padding: 0, flexShrink: 0 }}
          >
            <span className="lc-traffic-icon">{pinned ? "−" : "+"}</span>
          </button>
        </div>
      </div>
    </>
  );
}
