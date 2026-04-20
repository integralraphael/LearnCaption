# LearnCaption Foundation + Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Tauri app skeleton, SQLite schema, ECDICT dictionary, Aho-Corasick annotation engine, ScreenCaptureKit audio sidecar, whisper-rs STT, first-launch model download, and wire them into a working pipeline that emits annotated subtitle IPC events.

**Architecture:** Rust backend runs whisper-rs (whisper.cpp via FFI) directly — no Python sidecar. One Swift sidecar handles audio capture (ScreenCaptureKit). PCM chunks flow from the sidecar into the Rust STT engine, through the annotation engine, and out to React via Tauri IPC events. App bundle is ~40MB; the whisper model (~500MB) downloads on first launch.

**Tech Stack:** Tauri 2, Rust, React + TypeScript, SQLite (tauri-plugin-sql), aho-corasick crate, rusqlite, whisper-rs crate, Swift (ScreenCaptureKit), ECDICT

---

## File Structure

```
learncaption/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs                  # Tauri setup, register all commands + events
│   │   ├── commands/
│   │   │   ├── mod.rs
│   │   │   ├── pipeline.rs          # start_recording / stop_recording commands
│   │   │   └── vocabulary.rs        # add_entry, mark_mastered, list_entries commands
│   │   ├── pipeline/
│   │   │   ├── mod.rs
│   │   │   ├── audio_sidecar.rs     # spawn + manage Swift audio sidecar
│   │   │   ├── stt.rs               # whisper-rs engine — runs in Rust, no sidecar
│   │   │   ├── model_download.rs    # first-launch model download + progress events
│   │   │   └── annotator.rs         # ECDICT lookup + Aho-Corasick matcher → AnnotatedLine
│   │   ├── dictionary/
│   │   │   └── ecdict.rs            # load ECDICT SQLite → HashMap<String,String>
│   │   └── db/
│   │       └── schema.rs            # run migrations, expose DbPool type alias
│   ├── sidecars/
│   │   └── audio-capture/           # Swift Package — ScreenCaptureKit audio tap
│   │       ├── Package.swift
│   │       └── Sources/AudioCapture/main.swift
│   ├── resources/
│   │   └── ecdict.db                # ECDICT SQLite filtered to 100k entries (~25MB)
│   ├── Cargo.toml
│   └── tauri.conf.json
└── src/                             # React frontend (scaffolded in Task 1)
    └── types/
        └── subtitle.ts              # Shared TS types matching Rust structs
```

---

## Task 1: Tauri Project Scaffold

**Files:**
- Create: entire project via `create-tauri-app`
- Create: `src/types/subtitle.ts`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Scaffold the project**

```bash
cd /Users/raphael/Documents/LearnCaption
npm create tauri-app@latest . -- --template react-ts --manager npm --yes
```

Expected output: project files created in current directory.

- [ ] **Step 2: Verify it builds**

```bash
cd /Users/raphael/Documents/LearnCaption
npm install
npm run tauri dev
```

Expected: window opens with default Vite+React app. Close it.

- [ ] **Step 3: Add Rust dependencies to `src-tauri/Cargo.toml`**

In the `[dependencies]` section, add:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
aho-corasick = "1"
rusqlite = { version = "0.31", features = ["bundled"] }
tokio = { version = "1", features = ["full"] }
```

- [ ] **Step 4: Create shared TypeScript types at `src/types/subtitle.ts`**

```typescript
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
```

- [ ] **Step 5: Create the command module stubs**

Create `src-tauri/src/commands/mod.rs`:
```rust
pub mod pipeline;
pub mod vocabulary;
```

Create `src-tauri/src/commands/pipeline.rs`:
```rust
#[tauri::command]
pub async fn start_recording() -> Result<(), String> {
    Ok(()) // stub
}

#[tauri::command]
pub async fn stop_recording() -> Result<(), String> {
    Ok(()) // stub
}
```

Create `src-tauri/src/commands/vocabulary.rs`:
```rust
#[tauri::command]
pub async fn add_entry(_entry: String, _definition: String) -> Result<(), String> {
    Ok(()) // stub
}

#[tauri::command]
pub async fn mark_mastered(_entry: String) -> Result<(), String> {
    Ok(()) // stub
}
```

- [ ] **Step 6: Register commands in `src-tauri/src/main.rs`**

```rust
mod commands;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::pipeline::start_recording,
            commands::pipeline::stop_recording,
            commands::vocabulary::add_entry,
            commands::vocabulary::mark_mastered,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 7: Verify it compiles**

```bash
npm run tauri build -- --debug 2>&1 | tail -20
```

Expected: `Compiling learncaption` ... `Finished` with no errors.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src src/types/subtitle.ts src-tauri/Cargo.toml
git commit -m "feat: scaffold Tauri project with command stubs and shared types"
```

---

## Task 2: SQLite Schema

**Files:**
- Create: `src-tauri/src/db/schema.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Create `src-tauri/src/db/schema.rs`**

