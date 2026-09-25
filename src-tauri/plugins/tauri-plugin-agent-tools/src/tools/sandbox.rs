use std::path::{Path, PathBuf};

/// True iff `raw` resolves to a path outside `project_root` and outside the
/// session scratch. Relative paths are resolved against `project_root`.
/// Canonicalizes (resolving `..` and symlinks) so string tricks and symlink
/// escapes are caught. For a not-yet-existing leaf (new-file writes), the
/// deepest existing ancestor is canonicalized and the remaining tail re-joined.
pub fn escapes_project(
    project_root: &Path,
    scratch: Option<&Path>,
    raw: &str,
) -> Result<bool, String> {
    // Absolute `/tmp` paths map into the session scratch (see [`resolve_path`]),
    // which is the agent's own area -- but only once the mapped path is checked
    // against it. Clamping `..` happens lexically, so a symlink planted in the
    // scratch (the shell can make one: `/tmp` is the scratch bind) would
    // otherwise resolve straight back out to the host. Canonicalize what the
    // clamp produced and require it to still be inside.
    if cfg!(target_os = "linux") {
        if let Some(scratch) = scratch {
            if tmp_relative(raw).is_some() {
                let scratch_root = scratch
                    .canonicalize()
                    .map_err(|e| format!("scratch root {:?}: {e}", scratch))?;
                let resolved =
                    canonicalize_lenient(&resolve_path(project_root, Some(scratch), raw))?;
                return Ok(!resolved.starts_with(&scratch_root));
            }
        }
    }
    let root = project_root
        .canonicalize()
        .map_err(|e| format!("project root {:?}: {e}", project_root))?;
    let abs = if Path::new(raw).is_absolute() {
        PathBuf::from(raw)
    } else {
        root.join(raw)
    };
    let resolved = canonicalize_lenient(&abs)?;
    if resolved.starts_with(&root) {
        return Ok(false);
    }
    // The scratch is the agent's own per-session area and is writable under
    // every backend, so a path landing in it is not a host escape even though it
    // sits outside the project. On Linux it is normally reached through the
    // `/tmp` branch above; macOS and Windows have no bind mount, so the shell
    // and the filesystem tools both address it by this real path. A scratch that
    // cannot be canonicalized grants nothing: the path stays an escape.
    if let Some(scratch) = scratch {
        if let Ok(scratch) = scratch.canonicalize() {
            return Ok(!resolved.starts_with(&scratch));
        }
    }
    Ok(true)
}

