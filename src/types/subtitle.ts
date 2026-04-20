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
}
