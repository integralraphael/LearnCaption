import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface CalibrationWord {
  rank: number;
  word: string;
  definition: string;
  frq: number;
}

interface Props {
  onComplete: () => void;
}

const CARD_W = 96; // 90px card + 6px gap
const BATCH = 200;
const BUFFER_AHEAD = 60;

export function VocabCalibration({ onComplete }: Props) {
  const [total, setTotal] = useState(42231);
  const [words, setWords] = useState<CalibrationWord[]>([]);
  const [position, setPosition] = useState(3000);
  const [centerCardIndex, setCenterCardIndex] = useState(0); // visual split based on viewport center
  const listRef = useRef<HTMLDivElement>(null);
  const bufferStartRef = useRef(0);
  const wordsRef = useRef<CalibrationWord[]>([]);
  const loadingRef = useRef(false);
  const programmaticScroll = useRef(false);

  // Keep refs in sync
  wordsRef.current = words;

  useEffect(() => {
    invoke<number>("get_dict_total").then(setTotal);
  }, []);

  // Initial load
  useEffect(() => {
    const start = Math.max(0, 3000 - BATCH);
    invoke<CalibrationWord[]>("get_calibration_words", {
      offset: start,
      limit: BATCH * 3,
    }).then((w) => {
      bufferStartRef.current = start;
      setWords(w);
      // Scroll to position after render
      requestAnimationFrame(() => scrollToGlobal(3000));
    });
  }, []);

  const scrollToGlobal = (globalPos: number) => {
    if (!listRef.current) return;
    programmaticScroll.current = true;
    const localIndex = globalPos - bufferStartRef.current;
    const scrollLeft = localIndex * CARD_W - listRef.current.clientWidth / 2 + CARD_W / 2;
    listRef.current.scrollLeft = Math.max(0, scrollLeft);
    setCenterCardIndex(localIndex);
    requestAnimationFrame(() => { programmaticScroll.current = false; });
  };

  const loadMore = async (direction: "left" | "right") => {
    if (loadingRef.current) return;
    loadingRef.current = true;

    const bs = bufferStartRef.current;
    const wlen = wordsRef.current.length;

    if (direction === "right") {
      const nextStart = bs + wlen;
      if (nextStart >= total) { loadingRef.current = false; return; }
      const newWords = await invoke<CalibrationWord[]>("get_calibration_words", {
        offset: nextStart,
        limit: BATCH,
      });
      setWords((prev) => [...prev, ...newWords]);
    } else {
      const newStart = Math.max(0, bs - BATCH);
      if (newStart === bs) { loadingRef.current = false; return; }
      const count = bs - newStart;
      const newWords = await invoke<CalibrationWord[]>("get_calibration_words", {
        offset: newStart,
        limit: count,
      });
      const el = listRef.current;
      const oldScroll = el?.scrollLeft ?? 0;
      bufferStartRef.current = newStart;
      setWords((prev) => [...newWords, ...prev]);
      // Preserve scroll position after prepend
      requestAnimationFrame(() => {
        if (el) el.scrollLeft = oldScroll + count * CARD_W;
      });
    }
    loadingRef.current = false;
  };

  const handleScroll = () => {
    const el = listRef.current;
    if (!el || programmaticScroll.current) return;

    // Which card is at the viewport center?
    const centerScroll = el.scrollLeft + el.clientWidth / 2;
    const centerIdx = Math.min(
      Math.floor(centerScroll / CARD_W),
      wordsRef.current.length - 1
    );
    setCenterCardIndex(Math.max(0, centerIdx));

    // Sync slider from the center word's actual rank
    const centerWord = wordsRef.current[centerIdx];
    if (centerWord) setPosition(centerWord.rank);

    // Load more at edges
    const cardsFromRight = (wordsRef.current.length * CARD_W - el.scrollLeft - el.clientWidth) / CARD_W;
    const cardsFromLeft = el.scrollLeft / CARD_W;
    if (cardsFromRight < BUFFER_AHEAD) loadMore("right");
    if (cardsFromLeft < BUFFER_AHEAD) loadMore("left");
  };

  const handleSliderChange = (newPos: number) => {
    setPosition(newPos);

    const localIndex = newPos - bufferStartRef.current;
    if (localIndex >= 0 && localIndex < wordsRef.current.length) {
      scrollToGlobal(newPos);
    } else {
      // Reload around new position
      const start = Math.max(0, newPos - BATCH);
      invoke<CalibrationWord[]>("get_calibration_words", {
        offset: start,
        limit: BATCH * 3,
      }).then((w) => {
        bufferStartRef.current = start;
        setWords(w);
        requestAnimationFrame(() => scrollToGlobal(newPos));
      });
    }
  };

  const handleConfirm = async () => {
    const frqValue = splitFrq || 3000;
    await invoke("set_setting", {
      key: "ai_translate_frq_threshold",
      value: String(frqValue),
    });
    await invoke("set_setting", {
      key: "vocab_calibrated",
      value: "true",
    });
    onComplete();
  };

  // The frq of the word at the viewport center is the split threshold
  const splitFrq = words[centerCardIndex]?.frq ?? 0;

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "16px",
      height: "100%",
    }}>
      <style>{`.cal-list::-webkit-scrollbar { display: none; }`}</style>

      {/* Header */}
      <div style={{ textAlign: "center", maxWidth: "400px", marginBottom: "28px" }}>
        <h1 style={{
          color: "#e2e8f0",
          fontSize: "20px",
          fontWeight: 600,
          marginBottom: "10px",
          letterSpacing: "-0.3px",
        }}>
          词汇量校准
        </h1>
        <p style={{
          color: "#94a3b8",
          fontSize: "13px",
          lineHeight: "1.7",
        }}>
          请滑动浏览单词或拖动进度条，找到您开始不太认识的位置。分割线右侧的词将被视为生词，系统会自动为您翻译。
        </p>
      </div>

      {/* Word cards */}
      <div style={{ width: "100%", position: "relative", marginBottom: "20px" }}>
        {/* Center marker */}
        <div style={{
          position: "absolute", top: 0, bottom: 0, left: "50%",
          transform: "translateX(-50%)", width: "2px",
          background: "#f59e0b", zIndex: 10, pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", top: "-18px", left: "50%",
          transform: "translateX(-50%)", color: "#f59e0b",
          fontSize: "10px", fontWeight: 600, zIndex: 10, whiteSpace: "nowrap",
        }}>
          分割线
        </div>

        {/* Edge fades */}
        <div style={{
          position: "absolute", top: 0, bottom: 0, left: 0, width: "40px",
          background: "linear-gradient(to right, #0f172a, transparent)",
          zIndex: 5, pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", top: 0, bottom: 0, right: 0, width: "40px",
          background: "linear-gradient(to left, #0f172a, transparent)",
          zIndex: 5, pointerEvents: "none",
        }} />

        <div
          ref={listRef}
          className="cal-list"
          onScroll={handleScroll}
          style={{
            display: "flex",
            overflowX: "auto",
            gap: "6px",
            padding: "8px 0",
            scrollbarWidth: "none",
          }}
        >
          {words.map((w, i) => {
            const after = w.frq >= splitFrq;
            return (
              <div
                key={`${bufferStartRef.current + i}-${w.word}`}
                style={{
                  flexShrink: 0,
                  width: "90px",
                  boxSizing: "border-box",
                  padding: "10px 8px",
                  borderRadius: "10px",
                  textAlign: "center",
                  background: after ? "rgba(245,158,11,0.12)" : "#1e293b",
                  border: `1px solid ${after ? "rgba(245,158,11,0.35)" : "#334155"}`,
                }}
              >
                <div style={{
                  color: after ? "#fbbf24" : "#e2e8f0",
                  fontSize: "13px",
                  fontWeight: 600,
                  marginBottom: "4px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {w.word}
                </div>
                <div style={{
                  color: after ? "#b45309" : "#64748b",
                  fontSize: "10px",
                  lineHeight: "1.4",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {w.definition}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Slider */}
      <div style={{ width: "100%", maxWidth: "400px", marginBottom: "8px" }}>
        <input
          type="range"
          min={0}
          max={total - 1}
          value={position}
          onChange={(e) => handleSliderChange(parseInt(e.target.value, 10))}
          style={{ width: "100%", accentColor: "#f59e0b", height: "4px" }}
        />
      </div>

      {/* Position info */}
      <div style={{
        color: "#64748b", fontSize: "12px", marginBottom: "24px",
        display: "flex", justifyContent: "space-between",
        width: "100%", maxWidth: "400px",
      }}>
        <span>常见</span>
        <span>第 {position + 1} / {total} 词</span>
        <span>生僻</span>
      </div>

      {/* Confirm */}
      <button
        onClick={handleConfirm}
        style={{
          background: "#f59e0b", color: "#0f172a", border: "none",
          borderRadius: "10px", padding: "10px 32px", fontSize: "14px",
          fontWeight: 600, cursor: "pointer", letterSpacing: "-0.2px",
        }}
      >
        确认词汇水平
      </button>
    </div>
  );
}