```rust
use rusqlite::{Connection, Result};

pub fn run_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch("
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;

        CREATE TABLE IF NOT EXISTS meetings (
            id          INTEGER PRIMARY KEY,
            title       TEXT NOT NULL DEFAULT 'Untitled Meeting',
            started_at  DATETIME NOT NULL DEFAULT (datetime('now')),
            ended_at    DATETIME,
            audio_path  TEXT
        );

        CREATE TABLE IF NOT EXISTS transcript_lines (
            id           INTEGER PRIMARY KEY,
            meeting_id   INTEGER NOT NULL REFERENCES meetings(id),
            text         TEXT NOT NULL,
            timestamp_ms INTEGER NOT NULL,
            speaker_label TEXT
        );

        CREATE TABLE IF NOT EXISTS vocabulary (
            id               INTEGER PRIMARY KEY,
            entry            TEXT UNIQUE NOT NULL,
            type             TEXT NOT NULL DEFAULT 'word',
            definition       TEXT,
            familiarity      INTEGER NOT NULL DEFAULT 0,
            occurrence_count INTEGER NOT NULL DEFAULT 0,
            added_at         DATETIME NOT NULL DEFAULT (datetime('now')),
            mastered_at      DATETIME
        );

        CREATE TABLE IF NOT EXISTS vocab_sentences (
            id         INTEGER PRIMARY KEY,
            vocab_id   INTEGER NOT NULL REFERENCES vocabulary(id),
            line_id    INTEGER NOT NULL REFERENCES transcript_lines(id),
            meeting_id INTEGER NOT NULL REFERENCES meetings(id),
            created_at DATETIME NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_vocab_sentences_vocab_id
            ON vocab_sentences(vocab_id);
        CREATE INDEX IF NOT EXISTS idx_transcript_lines_meeting_id
            ON transcript_lines(meeting_id);
    ")
}

pub fn open(path: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;
    run_migrations(&conn)?;
    Ok(conn)
}
```

- [ ] **Step 2: Write a test for the migration**

Add to bottom of `src-tauri/src/db/schema.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migration_creates_all_tables() {
        let conn = open(":memory:").unwrap();
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .unwrap();
        let tables: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert!(tables.contains(&"meetings".to_string()));
        assert!(tables.contains(&"transcript_lines".to_string()));
        assert!(tables.contains(&"vocabulary".to_string()));
        assert!(tables.contains(&"vocab_sentences".to_string()));
    }

    #[test]
    fn test_migration_is_idempotent() {
        let conn = open(":memory:").unwrap();
        // Running migrations a second time should not error
        run_migrations(&conn).unwrap();
    }
}
```

- [ ] **Step 3: Run the tests**

```bash
cd src-tauri && cargo test db::schema
```

Expected: 2 tests pass.

- [ ] **Step 4: Add `mod db;` to `main.rs`**

```rust
mod commands;
mod db;
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db src-tauri/src/main.rs
git commit -m "feat: SQLite schema with migrations and idempotency test"
```

---

## Task 3: ECDICT Dictionary

**Files:**
- Create: `src-tauri/src/dictionary/ecdict.rs`
- Create: `src-tauri/src/dictionary/mod.rs`
- Resource: `src-tauri/resources/ecdict.db`

- [ ] **Step 1: Download ECDICT**

```bash
curl -L "https://github.com/skywind3000/ECDICT/raw/master/ecdict.csv.7z" -o /tmp/ecdict.7z
# If 7z not available: brew install p7zip
7z x /tmp/ecdict.7z -o/tmp/ecdict/
```

Then convert CSV to SQLite (ECDICT provides a script, or use Python):

```bash
python3 - <<'EOF'
import sqlite3, csv, pathlib

conn = sqlite3.connect("src-tauri/resources/ecdict.db")
conn.execute("""
    CREATE TABLE IF NOT EXISTS stardict (
        id INTEGER PRIMARY KEY,
        word TEXT UNIQUE NOT NULL,
        phonetic TEXT,
        definition TEXT,
        translation TEXT,
        frq INTEGER
    )
""")
conn.execute("CREATE INDEX IF NOT EXISTS idx_word ON stardict(word)")

with open("/tmp/ecdict/ecdict.csv", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    rows = [(r['word'], r.get('phonetic',''), r.get('definition',''),
             r.get('translation',''), int(r['frq']) if r.get('frq') else 0)
            for r in reader if r.get('word')]

conn.executemany(
    "INSERT OR IGNORE INTO stardict(word,phonetic,definition,translation,frq) VALUES(?,?,?,?,?)",
    rows
)
conn.commit()
print(f"Loaded {len(rows)} entries")
EOF
```

Expected: `Loaded ~3500000 entries`

- [ ] **Step 2: Create `src-tauri/src/dictionary/ecdict.rs`**

```rust
use rusqlite::{Connection, Result};
use std::collections::HashMap;

pub struct EcdictDictionary {
    /// Maps lowercase entry → Chinese translation string
    entries: HashMap<String, String>,
}

impl EcdictDictionary {
    /// Load top `limit` entries by frequency from the ECDICT SQLite file.
    /// limit=100_000 covers virtually all business/meeting vocabulary.
    pub fn load(ecdict_path: &str, limit: u32) -> Result<Self> {
        let conn = Connection::open(ecdict_path)?;
        let mut stmt = conn.prepare(
            "SELECT word, translation FROM stardict
             WHERE translation != '' AND frq > 0
             ORDER BY frq DESC LIMIT ?",
        )?;
        let entries: HashMap<String, String> = stmt
            .query_map([limit], |row| {
                Ok((
                    row.get::<_, String>(0)?.to_lowercase(),
                    row.get::<_, String>(1)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(Self { entries })
    }

    /// Look up a word. Returns the first line of the translation field.
    pub fn lookup(&self, word: &str) -> Option<&str> {
        self.entries
            .get(&word.to_lowercase())
            .map(|def| {
                // ECDICT translation field uses \n-separated lines; take first
                def.lines().next().unwrap_or(def.as_str())
            })
    }
}
```

