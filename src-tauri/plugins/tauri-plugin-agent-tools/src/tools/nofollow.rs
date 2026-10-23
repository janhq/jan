//! Open a fully resolved path without following any link along it.
//!
//! The filesystem tools decide where a path lands ([`super::sandbox::landing`])
//! and only then touch it. Reopening the path by name afterwards would resolve
//! it a second time, and a link swapped into it in between (the sandboxed shell
//! can write the project) would carry the write somewhere the check never saw.
//! These helpers take the already-resolved path, which contains no links, and
//! walk it one directory at a time refusing any link they meet, so the file
//! they open is the one that was checked or nothing at all.
//!
//! Unix walks with `openat(O_NOFOLLOW)` relative to the previous directory's
//! descriptor. Windows has no `openat` in std, so each ancestor is held open
//! without `FILE_SHARE_DELETE`, which keeps it from being renamed or replaced
//! while the walk below it runs, and each node is opened with
//! `FILE_FLAG_OPEN_REPARSE_POINT` and refused if it is a link or junction.

use std::io::{self, Read, Write};
use std::path::Path;

/// Marker for "a link was found where the resolved path had none": the path was
/// changed between the containment check and the open.
#[derive(Debug)]
pub struct LinkRefused;

impl std::fmt::Display for LinkRefused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("a path component became a symbolic link")
    }
}

impl std::error::Error for LinkRefused {}

/// True iff `e` is the [`LinkRefused`] refusal rather than an ordinary I/O error.
pub fn is_link_refused(e: &io::Error) -> bool {
    e.get_ref().is_some_and(|inner| inner.is::<LinkRefused>())
}

fn refused() -> io::Error {
    io::Error::other(LinkRefused)
}

fn invalid(path: &Path) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        format!("not an absolute resolved path: {}", path.display()),
    )
}

/// Read the file at the resolved `path`.
pub fn read(path: &Path) -> io::Result<Vec<u8>> {
    let mut file = imp::open_leaf(path, false)?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)?;
    Ok(buf)
}

/// Create or truncate the file at the resolved `path` and write `bytes`,
/// creating any missing parent directories on the way.
pub fn write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = imp::open_leaf(path, true)?;
    file.write_all(bytes)?;
    file.flush()
}

#[cfg(unix)]
mod imp {
    use super::{invalid, refused};
    use nix::errno::Errno;
    use nix::fcntl::{openat, AtFlags, OFlag, AT_FDCWD};
    use nix::sys::stat::{fstatat, mkdirat, Mode, SFlag};
    use std::ffi::OsStr;
    use std::fs::File;
    use std::io;
    use std::os::fd::OwnedFd;
    use std::path::{Component, Path};

    /// A directory descriptor that needs only search permission on the
    /// directory, so a `711` parent (common for `/home/<user>`) still walks.
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    const DIR: OFlag = OFlag::O_PATH;
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    const DIR: OFlag = OFlag::O_SEARCH;
    #[cfg(not(any(
        target_os = "linux",
        target_os = "android",
        target_os = "freebsd",
        target_os = "macos",
        target_os = "ios"
    )))]
    const DIR: OFlag = OFlag::O_RDONLY;

    /// Map a failed no-follow open of `name` under `dir`: a link there is the
    /// swap this module exists to catch. Platforms disagree on the errno
    /// (`ELOOP`, or `ENOTDIR` when `O_DIRECTORY` sees the link), so ask the
    /// directory what the entry is instead of trusting the code.
    fn classify(dir: &OwnedFd, name: &OsStr, err: Errno) -> io::Error {
        match fstatat(dir, name, AtFlags::AT_SYMLINK_NOFOLLOW) {
            Ok(st) if SFlag::from_bits_truncate(st.st_mode) & SFlag::S_IFMT == SFlag::S_IFLNK => {
                refused()
            }
            _ => err.into(),
        }
    }

    pub(super) fn open_leaf(path: &Path, create: bool) -> io::Result<File> {
        let (Some(parent), Some(name)) = (path.parent(), path.file_name()) else {
            return Err(invalid(path));
        };
        let mut comps = parent.components();
        if comps.next() != Some(Component::RootDir) {
            return Err(invalid(path));
        }
        let dir_flags = DIR | OFlag::O_DIRECTORY | OFlag::O_NOFOLLOW | OFlag::O_CLOEXEC;
        let mut dir = openat(AT_FDCWD, "/", dir_flags, Mode::empty())?;
        for c in comps {
            let Component::Normal(part) = c else {
                return Err(invalid(path));
            };
            if create {
                match mkdirat(&dir, part, Mode::from_bits_truncate(0o777)) {
                    Ok(()) | Err(Errno::EEXIST) => {}
                    Err(e) => return Err(e.into()),
                }
            }
            dir = match openat(&dir, part, dir_flags, Mode::empty()) {
                Ok(next) => next,
                Err(e) => return Err(classify(&dir, part, e)),
            };
        }
        let flags = if create {
            OFlag::O_WRONLY | OFlag::O_CREAT | OFlag::O_TRUNC
        } else {
            OFlag::O_RDONLY
        } | OFlag::O_NOFOLLOW
            | OFlag::O_CLOEXEC;
        match openat(&dir, name, flags, Mode::from_bits_truncate(0o666)) {
            Ok(fd) => Ok(File::from(fd)),
            Err(e) => Err(classify(&dir, name, e)),
        }
    }
}

