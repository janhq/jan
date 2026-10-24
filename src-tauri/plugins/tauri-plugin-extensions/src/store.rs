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

fn digits(s: &str) -> Option<i64> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    // Howard Hinnant's days_from_civil, the inverse of `rfc3339`.
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Parses an RFC 3339 timestamp (`2026-10-24T08:00:00Z`, optional
/// fraction, `Z` or a `+HH:MM` offset) into seconds since the epoch and
/// nanoseconds, so two timestamps compare as instants rather than as
/// strings. `None` when it is not one.
pub fn parse_rfc3339(s: &str) -> Option<(i64, u32)> {
    let (date, rest) = s.split_once(['T', 't'])?;
    let mut date_parts = date.split('-');
    let (year, month, day) = (date_parts.next()?, date_parts.next()?, date_parts.next()?);
    if date_parts.next().is_some() || year.len() != 4 || month.len() != 2 || day.len() != 2 {
        return None;
    }
    let (year, month, day) = (digits(year)?, digits(month)?, digits(day)?);
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let month_days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if !(1..=12).contains(&month) || day < 1 || day > month_days[(month - 1) as usize] {
        return None;
    }
    let (time, offset) = if let Some(time) = rest.strip_suffix(['Z', 'z']) {
        (time, 0)
    } else {
        let at = rest.len().checked_sub(6)?;
        let (time, zone) = (rest.get(..at)?, rest.get(at..)?);
        let sign = match zone.as_bytes()[0] {
            b'+' => 1,
            b'-' => -1,
            _ => return None,
        };
        let (h, m) = zone[1..].split_once(':')?;
        let (h, m) = (digits(h)?, digits(m)?);
        if h > 23 || m > 59 {
            return None;
        }
        (time, sign * (h * 3_600 + m * 60))
    };
    let (clock, fraction) = match time.split_once('.') {
        Some((clock, fraction)) => (clock, Some(fraction)),
        None => (time, None),
    };
    let mut clock_parts = clock.split(':');
    let (h, m, sec) = (clock_parts.next()?, clock_parts.next()?, clock_parts.next()?);
    if clock_parts.next().is_some() || h.len() != 2 || m.len() != 2 || sec.len() != 2 {
        return None;
    }
    let (h, m, sec) = (digits(h)?, digits(m)?, digits(sec)?);
    if h > 23 || m > 59 || sec > 60 {
        return None;
    }
    let nanos = match fraction {
        None => 0,
        Some(f) if !f.is_empty() && f.len() <= 9 && f.bytes().all(|b| b.is_ascii_digit()) => {
            format!("{f:0<9}").parse().ok()?
        }
        Some(_) => return None,
    };
    let secs = days_from_civil(year, month, day) * 86_400 + h * 3_600 + m * 60 + sec - offset;
    Some((secs, nanos))
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
    fn parses_rfc3339_as_instants() {
        assert_eq!(parse_rfc3339("1970-01-01T00:00:00Z"), Some((0, 0)));
        assert_eq!(parse_rfc3339("2026-10-23T08:34:56Z"), Some((1_792_744_496, 0)));
        assert_eq!(parse_rfc3339("2000-02-29T00:00:00Z"), Some((951_782_400, 0)));
        assert_eq!(parse_rfc3339("2026-10-23T10:34:56.5+02:00"), Some((1_792_744_496, 500_000_000)));
        assert_eq!(parse_rfc3339("2026-10-23T07:34:56-01:00"), Some((1_792_744_496, 0)));
        for bad in [
            "",
            "x",
            "2026-10-23",
            "2026-10-23T08:34:56",
            "2026-13-01T00:00:00Z",
            "2026-02-29T00:00:00Z",
            "2026-10-23T24:00:00Z",
            "2026-10-23T08:34:56.Z",
            "2026-10-23T08:34:56+2:00",
            "+026-10-23T08:34:56Z",
        ] {
            assert_eq!(parse_rfc3339(bad), None, "{bad}");
        }
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
