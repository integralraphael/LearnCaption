mod commands;
mod db;
mod dictionary;
mod pipeline;

use commands::pipeline::PipelineState;
use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
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
