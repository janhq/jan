use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;

// For async file write serialization
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::OnceLock;
use tokio::sync::Mutex;

use super::utils::{get_messages_path, get_thread_metadata_path};

// Global per-thread locks for message file writes
pub static MESSAGE_LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();

/// Check if the platform should use SQLite (mobile platforms)
pub fn should_use_sqlite() -> bool {
    cfg!(any(target_os = "android", target_os = "ios"))
}

/// Get a lock for a specific thread to ensure thread-safe message file operations
pub async fn get_lock_for_thread(thread_id: &str) -> Arc<Mutex<()>> {
    let locks = MESSAGE_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut locks = locks.lock().await;
    let lock = locks
        .entry(thread_id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone();
    drop(locks); // Release the map lock before returning the file lock
    lock
}

/// Write messages to a thread's messages.jsonl file.
///
/// Writes to a sibling `.tmp` file then atomically renames it over the target,
/// so the target is never left in a partially-written state if the process is
/// killed mid-write (see janhq/jan#8019).
pub fn write_messages_to_file(
    messages: &[serde_json::Value],
    path: &std::path::Path,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Messages path has no parent: {}", path.display()))?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("Invalid messages file name: {}", path.display()))?;
    let tmp_path = parent.join(format!("{file_name}.tmp"));

    let write = || -> Result<(), String> {
        let mut file = File::create(&tmp_path).map_err(|e| e.to_string())?;
        for msg in messages {
            let data = serde_json::to_string(msg).map_err(|e| e.to_string())?;
            writeln!(file, "{data}").map_err(|e| e.to_string())?;
        }
        file.flush().map_err(|e| e.to_string())?;
        // Best-effort: some filesystems (certain tmpfs setups) don't support fsync.
        let _ = file.sync_all();
        Ok(())
    };

    if let Err(e) = write() {
        let _ = fs::remove_file(&tmp_path);
        return Err(e);
    }

    fs::rename(&tmp_path, path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        e.to_string()
    })
}

/// Read messages from a thread's messages.jsonl file
pub fn read_messages_from_file(
    data_folder: &Path,
    thread_id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let path = get_messages_path(data_folder, thread_id);
    if !path.exists() {
        return Ok(vec![]);
    }

    let file = File::open(&path).map_err(|e| {
        eprintln!("Error opening file {}: {}", path.display(), e);
        e.to_string()
    })?;
    let reader = BufReader::new(file);

    let mut messages = Vec::new();
    for line in reader.lines() {
        let line = line.map_err(|e| {
            eprintln!("Error reading line from file {}: {}", path.display(), e);
            e.to_string()
        })?;
        let message: serde_json::Value = serde_json::from_str(&line).map_err(|e| {
            eprintln!(
                "Error parsing JSON from line in file {}: {}",
                path.display(),
                e
            );
            e.to_string()
        })?;
        messages.push(message);
    }

    Ok(messages)
}

/// Update thread metadata by writing to thread.json
pub fn update_thread_metadata(
    data_folder: &Path,
    thread_id: &str,
    thread: &serde_json::Value,
) -> Result<(), String> {
    let path = get_thread_metadata_path(data_folder, thread_id);
    let data = serde_json::to_string_pretty(thread).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())?;
    Ok(())
}
