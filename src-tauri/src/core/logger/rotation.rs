use std::fs;
use std::io;
use std::path::Path;

const MAX_SIZE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_BACKUPS: u32 = 5;

/// Rotate the log file if it exceeds the maximum size.
///
/// Backups are named `<file_name>.jsonl.1` through `<file_name>.jsonl.5`.
/// The oldest backup (`.5`) is deleted, existing backups are shifted up by one,
/// and the current file is moved to `.1`.
pub fn rotate_if_needed(log_dir: &Path, file_name: &str) -> io::Result<()> {
    let current_file = log_dir.join(format!("{}.jsonl", file_name));

    if !current_file.exists() {
        return Ok(());
    }

    let metadata = fs::metadata(&current_file)?;
    if metadata.len() <= MAX_SIZE_BYTES {
        return Ok(());
    }

    // Delete oldest backup if it exists.
    let oldest = log_dir.join(format!("{}.jsonl.{}", file_name, MAX_BACKUPS));
    if oldest.exists() {
        fs::remove_file(&oldest)?;
    }

    // Shift backups up by one.
    for i in (1..MAX_BACKUPS).rev() {
        let from = log_dir.join(format!("{}.jsonl.{}", file_name, i));
        let to = log_dir.join(format!("{}.jsonl.{}", file_name, i + 1));
        if from.exists() {
            fs::rename(&from, &to)?;
        }
    }

    // Move current file to .1
    fs::rename(&current_file, log_dir.join(format!("{}.jsonl.1", file_name)))?;

    Ok(())
}
