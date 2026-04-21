#[tauri::command]
pub async fn add_entry(_entry: String, _definition: String) -> Result<(), String> {
    Ok(()) // stub
}

#[tauri::command]
pub async fn mark_mastered(_entry: String) -> Result<(), String> {
    Ok(()) // stub
}
