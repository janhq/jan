use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;

// For async file write serialization
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::OnceLock;
use tokio::sync::Mutex;

use super::utils::{
    get_data_dir, get_messages_path, get_thread_dir, get_thread_metadata_path, DELETING_PREFIX,
};

// Global per-thread locks for message file writes
pub static MESSAGE_LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();

/// Check if the platform should use SQLite (mobile platforms)
pub fn should_use_sqlite() -> bool {
    cfg!(any(target_os = "android", target_os = "ios"))
}

/// Removes a thread's directory. The app calls it under the thread lock.
///
/// The directory is first renamed aside, which either succeeds whole or leaves
/// the thread untouched: on Windows a file another program holds open fails it,
/// and the error is reported with every file still in place. Removing a
/// directory in place could instead fail halfway and leave a thread without
/// some of its files. Once renamed the thread is gone; what the removal cannot
/// delete (a file whose ACL forbids it) stays under the hidden name and is
/// retried by the next `list_threads`. A thread that does not exist is not an
/// error.
pub fn remove_thread_dir(data_folder: &Path, thread_id: &str) -> Result<(), String> {
    let thread_dir = get_thread_dir(data_folder, thread_id)?;
    let aside = get_data_dir(data_folder)
        .join(format!("{DELETING_PREFIX}{thread_id}-{}", uuid::Uuid::new_v4()));
    match fs::rename(&thread_dir, &aside) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("could not delete thread {thread_id}: {e}")),
    }
    if let Err(e) = fs::remove_dir_all(&aside) {
        log::warn!(
            "thread {thread_id} deleted; some of its files remain until the next listing: {e}"
        );
    }
    Ok(())
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
/// on it. The content is in place either way. A filesystem that cannot sync a
/// directory at all is not a failure: no stronger promise exists there.
pub fn write_atomic_durable(path: &Path, body: &[u8]) -> Result<(), String> {
    write_atomic_with(path, body, sync_dir, true)
}

#[cfg(unix)]
fn directory_sync_unsupported(e: &std::io::Error) -> bool {
    matches!(
        e.raw_os_error(),
        Some(code) if code == libc::EINVAL || code == libc::ENOTSUP || code == libc::EOPNOTSUPP
    )
}

#[cfg(not(unix))]
fn directory_sync_unsupported(_e: &std::io::Error) -> bool {
    false
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
        Err(e) if strict && !directory_sync_unsupported(&e) => Err(e.to_string()),
        Err(e) => {
            log::debug!("directory sync after writing {} failed: {e}", path.display());
            Ok(())
        }
    }
}

/// How old an atomic-write temp file must be before a sweep treats it as
/// abandoned. A write holds its temp file for milliseconds, so this leaves a
/// wide margin for a live writer, even a slow one on a busy disk.
pub const STALE_TEMP_AGE: std::time::Duration = std::time::Duration::from_secs(10 * 60);

/// Whether `name` is a temp file [`write_atomic`] creates: `.<target>.<uuid>.tmp`.
fn is_atomic_temp_name(name: &str) -> bool {
    let Some(inner) = name.strip_prefix('.').and_then(|n| n.strip_suffix(".tmp")) else {
        return false;
    };
    let Some((target, id)) = inner.rsplit_once('.') else {
        return false;
    };
    !target.is_empty() && uuid::Uuid::try_parse(id).is_ok()
}

/// Remove the temp files a killed [`write_atomic`] left directly inside `dir`,
/// once they are older than `max_age` at `now`. The committed file it was
/// replacing is never touched, nor is anything else in `dir`; symlinks are not
/// followed. Returns how many were removed.
pub fn sweep_stale_temps(dir: &Path, max_age: std::time::Duration, now: std::time::SystemTime) -> usize {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        if !name.to_str().is_some_and(is_atomic_temp_name) {
            continue;
        }
        // `DirEntry::metadata` does not follow a symlink.
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let stale = meta
            .modified()
            .ok()
            .and_then(|m| now.duration_since(m).ok())
            .is_some_and(|age| age >= max_age);
        if !stale {
            continue;
        }
        match fs::remove_file(entry.path()) {
            Ok(()) => removed += 1,
            Err(e) => log::debug!("could not remove stale temp {}: {e}", entry.path().display()),
        }
    }
    removed
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

    fn failed_sync(_: &Path) -> std::io::Result<()> {
        Err(std::io::Error::from_raw_os_error(5))
    }

    /// A filesystem that cannot sync a directory at all offers no stronger
    /// promise to wait for, so even the strict form must not fail every
    /// thread created on it.
    #[cfg(unix)]
    #[test]
    fn the_strict_write_accepts_a_filesystem_without_directory_sync() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("thread.json");
        write_atomic_with(&path, b"body", refused_sync, true).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"body");
    }

    #[cfg(unix)]
    #[test]
    fn only_refusals_count_as_a_filesystem_without_directory_sync() {
        let err = std::io::Error::from_raw_os_error;
        for errno in [libc::EINVAL, libc::ENOTSUP, libc::EOPNOTSUPP] {
            assert!(directory_sync_unsupported(&err(errno)), "errno {errno}");
        }
        for errno in [libc::EIO, libc::ENOSPC, libc::EACCES] {
            assert!(!directory_sync_unsupported(&err(errno)), "errno {errno}");
        }
    }

    /// The thread.json commit asks for the strict form: there a directory sync
    /// that failed is reported (the content is in place either way).
    #[test]
    fn the_strict_write_reports_a_failed_directory_sync() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("thread.json");
        assert!(write_atomic_with(&path, b"body", failed_sync, true).is_err());
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

    /// After a kill mid-write, only the old orphan goes: the committed file,
    /// a fresh (possibly live) temp, look-alikes and a symlinked temp stay.
    #[test]
    fn sweep_removes_only_stale_atomic_temps() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        fs::write(d.join("messages.jsonl"), "committed").unwrap();
        let orphan = format!(".messages.jsonl.{}.tmp", uuid::Uuid::new_v4());
        let live = format!(".thread.json.{}.tmp", uuid::Uuid::new_v4());
        fs::write(d.join(&orphan), "partial").unwrap();
        fs::write(d.join(&live), "in flight").unwrap();
        for other in [".notes.tmp", ".messages.jsonl.not-a-uuid.tmp", "user.tmp"] {
            fs::write(d.join(other), "x").unwrap();
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            d.join("messages.jsonl"),
            d.join(format!(".x.{}.tmp", uuid::Uuid::new_v4())),
        )
        .unwrap();
        // The orphan is an hour old, the live temp seconds old.
        let mtime = |name: &str, ago: u64| {
            let t = std::time::SystemTime::now() - std::time::Duration::from_secs(ago);
            File::options().write(true).open(d.join(name)).unwrap().set_modified(t).unwrap();
        };
        mtime(&orphan, 3600);
        mtime(&live, 2);
        for other in [".notes.tmp", ".messages.jsonl.not-a-uuid.tmp", "user.tmp"] {
            mtime(other, 3600);
        }

        let removed = sweep_stale_temps(d, STALE_TEMP_AGE, std::time::SystemTime::now());

        assert_eq!(removed, 1);
        assert!(!d.join(&orphan).exists());
        assert!(d.join(&live).exists(), "a live writer's temp must survive");
        assert_eq!(fs::read_to_string(d.join("messages.jsonl")).unwrap(), "committed");
        for other in [".notes.tmp", ".messages.jsonl.not-a-uuid.tmp", "user.tmp"] {
            assert!(d.join(other).exists(), "{other} is not ours");
        }
        #[cfg(unix)]
        assert_eq!(fs::read_dir(d).unwrap().count(), 6);
    }
}
