use crate::{parser, RagError};
use std::panic::{catch_unwind, AssertUnwindSafe};

#[tauri::command]
pub async fn parse_document<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    file_path: String,
    file_type: String,
) -> Result<String, RagError> {
    log::info!("Parsing document: {} (type: {})", file_path, file_type);
    // Run parsing on a dedicated blocking thread so that catch_unwind
    // reliably catches panics from synchronous parser libraries.
    //
    // Note: PDF-specific panics are now handled inside parse_pdf itself,
    // which falls back to pdf_oxide. This outer catch_unwind is a backstop
    // for any other parser (docx, xlsx, csv, etc.) that might panic.
    let result = tokio::task::spawn_blocking(move || {
        catch_unwind(AssertUnwindSafe(|| {
            parser::parse_document(&file_path, &file_type)
        }))
    })
    .await
    .map_err(|e| {
        log::error!("Document parsing task failed: {}", e);
        RagError::ParseError("Document parsing task failed".to_string())
    })?;

    match result {
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