#[cfg(windows)]
mod imp {
    use super::{invalid, refused};
    use std::fs::{File, OpenOptions};
    use std::io;
    use std::os::windows::fs::OpenOptionsExt;
    use std::path::{Component, Path, PathBuf};
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ, FILE_SHARE_WRITE,
    };

    /// No `FILE_SHARE_DELETE`: while this handle lives, nobody can rename,
    /// delete or replace the node, which is what pins the walked chain.
    const SHARE: u32 = FILE_SHARE_READ | FILE_SHARE_WRITE;

    /// Refuse a link or junction. `File::metadata` reads the reparse tag, so
    /// `is_symlink` is true only for name-surrogate tags: a OneDrive
    /// placeholder is also a reparse point and must stay writable.
    fn reject_link(file: &File) -> io::Result<std::fs::Metadata> {
        let meta = file.metadata()?;
        if meta.file_type().is_symlink() {
            return Err(refused());
        }
        Ok(meta)
    }

    fn pin_dir(path: &Path) -> io::Result<File> {
        let dir = OpenOptions::new()
            .access_mode(FILE_READ_ATTRIBUTES)
            .share_mode(SHARE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)?;
        if !reject_link(&dir)?.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::NotADirectory,
                format!("not a directory: {}", path.display()),
            ));
        }
        Ok(dir)
    }

    pub(super) fn open_leaf(path: &Path, create: bool) -> io::Result<File> {
        let (Some(parent), Some(_)) = (path.parent(), path.file_name()) else {
            return Err(invalid(path));
        };
        if !parent.has_root() {
            return Err(invalid(path));
        }
        let mut walked = PathBuf::new();
        let mut held: Vec<File> = Vec::new();
        for c in parent.components() {
            match c {
                Component::Prefix(_) => {
                    walked.push(c.as_os_str());
                    continue;
                }
                Component::RootDir => walked.push(c.as_os_str()),
                Component::Normal(part) => {
                    walked.push(part);
                    if create {
                        match std::fs::create_dir(&walked) {
                            Ok(()) => {}
                            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
                            Err(e) => return Err(e),
                        }
                    }
                }
                _ => return Err(invalid(path)),
            }
            held.push(pin_dir(&walked)?);
        }
        let mut opts = OpenOptions::new();
        opts.share_mode(SHARE)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
        if create {
            // Not `truncate`: a link opened with OPEN_REPARSE_POINT would be
            // truncated itself before the check below could refuse it.
            opts.write(true).create(true);
        } else {
            opts.read(true);
        }
        let file = opts.open(path)?;
        reject_link(&file)?;
        if create {
            file.set_len(0)?;
        }
        drop(held);
        Ok(file)
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn dir() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let d = std::env::temp_dir()
            .join(format!("jan_nofollow_test_{}_{}", std::process::id(), n));
        std::fs::create_dir_all(&d).unwrap();
        d.canonicalize().unwrap()
    }

    #[test]
    fn writes_and_reads_creating_parents() {
        let root = dir();
        let target = root.join("a/b/c.txt");
        write(&target, b"hello").unwrap();
        assert_eq!(read(&target).unwrap(), b"hello");
        write(&target, b"hi").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"hi", "truncates");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A link swapped in for a directory after the path was resolved: the walk
    /// must stop there instead of writing on the far side.
    #[test]
    fn a_link_in_a_directory_component_is_refused() {
        let root = dir();
        let outside = dir();
        std::os::unix::fs::symlink(&outside, root.join("sub")).unwrap();
        for create in [true, false] {
            let err = if create {
                write(&root.join("sub/x.txt"), b"x").unwrap_err()
            } else {
                read(&root.join("sub/x.txt")).unwrap_err()
            };
            assert!(is_link_refused(&err), "create={create}: {err}");
        }
        assert!(!outside.join("x.txt").exists());
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// The leaf itself swapped for a link, dangling or not: neither is followed.
    #[test]
    fn a_link_at_the_leaf_is_refused() {
        let root = dir();
        let outside = dir();
        std::fs::write(outside.join("existing"), b"keep").unwrap();
        std::os::unix::fs::symlink(outside.join("existing"), root.join("a")).unwrap();
        std::os::unix::fs::symlink(outside.join("new"), root.join("b")).unwrap();
        assert!(is_link_refused(&write(&root.join("a"), b"x").unwrap_err()));
        assert!(is_link_refused(&write(&root.join("b"), b"x").unwrap_err()));
        assert!(is_link_refused(&read(&root.join("a")).unwrap_err()));
        assert_eq!(std::fs::read(outside.join("existing")).unwrap(), b"keep");
        assert!(!outside.join("new").exists());
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn a_relative_path_is_rejected() {
        let err = write(Path::new("rel/x.txt"), b"x").unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
    }
}
