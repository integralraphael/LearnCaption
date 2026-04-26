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

  return (
    <span
      onClick={() => onClick?.(token)}
      style={{
        position: isStagger ? "relative" : undefined,
        display: isStagger ? "inline-block" : "inline",
        marginRight: "3px",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {/* data-vocab-idx marks this as a measurable vocab token for the 2-track layout */}
      <span
        data-vocab-idx={isStagger && token.definition ? vocabIndex : undefined}
        style={{ color: color ?? "inherit", fontWeight: color ? 600 : "normal" }}
      >
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
          // below_stagger: parent SubtitleLine positions via useLayoutEffect (2-track algorithm)
          <span
            data-trans-idx={vocabIndex}
            style={{
              position: "absolute",
              left: 0,
              top: "calc(100% + 2px)", // overridden by SubtitleLine's useLayoutEffect
              fontSize: "0.65em",
              color: color ?? "#94a3b8",
              lineHeight: "1.2",
              whiteSpace: "nowrap",
              pointerEvents: "none",
              visibility: "hidden", // shown after positioning to prevent flash
            }}
          >
            {token.definition}
          </span>
        )
      )}
    </span>
  );
}
