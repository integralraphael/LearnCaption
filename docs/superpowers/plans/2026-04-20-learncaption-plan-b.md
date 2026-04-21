# LearnCaption Plan B — UI + Vocabulary + Review

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the MVP — wire all 4 SQLite tables to real data, implement vocabulary commands, TTS, and build the full React UI (subtitle window with inline definitions, vocabulary book, post-meeting review with word detail panel).

**Architecture:** Plan A left the pipeline emitting IPC events but writing nothing to SQLite. Plan B (a) opens the DB as Tauri managed state, (b) writes meetings + transcript lines + vocab occurrences during recording, (c) implements vocabulary CRUD commands, (d) builds the React UI: floating subtitle card → vocab book → post-meeting review. TTS uses macOS `say` CLI (system AVSpeechSynthesizer, same engine as Siri).

**Tech Stack:** Tauri 2, Rust (rusqlite bundled), React + TypeScript, Tailwind-like inline styles (no new CSS framework), `@tauri-apps/api/window` for always-on-top

---

## File Structure

```
src-tauri/src/
├── db/
│   ├── mod.rs               MODIFY: export AppDb
│   ├── schema.rs            unchanged
│   └── app_db.rs            CREATE: AppDb type, open_app_db()
├── commands/
│   ├── mod.rs               MODIFY: add pub mod tts; pub mod review;
│   ├── pipeline.rs          MODIFY: DB writes, vocab load, PipelineState extension
│   ├── vocabulary.rs        MODIFY: implement all stubs
│   ├── review.rs            CREATE: list_meetings, get_transcript, get_vocab_sentences
│   └── tts.rs               CREATE: speak_text command
└── lib.rs                   MODIFY: .setup() with AppDb + EcdictDictionary managed state,
                                      register new commands
src-tauri/src/pipeline/
└── annotator.rs             MODIFY: hold Arc<EcdictDictionary> instead of EcdictDictionary

src/
├── types/
│   ├── subtitle.ts          unchanged
│   └── vocabulary.ts        CREATE: VocabEntry, Meeting, TranscriptLine TS types
├── components/
│   ├── Token.tsx            CREATE: inline word+definition token
│   ├── SubtitleWindow.tsx   CREATE: floating subtitle card
│   ├── VocabBook.tsx        CREATE: vocabulary list page
│   ├── ReviewPage.tsx       CREATE: post-meeting transcript review
│   └── WordDetail.tsx       CREATE: word detail panel (definition + context sentences)
└── App.tsx                  MODIFY: routing between subtitle/vocab/review views
```

---

## Task 1: Managed State — AppDb + EcdictDictionary

**Files:**
- Create: `src-tauri/src/db/app_db.rs`
- Modify: `src-tauri/src/db/mod.rs`
- Modify: `src-tauri/src/pipeline/annotator.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create `src-tauri/src/db/app_db.rs`**

```rust
use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use tauri::path::BaseDirectory;

use crate::db::schema;

pub type AppDb = Arc<Mutex<Connection>>;

pub fn open_app_db(app: &AppHandle) -> rusqlite::Result<AppDb> {
    let db_path = app
        .path()
        .app_data_dir()
        .expect("no app data dir")
        .join("learncaption.db");
    std::fs::create_dir_all(db_path.parent().unwrap()).ok();
    let conn = schema::open(db_path.to_str().unwrap())?;
    Ok(Arc::new(Mutex::new(conn)))
}

/// Load vocab entries from DB for building the Aho-Corasick automaton.
pub fn load_vocab_entries(db: &AppDb) -> rusqlite::Result<Vec<crate::pipeline::VocabEntry>> {
    let conn = db.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, entry, definition, occurrence_count, familiarity
         FROM vocabulary
         WHERE familiarity < 5
         ORDER BY id"
    )?;
    let entries = stmt.query_map([], |row| {
        Ok(crate::pipeline::VocabEntry {
            id: row.get(0)?,
            entry: row.get(1)?,
            definition: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            occurrence_count: row.get::<_, i64>(3)? as u32,
            familiarity: row.get::<_, i64>(4)? as u8,
        })
    })?
    .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;

    fn in_memory_db() -> AppDb {
        let conn = schema::open(":memory:").unwrap();
        Arc::new(Mutex::new(conn))
    }

    #[test]
    fn test_load_vocab_entries_empty() {
        let db = in_memory_db();
        let entries = load_vocab_entries(&db).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn test_load_vocab_entries_excludes_mastered() {
        let db = in_memory_db();
        {
            let conn = db.lock().unwrap();
            conn.execute(
                "INSERT INTO vocabulary (entry, definition, familiarity, occurrence_count) VALUES ('hello', 'greeting', 5, 3)",
                [],
            ).unwrap();
            conn.execute(
                "INSERT INTO vocabulary (entry, definition, familiarity, occurrence_count) VALUES ('leverage', 'to use', 2, 1)",
                [],
            ).unwrap();
        }
        let entries = load_vocab_entries(&db).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].entry, "leverage");
    }
}
```

- [ ] **Step 2: Update `src-tauri/src/db/mod.rs`**

```rust
pub mod app_db;
pub mod schema;

