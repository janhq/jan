//! Safe extraction of an npm-style `.tgz` (every path under `package/`).
//!
//! The archive is untrusted. Nothing here calls `Archive::unpack` or trusts a
//! header: sizes are counted on the decompressed stream as it is read, every
//! path is parsed from its raw bytes, only regular files and directories are
//! written, and each file is created with `create_new` inside a destination
//! this function creates itself, so no entry can follow a link or overwrite
//! anything. Exec bits are dropped. On any error the destination is removed.

use std::cell::Cell;
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::rc::Rc;

use flate2::read::GzDecoder;
use serde_json::Value;
use tar::{Archive, EntryType};

use crate::error::BundleError;

/// Caps applied while extracting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// Decompressed bytes of the whole stream (headers and padding included).
    pub max_total_bytes: u64,
    /// Archive entries, directories included.
    pub max_entries: usize,
    /// Bytes of one file.
    pub max_file_bytes: u64,
    /// Distinct directories, explicit or implied by a file's path.
    pub max_dirs: usize,
    /// Segments of one path below `package/`, the file name included.
    pub max_depth: usize,
    /// Bytes of one path below `package/`, `/` separators included. Kept
    /// short enough that the extracted tree fits the Windows MAX_PATH budget
    /// under a typical data folder.
    pub max_path_bytes: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            max_total_bytes: 50 * 1024 * 1024,
            max_entries: 2000,
            max_file_bytes: 20 * 1024 * 1024,
            max_dirs: 2000,
            max_depth: 32,
            max_path_bytes: 240,
        }
    }
}

/// What [`extract`] wrote.
#[derive(Debug, Clone, PartialEq)]
pub struct ExtractedPackage {
    /// The destination, holding the contents of `package/`.
    pub root: PathBuf,
    /// `package.json`, parsed.
    pub package_json: Value,
    /// Every file written, relative to `root`, `/`-separated.
    pub files: Vec<String>,
}

/// Counts decompressed bytes and fails once `limit` is passed, so a header
/// claiming a small size cannot hide a large stream.
struct Counted<R> {
    inner: R,
    read: Rc<Cell<u64>>,
    limit: u64,
}

impl<R: Read> Read for Counted<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        let total = self.read.get() + n as u64;
        self.read.set(total);
        if total > self.limit {
            return Err(io::Error::other("decompressed size limit exceeded"));
        }
        Ok(n)
    }
}

/// Names Windows treats as devices in any directory, with any extension.
/// Shared with the extension id check, whose parts become directory names.
pub(crate) const RESERVED_NAMES: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

fn safe_segment(segment: &str) -> bool {
    let stem = segment.split('.').next().unwrap_or("").to_ascii_lowercase();
    !segment.is_empty()
        && segment != "."
        && segment != ".."
        && !segment
            .chars()
            .any(|c| c.is_control() || matches!(c, '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*'))
        // Windows strips trailing dots and spaces, so `a.` would alias `a`.
        && !segment.ends_with(['.', ' '])
        && !RESERVED_NAMES.contains(&stem.as_str())
}

/// The path of an entry relative to `package/`, as `/`-separated segments,
/// or `None` when it is not a plain relative path under `package/`. An
/// entry for `package/` itself yields an empty list.
pub fn package_relative(raw: &[u8], is_dir: bool) -> Option<Vec<String>> {
    let text = std::str::from_utf8(raw).ok()?;
    let rest = text.strip_prefix("package/")?;
    let rest = if is_dir {
        rest.strip_suffix('/').unwrap_or(rest)
    } else {
        rest
    };
    if rest.is_empty() {
        return is_dir.then(Vec::new);
    }
    let segments: Vec<String> = rest.split('/').map(str::to_string).collect();
    segments
        .iter()
        .all(|s| safe_segment(s))
        .then_some(segments)
}

