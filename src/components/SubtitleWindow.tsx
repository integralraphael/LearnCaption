import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { AnnotatedLine, WordToken } from "../types/subtitle";
import { Token } from "./Token";

const MAX_LINES = 3;

interface Props {
  onWordClick?: (token: WordToken) => void;
}

export function SubtitleWindow({ onWordClick }: Props) {
  const [lines, setLines] = useState<AnnotatedLine[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let unlistenFn: (() => void) | undefined;
    listen<AnnotatedLine>("subtitle-line", (e) => {
      if (!active) return;
      const incoming = e.payload;
      setLines((prev) => {
        switch (incoming.action) {
          case "update":
            if (prev.length === 0) return [incoming];
            // Replace the last line (ASR revision of same sentence)
            return [...prev.slice(0, -1), incoming];
          case "new_block":
          case "append":
          default:
            // Add a new line
            return [...prev, incoming].slice(-MAX_LINES);
        }
      });
    }).then((f) => { unlistenFn = f; });
    return () => {
      active = false;
      unlistenFn?.();
    };
  }, []);

  useEffect(() => {
    if (lines.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines]);

  return (
    <div
      style={{
        background: "rgba(15, 23, 42, 0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderRadius: "12px",
        border: "1px solid rgba(255,255,255,0.08)",
        padding: "14px 18px",
        minHeight: "80px",
        userSelect: "none",
      }}
      data-tauri-drag-region
    >
      {lines.length === 0 ? (
        <span style={{ color: "#475569", fontSize: "14px" }}>
          Listening…
        </span>
      ) : (
        lines.map((line, i) => (
          <div
            key={line.lineId + "-" + i}
            style={{
              lineHeight: "2.2",
              fontSize: "16px",
              color: "#e2e8f0",
              marginBottom: "2px",
              flexWrap: "wrap",
              display: "flex",
              alignItems: "flex-start",
            }}
          >
            {line.tokens.map((token, j) => (
              <Token
                key={j}
                token={token}
                onClick={onWordClick}
              />
            ))}
          </div>
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}
