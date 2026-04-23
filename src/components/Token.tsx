import type { WordToken } from "../types/subtitle";
import { useDisplaySettings } from "../contexts/DisplaySettings";

interface Props {
  token: WordToken;
  onClick?: (token: WordToken) => void;
  /** Index among vocab tokens in this line (for stagger positioning) */
  vocabIndex?: number;
}

export function Token({ token, onClick, vocabIndex = 0 }: Props) {
  const config = useDisplaySettings();

  const getColor = (): string | undefined => {
    if (!token.color) return undefined;
    if (config.colorMode === "single") return config.colorSingle;
    const map = { yellow: config.colorEasy, orange: config.colorMedium, red: config.colorHard };
    return map[token.color as "yellow" | "orange" | "red"] ?? config.colorSingle;
  };

  const color = getColor();
  const pos = config.translationPosition;
  const isStagger = pos === "below_stagger";
  const staggerOffset = isStagger ? (vocabIndex % 2) * 16 : 0;

  return (
    <span
      onClick={() => onClick?.(token)}
      style={{
        position: isStagger ? "relative" : undefined,
        display: isStagger ? "inline-block" : "inline",
        marginRight: "3px",
        cursor: onClick ? "pointer" : "default",
        // Extra bottom padding so staggered labels don't overlap next line
        paddingBottom: isStagger && token.definition
          ? `${staggerOffset + 16}px`
          : undefined,
      }}
    >
      <span style={{ color: color ?? "inherit", fontWeight: color ? 600 : "normal" }}>
        {token.text}
      </span>

      {token.definition && pos !== "none" && (
        pos === "inline_bracket" ? (
          <span style={{
            fontSize: "0.7em",
            color: color ? color + "bb" : "#64748b",
            marginLeft: "2px",
          }}>
            [{token.definition}]
          </span>
        ) : (
          // below_stagger: absolute, alternating offsets
          <span style={{
            position: "absolute",
            left: 0,
            top: `calc(100% + ${staggerOffset}px)`,
            fontSize: "0.65em",
            color: color ?? "#94a3b8",
            lineHeight: "1.2",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}>
            {token.definition}
          </span>
        )
      )}
    </span>
  );
}
