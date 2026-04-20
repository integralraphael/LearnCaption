use std::process::{Child, Command, Stdio};
use tauri::path::BaseDirectory;
use tauri::Manager;

pub struct AudioSidecar {
    child: Child,
}

impl AudioSidecar {
    pub fn spawn(app: &tauri::AppHandle) -> std::io::Result<Self> {
        let binary = app
            .path()
            .resolve("binaries/audio-capture", BaseDirectory::Resource)
            .expect("audio-capture binary not found");
        let child = Command::new(binary)
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;
        Ok(Self { child })
    }

    /// Take the stdout handle. Call only once.
    pub fn take_stdout(&mut self) -> std::process::ChildStdout {
        self.child.stdout.take().expect("stdout already taken")
    }
}

impl Drop for AudioSidecar {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}
