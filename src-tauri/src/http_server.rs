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
use crate::translation::LoadedModel;

pub const HTTP_PORT: u16 = 52341;

#[derive(Clone)]
struct AppState {
    ws_task: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>>,
    db: AppDb,
    dict: Arc<EcdictDictionary>,
    translation: Arc<Mutex<Option<LoadedModel>>>,
    hymt_path: PathBuf,
}

pub async fn run(
    ws_task: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>>,
    db: AppDb,
    dict: Arc<EcdictDictionary>,
    translation: Arc<Mutex<Option<LoadedModel>>>,
    hymt_path: PathBuf,
    static_dir: Option<PathBuf>,
) {
    let listener = match TcpListener::bind(format!("127.0.0.1:{HTTP_PORT}")).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[LearnCaption] HTTP server failed to bind on {HTTP_PORT}: {e}");
            return;
        }
    };

    let state = AppState { ws_task, db, dict, translation, hymt_path };

    let api_router = Router::new()
        .route("/status", get(status_handler))
        .route("/meetings", get(list_meetings_handler))
        .route("/meetings/:id/title", post(rename_meeting_handler))
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
        .route("/settings/:key", get(get_setting_handler))
        .route("/annotate", post(annotate_handler))
        .route("/translate", post(translate_handler))
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

// ── Meetings ─────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MeetingDto {
    id: i64,
    title: String,
    started_at: String,
    ended_at: Option<String>,
    source: String,
}

#[derive(Deserialize)]
struct RenameMeetingBody {
    title: String,
}

async fn rename_meeting_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<RenameMeetingBody>,
) -> impl IntoResponse {
    let result = block_in_place(|| {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE meetings SET title = ?1 WHERE id = ?2",
            rusqlite::params![body.title.trim(), id],
        ).map_err(|e| e.to_string())?;
        Ok::<_, String>(())
    });
    match result {
        Ok(()) => (StatusCode::OK, Json(json!({ "ok": true }))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e }))),
    }
}

