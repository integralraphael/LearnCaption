// NOTE: All corresponding Rust structs MUST use #[serde(rename_all = "camelCase")]
// to match these camelCase field names when serialized over Tauri IPC.

export interface WordToken {
  text: string;
  definition: string | null;   // null = no annotation
  vocabId: number | null;      // null = not in vocab book
  color: "yellow" | "orange" | "red" | null;
}

export interface AnnotatedLine {
  lineId: number;
  meetingId: number;
  tokens: WordToken[];
  rawText: string;
  timestampMs: number;
  /** "new_block" | "append" | "update" */
  action: string;
}
