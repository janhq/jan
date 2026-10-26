use std::fs;
use std::path::{Path, PathBuf};

use super::constants::{MESSAGES_FILE, THREADS_DIR, THREADS_FILE};

/// Longest thread id accepted. Real ids are UUIDs (36 chars) or ULIDs (26).
const MAX_THREAD_ID_LEN: usize = 128;

pub fn get_data_dir(data_folder: &Path) -> PathBuf {
    data_folder.join(THREADS_DIR)
}

/// Names Windows maps to a device in every directory, in any case and also
/// with an extension (`nul.txt`). Checked on every OS so an id accepted on one
/// works on all of them.
fn is_windows_device_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    match stem.as_bytes() {
        [a, b, c] => matches!(&[*a, *b, *c], b"CON" | b"PRN" | b"AUX" | b"NUL"),
        [a, b, c, d] => matches!(&[*a, *b, *c], b"COM" | b"LPT") && d.is_ascii_digit(),
        _ => false,
    }
}

/// A thread id names a single directory under `threads/`, so it may only hold
/// ASCII letters, digits, `-` and `_`. That covers every id Jan produces (UUIDs
/// from the backend and the CLI, ULIDs from the web app, and fixed names such as
/// `temporary-chat`) and rules out separators, `.`/`..`, drive prefixes and
/// empty names, so the id can never resolve outside its own directory.
pub fn validate_thread_id(thread_id: &str) -> Result<(), String> {
    if thread_id.is_empty() {
        return Err("Invalid thread id: empty".to_string());
    }
    if thread_id.len() > MAX_THREAD_ID_LEN {
        return Err("Invalid thread id: too long".to_string());
    }
    if !thread_id
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        || is_windows_device_name(thread_id)
    {
        return Err(format!("Invalid thread id: {thread_id:?}"));
    }
    Ok(())
}

pub fn get_thread_dir(data_folder: &Path, thread_id: &str) -> Result<PathBuf, String> {
    validate_thread_id(thread_id)?;
    Ok(get_data_dir(data_folder).join(thread_id))
}

pub fn get_thread_metadata_path(data_folder: &Path, thread_id: &str) -> Result<PathBuf, String> {
    Ok(get_thread_dir(data_folder, thread_id)?.join(THREADS_FILE))
}

pub fn get_messages_path(data_folder: &Path, thread_id: &str) -> Result<PathBuf, String> {
    Ok(get_thread_dir(data_folder, thread_id)?.join(MESSAGES_FILE))
}

pub fn ensure_data_dirs(data_folder: &Path) -> Result<(), String> {
    let data_dir = get_data_dir(data_folder);
    if !data_dir.exists() {
        fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn ensure_thread_dir_exists(data_folder: &Path, thread_id: &str) -> Result<(), String> {
    let thread_dir = get_thread_dir(data_folder, thread_id)?;
    ensure_data_dirs(data_folder)?;
    if !thread_dir.exists() {
        fs::create_dir_all(&thread_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}
