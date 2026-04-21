import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { WordToken } from "./types/subtitle";
import { SubtitleWindow } from "./components/SubtitleWindow";
import { VocabBook } from "./components/VocabBook";
import { ReviewPage } from "./components/ReviewPage";
import { WordDetail } from "./components/WordDetail";

type View = "subtitle" | "vocab" | "review";

export default function App() {
  const [modelReady, setModelReady] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [recording, setRecording] = useState(false);
  const [view, setView] = useState<View>("subtitle");
  const [clickedWord, setClickedWord] = useState<string | null>(null);

  useEffect(() => {
    invoke<boolean>("check_model").then(setModelReady);
    listen<number>("model-download-progress", (e) => setDownloadProgress(e.payload));
    listen("model-download-done", () => setModelReady(true));
  }, []);

  const handleStart = async () => {
    await invoke("start_recording");
    setRecording(true);
  };

  const handleStop = async () => {
    await invoke("stop_recording");
    setRecording(false);
  };

  const handleWordClick = (token: WordToken) => {
    if (token.text.match(/^\w+$/)) {
      setClickedWord(token.text.toLowerCase());
    }
  };

  // ── Model download screen ──
  if (!modelReady) {
    return (
      <div style={styles.screen}>
        <div style={{ textAlign: "center", maxWidth: "360px" }}>
          <h1 style={{ color: "#e2e8f0", fontSize: "24px", marginBottom: "8px" }}>LearnCaption</h1>
          <p style={{ color: "#94a3b8", marginBottom: "24px" }}>
            Downloading Whisper model (~500 MB) on first launch.
          </p>
          {downloadProgress > 0 ? (
            <>
              <div style={{ background: "#1e293b", borderRadius: "6px", height: "6px", width: "100%", marginBottom: "8px" }}>
                <div style={{ background: "#60a5fa", height: "6px", borderRadius: "6px", width: `${downloadProgress * 100}%`, transition: "width 0.3s" }} />
              </div>
              <p style={{ color: "#94a3b8", fontSize: "13px" }}>{Math.round(downloadProgress * 100)}%</p>
            </>
          ) : (
            <button onClick={() => invoke("start_model_download")} style={styles.primaryBtn}>
              Download Model
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...styles.screen, flexDirection: "column", padding: 0 }}>
      {/* Navigation */}
      <div style={styles.nav} data-tauri-drag-region>
        <span style={{ color: "#60a5fa", fontWeight: 700, fontSize: "14px" }}>LearnCaption</span>
        <div style={{ display: "flex", gap: "4px" }}>
          {(["subtitle", "vocab", "review"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{ ...styles.navBtn, background: view === v ? "#1e3a5f" : "transparent", color: view === v ? "#60a5fa" : "#64748b" }}
            >
              {{ subtitle: "Subtitles", vocab: "Vocab", review: "Review" }[v]}
            </button>
          ))}
        </div>
        <button
          onClick={recording ? handleStop : handleStart}
          style={{ ...styles.primaryBtn, padding: "5px 14px", fontSize: "12px", background: recording ? "#7f1d1d" : "#1e3a5f", color: recording ? "#fca5a5" : "#60a5fa" }}
        >
          {recording ? "⏹ Stop" : "⏺ Start"}
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: view === "subtitle" ? "12px" : "0" }}>
        {view === "subtitle" && (
          <>
            <SubtitleWindow onWordClick={handleWordClick} />
            {clickedWord && (
              <div style={{ marginTop: "12px" }}>
                <WordDetail word={clickedWord} onClose={() => setClickedWord(null)} />
              </div>
            )}
          </>
        )}
        {view === "vocab" && <VocabBook />}
        {view === "review" && <ReviewPage />}
      </div>
    </div>
  );
}

const styles = {
  screen: {
    background: "#0f172a",
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "-apple-system, sans-serif",
    color: "#e2e8f0",
  } as React.CSSProperties,
  nav: {
    background: "rgba(15,23,42,0.9)",
    backdropFilter: "blur(8px)",
    padding: "8px 14px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottom: "1px solid #1e293b",
  } as React.CSSProperties,
  navBtn: {
    border: "none",
    borderRadius: "6px",
    padding: "5px 10px",
    fontSize: "12px",
    cursor: "pointer",
  } as React.CSSProperties,
  primaryBtn: {
    background: "#1e3a5f",
    border: "none",
    color: "#60a5fa",
    padding: "8px 20px",
    borderRadius: "8px",
    fontSize: "14px",
    cursor: "pointer",
  } as React.CSSProperties,
};