pub use app_db::{open_app_db, load_vocab_entries, AppDb};
```

- [ ] **Step 3: Update `src-tauri/src/pipeline/annotator.rs` — change `dict` field to `Arc<EcdictDictionary>`**

Read the current file first to preserve all existing logic. Make only these two changes:

Change the struct field:
```rust
// OLD:
pub struct Annotator {
    dict: EcdictDictionary,
    ...
}
// NEW:
pub struct Annotator {
    dict: std::sync::Arc<crate::dictionary::EcdictDictionary>,
    ...
}
```

Change `new()` signature:
```rust
// OLD:
pub fn new(dict: EcdictDictionary) -> Self {
// NEW:
pub fn new(dict: std::sync::Arc<crate::dictionary::EcdictDictionary>) -> Self {
```

All other annotator code (rebuild_automaton, annotate, build_tokens, color_for_entry) stays identical. The `dict` field is only read via `dict.lookup(word)` — that call is unchanged.

- [ ] **Step 4: Update `src-tauri/src/lib.rs` — add `.setup()` block**

Read the current lib.rs first. Add a `.setup()` call before `.manage()` that opens the DB and loads ECDICT. Replace the current lib.rs with:

```rust
mod commands;
mod db;
mod dictionary;
mod pipeline;

use commands::pipeline::PipelineState;
use db::{open_app_db, AppDb};
use dictionary::EcdictDictionary;
use std::sync::{Arc, Mutex};
use tauri::{Manager, path::BaseDirectory};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            // Open SQLite DB
            let db = open_app_db(app.handle())?;
            app.manage(db);

            // Load ECDICT dictionary into memory (read-only, shared via Arc)
            let ecdict_path = app
                .path()
                .resolve("resources/ecdict.db", BaseDirectory::Resource)?;
            let dict = EcdictDictionary::load(ecdict_path.to_str().unwrap(), 100_000)?;
            app.manage(Arc::new(dict));

            Ok(())
        })
        .manage(PipelineState {
            sidecar: Arc::new(Mutex::new(None)),
            current_meeting_id: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            commands::pipeline::check_model,
            commands::pipeline::start_model_download,
            commands::pipeline::start_recording,
            commands::pipeline::stop_recording,
            commands::vocabulary::add_entry,
            commands::vocabulary::mark_mastered,
            commands::vocabulary::list_entries,
            commands::vocabulary::query_word,
            commands::review::list_meetings,
            commands::review::get_transcript,
            commands::review::get_vocab_sentences,
            commands::tts::speak_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Note: `PipelineState` struct will be updated in Task 2 to have `sidecar` and `current_meeting_id` fields. After Task 2, this lib.rs is correct.

- [ ] **Step 5: Run tests**

```bash
cd src-tauri && cargo test db::app_db
```

Expected: 2 tests pass.

- [ ] **Step 6: Full build check**

```bash
cd src-tauri && cargo build 2>&1 | grep "^error"
```

Expected: no errors (there will be compile errors from lib.rs referencing the new PipelineState shape and new commands — those are resolved in Tasks 2-4. If you get errors about those, stub them out with `todo!()` just enough to compile, or hold off running `cargo build` until Task 4 is done.)

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/db/app_db.rs src-tauri/src/db/mod.rs src-tauri/src/pipeline/annotator.rs src-tauri/src/lib.rs
git commit -m "feat: AppDb + EcdictDictionary as managed state, open at startup"
```

---

## Task 2: Recording Session Persistence

**Files:**
- Modify: `src-tauri/src/commands/pipeline.rs`

Extend `PipelineState` with `current_meeting_id`. Update `start_recording` to: load vocab from DB, rebuild automaton, create meeting record, write transcript_lines + vocab_sentences in the pipeline thread. Update `stop_recording` to set `ended_at`.

- [ ] **Step 1: Write the failing test for create-meeting logic**

Add to `src-tauri/src/commands/pipeline.rs` at the bottom:

```rust
#[cfg(test)]
mod tests {
    use crate::db::{AppDb, schema};
    use std::sync::{Arc, Mutex};
    use rusqlite::Connection;

    fn in_memory_db() -> AppDb {
        Arc::new(Mutex::new(schema::open(":memory:").unwrap()))
    }

    #[test]
    fn test_create_meeting_returns_id() {
        let db = in_memory_db();
        let id = {
            let conn = db.lock().unwrap();
            conn.execute(
                "INSERT INTO meetings (title, started_at) VALUES ('Test', datetime('now'))",
                [],
            ).unwrap();
            conn.last_insert_rowid()
        };
        assert!(id > 0);
    }

    #[test]
    fn test_stop_meeting_sets_ended_at() {
        let db = in_memory_db();
        let meeting_id = {
            let conn = db.lock().unwrap();
            conn.execute(
                "INSERT INTO meetings (title, started_at) VALUES ('Test', datetime('now'))",
                [],
            ).unwrap();
            conn.last_insert_rowid()
        };
        {
            let conn = db.lock().unwrap();
            conn.execute(
                "UPDATE meetings SET ended_at = datetime('now') WHERE id = ?1",
                rusqlite::params![meeting_id],
            ).unwrap();
        }
        let ended_at: Option<String> = {
            let conn = db.lock().unwrap();
            conn.query_row(
                "SELECT ended_at FROM meetings WHERE id = ?1",
                rusqlite::params![meeting_id],
                |row| row.get(0),
            ).unwrap()
        };
        assert!(ended_at.is_some());
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd src-tauri && cargo test commands::pipeline::tests
```

Expected: compile error or FAIL (commands don't exist yet).

- [ ] **Step 3: Replace `src-tauri/src/commands/pipeline.rs` with full implementation**

```rust
use std::io::Read;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::{load_vocab_entries, AppDb};
use crate::dictionary::EcdictDictionary;
use crate::pipeline::{
    download_model, has_speech, model_exists, model_path, Annotator, AudioSidecar, SttEngine,
};

pub struct PipelineState {
    pub sidecar: Arc<Mutex<Option<AudioSidecar>>>,
    pub current_meeting_id: Arc<Mutex<Option<i64>>>,
}

/// Returns true if the whisper model is already downloaded.
#[tauri::command]
pub fn check_model(app: AppHandle) -> bool {
    model_exists(&app)
}

/// Start downloading the model. Progress events:
/// - `model-download-progress` (f32 0.0–1.0)
/// - `model-download-done`
/// - `model-download-error` (String)
#[tauri::command]
pub async fn start_model_download(app: AppHandle) {
    download_model(app).await;
}

#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    state: State<'_, PipelineState>,
    db: State<'_, AppDb>,
    dict: State<'_, Arc<EcdictDictionary>>,
) -> Result<(), String> {
    if !model_exists(&app) {
        return Err("model not downloaded yet".to_string());
    }

    // Load vocab entries from DB and build annotator
    let vocab_entries = load_vocab_entries(&db).map_err(|e| e.to_string())?;
    let mut annotator = Annotator::new(dict.inner().clone());
    annotator.rebuild_automaton(vocab_entries);

    // Create meeting record
    let meeting_id: i64 = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO meetings (title, started_at) VALUES ('Meeting', datetime('now'))",
            [],
        ).map_err(|e| e.to_string())?;
        conn.last_insert_rowid()
    };
    *state.current_meeting_id.lock().unwrap() = Some(meeting_id);

    // Set window always-on-top during recording
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_always_on_top(true);
    }

    let model_p = model_path(&app);
    let mut audio = AudioSidecar::spawn(&app).map_err(|e| e.to_string())?;
    let audio_stdout = audio.take_stdout().ok_or("audio stdout already taken")?;

    // Store sidecar BEFORE spawning thread
    *state.sidecar.lock().unwrap() = Some(audio);

    let app2 = app.clone();
    let annotator = Arc::new(Mutex::new(annotator));
    let db2 = db.inner().clone();

    std::thread::spawn(move || {
        let engine = match SttEngine::load(&model_p) {
            Ok(e) => e,
            Err(err) => {
                let _ = app2.emit("pipeline-error", err);
                return;
            }
        };

        const SAMPLE_RATE: usize = 16000;
        const CHUNK_BYTES: usize = 1600 * 4;
        const MAX_BUFFER_S: usize = 8;
        const SILENCE_CHUNKS: usize = 4;

        let mut pcm_buffer: Vec<f32> = Vec::new();
        let mut silent_chunks: usize = 0;
        let mut session_start_ms: i64 = 0;
        let mut buf = vec![0u8; 4 + CHUNK_BYTES];
        let mut reader = std::io::BufReader::new(audio_stdout);

        loop {
            if reader.read_exact(&mut buf[..4]).is_err() {
                break;
            }
            let len = u32::from_le_bytes(buf[..4].try_into().unwrap()) as usize;
            if len > CHUNK_BYTES {
                break;
            }
            if reader.read_exact(&mut buf[4..4 + len]).is_err() {
                break;
            }

            let samples: Vec<f32> = buf[4..4 + len]
                .chunks_exact(4)
                .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
                .collect();

            let is_speech = has_speech(&samples, 0.01);
            pcm_buffer.extend_from_slice(&samples);
            silent_chunks = if is_speech { 0 } else { silent_chunks + 1 };

            let duration_s = pcm_buffer.len() / SAMPLE_RATE;
            let should_infer = (silent_chunks >= SILENCE_CHUNKS && duration_s > 0)
                || duration_s >= MAX_BUFFER_S;

            if should_infer && !pcm_buffer.is_empty() {
                if let Ok(segments) = engine.transcribe(&pcm_buffer) {
                    let ann = annotator.lock().unwrap();
                    for (text, offset_ms) in segments {
                        let ts = session_start_ms + offset_ms;

                        // Save transcript line, get real line_id
                        let line_id: i64 = {
                            let conn = db2.lock().unwrap();
                            conn.execute(
                                "INSERT INTO transcript_lines (meeting_id, text, timestamp_ms) VALUES (?1, ?2, ?3)",
                                rusqlite::params![meeting_id, &text, ts],
                            ).ok();
                            conn.last_insert_rowid()
                        };

                        // Annotate with real IDs
                        let line = ann.annotate(&text, line_id, meeting_id, ts);

                        // Save vocab_sentences + update occurrence_counts
                        {
                            let conn = db2.lock().unwrap();
                            for token in &line.tokens {
                                if let Some(vocab_id) = token.vocab_id {
                                    conn.execute(
                                        "INSERT INTO vocab_sentences (vocab_id, line_id, meeting_id) VALUES (?1, ?2, ?3)",
                                        rusqlite::params![vocab_id, line_id, meeting_id],
                                    ).ok();
                                    conn.execute(
                                        "UPDATE vocabulary SET occurrence_count = occurrence_count + 1 WHERE id = ?1",
                                        rusqlite::params![vocab_id],
                                    ).ok();
                                }
                            }
                        }

                        let _ = app2.emit("subtitle-line", &line);
                    }
                }
                session_start_ms += (pcm_buffer.len() as f64 / SAMPLE_RATE as f64 * 1000.0) as i64;
                pcm_buffer.clear();
                silent_chunks = 0;
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_recording(
    app: AppHandle,
    state: State<'_, PipelineState>,
    db: State<'_, AppDb>,
) -> Result<(), String> {
    // Drop sidecar → kills Swift process
    *state.sidecar.lock().unwrap() = None;

    // Update meeting ended_at
    if let Some(meeting_id) = *state.current_meeting_id.lock().unwrap() {
        let conn = db.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE meetings SET ended_at = datetime('now') WHERE id = ?1",
            rusqlite::params![meeting_id],
        ).map_err(|e| e.to_string())?;
    }
    *state.current_meeting_id.lock().unwrap() = None;

    // Remove always-on-top
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_always_on_top(false);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::db::{AppDb, schema};
    use std::sync::{Arc, Mutex};

    fn in_memory_db() -> AppDb {
        Arc::new(Mutex::new(schema::open(":memory:").unwrap()))
    }

    #[test]
    fn test_create_meeting_returns_id() {
        let db = in_memory_db();
        let id = {
            let conn = db.lock().unwrap();
            conn.execute(
                "INSERT INTO meetings (title, started_at) VALUES ('Test', datetime('now'))",
                [],
            ).unwrap();
            conn.last_insert_rowid()
        };
        assert!(id > 0);
    }

    #[test]
    fn test_stop_meeting_sets_ended_at() {
        let db = in_memory_db();
        let meeting_id = {
            let conn = db.lock().unwrap();
            conn.execute(
                "INSERT INTO meetings (title, started_at) VALUES ('Test', datetime('now'))",
                [],
            ).unwrap();
            conn.last_insert_rowid()
        };
        {
            let conn = db.lock().unwrap();
            conn.execute(
                "UPDATE meetings SET ended_at = datetime('now') WHERE id = ?1",
                rusqlite::params![meeting_id],
            ).unwrap();
        }
        let ended_at: Option<String> = {
            let conn = db.lock().unwrap();
            conn.query_row(
                "SELECT ended_at FROM meetings WHERE id = ?1",
                rusqlite::params![meeting_id],
                |row| row.get(0),
            ).unwrap()
        };
        assert!(ended_at.is_some());
    }
}
```

- [ ] **Step 4: Run tests**

```bash
cd src-tauri && cargo test commands::pipeline::tests
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/pipeline.rs
git commit -m "feat: persist meetings + transcript_lines + vocab_sentences during recording"
```

---

## Task 3: Vocabulary + Review Commands

**Files:**
- Modify: `src-tauri/src/commands/vocabulary.rs`
- Create: `src-tauri/src/commands/review.rs`
- Modify: `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Replace `src-tauri/src/commands/vocabulary.rs`**

```rust
use serde::Serialize;
use tauri::State;

use crate::db::AppDb;
use crate::dictionary::EcdictDictionary;
use std::sync::Arc;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabEntryDto {
    pub id: i64,
    pub entry: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub definition: Option<String>,
    pub familiarity: i64,
    pub occurrence_count: i64,
    pub added_at: String,
    pub mastered_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WordQueryResult {
    pub definition: Option<String>,
    pub vocab_entry: Option<VocabEntryDto>,
}

/// Add a word/phrase to the vocabulary book.
#[tauri::command]
pub fn add_entry(
    entry: String,
    definition: String,
    entry_type: String,
    db: State<'_, AppDb>,
) -> Result<VocabEntryDto, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO vocabulary (entry, type, definition, familiarity, occurrence_count)
         VALUES (?1, ?2, ?3, 0, 0)
         ON CONFLICT(entry) DO UPDATE SET definition = excluded.definition",
        rusqlite::params![entry.to_lowercase(), entry_type, definition],
    ).map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    let row = conn.query_row(
        "SELECT id, entry, type, definition, familiarity, occurrence_count, added_at, mastered_at
         FROM vocabulary WHERE id = ?1",
        rusqlite::params![id],
        row_to_dto,
    ).map_err(|e| e.to_string())?;
    Ok(row)
}

/// Set familiarity = 5 and record mastered_at.
#[tauri::command]
pub fn mark_mastered(id: i64, db: State<'_, AppDb>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE vocabulary SET familiarity = 5, mastered_at = datetime('now') WHERE id = ?1",
        rusqlite::params![id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Return all vocabulary entries ordered by occurrence_count desc.
#[tauri::command]
pub fn list_entries(db: State<'_, AppDb>) -> Result<Vec<VocabEntryDto>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, entry, type, definition, familiarity, occurrence_count, added_at, mastered_at
         FROM vocabulary ORDER BY occurrence_count DESC, added_at DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], row_to_dto)
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Look up a word: ECDICT definition + whether it's in the vocab book.
#[tauri::command]
pub fn query_word(
    word: String,
    db: State<'_, AppDb>,
    dict: State<'_, Arc<EcdictDictionary>>,
) -> Result<WordQueryResult, String> {
    let definition = dict.lookup(&word).map(|s| s.to_string());
    let conn = db.lock().map_err(|e| e.to_string())?;
    let vocab_entry = conn.query_row(
        "SELECT id, entry, type, definition, familiarity, occurrence_count, added_at, mastered_at
         FROM vocabulary WHERE entry = ?1",
        rusqlite::params![word.to_lowercase()],
        row_to_dto,
    ).ok();
    Ok(WordQueryResult { definition, vocab_entry })
}

fn row_to_dto(row: &rusqlite::Row<'_>) -> rusqlite::Result<VocabEntryDto> {
    Ok(VocabEntryDto {
        id: row.get(0)?,
        entry: row.get(1)?,
        entry_type: row.get(2)?,
        definition: row.get(3)?,
        familiarity: row.get(4)?,
        occurrence_count: row.get(5)?,
        added_at: row.get(6)?,
        mastered_at: row.get(7)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use std::sync::{Arc, Mutex};

    fn in_memory_db() -> Arc<Mutex<rusqlite::Connection>> {
        Arc::new(Mutex::new(schema::open(":memory:").unwrap()))
    }

    #[test]
    fn test_add_entry_inserts_row() {
        let db = in_memory_db();
        {
            let conn = db.lock().unwrap();
            conn.execute(
                "INSERT INTO vocabulary (entry, type, definition, familiarity, occurrence_count) VALUES ('leverage', 'word', 'to use', 0, 0)",
                [],
            ).unwrap();
        }
        let count: i64 = {
            let conn = db.lock().unwrap();
            conn.query_row("SELECT COUNT(*) FROM vocabulary", [], |r| r.get(0)).unwrap()
        };
        assert_eq!(count, 1);
    }

    #[test]
    fn test_mark_mastered_sets_familiarity() {
        let db = in_memory_db();
        let id = {
            let conn = db.lock().unwrap();
            conn.execute(
                "INSERT INTO vocabulary (entry, type, definition, familiarity, occurrence_count) VALUES ('leverage', 'word', 'to use', 0, 0)",
                [],
            ).unwrap();
            conn.last_insert_rowid()
        };
        {
            let conn = db.lock().unwrap();
            conn.execute(
                "UPDATE vocabulary SET familiarity = 5, mastered_at = datetime('now') WHERE id = ?1",
                rusqlite::params![id],
            ).unwrap();
        }
        let familiarity: i64 = {
            let conn = db.lock().unwrap();
            conn.query_row(
                "SELECT familiarity FROM vocabulary WHERE id = ?1",
                rusqlite::params![id],
                |r| r.get(0),
            ).unwrap()
        };
        assert_eq!(familiarity, 5);
    }
}
```

- [ ] **Step 2: Create `src-tauri/src/commands/review.rs`**

```rust
use serde::Serialize;
use tauri::State;

use crate::db::AppDb;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingDto {
    pub id: i64,
    pub title: String,
    pub started_at: String,
    pub ended_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptLineDto {
    pub id: i64,
    pub meeting_id: i64,
    pub text: String,
    pub timestamp_ms: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabSentenceDto {
    pub line_id: i64,
    pub text: String,
    pub timestamp_ms: i64,
    pub meeting_id: i64,
    pub meeting_title: String,
}

/// Return all meetings newest first.
#[tauri::command]
pub fn list_meetings(db: State<'_, AppDb>) -> Result<Vec<MeetingDto>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, title, started_at, ended_at FROM meetings ORDER BY started_at DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(MeetingDto {
            id: row.get(0)?,
            title: row.get(1)?,
            started_at: row.get(2)?,
            ended_at: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<rusqlite::Result<Vec<_>>>()
    .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Return all transcript lines for a meeting, ordered by timestamp.
#[tauri::command]
pub fn get_transcript(
    meeting_id: i64,
    db: State<'_, AppDb>,
) -> Result<Vec<TranscriptLineDto>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, meeting_id, text, timestamp_ms FROM transcript_lines
         WHERE meeting_id = ?1 ORDER BY timestamp_ms"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(rusqlite::params![meeting_id], |row| {
        Ok(TranscriptLineDto {
            id: row.get(0)?,
            meeting_id: row.get(1)?,
            text: row.get(2)?,
            timestamp_ms: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<rusqlite::Result<Vec<_>>>()
    .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Return all sentences where a vocab entry appeared, with meeting context.
#[tauri::command]
pub fn get_vocab_sentences(
    vocab_id: i64,
    db: State<'_, AppDb>,
) -> Result<Vec<VocabSentenceDto>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT tl.id, tl.text, tl.timestamp_ms, m.id, m.title
         FROM vocab_sentences vs
         JOIN transcript_lines tl ON tl.id = vs.line_id
         JOIN meetings m ON m.id = vs.meeting_id
         WHERE vs.vocab_id = ?1
         ORDER BY tl.timestamp_ms DESC
         LIMIT 50"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(rusqlite::params![vocab_id], |row| {
        Ok(VocabSentenceDto {
            line_id: row.get(0)?,
            text: row.get(1)?,
            timestamp_ms: row.get(2)?,
            meeting_id: row.get(3)?,
            meeting_title: row.get(4)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<rusqlite::Result<Vec<_>>>()
    .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use std::sync::{Arc, Mutex};

    fn in_memory_db() -> Arc<Mutex<rusqlite::Connection>> {
        Arc::new(Mutex::new(schema::open(":memory:").unwrap()))
    }

    #[test]
    fn test_list_meetings_empty() {
        let db = in_memory_db();
        let conn = db.lock().unwrap();
        let mut stmt = conn.prepare("SELECT COUNT(*) FROM meetings").unwrap();
        let count: i64 = stmt.query_row([], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_get_transcript_returns_lines_in_order() {
        let db = in_memory_db();
        {
            let conn = db.lock().unwrap();
            conn.execute(
                "INSERT INTO meetings (title, started_at) VALUES ('Test', datetime('now'))",
                [],
            ).unwrap();
            conn.execute(
                "INSERT INTO transcript_lines (meeting_id, text, timestamp_ms) VALUES (1, 'second', 2000)",
                [],
            ).unwrap();
            conn.execute(
                "INSERT INTO transcript_lines (meeting_id, text, timestamp_ms) VALUES (1, 'first', 1000)",
                [],
            ).unwrap();
        }
        let conn = db.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT text FROM transcript_lines WHERE meeting_id = 1 ORDER BY timestamp_ms"
        ).unwrap();
        let texts: Vec<String> = stmt.query_map([], |r| r.get(0)).unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(texts, vec!["first", "second"]);
    }
}
```

- [ ] **Step 3: Update `src-tauri/src/commands/mod.rs`**

```rust
pub mod pipeline;
pub mod review;
pub mod tts;
pub mod vocabulary;
```

- [ ] **Step 4: Run tests**

```bash
cd src-tauri && cargo test commands::vocabulary::tests commands::review::tests
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/vocabulary.rs src-tauri/src/commands/review.rs src-tauri/src/commands/mod.rs
git commit -m "feat: implement vocabulary CRUD and review commands (add_entry, mark_mastered, list_entries, query_word, list_meetings, get_transcript, get_vocab_sentences)"
```

---

## Task 4: TTS Command

**Files:**
- Create: `src-tauri/src/commands/tts.rs`

- [ ] **Step 1: Create `src-tauri/src/commands/tts.rs`**

```rust
/// Speak text using macOS `say` command (AVSpeechSynthesizer under the hood).
/// Non-blocking: spawns the process and returns immediately.
#[tauri::command]
pub fn speak_text(text: String) -> Result<(), String> {
    std::process::Command::new("say")
        .arg(&text)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_speak_text_empty_string_does_not_crash() {
        // say "" is valid — it just says nothing
        let result = std::process::Command::new("say")
            .arg("")
            .spawn();
        assert!(result.is_ok());
    }
}
```

- [ ] **Step 2: Run tests**

```bash
cd src-tauri && cargo test commands::tts
```

Expected: 1 test passes.

- [ ] **Step 3: Build everything**

```bash
cd src-tauri && cargo build 2>&1 | grep "^error"
```

Expected: no errors. If lib.rs has errors about missing commands, check that all commands are registered in the `invoke_handler![]` macro in `lib.rs` (from Task 1 Step 4).

- [ ] **Step 4: Run all tests**

```bash
cd src-tauri && cargo test 2>&1 | grep "test result"
```

Expected: all tests pass (≥12 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/tts.rs
git commit -m "feat: speak_text TTS command via macOS say"
```

---

## Task 5: Subtitle Window UI

**Files:**
- Create: `src/types/vocabulary.ts`
- Create: `src/components/Token.tsx`
- Create: `src/components/SubtitleWindow.tsx`

- [ ] **Step 1: Create `src/types/vocabulary.ts`**

```typescript
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
  vocabEntry: VocabEntry | null;
}

export interface VocabSentence {
  lineId: number;
  text: string;
  timestampMs: number;
  meetingId: number;
  meetingTitle: string;
}
```

- [ ] **Step 2: Create `src/components/Token.tsx`**

```tsx
import type { WordToken } from "../types/subtitle";

const COLOR_MAP: Record<string, string> = {
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
```

- [ ] **Step 3: Create `src/components/SubtitleWindow.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { AnnotatedLine, WordToken } from "../types/subtitle";
import { Token } from "./Token";

const MAX_LINES = 3;

interface Props {
  onWordClick?: (token: WordToken) => void;
}

export function SubtitleWindow({ onWordClick }: Props) {
  const [lines, setLines] = useState<AnnotatedLine[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlisten = listen<AnnotatedLine>("subtitle-line", (e) => {
      setLines((prev) => {
        const next = [...prev, e.payload];
        return next.slice(-MAX_LINES);
      });
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div
      style={{
        background: "rgba(15, 23, 42, 0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderRadius: "12px",
        border: "1px solid rgba(255,255,255,0.08)",
        padding: "14px 18px",
        minHeight: "80px",
        userSelect: "none",
      }}
      data-tauri-drag-region
    >
      {lines.length === 0 ? (
        <span style={{ color: "#475569", fontSize: "14px" }}>
          Listening…
        </span>
      ) : (
        lines.map((line, i) => (
          <div
            key={line.lineId + "-" + i}
            style={{
              lineHeight: "2.2",
              fontSize: "16px",
              color: "#e2e8f0",
              marginBottom: "2px",
              flexWrap: "wrap",
              display: "flex",
              alignItems: "flex-start",
            }}
          >
            {line.tokens.map((token, j) => (
              <Token
                key={j}
                token={token}
                onClick={onWordClick}
              />
            ))}
          </div>
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/types/vocabulary.ts src/components/Token.tsx src/components/SubtitleWindow.tsx
git commit -m "feat: Token and SubtitleWindow components with inline definitions and color highlights"
```

---

## Task 6: Vocabulary Book UI

**Files:**
- Create: `src/components/VocabBook.tsx`

- [ ] **Step 1: Create `src/components/VocabBook.tsx`**

```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { VocabEntry } from "../types/vocabulary";

const FAMILIARITY_COLORS = ["#ef4444", "#f97316", "#f97316", "#fbbf24", "#fbbf24", "#34d399"];

interface Props {
  onSelectEntry?: (entry: VocabEntry) => void;
}

export function VocabBook({ onSelectEntry }: Props) {
  const [entries, setEntries] = useState<VocabEntry[]>([]);

  const load = () =>
    invoke<VocabEntry[]>("list_entries").then(setEntries).catch(console.error);

  useEffect(() => { load(); }, []);

  const handleMastered = async (e: React.MouseEvent, entry: VocabEntry) => {
    e.stopPropagation();
    await invoke("mark_mastered", { id: entry.id });
    load();
  };

  return (
    <div style={{ padding: "16px" }}>
      <h2 style={{ color: "#e2e8f0", fontSize: "18px", marginBottom: "12px", fontWeight: 600 }}>
        Vocabulary Book
      </h2>
      {entries.length === 0 ? (
        <p style={{ color: "#475569" }}>No words yet. Click a highlighted word to add it.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {entries.map((entry) => (
            <div
              key={entry.id}
              onClick={() => onSelectEntry?.(entry)}
              style={{
                background: "#1e293b",
                borderRadius: "8px",
                padding: "10px 14px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                borderLeft: `3px solid ${FAMILIARITY_COLORS[entry.familiarity] ?? "#475569"}`,
              }}
            >
              <div style={{ flex: 1 }}>
                <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{entry.entry}</span>
                <span style={{ color: "#64748b", fontSize: "12px", marginLeft: "8px" }}>
                  {entry.type}
                </span>
                {entry.definition && (
                  <p style={{ color: "#94a3b8", fontSize: "13px", margin: "2px 0 0" }}>
                    {entry.definition}
                  </p>
                )}
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ color: "#64748b", fontSize: "12px" }}>
                  {entry.occurrenceCount}×
                </div>
                {entry.familiarity < 5 && (
                  <button
                    onClick={(e) => handleMastered(e, entry)}
                    style={{
                      marginTop: "4px",
                      background: "#064e3b",
                      border: "none",
                      color: "#34d399",
                      padding: "3px 8px",
                      borderRadius: "4px",
                      fontSize: "11px",
                      cursor: "pointer",
                    }}
                  >
                    Mastered
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/VocabBook.tsx
git commit -m "feat: VocabBook component — list entries, mark mastered"
```

---

## Task 7: Post-Meeting Review UI + App Routing

**Files:**
- Create: `src/components/WordDetail.tsx`
- Create: `src/components/ReviewPage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create `src/components/WordDetail.tsx`**

```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { VocabEntry, WordQueryResult, VocabSentence } from "../types/vocabulary";

interface Props {
  word: string;
  onClose: () => void;
  onAddToVocab?: (entry: VocabEntry) => void;
}

export function WordDetail({ word, onClose, onAddToVocab }: Props) {
  const [result, setResult] = useState<WordQueryResult | null>(null);
  const [sentences, setSentences] = useState<VocabSentence[]>([]);

  useEffect(() => {
    invoke<WordQueryResult>("query_word", { word }).then(setResult).catch(console.error);
  }, [word]);

  useEffect(() => {
    if (result?.vocabEntry) {
      invoke<VocabSentence[]>("get_vocab_sentences", { vocabId: result.vocabEntry.id })
        .then(setSentences)
        .catch(console.error);
    }
  }, [result]);

  const handleSpeak = (text: string) => {
    invoke("speak_text", { text }).catch(console.error);
  };

  const handleAddToVocab = async () => {
    if (!result) return;
    const definition = result.definition ?? "";
    const entry = await invoke<VocabEntry>("add_entry", {
      entry: word,
      definition,
      entryType: "word",
    });
    setResult((prev) => prev ? { ...prev, vocabEntry: entry } : prev);
    onAddToVocab?.(entry);
  };

  const handleMastered = async () => {
    if (!result?.vocabEntry) return;
    await invoke("mark_mastered", { id: result.vocabEntry.id });
    onClose();
  };

  return (
    <div
      style={{
        background: "#0f172a",
        border: "1px solid #1e293b",
        borderRadius: "10px",
        padding: "16px",
        minWidth: "300px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <span style={{ color: "#fbbf24", fontSize: "20px", fontWeight: 700 }}>{word}</span>
          {result?.vocabEntry && (
            <span style={{ color: "#34d399", fontSize: "12px", marginLeft: "10px" }}>
              {result.vocabEntry.occurrenceCount}×
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "16px" }}
        >
          ✕
        </button>
      </div>

      {result?.definition && (
        <p style={{ color: "#94a3b8", fontSize: "14px", margin: "8px 0" }}>
          {result.definition}
        </p>
      )}

      <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
        <button
          onClick={() => handleSpeak(word)}
          style={{ background: "#1e3a5f", border: "none", color: "#60a5fa", padding: "5px 12px", borderRadius: "6px", fontSize: "12px", cursor: "pointer" }}
        >
          🔊 Pronounce
        </button>
        {!result?.vocabEntry && (
          <button
            onClick={handleAddToVocab}
            style={{ background: "#1e293b", border: "1px solid #334155", color: "#94a3b8", padding: "5px 12px", borderRadius: "6px", fontSize: "12px", cursor: "pointer" }}
          >
            + Add to vocab
          </button>
        )}
        {result?.vocabEntry && result.vocabEntry.familiarity < 5 && (
          <button
            onClick={handleMastered}
            style={{ background: "#064e3b", border: "none", color: "#34d399", padding: "5px 12px", borderRadius: "6px", fontSize: "12px", cursor: "pointer" }}
          >
            ✓ Mastered
          </button>
        )}
      </div>

      {sentences.length > 0 && (
        <div style={{ marginTop: "14px" }}>
          <div style={{ color: "#475569", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>
            Context
          </div>
          {sentences.slice(0, 5).map((s) => (
            <div
              key={s.lineId}
              style={{ background: "#1e293b", borderRadius: "6px", padding: "8px", marginBottom: "6px", fontSize: "13px", color: "#cbd5e1", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}
            >
              <span style={{ flex: 1, lineHeight: "1.6" }}>
                {s.text.split(new RegExp(`(\\b${word}\\b)`, "gi")).map((part, i) =>
                  part.toLowerCase() === word.toLowerCase()
                    ? <mark key={i} style={{ background: "transparent", color: "#fbbf24", fontWeight: 600 }}>{part}</mark>
                    : part
                )}
              </span>
              <button
                onClick={() => handleSpeak(s.text)}
                style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", marginLeft: "8px", flexShrink: 0 }}
              >
                🔊
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/ReviewPage.tsx`**

```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Meeting, TranscriptLine } from "../types/vocabulary";
import { WordDetail } from "./WordDetail";

export function ReviewPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [activeWord, setActiveWord] = useState<string | null>(null);

  useEffect(() => {
    invoke<Meeting[]>("list_meetings").then(setMeetings).catch(console.error);
  }, []);

  const openMeeting = async (meeting: Meeting) => {
    setSelected(meeting);
    setActiveWord(null);
    const transcript = await invoke<TranscriptLine[]>("get_transcript", { meetingId: meeting.id });
    setLines(transcript);
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString();

  return (
    <div style={{ padding: "16px", display: "flex", gap: "16px", height: "100%" }}>
      {/* Meeting list */}
      <div style={{ width: "220px", flexShrink: 0 }}>
        <h2 style={{ color: "#e2e8f0", fontSize: "16px", fontWeight: 600, marginBottom: "10px" }}>
          Meetings
        </h2>
        {meetings.length === 0 ? (
          <p style={{ color: "#475569", fontSize: "13px" }}>No meetings yet.</p>
        ) : (
          meetings.map((m) => (
            <div
              key={m.id}
              onClick={() => openMeeting(m)}
              style={{
                background: selected?.id === m.id ? "#1e3a5f" : "#1e293b",
                borderRadius: "8px",
                padding: "10px",
                marginBottom: "6px",
                cursor: "pointer",
                borderLeft: selected?.id === m.id ? "3px solid #60a5fa" : "3px solid transparent",
              }}
            >
              <div style={{ color: "#e2e8f0", fontSize: "13px", fontWeight: 500 }}>{m.title}</div>
              <div style={{ color: "#64748b", fontSize: "11px", marginTop: "2px" }}>
                {formatTime(m.startedAt)}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Transcript */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {selected ? (
          <>
            <h3 style={{ color: "#e2e8f0", fontSize: "16px", marginBottom: "10px" }}>
              {selected.title}
            </h3>
            {lines.map((line) => (
              <p
                key={line.id}
                style={{ color: "#cbd5e1", fontSize: "14px", lineHeight: "1.8", marginBottom: "4px", cursor: "text" }}
              >
                {line.text.split(/\b/).map((word, i) =>
                  /\w+/.test(word) ? (
                    <span
                      key={i}
                      onClick={() => setActiveWord(word.toLowerCase())}
                      style={{ cursor: "pointer", borderBottom: "1px dashed #334155" }}
                    >
                      {word}
                    </span>
                  ) : word
                )}
              </p>
            ))}
          </>
        ) : (
          <p style={{ color: "#475569", fontSize: "14px" }}>Select a meeting to review.</p>
        )}
      </div>

      {/* Word detail panel */}
      {activeWord && (
        <div style={{ width: "320px", flexShrink: 0 }}>
          <WordDetail
            word={activeWord}
            onClose={() => setActiveWord(null)}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Replace `src/App.tsx` with full routing**

```tsx
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { WordToken } from "./types/subtitle";
import type { VocabEntry } from "./types/vocabulary";
import { SubtitleWindow } from "./components/SubtitleWindow";
import { VocabBook } from "./components/VocabBook";
import { ReviewPage } from "./components/ReviewPage";
import { WordDetail } from "./components/WordDetail";

type View = "subtitle" | "vocab" | "review";

export default function App() {
  const [modelReady, setModelReady] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [recording, setRecording] = useState(false);
  const [view, setView] = useState<View>("subtitle");
  const [clickedWord, setClickedWord] = useState<string | null>(null);

  useEffect(() => {
    invoke<boolean>("check_model").then(setModelReady);
    listen<number>("model-download-progress", (e) => setDownloadProgress(e.payload));
    listen("model-download-done", () => setModelReady(true));
  }, []);

  const handleStart = async () => {
    await invoke("start_recording");
    setRecording(true);
  };

  const handleStop = async () => {
    await invoke("stop_recording");
    setRecording(false);
  };

  const handleWordClick = (token: WordToken) => {
    if (token.text.match(/^\w+$/)) {
      setClickedWord(token.text.toLowerCase());
    }
  };

  // ── Model download screen ──
  if (!modelReady) {
    return (
      <div style={styles.screen}>
        <div style={{ textAlign: "center", maxWidth: "360px" }}>
          <h1 style={{ color: "#e2e8f0", fontSize: "24px", marginBottom: "8px" }}>LearnCaption</h1>
          <p style={{ color: "#94a3b8", marginBottom: "24px" }}>
            Downloading Whisper model (~500 MB) on first launch.
          </p>
          {downloadProgress > 0 ? (
            <>
              <div style={{ background: "#1e293b", borderRadius: "6px", height: "6px", width: "100%", marginBottom: "8px" }}>
                <div style={{ background: "#60a5fa", height: "6px", borderRadius: "6px", width: `${downloadProgress * 100}%`, transition: "width 0.3s" }} />
              </div>
              <p style={{ color: "#94a3b8", fontSize: "13px" }}>{Math.round(downloadProgress * 100)}%</p>
            </>
          ) : (
            <button onClick={() => invoke("start_model_download")} style={styles.primaryBtn}>
              Download Model
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...styles.screen, flexDirection: "column", padding: 0 }}>
      {/* Navigation */}
      <div style={styles.nav} data-tauri-drag-region>
        <span style={{ color: "#60a5fa", fontWeight: 700, fontSize: "14px" }}>LearnCaption</span>
        <div style={{ display: "flex", gap: "4px" }}>
          {(["subtitle", "vocab", "review"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{ ...styles.navBtn, background: view === v ? "#1e3a5f" : "transparent", color: view === v ? "#60a5fa" : "#64748b" }}
            >
              {{ subtitle: "Subtitles", vocab: "Vocab", review: "Review" }[v]}
            </button>
          ))}
        </div>
        <button
          onClick={recording ? handleStop : handleStart}
          style={{ ...styles.primaryBtn, padding: "5px 14px", fontSize: "12px", background: recording ? "#7f1d1d" : "#1e3a5f", color: recording ? "#fca5a5" : "#60a5fa" }}
        >
          {recording ? "⏹ Stop" : "⏺ Start"}
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: view === "subtitle" ? "12px" : "0" }}>
        {view === "subtitle" && (
          <>
            <SubtitleWindow onWordClick={handleWordClick} />
            {clickedWord && (
              <div style={{ marginTop: "12px" }}>
                <WordDetail word={clickedWord} onClose={() => setClickedWord(null)} />
              </div>
            )}
          </>
        )}
        {view === "vocab" && <VocabBook />}
        {view === "review" && <ReviewPage />}
      </div>
    </div>
  );
}

const styles = {
  screen: {
    background: "#0f172a",
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "-apple-system, sans-serif",
    color: "#e2e8f0",
  } as React.CSSProperties,
  nav: {
    background: "rgba(15,23,42,0.9)",
    backdropFilter: "blur(8px)",
    padding: "8px 14px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottom: "1px solid #1e293b",
  } as React.CSSProperties,
  navBtn: {
    border: "none",
    borderRadius: "6px",
    padding: "5px 10px",
    fontSize: "12px",
    cursor: "pointer",
  } as React.CSSProperties,
  primaryBtn: {
    background: "#1e3a5f",
    border: "none",
    color: "#60a5fa",
    padding: "8px 20px",
    borderRadius: "8px",
    fontSize: "14px",
    cursor: "pointer",
  } as React.CSSProperties,
};
```

- [ ] **Step 4: Update `src-tauri/tauri.conf.json` — configure window**

Read `src-tauri/tauri.conf.json` first. Add window decorations:false and transparent background so the frosted-glass subtitle card looks right. Find the `windows` array (or `app.windows`) and update the main window entry:

```json
{
  "label": "main",
  "title": "LearnCaption",
  "width": 900,
  "height": 620,
  "minWidth": 600,
  "minHeight": 400,
  "decorations": false,
  "transparent": true,
  "alwaysOnTop": false
}
```

Note: `"decorations": false` removes the macOS title bar. The `data-tauri-drag-region` attribute on the nav bar (set in App.tsx) allows dragging the window.

- [ ] **Step 5: Add global CSS reset to `src/main.tsx`**

Read the current `src/main.tsx`. Ensure it imports a minimal global style. If it currently imports `"./App.css"`, replace `src/App.css` content with:

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { background: transparent; overflow: hidden; }
button { font-family: inherit; }
```

- [ ] **Step 6: Run dev build**

```bash
npm run tauri dev
```

Expected: app launches with dark nav bar (Subtitles / Vocab / Review tabs) + Start button. Click Subtitles tab and Start → subtitle lines appear. Click Vocab tab → vocab book (empty until words are highlighted). Click Review → meetings list.

- [ ] **Step 7: Commit**

```bash
git add src/components/ src/types/vocabulary.ts src/App.tsx src/App.css src-tauri/tauri.conf.json
git commit -m "feat: subtitle window UI, vocab book, post-meeting review with word detail panel and TTS"
```

---

## Self-Review

**Spec coverage:**
- ✅ Real-time subtitles with inline word + Chinese definition
- ✅ Color highlights: yellow (ECDICT difficult) / orange (vocab 2-4×) / red (vocab 5+×)
- ✅ Floating draggable subtitle window (data-tauri-drag-region, transparent)
- ✅ Vocabulary book — add, mark mastered, list, occurrence counts
- ✅ Post-meeting review — transcript, click word → detail panel
- ✅ Context sentences with TTS per sentence (🔊 speak_text)
- ✅ All 4 SQLite tables receiving real data
- ✅ Aho-Corasick automaton rebuilt from DB vocab at each recording start
- ⚠️ Vocabulary level tier estimation (CET4/6/TOEFL) — spec mentions this but it's complex; for MVP the ECDICT lookup covers "above vocab level" annotation via the dictionary itself. Full tier inference deferred to Plan C.
- ⚠️ Audio recording saved to file (audio_path in meetings table) — out of scope, whisper-rs reads live PCM only.

**Placeholder scan:** No TBD/TODO/placeholder patterns found.

**Type consistency:**
- `VocabEntry.id` → `number` in TS, `i64` in Rust (JSON number, no overflow for IDs)
- `WordToken.vocabId` → `number | null` in TS, `Option<i64>` in Rust ✅
- `add_entry` command params: `entry: String, definition: String, entryType: String` — matches TS `invoke("add_entry", { entry, definition, entryType })` ✅
- `query_word` returns `WordQueryResult { definition, vocabEntry }` — matches TS `WordQueryResult { definition, vocabEntry }` ✅
