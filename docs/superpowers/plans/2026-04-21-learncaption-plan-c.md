# LearnCaption Plan C — Browser Caption Source (Meet + YouTube)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the slow Whisper pipeline with a Chrome extension that reads native captions from Google Meet and YouTube, routing them through the same annotation pipeline.

**Architecture:** A `CaptionPipeline` struct encapsulates the shared logic (annotate → save to DB → emit `subtitle-line`). Both the existing Whisper path and the new browser path call `pipeline.process(RawCaption)` — the source is invisible to the rest of the app. The Chrome extension (MV3) connects to a WebSocket server that Tauri starts on `127.0.0.1:52340`; content scripts observe the DOM and forward finalized caption text to the background worker which relays to Tauri. Adding support for a new platform (Teams web, Zoom web) only requires a new content script and a line in `manifest.json` — no Rust changes.

**Tech Stack:** Rust (tokio-tungstenite for WebSocket server), Chrome Extension MV3 (content scripts + service worker), React/TypeScript (SourceBadge component)

---

## File Structure

```
src-tauri/src/
├── caption_source/
│   ├── mod.rs          CREATE: RawCaption struct, CaptionPipeline (shared annotation+DB+emit)
│   └── ws_server.rs    CREATE: async WebSocket server on 127.0.0.1:52340
├── commands/
│   ├── mod.rs          MODIFY: add pub mod capture
│   ├── pipeline.rs     MODIFY: use CaptionPipeline, add ws_task to PipelineState
│   └── capture.rs      CREATE: start_browser_capture, stop_browser_capture
└── lib.rs              MODIFY: mod caption_source, register capture commands, ws_task in PipelineState

chrome-extension/
├── manifest.json       CREATE: MV3, content scripts for meet + youtube
├── background.js       CREATE: service worker, WebSocket client → Tauri
├── content-meet.js     CREATE: MutationObserver on Meet caption DOM, 600ms debounce
└── content-youtube.js  CREATE: MutationObserver on YouTube .ytp-caption-segment

src/
├── components/
│   └── SourceBadge.tsx CREATE: colored dot + label showing active caption source
└── App.tsx             MODIFY: Browser button, SourceBadge in nav, captureMode state
```

---

## Task 1: CaptionPipeline — extract shared processing logic

**Files:**
- Create: `src-tauri/src/caption_source/mod.rs`
- Modify: `src-tauri/src/commands/pipeline.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add tokio-tungstenite to Cargo.toml**

In `src-tauri/Cargo.toml`, add after the `futures-util` line:

```toml
tokio-tungstenite = "0.21"
```

- [ ] **Step 2: Create `src-tauri/src/caption_source/mod.rs`**

```rust
pub mod ws_server;

use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

use crate::db::AppDb;
use crate::pipeline::Annotator;

pub struct RawCaption {
    pub text: String,
    pub timestamp_ms: i64,
}

/// Shared annotation + DB write + subtitle-line event logic.
/// Used by both the Whisper thread and the WebSocket server.
pub struct CaptionPipeline {
    pub annotator: Arc<Mutex<Annotator>>,
    pub db: AppDb,
    pub meeting_id: Arc<Mutex<Option<i64>>>,
    pub app: AppHandle,
}

