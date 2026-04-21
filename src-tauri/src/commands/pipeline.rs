use std::io::Read;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::dictionary::EcdictDictionary;
use crate::pipeline::{
    download_model, has_speech, model_exists, model_path, Annotator, AudioSidecar, SttEngine,
};

pub struct PipelineState(pub Arc<Mutex<Option<AudioSidecar>>>);

/// Returns true if the whisper model is already downloaded.
#[tauri::command]
pub fn check_model(app: AppHandle) -> bool {
    model_exists(&app)
}

/// Start downloading the model. Progress events:
/// - `model-download-progress` (f32 0.0–1.0)
/// - `model-download-done`
/// - `model-download-error` (String)
#[tauri::command]
pub async fn start_model_download(app: AppHandle) {
    download_model(app).await;
}

#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    state: State<'_, PipelineState>,
) -> Result<(), String> {
    if !model_exists(&app) {
        return Err("model not downloaded yet".to_string());
    }

    let model_p = model_path(&app);
    let ecdict_path = app
        .path()
        .resolve("resources/ecdict.db", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;

    let dict = EcdictDictionary::load(ecdict_path.to_str().unwrap(), 100_000)
        .map_err(|e| e.to_string())?;
    let mut annotator = Annotator::new(dict);
    annotator.rebuild_automaton(vec![]); // vocab wired in Plan B

    let mut audio = AudioSidecar::spawn(&app).map_err(|e| e.to_string())?;
    let audio_stdout = audio.take_stdout().ok_or("audio stdout already taken")?;

    let app2 = app.clone();
    let annotator = Arc::new(Mutex::new(annotator));

    std::thread::spawn(move || {
        let engine = match SttEngine::load(&model_p) {
            Ok(e) => e,
            Err(err) => {
                let _ = app2.emit("pipeline-error", err);
                return;
            }
        };

        const SAMPLE_RATE: usize = 16000;
        const CHUNK_BYTES: usize = 1600 * 4; // 100ms of float32
        const MAX_BUFFER_S: usize = 8;
        const SILENCE_CHUNKS: usize = 4; // 400ms silence → trigger inference

        let mut pcm_buffer: Vec<f32> = Vec::new();
        let mut silent_chunks: usize = 0;
        let mut session_start_ms: i64 = 0;
        let mut buf = vec![0u8; 4 + CHUNK_BYTES];
        let mut reader = std::io::BufReader::new(audio_stdout);

        loop {
            if reader.read_exact(&mut buf[..4]).is_err() {
                break;
            }
            let len = u32::from_le_bytes(buf[..4].try_into().unwrap()) as usize;
            if len > CHUNK_BYTES {
                break; // guard against corrupt length
            }
            if reader.read_exact(&mut buf[4..4 + len]).is_err() {
                break;
            }

            let samples: Vec<f32> = buf[4..4 + len]
                .chunks_exact(4)
                .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
                .collect();

            let is_speech = has_speech(&samples, 0.01);
            pcm_buffer.extend_from_slice(&samples);
            silent_chunks = if is_speech { 0 } else { silent_chunks + 1 };

            let duration_s = pcm_buffer.len() / SAMPLE_RATE;
            let should_infer = (silent_chunks >= SILENCE_CHUNKS && duration_s > 0)
                || duration_s >= MAX_BUFFER_S;

            if should_infer && !pcm_buffer.is_empty() {
                if let Ok(segments) = engine.transcribe(&pcm_buffer) {
                    let ann = annotator.lock().unwrap();
                    for (text, offset_ms) in segments {
                        let ts = session_start_ms + offset_ms;
                        let line = ann.annotate(&text, 0, 0, ts);
                        let _ = app2.emit("subtitle-line", &line);
                    }
                }
                session_start_ms += (pcm_buffer.len() / SAMPLE_RATE * 1000) as i64;
                pcm_buffer.clear();
                silent_chunks = 0;
            }
        }
    });

    *state.0.lock().unwrap() = Some(audio);
    Ok(())
}

#[tauri::command]
pub async fn stop_recording(state: State<'_, PipelineState>) -> Result<(), String> {
    *state.0.lock().unwrap() = None; // Drop AudioSidecar → kills Swift process
    Ok(())
}
