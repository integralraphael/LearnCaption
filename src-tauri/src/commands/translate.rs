use std::sync::Arc;
use tauri::{AppHandle, State};
use crate::translation::{TranslationState, hymt_model_exists, hymt_model_path, download_hymt};

#[tauri::command]
pub fn translation_model_exists(app: AppHandle) -> bool {
    hymt_model_exists(&app)
}

#[tauri::command]
pub async fn download_translation_model(app: AppHandle) {
    download_hymt(app).await;
}

/// Translate `selection` (word or phrase) with optional full-sentence `context`.
/// Loads the model lazily on first call; stays loaded for subsequent calls.
#[tauri::command]
pub async fn translate_selection(
    app: AppHandle,
    state: State<'_, TranslationState>,
    selection: String,
    context: Option<String>,
) -> Result<String, String> {
    if !hymt_model_exists(&app) {
        return Err("MODEL_NOT_DOWNLOADED".into());
    }

    let loaded_arc = Arc::clone(&state.loaded);
    let model_path = hymt_model_path(&app);

    tauri::async_runtime::spawn_blocking(move || {
        // Lazy load (no-op if already loaded)
        crate::translation::ensure_loaded(&loaded_arc, &model_path)?;

        let guard = loaded_arc.lock().unwrap();
        let loaded = guard.as_ref().unwrap();
        crate::translation::translate_sync(loaded, &selection, context.as_deref())
    })
    .await
    .map_err(|e| format!("thread join: {e}"))?
}