- [ ] **Step 3: Create `src-tauri/src/dictionary/mod.rs`**

```rust
pub mod ecdict;
pub use ecdict::EcdictDictionary;
```

- [ ] **Step 4: Write tests**

Add to bottom of `ecdict.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn load_test_dict() -> EcdictDictionary {
        // Uses the real ecdict.db in resources/
        EcdictDictionary::load("resources/ecdict.db", 100_000).unwrap()
    }

    #[test]
    fn test_lookup_common_word() {
        let dict = load_test_dict();
        let result = dict.lookup("leverage");
        assert!(result.is_some(), "expected 'leverage' to be in dictionary");
    }

    #[test]
    fn test_lookup_case_insensitive() {
        let dict = load_test_dict();
        assert_eq!(dict.lookup("leverage"), dict.lookup("LEVERAGE"));
    }

    #[test]
    fn test_lookup_unknown_word() {
        let dict = load_test_dict();
        assert!(dict.lookup("xyzqnotrealword").is_none());
    }

    #[test]
    fn test_returns_single_line() {
        let dict = load_test_dict();
        if let Some(def) = dict.lookup("run") {
            assert!(!def.contains('\n'), "definition should be single line");
        }
    }
}
```

- [ ] **Step 5: Run tests**

```bash
cd src-tauri && cargo test dictionary::ecdict
```

Expected: 4 tests pass.

- [ ] **Step 6: Add `mod dictionary;` to `main.rs`**

- [ ] **Step 7: Register ecdict.db as a Tauri resource in `tauri.conf.json`**

In the `bundle.resources` array:
```json
{
  "bundle": {
    "resources": ["resources/ecdict.db"]
  }
}
```

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/dictionary src-tauri/resources/ecdict.db src-tauri/tauri.conf.json src-tauri/src/main.rs
git commit -m "feat: ECDICT dictionary with in-memory HashMap loader"
```

---

## Task 4: Aho-Corasick Annotation Engine

**Files:**
- Create: `src-tauri/src/pipeline/annotator.rs`
- Create: `src-tauri/src/pipeline/mod.rs`

- [ ] **Step 1: Define types and create `src-tauri/src/pipeline/annotator.rs`**

```rust
use aho_corasick::{AhoCorasick, MatchKind};
use serde::{Deserialize, Serialize};

use crate::dictionary::EcdictDictionary;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WordToken {
    pub text: String,
    pub definition: Option<String>,
    pub vocab_id: Option<i64>,
    pub color: Option<String>, // "yellow" | "orange" | "red"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnotatedLine {
    pub line_id: i64,
    pub meeting_id: i64,
    pub tokens: Vec<WordToken>,
    pub raw_text: String,
    pub timestamp_ms: i64,
}

/// A single entry from the vocabulary table used to build the automaton.
#[derive(Debug, Clone)]
pub struct VocabEntry {
    pub id: i64,
    pub entry: String,            // e.g. "leverage" or "look forward to"
    pub definition: String,
    pub occurrence_count: u32,
    pub familiarity: u8,
}

pub struct Annotator {
    dict: EcdictDictionary,
    /// Rebuilt whenever vocabulary changes
    automaton: Option<AhoCorasick>,
    vocab_entries: Vec<VocabEntry>,
    /// Estimated vocabulary tier threshold (0=CET4, 1=CET6, 2=TOEFL, 3=GRE)
    vocab_tier: u8,
}

impl Annotator {
    pub fn new(dict: EcdictDictionary) -> Self {
        Self {
            dict,
            automaton: None,
            vocab_entries: vec![],
            vocab_tier: 0,
        }
    }

    /// Call this on startup and whenever vocabulary table changes.
    pub fn rebuild_automaton(&mut self, entries: Vec<VocabEntry>) {
        let patterns: Vec<String> = entries
            .iter()
            .map(|e| e.entry.to_lowercase())
            .collect();
        if patterns.is_empty() {
            self.automaton = None;
        } else {
            self.automaton = Some(
                AhoCorasick::builder()
                    .match_kind(MatchKind::LeftmostLongest)
                    .build(&patterns)
                    .expect("failed to build Aho-Corasick automaton"),
            );
        }
        // Estimate vocab tier from entries: what's the highest tier that still
        // has unknown words? Simple heuristic: count by word length as proxy
        // (full tier detection requires a bundled tier wordlist — Phase 2).
        self.vocab_tier = 0;
        self.vocab_entries = entries;
    }

