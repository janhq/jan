//! Small file helpers shared by the registry and the source store: atomic
//! JSON writes, timestamps and random ids, without extra dependencies.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sha2::{Digest, Sha512};

use crate::error::StoreError;

/// Writes `value` as pretty JSON to `path` through a temporary file in the
/// same directory and a rename, so a crash leaves the old or the new file,
/// never a torn one.
pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), StoreError> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(dir)?;
    let mut bytes = serde_json::to_vec_pretty(value)?;
    bytes.push(b'\n');
    let tmp = tmp_path(path);
    let result = (|| -> Result<(), StoreError> {
        let mut file = File::create(&tmp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn tmp_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    path.with_file_name(format!(".{name}.tmp-{}", random_id()))
}

/// Seconds since the Unix epoch.
pub fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// `secs` since the epoch as `YYYY-MM-DDTHH:MM:SSZ`.
pub fn rfc3339(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3_600,
        rem % 3_600 / 60,
        rem % 60
    )
}

/// The current time as RFC 3339 UTC.
pub fn now_rfc3339() -> String {
    rfc3339(unix_now())
}

/// A 32-hex-digit id that is unique within this process and unpredictable
/// enough that one stage or source cannot be guessed from another. Not a
/// secret: ids only name entries the caller already owns.
pub fn random_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut hasher = Sha512::new();
    hasher.update(nanos.to_le_bytes());
    hasher.update(COUNTER.fetch_add(1, Ordering::Relaxed).to_le_bytes());
    hasher.update(std::process::id().to_le_bytes());
    // The address of a stack value adds ASLR entropy.
    let marker = 0u8;
    hasher.update((&marker as *const u8 as usize).to_le_bytes());
    hasher.finalize()[..16]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Whether `id` looks like a [`random_id`].
pub fn is_random_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_rfc3339() {
        assert_eq!(rfc3339(0), "1970-01-01T00:00:00Z");
        assert_eq!(rfc3339(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(rfc3339(1_792_744_496), "2026-10-23T08:34:56Z");
    }

    #[test]
    fn ids_are_distinct_and_well_formed() {
        let a = random_id();
        let b = random_id();
        assert_ne!(a, b);
        assert!(is_random_id(&a));
        assert!(!is_random_id("../x"));
    }

    #[test]
    fn writes_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x.json");
        write_json_atomic(&path, &serde_json::json!({ "a": 1 })).unwrap();
        write_json_atomic(&path, &serde_json::json!({ "a": 2 })).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("\"a\": 2"));
        let names: Vec<_> = fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, vec![std::ffi::OsString::from("x.json")]);
    }
}
