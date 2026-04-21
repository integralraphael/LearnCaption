use std::path::Path;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub struct SttEngine {
    ctx: WhisperContext,
}

impl SttEngine {
    /// Load the model from disk. Call only after model_exists() is true.
    pub fn load(model_path: &Path) -> Result<Self, String> {
        let ctx = WhisperContext::new_with_params(
            model_path.to_str().ok_or_else(|| "model path is not valid UTF-8".to_string())?,
            WhisperContextParameters::default(),
        )
        .map_err(|e| format!("failed to load whisper model: {e}"))?;
        Ok(Self { ctx })
    }

    /// Transcribe a buffer of 16kHz mono f32 PCM samples.
    /// Returns vec of (text, start_ms) pairs.
    pub fn transcribe(&self, samples: &[f32]) -> Result<Vec<(String, i64)>, String> {
        let mut state = self.ctx.create_state().map_err(|e| e.to_string())?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("en"));
        params.set_no_speech_thold(0.6);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);

        state
            .full(params, samples)
            .map_err(|e| format!("whisper inference failed: {e}"))?;

        let n = state.full_n_segments().map_err(|e| e.to_string())?;
        let mut results = Vec::new();
        for i in 0..n {
            let text = state
                .full_get_segment_text(i)
                .map_err(|e| e.to_string())?;
            let text = text.trim().to_string();
            if text.is_empty() {
                continue;
            }
            let t0 = state
                .full_get_segment_t0(i)
                .map_err(|e| e.to_string())?;
            let start_ms = t0 * 10; // whisper timestamps are in 10ms units
            results.push((text, start_ms));
        }
        Ok(results)
    }
}

/// Simple RMS energy gate — returns true if the buffer contains audible speech.
pub fn has_speech(samples: &[f32], threshold: f32) -> bool {
    if samples.is_empty() {
        return false;
    }
    let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
    rms > threshold
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_has_speech_silence() {
        let silence = vec![0.0f32; 16000];
        assert!(!has_speech(&silence, 0.01));
    }

    #[test]
    fn test_has_speech_loud_audio() {
        let samples: Vec<f32> = (0..16000)
            .map(|i| (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 16000.0).sin() * 0.5)
            .collect();
        assert!(has_speech(&samples, 0.01));
    }

    #[test]
    fn test_has_speech_empty() {
        assert!(!has_speech(&[], 0.01));
    }
}
