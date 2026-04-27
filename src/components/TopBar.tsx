import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";

export function TopBar() {
  const [pinned, setPinned] = useState(true);

  const handleClose = () => getCurrentWindow().close();

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
      `}</style>
      <div
        className="lc-top-bar"
        data-tauri-drag-region
        style={{
          height: "14px",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
          userSelect: "none",
        }}
      >
        {/* Window controls — hidden until hover */}
        <div
          className="lc-top-controls"
          style={{ display: "flex", alignItems: "center", gap: "4px", paddingLeft: "6px" }}
        >
          {/* Close — red dot like macOS */}
          <button
            onClick={handleClose}
            title="关闭"
            style={{
              width: "10px", height: "10px", borderRadius: "50%",
              background: "#ef4444", border: "none", cursor: "pointer", padding: 0,
              flexShrink: 0,
            }}
          />
          {/* Pin toggle — yellow/gray dot */}
          <button
            onClick={handleTogglePin}
            title={pinned ? "取消置顶" : "置顶"}
            style={{
              width: "10px", height: "10px", borderRadius: "50%",
              background: pinned ? "#fbbf24" : "#475569",
              border: "none", cursor: "pointer", padding: 0,
              flexShrink: 0,
            }}
          />
        </div>
      </div>
    </>
  );
}