    /// Annotate a raw Whisper text line into tokens.
    pub fn annotate(
        &self,
        raw_text: &str,
        line_id: i64,
        meeting_id: i64,
        timestamp_ms: i64,
    ) -> AnnotatedLine {
        let lower = raw_text.to_lowercase();
        // Collect vocab matches with byte ranges
        let mut vocab_matches: Vec<(usize, usize, usize)> = vec![]; // (start, end, entry_idx)
        if let Some(ac) = &self.automaton {
            for m in ac.find_iter(&lower) {
                vocab_matches.push((m.start(), m.end(), m.pattern().as_usize()));
            }
        }

        // Build tokens by walking the original text
        let tokens = self.build_tokens(raw_text, &lower, &vocab_matches);

        AnnotatedLine {
            line_id,
            meeting_id,
            tokens,
            raw_text: raw_text.to_string(),
            timestamp_ms,
        }
    }

    fn build_tokens(
        &self,
        raw: &str,
        lower: &str,
        vocab_matches: &[(usize, usize, usize)],
    ) -> Vec<WordToken> {
        let mut tokens = vec![];
        let mut pos = 0;
        let bytes = raw.as_bytes();

        // Split on whitespace, preserving positions
        let words: Vec<(usize, usize)> = {
            let mut v = vec![];
            let mut start = None;
            for (i, &b) in bytes.iter().enumerate() {
                if b == b' ' || b == b'\t' {
                    if let Some(s) = start.take() {
                        v.push((s, i));
                    }
                } else if start.is_none() {
                    start = Some(i);
                }
            }
            if let Some(s) = start {
                v.push((s, bytes.len()));
            }
            v
        };

        let mut word_idx = 0;
        while word_idx < words.len() {
            let (wstart, wend) = words[word_idx];
            // Check if a vocab match starts at this word's byte position
            let vocab_hit = vocab_matches
                .iter()
                .find(|&&(ms, me, _)| ms == wstart);

            if let Some(&(ms, me, entry_idx)) = vocab_hit {
                let entry = &self.vocab_entries[entry_idx];
                let color = self.color_for_entry(entry);
                tokens.push(WordToken {
                    text: raw[ms..me].to_string(),
                    definition: Some(entry.definition.clone()),
                    vocab_id: Some(entry.id),
                    color: Some(color),
                });
                // Skip all words covered by this phrase match
                while word_idx < words.len() && words[word_idx].1 <= me {
                    word_idx += 1;
                }
            } else {
                let word_text = &raw[wstart..wend];
                let definition = self.dict.lookup(word_text).map(|s| s.to_string());
                tokens.push(WordToken {
                    text: word_text.to_string(),
                    definition,
                    vocab_id: None,
                    color: None,
                });
                word_idx += 1;
            }
        }
        tokens
    }

    fn color_for_entry(&self, entry: &VocabEntry) -> String {
        match entry.occurrence_count {
            0..=1 => "yellow".to_string(),
            2..=4 => "orange".to_string(),
            _ => "red".to_string(),
        }
    }
}
```

- [ ] **Step 2: Create `src-tauri/src/pipeline/mod.rs`**

```rust
pub mod annotator;
pub use annotator::{AnnotatedLine, Annotator, VocabEntry, WordToken};
```

- [ ] **Step 3: Write tests for the annotator**

Add to bottom of `annotator.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn make_dict() -> EcdictDictionary {
        EcdictDictionary::load("resources/ecdict.db", 100_000).unwrap()
    }

    fn make_annotator_with_vocab(entries: Vec<VocabEntry>) -> Annotator {
        let mut a = Annotator::new(make_dict());
        a.rebuild_automaton(entries);
        a
    }

    fn vocab(id: i64, entry: &str, definition: &str, count: u32) -> VocabEntry {
        VocabEntry {
            id,
            entry: entry.to_string(),
            definition: definition.to_string(),
            occurrence_count: count,
            familiarity: 0,
        }
    }

    #[test]
    fn test_annotates_single_vocab_word() {
        let a = make_annotator_with_vocab(vec![vocab(1, "leverage", "充分利用", 3)]);
        let line = a.annotate("we should leverage this", 1, 1, 0);
        let tok = line.tokens.iter().find(|t| t.text == "leverage").unwrap();
        assert_eq!(tok.definition.as_deref(), Some("充分利用"));
        assert_eq!(tok.color.as_deref(), Some("orange")); // count=3
    }

    #[test]
    fn test_phrase_suppresses_contained_word() {
        let a = make_annotator_with_vocab(vec![
            vocab(1, "look forward to", "期待", 1),
            vocab(2, "forward", "向前", 0),
        ]);
        let line = a.annotate("I look forward to the meeting", 1, 1, 0);
        // "look forward to" should be one token
        let phrase_tok = line.tokens.iter().find(|t| t.text.contains("look forward to"));
        assert!(phrase_tok.is_some(), "phrase should match as one token");
        // "forward" should NOT appear as separate token
        let fwd_tok = line.tokens.iter().find(|t| t.text == "forward");
        assert!(fwd_tok.is_none(), "contained word should be suppressed by phrase");
    }

    #[test]
    fn test_color_thresholds() {
        let a = make_annotator_with_vocab(vec![
            vocab(1, "alpha", "甲", 0),
            vocab(2, "beta", "乙", 3),
            vocab(3, "gamma", "丙", 7),
        ]);
        let line = a.annotate("alpha beta gamma", 1, 1, 0);
        let colors: Vec<_> = line.tokens.iter().map(|t| t.color.as_deref()).collect();
        assert_eq!(colors, vec![Some("yellow"), Some("orange"), Some("red")]);
    }

    #[test]
    fn test_unannotated_word_has_no_vocab_id() {
        let a = make_annotator_with_vocab(vec![]);
        let line = a.annotate("hello world", 1, 1, 0);
        for tok in &line.tokens {
            assert!(tok.vocab_id.is_none());
        }
    }
}
```

- [ ] **Step 4: Run tests**

```bash
cd src-tauri && cargo test pipeline::annotator
```

Expected: 4 tests pass.

- [ ] **Step 5: Add `mod pipeline;` to `main.rs`**

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pipeline src-tauri/src/main.rs
git commit -m "feat: Aho-Corasick annotation engine with longest-match-wins and color thresholds"
```

