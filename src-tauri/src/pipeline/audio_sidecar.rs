use std::process::{Child, Command, Stdio};

pub struct AudioSidecar {
    child: Child,
}

impl AudioSidecar {
    pub fn spawn(_app: &tauri::AppHandle) -> std::io::Result<Self> {
        let exe = std::env::current_exe()?;
        let exe_dir = exe.parent().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::NotFound, "exe directory not found")
        })?;
        let suffix = if cfg!(target_arch = "aarch64") {
            "aarch64-apple-darwin"
        } else {
            "x86_64-apple-darwin"
        };
        // Production: binary has target-triple suffix; `tauri dev`: no suffix.
        let binary_suffixed = exe_dir.join(format!("audio-capture-{}", suffix));
        let binary = if binary_suffixed.exists() {
            binary_suffixed
        } else {
            exe_dir.join("audio-capture")
        };
        let child = Command::new(&binary)
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;
        Ok(Self { child })
    }

    /// Take the stdout handle. Returns None if already taken.
    pub fn take_stdout(&mut self) -> Option<std::process::ChildStdout> {
        self.child.stdout.take()
    }
}

impl Drop for AudioSidecar {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait(); // reap the zombie
    }
}
