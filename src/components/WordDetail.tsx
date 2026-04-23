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

export function WordDetail({ word, context, isPhrase, onClose, onAddToVocab }: Props) {
  const [result, setResult] = useState<WordQueryResult | null>(null);
  const [sentences, setSentences] = useState<VocabSentence[]>([]);
  const [aiTranslation, setAiTranslation] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [modelMissing, setModelMissing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  const triggerAiTranslate = async (ecdictFallback?: string | null) => {
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
      } else if (msg.includes("AI_OUTPUT_TOO_LONG") && ecdictFallback) {
        // Model translated entire sentence — fall back to ECDICT definition
        setAiTranslation(ecdictFallback);
      } else {
        setAiError(msg);
      }
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    setSentences([]);
    setAiTranslation(null);
    setAiError(null);
    setModelMissing(false);

    if (!isPhrase) {
      // Single word: query ECDICT, then decide whether to trigger AI
      invoke<WordQueryResult>("query_word", { word }).then(async (r) => {
        setResult(r);
        // Skip AI for common words (frq below threshold)
        const thresholdStr = await invoke<string | null>("get_setting", { key: "ai_translate_frq_threshold" });
        const threshold = parseInt(thresholdStr ?? "3000", 10);
        if (r.frequency != null && r.frequency < threshold) return;
        triggerAiTranslate(r.definition);
      }).catch(console.error);
    } else {
      setResult(null);
      // Phrases always get AI translation
      triggerAiTranslate();
    }
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
    // Prefer AI translation (contextual) over ECDICT
    const definition = aiTranslation ?? result?.definition ?? "";
    try {
      const entry = await invoke<VocabEntry>("add_entry", {
        entry: word,
        definition,
        entryType: isPhrase ? "phrase" : "word",
      });
      setResult((prev) => prev ? { ...prev, vocabEntry: entry } : { definition: null, frequency: null, vocabEntry: entry });
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

      {/* ECDICT definition — single words only */}
      {!isPhrase && result?.definition && (
        <div style={{ marginTop: "8px", borderRadius: "6px", padding: "8px 12px", minHeight: "28px" }}>
          <span style={{ color: "#64748b", fontSize: "11px", fontWeight: 600, marginRight: "8px" }}>ECDICT 翻译</span>
          <span style={{ color: "#94a3b8", fontSize: "14px", lineHeight: "1.6" }}>{result.definition}</span>
        </div>
      )}

      {/* AI translation */}
      <div style={{ marginTop: "4px", background: "#1e1b4b", borderRadius: "6px", padding: "8px 12px", minHeight: "28px" }}>
        <span style={{ color: "#6366f1", fontSize: "11px", fontWeight: 600, marginRight: "8px" }}>AI 翻译</span>
        {aiLoading && <span style={{ color: "#6366f1", fontSize: "14px" }}>翻译中…</span>}
        {aiTranslation && (
          <span style={{ color: "#c7d2fe", fontSize: "14px", lineHeight: "1.6" }}>{aiTranslation}</span>
        )}
        {aiError && <span style={{ color: "#f87171", fontSize: "14px" }}>{aiError}</span>}
        {modelMissing && !downloading && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "#94a3b8", fontSize: "14px" }}>模型未下载 (~1.1 GB)</span>
            <button
              onClick={handleDownloadModel}
              style={{ background: "#312e81", border: "none", color: "#a5b4fc", padding: "3px 10px", borderRadius: "5px", fontSize: "12px", cursor: "pointer" }}
            >
              下载
            </button>
          </span>
        )}
        {downloading && (
          <div style={{ marginTop: "4px" }}>
            <div style={{ color: "#a5b4fc", fontSize: "13px", marginBottom: "4px" }}>
              下载中… {Math.round(downloadProgress * 100)}%
            </div>
            <div style={{ background: "#1e1b4b", borderRadius: "4px", height: "4px", width: "100%" }}>
              <div style={{ background: "#6366f1", height: "4px", borderRadius: "4px", width: `${downloadProgress * 100}%`, transition: "width 0.3s" }} />
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
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
      </div>

      {/* Context sentences — single words only */}
      {!isPhrase && sentences.length > 0 && (
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
