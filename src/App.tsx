import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { WordToken } from "./types/subtitle";
import { Sidebar } from "./components/Sidebar";
import { SubtitleWindow, jumpSubtitleToLatest } from "./components/SubtitleWindow";
import { ScrollColumn } from "./components/ScrollColumn";
import { WordDetail } from "./components/WordDetail";
import { VocabCalibration } from "./components/VocabCalibration";
import { openWordPopover, closeWordPopover } from "./components/WordPopover";

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

  const useBottomPanel = windowHeight >= 250;

  // Close popover when switching to bottom panel mode
  useEffect(() => {
    if (useBottomPanel) closeWordPopover();
  }, [useBottomPanel]);

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
