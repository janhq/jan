use std::path::{Path, PathBuf};

/// True iff `raw` resolves to a path outside `project_root`.
/// Relative paths are resolved against `project_root`. Canonicalizes (resolving
/// `..` and symlinks) so string tricks and symlink escapes are caught. For a
/// not-yet-existing leaf (new-file writes), the deepest existing ancestor is
/// canonicalized and the remaining tail re-joined.
pub fn escapes_project(project_root: &Path, raw: &str) -> Result<bool, String> {
    let root = project_root
        .canonicalize()
        .map_err(|e| format!("project root {:?}: {e}", project_root))?;
    let abs = if Path::new(raw).is_absolute() {
        PathBuf::from(raw)
    } else {
        root.join(raw)
    };
    let resolved = canonicalize_lenient(&abs)?;
    Ok(!resolved.starts_with(&root))
}

/// Canonicalize a path that may not fully exist: canonicalize the deepest
/// existing ancestor, then re-append the non-existing tail (resolving `.`/`..`
/// lexically). Errors only if no ancestor up to root exists.
fn canonicalize_lenient(path: &Path) -> Result<PathBuf, String> {
    if let Ok(p) = path.canonicalize() {
        return Ok(p);
    }
    let mut existing = path;
    let mut tail: Vec<&std::ffi::OsStr> = Vec::new();
    loop {
        match existing.parent() {
            Some(parent) => {
                if let Some(name) = existing.file_name() {
                    tail.push(name);
                }
                existing = parent;
                if let Ok(base) = existing.canonicalize() {
                    let mut result = base;
                    for comp in tail.iter().rev() {
                        if *comp == std::ffi::OsStr::new(".") {
                            continue;
                        }
                        if *comp == std::ffi::OsStr::new("..") {
                            result.pop();
                        } else {
                            result.push(comp);
                        }
                    }
                    return Ok(result);
                }
            }
            None => {
                return Err(format!("no existing ancestor for {:?}", path));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn unique_root() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir =
            std::env::temp_dir().join(format!("jan_sandbox_test_{}_{}", std::process::id(), n));
        std::fs::create_dir_all(&dir).expect("create test root");
        dir
    }

    #[test]
    fn in_project_file_does_not_escape() {
        let root = unique_root();
        std::fs::write(root.join("inner.txt"), b"x").unwrap();
        assert_eq!(escapes_project(&root, "inner.txt"), Ok(false));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn nested_in_project_does_not_escape() {
        let root = unique_root();
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("sub/inner.txt"), b"x").unwrap();
        assert_eq!(escapes_project(&root, "sub/inner.txt"), Ok(false));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn dotdot_escapes() {
        let root = unique_root();
        assert_eq!(escapes_project(&root, "../outside.txt"), Ok(true));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn absolute_outside_escapes() {
        let root = unique_root();
        let outside = std::env::temp_dir().join("definitely_outside_the_root.txt");
        assert_eq!(escapes_project(&root, outside.to_str().unwrap()), Ok(true));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn absolute_inside_does_not_escape() {
        let root = unique_root();
        std::fs::write(root.join("inner.txt"), b"x").unwrap();
        let inside = root.join("inner.txt");
        assert_eq!(escapes_project(&root, inside.to_str().unwrap()), Ok(false));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn new_file_in_project_dir_does_not_escape() {
        let root = unique_root();
        std::fs::create_dir_all(root.join("sub")).unwrap();
        assert_eq!(escapes_project(&root, "sub/newfile.txt"), Ok(false));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_caught() {
        let root = unique_root();
        let outside = unique_root();
        std::fs::write(outside.join("secret.txt"), b"x").unwrap();
        let link = root.join("link");
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        assert_eq!(escapes_project(&root, "link/secret.txt"), Ok(true));
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }
}
