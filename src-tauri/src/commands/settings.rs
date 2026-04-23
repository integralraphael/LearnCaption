use serde::Serialize;
use std::sync::Arc;
use tauri::State;

use crate::db::AppDb;
use crate::dictionary::EcdictDictionary;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationWord {
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
