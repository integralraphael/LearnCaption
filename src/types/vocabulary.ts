export interface VocabEntry {
  id: number;
  entry: string;
  type: "word" | "phrase" | "idiom";
  definition: string | null;
  familiarity: number; // 0–5
  occurrenceCount: number;
  addedAt: string;
  masteredAt: string | null;
}

export interface Meeting {
  id: number;
  title: string;
  startedAt: string;
  endedAt: string | null;
}

export interface TranscriptLine {
  id: number;
  meetingId: number;
  text: string;
  timestampMs: number;
}

export interface WordQueryResult {
  definition: string | null;
  frequency: number | null;
  vocabEntry: VocabEntry | null;
}

export interface VocabSentence {
  lineId: number;
  text: string;
  timestampMs: number;
  meetingId: number;
  meetingTitle: string;
}
