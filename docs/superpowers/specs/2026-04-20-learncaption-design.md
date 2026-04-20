# LearnCaption — Design Spec

**Date:** 2026-04-20  
**Status:** Approved

## Overview

LearnCaption is a macOS desktop app that helps non-native English speakers keep up in meetings (Google Meet, Zoom, Teams) by showing real-time bilingual subtitles with inline vocabulary annotations. After a meeting, users can review the transcript, look up words in context, and build a personal vocabulary book.

---

## MVP Scope

Two features shipped together:

1. **Real-time subtitles** — capture system audio + microphone, transcribe to English, annotate difficult/known vocabulary words with inline Chinese definitions
2. **Vocabulary highlighting** — words from the user's vocab book are highlighted in subtitles with color intensity proportional to occurrence frequency

Post-meeting review (transcript + vocab lookup + TTS) is part of the same MVP.

Out of scope for MVP: speaker diarization, AI idiom/phrase suggestions, Windows support.

---

## Architecture

**Framework:** Tauri (Rust backend + React/TypeScript frontend)  
**Platform:** macOS first (ScreenCaptureKit), Windows to follow later

```
React Frontend  ←→  Tauri IPC  ←→  Rust Backend
```

### Frontend (React + TypeScript)
- Floating draggable subtitle window (always-on-top)
- Vocabulary book UI
- Post-meeting review page
- TTS playback button

### Backend (Rust)
- Audio capture engine (ScreenCaptureKit via Swift sidecar)
- faster-whisper STT (Python sidecar, small model + VAD)
- ECDICT dictionary — loaded into memory HashMap at startup (~30-40MB RAM)
- SQLite database (via tauri-plugin-sql)
- AVSpeechSynthesizer TTS (via Swift sidecar)

### IPC Events / Commands
| Direction | Type | Purpose |
|-----------|------|---------|
| Backend → Frontend | event `subtitle-line` | Push new transcribed + annotated line |
| Frontend → Backend | command `query-word` | Look up word definition + vocab status |
| Frontend → Backend | command `add-to-vocab` | Mark word as unknown |
| Frontend → Backend | command `mark-mastered` | Set familiarity = 5 |
| Frontend → Backend | command `speak-text` | Trigger AVSpeechSynthesizer |

---

## Audio Pipeline

```
System Audio + Mic
      ↓
ScreenCaptureKit (Swift sidecar)   — macOS 13+ API, captures mixed audio
      ↓
faster-whisper (Python sidecar)    — small model, VAD-triggered inference
      ↓                              target latency: ~1.5s end-to-end
Word-level annotation (Rust)       — ECDICT lookup + vocab status check
      ↓
IPC event → React subtitle render
```

**Chunking strategy:** VAD (Voice Activity Detection) detects end-of-phrase and triggers inference immediately, rather than waiting for a fixed time window. This keeps latency at ~1.5s on Apple Silicon.

**Model:** faster-whisper `small` — same accuracy as OpenAI whisper.cpp small, 2-4x faster inference via CTranslate2 INT8 quantization. No quality trade-off.

---

## Dictionary

