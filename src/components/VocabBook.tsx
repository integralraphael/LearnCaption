import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { VocabEntry } from "../types/vocabulary";

const FAMILIARITY_COLORS = ["#ef4444", "#f97316", "#f97316", "#fbbf24", "#fbbf24", "#34d399"];

interface Props {
  onSelectEntry?: (entry: VocabEntry) => void;
}

export function VocabBook({ onSelectEntry }: Props) {
  const [entries, setEntries] = useState<VocabEntry[]>([]);

  const load = () =>
    invoke<VocabEntry[]>("list_entries").then(setEntries).catch(console.error);

  useEffect(() => { load(); }, []);

  const handleMastered = async (e: React.MouseEvent, entry: VocabEntry) => {
    e.stopPropagation();
    await invoke("mark_mastered", { id: entry.id });
    load();
  };

  return (
    <div style={{ padding: "16px" }}>
      <h2 style={{ color: "#e2e8f0", fontSize: "18px", marginBottom: "12px", fontWeight: 600 }}>
        Vocabulary Book
      </h2>
      {entries.length === 0 ? (
        <p style={{ color: "#475569" }}>No words yet. Click a highlighted word to add it.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {entries.map((entry) => (
            <div
              key={entry.id}
              onClick={() => onSelectEntry?.(entry)}
              style={{
                background: "#1e293b",
                borderRadius: "8px",
                padding: "10px 14px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                borderLeft: `3px solid ${FAMILIARITY_COLORS[entry.familiarity] ?? "#475569"}`,
              }}
            >
              <div style={{ flex: 1 }}>
                <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{entry.entry}</span>
                <span style={{ color: "#64748b", fontSize: "12px", marginLeft: "8px" }}>
                  {entry.type}
                </span>
                {entry.definition && (
                  <p style={{ color: "#94a3b8", fontSize: "13px", margin: "2px 0 0" }}>
                    {entry.definition}
                  </p>
                )}
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ color: "#64748b", fontSize: "12px" }}>
                  {entry.occurrenceCount}×
                </div>
                {entry.familiarity < 5 && (
                  <button
                    onClick={(e) => handleMastered(e, entry)}
                    style={{
                      marginTop: "4px",
                      background: "#064e3b",
                      border: "none",
                      color: "#34d399",
                      padding: "3px 8px",
                      borderRadius: "4px",
                      fontSize: "11px",
                      cursor: "pointer",
                    }}
                  >
                    Mastered
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
