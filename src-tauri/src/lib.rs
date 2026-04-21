mod commands;
mod caption_source;
mod db;
mod dictionary;
mod pipeline;

use commands::pipeline::PipelineState;
use db::{open_app_db, AppDb};
use dictionary::EcdictDictionary;
use std::sync::{Arc, Mutex};
use tauri::{Manager, path::BaseDirectory};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
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
            ws_task: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            commands::pipeline::check_model,
            commands::pipeline::start_model_download,
            commands::pipeline::start_recording,
            commands::pipeline::stop_recording,
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
