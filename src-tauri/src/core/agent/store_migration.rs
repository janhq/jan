//! One-time move of a project's agent state out of the project.
//!
//! Before issue #388 the agent kept everything at `<project>/.jan/agent`
//! (`agent.toml`, memory, skills, subagents, plugins, threads). It now lives in
//! `~/.jan/projects/<slug>` (see `project::store_root`). This runs at launch
//! and does nothing unless the workspace still has a `.jan` directory, so a
//! migrated or fresh project pays one `stat`.
//!
//! Never merges: when both locations already hold state the legacy folder is
//! left alone and the caller reports it, because silently picking a winner
//! would throw away whichever side lost.

use std::path::{Path, PathBuf};

use tauri_plugin_agent_tools::workspace::{legacy_project_store, LEGACY_DIR};

/// What a launch-time migration did, for the surface to report.
#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    /// No `<project>/.jan` directory: nothing to do (the common case).
    Absent,
    /// The legacy store was moved to `to`. `leftover` lists entries in
    /// `<project>/.jan` other than `agent/`, which were not ours to move.
    Moved { to: PathBuf, leftover: Vec<String> },
    /// Both the legacy and the new store hold state; nothing was touched.
    Conflict { from: PathBuf, to: PathBuf },
    /// Git tracks files under the legacy store (a team sharing skills through
    /// the repo). Moving it would show up as deleted files and take the shared
    /// copy away from everyone else, so it is left for the user to decide.
    Tracked { from: PathBuf, to: PathBuf },
    /// `<project>/.jan` exists but is not a project store we recognise (for
    /// instance it is the user's global `~/.jan` because the workspace is the
    /// home directory). Left alone.
    Skipped,
}

impl Outcome {
    /// One line for the TUI or stderr, or `None` when there is nothing to say.
    pub fn message(&self) -> Option<String> {
        match self {
            Outcome::Absent | Outcome::Skipped => None,
            Outcome::Moved { to, leftover } if leftover.is_empty() => {
                Some(format!("moved project agent state to {}", to.display()))
            }
            Outcome::Moved { to, leftover } => Some(format!(
                "moved project agent state to {}; left {} in {LEGACY_DIR}/ untouched",
                to.display(),
                leftover.join(", ")
            )),
            Outcome::Conflict { from, to } => Some(format!(
                "found agent state in both {} and {}; using the latter. Merge or delete {} by hand",
                from.display(),
                to.display(),
                from.display()
            )),
            Outcome::Tracked { from, to } => Some(format!(
                "{} is tracked by git, so it was not moved; Jan now reads {}. Copy what you \
                 need there, then remove {} from the repo",
                from.display(),
                to.display(),
                from.display()
            )),
        }
    }
}

/// Move `<project>/.jan/agent` to `store` when the workspace still has one.
///
/// `jan_home` is the global `~/.jan`; a workspace whose `.jan` *is* that
/// directory (running in `$HOME`) is skipped rather than having the user's
/// config swallowed. Crash-safe: the tree is copied to a temp sibling of
/// `store` and renamed into place before the source is deleted, so an
/// interrupted run leaves the legacy copy intact and simply retries next time.
pub fn migrate_on_launch(project_root: &Path, store: &Path, jan_home: Option<&Path>) -> Outcome {
    let legacy_dir = project_root.join(LEGACY_DIR);
    if !legacy_dir.is_dir() {
        return Outcome::Absent;
    }
    if let Some(home) = jan_home {
        if same_path(&legacy_dir, home) {
            return Outcome::Skipped;
        }
    }
    let legacy = legacy_project_store(project_root);
    if !legacy.is_dir() {
        return Outcome::Skipped;
    }
    if crate::core::agent::git::tracks_any(&legacy) {
        return Outcome::Tracked {
            from: legacy,
            to: store.to_path_buf(),
        };
    }
    if has_entries(store) {
        return Outcome::Conflict {
            from: legacy,
            to: store.to_path_buf(),
        };
    }
    if let Err(e) = move_tree(&legacy, store) {
        log::warn!(
            "Agent: could not move {} to {}: {e}",
            legacy.display(),
            store.display()
        );
        return Outcome::Skipped;
    }
    let leftover = remaining_entries(&legacy_dir);
    if leftover.is_empty() {
        let _ = std::fs::remove_dir(&legacy_dir);
    }
    Outcome::Moved {
        to: store.to_path_buf(),
        leftover,
    }
}

