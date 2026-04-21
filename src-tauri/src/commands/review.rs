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
    use crate::db::schema;
    use std::sync::{Arc, Mutex};

    fn in_memory_db() -> Arc<Mutex<rusqlite::Connection>> {
        Arc::new(Mutex::new(schema::open(":memory:").unwrap()))
    }

    #[test]
    fn test_list_meetings_empty() {
        let db = in_memory_db();
        let conn = db.lock().unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM meetings", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_get_transcript_returns_lines_in_order() {
        let db = in_memory_db();
        {
            let conn = db.lock().unwrap();
            conn.execute("INSERT INTO meetings (title, started_at) VALUES ('Test', datetime('now'))", []).unwrap();
            conn.execute("INSERT INTO transcript_lines (meeting_id, text, timestamp_ms) VALUES (1, 'second', 2000)", []).unwrap();
            conn.execute("INSERT INTO transcript_lines (meeting_id, text, timestamp_ms) VALUES (1, 'first', 1000)", []).unwrap();
        }
        let conn = db.lock().unwrap();
        let mut stmt = conn.prepare("SELECT text FROM transcript_lines WHERE meeting_id = 1 ORDER BY timestamp_ms").unwrap();
        let texts: Vec<String> = stmt.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect();
        assert_eq!(texts, vec!["first", "second"]);
    }
}
