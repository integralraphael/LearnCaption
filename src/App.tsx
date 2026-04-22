import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import type { WordToken } from "./types/subtitle";
import { SubtitleWindow } from "./components/SubtitleWindow";
import { VocabBook } from "./components/VocabBook";
import { ReviewPage } from "./components/ReviewPage";
import { WordDetail } from "./components/WordDetail";
import { SourceBadge } from "./components/SourceBadge";

type View = "subtitle" | "vocab" | "review";
type CaptureMode = "none" | "whisper" | "browser";

export default function App() {
  const [modelReady, setModelReady] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [captureMode, setCaptureMode] = useState<CaptureMode>("none");
  const [view, setView] = useState<View>("subtitle");
  const [clickedWord, setClickedWord] = useState<string | null>(null);
  const [clickedContext, setClickedContext] = useState<string>("");

  useEffect(() => {
    invoke<boolean>("check_model").then(setModelReady);
    const u1 = listen<number>("model-download-progress", (e) => setDownloadProgress(e.payload));
    const u2 = listen("model-download-done", () => setModelReady(true));
    return () => {
      u1.then((f) => f());
      u2.then((f) => f());
    };
  }, []);

  const handleStartWhisper = async () => {
    await invoke("start_recording");
    setCaptureMode("whisper");
  };

  const handleStartBrowser = async () => {
    await invoke("start_browser_capture");
    setCaptureMode("browser");
  };

  const handleStop = async () => {
    if (captureMode === "whisper") await invoke("stop_recording");
    else if (captureMode === "browser") await invoke("stop_browser_capture");
    setCaptureMode("none");
  };

  const handleWordClick = (token: WordToken, sentenceText: string) => {
    if (token.text.match(/^\w+$/)) {
      setClickedWord(token.text.toLowerCase());
      setClickedContext(sentenceText);
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
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* Window controls */}
          <div style={{ display: "flex", gap: "6px", marginRight: "4px" }} data-tauri-drag-region="false">
            <span onClick={() => getCurrentWindow().close()}    style={styles.winBtn("#ef4444")} title="关闭" />
            <span onClick={() => getCurrentWindow().minimize()} style={styles.winBtn("#f59e0b")} title="最小化" />
            <span onClick={() => getCurrentWindow().toggleMaximize()} style={styles.winBtn("#22c55e")} title="最大化" />
          </div>
          <span style={{ color: "#60a5fa", fontWeight: 700, fontSize: "14px" }}>LearnCaption</span>
          <SourceBadge />
        </div>
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
        {captureMode === "none" ? (
          <div style={{ display: "flex", gap: "6px" }}>
            <button onClick={handleStartWhisper} style={styles.primaryBtn}>⏺ Whisper</button>
            <button
              onClick={handleStartBrowser}
              style={{ ...styles.primaryBtn, background: "#064e3b", color: "#34d399" }}
            >
              🌐 Browser
            </button>
          </div>
        ) : (
          <button
            onClick={handleStop}
            style={{ ...styles.primaryBtn, background: "#7f1d1d", color: "#fca5a5" }}
          >
            ⏹ Stop
          </button>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: view === "subtitle" ? "12px" : "0" }}>
        {view === "subtitle" && (
          <>
            <SubtitleWindow onWordClick={handleWordClick} />
            {clickedWord && (
              <div style={{ marginTop: "12px" }}>
                <WordDetail word={clickedWord} context={clickedContext} onClose={() => setClickedWord(null)} />
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
  winBtn: (color: string): React.CSSProperties => ({
    width: "12px",
    height: "12px",
    borderRadius: "50%",
    background: color,
    display: "inline-block",
    cursor: "pointer",
    flexShrink: 0,
  }),
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
    padding: "6px 14px",
    borderRadius: "8px",
    fontSize: "12px",
    cursor: "pointer",
  } as React.CSSProperties,
};
