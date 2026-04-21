import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { VocabEntry, WordQueryResult, VocabSentence } from "../types/vocabulary";

interface Props {
  word: string;
  onClose: () => void;
  onAddToVocab?: (entry: VocabEntry) => void;
}

export function WordDetail({ word, onClose, onAddToVocab }: Props) {
  const [result, setResult] = useState<WordQueryResult | null>(null);
  const [sentences, setSentences] = useState<VocabSentence[]>([]);

  useEffect(() => {
    setSentences([]);
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
      </div>

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
