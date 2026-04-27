import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AnnotatedLine, WordToken } from "../types/subtitle";
import { Token } from "./Token";
import { useDisplaySettings } from "../contexts/DisplaySettings";

// ── 2-track below-stagger layout ────────────────────────────────────────────
// Renders the token row for one subtitle line.
// In below_stagger mode, translations are positioned via useLayoutEffect
// using a greedy 2-row algorithm: try row 0, fall back to row 1 if overlap,
// never introduce a third row.
interface SubtitleLineProps {
  tokens: AnnotatedLine["tokens"];
  rawText: string;
  onWordClick?: (token: WordToken, rawText: string) => void;
}

function SubtitleLine({ tokens, rawText, onWordClick }: SubtitleLineProps) {
  const ref = useRef<HTMLDivElement>(null);
  const config = useDisplaySettings();
  const isStagger = config.translationPosition === "below_stagger";

  useLayoutEffect(() => {
    if (!ref.current) return;
    const el = ref.current;

    if (!isStagger) return;

    const vocabTokenEls = Array.from(el.querySelectorAll<HTMLElement>("[data-vocab-idx]"));
    if (vocabTokenEls.length === 0) {
      el.style.paddingBottom = "";
      return;
    }

    const lineRect = el.getBoundingClientRect();
    // right edge (relative to line left) of last translation placed in each row
    const rowRightEdge = [0, 0];
    // px from token bottom to top of each row
    const ROW_OFFSET = [2, 15]; // row0: 2px gap, row1: 2px + ~13px line height
    let maxRowUsed = 0;

    vocabTokenEls.forEach((tokenEl) => {
      const idx = tokenEl.getAttribute("data-vocab-idx");
      const transEl = el.querySelector<HTMLElement>(`[data-trans-idx="${idx}"]`);
      if (!transEl) return;

      const tokenX = tokenEl.getBoundingClientRect().left - lineRect.left;
      const transW = transEl.getBoundingClientRect().width;

      // Try row 0 first, then row 1
      let chosenRow = -1;
      for (const r of [0, 1]) {
        if (tokenX >= rowRightEdge[r]) { chosenRow = r; break; }
      }
      // Both rows overlap — pick the one that frees up sooner (smaller right edge)
      if (chosenRow === -1) chosenRow = rowRightEdge[0] <= rowRightEdge[1] ? 0 : 1;

      rowRightEdge[chosenRow] = tokenX + transW + 4;
      if (chosenRow > maxRowUsed) maxRowUsed = chosenRow;
      transEl.style.top = `calc(100% + ${ROW_OFFSET[chosenRow]}px)`;
      transEl.style.visibility = "visible";
    });

    // Reserve only as much space as actually used: 1 row ≈ 16px, 2 rows ≈ 30px
    el.style.paddingBottom = maxRowUsed === 0 ? "16px" : "30px";
  });

  let vocabCount = 0;
  return (
    <div
      ref={ref}
      className="lc-line"
      style={{
        lineHeight: "2.2",
        fontSize: "14px",
        color: "#e2e8f0",
        flexWrap: "wrap",
        display: "flex",
        alignItems: "flex-start",
        // paddingBottom set dynamically by useLayoutEffect based on rows actually used
      }}
    >
      {tokens.map((token, j) => {
        const vi = token.definition ? vocabCount++ : 0;
        return (
          <Token
            key={j}
            token={token}
            vocabIndex={vi}
            onClick={onWordClick ? (t) => onWordClick(t, rawText) : undefined}
          />
        );
      })}
    </div>
  );
}
// ────────────────────────────────────────────────────────────────────────────

interface Props {
  onWordClick?: (token: WordToken, sentenceText: string) => void;
  onPhraseSelect?: (phrase: string, sentenceText: string) => void;
  /** Called on scroll changes so parent can drive ScrollColumn */
  onScrollState?: (state: { fraction: number; thumbSize: number; atBottom: boolean }) => void;
}

