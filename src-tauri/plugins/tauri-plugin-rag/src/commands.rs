use crate::{parser, RagError};
use std::panic::{catch_unwind, AssertUnwindSafe};

#[tauri::command]
pub async fn parse_document<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    file_path: String,
    file_type: String,
) -> Result<String, RagError> {
    log::info!("Parsing document: {} (type: {})", file_path, file_type);
    let res = catch_unwind(AssertUnwindSafe(|| parser::parse_document(&file_path, &file_type)));
    match res {
        Ok(result) => result,
        Err(payload) => {
            let reason = if let Some(s) = payload.downcast_ref::<&str>() {
                *s
            } else if let Some(s) = payload.downcast_ref::<String>() {
                s.as_str()
            } else {
                "unknown panic"
            };
            log::error!("Document parsing panicked: {}", reason);
            Err(RagError::ParseError(format!(
                "Document parsing failed unexpectedly: {}",
                reason
            )))
        }
    }
}
