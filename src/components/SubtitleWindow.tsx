import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { AnnotatedLine, WordToken } from "../types/subtitle";
import { Token } from "./Token";

const MAX_LINES = 3;

interface Props {
  onWordClick?: (token: WordToken, sentenceText: string) => void;
  onPhraseSelect?: (phrase: string, sentenceText: string) => void;
}

export function SubtitleWindow({ onWordClick, onPhraseSelect }: Props) {
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

  const handleMouseUp = () => {
    if (!onPhraseSelect) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || text.split(/\s+/).length < 2) return;
    // Use the line's rawText instead of selection string (avoids grabbing definition text)
    const node = sel?.anchorNode;
    const lineEl = (node instanceof HTMLElement ? node : node?.parentElement)?.closest("[data-raw-text]");
    const rawText = lineEl?.getAttribute("data-raw-text") ?? "";
    onPhraseSelect(rawText || text, rawText);
    sel?.removeAllRanges();
  };

  return (
    <>
    <style>{`
      .lc-line[data-speaker]::before {
        content: attr(data-speaker);
        display: inline-block;
        background: var(--speaker-color, #64748b);
        color: #fff;
        font-size: 11px;
        font-weight: 600;
        padding: 1px 6px;
        border-radius: 4px;
        margin-right: 6px;
        line-height: 1.6;
        flex-shrink: 0;
        align-self: center;
        user-select: none;
      }
    `}</style>
    <div
      onMouseUp={handleMouseUp}
      style={{
        background: "rgba(15, 23, 42, 0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderRadius: "12px",
        border: "1px solid rgba(255,255,255,0.08)",
        padding: "14px 18px",
        minHeight: "80px",
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
            className="lc-line"
            key={line.lineId + "-" + i}
            data-raw-text={line.rawText}
            {...(line.speaker ? { "data-speaker": line.speaker } : {})}
            style={{
              lineHeight: "2.2",
              fontSize: "16px",
              color: "#e2e8f0",
              marginBottom: "2px",
              flexWrap: "wrap",
              display: "flex",
              alignItems: "flex-start",
              ...(line.speakerColor ? { "--speaker-color": line.speakerColor } as React.CSSProperties : {}),
            }}
          >
            {line.tokens.map((token, j) => (
              <Token
                key={j}
                token={token}
                onClick={onWordClick ? (t) => onWordClick(t, line.rawText) : undefined}
              />
            ))}
          </div>
        ))
      )}
      <div ref={bottomRef} />
    </div>
    </>
  );
}
