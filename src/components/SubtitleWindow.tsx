import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AnnotatedLine, WordToken } from "../types/subtitle";
import { Token } from "./Token";
import { useDisplaySettings } from "../contexts/DisplaySettings";

interface Props {
  onWordClick?: (token: WordToken, sentenceText: string) => void;
  onPhraseSelect?: (phrase: string, sentenceText: string) => void;
  /** Called on scroll changes so parent can drive ScrollColumn */
  onScrollState?: (state: { fraction: number; thumbSize: number; atBottom: boolean }) => void;
}

export function SubtitleWindow({ onWordClick, onPhraseSelect, onScrollState }: Props) {
  const [lines, setLines] = useState<AnnotatedLine[]>([]);
  const [lineTranslations, setLineTranslations] = useState<Map<number, string>>(new Map());
  const translatedIdsRef = useRef<Set<number>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const autoFollowRef = useRef(true);
  const config = useDisplaySettings();

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
            return [...prev.slice(0, -1), incoming];
          case "new_block":
          case "append":
          default:
            return [...prev, incoming];
        }
      });
    }).then((f) => { unlistenFn = f; });
    return () => {
      active = false;
      unlistenFn?.();
    };
  }, []);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (autoFollowRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
    reportScroll();
  }, [lines]);

  // Sentence translation: when a new line appears, translate the previous (now finalized) line
  useEffect(() => {
    if (!config.sentenceTranslation || lines.length < 2) return;
    const prevLine = lines[lines.length - 2];
    if (translatedIdsRef.current.has(prevLine.lineId)) return;
    translatedIdsRef.current.add(prevLine.lineId);
    invoke<string>("translate_selection", { selection: prevLine.rawText, context: null })
      .then((t) => setLineTranslations((prev) => new Map(prev).set(prevLine.lineId, t)))
      .catch(() => {}); // silently ignore (model not downloaded etc.)
  }, [lines.length, config.sentenceTranslation]);

  const reportScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el || !onScrollState) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const maxScroll = scrollHeight - clientHeight;
    const atBottom = maxScroll <= 0 || scrollTop >= maxScroll - 5;
    onScrollState({
      fraction: maxScroll > 0 ? scrollTop / maxScroll : 1,
      thumbSize: scrollHeight > 0 ? clientHeight / scrollHeight : 1,
      atBottom,
    });
  }, [onScrollState]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const maxScroll = scrollHeight - clientHeight;
    const atBottom = maxScroll <= 0 || scrollTop >= maxScroll - 5;
    autoFollowRef.current = atBottom;
    reportScroll();
  };

  const handleMouseUp = () => {
    if (!onPhraseSelect) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || text.split(/\s+/).length < 2) return;
    const node = sel?.anchorNode;
    const lineEl = (node instanceof HTMLElement ? node : node?.parentElement)?.closest("[data-raw-text]");
    const rawText = lineEl?.getAttribute("data-raw-text") ?? "";
    onPhraseSelect(text, rawText);
    sel?.removeAllRanges();
  };

  /** Called by parent to jump to latest */
  const jumpToLatest = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      autoFollowRef.current = true;
      reportScroll();
    }
  }, [reportScroll]);

  // Listen for external jump-to-latest requests
  useEffect(() => {
    const handler = () => jumpToLatest();
    window.addEventListener("lc-jump-to-latest", handler);
    return () => window.removeEventListener("lc-jump-to-latest", handler);
  }, [jumpToLatest]);


  return (
    <>
      <style>{`
        .lc-subtitle-area::-webkit-scrollbar { display: none; }
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
        ref={containerRef}
        className="lc-subtitle-area"
        onScroll={handleScroll}
        onMouseUp={handleMouseUp}
        style={{
          flex: 1,
          overflowY: "auto",
          scrollbarWidth: "none",
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Spacer pushes content to bottom when lines are few */}
        <div style={{ flex: 1 }} />
        {lines.length === 0 ? (
          <span style={{ color: "#334155", fontSize: "13px", textAlign: "center" }}>
            等待开始录制…
          </span>
        ) : (
          lines.map((line, i) => (
            <React.Fragment key={line.lineId + "-" + i}>
            <div
              className="lc-line"
              data-raw-text={line.rawText}
              {...(line.speaker ? { "data-speaker": line.speaker } : {})}
              style={{
                lineHeight: "2.2",
                fontSize: "14px",
                color: "#e2e8f0",
                marginBottom: "2px",
                flexWrap: "wrap",
                display: "flex",
                alignItems: "flex-start",
                ...(line.speakerColor
                  ? ({ "--speaker-color": line.speakerColor } as React.CSSProperties)
                  : {}),
              }}
            >
              {(() => {
                let vocabCount = 0;
                return line.tokens.map((token, j) => {
                  const vi = token.definition ? vocabCount++ : 0;
                  return (
                    <Token
                      key={j}
                      token={token}
                      vocabIndex={vi}
                      onClick={onWordClick ? (t) => onWordClick(t, line.rawText) : undefined}
                    />
                  );
                });
              })()}
            </div>
            {lineTranslations.get(line.lineId) && (
              <div style={{
                fontSize: "12px",
                color: "#64748b",
                lineHeight: "1.6",
                marginBottom: "4px",
                marginTop: "-2px",
              }}>
                {lineTranslations.get(line.lineId)}
              </div>
            )}
            </React.Fragment>
          ))
        )}
      </div>
    </>
  );
}

// Export a helper that dispatches an event to trigger jumpToLatest (which resets autoFollow)
export function jumpSubtitleToLatest() {
  window.dispatchEvent(new Event("lc-jump-to-latest"));
}
