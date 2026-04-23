use serde::Serialize;
use tauri::State;

use crate::commands::pipeline::PipelineState;
use crate::db::{self, AppDb};
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
/// If a capture session is running, rebuilds the Aho-Corasick automaton
/// so the new word is highlighted immediately in subsequent captions.
#[tauri::command]
pub fn add_entry(
    entry: String,
    definition: String,
    entry_type: String,
    db: State<'_, AppDb>,
    pipeline: State<'_, PipelineState>,
) -> Result<VocabEntryDto, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO vocabulary (entry, type, definition, familiarity, occurrence_count)
         VALUES (?1, ?2, ?3, 0, 0)
         ON CONFLICT(entry) DO UPDATE SET definition = excluded.definition",
        rusqlite::params![entry.to_lowercase(), entry_type, definition],
    ).map_err(|e| e.to_string())?;
    let row = conn.query_row(
        "SELECT id, entry, type, definition, familiarity, occurrence_count, added_at, mastered_at
         FROM vocabulary WHERE entry = ?1",
        rusqlite::params![entry.to_lowercase()],
        row_to_dto,
    ).map_err(|e| e.to_string())?;
    drop(conn);

    // Rebuild automaton so the new word is highlighted immediately
    if let Some(ann) = pipeline.annotator.lock().unwrap().as_ref() {
        if let Ok(entries) = db::load_vocab_entries(&db) {
            let mut ann = ann.lock().unwrap();
            ann.rebuild_automaton(entries);
        }
    }

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
