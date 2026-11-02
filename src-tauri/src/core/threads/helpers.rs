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

/// Write messages to a thread's messages.jsonl file
pub fn write_messages_to_file(
    messages: &[serde_json::Value],
    path: &std::path::Path,
) -> Result<(), String> {
    let mut file = File::create(path).map_err(|e| e.to_string())?;
    for msg in messages {
        let data = serde_json::to_string(msg).map_err(|e| e.to_string())?;
        writeln!(file, "{data}").map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Read messages from a thread's messages.jsonl file
pub fn read_messages_from_file(
    data_folder: &Path,
    thread_id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let path = get_messages_path(data_folder, thread_id)?;
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
    let path = get_thread_metadata_path(data_folder, thread_id)?;
    let data = serde_json::to_string_pretty(thread).map_err(|e| e.to_string())?;
    write_file_atomic(&path, data.as_bytes())
}

/// Write a file by writing a uniquely named sibling temp file and renaming it
/// over the target, so a crash mid-write leaves the old contents (or nothing),
/// never a truncated file. The name is unique per call rather than guarded by
/// the thread lock, because some callers already hold that lock.
///
/// The temp file is fsynced before the rename so the rename can only ever
/// expose fully written bytes, and on Unix the parent directory is fsynced
/// after it (best-effort) so the new entry itself is pushed toward disk. This
/// narrows the power-loss window; it is not a full power-loss durability
/// guarantee across platforms and filesystems.
pub fn write_file_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let tmp = path.with_file_name(format!("{name}.{}.{n}.tmp", std::process::id()));
    let write_synced = (|| -> std::io::Result<()> {
        let mut file = File::create(&tmp)?;
        file.write_all(data)?;
        file.sync_all()
    })();
    if let Err(e) = write_synced {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })?;
    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        // Directories cannot be opened as files on Windows; on Unix this is
        // the conventional way to flush the rename's directory entry.
        if let Ok(dir) = File::open(parent) {
            let _ = dir.sync_all();
        }
    }
    Ok(())
}

#[cfg(test)]
mod write_file_atomic_tests {
    use super::*;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "jan-write-file-atomic-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writes_new_file_and_overwrites_existing_leaving_no_temp_files() {
        let dir = temp_dir("roundtrip");
        let target = dir.join("thread.json");
        write_file_atomic(&target, b"first").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"first");
        write_file_atomic(&target, b"second").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"second");
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path() != target)
            .collect();
        assert!(leftovers.is_empty(), "stray files: {leftovers:?}");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn failure_on_missing_parent_creates_nothing() {
        let dir = temp_dir("failure");
        let target = dir.join("missing-subdir").join("thread.json");
        assert!(write_file_atomic(&target, b"data").is_err());
        // A failed write to a bad path must not create or truncate anything.
        assert!(!target.exists());
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name() != "missing-subdir")
            .collect();
        assert!(leftovers.is_empty(), "stray files: {leftovers:?}");
        fs::remove_dir_all(&dir).unwrap();
    }

    /// Seeds a real target, then injects a write failure (read-only parent
    /// blocks the sibling temp file) and proves the previous bytes survive.
    #[cfg(unix)]
    #[test]
    fn failed_write_preserves_existing_target_bytes() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("preserve");
        let target = dir.join("thread.json");
        write_file_atomic(&target, b"original contents").unwrap();

        let mut read_only = fs::metadata(&dir).unwrap().permissions();
        read_only.set_mode(0o555);
        fs::set_permissions(&dir, read_only).unwrap();
        let result = write_file_atomic(&target, b"replacement");
        let mut writable = fs::metadata(&dir).unwrap().permissions();
        writable.set_mode(0o755);
        fs::set_permissions(&dir, writable).unwrap();

        // Root ignores permission bits; skip rather than assert a vacuous pass.
        if result.is_ok() {
            eprintln!("skipping: permissions not enforced (running as root?)");
            fs::remove_dir_all(&dir).unwrap();
            return;
        }
        assert_eq!(fs::read(&target).unwrap(), b"original contents");
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path() != target)
            .collect();
        assert!(leftovers.is_empty(), "stray files: {leftovers:?}");
        fs::remove_dir_all(&dir).unwrap();
    }
}
