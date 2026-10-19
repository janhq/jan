//! Saving files the user attaches by dragging them onto the chat.
//!
//! The webview's drop event hands the frontend file contents but no path on
//! disk, while document attachments are read (parsed, ingested) from a path.
//! This writes a dropped file into Jan's data folder so it can be attached the
//! same way as a file picked with the dialog. It only ever writes under
//! `<jan data folder>/attachments/<random id>/`.
use crate::core::app::commands::get_jan_data_folder_path;
use base64::Engine;
use std::fs;
use tauri::Runtime;

/// Folder, relative to the Jan data folder, that holds saved attachments.
pub const ATTACHMENTS_DIR: &str = "attachments";

/// The file name to save `raw` under: directories are dropped so the file can
/// only land in its own attachment folder, and characters Windows forbids in
/// file names are replaced.
pub fn attachment_file_name(raw: &str) -> Result<String, String> {
    let name = raw.rsplit(['/', '\\']).next().unwrap_or_default().trim();
    if name.is_empty() || name == "." || name == ".." {
        return Err(format!(
            "save_attachment_file error: no file name in {raw:?}"
        ));
    }
    Ok(name
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') {
                '_'
            } else {
                c
            }
        })
        .collect())
}

/// Writes a dropped file (base64-encoded) into its own folder under the
/// attachments folder and returns the saved file's path.
#[tauri::command]
pub fn save_attachment_file<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    file_name: String,
    data_base64: String,
) -> Result<String, String> {
    let name = attachment_file_name(&file_name)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("save_attachment_file error: invalid data: {e}"))?;

    let folder = get_jan_data_folder_path(app_handle)
        .join(ATTACHMENTS_DIR)
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&folder).map_err(|e| format!("save_attachment_file error: {e}"))?;

    let path = folder.join(name);
    fs::write(&path, bytes).map_err(|e| format!("save_attachment_file error: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}