/// True iff `raw` escapes every root a *read* may legitimately reach: the
/// project, the scratch, or any attached read-only root.
///
/// Layered on [`escapes_project`] rather than replacing it, so the write path
/// keeps the exact check it has today and a read root can only ever widen what
/// reads reach, never what writes do.
///
/// A read root that cannot be canonicalized grants nothing — same rule as the
/// scratch above. A vanished root must not silently open a path up.
pub fn escapes_read_roots(
    project_root: &Path,
    scratch: Option<&Path>,
    read_roots: &[PathBuf],
    raw: &str,
) -> Result<bool, String> {
    if !escapes_project(project_root, scratch, raw)? {
        return Ok(false);
    }
    if read_roots.is_empty() {
        return Ok(true);
    }
    let abs = if Path::new(raw).is_absolute() {
        PathBuf::from(raw)
    } else {
        // Relative paths belong to the workspace, never to an attached folder:
        // resolving them against a read root would make `write` and `read`
        // disagree about what one path means.
        project_root.join(raw)
    };
    let resolved = canonicalize_lenient(&abs)?;
    for root in read_roots {
        if let Ok(root) = root.canonicalize() {
            if resolved.starts_with(&root) {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

/// True iff `raw` escapes every root a *write* may legitimately reach: the
/// project, the scratch, or any attached root the caller marked writable.
///
/// The mirror image of [`escapes_read_roots`], layered on [`escapes_project`]
/// for the same reason: a writable root can only ever widen what writes reach,
/// and a caller that passes none keeps today's exact check. A root that cannot
/// be canonicalized grants nothing.
pub fn escapes_write_roots(
    project_root: &Path,
    scratch: Option<&Path>,
    write_roots: &[PathBuf],
    raw: &str,
) -> Result<bool, String> {
    if !escapes_project(project_root, scratch, raw)? {
        return Ok(false);
    }
    if write_roots.is_empty() {
        return Ok(true);
    }
    let abs = if Path::new(raw).is_absolute() {
        PathBuf::from(raw)
    } else {
        // Relative paths belong to the workspace, never to an attached folder
        // -- the same rule reads follow, so one path means one place to both.
        project_root.join(raw)
    };
    let resolved = canonicalize_lenient(&abs)?;
    for root in write_roots {
        if let Ok(root) = root.canonicalize() {
            if resolved.starts_with(&root) {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

/// Resolve a tool-supplied path to its on-disk location, forwarding an absolute
/// `/tmp/...` path into the session scratch when one is set (and only on Linux,
/// where the bash sandbox binds the scratch over `/tmp`). This keeps every
/// filesystem tool reading and writing the same `/tmp` the shell sees. With no
/// scratch, `/tmp` stays a plain host path.
///
/// The scratch is treated like a chroot: no `..` component may climb above the
/// scratch root, matching how the sandbox's `/tmp` mount behaves (it is a mount
/// point, so `..` above it stays inside `/tmp`).
pub fn resolve_path(project_root: &Path, scratch: Option<&Path>, raw: &str) -> PathBuf {
    if cfg!(target_os = "linux") {
        if let Some(rel) = tmp_relative(raw) {
            if let Some(scratch) = scratch {
                return clamp_scratch(scratch, &rel);
            }
        }
    }
    if Path::new(raw).is_absolute() {
        PathBuf::from(raw)
    } else {
        project_root.join(raw)
    }
}

/// The spelling to hand a tool-facing path back to the model: the inverse of
/// [`resolve_path`]. On Linux a file inside the scratch is named `/tmp/...`, the
/// one name that works from both the filesystem tools (which remap it back) and
/// `bash` (where the scratch is mounted at `/tmp`); its host path would resolve
/// for the former and not exist for the latter. Where nothing is mounted over
/// `/tmp` (macOS, Windows) both surfaces use the real path, so that is the name.
/// Anything outside the scratch is shown as-is.
pub fn scratch_display_path(scratch: Option<&Path>, path: &Path) -> String {
    let target = lexical_normalize(path);
    if cfg!(target_os = "linux") {
        if let Some(rel) = scratch_tail(scratch, &target) {
            let rel = rel.to_string_lossy().replace('\\', "/");
            return if rel.is_empty() {
                "/tmp".to_string()
            } else {
                format!("/tmp/{rel}")
            };
        }
    }
    target.to_string_lossy().into_owned()
}

/// True iff `path` lexically sits inside the session scratch. Lexical on
/// purpose: it names a path the tools are about to create as well as one that
/// already exists.
pub fn in_scratch(scratch: Option<&Path>, path: &Path) -> bool {
    scratch_tail(scratch, &lexical_normalize(path)).is_some()
}

/// The scratch-relative tail of an already-normalized `path`, or `None` when it
/// is not in the scratch. `Some("")` for the scratch root itself.
fn scratch_tail(scratch: Option<&Path>, path: &Path) -> Option<PathBuf> {
    let scratch = lexical_normalize(scratch?);
    path.strip_prefix(&scratch).ok().map(Path::to_path_buf)
}

/// Resolve `.`/`..` without touching the filesystem, so a path is comparable to
/// the project root even when the target does not exist yet. Purely lexical:
/// `canonicalize` would also follow symlinks and fail on missing files.
pub fn lexical_normalize(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Join `rel` under `scratch`, clamping `..` so it can never climb above the
/// scratch root (chroot semantics). A leading `..` or `/tmp/..` therefore falls
/// back to the scratch root rather than escaping to the host temp.
fn clamp_scratch(scratch: &Path, rel: &str) -> PathBuf {
    let mut out = scratch.to_path_buf();
    for c in Path::new(rel).components() {
        match c {
            std::path::Component::ParentDir => {
                // Clamp: never pop past the scratch root.
                if out != scratch {
                    out.pop();
                }
            }
            std::path::Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// The `/tmp`-relative tail of an absolute `/tmp/...` path; `Some("")` for the
/// bare `/tmp` dir itself; `None` when `raw` is not such a path.
fn tmp_relative(raw: &str) -> Option<String> {
    let path = Path::new(raw);
    if !path.is_absolute() {
        return None;
    }
    // Match only the exact `/tmp` dir or a genuine `/tmp/...` descendant: a
    // raw string prefix would treat `/tmpx` and `/tmp-archive` as inside /tmp.
    if raw == "/tmp" {
        return Some(String::new());
    }
    Some(raw.strip_prefix("/tmp/")?.to_string())
}

/// True iff `raw` resolves inside `hidden` (the Jan home, `~/.jan`), which holds
/// `config.toml` with provider keys and hooks plus every project's store. The
/// memory/skill tools reach the store by name and never come through here.
///
/// One exception: a project that itself lives under `hidden` (a Jan worktree in
/// `~/.jan/worktrees/`) is the agent's working tree, so paths inside it stay
/// reachable. The home itself as the project grants nothing.
pub fn in_hidden_root(project_root: &Path, scratch: Option<&Path>, hidden: &Path, raw: &str) -> bool {
    let Ok(hidden) = canonicalize_lenient(hidden) else {
        return false;
    };
    let Ok(resolved) = canonicalize_lenient(&resolve_path(project_root, scratch, raw)) else {
        return false;
    };
    if !resolved.starts_with(&hidden) {
        return false;
    }
    match project_root.canonicalize() {
        Ok(root) if root != hidden && root.starts_with(&hidden) => !resolved.starts_with(&root),
        _ => true,
    }
}

/// True iff a shell command names a path inside `hidden` (best-effort token
/// scan). `~` and `$HOME` are expanded, since `cat ~/.jan/config.toml` is the
/// obvious spelling. Best-effort is enough only because the OS sandbox masks
/// the directory too (see [`super::jail::Policy::hide_root`]); this turns a
/// plain attempt into a clear refusal instead of an empty directory.
pub fn command_touches_hidden_root(
    project_root: &Path,
    scratch: Option<&Path>,
    hidden: &Path,
    command: &str,
) -> bool {
    let home = hidden.parent().map(|h| h.to_string_lossy().into_owned());
    command
        .split(|c: char| c.is_whitespace() || ";|&><()\"'`=".contains(c))
        .filter(|t| !t.is_empty())
        .any(|t| {
            let expanded = match &home {
                Some(home) => expand_home(t, home),
                None => t.to_string(),
            };
            in_hidden_root(project_root, scratch, hidden, &expanded)
        })
}

fn expand_home(token: &str, home: &str) -> String {
    for prefix in ["${HOME}", "$HOME", "~"] {
        if let Some(rest) = token.strip_prefix(prefix) {
            if rest.is_empty() || rest.starts_with('/') {
                return format!("{home}{rest}");
            }
        }
    }
    token.to_string()
}

/// `hidden` spelled under `base`, the way a directory walk rooted at `base`
/// names its entries, or `None` when the walk cannot reach it. Lets `ls`,
/// `find` and `grep` skip the Jan home with a prefix test per entry instead of
/// canonicalizing every file they visit.
pub fn hidden_under(base: &Path, hidden: &Path) -> Option<PathBuf> {
    let base_canon = base.canonicalize().ok()?;
    let hidden_canon = canonicalize_lenient(hidden).ok()?;
    let rest = hidden_canon.strip_prefix(&base_canon).ok()?;
    Some(base.join(rest))
}

/// True when `target` *claims* to be inside a trusted root but resolves outside
/// every one of them: the fail-closed re-check a handler runs immediately
/// before its final open, closing the window between the gate's
/// decision-time canonicalization and the handler's use of the raw path.
///
/// Containment, not symlink-avoidance: a link that stays beneath a trusted root
/// is ordinary and must keep working (a yarn workspace's
/// `node_modules/<pkg> -> ../../pkg` is one, and refusing those would make the
/// tools useless in a monorepo). Only a link whose target leaves the roots is an
/// escape.
///
/// A target that is not even lexically under a root is left alone: it is an
/// escape the gate already put to the user, and re-deciding it here would
/// override their approval. An unresolvable path fails closed.
///
/// Still a re-check, not a guarantee: a swap landing between this call and the
/// open is not covered. That needs descriptor-relative no-follow opens
/// (`openat2` with `RESOLVE_BENEATH`, reparse-point handling on Windows).
pub fn symlink_escapes_root(project_root: &Path, scratch: Option<&Path>, target: &Path) -> bool {
    symlink_escapes_any_root(project_root, scratch, &[], target)
}

/// As [`symlink_escapes_root`], but also treating `read_roots` as trusted.
///
/// Passing the read roots is not optional once one is attached: a path inside
/// an attached folder is not lexically under the project or the scratch, so the
/// early return above would classify it as "already decided" and skip the check
/// entirely — leaving a link in the user's repo pointing at `~/.ssh` followed.
pub fn symlink_escapes_any_root(
    project_root: &Path,
    scratch: Option<&Path>,
    read_roots: &[PathBuf],
    target: &Path,
) -> bool {
    let mut roots = vec![project_root];
    if let Some(s) = scratch {
        roots.push(s);
    }
    for r in read_roots {
        roots.push(r.as_path());
    }
    let normalized = lexical_normalize(target);
    if !roots
        .iter()
        .any(|r| normalized.starts_with(lexical_normalize(r)))
    {
        return false;
    }
    let Ok(resolved) = canonicalize_lenient(&normalized) else {
        return true;
    };
    !roots
        .iter()
        .filter_map(|r| r.canonicalize().ok())
        .any(|r| resolved.starts_with(r))
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

    /// A test dir that is *not* under the host temp dir, so a Linux run does not
    /// silently route through the `/tmp` bind branch. Lives under the crate's
    /// `target/`, which is already build output.
    fn unique_root_outside_tmp() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("sandbox-tests")
            .join(format!("{}_{}", std::process::id(), n));
        std::fs::create_dir_all(&dir).expect("create test scratch");
        dir
    }

    #[test]
    fn in_project_file_does_not_escape() {
        let root = unique_root();
        std::fs::write(root.join("inner.txt"), b"x").unwrap();
        assert_eq!(escapes_project(&root, None, "inner.txt"), Ok(false));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn nested_in_project_does_not_escape() {
        let root = unique_root();
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("sub/inner.txt"), b"x").unwrap();
        assert_eq!(escapes_project(&root, None, "sub/inner.txt"), Ok(false));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn dotdot_escapes() {
        let root = unique_root();
        assert_eq!(escapes_project(&root, None, "../outside.txt"), Ok(true));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn absolute_outside_escapes() {
        let root = unique_root();
        let outside = std::env::temp_dir().join("definitely_outside_the_root.txt");
        assert_eq!(
            escapes_project(&root, None, outside.to_str().unwrap()),
            Ok(true)
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn absolute_inside_does_not_escape() {
        let root = unique_root();
        std::fs::write(root.join("inner.txt"), b"x").unwrap();
        let inside = root.join("inner.txt");
        assert_eq!(
            escapes_project(&root, None, inside.to_str().unwrap()),
            Ok(false)
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn new_file_in_project_dir_does_not_escape() {
        let root = unique_root();
        std::fs::create_dir_all(root.join("sub")).unwrap();
        assert_eq!(escapes_project(&root, None, "sub/newfile.txt"), Ok(false));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A symlink planted in the scratch (the shell can create one: `/tmp` is
    /// the scratch bind) must not turn `/tmp/...` into a way out. Clamping `..`
    /// is not enough -- the link is a single component that resolves elsewhere.
    #[test]
    #[cfg(target_os = "linux")]
    fn tmp_symlink_cannot_escape_the_scratch() {
        let root = unique_root();
        let scratch = unique_root();
        let outside = unique_root();
        std::os::unix::fs::symlink(&outside, scratch.join("esc")).unwrap();
        assert_eq!(
            escapes_project(&root, Some(&scratch), "/tmp/esc/pwned.txt"),
            Ok(true),
            "a symlink out of the scratch is an escape"
        );
        // A genuine scratch path is still not an escape.
        assert_eq!(
            escapes_project(&root, Some(&scratch), "/tmp/ok.txt"),
            Ok(false)
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&scratch);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// A scratch reached by its real path (no `/tmp` bind in front of it) is the
    /// agent's own area on every platform, so it must not read as an escape.
    /// The scratch here sits outside the host temp dir on purpose: on Linux a
    /// `/tmp`-prefixed path would be answered by the bind branch above instead,
    /// leaving the cross-platform branch untested on the one OS we can run.
    #[test]
    fn real_scratch_path_is_not_an_escape() {
        let root = unique_root();
        let scratch = unique_root_outside_tmp();
        let inside = scratch.join("notes.txt");
        assert_eq!(
            escapes_project(&root, Some(&scratch), inside.to_str().unwrap()),
            Ok(false),
            "a write into the session scratch is not a host escape"
        );
        assert_eq!(
            escapes_project(&root, Some(&scratch), scratch.to_str().unwrap()),
            Ok(false),
            "the scratch root itself is addressable"
        );
        // The allowance is the scratch, not its parent.
        let sibling = scratch.parent().unwrap().join("not_the_scratch.txt");
        assert_eq!(
            escapes_project(&root, Some(&scratch), sibling.to_str().unwrap()),
            Ok(true)
        );
        // And nothing changes for a caller with no scratch at all.
        assert_eq!(
            escapes_project(&root, None, inside.to_str().unwrap()),
            Ok(true)
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&scratch);
    }

    /// The real-path branch resolves symlinks for the same reason the `/tmp`
    /// branch does: the shell can plant one inside the scratch.
    #[cfg(unix)]
    #[test]
    fn real_scratch_path_symlink_cannot_escape() {
        let root = unique_root();
        let scratch = unique_root_outside_tmp();
        let outside = unique_root();
        std::os::unix::fs::symlink(&outside, scratch.join("esc")).unwrap();
        let via_link = scratch.join("esc").join("pwned.txt");
        assert_eq!(
            escapes_project(&root, Some(&scratch), via_link.to_str().unwrap()),
            Ok(true),
            "a symlink out of the scratch is an escape"
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&scratch);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// The name handed back to the model: the `/tmp` alias only where something
    /// is actually mounted there, the real path everywhere else.
    #[test]
    fn scratch_is_displayed_under_the_name_the_shell_can_use() {
        let scratch = PathBuf::from(if cfg!(windows) {
            r"C:\Temp\jan-agent-s1"
        } else {
            "/var/scratch/jan-agent-s1"
        });
        let file = scratch.join("out.txt");
        assert!(in_scratch(Some(&scratch), &file));
        assert!(!in_scratch(Some(&scratch), Path::new("/elsewhere/out.txt")));
        assert!(!in_scratch(None, &file));
        if cfg!(target_os = "linux") {
            assert_eq!(scratch_display_path(Some(&scratch), &file), "/tmp/out.txt");
            assert_eq!(scratch_display_path(Some(&scratch), &scratch), "/tmp");
        } else {
            assert_eq!(
                scratch_display_path(Some(&scratch), &file),
                file.to_string_lossy()
            );
        }
        // Outside the scratch the path is untouched either way.
        let other = PathBuf::from("/elsewhere/out.txt");
        assert_eq!(
            scratch_display_path(Some(&scratch), &other),
            other.to_string_lossy()
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_caught() {
        let root = unique_root();
        let outside = unique_root();
        std::fs::write(outside.join("secret.txt"), b"x").unwrap();
        let link = root.join("link");
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        assert_eq!(escapes_project(&root, None, "link/secret.txt"), Ok(true));
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// The re-check flags only symlinks that *leave* the trusted roots. An
    /// in-root link (the shape every yarn workspace has) resolves back inside
    /// and must stay usable; a link out of the root is an escape; a path that
    /// was never under a root at all is the gate's business, not this check's.
    #[cfg(unix)]
    #[test]
    fn symlink_escape_recheck_allows_in_root_links() {
        let root = unique_root();
        let outside = unique_root();
        std::fs::create_dir_all(root.join("pkg")).unwrap();
        std::fs::write(root.join("pkg/index.js"), b"x").unwrap();
        std::fs::write(outside.join("secret.txt"), b"s").unwrap();

        let inward = root.join("linked");
        std::os::unix::fs::symlink(root.join("pkg"), &inward).unwrap();
        let outward = root.join("escape");
        std::os::unix::fs::symlink(&outside, &outward).unwrap();

        assert!(!symlink_escapes_root(&root, None, &inward.join("index.js")));
        assert!(symlink_escapes_root(
            &root,
            None,
            &outward.join("secret.txt")
        ));
        // A not-yet-existing leaf under a real directory is not an escape.
        assert!(!symlink_escapes_root(
            &root,
            None,
            &root.join("pkg/new.txt")
        ));
        // Outside both roots: the gate already decided, so this check abstains.
        assert!(!symlink_escapes_root(
            &root,
            None,
            &outside.join("secret.txt")
        ));
        // The scratch counts as a trusted root, so a link between the two is in.
        let scratch = unique_root();
        let cross = scratch.join("into-project");
        std::os::unix::fs::symlink(root.join("pkg"), &cross).unwrap();
        assert!(!symlink_escapes_root(
            &root,
            Some(&scratch),
            &cross.join("index.js")
        ));

        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
        let _ = std::fs::remove_dir_all(&scratch);
    }

    /// `/tmpx` and `/tmp-archive` are not descendants of `/tmp` and must not be
    /// silently redirected into the scratch.
    #[test]
    fn tmp_lookalikes_are_not_remapped() {
        assert_eq!(tmp_relative("/tmp"), Some(String::new()));
        assert_eq!(tmp_relative("/tmp/"), Some(String::new()));
        assert_eq!(tmp_relative("/tmp/a.txt"), Some("a.txt".to_string()));
        assert_eq!(tmp_relative("/tmpx"), None);
        assert_eq!(tmp_relative("/tmp-archive/a.txt"), None);
    }
    // ---- read-only attached roots -------------------------------------------

    #[test]
    fn a_path_in_a_read_root_is_not_a_read_escape() {
        let ws = unique_root_outside_tmp();
        let repo = unique_root_outside_tmp();
        std::fs::write(repo.join("main.rs"), b"fn main() {}").unwrap();
        let roots = vec![repo.clone()];
        let target = repo.join("main.rs").to_string_lossy().into_owned();

        // Without the root it is an escape; with it, a legitimate read.
        assert!(escapes_project(&ws, None, &target).unwrap());
        assert!(!escapes_read_roots(&ws, None, &roots, &target).unwrap());

        let _ = std::fs::remove_dir_all(&ws);
        let _ = std::fs::remove_dir_all(&repo);
    }

    // The whole point of the mount: reads widen, writes do not. `escapes_project`
    // is what the write path keeps using, so it must still call this an escape.
    #[test]
    fn a_write_into_a_read_root_is_still_an_escape() {
        let ws = unique_root_outside_tmp();
        let repo = unique_root_outside_tmp();
        let target = repo.join("new.txt").to_string_lossy().into_owned();
        assert!(escapes_project(&ws, None, &target).unwrap());
        let _ = std::fs::remove_dir_all(&ws);
        let _ = std::fs::remove_dir_all(&repo);
    }

    #[test]
    fn a_path_outside_every_root_is_still_an_escape() {
        let ws = unique_root_outside_tmp();
        let repo = unique_root_outside_tmp();
        let other = unique_root_outside_tmp();
        let roots = vec![repo.clone()];
        let target = other.join("secret").to_string_lossy().into_owned();
        assert!(escapes_read_roots(&ws, None, &roots, &target).unwrap());
        for d in [&ws, &repo, &other] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    // A read root that vanished must grant nothing, matching the scratch rule.
    #[test]
    fn a_missing_read_root_grants_nothing() {
        let ws = unique_root_outside_tmp();
        let gone = unique_root_outside_tmp();
        let target = gone.join("x").to_string_lossy().into_owned();
        std::fs::remove_dir_all(&gone).unwrap();
        let roots = vec![gone];
        assert!(escapes_read_roots(&ws, None, &roots, &target).unwrap());
        let _ = std::fs::remove_dir_all(&ws);
    }

    // Relative paths belong to the workspace. Resolving them against an attached
    // folder would make `read` and `write` disagree about what one path means.
    #[test]
    fn a_relative_path_still_resolves_against_the_workspace() {
        let ws = unique_root_outside_tmp();
        let repo = unique_root_outside_tmp();
        std::fs::write(repo.join("only-in-repo.txt"), b"x").unwrap();
        let roots = vec![repo.clone()];
        assert!(escapes_read_roots(&ws, None, &roots, "only-in-repo.txt").is_ok());
        let _ = std::fs::remove_dir_all(&ws);
        let _ = std::fs::remove_dir_all(&repo);
    }

    // The hole this mount opens if the read roots are not passed: a link inside
    // the attached folder is not lexically under the workspace, so the plain
    // check returns "already decided" and never looks at where it points.
    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_a_read_root_is_caught() {
        let ws = unique_root_outside_tmp();
        let repo = unique_root_outside_tmp();
        let secret_dir = unique_root_outside_tmp();
        let secret = secret_dir.join("id_rsa");
        std::fs::write(&secret, b"key").unwrap();
        let link = repo.join("innocent.txt");
        std::os::unix::fs::symlink(&secret, &link).unwrap();
        let roots = vec![repo.clone()];

        assert!(
            symlink_escapes_any_root(&ws, None, &roots, &link),
            "a link leaving the attached folder must be refused"
        );
        assert!(
            !symlink_escapes_root(&ws, None, &link),
            "and the plain check is exactly why the roots must be passed"
        );
        for d in [&ws, &repo, &secret_dir] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    // A link that stays inside the attached folder is ordinary and must work --
    // every monorepo has them.
    #[cfg(unix)]
    #[test]
    fn a_symlink_inside_a_read_root_is_allowed() {
        let repo = unique_root_outside_tmp();
        let ws = unique_root_outside_tmp();
        let real = repo.join("real.txt");
        std::fs::write(&real, b"x").unwrap();
        let link = repo.join("link.txt");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let roots = vec![repo.clone()];
        assert!(!symlink_escapes_any_root(&ws, None, &roots, &link));
        let _ = std::fs::remove_dir_all(&repo);
        let _ = std::fs::remove_dir_all(&ws);
    }

    /// The home-as-project case from the #9065 review: the Jan home sits inside
    /// the project, and everything under it is hidden, not just config.toml.
    #[test]
    fn the_jan_home_is_hidden_when_the_project_contains_it() {
        let home = unique_root();
        let jan = home.join(".jan");
        std::fs::create_dir_all(jan.join("projects/p-1/memory")).unwrap();
        std::fs::write(jan.join("config.toml"), b"k").unwrap();
        assert!(in_hidden_root(&home, None, &jan, ".jan/config.toml"));
        assert!(in_hidden_root(&home, None, &jan, "./.jan/../.jan/config.toml"));
        assert!(in_hidden_root(&home, None, &jan, jan.join("config.toml").to_str().unwrap()));
        assert!(in_hidden_root(&home, None, &jan, ".jan"));
        assert!(in_hidden_root(&home, None, &jan, ".jan/projects/p-1/agent.toml"));
        // Not yet existing files are hidden too, so a write cannot create one.
        assert!(in_hidden_root(&home, None, &jan, ".jan/hooks.toml"));
        assert!(!in_hidden_root(&home, None, &jan, "JAN.md"));
        assert!(!in_hidden_root(&home, None, &jan, ".janitor"));
        let _ = std::fs::remove_dir_all(&home);
    }

    /// A Jan worktree is the agent's own working tree even though it lives
    /// under `~/.jan`; the rest of the home stays hidden from it.
    #[test]
    fn a_worktree_inside_the_jan_home_keeps_its_own_tree() {
        let home = unique_root();
        let jan = home.join(".jan");
        let wt = jan.join("worktrees/repo-1/feature");
        std::fs::create_dir_all(&wt).unwrap();
        std::fs::write(jan.join("config.toml"), b"k").unwrap();
        assert!(!in_hidden_root(&wt, None, &jan, "src/main.rs"));
        assert!(!in_hidden_root(&wt, None, &jan, wt.to_str().unwrap()));
        assert!(in_hidden_root(&wt, None, &jan, "../../../config.toml"));
        assert!(in_hidden_root(&wt, None, &jan, jan.join("config.toml").to_str().unwrap()));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn command_scan_expands_home_spellings() {
        let home = unique_root();
        let jan = home.join(".jan");
        std::fs::create_dir_all(&jan).unwrap();
        std::fs::write(jan.join("config.toml"), b"k").unwrap();
        let project = home.join("proj");
        std::fs::create_dir_all(&project).unwrap();
        for cmd in [
            "cat ~/.jan/config.toml",
            "cat $HOME/.jan/config.toml",
            "grep key < ${HOME}/.jan/config.toml",
            "cat ../.jan/config.toml",
            "F=~/.jan/config.toml",
        ] {
            assert!(command_touches_hidden_root(&project, None, &jan, cmd), "{cmd}");
        }
        let abs = format!("cat '{}'", jan.join("config.toml").display());
        assert!(command_touches_hidden_root(&project, None, &jan, &abs));
        assert!(!command_touches_hidden_root(&project, None, &jan, "cat ~/.bashrc"));
        assert!(!command_touches_hidden_root(&project, None, &jan, "ls -la src"));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn hidden_under_spells_the_home_the_way_a_walk_does() {
        let home = unique_root();
        let jan = home.join(".jan");
        std::fs::create_dir_all(&jan).unwrap();
        assert_eq!(hidden_under(&home, &jan), Some(home.join(".jan")));
        let dot = home.join(".");
        assert_eq!(hidden_under(&dot, &jan), Some(dot.join(".jan")));
        let other = home.join("proj");
        std::fs::create_dir_all(&other).unwrap();
        assert_eq!(hidden_under(&other, &jan), None);
        let _ = std::fs::remove_dir_all(&home);
    }
}