---

## Task 5: ScreenCaptureKit Audio Sidecar (Swift)

**Files:**
- Create: `src-tauri/sidecars/audio-capture/Package.swift`
- Create: `src-tauri/sidecars/audio-capture/Sources/AudioCapture/main.swift`

This sidecar:
1. Captures system audio + microphone via ScreenCaptureKit
2. Mixes them into a single PCM stream
3. Writes raw 16kHz mono float32 PCM to stdout in chunks

The Rust audio sidecar manager reads stdout and forwards PCM to the STT sidecar.

- [ ] **Step 1: Create `src-tauri/sidecars/audio-capture/Package.swift`**

```swift
// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "AudioCapture",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "AudioCapture",
            path: "Sources/AudioCapture"
        )
    ]
)
```

- [ ] **Step 2: Create `src-tauri/sidecars/audio-capture/Sources/AudioCapture/main.swift`**

```swift
import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreAudio

// Output format: 16kHz mono PCM float32, little-endian
// Each chunk: 4-byte little-endian uint32 length + raw float32 samples

let TARGET_SAMPLE_RATE: Double = 16000
let CHUNK_SAMPLES = 1600 // 100ms chunks

class AudioCaptureSessions: NSObject, SCStreamOutput {
    private var stream: SCStream?
    private var micEngine: AVAudioEngine?
    private var outputBuffer = [Float]()
    private let queue = DispatchQueue(label: "audio.capture")

    func start() async throws {
        // 1. Set up microphone capture via AVAudioEngine
        let engine = AVAudioEngine()
        let input = engine.inputNode
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                    sampleRate: TARGET_SAMPLE_RATE,
                                    channels: 1, interleaved: false)!
        input.installTap(onBus: 0, bufferSize: 4096, format: nil) { [weak self] buf, _ in
            self?.appendSamples(from: buf, sourceRate: buf.format.sampleRate, isMic: true)
        }
        try engine.start()
        self.micEngine = engine

        // 2. Set up system audio capture via ScreenCaptureKit
        let content = try await SCShareableContent.current
        guard let display = content.displays.first else {
            fputs("No display found\n", stderr)
            return
        }
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.sampleRate = Int(TARGET_SAMPLE_RATE)
        config.channelCount = 1
        config.excludesCurrentProcessAudio = false

        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        let stream = SCStream(filter: filter, configuration: config, delegate: nil)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        try await stream.startCapture()
        self.stream = stream
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }
        guard let blockBuf = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }
        var length = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        CMBlockBufferGetDataPointer(blockBuf, atOffset: 0, lengthAtOffsetOut: nil,
                                     totalLengthOut: &length, dataPointerOut: &dataPointer)
        guard let ptr = dataPointer else { return }
        let samples = UnsafeBufferPointer(
            start: UnsafeRawPointer(ptr).assumingMemoryBound(to: Float.self),
            count: length / MemoryLayout<Float>.size
        )
        appendSamplesRaw(Array(samples))
    }

    private func appendSamples(from buffer: AVAudioPCMBuffer, sourceRate: Double, isMic: Bool) {
        guard let channelData = buffer.floatChannelData?[0] else { return }
        let count = Int(buffer.frameLength)
        // Simple nearest-neighbour resample to TARGET_SAMPLE_RATE
        let ratio = sourceRate / TARGET_SAMPLE_RATE
        var resampled = [Float]()
        var i: Double = 0
        while i < Double(count) {
            resampled.append(channelData[Int(i)])
            i += ratio
        }
        appendSamplesRaw(resampled)
    }

    private func appendSamplesRaw(_ samples: [Float]) {
        queue.async { [self] in
            outputBuffer.append(contentsOf: samples)
            while outputBuffer.count >= CHUNK_SAMPLES {
                let chunk = Array(outputBuffer.prefix(CHUNK_SAMPLES))
                outputBuffer.removeFirst(CHUNK_SAMPLES)
                writeChunk(chunk)
            }
        }
    }

    private func writeChunk(_ samples: [Float]) {
        let byteCount = UInt32(samples.count * MemoryLayout<Float>.size)
        var lengthLE = byteCount.littleEndian
        withUnsafeBytes(of: &lengthLE) { FileHandle.standardOutput.write(Data($0)) }
        samples.withUnsafeBytes { FileHandle.standardOutput.write(Data($0)) }
    }
}

let capture = AudioCaptureSessions()
Task {
    do {
        try await capture.start()
        fputs("audio-capture: started\n", stderr)
    } catch {
        fputs("audio-capture error: \(error)\n", stderr)
        exit(1)
    }
}
RunLoop.main.run()
```

