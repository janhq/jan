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

/// Make a rename in `dir` durable. Syncing the file is not enough: after power
/// loss the directory entry can still be the old one, so a later rename (the
/// thread.json commit) could survive while an earlier one (its messages) does
/// not. Windows cannot open a directory for syncing, so it is a no-op there.
#[cfg(not(windows))]
pub(crate) fn sync_dir(dir: &Path) -> std::io::Result<()> {
    File::open(dir)?.sync_all()
}

#[cfg(windows)]
pub(crate) fn sync_dir(_dir: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Replace `path` with `body` atomically: write a uniquely named sibling temp
/// file, sync it, rename it over the target, then sync the parent directory so
/// the rename itself survives power loss. A crash mid-write leaves the previous
/// file whole, and two writers never share a temp file.
///
/// The parent sync is best-effort here: some filesystems refuse fsync on a
/// directory (EINVAL/ENOTSUP), and failing every chat write although the data
/// landed would be worse than a weaker durability promise. The thread.json
/// commit uses [`write_atomic_durable`] instead.
pub fn write_atomic(path: &Path, body: &[u8]) -> Result<(), String> {
    write_atomic_with(path, body, sync_dir, false)
}

/// [`write_atomic`] for the thread.json commit: a failed parent sync is an
/// error, since the migration's ordering (messages before thread.json) relies
/// on it. The content is in place either way.
pub fn write_atomic_durable(path: &Path, body: &[u8]) -> Result<(), String> {
    write_atomic_with(path, body, sync_dir, true)
}

fn write_atomic_with(
    path: &Path,
    body: &[u8],
    sync: fn(&Path) -> std::io::Result<()>,
    strict: bool,
) -> Result<(), String> {
    let name = path
        .file_name()
        .ok_or_else(|| format!("{} has no file name", path.display()))?
        .to_string_lossy();
    let tmp = path.with_file_name(format!(".{name}.{}.tmp", uuid::Uuid::new_v4()));
    let written = File::create(&tmp)
        .and_then(|mut file| file.write_all(body).and_then(|()| file.sync_all()))
        .and_then(|()| fs::rename(&tmp, path));
    if let Err(e) = written {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    // The target is already replaced here, so a failure leaves the temp file
    // gone and the new content in place.
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty());
    match sync(parent.unwrap_or_else(|| Path::new("."))) {
        Ok(()) => Ok(()),
        Err(e) if strict => Err(e.to_string()),
        Err(e) => {
            log::debug!("directory sync after writing {} failed: {e}", path.display());
            Ok(())
        }
    }
}

/// Write messages to a thread's messages.jsonl file, atomically.
pub fn write_messages_to_file(
    messages: &[serde_json::Value],
    path: &std::path::Path,
) -> Result<(), String> {
    let mut body = String::new();
    for msg in messages {
        body.push_str(&serde_json::to_string(msg).map_err(|e| e.to_string())?);
        body.push('\n');
    }
    write_atomic(path, body.as_bytes())
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

/// Update thread metadata by replacing thread.json atomically.
pub fn update_thread_metadata(
    data_folder: &Path,
    thread_id: &str,
    thread: &serde_json::Value,
) -> Result<(), String> {
    let path = get_thread_metadata_path(data_folder, thread_id)?;
    let data = serde_json::to_string_pretty(thread).map_err(|e| e.to_string())?;
    write_atomic(&path, data.as_bytes())
}

#[cfg(test)]
mod atomic_tests {
    use super::*;

    /// A replace leaves no temp file behind and never exposes a partial body.
    #[test]
    fn write_atomic_replaces_whole_and_cleans_up() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("thread.json");
        write_atomic(&path, b"first").unwrap();
        write_atomic(&path, b"second").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"second");
        let names: Vec<_> = fs::read_dir(dir.path()).unwrap().collect();
        assert_eq!(names.len(), 1, "temp files are renamed, not left behind");
    }

    /// A target that cannot be replaced fails without touching it.
    #[test]
    fn write_atomic_failure_leaves_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("taken");
        fs::create_dir(&path).unwrap();
        fs::write(path.join("inside"), "x").unwrap();
        assert!(write_atomic(&path, b"body").is_err());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    /// The directory entry of a rename is made durable by syncing the parent
    /// directory. A missing directory must surface as an error on Unix, which
    /// shows the helper really opens and syncs it instead of doing nothing.
    #[cfg(unix)]
    #[test]
    fn sync_dir_syncs_a_real_directory_and_fails_on_a_missing_one() {
        let dir = tempfile::tempdir().unwrap();
        sync_dir(dir.path()).unwrap();
        assert!(sync_dir(&dir.path().join("missing")).is_err());
    }

    /// Windows cannot open a directory for syncing; there it is a no-op.
    #[cfg(windows)]
    #[test]
    fn sync_dir_is_a_noop_on_windows() {
        let dir = tempfile::tempdir().unwrap();
        sync_dir(dir.path()).unwrap();
        sync_dir(&dir.path().join("missing")).unwrap();
    }

    fn refused_sync(_: &Path) -> std::io::Result<()> {
        Err(std::io::Error::from_raw_os_error(22))
    }

    /// Some filesystems refuse fsync on a directory (EINVAL/ENOTSUP). The
    /// rename has already replaced the file by then, so an ordinary write must
    /// still succeed with the new content in place.
    #[test]
    fn write_atomic_ignores_a_refused_directory_sync() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("messages.jsonl");
        write_atomic_with(&path, b"body", refused_sync, false).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"body");
    }

    /// The thread.json commit asks for the strict form: there a refused
    /// directory sync is reported (the content is in place either way).
    #[test]
    fn the_strict_write_reports_a_refused_directory_sync() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("thread.json");
        assert!(write_atomic_with(&path, b"body", refused_sync, true).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"body");
        write_atomic_durable(&path, b"again").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"again");
    }

    /// A write whose parent cannot be synced reports it rather than claiming
    /// the rename is durable. The parent here is a file, so the write fails first.
    #[test]
    fn write_atomic_into_a_non_directory_parent_fails_cleanly() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("plain");
        fs::write(&file, "x").unwrap();
        assert!(write_atomic(&file.join("thread.json"), b"body").is_err());
    }
}
