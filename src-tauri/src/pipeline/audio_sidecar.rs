use std::process::{Child, Command, Stdio};

/// Manages two child processes:
///   audio-capture (Swift) → stdout → whisper-worker (Rust) → stdout → main process
///
/// This isolation keeps whisper-rs and llama-cpp-2's ggml builds in separate address spaces,
/// preventing ggml symbol collisions that would cause abort() during model load.
pub struct AudioSidecar {
    audio_child: Child,
    whisper_child: Child,
}

impl AudioSidecar {
    pub fn spawn(app: &tauri::AppHandle, model_path: &str) -> std::io::Result<Self> {
        let exe = std::env::current_exe()?;
        let exe_dir = exe.parent().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::NotFound, "exe directory not found")
        })?;
        let suffix = if cfg!(target_arch = "aarch64") {
            "aarch64-apple-darwin"
        } else {
            "x86_64-apple-darwin"
        };

        // audio-capture binary
        let audio_bin_suffixed = exe_dir.join(format!("audio-capture-{}", suffix));
        let audio_bin = if audio_bin_suffixed.exists() {
            audio_bin_suffixed
        } else {
            exe_dir.join("audio-capture")
        };

        // whisper-worker binary
        let whisper_bin_suffixed = exe_dir.join(format!("whisper-worker-{}", suffix));
        let whisper_bin = if whisper_bin_suffixed.exists() {
            whisper_bin_suffixed
        } else {
            exe_dir.join("whisper-worker")
        };

        // Spawn audio-capture with its stdout piped
        let mut audio_child = Command::new(&audio_bin)
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;

        let audio_stdout = audio_child.stdout.take().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::Other, "audio-capture stdout not available")
        })?;

        // Spawn whisper-worker with audio stdout as its stdin
        let whisper_child = Command::new(&whisper_bin)
            .arg(model_path)
            .stdin(audio_stdout)
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;

        Ok(Self { audio_child, whisper_child })
    }

    /// Take whisper-worker's stdout (JSON lines of transcriptions).
    pub fn take_stdout(&mut self) -> Option<std::process::ChildStdout> {
        self.whisper_child.stdout.take()
    }
}

impl Drop for AudioSidecar {
    fn drop(&mut self) {
        let _ = self.whisper_child.kill();
        let _ = self.audio_child.kill();
        let _ = self.whisper_child.wait();
        let _ = self.audio_child.wait();
    }
}