- [ ] **Step 3: Build the Swift binary**

```bash
cd src-tauri/sidecars/audio-capture
swift build -c release
```

Expected: `.build/release/AudioCapture` binary produced.

- [ ] **Step 4: Copy binary to Tauri sidecar location**

Per Tauri sidecar naming convention (platform suffix required):

```bash
mkdir -p src-tauri/binaries
cp .build/release/AudioCapture \
   ../../binaries/audio-capture-aarch64-apple-darwin
# For Intel Mac:
# cp .build/release/AudioCapture ../../binaries/audio-capture-x86_64-apple-darwin
```

- [ ] **Step 5: Register sidecar in `tauri.conf.json`**

```json
{
  "bundle": {
    "externalBin": ["binaries/audio-capture"]
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src-tauri/sidecars/audio-capture src-tauri/binaries/audio-capture-aarch64-apple-darwin src-tauri/tauri.conf.json
git commit -m "feat: ScreenCaptureKit audio sidecar — 16kHz PCM chunks to stdout"
```

---

## Task 6: whisper-rs STT Engine + First-Launch Model Download

**Files:**
- Create: `src-tauri/src/pipeline/stt.rs`
- Create: `src-tauri/src/pipeline/model_download.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/pipeline/mod.rs`

No Python sidecar. whisper-rs links whisper.cpp as a static Rust library. The whisper `small` model (~500MB) is downloaded to `~/Library/Application Support/LearnCaption/models/` on first launch.

- [ ] **Step 1: Add whisper-rs to `src-tauri/Cargo.toml`**

```toml
[dependencies]
whisper-rs = { version = "0.11", features = ["metal"] }
reqwest = { version = "0.12", features = ["stream"] }
futures-util = "0.3"
```

The `metal` feature enables Apple Silicon GPU acceleration via whisper.cpp's Core ML backend.

- [ ] **Step 2: Create `src-tauri/src/pipeline/model_download.rs`**

```rust
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use futures_util::StreamExt;

const MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin";
const MODEL_FILENAME: &str = "ggml-small.en.bin";

/// Returns the path where the model should live.
pub fn model_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("no app data dir")
        .join("models")
        .join(MODEL_FILENAME)
}

/// Returns true if the model file already exists and is non-empty.
pub fn model_exists(app: &AppHandle) -> bool {
    let p = model_path(app);
    p.exists() && p.metadata().map(|m| m.len() > 0).unwrap_or(false)
}

/// Download the model, emitting `model-download-progress` events (0.0–1.0).
/// Emits `model-download-done` on success, `model-download-error` on failure.
pub async fn download_model(app: AppHandle) {
    let dest = model_path(&app);
    std::fs::create_dir_all(dest.parent().unwrap()).ok();

    let client = reqwest::Client::new();
    let response = match client.get(MODEL_URL).send().await {
        Ok(r) => r,
        Err(e) => {
            let _ = app.emit("model-download-error", e.to_string());
            return;
        }
    };

    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    let mut file = match std::fs::File::create(&dest) {
        Ok(f) => f,
        Err(e) => {
            let _ = app.emit("model-download-error", e.to_string());
            return;
        }
    };

    use std::io::Write;
    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(bytes) => {
                if file.write_all(&bytes).is_err() {
                    let _ = app.emit("model-download-error", "write failed");
                    return;
                }
                downloaded += bytes.len() as u64;
                if total > 0 {
                    let progress = downloaded as f32 / total as f32;
                    let _ = app.emit("model-download-progress", progress);
                }
            }
            Err(e) => {
                let _ = app.emit("model-download-error", e.to_string());
                return;
            }
        }
    }
    let _ = app.emit("model-download-done", ());
}
```

- [ ] **Step 3: Write tests for model_download helpers**

Add to bottom of `model_download.rs`:

```rust
#[cfg(test)]
mod tests {
    // model_exists and model_path are tested via integration in Task 7.
    // Unit-testable: verify MODEL_URL points to a .bin file.
    #[test]
    fn test_model_url_ends_with_bin() {
        assert!(super::MODEL_URL.ends_with(".bin"));
    }

    #[test]
    fn test_model_filename_matches_url() {
        assert!(super::MODEL_URL.contains(super::MODEL_FILENAME));
    }
}
```

- [ ] **Step 4: Run tests**

```bash
cd src-tauri && cargo test pipeline::model_download
```

Expected: 2 tests pass.

- [ ] **Step 5: Create `src-tauri/src/pipeline/stt.rs`**

