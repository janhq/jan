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

/// True iff `raw` resolves inside `<project_root>/.jan/agent/`. The `skills/`
/// and `memory/` workspaces are reachable only through the dedicated
/// skill_*/memory_* tools, never general read/write/edit/ls/find/grep/bash;
/// agent.toml and any other config are fully off-limits. The project
/// instructions file is `<project_root>/JAN.md`, an ordinary project file, so
/// the whole agent dir is opaque to the general filesystem tools.
pub fn is_restricted_agent_path(project_root: &Path, raw: &str) -> bool {
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
    resolved.starts_with(root.join(".jan").join("agent"))
}

/// True iff a shell command references a restricted agent path (best-effort token
/// scan). Splits on whitespace and shell metacharacters and checks each token so
/// `cat .jan/agent/agent.toml` and its quoted/redirected variants are caught.
pub fn command_touches_restricted_agent_path(project_root: &Path, command: &str) -> bool {
    command
        .split(|c: char| c.is_whitespace() || ";|&><()\"'`".contains(c))
        .filter(|t| !t.is_empty())
        .any(|t| is_restricted_agent_path(project_root, t))
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
    fn restricted_agent_path_covers_the_whole_agent_dir() {
        let root = unique_root();
        std::fs::create_dir_all(root.join(".jan/agent/skills")).unwrap();
        std::fs::create_dir_all(root.join(".jan/agent/memory")).unwrap();
        std::fs::write(root.join(".jan/agent/agent.toml"), b"x").unwrap();
        // Restricted: agent.toml, the agent dir listing, unknown config files.
        assert!(is_restricted_agent_path(&root, ".jan/agent/agent.toml"));
        assert!(is_restricted_agent_path(&root, "./.jan/agent/agent.toml"));
        assert!(is_restricted_agent_path(
            &root,
            root.join(".jan/agent/agent.toml").to_str().unwrap()
        ));
        assert!(is_restricted_agent_path(&root, ".jan/agent"));
        assert!(is_restricted_agent_path(&root, ".jan/agent/secrets.env"));
        // skills/ and memory/ are reachable only via the dedicated tools, so they
        // are restricted from the general filesystem tools too.
        assert!(is_restricted_agent_path(&root, ".jan/agent/skills/deploy.md"));
        assert!(is_restricted_agent_path(&root, ".jan/agent/memory/notes.md"));
        // Nothing under .jan/agent/ is reachable; the instructions file now
        // lives at the project root as JAN.md, an ordinary project file.
        assert!(is_restricted_agent_path(&root, ".jan/agent/AGENT.md"));
        assert!(!is_restricted_agent_path(&root, "JAN.md"));
        assert!(!is_restricted_agent_path(&root, "src/main.rs"));
        // The `.jan` dir itself is not restricted: threads and other project
        // state outside `agent/` were never part of this carve-out.
        assert!(!is_restricted_agent_path(&root, ".jan"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn command_scan_flags_restricted_agent_paths() {
        let root = unique_root();
        std::fs::create_dir_all(root.join(".jan/agent")).unwrap();
        std::fs::write(root.join(".jan/agent/agent.toml"), b"x").unwrap();
        assert!(command_touches_restricted_agent_path(
            &root,
            "cat .jan/agent/agent.toml"
        ));
        assert!(command_touches_restricted_agent_path(
            &root,
            "grep foo < .jan/agent/agent.toml"
        ));
        assert!(command_touches_restricted_agent_path(
            &root,
            "cat .jan/agent/AGENT.md"
        ));
        assert!(!command_touches_restricted_agent_path(&root, "cat JAN.md"));
        assert!(!command_touches_restricted_agent_path(&root, "ls -la src"));
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
