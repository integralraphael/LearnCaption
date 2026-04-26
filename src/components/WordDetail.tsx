import { useEffect, useRef, useState } from "react";
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
  const [ecdictResult, setEcdictResult] = useState<WordQueryResult | null>(null);
  const [sentences, setSentences] = useState<VocabSentence[]>([]);
  // Best translation shown to the user — shorter of ECDICT and AI for words,
  // AI only for phrases.
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [modelMissing, setModelMissing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  // Cache threshold across word changes (fetched once per component mount)
  const thresholdRef = useRef<number>(3000);

  useEffect(() => {
    invoke<string | null>("get_setting", { key: "ai_translate_frq_threshold" })
      .then((v) => { thresholdRef.current = parseInt(v ?? "3000", 10); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setSentences([]);
    setEcdictResult(null);
    setTranslation(null);
    setTranslating(false);
    setModelMissing(false);

    let cancelled = false;

    if (isPhrase) {
      // Phrases and sentences: AI only
      setTranslating(true);
      invoke<string>("translate_selection", { selection: word, context: context ?? null })
        .then((t) => { if (!cancelled) setTranslation(t); })
        .catch((e) => {
          if (cancelled) return;
          if (String(e).includes("MODEL_NOT_DOWNLOADED")) setModelMissing(true);
        })
        .finally(() => { if (!cancelled) setTranslating(false); });
      return () => { cancelled = true; };
    }

    // Single word: ECDICT + AI concurrently, show shorter of the two valid results.
    //
    // TODO: AI models tend to translate simple words — especially those appearing at the
    // start of a sentence — as the full sentence rather than the word itself. Taking the
    // shorter of ECDICT and AI avoids showing these over-translated results.
    invoke<WordQueryResult>("query_word", { word }).then((r) => {
      if (cancelled) return;
      setEcdictResult(r);

      // Show ECDICT definition immediately while AI runs (or if AI isn't triggered)
      if (r.definition) setTranslation(r.definition);

      // Skip AI for common words (frq below user's calibrated threshold)
      if (r.frequency != null && r.frequency < thresholdRef.current) return;

      // Fire AI translation
      setTranslating(true);
      invoke<string>("translate_selection", { selection: word, context: context ?? null })
        .then((ai) => {
          if (cancelled) return;
          const ecdict = r.definition ?? null;
          // Keep whichever valid result is shorter
          const useAI = !ecdict || ai.length < ecdict.length;
          setTranslation(useAI ? ai : ecdict);
        })
        .catch((e) => {
          if (cancelled) return;
          if (String(e).includes("MODEL_NOT_DOWNLOADED")) setModelMissing(true);
          // keep ECDICT result on AI failure — already set above
        })
        .finally(() => { if (!cancelled) setTranslating(false); });
    }).catch(console.error);

    return () => { cancelled = true; };
  }, [word]);

  useEffect(() => {
    if (ecdictResult?.vocabEntry) {
      invoke<VocabSentence[]>("get_vocab_sentences", { vocabId: ecdictResult.vocabEntry.id })
        .then(setSentences)
        .catch(console.error);
    }
  }, [ecdictResult]);

  const handleSpeak = (text: string) => {
    invoke("speak_text", { text }).catch(console.error);
  };

  const handleAddToVocab = async () => {
    const definition = translation ?? ecdictResult?.definition ?? "";
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
          {ecdictResult?.vocabEntry && (
            <span style={{ color: "#34d399", fontSize: "12px", marginLeft: "10px" }}>
              {ecdictResult.vocabEntry.occurrenceCount}×
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

      {/* Translation — best of ECDICT / AI */}
      <div style={{ marginTop: "8px", background: "#1e293b", borderRadius: "6px", padding: "8px 12px", minHeight: "28px" }}>
        {translation && (
          <span style={{ color: "#cbd5e1", fontSize: "14px", lineHeight: "1.6" }}>{translation}</span>
        )}
        {translating && !translation && (
          <span style={{ color: "#64748b", fontSize: "14px" }}>翻译中…</span>
        )}
        {translating && translation && (
          <span style={{ color: "#475569", fontSize: "11px", marginLeft: "8px" }}>AI…</span>
        )}
        {modelMissing && !downloading && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "#94a3b8", fontSize: "14px" }}>AI 模型未下载 (~1.1 GB)</span>
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
            <div style={{ background: "#0f172a", borderRadius: "4px", height: "4px", width: "100%" }}>
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
        {!ecdictResult?.vocabEntry && (
          <button
            onClick={handleAddToVocab}
            style={{ background: "#1e293b", border: "1px solid #334155", color: "#94a3b8", padding: "5px 12px", borderRadius: "6px", fontSize: "12px", cursor: "pointer" }}
          >
            + Add to vocab
          </button>
        )}
        {ecdictResult?.vocabEntry && ecdictResult.vocabEntry.familiarity < 5 && (
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