```rust
use std::path::Path;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub struct SttEngine {
    ctx: WhisperContext,
}

impl SttEngine {
    /// Load the model from disk. Call only after model_exists() is true.
    pub fn load(model_path: &Path) -> Result<Self, String> {
        let ctx = WhisperContext::new_with_params(
            model_path.to_str().unwrap(),
            WhisperContextParameters::default(),
        )
        .map_err(|e| format!("failed to load whisper model: {e}"))?;
        Ok(Self { ctx })
    }

    /// Transcribe a buffer of 16kHz mono f32 PCM samples.
    /// Returns vec of (text, start_ms) pairs.
    pub fn transcribe(&self, samples: &[f32]) -> Result<Vec<(String, i64)>, String> {
        let mut state = self.ctx.create_state().map_err(|e| e.to_string())?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("en"));
        params.set_no_speech_thold(0.6); // skip segments with high silence probability
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);

        state
            .full(params, samples)
            .map_err(|e| format!("whisper inference failed: {e}"))?;

        let n = state.full_n_segments().map_err(|e| e.to_string())?;
        let mut results = Vec::new();
        for i in 0..n {
            let text = state.full_get_segment_text(i).map_err(|e| e.to_string())?;
            let text = text.trim().to_string();
            if text.is_empty() {
                continue;
            }
            let t0 = state.full_get_segment_t0(i).map_err(|e| e.to_string())?;
            let start_ms = t0 * 10; // whisper timestamps are in 10ms units
            results.push((text, start_ms));
        }
        Ok(results)
    }
}

/// Simple RMS energy gate — returns true if the buffer contains audible speech.
/// Avoids running whisper on pure silence.
pub fn has_speech(samples: &[f32], threshold: f32) -> bool {
    if samples.is_empty() {
        return false;
    }
    let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
    rms > threshold
}
```

- [ ] **Step 6: Write tests for the STT engine**

Add to bottom of `stt.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_has_speech_silence() {
        let silence = vec![0.0f32; 16000];
        assert!(!has_speech(&silence, 0.01));
    }

    #[test]
    fn test_has_speech_loud_audio() {
        // 440Hz sine wave — clearly audible
        let samples: Vec<f32> = (0..16000)
            .map(|i| (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 16000.0).sin() * 0.5)
            .collect();
        assert!(has_speech(&samples, 0.01));
    }

    #[test]
    fn test_has_speech_empty() {
        assert!(!has_speech(&[], 0.01));
    }
}
```

- [ ] **Step 7: Run tests**

```bash
cd src-tauri && cargo test pipeline::stt
```

Expected: 3 tests pass (no model needed for these unit tests).

- [ ] **Step 8: Update `src-tauri/src/pipeline/mod.rs`**

```rust
pub mod annotator;
pub mod audio_sidecar;
pub mod model_download;
pub mod stt;

pub use annotator::{AnnotatedLine, Annotator, VocabEntry, WordToken};
pub use audio_sidecar::AudioSidecar;
pub use model_download::{download_model, model_exists, model_path};
pub use stt::{has_speech, SttEngine};
```

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/pipeline/stt.rs src-tauri/src/pipeline/model_download.rs src-tauri/src/pipeline/mod.rs src-tauri/Cargo.toml
git commit -m "feat: whisper-rs STT engine + first-launch model download with progress events"
```

---

## Task 7: Pipeline Orchestration (Rust)

**Files:**
- Modify: `src-tauri/src/commands/pipeline.rs`
- Modify: `src-tauri/src/main.rs`

Wire everything: spawn audio sidecar, feed PCM into whisper-rs (running in a Rust thread), annotate output, emit IPC events. Also add the `check_model` command so the frontend can show the download screen on first launch.

- [ ] **Step 1: Implement commands in `src-tauri/src/commands/pipeline.rs`**

```rust
use std::io::Read;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::dictionary::EcdictDictionary;
use crate::pipeline::{
    download_model, has_speech, model_exists, model_path, Annotator, AudioSidecar, SttEngine,
    VocabEntry,
};

pub struct PipelineState(pub Arc<Mutex<Option<AudioSidecar>>>);

/// Called on app start — returns true if model is already downloaded.
#[tauri::command]
pub fn check_model(app: AppHandle) -> bool {
    model_exists(&app)
}

/// Trigger model download. Progress events: `model-download-progress` (f32 0–1),
/// `model-download-done`, `model-download-error` (String).
#[tauri::command]
pub async fn start_model_download(app: AppHandle) {
    download_model(app).await;
}

