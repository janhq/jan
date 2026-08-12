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

/// The agent's own state directory inside a project. Hidden wholesale rather
/// than per-subdirectory: it holds `agent.toml`, the skills/memory workspaces
/// (reachable only through the dedicated skill_*/memory_* tools), and the thread
/// store with the conversation's own transcripts. None of it is project source,
/// so a listing that shows it is noise at best and a self-referential read at
/// worst -- and anything added under it later is hidden by construction.
pub const JAN_DIR: &str = ".jan";

/// True iff `raw` resolves inside `<project_root>/.jan`. Hidden paths are not
/// merely denied: `ls`/`find`/`grep` omit them from their output, so the agent
/// never sees the directory exists. The project instructions file is
/// `<project_root>/JAN.md`, an ordinary project file, and is unaffected.
pub fn is_hidden_jan_path(project_root: &Path, raw: &str) -> bool {
    let Ok(root) = project_root.canonicalize() else {
        return false;
    };
    let abs = if Path::new(raw).is_absolute() {
        PathBuf::from(raw)
    } else {
        root.join(raw)
    };
    let Ok(resolved) = canonicalize_lenient(&abs) else {
        return false;
    };
    resolved.starts_with(root.join(JAN_DIR))
}

/// True iff a shell command references a hidden path (best-effort token scan).
/// Splits on whitespace and shell metacharacters and checks each token so
/// `cat .jan/agent/agent.toml` and its quoted/redirected variants are caught.
/// Best-effort is enough only because the OS sandbox masks the directory too
/// (see [`super::jail::Policy::hide_root`]); this check exists to turn an
/// evasion-free attempt into a clear error instead of an empty directory.
pub fn command_touches_hidden_jan_path(project_root: &Path, command: &str) -> bool {
    command
        .split(|c: char| c.is_whitespace() || ";|&><()\"'`".contains(c))
        .filter(|t| !t.is_empty())
        .any(|t| is_hidden_jan_path(project_root, t))
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


    #[test]
    fn hidden_path_covers_the_whole_jan_dir() {
        let root = unique_root();
        std::fs::create_dir_all(root.join(".jan/agent/skills")).unwrap();
        std::fs::create_dir_all(root.join(".jan/agent/memory")).unwrap();
        std::fs::create_dir_all(root.join(".jan/agent/threads/t1")).unwrap();
        std::fs::write(root.join(".jan/agent/agent.toml"), b"x").unwrap();
        // Config, the agent dir listing, unknown config files.
        assert!(is_hidden_jan_path(&root, ".jan/agent/agent.toml"));
        assert!(is_hidden_jan_path(&root, "./.jan/agent/agent.toml"));
        assert!(is_hidden_jan_path(
            &root,
            root.join(".jan/agent/agent.toml").to_str().unwrap()
        ));
        assert!(is_hidden_jan_path(&root, ".jan/agent"));
        assert!(is_hidden_jan_path(&root, ".jan/agent/secrets.env"));
        // skills/ and memory/ are reachable only via the dedicated tools, so they
        // are hidden from the general filesystem tools too.
        assert!(is_hidden_jan_path(&root, ".jan/agent/skills/deploy.md"));
        assert!(is_hidden_jan_path(&root, ".jan/agent/memory/notes.md"));
        assert!(is_hidden_jan_path(&root, ".jan/agent/AGENT.md"));
        // The whole `.jan` dir is hidden, not just `agent/`: the thread store
        // holds the running conversation's own transcripts, and future state
        // added beside it is covered without another carve-out.
        assert!(is_hidden_jan_path(&root, ".jan"));
        assert!(is_hidden_jan_path(&root, ".jan/agent/threads/t1"));
        // Ordinary project files, including the instructions file, are untouched.
        assert!(!is_hidden_jan_path(&root, "JAN.md"));
        assert!(!is_hidden_jan_path(&root, "src/main.rs"));
        // A sibling whose name merely starts with `.jan` is not inside it.
        assert!(!is_hidden_jan_path(&root, ".janitor"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn command_scan_flags_hidden_paths() {
        let root = unique_root();
        std::fs::create_dir_all(root.join(".jan/agent")).unwrap();
        std::fs::write(root.join(".jan/agent/agent.toml"), b"x").unwrap();
        assert!(command_touches_hidden_jan_path(
            &root,
            "cat .jan/agent/agent.toml"
        ));
        assert!(command_touches_hidden_jan_path(
            &root,
            "grep foo < .jan/agent/agent.toml"
        ));
        assert!(command_touches_hidden_jan_path(
            &root,
            "cat .jan/agent/AGENT.md"
        ));
        assert!(command_touches_hidden_jan_path(&root, "ls -la .jan"));
        assert!(!command_touches_hidden_jan_path(&root, "cat JAN.md"));
        assert!(!command_touches_hidden_jan_path(&root, "ls -la src"));
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