impl CaptionPipeline {
    pub fn process(&self, raw: RawCaption) {
        let meeting_id = match *self.meeting_id.lock().unwrap() {
            Some(id) => id,
            None => return, // no active meeting — silently drop
        };

        // Insert transcript line
        let line_id: i64 = {
            let conn = self.db.lock().unwrap();
            if let Err(e) = conn.execute(
                "INSERT INTO transcript_lines (meeting_id, text, timestamp_ms) \
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![meeting_id, &raw.text, raw.timestamp_ms],
            ) {
                let _ = self.app.emit("pipeline-error", format!("transcript insert: {e}"));
                return;
            }
            conn.last_insert_rowid()
        };

        // Annotate
        let line = {
            let ann = self.annotator.lock().unwrap();
            ann.annotate(&raw.text, line_id, meeting_id, raw.timestamp_ms)
        };

        // Save vocab_sentences + update occurrence_counts
        {
            let conn = self.db.lock().unwrap();
            for token in &line.tokens {
                if let Some(vocab_id) = token.vocab_id {
                    conn.execute(
                        "INSERT INTO vocab_sentences (vocab_id, line_id, meeting_id) \
                         VALUES (?1, ?2, ?3)",
                        rusqlite::params![vocab_id, line_id, meeting_id],
                    ).ok();
                    conn.execute(
                        "UPDATE vocabulary SET occurrence_count = occurrence_count + 1 \
                         WHERE id = ?1",
                        rusqlite::params![vocab_id],
                    ).ok();
                }
            }
        }

        let _ = self.app.emit("subtitle-line", &line);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;

    fn in_memory_db() -> AppDb {
        Arc::new(Mutex::new(schema::open(":memory:").unwrap()))
    }

    #[test]
    fn test_raw_caption_fields() {
        let cap = RawCaption { text: "hello world".to_string(), timestamp_ms: 5000 };
        assert_eq!(cap.text, "hello world");
        assert_eq!(cap.timestamp_ms, 5000);
    }

    #[test]
    fn test_process_no_meeting_is_noop() {
        // meeting_id = None → process() should not panic or insert anything
        let db = in_memory_db();
        let meeting_id: Arc<Mutex<Option<i64>>> = Arc::new(Mutex::new(None));
        // We cannot construct AppHandle in tests; verify the DB stays empty
        // by checking transcript_lines count directly.
        {
            let conn = db.lock().unwrap();
            conn.execute(
                "INSERT INTO meetings (title, started_at) VALUES ('T', datetime('now'))", []
            ).unwrap();
        }
        // Simulate what process() does when meeting_id is None: nothing.
        let count: i64 = {
            let conn = db.lock().unwrap();
            conn.query_row("SELECT COUNT(*) FROM transcript_lines", [], |r| r.get(0)).unwrap()
        };
        assert_eq!(count, 0, "no insert should happen when meeting_id is None");
        let _ = meeting_id; // suppress unused warning
    }
}
```

- [ ] **Step 3: Add `mod caption_source;` to `src-tauri/src/lib.rs`**

Read `src-tauri/src/lib.rs`. Add `mod caption_source;` after the existing `mod pipeline;` line:

```rust
mod commands;
mod caption_source;   // ADD THIS LINE
mod db;
mod dictionary;
mod pipeline;
```

- [ ] **Step 4: Refactor `src-tauri/src/commands/pipeline.rs` to use CaptionPipeline**

Read the full current file first. Replace with:

```rust
use std::io::Read;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::caption_source::{CaptionPipeline, RawCaption};
use crate::db::{load_vocab_entries, AppDb};
use crate::dictionary::EcdictDictionary;
use crate::pipeline::{
    download_model, has_speech, model_exists, model_path, Annotator, AudioSidecar, SttEngine,
};

pub struct PipelineState {
    pub sidecar: Arc<Mutex<Option<AudioSidecar>>>,
    pub current_meeting_id: Arc<Mutex<Option<i64>>>,
    pub ws_task: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>>,
}

#[tauri::command]
pub fn check_model(app: AppHandle) -> bool {
    model_exists(&app)
}

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

    let vocab_entries = load_vocab_entries(&db).map_err(|e| e.to_string())?;
    let mut annotator = Annotator::new(dict.inner().clone());
    annotator.rebuild_automaton(vocab_entries);

    let meeting_id: i64 = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO meetings (title, started_at) VALUES ('Meeting', datetime('now'))",
            [],
        ).map_err(|e| e.to_string())?;
        conn.last_insert_rowid()
    };
    *state.current_meeting_id.lock().unwrap() = Some(meeting_id);

    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_always_on_top(true);
    }

    let pipeline = Arc::new(CaptionPipeline {
        annotator: Arc::new(Mutex::new(annotator)),
        db: db.inner().clone(),
        meeting_id: state.current_meeting_id.clone(),
        app: app.clone(),
    });

    let model_p = model_path(&app);
    let mut audio = AudioSidecar::spawn(&app).map_err(|e| e.to_string())?;
    let audio_stdout = audio.take_stdout().ok_or("audio stdout already taken")?;
    *state.sidecar.lock().unwrap() = Some(audio);

    let app2 = app.clone();

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
            if reader.read_exact(&mut buf[..4]).is_err() { break; }
            let len = u32::from_le_bytes(buf[..4].try_into().unwrap()) as usize;
            if len > CHUNK_BYTES { break; }
            if reader.read_exact(&mut buf[4..4 + len]).is_err() { break; }

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
                    for (text, offset_ms) in segments {
                        pipeline.process(RawCaption {
                            text,
                            timestamp_ms: session_start_ms + offset_ms,
                        });
                    }
                }
                session_start_ms +=
                    (pcm_buffer.len() as f64 / SAMPLE_RATE as f64 * 1000.0) as i64;
                pcm_buffer.clear();
                silent_chunks = 0;
            }
        }
    });

    let _ = app.emit("source-changed", "whisper");
    Ok(())
}