async fn list_meetings_handler(State(state): State<AppState>) -> ApiResult<Vec<MeetingDto>> {
    block_in_place(|| {
        let conn = state.db.lock().map_err(|e| db_err(e))?;
        let mut stmt = conn.prepare(
            "SELECT id, title, started_at, ended_at, source FROM meetings ORDER BY started_at DESC",
        ).map_err(|e| db_err(e))?;
        let rows = stmt.query_map([], |row| Ok(MeetingDto {
            id: row.get(0)?,
            title: row.get(1)?,
            started_at: row.get(2)?,
            ended_at: row.get(3)?,
            source: row.get(4)?,
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
    translation: Option<String>,
}

async fn get_transcript_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<Vec<TranscriptLineDto>> {
    block_in_place(|| {
        let conn = state.db.lock().map_err(|e| db_err(e))?;
        let mut stmt = conn.prepare(
            "SELECT id, text, timestamp_ms, speaker_label, translation
             FROM transcript_lines WHERE meeting_id = ?1 ORDER BY timestamp_ms",
        ).map_err(|e| db_err(e))?;
        let rows = stmt.query_map(rusqlite::params![id], |row| Ok(TranscriptLineDto {
            id: row.get(0)?,
            text: row.get(1)?,
            timestamp_ms: row.get(2)?,
            speaker_label: row.get(3)?,
            translation: row.get(4)?,
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

// ── Settings ──────────────────────────────────────────────────────────────────

async fn get_setting_handler(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> ApiResult<Value> {
    block_in_place(|| {
        let conn = state.db.lock().map_err(|e| db_err(e))?;
        let value: Option<String> = conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params![key],
            |row| row.get(0),
        ).ok();
        Ok(Json(json!({ "value": value })))
    })
}

// ── Annotate ──────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AnnotatedToken {
    text: String,
    is_word: bool,
    in_vocab: bool,
    difficult: bool,
    definition: Option<String>,
}

#[derive(Deserialize)]
struct AnnotateBody {
    texts: Vec<String>,
}

fn tokenize_text(text: &str) -> Vec<(String, bool)> {
    let mut result = Vec::new();
    let mut current = String::new();
    let mut in_word = false;
    for ch in text.chars() {
        let is_wc = ch.is_ascii_alphabetic() || ch == '\'';
        if is_wc != in_word {
            if !current.is_empty() {
                result.push((std::mem::take(&mut current), in_word));
            }
            in_word = is_wc;
        }
        current.push(ch);
    }
    if !current.is_empty() {
        result.push((current, in_word));
    }
    result
}

async fn annotate_handler(
    State(state): State<AppState>,
    Json(body): Json<AnnotateBody>,
) -> ApiResult<Vec<Vec<AnnotatedToken>>> {
    block_in_place(|| {
        // Read freq threshold from settings (default 3000)
        let freq_threshold: u32 = {
            let conn = state.db.lock().map_err(|e| db_err(e))?;
            let val: Option<String> = conn.query_row(
                "SELECT value FROM settings WHERE key = ?1",
                rusqlite::params!["ai_translate_frq_threshold"],
                |row| row.get(0),
            ).ok();
            val.and_then(|s| s.parse().ok()).unwrap_or(3000)
        };

        // Load all vocab entries into a HashMap<lowercase_entry, (id, definition)>
        let vocab_map: std::collections::HashMap<String, (i64, Option<String>)> = {
            let conn = state.db.lock().map_err(|e| db_err(e))?;
            let mut stmt = conn.prepare(
                "SELECT entry, id, definition FROM vocabulary",
            ).map_err(|e| db_err(e))?;
            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            }).map_err(|e| db_err(e))?
            .filter_map(|r| r.ok())
            .map(|(entry, id, def)| (entry.to_lowercase(), (id, def)))
            .collect();
            rows
        };

        let result: Vec<Vec<AnnotatedToken>> = body.texts.iter().map(|text| {
            tokenize_text(text).into_iter().map(|(token, is_word)| {
                if is_word {
                    let lower = token.to_lowercase();
                    let (in_vocab, definition) = if let Some((_id, def)) = vocab_map.get(&lower) {
                        (true, def.clone())
                    } else {
                        (false, None)
                    };
                    let difficult = state.dict.frequency(&lower)
                        .map(|f| f > freq_threshold)
                        .unwrap_or(false);
                    AnnotatedToken { text: token, is_word: true, in_vocab, difficult, definition }
                } else {
                    AnnotatedToken { text: token, is_word: false, in_vocab: false, difficult: false, definition: None }
                }
            }).collect()
        }).collect();

        Ok(Json(result))
    })
}

// ── Translate ─────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct TranslateBody {
    text: String,
    /// Line IDs whose translation column should be updated after a successful translation.
    #[serde(default)]
    line_ids: Vec<i64>,
}

async fn translate_handler(
    State(state): State<AppState>,
    Json(body): Json<TranslateBody>,
) -> impl IntoResponse {
    if !state.hymt_path.exists() {
        return (StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "error": "MODEL_NOT_DOWNLOADED" }))).into_response();
    }
    let db = state.db.clone();
    let line_ids = body.line_ids.clone();
    let result = block_in_place(|| {
        crate::translation::ensure_loaded(&state.translation, &state.hymt_path)?;
        let guard = state.translation.lock().unwrap();
        let loaded = guard.as_ref().unwrap();
        let translation = crate::translation::translate_sync(loaded, &body.text, None)?;
        // Persist to DB for all lines in this block
        if !line_ids.is_empty() {
            if let Ok(conn) = db.lock() {
                for id in &line_ids {
                    let _ = conn.execute(
                        "UPDATE transcript_lines SET translation = ?1 WHERE id = ?2",
                        rusqlite::params![translation, id],
                    );
                }
            }
        }
        Ok(translation)
    });
    match result {
        Ok(t) => (StatusCode::OK, Json(json!({ "translation": t }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e }))).into_response(),
    }
}
