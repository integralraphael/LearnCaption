interface Props {
  /** 0..1 fraction of how far down the user has scrolled */
  scrollFraction: number;
  /** 0..1 fraction of viewport relative to total content height */
  thumbSize: number;
  /** True when user is not at the bottom */
  showJump: boolean;
  onJumpToLatest: () => void;
}

export function ScrollColumn({ scrollFraction, thumbSize, showJump, onJumpToLatest }: Props) {
  const thumbHeight = Math.max(thumbSize * 100, 10); // minimum 10% so it's visible
  const thumbTop = scrollFraction * (100 - thumbHeight);

  return (
    <div
      style={{
        width: "32px",
        borderLeft: "1px solid rgba(255,255,255,0.04)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "8px 2px",
        flexShrink: 0,
        gap: "6px",
      }}
    >
      {/* Scroll track */}
      <div
        style={{
          flex: 1,
          width: "4px",
          background: "rgba(255,255,255,0.04)",
          borderRadius: "2px",
          position: "relative",
        }}
      >
        {/* Thumb */}
        <div
          style={{
            position: "absolute",
            top: `${thumbTop}%`,
            width: "4px",
            height: `${thumbHeight}%`,
            background: "rgba(255,255,255,0.15)",
            borderRadius: "2px",
            transition: "top 0.1s",
          }}
        />
      </div>

      {/* Jump to latest */}
      {showJump && (
        <button
          onClick={onJumpToLatest}
          style={{
            width: "24px",
            height: "24px",
            borderRadius: "6px",
            background: "rgba(96,165,250,0.2)",
            border: "1px solid rgba(96,165,250,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#60a5fa",
            fontSize: "11px",
            cursor: "pointer",
            flexShrink: 0,
            padding: 0,
          }}
          title="回到最新"
        >
          ↓
        </button>
      )}
    </div>
  );
}