export function SubtitleWindow({ onWordClick, onPhraseSelect, onScrollState }: Props) {
  const [lines, setLines] = useState<AnnotatedLine[]>([]);
  const [lineTranslations, setLineTranslations] = useState<Map<number, string>>(new Map());
  // Overrides for auto-translated token definitions (ECDICT replaced by shorter AI result)
  // Key: `${lineId}-${tokenIdx}`
  const [tokenOverrides, setTokenOverrides] = useState<Map<string, string>>(new Map());
  const translatedIdsRef = useRef<Set<number>>(new Set());
  const translatedTokensRef = useRef<Set<string>>(new Set());
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
          case "update": {
            if (prev.length === 0) return [incoming];
            const last = prev[prev.length - 1];
            // Preserve speaker from previous state if not present in partial update
            const merged = incoming.speaker
              ? incoming
              : { ...incoming, speaker: last.speaker, speakerColor: last.speakerColor };
            return [...prev.slice(0, -1), merged];
          }
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

  // Auto-translate AI refinement: for tokens annotated from ECDICT (not vocab book),
  // fire AI translation concurrently and replace with the shorter result.
  // Runs on the previously finalized line (same timing as sentence translation).
  useEffect(() => {
    if (lines.length < 2) return;
    const prevLine = lines[lines.length - 2];
    prevLine.tokens.forEach((token, tokenIdx) => {
      // Auto-translated token: has ECDICT definition but no vocab book color/id
      if (!token.definition || token.color !== null || token.vocabId !== null) return;
      const key = `${prevLine.lineId}-${tokenIdx}`;
      if (translatedTokensRef.current.has(key)) return;
      translatedTokensRef.current.add(key);
      const ecdict = token.definition;
      const word = token.text.replace(/[^a-zA-Z'-]/g, "");
      if (!word) return;
      // Pass context: null so AI translates the word itself, not the whole sentence.
      // With sentence context, AI often translates the full sentence for simple words.
      invoke<string>("translate_selection", { selection: word, context: null })
        .then((ai) => {
          if (ai.length < ecdict.length) {
            setTokenOverrides((prev) => new Map(prev).set(key, ai));
          }
        })
        .catch(() => {}); // silently ignore
    });
  }, [lines.length]);

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
      <style>{`.lc-subtitle-area::-webkit-scrollbar { display: none; }`}</style>
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
            <div
              key={line.lineId + "-" + i}
              data-raw-text={line.rawText}
              style={{ display: "flex", alignItems: "flex-start", marginBottom: "4px" }}
            >
              {/* Speaker badge — own column */}
              {line.speaker && (
                <span style={{
                  flexShrink: 0,
                  alignSelf: "flex-start",
                  marginTop: "6px",
                  marginRight: "6px",
                  background: line.speakerColor ?? "#64748b",
                  color: "#fff",
                  fontSize: "11px",
                  fontWeight: 600,
                  padding: "1px 6px",
                  borderRadius: "4px",
                  lineHeight: "1.6",
                  userSelect: "none",
                  whiteSpace: "nowrap",
                }}>
                  {line.speaker}
                </span>
              )}

              {/* English tokens + Chinese translation, left-aligned together */}
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <SubtitleLine
                  tokens={line.tokens.map((t, idx) => {
                    if (!t.definition || t.color !== null || t.vocabId !== null) return t;
                    const override = tokenOverrides.get(`${line.lineId}-${idx}`);
                    return override ? { ...t, definition: override } : t;
                  })}
                  rawText={line.rawText}
                  onWordClick={onWordClick}
                />
                {lineTranslations.get(line.lineId) && (
                  <div style={{
                    fontSize: "12px",
                    color: "#64748b",
                    lineHeight: "1.6",
                    marginTop: "-4px",
                  }}>
                    {lineTranslations.get(line.lineId)}
                  </div>
                )}
              </div>
            </div>
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
