use std::io::{Read, Write, BufWriter};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};
use tract_onnx::prelude::*;

// Reads raw PCM audio from stdin (same chunk format as audio-capture sidecar):
//   [4-byte LE u32 byte-count] [float32 samples...]
// Writes newline-delimited JSON to stdout:
//   {"text":"...", "timestamp_ms": N}

const SAMPLE_RATE: usize = 16000;
const CHUNK_BYTES: usize = 1600 * 4; // 100ms @ 16kHz
const MAX_BUFFER_S: usize = 4;
const SILENCE_CHUNKS: usize = 2; // 200ms of silence triggers inference

// Silero VAD model embedded at compile time (2.2 MB)
const VAD_MODEL: &[u8] = include_bytes!("../silero_vad.onnx");
// 512 samples = 32ms @ 16kHz (Silero's recommended chunk size for 16kHz)
const VAD_CHUNK: usize = 512;
const VAD_THRESHOLD: f32 = 0.5;

// ── Silero VAD ────────────────────────────────────────────────────────────────

type VadModel = SimplePlan<TypedFact, Box<dyn TypedOp>, Graph<TypedFact, Box<dyn TypedOp>>>;

struct SileroVad {
    model: VadModel,
    h: TValue, // LSTM hidden state (2, 1, 64)
    c: TValue, // LSTM cell state  (2, 1, 64)
}

fn zeros_state() -> TValue {
    tract_ndarray::Array3::<f32>::zeros((2, 1, 64))
        .into_tensor()
        .into()
}

impl SileroVad {
    fn load() -> TractResult<Self> {
        let model = tract_onnx::onnx()
            .model_for_read(&mut std::io::Cursor::new(VAD_MODEL))?
            .with_input_fact(0, InferenceFact::dt_shape(
                f32::datum_type(), [1usize, VAD_CHUNK],
            ))?
            .with_input_fact(1, InferenceFact::dt_shape(
                i64::datum_type(), [1usize],
            ))?
            .with_input_fact(2, InferenceFact::dt_shape(
                f32::datum_type(), [2usize, 1, 64],
            ))?
            .with_input_fact(3, InferenceFact::dt_shape(
                f32::datum_type(), [2usize, 1, 64],
            ))?
            .into_optimized()?
            .into_runnable()?;

        Ok(Self { model, h: zeros_state(), c: zeros_state() })
    }

    /// Returns max speech probability across all 512-sample chunks in `samples`.
    fn speech_prob(&mut self, samples: &[f32]) -> f32 {
        let mut max_prob: f32 = 0.0;
        let mut buf = [0f32; VAD_CHUNK];

        for chunk in samples.chunks(VAD_CHUNK) {
            let slice: &[f32] = if chunk.len() == VAD_CHUNK {
                chunk
            } else {
                buf[..chunk.len()].copy_from_slice(chunk);
                buf[chunk.len()..].fill(0.0);
                &buf
            };
            if let Ok(p) = self.run_chunk(slice) {
                if p > max_prob { max_prob = p; }
            }
        }
        max_prob
    }

    fn run_chunk(&mut self, chunk: &[f32]) -> TractResult<f32> {
        let audio: TValue = tract_ndarray::Array2::from_shape_vec(
            (1, VAD_CHUNK), chunk.to_vec(),
        )?.into_tensor().into();

        let sr: TValue = tract_ndarray::Array1::<i64>::from_vec(vec![SAMPLE_RATE as i64])
            .into_tensor().into();

        let result = self.model.run(tvec![
            audio, sr, self.h.clone(), self.c.clone()
        ])?;

        // Persist updated LSTM states for next chunk
        self.h = result[1].clone();
        self.c = result[2].clone();

        // Output shape is (1, 1) — grab first element
        let prob = result[0].as_slice::<f32>()?[0];
        Ok(prob)
    }

    /// Reset LSTM state between inference segments.
    fn reset(&mut self) {
        self.h = zeros_state();
        self.c = zeros_state();
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────

fn main() {
    let model_path = std::env::args().nth(1).expect("Usage: whisper-worker <model_path>");

    eprintln!("whisper-worker: loading Silero VAD");
    let mut vad = SileroVad::load().expect("failed to load Silero VAD");

    eprintln!("whisper-worker: loading Whisper model from {model_path}");
    let ctx = WhisperContext::new_with_params(&model_path, WhisperContextParameters::default())
        .expect("failed to load whisper model");

    eprintln!("whisper-worker: ready");

    let stdout = std::io::stdout();
    let mut out = BufWriter::new(stdout.lock());
    let stdin = std::io::stdin();
    let mut reader = std::io::BufReader::new(stdin.lock());

    let mut pcm_buffer: Vec<f32> = Vec::new();
    let mut silent_chunks: usize = 0;
    let mut session_start_ms: i64 = 0;
    let mut last_output: String = String::new();
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

        // Silero VAD: neural speech/silence detection
        let is_speech = vad.speech_prob(&samples) > VAD_THRESHOLD;

        pcm_buffer.extend_from_slice(&samples);
        silent_chunks = if is_speech { 0 } else { silent_chunks + 1 };

        let duration_s = pcm_buffer.len() / SAMPLE_RATE;
        let should_infer = (silent_chunks >= SILENCE_CHUNKS && duration_s > 0)
            || duration_s >= MAX_BUFFER_S;

        if should_infer && !pcm_buffer.is_empty() {
            if let Ok(segments) = transcribe(&ctx, &pcm_buffer) {
                // Join all segments from one inference into a single line.
                // This prevents within-inference progressive hallucination where
                // Whisper emits "A", "A B", "A B C" as separate overlapping segments.
                let full_text: String = segments
                    .iter()
                    .map(|(t, _)| t.as_str())
                    .collect::<Vec<_>>()
                    .join(" ");

                // Cross-inference deduplication: skip if identical to or a prefix
                // of the previous output (catches hallucinated repetitions).
                let norm = full_text.to_lowercase();
                let norm_last = last_output.to_lowercase();
                let is_dup = !norm.is_empty()
                    && (norm == norm_last || norm_last.starts_with(&norm));

                if !full_text.is_empty() && !is_dup {
                    let json = serde_json::json!({"text": full_text, "timestamp_ms": session_start_ms});
                    let _ = writeln!(out, "{json}");
                    let _ = out.flush();
                    last_output = full_text;
                }
            }
            session_start_ms +=
                (pcm_buffer.len() as f64 / SAMPLE_RATE as f64 * 1000.0) as i64;
            pcm_buffer.clear();
            silent_chunks = 0;
            vad.reset();
        }
    }

    eprintln!("whisper-worker: stdin closed, exiting");
}

fn transcribe(ctx: &WhisperContext, samples: &[f32]) -> Result<Vec<(String, i64)>, String> {
    let mut state = ctx.create_state().map_err(|e| e.to_string())?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en"));
    params.set_no_speech_thold(0.6);
    params.set_no_context(true);   // don't hallucinate from prior segments
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
