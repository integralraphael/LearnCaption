use std::io::Read;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::caption_source::{CaptionAction, CaptionPipeline, RawCaption};
use crate::db::{load_vocab_entries, AppDb};
use crate::dictionary::EcdictDictionary;
use crate::pipeline::{
    download_model, has_speech, model_exists, model_path, Annotator, AudioSidecar, SttEngine,
};

pub struct PipelineState {
    pub sidecar: Arc<Mutex<Option<AudioSidecar>>>,
    pub current_meeting_id: Arc<Mutex<Option<i64>>>,
    pub ws_task: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>>,
    /// Live annotator for the current capture session.
    /// Stored here so `add_entry` can rebuild the automaton immediately.
    pub annotator: Arc<Mutex<Option<Arc<Mutex<Annotator>>>>>,
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

    // Guard: prevent conflict with browser capture
    {
        let ws = state.ws_task.lock().unwrap();
        if ws.is_some() {
            return Err("browser capture is already running".to_string());
        }
    }

    let vocab_entries = load_vocab_entries(&db).map_err(|e| e.to_string())?;
    let mut annotator = Annotator::new(dict.inner().clone());
    annotator.rebuild_automaton(vocab_entries);
    let annotator = Arc::new(Mutex::new(annotator));
    *state.annotator.lock().unwrap() = Some(Arc::clone(&annotator));

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

    let pipeline = Arc::new(CaptionPipeline::new(
        Arc::clone(&annotator),
        db.inner().clone(),
        state.current_meeting_id.clone(),
        app.clone(),
    ));

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
                            speaker: None,
                            action: CaptionAction::NewBlock,
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
    *state.annotator.lock().unwrap() = None;

    {
        let mut id_guard = state.current_meeting_id.lock().unwrap();
        if let Some(meeting_id) = *id_guard {
            let conn = db.lock().map_err(|e| e.to_string())?;
            conn.execute(
                "UPDATE meetings SET ended_at = datetime('now') WHERE id = ?1",
                rusqlite::params![meeting_id],
            ).map_err(|e| e.to_string())?;
        }
        *id_guard = None;
    }

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