fn same_path(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

fn has_entries(dir: &Path) -> bool {
    std::fs::read_dir(dir)
        .map(|mut rd| rd.next().is_some())
        .unwrap_or(false)
}

fn remaining_entries(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

/// Put `from` at `to` (which must not hold anything): a rename when both sit on
/// one filesystem, otherwise copy to a temp sibling, rename that into place,
/// then delete the source.
fn move_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    let parent = to
        .parent()
        .ok_or_else(|| std::io::Error::other("store has no parent directory"))?;
    std::fs::create_dir_all(parent)?;
    // An empty store directory (a scaffold from an earlier launch that found
    // nothing to migrate) would make the rename fail.
    let _ = std::fs::remove_dir(to);
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    let staging = parent.join(format!(
        ".migrating-{}-{}",
        std::process::id(),
        to.file_name().and_then(|n| n.to_str()).unwrap_or("store")
    ));
    let _ = std::fs::remove_dir_all(&staging);
    copy_tree(from, &staging)?;
    std::fs::rename(&staging, to)?;
    std::fs::remove_dir_all(from)
}

/// Recursive copy that recreates symlinks as symlinks instead of following them,
/// so a link inside the store cannot pull an arbitrary tree into `~/.jan`.
fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let src = entry.path();
        let dst = to.join(entry.file_name());
        let kind = entry.file_type()?;
        if kind.is_dir() {
            copy_tree(&src, &dst)?;
        } else if kind.is_symlink() {
            copy_link(&src, &dst)?;
        } else {
            std::fs::copy(&src, &dst)?;
        }
    }
    Ok(())
}

#[cfg(unix)]
fn copy_link(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(std::fs::read_link(src)?, dst)
}

