import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface CalibrationWord {
  word: string;
  definition: string;
  frq: number;
}

interface Props {
  onComplete: () => void;
}

const VISIBLE_COUNT = 50;

export function VocabCalibration({ onComplete }: Props) {
  const [total, setTotal] = useState(42231);
  const [position, setPosition] = useState(3000);
  const [words, setWords] = useState<CalibrationWord[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<number>("get_dict_total").then(setTotal);
  }, []);

  useEffect(() => {
    const offset = Math.max(0, position - Math.floor(VISIBLE_COUNT / 2));
    invoke<CalibrationWord[]>("get_calibration_words", {
      offset,
      limit: VISIBLE_COUNT,
    }).then(setWords);
  }, [position]);

  // Scroll to center when words load
  useEffect(() => {
    if (listRef.current && words.length > 0) {
      const center = listRef.current.children[Math.floor(VISIBLE_COUNT / 2)] as HTMLElement;
      center?.scrollIntoView({ inline: "center", behavior: "instant" });
    }
  }, [words]);

  const handleConfirm = async () => {
    const frqValue = words[Math.floor(VISIBLE_COUNT / 2)]?.frq ?? 3000;
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

  const midIndex = Math.floor(VISIBLE_COUNT / 2);

  return (
    <div style={{
      background: "#0f172a",
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px 16px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
    }}>
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
          为了更好地为您标注生词和提供翻译，请拖动下方滑块，找到您开始不太认识的词汇位置。分割线右侧的词将被视为生词。
        </p>
      </div>

      {/* Word cards */}
      <div style={{
        width: "100%",
        position: "relative",
        marginBottom: "20px",
      }}>
        {/* Center marker */}
        <div style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: "2px",
          background: "#f59e0b",
          zIndex: 10,
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute",
          top: "-18px",
          left: "50%",
          transform: "translateX(-50%)",
          color: "#f59e0b",
          fontSize: "10px",
          fontWeight: 600,
          zIndex: 10,
          whiteSpace: "nowrap",
        }}>
          分割线
        </div>

        <div
          ref={listRef}
          style={{
            display: "flex",
            overflowX: "auto",
            gap: "6px",
            padding: "8px 0",
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          }}
        >
          {words.map((w, i) => {
            const isRight = i >= midIndex;
            return (
              <div
                key={w.frq + w.word}
                style={{
                  flexShrink: 0,
                  width: "90px",
                  padding: "10px 8px",
                  borderRadius: "10px",
                  background: isRight ? "rgba(245,158,11,0.08)" : "#1e293b",
                  border: `1px solid ${isRight ? "rgba(245,158,11,0.2)" : "#334155"}`,
                  textAlign: "center",
                  transition: "background 0.15s, border-color 0.15s",
                }}
              >
                <div style={{
                  color: isRight ? "#fbbf24" : "#e2e8f0",
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
                  color: "#64748b",
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
          onChange={(e) => setPosition(parseInt(e.target.value, 10))}
          style={{
            width: "100%",
            accentColor: "#f59e0b",
            height: "4px",
          }}
        />
      </div>

      {/* Position info */}
      <div style={{
        color: "#64748b",
        fontSize: "12px",
        marginBottom: "24px",
        display: "flex",
        justifyContent: "space-between",
        width: "100%",
        maxWidth: "400px",
      }}>
        <span>常见</span>
        <span>第 {position + 1} / {total} 词</span>
        <span>生僻</span>
      </div>

      {/* Confirm button */}
      <button
        onClick={handleConfirm}
        style={{
          background: "#f59e0b",
          color: "#0f172a",
          border: "none",
          borderRadius: "10px",
          padding: "10px 32px",
          fontSize: "14px",
          fontWeight: 600,
          cursor: "pointer",
          letterSpacing: "-0.2px",
        }}
      >
        确认词汇水平
      </button>
    </div>
  );
}
