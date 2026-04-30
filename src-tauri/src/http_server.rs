use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use axum::{
    Router,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::task::block_in_place;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};

use crate::db::AppDb;
use crate::dictionary::EcdictDictionary;

pub const HTTP_PORT: u16 = 52341;

#[derive(Clone)]
struct AppState {
    ws_task: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>>,
    db: AppDb,
    dict: Arc<EcdictDictionary>,
}

pub async fn run(
    ws_task: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>>,
    db: AppDb,
    dict: Arc<EcdictDictionary>,
    static_dir: Option<PathBuf>,
) {
    let listener = match TcpListener::bind(format!("127.0.0.1:{HTTP_PORT}")).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[LearnCaption] HTTP server failed to bind on {HTTP_PORT}: {e}");
            return;
        }
    };

    let state = AppState { ws_task, db, dict };

    let api_router = Router::new()
        .route("/status", get(status_handler))
        .route("/meetings", get(list_meetings_handler))
        .route("/meetings/:id/transcript", get(get_transcript_handler))
        .route("/vocab", get(list_vocab_handler))
        .route("/vocab", post(add_vocab_handler))
        .route("/vocab/:id/master", post(mark_mastered_handler))
        .route("/vocab/:id/unmaster", post(mark_unmastered_handler))
        .route("/vocab/:id/familiarity", post(set_familiarity_handler))
        .route("/vocab/:id/definition", post(set_definition_handler))
        .route("/vocab/:id", axum::routing::delete(delete_vocab_handler))
        .route("/vocab/:id/sentences", get(get_vocab_sentences_handler))
        .route("/word/:word", get(query_word_handler))
        .route("/tts", post(tts_handler))
        .with_state(state);

    let mut app = Router::new()
        .nest("/api", api_router)
        .layer(CorsLayer::permissive());

    if let Some(dir) = static_dir {
        let index = dir.join("index.html");
        app = app.fallback_service(
            ServeDir::new(&dir).not_found_service(ServeFile::new(index)),
        );
    }

    println!("[LearnCaption] HTTP server listening on 127.0.0.1:{HTTP_PORT}");
    let _ = axum::serve(listener, app).await;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type ApiResult<T> = Result<Json<T>, (StatusCode, Json<Value>)>;

fn db_err(e: impl std::fmt::Display) -> (StatusCode, Json<Value>) {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() })))
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async fn status_handler(State(state): State<AppState>) -> Json<Value> {
    let capturing = state.ws_task.lock().unwrap().is_some();
    Json(json!({ "capturing": capturing }))
}

// ── Meetings ──────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MeetingDto {
    id: i64,
    title: String,
    started_at: String,
    ended_at: Option<String>,
}

async fn list_meetings_handler(State(state): State<AppState>) -> ApiResult<Vec<MeetingDto>> {
    block_in_place(|| {
        let conn = state.db.lock().map_err(|e| db_err(e))?;
        let mut stmt = conn.prepare(
            "SELECT id, title, started_at, ended_at FROM meetings ORDER BY started_at DESC",
        ).map_err(|e| db_err(e))?;
        let rows = stmt.query_map([], |row| Ok(MeetingDto {
            id: row.get(0)?,
            title: row.get(1)?,
            started_at: row.get(2)?,
            ended_at: row.get(3)?,
        })).map_err(|e| db_err(e))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| db_err(e))?;
        Ok(Json(rows))
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptLineDto {
    id: i64,
    text: String,
    timestamp_ms: i64,
    speaker_label: Option<String>,
}

async fn get_transcript_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<Vec<TranscriptLineDto>> {
    block_in_place(|| {
        let conn = state.db.lock().map_err(|e| db_err(e))?;
        let mut stmt = conn.prepare(
            "SELECT id, text, timestamp_ms, speaker_label
             FROM transcript_lines WHERE meeting_id = ?1 ORDER BY timestamp_ms",
        ).map_err(|e| db_err(e))?;
        let rows = stmt.query_map(rusqlite::params![id], |row| Ok(TranscriptLineDto {
            id: row.get(0)?,
            text: row.get(1)?,
            timestamp_ms: row.get(2)?,
            speaker_label: row.get(3)?,
        })).map_err(|e| db_err(e))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| db_err(e))?;
        Ok(Json(rows))
    })
}

// ── Vocab ─────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VocabEntryDto {
    id: i64,
    entry: String,
    entry_type: String,
    definition: Option<String>,
    familiarity: i64,
    occurrence_count: i64,
    added_at: String,
    mastered_at: Option<String>,
}

