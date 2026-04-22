import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { VocabEntry, WordQueryResult, VocabSentence } from "../types/vocabulary";

interface Props {
  word: string;
  context?: string;
  onClose: () => void;
  onAddToVocab?: (entry: VocabEntry) => void;
}

export function WordDetail({ word, context, onClose, onAddToVocab }: Props) {
  const [result, setResult] = useState<WordQueryResult | null>(null);
  const [sentences, setSentences] = useState<VocabSentence[]>([]);
  const [aiTranslation, setAiTranslation] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [modelMissing, setModelMissing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  useEffect(() => {
    setSentences([]);
    setAiTranslation(null);
    setAiError(null);
    invoke<WordQueryResult>("query_word", { word }).then(setResult).catch(console.error);
  }, [word]);

  useEffect(() => {
    if (result?.vocabEntry) {
      invoke<VocabSentence[]>("get_vocab_sentences", { vocabId: result.vocabEntry.id })
        .then(setSentences)
        .catch(console.error);
    }
  }, [result]);

  const handleSpeak = (text: string) => {
    invoke("speak_text", { text }).catch(console.error);
  };

  const handleAddToVocab = async () => {
    if (!result) return;
    const definition = result.definition ?? "";
    try {
      const entry = await invoke<VocabEntry>("add_entry", {
        entry: word,
        definition,
        entryType: "word",
      });
      setResult((prev) => prev ? { ...prev, vocabEntry: entry } : prev);
      onAddToVocab?.(entry);
    } catch (e) {
      console.error("add_entry failed:", e);
    }
  };

  const handleMastered = async () => {
    if (!result?.vocabEntry) return;
    await invoke("mark_mastered", { id: result.vocabEntry.id });
    onClose();
  };

  const handleAiTranslate = async () => {
    setAiLoading(true);
    setAiError(null);
    setAiTranslation(null);
    try {
      const translation = await invoke<string>("translate_selection", {
        selection: word,
        context: context ?? null,
      });
      setAiTranslation(translation);
    } catch (e: unknown) {
      const msg = String(e);
      if (msg.includes("MODEL_NOT_DOWNLOADED")) {
        setModelMissing(true);
      } else {
        setAiError(msg);
      }
    } finally {
      setAiLoading(false);
    }
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
      setAiError(`下载失败: ${e.payload}`);
      u1(); u2(); u3();
    });
    await invoke("download_translation_model");
  };

  return (
    <div
      style={{
        background: "#0f172a",
        border: "1px solid #1e293b",
        borderRadius: "10px",
        padding: "16px",
        minWidth: "300px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <span style={{ color: "#fbbf24", fontSize: "20px", fontWeight: 700 }}>{word}</span>
          {result?.vocabEntry && (
            <span style={{ color: "#34d399", fontSize: "12px", marginLeft: "10px" }}>
              {result.vocabEntry.occurrenceCount}×
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "16px" }}
        >
          ✕
        </button>
      </div>

      {result?.definition && (
        <p style={{ color: "#94a3b8", fontSize: "14px", margin: "8px 0" }}>
          {result.definition}
        </p>
      )}

      <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
        <button
          onClick={() => handleSpeak(word)}
          style={{ background: "#1e3a5f", border: "none", color: "#60a5fa", padding: "5px 12px", borderRadius: "6px", fontSize: "12px", cursor: "pointer" }}
        >
          🔊 Pronounce
        </button>
        {!result?.vocabEntry && (
          <button
            onClick={handleAddToVocab}
            style={{ background: "#1e293b", border: "1px solid #334155", color: "#94a3b8", padding: "5px 12px", borderRadius: "6px", fontSize: "12px", cursor: "pointer" }}
          >
            + Add to vocab
          </button>
        )}
        {result?.vocabEntry && result.vocabEntry.familiarity < 5 && (
          <button
            onClick={handleMastered}
            style={{ background: "#064e3b", border: "none", color: "#34d399", padding: "5px 12px", borderRadius: "6px", fontSize: "12px", cursor: "pointer" }}
          >
            ✓ Mastered
          </button>
        )}
        <button
          onClick={handleAiTranslate}
          disabled={aiLoading}
          style={{ background: "#1e1b4b", border: "none", color: aiLoading ? "#6366f1" : "#a5b4fc", padding: "5px 12px", borderRadius: "6px", fontSize: "12px", cursor: aiLoading ? "default" : "pointer" }}
        >
          {aiLoading ? "翻译中…" : "✦ AI 翻译"}
        </button>
      </div>

      {(aiTranslation || aiError || modelMissing) && (
        <div style={{ marginTop: "10px", background: "#1e1b4b", borderRadius: "6px", padding: "8px 12px" }}>
          {aiTranslation && (
            <span style={{ color: "#c7d2fe", fontSize: "14px", lineHeight: "1.6" }}>{aiTranslation}</span>
          )}
          {aiError && (
            <span style={{ color: "#f87171", fontSize: "13px" }}>{aiError}</span>
          )}
          {modelMissing && !downloading && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ color: "#94a3b8", fontSize: "13px" }}>AI 翻译模型未下载 (~1.1 GB)</span>
              <button
                onClick={handleDownloadModel}
                style={{ background: "#312e81", border: "none", color: "#a5b4fc", padding: "3px 10px", borderRadius: "5px", fontSize: "12px", cursor: "pointer" }}
              >
                下载
              </button>
            </div>
          )}
          {downloading && (
            <div>
              <div style={{ color: "#a5b4fc", fontSize: "13px", marginBottom: "4px" }}>
                下载中… {Math.round(downloadProgress * 100)}%
              </div>
              <div style={{ background: "#1e1b4b", borderRadius: "4px", height: "4px", width: "100%" }}>
                <div style={{ background: "#6366f1", height: "4px", borderRadius: "4px", width: `${downloadProgress * 100}%`, transition: "width 0.3s" }} />
              </div>
            </div>
          )}
        </div>
      )}

      {sentences.length > 0 && (
        <div style={{ marginTop: "14px" }}>
          <div style={{ color: "#475569", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>
            Context
          </div>
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
                onClick={() => handleSpeak(s.text)}
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