fn kind_name(kind: EntryType) -> String {
    match kind {
        EntryType::Link => "hard link".into(),
        EntryType::Symlink => "symlink".into(),
        EntryType::Char => "character device".into(),
        EntryType::Block => "block device".into(),
        EntryType::Fifo => "fifo".into(),
        EntryType::Continuous => "contiguous file".into(),
        EntryType::GNUSparse => "sparse file".into(),
        EntryType::XGlobalHeader => "global pax header".into(),
        other => format!("entry of type {:?}", other.as_byte() as char),
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Seen {
    File,
    Dir,
}

fn set_mode(path: &Path, _mode: u32) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(_mode))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

fn make_dir(path: &Path) -> io::Result<()> {
    match fs::create_dir(path) {
        Ok(()) => set_mode(path, 0o755),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists && path.is_dir() => Ok(()),
        Err(e) => Err(e),
    }
}

/// Extracts the gzipped tarball `reader` into `dest`, which must not exist.
pub fn extract<R: Read>(reader: R, dest: &Path, limits: Limits) -> Result<ExtractedPackage, BundleError> {
    if fs::symlink_metadata(dest).is_ok() {
        return Err(BundleError::DestinationExists(dest.to_path_buf()));
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::create_dir(dest)?;
    set_mode(dest, 0o755)?;
    let read = Rc::new(Cell::new(0u64));
    let result = extract_into(reader, dest, limits, &read).map_err(|e| match e {
        // Whatever tar made of the failed read, the cause was the cap.
        BundleError::Io(_) if read.get() > limits.max_total_bytes => BundleError::TooLarge {
            limit: limits.max_total_bytes,
        },
        other => other,
    });
    if result.is_err() {
        // Best effort: the caller's staging cleanup removes anything left.
        let _ = fs::remove_dir_all(dest);
    }
    result
}

fn extract_into<R: Read>(
    reader: R,
    dest: &Path,
    limits: Limits,
    read: &Rc<Cell<u64>>,
) -> Result<ExtractedPackage, BundleError> {
    let counted = Counted {
        inner: GzDecoder::new(reader),
        read: Rc::clone(read),
        limit: limits.max_total_bytes,
    };
    let mut archive = Archive::new(counted);
    let mut seen: HashMap<String, Seen> = HashMap::new();
    let mut files = Vec::new();
    let mut entries = 0usize;
    let mut dirs = 0usize;
    // Counts a directory about to be created, before the syscall.
    let mut new_dir = || -> Result<(), BundleError> {
        dirs += 1;
        if dirs > limits.max_dirs {
            return Err(BundleError::TooManyDirectories {
                limit: limits.max_dirs,
            });
        }
        Ok(())
    };

    for entry in archive.entries()? {
        let mut entry = entry?;
        entries += 1;
        if entries > limits.max_entries {
            return Err(BundleError::TooManyEntries {
                limit: limits.max_entries,
            });
        }
        let raw = entry.path_bytes().into_owned();
        let shown = String::from_utf8_lossy(&raw).into_owned();
        let kind = entry.header().entry_type();
        let is_dir = match kind {
            EntryType::Regular => false,
            EntryType::Directory => true,
            other => {
                return Err(BundleError::UnsupportedEntry {
                    path: shown,
                    kind: kind_name(other),
                })
            }
        };
        let segments = package_relative(&raw, is_dir).ok_or(BundleError::UnsafePath {
            path: shown.clone(),
        })?;
        if segments.is_empty() {
            continue;
        }
        // Bounds the per-entry work below: without them a few KiB of
        // compressed headers can demand millions of ancestor checks.
        let joined = segments.join("/");
        if segments.len() > limits.max_depth || joined.len() > limits.max_path_bytes {
            return Err(BundleError::PathTooLong {
                path: shown,
                max_depth: limits.max_depth,
                max_bytes: limits.max_path_bytes,
            });
        }

        // Every ancestor is a directory, and nothing may already be a file
        // there, compared case-insensitively as macOS and Windows would. An
        // ancestor already recorded as a directory exists on disk.
        let lower_segments: Vec<String> = segments.iter().map(|s| s.to_lowercase()).collect();
        let lower = lower_segments.join("/");
        let mut target = dest.to_path_buf();
        let mut end = 0;
        for (segment, lower_segment) in segments.iter().zip(&lower_segments).take(segments.len() - 1) {
            // Offsets come from the lowercased segments: lowercasing may
            // change a character's byte length.
            end += lower_segment.len();
            let ancestor = &lower[..end];
            end += 1;
            target.push(segment);
            match seen.get(ancestor) {
                Some(Seen::Dir) => continue,
                Some(Seen::File) => return Err(BundleError::Duplicate { path: shown }),
                None => {}
            }
            new_dir()?;
            seen.insert(ancestor.to_string(), Seen::Dir);
            make_dir(&target)?;
        }
        target.push(&segments[segments.len() - 1]);
        if is_dir {
            match seen.get(&lower) {
                Some(Seen::Dir) => {}
                Some(Seen::File) => return Err(BundleError::Duplicate { path: shown }),
                None => {
                    new_dir()?;
                    seen.insert(lower, Seen::Dir);
                    make_dir(&target)?;
                }
            }
            continue;
        }
        if seen.insert(lower, Seen::File).is_some() {
            return Err(BundleError::Duplicate { path: shown });
        }
        let declared = entry.header().size()?;
        if declared > limits.max_file_bytes {
            return Err(BundleError::FileTooLarge {
                path: shown,
                limit: limits.max_file_bytes,
            });
        }
        let mut file = OpenOptions::new().write(true).create_new(true).open(&target)?;
        let written = io::copy(&mut (&mut entry).take(limits.max_file_bytes + 1), &mut file)?;
        if written > limits.max_file_bytes {
            return Err(BundleError::FileTooLarge {
                path: shown,
                limit: limits.max_file_bytes,
            });
        }
        file.flush()?;
        drop(file);
        set_mode(&target, 0o644)?;
        files.push(joined);
    }

    // Read to the end of the gzip stream: it checks the CRC, and anything
    // after the archive still counts towards the size cap.
    let mut rest = archive.into_inner();
    io::copy(&mut rest, &mut io::sink())?;

    if !files.iter().any(|f| f == "package.json") {
        return Err(BundleError::MissingPackageJson);
    }
    let text = fs::read(dest.join("package.json"))?;
    let package_json: Value =
        serde_json::from_slice(&text).map_err(|e| BundleError::BadPackageJson(e.to_string()))?;
    if !package_json.is_object() {
        return Err(BundleError::BadPackageJson("not an object".into()));
    }
    Ok(ExtractedPackage {
        root: dest.to_path_buf(),
        package_json,
        files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rel(raw: &str) -> Option<Vec<String>> {
        package_relative(raw.as_bytes(), false)
    }

    #[test]
    fn accepts_plain_paths_under_package() {
        assert_eq!(rel("package/a/b.js"), Some(vec!["a".into(), "b.js".into()]));
        assert_eq!(package_relative(b"package/", true), Some(vec![]));
        assert_eq!(package_relative(b"package/dist/", true), Some(vec!["dist".into()]));
    }

    #[test]
    fn rejects_every_unsafe_form() {
        for raw in [
            "../x",
            "/etc/x",
            "package/../../x",
            "package/./x",
            "package//x",
            "package/a/",
            "package/C:\\x",
            "C:\\x",
            "package\\x",
            "package/a\u{0}b",
            "package/a\u{7}",
            "package/con.js",
            "package/a.",
            "package/a ",
            "x/package.json",
            "package",
            "Package/x",
        ] {
            assert_eq!(rel(raw), None, "{raw:?}");
        }
        assert_eq!(package_relative(&[b'p', 0xff], false), None);
    }
}
