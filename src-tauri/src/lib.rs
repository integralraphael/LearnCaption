// objc macros (class!, msg_send!) emit cargo-clippy cfg checks that trigger
// unexpected_cfgs on current Rust toolchains. Suppress until objc crate is updated.
#![allow(unexpected_cfgs)]

mod commands;
mod caption_source;
mod db;
mod dictionary;
mod http_server;
mod pipeline;
mod translation;

use commands::pipeline::PipelineState;
use db::open_app_db;
use dictionary::EcdictDictionary;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, path::BaseDirectory};
use translation::TranslationState;

/// Find the web dashboard's built static files.
/// Checks the app bundle resources first, then the workspace root in dev mode.
fn find_web_dist(app: &AppHandle) -> Option<PathBuf> {
    // Bundled app: resource directory contains web/dist
    if let Ok(p) = app.path().resolve("web/dist", BaseDirectory::Resource) {
        if p.exists() { return Some(p); }
    }
    // Dev mode: exe is at src-tauri/target/debug/learncaption — walk up to workspace root
    if let Ok(exe) = std::env::current_exe() {
        // exe → target/debug → target → src-tauri → workspace root
        if let Some(root) = exe.parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
        {
            let p = root.join("web/dist");
            if p.exists() { return Some(p); }
        }
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Create ws_task Arc upfront so it can be shared with both
    // PipelineState (for capture commands) and the HTTP server (for /status).
    let ws_task: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>> =
        Arc::new(Mutex::new(None));
    let ws_task_for_http = Arc::clone(&ws_task);

    let translation_loaded: Arc<Mutex<Option<translation::LoadedModel>>> = Arc::new(Mutex::new(None));
    let translation_for_http = Arc::clone(&translation_loaded);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            // On macOS: convert window to a NonactivatingPanel so clicks are received
            // without the window ever becoming the key window. This prevents macOS from
            // switching WKWebView compositing mode on activation, which caused the
            // transparency to flicker whenever the user clicked the overlay.
            #[cfg(target_os = "macos")]
            {
                let win = app.get_webview_window("main").unwrap();
                unsafe {
                    use objc::{msg_send, sel, sel_impl, class, runtime::Object};
                    let ns_win = win.ns_window().unwrap() as *mut Object;

                    // Promote NSWindow → NSPanel so we can apply NonactivatingPanel style.
                    // NSPanel is a direct subclass of NSWindow with identical ivar layout,
                    // making isa-swizzle safe here.
                    let ns_panel_class = class!(NSPanel);
                    // object_setClass is a C function from objc runtime
                    extern "C" {
                        fn object_setClass(obj: *mut Object, cls: *const objc::runtime::Class) -> *const objc::runtime::Class;
                    }
                    object_setClass(ns_win, ns_panel_class);

                    // NSWindowStyleMaskNonactivatingPanel = 1 << 7
                    let current_mask: usize = msg_send![ns_win, styleMask];
                    let _: () = msg_send![ns_win, setStyleMask: current_mask | (1usize << 7)];
                }
            }

            // Open SQLite DB (must happen before HTTP server so it can share the handle)
            let db = open_app_db(app.handle())?;

            // Load ECDICT dictionary into memory (read-only, shared via Arc)
            let ecdict_path = app
                .path()
                .resolve("resources/ecdict.db", BaseDirectory::Resource)?;
            let dict = Arc::new(EcdictDictionary::load(
                ecdict_path.to_str().ok_or("ECDICT path is not valid UTF-8")?,
                100_000,
            )?);

            // Start HTTP server with full REST API + optional static file serving
            let static_dir = find_web_dist(app.handle());
            if static_dir.is_none() {
                eprintln!("[LearnCaption] web/dist not found — serving API only (run `cd web && npm run build` to enable the dashboard)");
            }
            let hymt_path = translation::hymt_model_path(app.handle());
            tauri::async_runtime::spawn(http_server::run(
                ws_task_for_http,
                db.clone(),
                dict.clone(),
                translation_for_http,
                hymt_path,
                static_dir,
            ));

            app.manage(db);
            app.manage(dict);

            Ok(())
        })
        .manage(PipelineState {
            sidecar: Arc::new(Mutex::new(None)),
            current_meeting_id: Arc::new(Mutex::new(None)),
            ws_task,
            annotator: Arc::new(Mutex::new(None)),
        })
        .manage(TranslationState {
            loaded: translation_loaded,
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
            commands::translate::translation_model_exists,
            commands::translate::download_translation_model,
            commands::translate::translate_selection,
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::settings::set_annotator_config,
            commands::settings::get_calibration_words,
            commands::settings::get_dict_total,
            commands::settings::toggle_always_on_top,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
