mod commands;
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
        .manage(PipelineState(Arc::new(Mutex::new(None))))
        .invoke_handler(tauri::generate_handler![
            commands::pipeline::check_model,
            commands::pipeline::start_model_download,
            commands::pipeline::start_recording,
            commands::pipeline::stop_recording,
            commands::vocabulary::add_entry,
            commands::vocabulary::mark_mastered,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
