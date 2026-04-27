use std::io::{Read, Write, BufWriter};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

// Reads raw PCM audio from stdin (same chunk format as audio-capture sidecar):
//   [4-byte LE u32 byte-count] [float32 samples...]
// Writes newline-delimited JSON to stdout:
//   {"text":"...", "timestamp_ms": N}

const SAMPLE_RATE: usize = 16000;
const CHUNK_BYTES: usize = 1600 * 4; // 100ms @ 16kHz
const MAX_BUFFER_S: usize = 4;
const SILENCE_CHUNKS: usize = 2; // 200ms of silence triggers inference

fn main() {
    let model_path = std::env::args().nth(1).expect("Usage: whisper-worker <model_path>");

    eprintln!("whisper-worker: loading model from {model_path}");

    let ctx = WhisperContext::new_with_params(&model_path, WhisperContextParameters::default())
        .expect("failed to load whisper model");

    eprintln!("whisper-worker: model loaded, reading audio");

    let stdout = std::io::stdout();
    let mut out = BufWriter::new(stdout.lock());
    let stdin = std::io::stdin();
    let mut reader = std::io::BufReader::new(stdin.lock());

    let mut pcm_buffer: Vec<f32> = Vec::new();
    let mut silent_chunks: usize = 0;
    let mut session_start_ms: i64 = 0;
    let mut buf = vec![0u8; 4 + CHUNK_BYTES];

    loop {
        if reader.read_exact(&mut buf[..4]).is_err() { break; }
        let len = u32::from_le_bytes(buf[..4].try_into().unwrap()) as usize;
        if len == 0 || len > CHUNK_BYTES { break; }
        if reader.read_exact(&mut buf[4..4 + len]).is_err() { break; }

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
            if let Ok(segments) = transcribe(&ctx, &pcm_buffer) {
                for (text, offset_ms) in segments {
                    let ts = session_start_ms + offset_ms;
                    let json = serde_json::json!({"text": text, "timestamp_ms": ts});
                    let _ = writeln!(out, "{json}");
                    let _ = out.flush();
                }
            }
            session_start_ms +=
                (pcm_buffer.len() as f64 / SAMPLE_RATE as f64 * 1000.0) as i64;
            pcm_buffer.clear();
            silent_chunks = 0;
        }
    }

    eprintln!("whisper-worker: stdin closed, exiting");
}

fn has_speech(samples: &[f32], threshold: f32) -> bool {
    if samples.is_empty() { return false; }
    let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
    rms > threshold
}

fn transcribe(ctx: &WhisperContext, samples: &[f32]) -> Result<Vec<(String, i64)>, String> {
    let mut state = ctx.create_state().map_err(|e| e.to_string())?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en"));
    params.set_no_speech_thold(0.6);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    state.full(params, samples).map_err(|e| format!("whisper inference: {e}"))?;

    let n = state.full_n_segments().map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for i in 0..n {
        let text = state.full_get_segment_text(i).map_err(|e| e.to_string())?;
        let text = text.trim().to_string();
        if text.is_empty() { continue; }
        let t0 = state.full_get_segment_t0(i).map_err(|e| e.to_string())?;
        results.push((text, t0 * 10));
    }
    Ok(results)
}
