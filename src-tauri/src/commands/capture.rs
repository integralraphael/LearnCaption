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

    let pipeline = Arc::new(CaptionPipeline::new(
        Arc::new(Mutex::new(annotator)),
        db.inner().clone(),
        state.current_meeting_id.clone(),
        app.clone(),
    ));

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
    fn test_meeting_created_and_ended() {
        let db = in_memory_db();
        let meeting_id: i64 = {
            let conn = db.lock().unwrap();
            conn.execute(
                "INSERT INTO meetings (title, started_at) VALUES ('Meeting', datetime('now'))", [],
            ).unwrap();
            conn.last_insert_rowid()
        };
        assert!(meeting_id > 0);
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