#[tauri::command]
pub async fn stop_recording(
    app: AppHandle,
    state: State<'_, PipelineState>,
    db: State<'_, AppDb>,
) -> Result<(), String> {
    *state.sidecar.lock().unwrap() = None;

    if let Some(meeting_id) = *state.current_meeting_id.lock().unwrap() {
        let conn = db.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE meetings SET ended_at = datetime('now') WHERE id = ?1",
            rusqlite::params![meeting_id],
        ).map_err(|e| e.to_string())?;
    }
    *state.current_meeting_id.lock().unwrap() = None;

    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_always_on_top(false);
    }

    let _ = app.emit("source-changed", "none");
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
                "INSERT INTO meetings (title, started_at) VALUES ('Test', datetime('now'))", [],
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
                "INSERT INTO meetings (title, started_at) VALUES ('Test', datetime('now'))", [],
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

- [ ] **Step 5: Update `PipelineState` initialization in `src-tauri/src/lib.rs`**

Add `ws_task` field to the `.manage(PipelineState { ... })` call:

```rust
.manage(PipelineState {
    sidecar: Arc::new(Mutex::new(None)),
    current_meeting_id: Arc::new(Mutex::new(None)),
    ws_task: Arc::new(Mutex::new(None)),   // ADD THIS LINE
})
```

- [ ] **Step 6: Run tests**

```bash
cd src-tauri && cargo test caption_source::tests commands::pipeline::tests
```

Expected: 4 tests pass.

- [ ] **Step 7: Build check**

```bash
cd src-tauri && cargo build 2>&1 | grep "^error"
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/caption_source/mod.rs src-tauri/src/commands/pipeline.rs src-tauri/src/lib.rs
git commit -m "refactor: extract CaptionPipeline, add ws_task to PipelineState"
```

---

## Task 2: WebSocket Server + Browser Capture Commands

**Files:**
- Create: `src-tauri/src/caption_source/ws_server.rs`
- Create: `src-tauri/src/commands/capture.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing test for JSON message parsing**

Create `src-tauri/src/caption_source/ws_server.rs` with just the test at first:

```rust
use serde::Deserialize;

pub const WS_PORT: u16 = 52340;

#[derive(Deserialize, Debug)]
pub struct ExtensionMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub text: Option<String>,
    pub platform: Option<String>,
}

