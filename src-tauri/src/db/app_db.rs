use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

use crate::db::schema;

pub type AppDb = Arc<Mutex<Connection>>;

pub fn open_app_db(app: &AppHandle) -> rusqlite::Result<AppDb> {
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| rusqlite::Error::InvalidPath(e.to_string().into()))?
        .join("learncaption.db");
    std::fs::create_dir_all(db_path.parent().unwrap()).ok();
    let path_str = db_path.to_str()
        .ok_or_else(|| rusqlite::Error::InvalidPath(db_path.clone().into()))?;
    let conn = schema::open(path_str)?;
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
