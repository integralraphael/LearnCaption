import type { WordToken } from "../types/subtitle";

const COLOR_MAP: Record<"yellow" | "orange" | "red", string> = {
  yellow: "#fbbf24",
  orange: "#f97316",
  red:    "#ef4444",
};

interface Props {
  token: WordToken;
  onClick?: (token: WordToken) => void;
}

export function Token({ token, onClick }: Props) {
  const color = token.color ? COLOR_MAP[token.color] : undefined;

  return (
    <span
      onClick={() => onClick?.(token)}
      style={{
        display: "inline",
        marginRight: "3px",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <span
        style={{
          color: color ?? "inherit",
          fontWeight: color ? 600 : "normal",
        }}
      >
        {token.text}
      </span>
      {token.definition && (
        <span
          style={{
            fontSize: "0.7em",
            color: color ? color + "bb" : "#64748b",
            marginLeft: "2px",
          }}
        >
          {token.definition}
        </span>
      )}
    </span>
  );
}