// Creating a symlink on Windows needs a privilege most users lack, and a store
// has no reason to contain one; skip it rather than fail the whole move.
#[cfg(not(unix))]
fn copy_link(src: &Path, _dst: &Path) -> std::io::Result<()> {
    log::warn!("Agent: skipped symlink {} while migrating", src.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn legacy_project(dir: &Path) -> PathBuf {
        let project = dir.join("project");
        let agent = project.join(".jan").join("agent");
        std::fs::create_dir_all(agent.join("memory")).unwrap();
        std::fs::create_dir_all(agent.join("threads")).unwrap();
        std::fs::write(agent.join("agent.toml"), "[agent]\nmodel = \"m\"\n").unwrap();
        std::fs::write(agent.join("memory").join("note.md"), "remember").unwrap();
        std::fs::write(agent.join("threads").join("t1.json"), "{}").unwrap();
        project
    }

    #[test]
    fn a_workspace_without_jan_is_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("home/projects/p-1");
        let out = migrate_on_launch(dir.path(), &store, None);
        assert_eq!(out, Outcome::Absent);
        assert!(!store.exists(), "no migration must not create the store");
        assert!(out.message().is_none());
    }

    #[test]
    fn legacy_state_moves_and_the_jan_dir_goes_away() {
        let dir = tempfile::tempdir().unwrap();
        let project = legacy_project(dir.path());
        let store = dir.path().join("home/projects/p-1");

        let out = migrate_on_launch(&project, &store, None);
        assert_eq!(
            out,
            Outcome::Moved {
                to: store.clone(),
                leftover: vec![]
            }
        );
        assert_eq!(std::fs::read_to_string(store.join("memory/note.md")).unwrap(), "remember");
        assert!(store.join("threads/t1.json").is_file());
        assert!(store.join("agent.toml").is_file());
        assert!(!project.join(".jan").exists());
        assert!(out.message().unwrap().contains("moved project agent state"));

        // A second launch finds nothing to do.
        assert_eq!(migrate_on_launch(&project, &store, None), Outcome::Absent);
    }

    #[test]
    fn an_empty_scaffolded_store_does_not_count_as_a_conflict() {
        let dir = tempfile::tempdir().unwrap();
        let project = legacy_project(dir.path());
        let store = dir.path().join("home/projects/p-1");
        std::fs::create_dir_all(&store).unwrap();
        assert!(matches!(
            migrate_on_launch(&project, &store, None),
            Outcome::Moved { .. }
        ));
        assert!(store.join("agent.toml").is_file());
    }

    #[test]
    fn existing_state_on_both_sides_is_a_conflict_and_nothing_moves() {
        let dir = tempfile::tempdir().unwrap();
        let project = legacy_project(dir.path());
        let store = dir.path().join("home/projects/p-1");
        std::fs::create_dir_all(&store).unwrap();
        std::fs::write(store.join("agent.toml"), "new").unwrap();

        let out = migrate_on_launch(&project, &store, None);
        assert!(matches!(out, Outcome::Conflict { .. }));
        assert_eq!(std::fs::read_to_string(store.join("agent.toml")).unwrap(), "new");
        assert!(project.join(".jan/agent/agent.toml").is_file());
        assert!(out.message().unwrap().contains("both"));
    }

    #[test]
    fn unrelated_entries_in_jan_are_kept_and_reported() {
        let dir = tempfile::tempdir().unwrap();
        let project = legacy_project(dir.path());
        std::fs::write(project.join(".jan").join("other.txt"), "x").unwrap();
        let store = dir.path().join("home/projects/p-1");

        let out = migrate_on_launch(&project, &store, None);
        assert_eq!(
            out,
            Outcome::Moved {
                to: store.clone(),
                leftover: vec!["other.txt".to_string()]
            }
        );
        assert!(project.join(".jan/other.txt").is_file());
        assert!(!project.join(".jan/agent").exists());
    }

    /// Running in `$HOME` makes `<workspace>/.jan` the global Jan home, which
    /// holds `config.toml` and every other project's store.
    #[test]
    fn the_global_jan_home_is_never_migrated() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join(".jan");
        std::fs::create_dir_all(home.join("agent").join("subagents")).unwrap();
        let store = home.join("projects").join("u-1");

        let out = migrate_on_launch(dir.path(), &store, Some(&home));
        assert_eq!(out, Outcome::Skipped);
        assert!(home.join("agent/subagents").is_dir());
        assert!(!store.exists());
    }

    #[test]
    fn a_jan_dir_without_an_agent_store_is_skipped() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".jan")).unwrap();
        let store = dir.path().join("home/projects/p-1");
        assert_eq!(migrate_on_launch(dir.path(), &store, None), Outcome::Skipped);
        assert!(dir.path().join(".jan").is_dir());
    }

    /// A team that commits `.jan/agent/skills` shares them through the repo;
    /// moving them would delete tracked files for everyone.
    #[test]
    fn a_legacy_store_tracked_by_git_is_not_moved() {
        let dir = tempfile::tempdir().unwrap();
        let project = legacy_project(dir.path());
        let git = |args: &[&str]| {
            let ok = std::process::Command::new("git")
                .arg("-C")
                .arg(&project)
                .args(args)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            assert!(ok, "git {args:?}");
        };
        git(&["init", "-q"]);
        let store = dir.path().join("home/projects/p-1");
        // Untracked, it moves as usual; nothing is lost.
        let untracked = dir.path().join("untracked");
        copy_tree(&project, &untracked).unwrap();
        git(&["add", ".jan/agent/agent.toml"]);

        let out = migrate_on_launch(&project, &store, None);
        assert!(matches!(out, Outcome::Tracked { .. }), "{out:?}");
        assert!(project.join(".jan/agent/agent.toml").is_file());
        assert!(!store.exists());
        assert!(out.message().unwrap().contains("tracked by git"));
        assert!(matches!(
            migrate_on_launch(&untracked, &store, None),
            Outcome::Moved { .. }
        ));
    }

    #[test]
    fn copy_fallback_preserves_the_tree() {
        let dir = tempfile::tempdir().unwrap();
        let project = legacy_project(dir.path());
        let staging = dir.path().join("copy");
        copy_tree(&legacy_project_store(&project), &staging).unwrap();
        assert!(staging.join("memory/note.md").is_file());
        assert!(staging.join("threads/t1.json").is_file());
    }
}
