import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { VocabEntry, WordQueryResult, VocabSentence } from "../types/vocabulary";

interface Props {
  word: string;
  context?: string;
  isPhrase?: boolean;
  onClose: () => void;
  onAddToVocab?: (entry: VocabEntry) => void;
}

const labelStyle: React.CSSProperties = {
  fontSize: "10px",
  textTransform: "uppercase",
  letterSpacing: "0.6px",
  color: "#475569",
  marginBottom: "2px",
};

const definitionStyle: React.CSSProperties = {
  color: "#cbd5e1",
  fontSize: "14px",
  lineHeight: "1.6",
  wordBreak: "break-word",
  whiteSpace: "pre-wrap",
};

const addBtnStyle: React.CSSProperties = {
  background: "#1e293b",
  border: "1px solid #334155",
  color: "#94a3b8",
  padding: "3px 10px",
  borderRadius: "6px",
  fontSize: "11px",
  cursor: "pointer",
  flexShrink: 0,
};

export function WordDetail({ word, context, isPhrase, onClose, onAddToVocab }: Props) {
  const [ecdictResult, setEcdictResult] = useState<WordQueryResult | null>(null);
  const [sentences, setSentences] = useState<VocabSentence[]>([]);
  const [aiTranslation, setAiTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [modelMissing, setModelMissing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  useEffect(() => {
    setSentences([]);
    setEcdictResult(null);
    setAiTranslation(null);
    setTranslating(false);
    setModelMissing(false);

    let cancelled = false;

    // Always fire AI translation
    setTranslating(true);
    invoke<string>("translate_selection", { selection: word, context: context ?? null })
      .then((ai) => { if (!cancelled) setAiTranslation(ai); })
      .catch((e) => {
        if (cancelled) return;
        if (String(e).includes("MODEL_NOT_DOWNLOADED")) setModelMissing(true);
      })
      .finally(() => { if (!cancelled) setTranslating(false); });

    if (!isPhrase) {
      invoke<WordQueryResult>("query_word", { word })
        .then((r) => { if (!cancelled) setEcdictResult(r); })
        .catch(console.error);
    }

    return () => { cancelled = true; };
  }, [word]);

  useEffect(() => {
    if (ecdictResult?.vocabEntry) {
      invoke<VocabSentence[]>("get_vocab_sentences", { vocabId: ecdictResult.vocabEntry.id })
        .then(setSentences)
        .catch(console.error);
    }
  }, [ecdictResult]);

  const handleSpeak = () => {
    invoke("speak_text", { text: word }).catch(console.error);
  };

  const handleAddToVocab = async (definition: string) => {
    try {
      const entry = await invoke<VocabEntry>("add_entry", {
        entry: word,
        definition,
        entryType: isPhrase ? "phrase" : "word",
      });
      setEcdictResult((prev) =>
        prev ? { ...prev, vocabEntry: entry } : { definition: null, frequency: null, vocabEntry: entry }
      );
      onAddToVocab?.(entry);
    } catch (e) {
      console.error("add_entry failed:", e);
    }
  };

  const handleMastered = async () => {
    if (!ecdictResult?.vocabEntry) return;
    await invoke("mark_mastered", { id: ecdictResult.vocabEntry.id });
    onClose();
  };

  const handleDownloadModel = async () => {
    setDownloading(true);
    setDownloadProgress(0);
    const u1 = await listen<number>("hymt-download-progress", (e) => setDownloadProgress(e.payload));
    const u2 = await listen("hymt-download-done", () => {
      setDownloading(false);
      setModelMissing(false);
      u1(); u2();
    });
    const u3 = await listen<string>("hymt-download-error", (e) => {
      setDownloading(false);
      u1(); u2(); u3();
      console.error("download error:", e.payload);
    });
    await invoke("download_translation_model");
  };

  const vocabEntry = ecdictResult?.vocabEntry;

  return (
    <div style={{ width: "100%", boxSizing: "border-box", padding: "12px 0" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <span style={{ color: "#fbbf24", fontSize: "20px", fontWeight: 700 }}>{word}</span>
          <button
            onClick={handleSpeak}
            style={{ background: "#1e3a5f", border: "none", color: "#60a5fa", padding: "3px 10px", borderRadius: "6px", fontSize: "12px", cursor: "pointer" }}
          >
            🔊
          </button>
          {vocabEntry && (
            <span style={{ color: "#34d399", fontSize: "12px" }}>
              {vocabEntry.occurrenceCount}×
            </span>
          )}
          {vocabEntry && vocabEntry.familiarity < 5 && (
            <button
              onClick={handleMastered}
              style={{ background: "#064e3b", border: "none", color: "#34d399", padding: "3px 10px", borderRadius: "6px", fontSize: "12px", cursor: "pointer" }}
            >
              ✓ Mastered
            </button>
          )}
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "16px" }}
        >
          ✕
        </button>
      </div>

      {/* AI translation */}
      <div style={{ marginBottom: "10px" }}>
        <div style={labelStyle}>AI</div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
          <div style={{ flex: 1 }}>
            {aiTranslation && <span style={definitionStyle}>{aiTranslation}</span>}
            {translating && !aiTranslation && <span style={{ color: "#64748b", fontSize: "14px" }}>翻译中…</span>}
            {modelMissing && !downloading && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                <span style={{ color: "#94a3b8", fontSize: "13px" }}>AI 模型未下载</span>
                <button
                  onClick={handleDownloadModel}
                  style={{ background: "#312e81", border: "none", color: "#a5b4fc", padding: "3px 10px", borderRadius: "5px", fontSize: "12px", cursor: "pointer" }}
                >
                  下载
                </button>
              </span>
            )}
            {downloading && (
              <div>
                <div style={{ color: "#a5b4fc", fontSize: "12px", marginBottom: "3px" }}>下载中… {Math.round(downloadProgress * 100)}%</div>
                <div style={{ background: "#0f172a", borderRadius: "4px", height: "3px", width: "120px" }}>
                  <div style={{ background: "#6366f1", height: "3px", borderRadius: "4px", width: `${downloadProgress * 100}%`, transition: "width 0.3s" }} />
                </div>
              </div>
            )}
          </div>
          {aiTranslation && !vocabEntry && (
            <button onClick={() => handleAddToVocab(aiTranslation)} style={addBtnStyle}>
              + Add
            </button>
          )}
        </div>
      </div>

      {/* ECDICT — single words only */}
      {!isPhrase && ecdictResult?.definition && (
        <div style={{ marginBottom: "10px" }}>
          <div style={labelStyle}>Dictionary</div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
            <span style={{ ...definitionStyle, flex: 1, color: "#94a3b8" }}>{ecdictResult.definition}</span>
            {!vocabEntry && (
              <button onClick={() => handleAddToVocab(ecdictResult!.definition!)} style={addBtnStyle}>
                + Add
              </button>
            )}
          </div>
        </div>
      )}

      {/* Context sentences */}
      {!isPhrase && sentences.length > 0 && (
        <div style={{ marginTop: "6px" }}>
          <div style={{ ...labelStyle, marginBottom: "6px" }}>Context</div>
          {sentences.slice(0, 5).map((s) => (
            <div
              key={s.lineId}
              style={{ background: "#1e293b", borderRadius: "6px", padding: "8px", marginBottom: "6px", fontSize: "13px", color: "#cbd5e1", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}
            >
              <span style={{ flex: 1, lineHeight: "1.6" }}>
                {s.text.split(new RegExp(`(\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b)`, "gi")).map((part, i) =>
                  part.toLowerCase() === word.toLowerCase()
                    ? <mark key={i} style={{ background: "transparent", color: "#fbbf24", fontWeight: 600 }}>{part}</mark>
                    : part
                )}
              </span>
              <button
                onClick={() => invoke("speak_text", { text: s.text })}
                style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", marginLeft: "8px", flexShrink: 0 }}
              >
                🔊
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
