use serde::Serialize;
use std::sync::Arc;
use tauri::State;

use crate::commands::pipeline::PipelineState;
use crate::db::AppDb;
use crate::dictionary::EcdictDictionary;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationWord {
    pub rank: u32,  // 0-based global position in frequency-sorted list
    pub word: String,
    pub definition: String,
    pub frq: u32,
}

#[tauri::command]
pub fn get_setting(key: String, db: State<'_, AppDb>) -> Result<Option<String>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let value = conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get(0),
    ).ok();
    Ok(value)
}

#[tauri::command]
pub fn set_setting(key: String, value: String, db: State<'_, AppDb>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Return words from ECDICT sorted by frequency rank for vocabulary calibration.
/// `offset` is 0-based rank position, `limit` is how many words to return.
#[tauri::command]
pub fn get_calibration_words(
    offset: u32,
    limit: u32,
    dict: State<'_, Arc<EcdictDictionary>>,
) -> Result<Vec<CalibrationWord>, String> {
    Ok(dict.calibration_words(offset, limit))
}

/// Total number of words in ECDICT with frequency data.
#[tauri::command]
pub fn get_dict_total(dict: State<'_, Arc<EcdictDictionary>>) -> u32 {
    dict.total_words()
}

/// Update the live annotator's frq threshold and auto-translate flag without restarting capture.
/// Also persists both values to the settings table.
#[tauri::command]
pub fn set_annotator_config(
    frq_threshold: u32,
    auto_translate: bool,
    db: State<'_, AppDb>,
    pipeline: State<'_, PipelineState>,
) -> Result<(), String> {
    // Persist to DB
    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('ai_translate_frq_threshold', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![frq_threshold.to_string()],
    ).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('auto_translate', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![if auto_translate { "true" } else { "false" }],
    ).map_err(|e| e.to_string())?;
    drop(conn);
    // Update live annotator if a capture session is running
    if let Some(ann) = pipeline.annotator.lock().unwrap().as_ref() {
        ann.lock().unwrap().set_config(frq_threshold, auto_translate);
    }
    Ok(())
}

#[tauri::command]
pub fn toggle_always_on_top(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri::Manager;
    let win = app.get_webview_window("main").ok_or("window not found")?;
    let current = win.is_always_on_top().map_err(|e| e.to_string())?;
    let new_val = !current;
    win.set_always_on_top(new_val).map_err(|e| e.to_string())?;
    Ok(new_val)
}
