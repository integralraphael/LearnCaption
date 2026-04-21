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
    annotator: Arc<Mutex<Annotator>>,
    db: AppDb,
    meeting_id: Arc<Mutex<Option<i64>>>,
    app: AppHandle,
}

impl CaptionPipeline {
    pub fn new(
        annotator: Arc<Mutex<Annotator>>,
        db: AppDb,
        meeting_id: Arc<Mutex<Option<i64>>>,
        app: AppHandle,
    ) -> Self {
        Self { annotator, db, meeting_id, app }
    }

    pub fn app(&self) -> &AppHandle {
        &self.app
    }

    pub fn process(&self, raw: RawCaption) {
        if raw.text.trim().is_empty() {
            return;
        }

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
                    if let Err(e) = conn.execute(
                        "INSERT INTO vocab_sentences (vocab_id, line_id, meeting_id) \
                         VALUES (?1, ?2, ?3)",
                        rusqlite::params![vocab_id, line_id, meeting_id],
                    ) {
                        let _ = self.app.emit("pipeline-error", format!("vocab_sentences insert: {e}"));
                    }
                    if let Err(e) = conn.execute(
                        "UPDATE vocabulary SET occurrence_count = occurrence_count + 1 \
                         WHERE id = ?1",
                        rusqlite::params![vocab_id],
                    ) {
                        let _ = self.app.emit("pipeline-error", format!("occurrence_count update: {e}"));
                    }
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
    fn test_raw_caption_empty_text() {
        // Empty text should be caught by process() guard
        let cap = RawCaption { text: "  ".to_string(), timestamp_ms: 0 };
        assert!(cap.text.trim().is_empty());
    }
}