**Source:** [ECDICT](https://github.com/skywind3000/ECDICT) — open-source English-Chinese dictionary, ~3.5M entries, distributed as a SQLite file (~50MB). Covers CET4/6, TOEFL, GRE, business English. MIT license, bundled with the app.

**Lookup strategy — in-memory HashMap:**

At app startup, Rust loads ~100k common entries from the ECDICT SQLite file into a `HashMap<String, String>` (entry → definition). Memory cost: ~30-40MB. All real-time subtitle annotation queries hit this HashMap — O(1) lookup, nanosecond latency, zero disk I/O during meetings.

Rare words not in the HashMap fall back to an async SQLite query (does not block subtitle rendering).

**Aho-Corasick automaton (for user vocabulary):**

The user's `vocabulary` table (their personal words + phrases) is loaded separately into an Aho-Corasick automaton at startup and rebuilt whenever the vocabulary changes. This enables simultaneous multi-pattern matching across all user entries — both single words and multi-word phrases — in a single O(n) pass over the subtitle text. Longest-match-wins semantics ensure phrases suppress their contained words.

---

## Subtitle Window UI

- Floating card, semi-transparent frosted glass effect
- User can drag to any screen position
- Each word rendered as an inline flex unit: English word on top, Chinese definition directly below (same column)
- Only annotated words show Chinese text; unannotated words reserve the same line height (no layout shift)

**Annotation logic:**
- Entries can be single words or multi-word phrases/idioms
- Show definition for entries that are: (a) in the user's vocab book, OR (b) estimated above the user's vocabulary level
- Phrase entries take priority over contained word entries (longest-match-wins — see Data Model)
- Do not annotate common/known words

**Vocabulary level estimation:**
- Map the user's vocab book entries against word-frequency tiers (CET4 / CET6 / TOEFL / GRE)
- Infer upper bound of user's vocabulary level from which tier their unknown words fall in
- Words above that tier threshold are auto-annotated as difficult

**Highlight color by occurrence frequency:**
| State | Color | Condition |
|-------|-------|-----------|
| AI-detected difficult | Yellow | First appearance, not in vocab book |
| Vocab book (low freq) | Orange | In vocab book, seen 2–4 times |
| Vocab book (high freq) | Red | In vocab book, seen 5+ times |
| Mastered | None | familiarity = 5 |

---

## Data Model (SQLite)

### `meetings`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| title | TEXT | User-editable label |
| started_at | DATETIME | |
| ended_at | DATETIME | |
| audio_path | TEXT | Local file path |

### `transcript_lines`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| meeting_id | INTEGER FK | → meetings |
| text | TEXT | English sentence from Whisper |
| timestamp_ms | INTEGER | Offset from meeting start |
| speaker_label | TEXT | Null in MVP; reserved for diarization |

### `vocabulary`
Renamed from `words` — entries can be single words, phrases, or idioms.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| entry | TEXT UNIQUE | The word or phrase, e.g. `"leverage"` or `"look forward to"` |
| type | TEXT | `'word'` \| `'phrase'` \| `'idiom'` |
| definition | TEXT | From ECDICT, or user-entered for phrases |
| familiarity | INTEGER | 0 = unknown → 5 = mastered |
| occurrence_count | INTEGER | Total across all meetings |
| added_at | DATETIME | |
| mastered_at | DATETIME | Set when familiarity reaches 5 |

### `vocab_sentences`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| vocab_id | INTEGER FK | → vocabulary.id |
| line_id | INTEGER FK | → transcript_lines.id |
| meeting_id | INTEGER FK | → meetings.id (for fast filtering) |
| created_at | DATETIME | |

**Index:** `vocab_sentences(vocab_id)` — ensures sub-millisecond lookup of all sentences for an entry.

### Phrase vs Word matching priority

When annotating a subtitle line, matching uses **Aho-Corasick multi-pattern search** with **longest-match-wins** semantics:

- All `vocabulary` entries (words and phrases) are loaded into the Aho-Corasick automaton at startup
- When a phrase match (e.g. `"look forward to"`) overlaps with a word match (e.g. `"forward"`), the phrase wins and the word is suppressed
- Each token position can only belong to one annotation — no nested or overlapping highlights
- This ensures the user sees the most meaningful annotation, not redundant sub-matches

---

## Post-Meeting Review

After a meeting ends, the review page shows the full transcript. Users can:

1. Click any word → open word detail panel showing:
   - Word, pronunciation hint, ECDICT definition
   - All context sentences where it appeared (from `word_sentences` JOIN `transcript_lines`)
   - 🔊 button per sentence (AVSpeechSynthesizer reads the full sentence)
   - "Mark as mastered" button → sets `familiarity = 5`, removes from future highlights
2. Highlight new unknown words directly in the transcript (adds to vocab book)
3. See a summary table of all vocab-book words that appeared in this meeting

---

## TTS

Uses macOS `AVSpeechSynthesizer` — system-native, English quality equivalent to Siri voices, fully offline, zero model files, no API cost. Called via the Swift sidecar, triggered by Tauri IPC command `speak-text` with the sentence string.

---

## Distribution & App Store

**Target:** Mac App Store

**App bundle size:** ~40MB
- App binary + Swift audio sidecar: ~10MB
- ECDICT (filtered to 100k entries): ~25MB
- No Python runtime, no bundled model

**Whisper model — first-launch download:**
On first launch, a setup screen downloads the whisper.cpp `small` model (~500MB) to `~/Library/Application Support/LearnCaption/models/`. Progress bar shown. App is unusable until download completes. Model is a data file (weights), not executable code — App Store review permits this. Standard practice for on-device AI apps.

**STT runtime — whisper-rs (not Python):**
The Python faster-whisper sidecar is replaced by `whisper-rs`, a Rust crate that links whisper.cpp as a static library. This runs entirely within the Tauri Rust process — no sidecar, no Python, no sandbox issues. Metal GPU acceleration on Apple Silicon via whisper.cpp's Core ML backend.

**VAD:** whisper.cpp built-in `no_speech_prob` threshold, supplemented by simple RMS energy gating before sending chunks to inference. No external VAD library needed.

**Required entitlements (`src-tauri/entitlements.plist`):**
```xml
<key>com.apple.security.device.audio-input</key><true/>
<key>com.apple.security.screen-recording</key><true/>
<key>com.apple.security.network.client</key><true/>  <!-- for model download -->
<key>com.apple.security.files.user-selected.read-write</key><true/>
```

**Required Info.plist keys:**
- `NSMicrophoneUsageDescription` — "LearnCaption needs microphone access to transcribe your meetings."
- `NSScreenCaptureUsageDescription` — "LearnCaption needs screen recording permission to capture meeting audio."

---

## Out of Scope (Future Phases)

- **Speaker diarization** — voice embedding + clustering to label speakers; user assigns names to labels
- **AI phrase suggestions** — post-meeting LLM summary of idioms, collocations, good expressions (Gemma-2B via llama.cpp)
- **Vocabulary level report** — statistical comparison against CET4/CET6/TOEFL wordlists
- **Windows support** — WASAPI loopback audio capture; faster-whisper and SQLite layers are already cross-platform
- **Cloud STT option** — Deepgram streaming for users who prefer lower latency over local privacy
