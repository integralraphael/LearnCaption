use std::io::{BufRead, BufReader};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

use crate::caption_source::{CaptionAction, CaptionPipeline, RawCaption};
use crate::db::{load_annotator_config, load_vocab_entries, AppDb};
use crate::dictionary::EcdictDictionary;
use crate::pipeline::{
    download_model, model_exists, model_path, Annotator, AudioSidecar,
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
    let (frq_threshold, auto_translate) = load_annotator_config(&db);
    let mut annotator = Annotator::new(dict.inner().clone());
    annotator.rebuild_automaton(vocab_entries);
    annotator.set_config(frq_threshold, auto_translate);
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

    let pipeline = Arc::new(CaptionPipeline::new(
        Arc::clone(&annotator),
        db.inner().clone(),
        state.current_meeting_id.clone(),
        app.clone(),
    ));

    let model_p = model_path(&app);
    let model_str = model_p.to_str().ok_or("model path is not valid UTF-8")?.to_string();
    let mut audio = AudioSidecar::spawn(&app, &model_str).map_err(|e| e.to_string())?;
    let whisper_stdout = audio.take_stdout().ok_or("whisper-worker stdout already taken")?;
    *state.sidecar.lock().unwrap() = Some(audio);

    let app2 = app.clone();

    std::thread::spawn(move || {
        // Read newline-delimited JSON from whisper-worker:
        // {"text": "...", "timestamp_ms": N}
        let reader = BufReader::new(whisper_stdout);
        for line in reader.lines() {
            let line = match line {
                Ok(l) => l,
                Err(_) => break,
            };
            let v: serde_json::Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let text = match v["text"].as_str() {
                Some(t) => t.to_string(),
                None => continue,
            };
            let timestamp_ms = v["timestamp_ms"].as_i64().unwrap_or(0);
            pipeline.process(RawCaption {
                text,
                speaker: None,
                action: CaptionAction::NewBlock,
                timestamp_ms,
            });
        }
        let _ = app2.emit("pipeline-error", "whisper-worker exited");
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
