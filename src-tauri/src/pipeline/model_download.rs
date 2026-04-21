use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use futures_util::StreamExt;

const MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin";
const MODEL_FILENAME: &str = "ggml-small.en.bin";

/// Returns the path where the model should live.
pub fn model_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("no app data dir")
        .join("models")
        .join(MODEL_FILENAME)
}

/// Returns true if the model file already exists and is non-empty.
pub fn model_exists(app: &AppHandle) -> bool {
    let p = model_path(app);
    p.exists() && p.metadata().map(|m| m.len() > 0).unwrap_or(false)
}

/// Download the model, emitting `model-download-progress` events (0.0–1.0).
/// Emits `model-download-done` on success, `model-download-error` on failure.
pub async fn download_model(app: AppHandle) {
    let dest = model_path(&app);
    std::fs::create_dir_all(dest.parent().unwrap()).ok();

    let client = reqwest::Client::new();
    let response = match client.get(MODEL_URL).send().await {
        Ok(r) => r,
        Err(e) => {
            let _ = app.emit("model-download-error", e.to_string());
            return;
        }
    };

    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    let mut file = match std::fs::File::create(&dest) {
        Ok(f) => f,
        Err(e) => {
            let _ = app.emit("model-download-error", e.to_string());
            return;
        }
    };

    use std::io::Write;
    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(bytes) => {
                if file.write_all(&bytes).is_err() {
                    let _ = app.emit("model-download-error", "write failed");
                    std::fs::remove_file(&dest).ok();
                    return;
                }
                downloaded += bytes.len() as u64;
                if total > 0 {
                    let progress = downloaded as f32 / total as f32;
                    let _ = app.emit("model-download-progress", progress);
                }
            }
            Err(e) => {
                let _ = app.emit("model-download-error", e.to_string());
                std::fs::remove_file(&dest).ok();
                return;
            }
        }
    }
    let _ = app.emit("model-download-done", ());
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_model_url_ends_with_bin() {
        assert!(super::MODEL_URL.ends_with(".bin"));
    }

    #[test]
    fn test_model_filename_matches_url() {
        assert!(super::MODEL_URL.contains(super::MODEL_FILENAME));
    }
}
