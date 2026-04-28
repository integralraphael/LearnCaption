use std::io::{Read, Write, BufWriter};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};
use ort::{session::Session, value::Tensor};
use ndarray::{Array2, Array3};

// Reads raw PCM audio from stdin (same chunk format as audio-capture sidecar):
//   [4-byte LE u32 byte-count] [float32 samples...]
// Writes newline-delimited JSON to stdout:
//   {"text":"...", "timestamp_ms": N}

const SAMPLE_RATE: usize = 16000;
const CHUNK_BYTES: usize = 1600 * 4; // 100ms @ 16kHz
const MAX_BUFFER_S: usize = 4;
const SILENCE_CHUNKS: usize = 3; // 300ms of silence triggers inference

// Silero VAD model embedded at compile time
const VAD_MODEL: &[u8] = include_bytes!("../silero_vad.onnx");
const VAD_CHUNK: usize = 512;   // 32ms @ 16kHz
const VAD_THRESHOLD: f32 = 0.5;

// ── Silero VAD via ONNX Runtime ───────────────────────────────────────────────

struct SileroVad {
    session: Session,
    state: Array3<f32>, // shape (2, 1, 128) — combined LSTM state
}

impl SileroVad {
    fn load() -> ort::Result<Self> {
        ort::init().commit();
        let session = Session::builder()?.commit_from_memory(VAD_MODEL)?;
        Ok(Self {
            session,
            state: Array3::<f32>::zeros((2, 1, 128)),
        })
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

    fn run_chunk(&mut self, chunk: &[f32]) -> ort::Result<f32> {
        let audio = Tensor::from_array(
            Array2::from_shape_vec((1, VAD_CHUNK), chunk.to_vec())
                .expect("fixed shape"),
        )?;
        let state = Tensor::from_array(self.state.clone())?;
        // sr as scalar (shape []) — model selects 8kHz vs 16kHz processing path
        let sr = Tensor::from_array(ndarray::arr0::<i64>(SAMPLE_RATE as i64))?;

        let outputs = self.session.run(ort::inputs![
            "input" => audio,
            "state" => state,
            "sr"    => sr,
        ])?;

        let (_, prob_data) = outputs["output"].try_extract_tensor::<f32>()?;
        let prob = prob_data[0];

        // stateN shape: (2, batch=1, 128)
        let (_, state_data) = outputs["stateN"].try_extract_tensor::<f32>()?;
        if state_data.len() == 2 * 1 * 128 {
            self.state = Array3::from_shape_vec((2, 1, 128), state_data.to_vec())
                .expect("fixed shape");
        }

        Ok(prob)
    }

    fn reset(&mut self) {
        self.state = Array3::<f32>::zeros((2, 1, 128));
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

        let is_speech = vad.speech_prob(&samples) > VAD_THRESHOLD;
        pcm_buffer.extend_from_slice(&samples);
        silent_chunks = if is_speech { 0 } else { silent_chunks + 1 };

        let duration_s = pcm_buffer.len() / SAMPLE_RATE;
        let should_infer = (silent_chunks >= SILENCE_CHUNKS && duration_s > 0)
            || duration_s >= MAX_BUFFER_S;

        if should_infer && !pcm_buffer.is_empty() {
            match transcribe(&ctx, &pcm_buffer) {
                Ok(segments) => {
                    let full_text: String = segments
                        .iter()
                        .map(|(t, _)| t.as_str())
                        .collect::<Vec<_>>()
                        .join(" ");

                    if !full_text.is_empty() && full_text != last_output {
                        let json = serde_json::json!({"text": full_text, "timestamp_ms": session_start_ms});
                        let _ = writeln!(out, "{json}");
                        let _ = out.flush();
                        last_output = full_text;
                    }
                }
                Err(e) => eprintln!("whisper-worker: transcribe error: {e}"),
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
    params.set_no_context(true);
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
