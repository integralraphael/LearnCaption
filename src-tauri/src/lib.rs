mod commands;
mod caption_source;
mod db;
mod dictionary;
mod http_server;
mod pipeline;

use commands::pipeline::PipelineState;
use db::open_app_db;
use dictionary::EcdictDictionary;
use std::sync::{Arc, Mutex};
use tauri::{Manager, path::BaseDirectory};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Create ws_task Arc upfront so it can be shared with both
    // PipelineState (for capture commands) and the HTTP server (for /status).
    let ws_task: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>> =
        Arc::new(Mutex::new(None));
    let ws_task_for_http = Arc::clone(&ws_task);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            // Start HTTP server (GET /status for extension, future web dashboard API)
            tauri::async_runtime::spawn(http_server::run(ws_task_for_http));

            // Open SQLite DB
            let db = open_app_db(app.handle())?;
            app.manage(db);

            // Load ECDICT dictionary into memory (read-only, shared via Arc)
            let ecdict_path = app
                .path()
                .resolve("resources/ecdict.db", BaseDirectory::Resource)?;
            let dict = EcdictDictionary::load(
                ecdict_path.to_str().ok_or("ECDICT path is not valid UTF-8")?,
                100_000,
            )?;
            app.manage(Arc::new(dict));

            Ok(())
        })
        .manage(PipelineState {
            sidecar: Arc::new(Mutex::new(None)),
            current_meeting_id: Arc::new(Mutex::new(None)),
            ws_task,
        })
        .invoke_handler(tauri::generate_handler![
            commands::pipeline::check_model,
            commands::pipeline::start_model_download,
            commands::pipeline::start_recording,
            commands::pipeline::stop_recording,
            commands::capture::start_browser_capture,
            commands::capture::stop_browser_capture,
            commands::vocabulary::add_entry,
            commands::vocabulary::mark_mastered,
            commands::vocabulary::list_entries,
            commands::vocabulary::query_word,
            commands::review::list_meetings,
            commands::review::get_transcript,
            commands::review::get_vocab_sentences,
            commands::tts::speak_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
