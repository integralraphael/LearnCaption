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
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        marginRight: "3px",
        cursor: onClick ? "pointer" : "default",
        verticalAlign: "top",
      }}
    >
      <span
        style={{
          color: color ?? "inherit",
          fontWeight: color ? 600 : "normal",
          lineHeight: "1.4",
        }}
      >
        {token.text}
      </span>
      <span
        style={{
          fontSize: "0.65em",
          color: color ?? "#94a3b8",
          lineHeight: "1.2",
          minHeight: "1.2em",
          whiteSpace: "nowrap",
        }}
      >
        {token.definition ?? ""}
      </span>
    </span>
  );
}