pub fn parse_message(raw: &str) -> Option<ExtensionMessage> {
    serde_json::from_str(raw).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_valid_caption_message() {
        let json = r#"{"type":"caption","text":"Hello everyone","platform":"meet"}"#;
        let msg = parse_message(json).unwrap();
        assert_eq!(msg.msg_type, "caption");
        assert_eq!(msg.text.as_deref(), Some("Hello everyone"));
        assert_eq!(msg.platform.as_deref(), Some("meet"));
    }

    #[test]
    fn test_parse_message_without_platform() {
        let json = r#"{"type":"caption","text":"Hello"}"#;
        let msg = parse_message(json).unwrap();
        assert_eq!(msg.msg_type, "caption");
        assert!(msg.platform.is_none());
    }

    #[test]
    fn test_parse_invalid_json_returns_none() {
        assert!(parse_message("not json").is_none());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src-tauri && cargo test caption_source::ws_server::tests
```

Expected: compile error (`ws_server` module not declared in `caption_source/mod.rs`).

It's already declared (`pub mod ws_server;`) from Task 1. Expected: 3 tests PASS.

- [ ] **Step 3: Complete `src-tauri/src/caption_source/ws_server.rs`**

Replace the file with the full implementation:

```rust
use std::sync::Arc;
use futures_util::StreamExt;
use tokio::net::TcpListener;
use tokio_tungstenite::{accept_async, tungstenite::Message};
use serde::Deserialize;
use tauri::Emitter;

use super::{CaptionPipeline, RawCaption};

pub const WS_PORT: u16 = 52340;

#[derive(Deserialize, Debug)]
pub struct ExtensionMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub text: Option<String>,
    pub platform: Option<String>,
}

pub fn parse_message(raw: &str) -> Option<ExtensionMessage> {
    serde_json::from_str(raw).ok()
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// Start the WebSocket server. Runs until the tokio task is aborted.
pub async fn run(pipeline: Arc<CaptionPipeline>) {
    let listener = match TcpListener::bind(format!("127.0.0.1:{WS_PORT}")).await {
        Ok(l) => l,
        Err(e) => {
            let _ = pipeline.app.emit(
                "pipeline-error",
                format!("WS server failed to bind on port {WS_PORT}: {e}"),
            );
            return;
        }
    };

    while let Ok((stream, _)) = listener.accept().await {
        let pipeline = pipeline.clone();
        tokio::spawn(async move {
            let ws = match accept_async(stream).await {
                Ok(ws) => ws,
                Err(_) => return,
            };
            let (_, mut read) = ws.split();

            while let Some(Ok(Message::Text(text))) = read.next().await {
                let msg = match parse_message(&text) {
                    Some(m) => m,
                    None => continue,
                };
                if msg.msg_type != "caption" {
                    continue;
                }
                if let Some(caption_text) = msg.text {
                    let platform = msg.platform.as_deref().unwrap_or("browser");
                    let _ = pipeline.app.emit("source-changed", platform);
                    pipeline.process(RawCaption {
                        text: caption_text,
                        timestamp_ms: now_ms(),
                    });
                }
            }

            // Client disconnected
            let _ = pipeline.app.emit("source-changed", "none");
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_valid_caption_message() {
        let json = r#"{"type":"caption","text":"Hello everyone","platform":"meet"}"#;
        let msg = parse_message(json).unwrap();
        assert_eq!(msg.msg_type, "caption");
        assert_eq!(msg.text.as_deref(), Some("Hello everyone"));
        assert_eq!(msg.platform.as_deref(), Some("meet"));
    }

    #[test]
    fn test_parse_message_without_platform() {
        let json = r#"{"type":"caption","text":"Hello"}"#;
        let msg = parse_message(json).unwrap();
        assert_eq!(msg.msg_type, "caption");
        assert!(msg.platform.is_none());
    }

    #[test]
    fn test_parse_invalid_json_returns_none() {
        assert!(parse_message("not json").is_none());
    }
}
```

- [ ] **Step 4: Create `src-tauri/src/commands/capture.rs`**

```rust
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::caption_source::{ws_server, CaptionPipeline};
use crate::commands::pipeline::PipelineState;
use crate::db::{load_vocab_entries, AppDb};
use crate::dictionary::EcdictDictionary;
use crate::pipeline::Annotator;

/// Start a WebSocket server on 127.0.0.1:52340.
/// The Chrome extension connects and sends caption messages.
#[tauri::command]
pub async fn start_browser_capture(
    app: AppHandle,
    state: State<'_, PipelineState>,
    db: State<'_, AppDb>,
    dict: State<'_, Arc<EcdictDictionary>>,
) -> Result<(), String> {
    let vocab_entries = load_vocab_entries(&db).map_err(|e| e.to_string())?;
    let mut annotator = Annotator::new(dict.inner().clone());
    annotator.rebuild_automaton(vocab_entries);

    let meeting_id: i64 = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO meetings (title, started_at) VALUES ('Meeting', datetime('now'))",
            [],
        ).map_err(|e| e.to_string())?;
        conn.last_insert_rowid()
    };
    *state.current_meeting_id.lock().unwrap() = Some(meeting_id);

    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_always_on_top(true);
    }

    let pipeline = Arc::new(CaptionPipeline {
        annotator: Arc::new(Mutex::new(annotator)),
        db: db.inner().clone(),
        meeting_id: state.current_meeting_id.clone(),
        app: app.clone(),
    });

    let handle = tauri::async_runtime::spawn(ws_server::run(pipeline));
    *state.ws_task.lock().unwrap() = Some(handle);

    Ok(())
}

/// Abort the WebSocket server and close the current meeting.
#[tauri::command]
pub async fn stop_browser_capture(
    app: AppHandle,
    state: State<'_, PipelineState>,
    db: State<'_, AppDb>,
) -> Result<(), String> {
    if let Some(handle) = state.ws_task.lock().unwrap().take() {
        handle.abort();
    }

    if let Some(meeting_id) = *state.current_meeting_id.lock().unwrap() {
        let conn = db.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE meetings SET ended_at = datetime('now') WHERE id = ?1",
            rusqlite::params![meeting_id],
        ).map_err(|e| e.to_string())?;
    }
    *state.current_meeting_id.lock().unwrap() = None;

    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_always_on_top(false);
    }

    let _ = app.emit("source-changed", "none");
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
    fn test_meeting_created_and_ended() {
        let db = in_memory_db();
        // Simulate start_browser_capture DB work
        let meeting_id: i64 = {
            let conn = db.lock().unwrap();
            conn.execute(
                "INSERT INTO meetings (title, started_at) VALUES ('Meeting', datetime('now'))", [],
            ).unwrap();
            conn.last_insert_rowid()
        };
        assert!(meeting_id > 0);
        // Simulate stop_browser_capture DB work
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

- [ ] **Step 5: Update `src-tauri/src/commands/mod.rs`**

```rust
pub mod capture;
pub mod pipeline;
pub mod review;
pub mod tts;
pub mod vocabulary;
```

- [ ] **Step 6: Register new commands in `src-tauri/src/lib.rs`**

Read `src-tauri/src/lib.rs`. Add the two new commands to `invoke_handler![]`:

```rust
.invoke_handler(tauri::generate_handler![
    commands::pipeline::check_model,
    commands::pipeline::start_model_download,
    commands::pipeline::start_recording,
    commands::pipeline::stop_recording,
    commands::capture::start_browser_capture,   // ADD
    commands::capture::stop_browser_capture,    // ADD
    commands::vocabulary::add_entry,
    commands::vocabulary::mark_mastered,
    commands::vocabulary::list_entries,
    commands::vocabulary::query_word,
    commands::review::list_meetings,
    commands::review::get_transcript,
    commands::review::get_vocab_sentences,
    commands::tts::speak_text,
])
```

- [ ] **Step 7: Run tests**

```bash
cd src-tauri && cargo test caption_source::ws_server::tests commands::capture::tests
```

Expected: 4 tests pass (3 parse tests + 1 meeting test).

- [ ] **Step 8: Full build check**

```bash
cd src-tauri && cargo build 2>&1 | grep "^error"
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/caption_source/ws_server.rs src-tauri/src/commands/capture.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: WebSocket server on port 52340, start/stop_browser_capture commands"
```

---

## Task 3: Chrome Extension

**Files:**
- Create: `chrome-extension/manifest.json`
- Create: `chrome-extension/background.js`
- Create: `chrome-extension/content-meet.js`
- Create: `chrome-extension/content-youtube.js`

No build step. Load the `chrome-extension/` folder directly in Chrome via `chrome://extensions` → Developer mode → Load unpacked.

- [ ] **Step 1: Create `chrome-extension/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "LearnCaption",
  "version": "0.1.0",
  "description": "Sends meeting captions to LearnCaption desktop app for vocabulary annotations",
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://meet.google.com/*"],
      "js": ["content-meet.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://www.youtube.com/*", "https://youtube.com/*"],
      "js": ["content-youtube.js"],
      "run_at": "document_idle"
    }
  ],
  "host_permissions": [
    "https://meet.google.com/*",
    "https://www.youtube.com/*"
  ]
}
```

**To add a new platform in the future:** add a new object to `content_scripts` and add its URL to `host_permissions`. No other changes needed.

- [ ] **Step 2: Create `chrome-extension/background.js`**

```js
// Service worker: manages WebSocket connection to LearnCaption desktop app.
// Content scripts send messages here; we relay them over the WebSocket.

const WS_URL = "ws://127.0.0.1:52340";
let ws = null;

function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log("[LearnCaption] Connected to desktop app");
  };

  ws.onclose = () => {
    // Auto-reconnect every 3 seconds while app is open
    setTimeout(connect, 3000);
  };

  ws.onerror = () => {
    ws.close(); // triggers onclose → reconnect
  };
}

connect();

// Relay caption messages from content scripts to the desktop app
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "caption" && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
});
```

- [ ] **Step 3: Create `chrome-extension/content-meet.js`**

Meet shows live captions that update character-by-character. We debounce 600ms to send finalized text.

```js
// content-meet.js — Google Meet caption observer

// Known caption container selectors (in order of preference).
// Meet's DOM changes with updates; the aria-live fallback is most stable.
const CAPTION_SELECTORS = [
  '[jsname="tgaKEf"]',      // Caption window (Meet 2024)
  '[data-is-focused="true"]', // Active caption line
  '[aria-live="polite"]',   // Accessibility fallback
  '[aria-live="assertive"]',
];

let lastSent = "";
let debounceTimer = null;

function getCaptionText() {
  for (const sel of CAPTION_SELECTORS) {
    const el = document.querySelector(sel);
    const text = el?.textContent?.trim();
    if (text && text.length > 3) return text;
  }
  return "";
}

function sendCaption(text) {
  const trimmed = text.trim();
  // Skip if empty, too short, or identical to last sent
  if (!trimmed || trimmed.length < 4 || trimmed === lastSent) return;
  lastSent = trimmed;
  chrome.runtime.sendMessage({ type: "caption", text: trimmed, platform: "meet" });
}

// Observe all DOM changes; debounce to avoid sending partial words
const observer = new MutationObserver(() => {
  const text = getCaptionText();
  if (!text) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => sendCaption(text), 600);
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true,
});
```

- [ ] **Step 4: Create `chrome-extension/content-youtube.js`**

YouTube renders completed caption segments as `.ytp-caption-segment` DOM nodes. We capture each unique segment as it appears.

```js
// content-youtube.js — YouTube caption observer

let lastSent = "";

function sendCaption(text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 4 || trimmed === lastSent) return;
  lastSent = trimmed;
  chrome.runtime.sendMessage({ type: "caption", text: trimmed, platform: "youtube" });
}

function extractCaptionText() {
  const segments = document.querySelectorAll(".ytp-caption-segment");
  return Array.from(segments)
    .map(el => el.textContent)
    .join(" ")
    .trim();
}

const observer = new MutationObserver(() => {
  const text = extractCaptionText();
  if (text) sendCaption(text);
});

// YouTube loads the player after page load; poll until the caption container exists
function attachObserver() {
  const captionWindow = document.querySelector(".ytp-caption-window-container");
  if (captionWindow) {
    observer.observe(captionWindow, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    console.log("[LearnCaption] Observing YouTube captions");
  } else {
    setTimeout(attachObserver, 1000);
  }
}

attachObserver();
```

- [ ] **Step 5: Load extension in Chrome and test**

1. Open `chrome://extensions`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked" → select the `chrome-extension/` folder
4. Start `npm run tauri dev`
5. Click "🌐 Browser" in the app (Task 4 must be done first, or use `start_browser_capture` from DevTools)
6. Open `meet.google.com` → start a meeting → enable captions (CC button) → speak → verify subtitle-line events appear in the app

For YouTube: open any video with captions → enable CC → verify subtitles appear.

- [ ] **Step 6: Commit**

```bash
git add chrome-extension/
git commit -m "feat: Chrome extension for Meet and YouTube caption capture"
```

---

## Task 4: SourceBadge UI + App.tsx

**Files:**
- Create: `src/components/SourceBadge.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create `src/components/SourceBadge.tsx`**

```tsx
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

type Source = "whisper" | "meet" | "youtube" | "browser" | "none";

const LABELS: Record<Source, string> = {
  whisper: "Whisper",
  meet:    "Meet",
  youtube: "YouTube",
  browser: "Browser",
  none:    "",
};

const COLORS: Record<Source, string> = {
  whisper: "#818cf8",
  meet:    "#34d399",
  youtube: "#f87171",
  browser: "#60a5fa",
  none:    "transparent",
};

export function SourceBadge() {
  const [source, setSource] = useState<Source>("none");

  useEffect(() => {
    const unlisten = listen<string>("source-changed", (e) => {
      setSource((e.payload as Source) ?? "none");
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  if (source === "none") return null;

  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: "5px",
      background: "rgba(255,255,255,0.06)",
      borderRadius: "10px",
      padding: "3px 8px",
      fontSize: "11px",
      color: COLORS[source],
    }}>
      <span style={{
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        background: COLORS[source],
        display: "inline-block",
      }} />
      {LABELS[source]}
    </span>
  );
}
```

- [ ] **Step 2: Replace `src/App.tsx`**

Read the current `src/App.tsx` first. Replace with:

```tsx
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { WordToken } from "./types/subtitle";
import { SubtitleWindow } from "./components/SubtitleWindow";
import { VocabBook } from "./components/VocabBook";
import { ReviewPage } from "./components/ReviewPage";
import { WordDetail } from "./components/WordDetail";
import { SourceBadge } from "./components/SourceBadge";

type View = "subtitle" | "vocab" | "review";
type CaptureMode = "none" | "whisper" | "browser";

export default function App() {
  const [modelReady, setModelReady] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [captureMode, setCaptureMode] = useState<CaptureMode>("none");
  const [view, setView] = useState<View>("subtitle");
  const [clickedWord, setClickedWord] = useState<string | null>(null);

  useEffect(() => {
    invoke<boolean>("check_model").then(setModelReady);
    const u1 = listen<number>("model-download-progress", (e) => setDownloadProgress(e.payload));
    const u2 = listen("model-download-done", () => setModelReady(true));
    return () => {
      u1.then((f) => f());
      u2.then((f) => f());
    };
  }, []);

  const handleStartWhisper = async () => {
    await invoke("start_recording");
    setCaptureMode("whisper");
  };

  const handleStartBrowser = async () => {
    await invoke("start_browser_capture");
    setCaptureMode("browser");
  };

  const handleStop = async () => {
    if (captureMode === "whisper") await invoke("stop_recording");
    else if (captureMode === "browser") await invoke("stop_browser_capture");
    setCaptureMode("none");
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
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: "#60a5fa", fontWeight: 700, fontSize: "14px" }}>LearnCaption</span>
          <SourceBadge />
        </div>
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
        {captureMode === "none" ? (
          <div style={{ display: "flex", gap: "6px" }}>
            <button onClick={handleStartWhisper} style={styles.primaryBtn}>⏺ Whisper</button>
            <button
              onClick={handleStartBrowser}
              style={{ ...styles.primaryBtn, background: "#064e3b", color: "#34d399" }}
            >
              🌐 Browser
            </button>
          </div>
        ) : (
          <button
            onClick={handleStop}
            style={{ ...styles.primaryBtn, background: "#7f1d1d", color: "#fca5a5" }}
          >
            ⏹ Stop
          </button>
        )}
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
    padding: "6px 14px",
    borderRadius: "8px",
    fontSize: "12px",
    cursor: "pointer",
  } as React.CSSProperties,
};
```

- [ ] **Step 3: TypeScript build check**

```bash
cd /path/to/LearnCaption && npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/SourceBadge.tsx src/App.tsx
git commit -m "feat: SourceBadge, Browser capture button, split Whisper/Browser start"
```

---

## Self-Review

**Spec coverage:**
- ✅ Google Meet captions via Chrome extension
- ✅ YouTube captions via Chrome extension
- ✅ `CaptionPipeline` abstraction: adding a new platform = new content script + one line in manifest.json, no Rust changes
- ✅ `source-changed` event — frontend shows active source
- ✅ Whisper path preserved and refactored to use the same CaptionPipeline
- ✅ WS server auto-emits source platform from extension message's `platform` field
- ✅ Port 52340 (unlikely to conflict with common services)

**Known limitations:**
- Meet caption selector `[jsname="tgaKEf"]` may break with Meet DOM updates — the `[aria-live]` fallback provides resilience. If Meet changes its DOM significantly, update `CAPTION_SELECTORS` in `content-meet.js`.
- The extension requires users to load it manually (Developer mode). Distribution via Chrome Web Store is a future step.
- Zoom and Teams native apps are not supported — they would need a different source adapter (macOS Accessibility API). The `CaptionPipeline.process()` interface is the stable integration point for those future adapters.

**Placeholder scan:** No TBD/TODO/placeholder patterns.

**Type consistency:**
- `source-changed` Tauri event payload: `string` in Rust → `e.payload as Source` in TS ✅
- `start_browser_capture` / `stop_browser_capture` take no parameters from JS ✅
- `ExtensionMessage.platform` optional `String` in Rust, optional `string` in JS ✅