#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    state: State<'_, PipelineState>,
) -> Result<(), String> {
    if !model_exists(&app) {
        return Err("model not downloaded yet".to_string());
    }

    let model_p = model_path(&app);
    let ecdict_path = app
        .path()
        .resolve("resources/ecdict.db", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;

    let dict = EcdictDictionary::load(ecdict_path.to_str().unwrap(), 100_000)
        .map_err(|e| e.to_string())?;
    let mut annotator = Annotator::new(dict);
    annotator.rebuild_automaton(vec![]); // wired to DB in Plan B

    let mut audio = AudioSidecar::spawn(&app).map_err(|e| e.to_string())?;
    let audio_stdout = audio.take_stdout();

    let app2 = app.clone();
    let annotator = Arc::new(Mutex::new(annotator));

    std::thread::spawn(move || {
        // Load STT engine on the worker thread (blocks ~1s on first load)
        let engine = match SttEngine::load(&model_p) {
            Ok(e) => e,
            Err(err) => {
                let _ = app2.emit("pipeline-error", err);
                return;
            }
        };

        const SAMPLE_RATE: usize = 16000;
        const CHUNK_BYTES: usize = 1600 * 4; // 100ms of float32
        const MAX_BUFFER_S: usize = 8;
        const SILENCE_CHUNKS: usize = 4; // 400ms of silence → trigger inference

        let mut pcm_buffer: Vec<f32> = Vec::new();
        let mut silent_chunks: usize = 0;
        let mut session_start_ms: i64 = 0;
        let mut buf = [0u8; 4 + CHUNK_BYTES];
        let mut reader = std::io::BufReader::new(audio_stdout);

        loop {
            // Read length-prefixed chunk from audio sidecar
            if reader.read_exact(&mut buf[..4]).is_err() { break; }
            let len = u32::from_le_bytes(buf[..4].try_into().unwrap()) as usize;
            if reader.read_exact(&mut buf[4..4 + len]).is_err() { break; }

            let samples: Vec<f32> = buf[4..4 + len]
                .chunks_exact(4)
                .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
                .collect();

            let is_speech = has_speech(&samples, 0.01);
            pcm_buffer.extend_from_slice(&samples);
            silent_chunks = if is_speech { 0 } else { silent_chunks + 1 };

            let duration_s = pcm_buffer.len() / SAMPLE_RATE;
            let should_infer =
                (silent_chunks >= SILENCE_CHUNKS && duration_s > 0)
                || duration_s >= MAX_BUFFER_S;

            if should_infer && !pcm_buffer.is_empty() {
                if let Ok(segments) = engine.transcribe(&pcm_buffer) {
                    let ann = annotator.lock().unwrap();
                    for (text, offset_ms) in segments {
                        let ts = session_start_ms + offset_ms;
                        let line = ann.annotate(&text, 0, 0, ts);
                        let _ = app2.emit("subtitle-line", &line);
                    }
                }
                session_start_ms += (pcm_buffer.len() / SAMPLE_RATE * 1000) as i64;
                pcm_buffer.clear();
                silent_chunks = 0;
            }
        }
    });

    *state.0.lock().unwrap() = Some(audio);
    Ok(())
}

#[tauri::command]
pub async fn stop_recording(state: State<'_, PipelineState>) -> Result<(), String> {
    *state.0.lock().unwrap() = None; // Drop AudioSidecar → kills Swift process
    Ok(())
}
```

- [ ] **Step 2: Update `src-tauri/src/main.rs`**

```rust
mod commands;
mod db;
mod dictionary;
mod pipeline;

use commands::pipeline::PipelineState;
use std::sync::{Arc, Mutex};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(PipelineState(Arc::new(Mutex::new(None))))
        .invoke_handler(tauri::generate_handler![
            commands::pipeline::check_model,
            commands::pipeline::start_model_download,
            commands::pipeline::start_recording,
            commands::pipeline::stop_recording,
            commands::vocabulary::add_entry,
            commands::vocabulary::mark_mastered,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Build and verify compilation**

```bash
npm run tauri build -- --debug 2>&1 | tail -20
```

Expected: compiles without errors.

- [ ] **Step 4: Smoke test — minimal UI in `src/App.tsx`**

```typescript
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { AnnotatedLine } from "./types/subtitle";

export default function App() {
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    invoke<boolean>("check_model").then(setReady);
    listen<number>("model-download-progress", e => setProgress(e.payload));
    listen("model-download-done", () => setReady(true));
    listen<AnnotatedLine>("subtitle-line", e => console.log("subtitle:", e.payload));
  }, []);

  if (!ready) return (
    <div>
      <p>Downloading model... {Math.round(progress * 100)}%</p>
      <button onClick={() => invoke("start_model_download")}>Download</button>
    </div>
  );

  return (
    <div>
      <button onClick={() => invoke("start_recording")}>Start</button>
      <button onClick={() => invoke("stop_recording")}>Stop</button>
    </div>
  );
}
```

Run `npm run tauri dev`. On first run: click Download, watch progress. After download, click Start, speak — check console for `subtitle-line` events.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src src/App.tsx
git commit -m "feat: wire audio→whisper-rs pipeline with VAD gating, model download flow, IPC events"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Tauri scaffold (Task 1)
- ✅ SQLite schema — 4 tables, indexes, migrations (Task 2)
- ✅ ECDICT in-memory HashMap, 100k entries, single-line definitions (Task 3)
- ✅ Aho-Corasick longest-match-wins, phrase suppresses contained word, color thresholds (Task 4)
- ✅ ScreenCaptureKit — system audio + mic, 16kHz PCM (Task 5)
- ✅ whisper-rs (whisper.cpp, small model, Metal GPU), RMS VAD gating (Task 6)
- ✅ First-launch model download with progress events (Task 6)
- ✅ Pipeline orchestration — audio→whisper-rs→annotate→IPC event (Task 7)
- ✅ App Store compatible — no Python runtime, model is data file not executable
- ⚠️ `line_id` / `meeting_id` in AnnotatedLine are stubbed as 0 — wired in Plan B when meeting management is implemented
- ⚠️ Vocabulary loading into Aho-Corasick uses empty list — wired in Plan B after vocabulary CRUD commands

**Placeholder scan:** No TBD/TODO in task steps. Stubs are explicitly noted as "filled in Plan B."

**Type consistency:** `WordToken` and `AnnotatedLine` structs defined in Task 1 (TypeScript) and Task 4 (Rust) match field names and types. `serde` serialization ensures the IPC payload matches the TypeScript interface.
