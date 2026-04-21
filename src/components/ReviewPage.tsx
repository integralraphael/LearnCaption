import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Meeting, TranscriptLine } from "../types/vocabulary";
import { WordDetail } from "./WordDetail";

export function ReviewPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [activeWord, setActiveWord] = useState<string | null>(null);

  useEffect(() => {
    invoke<Meeting[]>("list_meetings").then(setMeetings).catch(console.error);
  }, []);

  const openMeeting = async (meeting: Meeting) => {
    setSelected(meeting);
    setActiveWord(null);
    try {
      const transcript = await invoke<TranscriptLine[]>("get_transcript", { meetingId: meeting.id });
      setLines(transcript);
    } catch (e) {
      console.error("get_transcript failed:", e);
    }
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString();

  return (
    <div style={{ padding: "16px", display: "flex", gap: "16px", height: "100%" }}>
      {/* Meeting list */}
      <div style={{ width: "220px", flexShrink: 0 }}>
        <h2 style={{ color: "#e2e8f0", fontSize: "16px", fontWeight: 600, marginBottom: "10px" }}>
          Meetings
        </h2>
        {meetings.length === 0 ? (
          <p style={{ color: "#475569", fontSize: "13px" }}>No meetings yet.</p>
        ) : (
          meetings.map((m) => (
            <div
              key={m.id}
              onClick={() => openMeeting(m)}
              style={{
                background: selected?.id === m.id ? "#1e3a5f" : "#1e293b",
                borderRadius: "8px",
                padding: "10px",
                marginBottom: "6px",
                cursor: "pointer",
                borderLeft: selected?.id === m.id ? "3px solid #60a5fa" : "3px solid transparent",
              }}
            >
              <div style={{ color: "#e2e8f0", fontSize: "13px", fontWeight: 500 }}>{m.title}</div>
              <div style={{ color: "#64748b", fontSize: "11px", marginTop: "2px" }}>
                {formatTime(m.startedAt)}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Transcript */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {selected ? (
          <>
            <h3 style={{ color: "#e2e8f0", fontSize: "16px", marginBottom: "10px" }}>
              {selected.title}
            </h3>
            {lines.map((line) => (
              <p
                key={line.id}
                style={{ color: "#cbd5e1", fontSize: "14px", lineHeight: "1.8", marginBottom: "4px", cursor: "text" }}
              >
                {line.text.split(/\b/).map((word, i) =>
                  /\w+/.test(word) ? (
                    <span
                      key={i}
                      onClick={() => setActiveWord(word.toLowerCase())}
                      style={{ cursor: "pointer", borderBottom: "1px dashed #334155" }}
                    >
                      {word}
                    </span>
                  ) : word
                )}
              </p>
            ))}
          </>
        ) : (
          <p style={{ color: "#475569", fontSize: "14px" }}>Select a meeting to review.</p>
        )}
      </div>

      {/* Word detail panel */}
      {activeWord && (
        <div style={{ width: "320px", flexShrink: 0 }}>
          <WordDetail
            word={activeWord}
            onClose={() => setActiveWord(null)}
          />
        </div>
      )}
    </div>
  );
}
