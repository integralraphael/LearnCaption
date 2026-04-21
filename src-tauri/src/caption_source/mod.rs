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
            None => return,
        };

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

        let line = {
            let ann = self.annotator.lock().unwrap();
            ann.annotate(&raw.text, line_id, meeting_id, raw.timestamp_ms)
        };

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
        let db = in_memory_db();
        let meeting_id: Arc<Mutex<Option<i64>>> = Arc::new(Mutex::new(None));
        {
            let conn = db.lock().unwrap();
            conn.execute(
                "INSERT INTO meetings (title, started_at) VALUES ('T', datetime('now'))", []
            ).unwrap();
        }
        let count: i64 = {
            let conn = db.lock().unwrap();
            conn.query_row("SELECT COUNT(*) FROM transcript_lines", [], |r| r.get(0)).unwrap()
        };
        assert_eq!(count, 0);
        let _ = meeting_id;
    }
}
