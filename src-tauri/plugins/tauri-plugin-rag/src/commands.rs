use crate::{RagError, parser};

#[tauri::command]
pub async fn parse_document<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    file_path: String,
    file_type: String,
) -> Result<String, RagError> {
    log::info!("Parsing document: {} (type: {})", file_path, file_type);
    let res = parser::parse_document(&file_path, &file_type);
    res
}