fn row_to_vocab_dto(row: &rusqlite::Row<'_>) -> rusqlite::Result<VocabEntryDto> {
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

async fn list_vocab_handler(State(state): State<AppState>) -> ApiResult<Vec<VocabEntryDto>> {
    block_in_place(|| {
        let conn = state.db.lock().map_err(|e| db_err(e))?;
        let mut stmt = conn.prepare(
            "SELECT id, entry, type, definition, familiarity, occurrence_count, added_at, mastered_at
             FROM vocabulary ORDER BY occurrence_count DESC, added_at DESC",
        ).map_err(|e| db_err(e))?;
        let rows = stmt.query_map([], row_to_vocab_dto)
            .map_err(|e| db_err(e))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| db_err(e))?;
        Ok(Json(rows))
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddVocabBody {
    entry: String,
    definition: String,
    entry_type: String,
}

async fn add_vocab_handler(
    State(state): State<AppState>,
    Json(body): Json<AddVocabBody>,
) -> ApiResult<VocabEntryDto> {
    block_in_place(|| {
        let conn = state.db.lock().map_err(|e| db_err(e))?;
        conn.execute(
            "INSERT INTO vocabulary (entry, type, definition, familiarity, occurrence_count)
             VALUES (?1, ?2, ?3, 0, 0)
             ON CONFLICT(entry) DO UPDATE SET definition = excluded.definition",
            rusqlite::params![body.entry.to_lowercase(), body.entry_type, body.definition],
        ).map_err(|e| db_err(e))?;
        let row = conn.query_row(
            "SELECT id, entry, type, definition, familiarity, occurrence_count, added_at, mastered_at
             FROM vocabulary WHERE entry = ?1",
            rusqlite::params![body.entry.to_lowercase()],
            row_to_vocab_dto,
        ).map_err(|e| db_err(e))?;
        Ok(Json(row))
    })
}

async fn mark_unmastered_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let result = block_in_place(|| {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE vocabulary SET familiarity = 0, mastered_at = NULL WHERE id = ?1",
            rusqlite::params![id],
        ).map_err(|e| e.to_string())?;
        Ok::<_, String>(())
    });
    match result {
        Ok(()) => (StatusCode::OK, Json(json!({ "ok": true }))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e }))),
    }
}

async fn mark_mastered_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let result = block_in_place(|| {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE vocabulary SET familiarity = 5, mastered_at = datetime('now') WHERE id = ?1",
            rusqlite::params![id],
        ).map_err(|e| e.to_string())?;
        Ok::<_, String>(())
    });
    match result {
        Ok(()) => (StatusCode::OK, Json(json!({ "ok": true }))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e }))),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VocabSentenceDto {
    line_id: i64,
    text: String,
    timestamp_ms: i64,
    meeting_id: i64,
    meeting_title: String,
}

async fn get_vocab_sentences_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<Vec<VocabSentenceDto>> {
    block_in_place(|| {
        let conn = state.db.lock().map_err(|e| db_err(e))?;
        let mut stmt = conn.prepare(
            "SELECT tl.id, tl.text, tl.timestamp_ms, m.id, m.title
             FROM vocab_sentences vs
             JOIN transcript_lines tl ON tl.id = vs.line_id
             JOIN meetings m ON m.id = vs.meeting_id
             WHERE vs.vocab_id = ?1
             ORDER BY tl.timestamp_ms DESC
             LIMIT 50",
        ).map_err(|e| db_err(e))?;
        let rows = stmt.query_map(rusqlite::params![id], |row| Ok(VocabSentenceDto {
            line_id: row.get(0)?,
            text: row.get(1)?,
            timestamp_ms: row.get(2)?,
            meeting_id: row.get(3)?,
            meeting_title: row.get(4)?,
        })).map_err(|e| db_err(e))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| db_err(e))?;
        Ok(Json(rows))
    })
}

async fn delete_vocab_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let result = block_in_place(|| {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM vocabulary WHERE id = ?1", rusqlite::params![id])
            .map_err(|e| e.to_string())?;
        Ok::<_, String>(())
    });
    match result {
        Ok(()) => (StatusCode::OK, Json(json!({ "ok": true }))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e }))),
    }
}

#[derive(Deserialize)]
struct SetFamiliarityBody {
    level: i64,
}

async fn set_familiarity_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<SetFamiliarityBody>,
) -> impl IntoResponse {
    let level = body.level.clamp(0, 5);
    let result = block_in_place(|| {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE vocabulary SET familiarity = ?1 WHERE id = ?2",
            rusqlite::params![level, id],
        ).map_err(|e| e.to_string())?;
        Ok::<_, String>(())
    });
    match result {
        Ok(()) => (StatusCode::OK, Json(json!({ "ok": true }))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e }))),
    }
}

#[derive(Deserialize)]
struct SetDefinitionBody {
    definition: String,
}

async fn set_definition_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<SetDefinitionBody>,
) -> impl IntoResponse {
    let result = block_in_place(|| {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE vocabulary SET definition = ?1 WHERE id = ?2",
            rusqlite::params![body.definition, id],
        ).map_err(|e| e.to_string())?;
        Ok::<_, String>(())
    });
    match result {
        Ok(()) => (StatusCode::OK, Json(json!({ "ok": true }))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e }))),
    }
}

// ── Word lookup ───────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WordQueryResult {
    definition: Option<String>,
    frequency: Option<u32>,
    vocab_entry: Option<VocabEntryDto>,
}

async fn query_word_handler(
    State(state): State<AppState>,
    Path(word): Path<String>,
) -> ApiResult<WordQueryResult> {
    block_in_place(|| {
        let definition = state.dict.lookup(&word).map(|s| s.to_string());
        let frequency = state.dict.frequency(&word);
        let conn = state.db.lock().map_err(|e| db_err(e))?;
        let vocab_entry = conn.query_row(
            "SELECT id, entry, type, definition, familiarity, occurrence_count, added_at, mastered_at
             FROM vocabulary WHERE entry = ?1",
            rusqlite::params![word.to_lowercase()],
            row_to_vocab_dto,
        ).ok();
        Ok(Json(WordQueryResult { definition, frequency, vocab_entry }))
    })
}

// ── TTS ───────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct TtsBody {
    text: String,
}

async fn tts_handler(Json(body): Json<TtsBody>) -> impl IntoResponse {
    match std::process::Command::new("say").arg(&body.text).spawn() {
        Ok(_) => (StatusCode::OK, Json(json!({ "ok": true }))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))),
    }
}
