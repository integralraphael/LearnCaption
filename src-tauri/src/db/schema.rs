use rusqlite::{Connection, Result};

pub fn run_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch("
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;

        CREATE TABLE IF NOT EXISTS meetings (
            id          INTEGER PRIMARY KEY,
            title       TEXT NOT NULL DEFAULT 'Untitled Meeting',
            started_at  DATETIME NOT NULL DEFAULT (datetime('now')),
            ended_at    DATETIME,
            audio_path  TEXT
        );

        CREATE TABLE IF NOT EXISTS transcript_lines (
            id           INTEGER PRIMARY KEY,
            meeting_id   INTEGER NOT NULL REFERENCES meetings(id),
            text         TEXT NOT NULL,
            timestamp_ms INTEGER NOT NULL,
            speaker_label TEXT
        );

        CREATE TABLE IF NOT EXISTS vocabulary (
            id               INTEGER PRIMARY KEY,
            entry            TEXT UNIQUE NOT NULL,
            type             TEXT NOT NULL DEFAULT 'word',
            definition       TEXT,
            familiarity      INTEGER NOT NULL DEFAULT 0,
            occurrence_count INTEGER NOT NULL DEFAULT 0,
            added_at         DATETIME NOT NULL DEFAULT (datetime('now')),
            mastered_at      DATETIME
        );

        CREATE TABLE IF NOT EXISTS vocab_sentences (
            id         INTEGER PRIMARY KEY,
            vocab_id   INTEGER NOT NULL REFERENCES vocabulary(id),
            line_id    INTEGER NOT NULL REFERENCES transcript_lines(id),
            meeting_id INTEGER NOT NULL REFERENCES meetings(id),
            created_at DATETIME NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        -- Default settings (INSERT OR IGNORE so they're only set once)
        INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_translate_frq_threshold', '3000');

        CREATE INDEX IF NOT EXISTS idx_vocab_sentences_vocab_id
            ON vocab_sentences(vocab_id);
        CREATE INDEX IF NOT EXISTS idx_transcript_lines_meeting_id
            ON transcript_lines(meeting_id);
    ")
}

pub fn open(path: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;
    run_migrations(&conn)?;
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migration_creates_all_tables() {
        let conn = open(":memory:").unwrap();
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .unwrap();
        let tables: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert!(tables.contains(&"meetings".to_string()));
        assert!(tables.contains(&"transcript_lines".to_string()));
        assert!(tables.contains(&"vocabulary".to_string()));
        assert!(tables.contains(&"vocab_sentences".to_string()));
    }

    #[test]
    fn test_migration_is_idempotent() {
        let conn = open(":memory:").unwrap();
        run_migrations(&conn).unwrap();
    }
}
