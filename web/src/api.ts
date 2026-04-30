const BASE = '/api';

export interface Meeting {
  id: number;
  title: string;
  startedAt: string;
  endedAt: string | null;
}

export interface TranscriptLine {
  id: number;
  text: string;
  timestampMs: number;
  speakerLabel: string | null;
}

export interface VocabEntry {
  id: number;
  entry: string;
  entryType: string;
  definition: string | null;
  familiarity: number;
  occurrenceCount: number;
  addedAt: string;
  masteredAt: string | null;
}

export interface VocabSentence {
  lineId: number;
  text: string;
  timestampMs: number;
  meetingId: number;
  meetingTitle: string;
}

export interface WordResult {
  definition: string | null;
  frequency: number | null;
  vocabEntry: VocabEntry | null;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const api = {
  meetings: () => get<Meeting[]>('/meetings'),
  renameMeeting: (id: number, title: string) => post<{ ok: boolean }>(`/meetings/${id}/title`, { title }),
  transcript: (id: number) => get<TranscriptLine[]>(`/meetings/${id}/transcript`),
  vocab: () => get<VocabEntry[]>('/vocab'),
  addVocab: (entry: string, definition: string, entryType = 'word') =>
    post<VocabEntry>('/vocab', { entry, definition, entryType }),
  markMastered: (id: number) => post<{ ok: boolean }>(`/vocab/${id}/master`),
  unmarkMastered: (id: number) => post<{ ok: boolean }>(`/vocab/${id}/unmaster`),
  setFamiliarity: (id: number, level: number) => post<{ ok: boolean }>(`/vocab/${id}/familiarity`, { level }),
  setDefinition: (id: number, definition: string) => post<{ ok: boolean }>(`/vocab/${id}/definition`, { definition }),
  deleteVocab: (id: number) => fetch(`/api/vocab/${id}`, { method: 'DELETE' }).then(r => r.json()) as Promise<{ ok: boolean }>,
  vocabSentences: (id: number) => get<VocabSentence[]>(`/vocab/${id}/sentences`),
  word: (word: string) => get<WordResult>(`/word/${encodeURIComponent(word)}`),
  tts: (text: string) => post<{ ok: boolean }>('/tts', { text }),
};
