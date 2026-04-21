import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

type Source = "whisper" | "meet" | "youtube" | "browser" | "none";

const LABELS: Record<Source, string> = {
  whisper: "Whisper",
  meet:    "Meet",
  youtube: "YouTube",
  browser: "Browser",
  none:    "",
};

const COLORS: Record<Source, string> = {
  whisper: "#818cf8",
  meet:    "#34d399",
  youtube: "#f87171",
  browser: "#60a5fa",
  none:    "transparent",
};

export function SourceBadge() {
  const [source, setSource] = useState<Source>("none");

  useEffect(() => {
    const unlisten = listen<string>("source-changed", (e) => {
      setSource((e.payload as Source) ?? "none");
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  if (source === "none") return null;

  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: "5px",
      background: "rgba(255,255,255,0.06)",
      borderRadius: "10px",
      padding: "3px 8px",
      fontSize: "11px",
      color: COLORS[source],
    }}>
      <span style={{
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        background: COLORS[source],
        display: "inline-block",
      }} />
      {LABELS[source]}
    </span>
  );
}
