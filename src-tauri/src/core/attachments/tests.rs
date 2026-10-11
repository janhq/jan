use super::commands::*;
use crate::core::app::commands::get_jan_data_folder_path;
use base64::Engine;
use jan_utils::normalize_path;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::test::mock_app;

fn normalize_test_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let path_str = path.to_string_lossy();
        if let Some(stripped) = path_str.strip_prefix(r"\\?\") {
            return normalize_path(Path::new(stripped));
        }
    }

    normalize_path(path)
}

#[test]
fn test_attachment_file_name_keeps_only_the_file_name() {
    assert_eq!(attachment_file_name("report.pdf").unwrap(), "report.pdf");
    assert_eq!(attachment_file_name("../../etc/passwd").unwrap(), "passwd");
    assert_eq!(
        attachment_file_name(r"C:\Users\someone\notes.md").unwrap(),
        "notes.md"
    );
}

#[test]
fn test_attachment_file_name_rejects_names_without_a_file() {
    for raw in ["", "   ", ".", "..", "dir/", r"dir\.."] {
        assert!(
            attachment_file_name(raw).is_err(),
            "{raw:?} should be rejected"
        );
    }
}

#[test]
fn test_attachment_file_name_replaces_characters_windows_forbids() {
    assert_eq!(attachment_file_name("a:b?c*.pdf").unwrap(), "a_b_c_.pdf");
    assert_eq!(
        attachment_file_name("tab\there.txt").unwrap(),
        "tab_here.txt"
    );
}

#[test]
fn test_save_attachment_file_writes_inside_the_attachments_folder() {
    let app = mock_app();
    let bytes: &[u8] = b"%PDF-1.4\x00\xff binary";
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);

    let saved = save_attachment_file(
        app.handle().clone(),
        "../outside/report.pdf".to_string(),
        encoded,
    )
    .unwrap();

    let saved = PathBuf::from(saved);
    let attachments = get_jan_data_folder_path(app.handle().clone()).join(ATTACHMENTS_DIR);
    assert!(
        normalize_test_path(&saved).starts_with(normalize_test_path(&attachments)),
        "{saved:?} is outside {attachments:?}"
    );
    assert_eq!(saved.file_name().unwrap(), "report.pdf");
    assert_eq!(fs::read(&saved).unwrap(), bytes);
    let _ = fs::remove_dir_all(saved.parent().unwrap());
}

#[test]
fn test_save_attachment_file_rejects_data_that_is_not_base64() {
    let app = mock_app();

    let result = save_attachment_file(
        app.handle().clone(),
        "report.pdf".to_string(),
        "not base64!".to_string(),
    );

    assert!(result.is_err());
}

// A file sent to the model as it is is read back by path from the thread, so
// only files Jan saved under its attachments folder may be read this way:
// a path pointing anywhere else (an SSH key, say) must never reach a model.
#[test]
fn test_read_attachment_file_reads_a_saved_attachment() {
    let app = mock_app();
    let bytes: &[u8] = b"%PDF-1.7\x00\xfe";
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    let saved = save_attachment_file(
        app.handle().clone(),
        "report.pdf".to_string(),
        encoded.clone(),
    )
    .unwrap();

    let read = read_attachment_file(app.handle().clone(), saved.clone()).unwrap();

    assert_eq!(read, encoded);
    let _ = fs::remove_dir_all(PathBuf::from(saved).parent().unwrap());
}

#[test]
fn test_read_attachment_file_refuses_files_outside_the_attachments_folder() {
    let app = mock_app();
    let outside = std::env::temp_dir().join(format!("jan_secret_{}.txt", uuid::Uuid::new_v4()));
    fs::write(&outside, b"not for any model").unwrap();

    let result = read_attachment_file(app.handle().clone(), outside.to_string_lossy().to_string());

    assert!(result.is_err(), "read {outside:?}");
    let _ = fs::remove_file(&outside);
}

#[test]
fn test_read_attachment_file_refuses_paths_that_climb_out() {
    let app = mock_app();
    let data = get_jan_data_folder_path(app.handle().clone());
    fs::create_dir_all(data.join(ATTACHMENTS_DIR)).unwrap();
    let secret = data.join(format!("secret_{}.txt", uuid::Uuid::new_v4()));
    fs::write(&secret, b"not for any model").unwrap();
    let climbing = data
        .join(ATTACHMENTS_DIR)
        .join("..")
        .join(secret.file_name().unwrap());

    let result = read_attachment_file(app.handle().clone(), climbing.to_string_lossy().to_string());

    assert!(result.is_err(), "read {climbing:?}");
    let _ = fs::remove_file(&secret);
}
