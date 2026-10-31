#[cfg(windows)]
use std::path::Prefix;
use std::path::{Component, Path, PathBuf};

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

#[cfg(windows)]
use std::ffi::OsStr;

#[cfg(windows)]
use windows_sys::Win32::Storage::FileSystem::GetShortPathNameW;

/// Normalizes file paths by handling path components, prefixes, and resolving relative paths
/// Based on: https://github.com/rust-lang/cargo/blob/rust-1.67.0/crates/cargo-util/src/paths.rs#L82-L107
pub fn normalize_path(path: &Path) -> PathBuf {
    let mut components = path.components().peekable();
    let mut ret = if let Some(c @ Component::Prefix(_prefix_component)) = components.peek().cloned()
    {
        #[cfg(windows)]
        // Remove only the Verbatim prefix, but keep the drive letter (e.g., C:\)
        match _prefix_component.kind() {
            Prefix::VerbatimDisk(disk) => {
                components.next(); // skip this prefix
                                   // Re-add the disk prefix (e.g., C:)
                let mut pb = PathBuf::new();
                pb.push(format!("{}:", disk as char));
                pb
            }
            Prefix::VerbatimUNC(server, share) => {
                components.next(); // skip this prefix
                // Re-add it as a plain UNC prefix (\\server\share), not a
                // relative `UNC\server\share`.
                PathBuf::from(format!(
                    r"\\{}\{}",
                    server.to_string_lossy(),
                    share.to_string_lossy()
                ))
            }
            Prefix::Verbatim(_) => {
                components.next(); // skip this prefix
                PathBuf::new()
            }
            _ => {
                components.next();
                PathBuf::from(c.as_os_str())
            }
        }
        #[cfg(not(windows))]
        {
            components.next(); // skip this prefix
            PathBuf::from(c.as_os_str())
        }
    } else {
        PathBuf::new()
    };

    for component in components {
        match component {
            Component::Prefix(..) => unreachable!(),
            Component::RootDir => {
                ret.push(component.as_os_str());
            }
            Component::CurDir => {}
            Component::ParentDir => {
                ret.pop();
            }
            Component::Normal(c) => {
                ret.push(c);
            }
        }
    }
    ret
}

/// Rewrites a Windows verbatim path as the plain form other tools expect:
/// `\\?\C:\x` becomes `C:\x` and `\\?\UNC\server\share\x` becomes
/// `\\server\share\x`. Anything else (including other `\\?\` forms such as
/// volume GUID paths) is returned unchanged. Pure string logic, so it behaves
/// the same on every host.
pub fn strip_verbatim_prefix(path: &str) -> String {
    let Some(rest) = path.strip_prefix(r"\\?\") else {
        return path.to_string();
    };
    if rest.get(..4).is_some_and(|p| p.eq_ignore_ascii_case(r"UNC\")) {
        return format!(r"\\{}", &rest[4..]);
    }
    let b = rest.as_bytes();
    if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b.len() == 2 || b[2] == b'\\')
    {
        return rest.to_string();
    }
    path.to_string()
}

/// Removes file:/ and file:\ prefixes from file paths
pub fn normalize_file_path(path: &str) -> String {
    path.replace("file:/", "").replace("file:\\", "")
}

/// Removes prefix from path string with proper formatting
pub fn remove_prefix(path: &str, prefix: &str) -> String {
    if !prefix.is_empty() && path.starts_with(prefix) {
        let result = path[prefix.len()..].to_string();
        if result.is_empty() {
            "/".to_string()
        } else if result.starts_with('/') {
            result
        } else {
            format!("/{}", result)
        }
    } else {
        path.to_string()
    }
}

/// Get Windows short path to avoid issues with spaces and special characters
#[cfg(windows)]
pub fn get_short_path<P: AsRef<std::path::Path>>(path: P) -> Option<String> {
    let wide: Vec<u16> = OsStr::new(path.as_ref())
        .encode_wide()
        .chain(Some(0))
        .collect();

    let mut buffer = vec![0u16; 260];
    let len = unsafe { GetShortPathNameW(wide.as_ptr(), buffer.as_mut_ptr(), buffer.len() as u32) };

    if len > 0 {
        Some(String::from_utf16_lossy(&buffer[..len as usize]))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_verbatim_prefix_handles_drive_and_unc_paths() {
        assert_eq!(
            strip_verbatim_prefix(r"\\?\C:\Program Files\Git\cmd\git.exe"),
            r"C:\Program Files\Git\cmd\git.exe"
        );
        assert_eq!(strip_verbatim_prefix(r"\\?\d:\"), r"d:\");
        assert_eq!(strip_verbatim_prefix(r"\\?\C:"), r"C:");
        assert_eq!(
            strip_verbatim_prefix(r"\\?\UNC\server\share\Jan"),
            r"\\server\share\Jan"
        );
        assert_eq!(
            strip_verbatim_prefix(r"\\?\unc\server\share"),
            r"\\server\share"
        );
        // Already plain, or a verbatim form with no plain equivalent: unchanged.
        for same in [
            r"C:\Users\u\Jan",
            r"\\server\share\Jan",
            r"\\?\Volume{0b1c2d3e-0000-0000-0000-100000000000}\Jan",
            r"\\?\GLOBALROOT\Device\x",
            r"/Users/u/Jan",
            r"UNC\server\share",
            "",
        ] {
            assert_eq!(strip_verbatim_prefix(same), same);
        }
    }

    #[cfg(windows)]
    #[test]
    fn test_get_short_path() {
        // Test with a real path that should exist on Windows
        use std::env;
        if let Ok(temp_dir) = env::var("TEMP") {
            let result = get_short_path(&temp_dir);
            // Should return some short path or None (both are valid)
            // We can't assert the exact value as it depends on the system
            println!("Short path result: {:?}", result);
        }
    }
}
