/// Speak text using macOS `say` command (AVSpeechSynthesizer under the hood).
/// Non-blocking: spawns the process and returns immediately.
#[tauri::command]
pub fn speak_text(text: String) -> Result<(), String> {
    std::process::Command::new("say")
        .arg(&text)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_speak_text_empty_string_does_not_crash() {
        let result = std::process::Command::new("say").arg("").spawn();
        assert!(result.is_ok());
    }
}
