//! Long-term agent memory: `<name>.md` notes under `<store_root>/memory/`,
//! indexed by a generated `<store_root>/MEMORY.md`.
//!
//! Every function takes a store root rather than a project root, so the same
//! implementation serves the desktop's permanent store in the Jan data folder,
//! a project's store under `~/.jan/projects/<slug>`, and the user-wide store at
//! `~/.jan` itself (whose `MEMORY.md` is the root index: user notes plus one
//! pointer per project). Memory deliberately outlives the ephemeral per-thread
//! sandbox the filesystem tools run in.
//!
//! The indexes are generated from the notes on every write, never hand-edited,
//! so they cannot drift from what is on disk. [`Scopes`] resolves the names the
//! `memory_*` tools accept: `note` (this project), `user:note`, and, read-only,
//! `project:<slug>` / `project:<slug>/note` for another project.
//!
//! This is the store the `memory_*` built-in tools read and write, and the same
//! one the management commands expose, so both share one implementation. It is
//! unrelated to the vector-db recall index, which is keyed by project and
//! populated by a separate indexing path.
//!
//! Error strings carry the `ERROR:` prefix the tool protocol expects; the
//! command layer strips it for display.

use std::path::{Path, PathBuf};

use crate::workspace::{project_meta, projects_dir, store_dir, workspace_filename};

const KIND: &str = "memory";

/// The generated index at the top of every store.
pub const INDEX_FILE: &str = "MEMORY.md";

const USER_PREFIX: &str = "user:";
const PROJECT_PREFIX: &str = "project:";

/// `<store_root>/memory`.
pub fn memory_dir(store_root: &Path) -> PathBuf {
    store_dir(store_root, KIND)
}

fn target(store_root: &Path, name: &str) -> Result<PathBuf, String> {
    Ok(memory_dir(store_root).join(workspace_filename(name)?))
}

/// Note names (file stems), sorted. A missing directory yields an empty list
/// rather than an error: a store with no memory yet is not a failure.
pub async fn list(store: &Path) -> Vec<String> {
    let Ok(mut entries) = tokio::fs::read_dir(memory_dir(store)).await else {
        return Vec::new();
    };
    let mut names: Vec<String> = Vec::new();
    while let Ok(Some(e)) = entries.next_entry().await {
        let path = e.path();
        if path.extension().and_then(|x| x.to_str()) == Some("md") {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                names.push(stem.to_string());
            }
        }
    }
    names.sort();
    names
}

pub async fn read(store: &Path, name: &str) -> Result<String, String> {
    let target = target(store, name)?;
    tokio::fs::read_to_string(&target)
        .await
        .map_err(|e| format!("ERROR: {e}"))
}

/// A memory note's summary line: the first non-empty, non-heading body line,
/// capped. Mirrors skills' catalog: models see one line per note at session
/// start and load the rest on demand with `memory_read`.
fn describe(content: &str) -> String {
    content
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && !l.starts_with('#'))
        .map(|l| {
            if l.chars().count() > 120 {
                l.chars().take(120).collect::<String>()
            } else {
                l.to_string()
            }
        })
        .unwrap_or_default()
}

/// One catalog row: enough to advertise a note without shipping its body.
///
/// `mtime_ms` (Unix millis, 0 when the filesystem withholds it) lets callers
/// rank notes by recency - the desktop's chat digest and Cowork's catalog cap
/// both keep the newest notes when they cannot keep them all.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub name: String,
    pub summary: String,
    pub mtime_ms: u64,
}

fn mtime_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Memory notes worth advertising in the system prompt: name + summary line, in
/// name-sorted order, skipping notes with neither a name nor a summary. This is
/// the progressive-disclosure catalog - the model calls `memory_read` to load a
/// note on demand. Sync (std::fs) so the sync `context::load_memory_catalog`
/// can call it directly; the async `memory_*` tools share the same store.
pub fn catalog(store: &Path) -> Vec<CatalogEntry> {
    let dir = memory_dir(store);
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut notes: Vec<CatalogEntry> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let path = e.path();
            if path.extension().and_then(|x| x.to_str()) != Some("md") {
                return None;
            }
            let name = path.file_stem().and_then(|s| s.to_str());
            let body = std::fs::read_to_string(&path).ok();
            match (name, body) {
                (Some(name), Some(body)) => {
                    let summary = describe(&body);
                    if name.is_empty() && summary.is_empty() {
                        None
                    } else {
                        Some(CatalogEntry {
                            name: name.to_string(),
                            summary,
                            mtime_ms: mtime_ms(&path),
                        })
                    }
                }
                _ => None,
            }
        })
        .collect();
    notes.sort_by(|a, b| a.name.cmp(&b.name));
    notes
}

/// Create or overwrite a note and regenerate the store's index. Returns the
/// filename written, so callers can phrase their own result message. Parent
/// directories are created as needed.
pub async fn write(store: &Path, name: &str, content: &str) -> Result<String, String> {
    let file = workspace_filename(name)?;
    let dir = memory_dir(store);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("ERROR: {e}"))?;
    tokio::fs::write(dir.join(&file), content)
        .await
        .map_err(|e| format!("ERROR: {e}"))?;
    write_index(store);
    Ok(file)
}

/// Delete a note and regenerate the store's index. Idempotent: a missing note
/// is Ok.
pub async fn delete(store: &Path, name: &str) -> Result<(), String> {
    let target = target(store, name)?;
    match tokio::fs::remove_file(&target).await {
        Ok(()) => {
            write_index(store);
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("ERROR: {e}")),
    }
}

/// `- `<prefix><name>` - summary` rows, one per note.
fn note_rows(prefix: &str, notes: &[CatalogEntry]) -> Vec<String> {
    notes
        .iter()
        .map(|n| {
            if n.summary.is_empty() {
                format!("- `{prefix}{}` - no summary", n.name)
            } else {
                format!("- `{prefix}{}` - {}", n.name, n.summary)
            }
        })
        .collect()
}

/// A project store's `MEMORY.md`: one row per note. Empty when it has none.
pub fn project_index(store: &Path) -> String {
    let rows = note_rows("", &catalog(store));
    if rows.is_empty() {
        return String::new();
    }
    format!("# Project memory\n\n{}\n", rows.join("\n"))
}

/// Regenerate `<store>/MEMORY.md` from the notes. Best-effort: an index that
/// fails to write is rebuilt on the next write, and the prompt never reads it.
pub fn write_index(store: &Path) {
    let path = store.join(INDEX_FILE);
    let body = project_index(store);
    if body.is_empty() {
        let _ = std::fs::remove_file(&path);
    } else {
        let _ = std::fs::write(&path, body);
    }
}

/// One other project, as the root index points at it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectPointer {
    pub slug: String,
    /// The project directory the store belongs to, when it recorded one.
    pub path: Option<String>,
    pub notes: usize,
}

/// Every project store under `<jan_home>/projects` that holds at least one
/// note, except `exclude` (the current project). Sorted by slug.
pub fn project_pointers(jan_home: &Path, exclude: Option<&Path>) -> Vec<ProjectPointer> {
    let Ok(rd) = std::fs::read_dir(projects_dir(jan_home)) else {
        return Vec::new();
    };
    let mut out: Vec<ProjectPointer> = rd
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter(|e| exclude != Some(e.path().as_path()))
        .filter_map(|e| {
            let slug = e.file_name().to_str()?.to_string();
            if slug.starts_with('.') {
                return None;
            }
            let notes = catalog(&e.path()).len();
            (notes > 0).then(|| ProjectPointer {
                slug,
                path: project_meta(&e.path()),
                notes,
            })
        })
        .collect();
    out.sort_by(|a, b| a.slug.cmp(&b.slug));
    out
}

fn pointer_rows(pointers: &[ProjectPointer]) -> Vec<String> {
    pointers
        .iter()
        .map(|p| {
            let plural = if p.notes == 1 { "note" } else { "notes" };
            match &p.path {
                Some(path) => format!("- `{PROJECT_PREFIX}{}` - {path} ({} {plural})", p.slug, p.notes),
                None => format!("- `{PROJECT_PREFIX}{}` - ({} {plural})", p.slug, p.notes),
            }
        })
        .collect()
}

/// The root `~/.jan/MEMORY.md`: user-wide notes, then (when `cross_project`) a
/// pointer to every project with memory. Empty when there is nothing to list.
pub fn root_index(jan_home: &Path, cross_project: bool) -> String {
    let mut sections = Vec::new();
    let user = note_rows(USER_PREFIX, &catalog(jan_home));
    if !user.is_empty() {
        sections.push(format!("## User notes (all projects)\n\n{}", user.join("\n")));
    }
    if cross_project {
        let projects = pointer_rows(&project_pointers(jan_home, None));
        if !projects.is_empty() {
            sections.push(format!("## Projects\n\n{}", projects.join("\n")));
        }
    }
    if sections.is_empty() {
        return String::new();
    }
    format!("# Memory\n\n{}\n", sections.join("\n\n"))
}

/// Regenerate the root index. Best-effort, like [`write_index`].
pub fn write_root_index(jan_home: &Path, cross_project: bool) {
    let path = jan_home.join(INDEX_FILE);
    let body = root_index(jan_home, cross_project);
    if body.is_empty() {
        let _ = std::fs::remove_file(&path);
    } else if std::fs::create_dir_all(jan_home).is_ok() {
        let _ = std::fs::write(&path, body);
    }
}

/// The memory a run can reach, and how scoped names resolve against it.
#[derive(Debug, Clone, Copy)]
pub struct Scopes<'a> {
    /// The current store: unprefixed names read and write here.
    pub store: &'a Path,
    /// `~/.jan`, holding the user-wide notes and every project's store. `None`
    /// on the desktop, whose store is the data folder's and has no user scope.
    pub home: Option<&'a Path>,
    /// Whether other projects are listed and readable.
    pub cross_project: bool,
}

/// Where a scoped name points.
#[derive(Debug, PartialEq, Eq)]
struct Resolved {
    store: PathBuf,
    /// `None` for `project:<slug>`, which names that project's index.
    note: Option<String>,
    /// Only the current project's and the user's notes are writable; another
    /// project's memory is that project's to curate.
    writable: bool,
}

impl<'a> Scopes<'a> {
    /// Scopes with only the current store (the desktop, and tests).
    pub fn store_only(store: &'a Path) -> Self {
        Self {
            store,
            home: None,
            cross_project: false,
        }
    }

    fn home(&self) -> Result<&'a Path, String> {
        self.home
            .ok_or_else(|| "ERROR: this session has no user or cross-project memory".to_string())
    }

    fn resolve(&self, name: &str) -> Result<Resolved, String> {
        let name = name.trim();
        if let Some(note) = name.strip_prefix(USER_PREFIX) {
            return Ok(Resolved {
                store: self.home()?.to_path_buf(),
                note: Some(note.to_string()),
                writable: true,
            });
        }
        let Some(rest) = name.strip_prefix(PROJECT_PREFIX) else {
            return Ok(Resolved {
                store: self.store.to_path_buf(),
                note: Some(name.to_string()),
                writable: true,
            });
        };
        let (slug, note) = match rest.split_once('/') {
            Some((slug, note)) => (slug, Some(note.to_string())),
            None => (rest, None),
        };
        if slug.is_empty() || slug.contains(['/', '\\']) || slug.contains("..") {
            return Err(format!("ERROR: invalid project '{slug}'"));
        }
        let store = projects_dir(self.home()?).join(slug);
        if store == self.store {
            return Ok(Resolved {
                store,
                note,
                writable: true,
            });
        }
        if !self.cross_project {
            return Err(
                "ERROR: cross-project memory is off (memory_cross_project = false in ~/.jan/config.toml)"
                    .to_string(),
            );
        }
        if !store.is_dir() {
            return Err(format!("ERROR: no project '{slug}'"));
        }
        Ok(Resolved {
            store,
            note,
            writable: false,
        })
    }

    /// Read a note, or with `project:<slug>` that project's index.
    pub async fn read(&self, name: &str) -> Result<String, String> {
        let target = self.resolve(name)?;
        match target.note {
            Some(note) => read(&target.store, &note).await,
            None => {
                let index = project_index(&target.store);
                Ok(if index.is_empty() {
                    "(no memory notes)".to_string()
                } else {
                    index
                })
            }
        }
    }

    /// Write a note in the current project or the user scope, then refresh the
    /// root index so its pointers stay current. Returns the path written,
    /// relative to its store's parent scope, for the tool result.
    pub async fn write(&self, name: &str, content: &str) -> Result<String, String> {
        let target = self.resolve(name)?;
        let Some(note) = target.note.filter(|_| target.writable) else {
            return Err(format!(
                "ERROR: '{name}' is read-only: write to this project's notes (`name`) or your own (`user:name`)"
            ));
        };
        let file = write(&target.store, &note, content).await?;
        if let Some(home) = self.home {
            write_root_index(home, self.cross_project);
        }
        let is_user = self.home.is_some_and(|h| target.store == h);
        Ok(if is_user { format!("{USER_PREFIX}{file}") } else { file })
    }

    /// The current project's note names, then the user's as `user:<name>`.
    pub async fn list(&self) -> Vec<String> {
        let mut names = list(self.store).await;
        if let Some(home) = self.home {
            names.extend(list(home).await.into_iter().map(|n| format!("{USER_PREFIX}{n}")));
        }
        names
    }

    /// The prompt's memory block: this project's index, then the user's notes
    /// and (when `cross_project`) pointers to other projects. `None` when there
    /// is nothing to show. Rendered from the notes, not from the `MEMORY.md`
    /// files, so a stale or hand-edited index can never reach the model.
    pub fn prompt_block(&self) -> Option<String> {
        let mut sections = Vec::new();
        let project = note_rows("", &catalog(self.store));
        if !project.is_empty() {
            sections.push(format!("## This project\n\n{}", project.join("\n")));
        }
        if let Some(home) = self.home {
            let user = note_rows(USER_PREFIX, &catalog(home));
            if !user.is_empty() {
                sections.push(format!("## User notes (all projects)\n\n{}", user.join("\n")));
            }
            if self.cross_project {
                let others = pointer_rows(&project_pointers(home, Some(self.store)));
                if !others.is_empty() {
                    sections.push(format!(
                        "## Other projects\n\nRead-only. `memory_read` a project to see its notes; only open one when it is relevant.\n\n{}",
                        others.join("\n")
                    ));
                }
            }
        }
        if sections.is_empty() {
            return None;
        }
        Some(format!(
            "# Available Memories\n\nDurable facts recorded in earlier sessions. Read a note's full contents with `memory_read` when it is relevant to the current task.\n\n{}",
            sections.join("\n\n")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn unique_root() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!("jan_memory_test_{}_{}", std::process::id(), n))
    }

    #[tokio::test]
    async fn write_read_list_delete_roundtrip() {
        let root = unique_root();
        assert!(list(&root).await.is_empty(), "fresh project has no notes");

        assert_eq!(write(&root, "prefs", "body").await.unwrap(), "prefs.md");
        assert_eq!(read(&root, "prefs").await.unwrap(), "body");
        assert_eq!(list(&root).await, vec!["prefs"]);

        delete(&root, "prefs").await.unwrap();
        assert!(list(&root).await.is_empty());
        delete(&root, "prefs").await.unwrap(); // idempotent
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn list_is_sorted_and_ignores_non_markdown() {
        let root = unique_root();
        write(&root, "b", "b").await.unwrap();
        write(&root, "a", "a").await.unwrap();
        std::fs::write(memory_dir(&root).join("notes.txt"), "ignored").unwrap();

        assert_eq!(list(&root).await, vec!["a", "b"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn traversal_names_are_rejected() {
        let root = unique_root();
        for bad in ["../escape", "sub/x", "..", "", "."] {
            assert!(write(&root, bad, "x").await.is_err(), "write {bad:?}");
            assert!(read(&root, bad).await.is_err(), "read {bad:?}");
            assert!(delete(&root, bad).await.is_err(), "delete {bad:?}");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn read_missing_note_errors() {
        let root = unique_root();
        assert!(read(&root, "nope").await.is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn catalog_lists_sorted_notes_with_summaries() {
        let root = unique_root();
        std::fs::create_dir_all(memory_dir(&root)).unwrap();
        std::fs::write(
            memory_dir(&root).join("decisions.md"),
            "# Decisions\nWe use Yarn not npm.",
        )
        .unwrap();
        std::fs::write(memory_dir(&root).join("prefs.md"), "Keep it minimal.").unwrap();
        std::fs::write(memory_dir(&root).join("notes.txt"), "ignored").unwrap();

        let notes = catalog(&root);
        let named: Vec<(&str, &str)> = notes
            .iter()
            .map(|n| (n.name.as_str(), n.summary.as_str()))
            .collect();
        assert_eq!(
            named,
            vec![
                ("decisions", "We use Yarn not npm."),
                ("prefs", "Keep it minimal."),
            ]
        );
        assert!(
            notes.iter().all(|n| n.mtime_ms > 0),
            "freshly written notes carry a real mtime: {notes:?}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn catalog_lists_notes_even_without_a_summary_line() {
        let root = unique_root();
        std::fs::create_dir_all(memory_dir(&root)).unwrap();
        std::fs::write(memory_dir(&root).join("empty.md"), "   \n# Only headings\n").unwrap();

        // A curated note is worth advertising by name even if it has no prose.
        let notes = catalog(&root);
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].name, "empty");
        assert_eq!(notes[0].summary, "");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn catalog_missing_dir_is_empty() {
        let root = unique_root();
        assert!(catalog(&root).is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    fn scopes_fixture() -> (PathBuf, PathBuf, PathBuf) {
        let home = unique_root();
        let current = projects_dir(&home).join("app-1");
        let other = projects_dir(&home).join("lib-2");
        std::fs::create_dir_all(&current).unwrap();
        std::fs::create_dir_all(memory_dir(&other)).unwrap();
        std::fs::write(memory_dir(&other).join("api.md"), "Lib API is frozen.").unwrap();
        std::fs::write(other.join("project.json"), "{\"path\": \"/src/lib\"}").unwrap();
        (home, current, other)
    }

    #[tokio::test]
    async fn write_generates_the_store_index_and_delete_removes_it() {
        let root = unique_root();
        write(&root, "prefs", "# Prefs\nKeep it minimal.").await.unwrap();
        let index = std::fs::read_to_string(root.join(INDEX_FILE)).unwrap();
        assert!(index.contains("- `prefs` - Keep it minimal."), "{index}");

        delete(&root, "prefs").await.unwrap();
        assert!(!root.join(INDEX_FILE).exists(), "an empty store has no index");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn scoped_names_route_to_user_and_project_stores() {
        let (home, current, _other) = scopes_fixture();
        let scopes = Scopes {
            store: &current,
            home: Some(&home),
            cross_project: true,
        };

        assert_eq!(scopes.write("local", "Here.").await.unwrap(), "local.md");
        assert_eq!(scopes.write("user:prefs", "Everywhere.").await.unwrap(), "user:prefs.md");
        assert!(memory_dir(&current).join("local.md").is_file());
        assert!(memory_dir(&home).join("prefs.md").is_file());
        assert_eq!(scopes.read("user:prefs").await.unwrap(), "Everywhere.");
        assert_eq!(scopes.list().await, vec!["local", "user:prefs"]);

        // Another project is readable, index and note, but never writable.
        assert!(scopes.read("project:lib-2").await.unwrap().contains("`api`"));
        assert_eq!(scopes.read("project:lib-2/api").await.unwrap(), "Lib API is frozen.");
        assert!(scopes.write("project:lib-2/api", "x").await.unwrap_err().contains("read-only"));
        assert!(scopes.read("project:nope/api").await.is_err());
        assert!(scopes.read("project:../x/api").await.is_err());

        // The root index lists user notes and points at projects with memory.
        let root = std::fs::read_to_string(home.join(INDEX_FILE)).unwrap();
        assert!(root.contains("- `user:prefs` - Everywhere."), "{root}");
        assert!(root.contains("- `project:lib-2` - /src/lib (1 note)"), "{root}");
        assert!(root.contains("- `project:app-1`"), "{root}");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[tokio::test]
    async fn cross_project_off_hides_and_refuses_other_projects() {
        let (home, current, _other) = scopes_fixture();
        let scopes = Scopes {
            store: &current,
            home: Some(&home),
            cross_project: false,
        };
        assert!(scopes.read("project:lib-2/api").await.unwrap_err().contains("cross-project"));
        // The current project stays addressable by its own slug.
        scopes.write("mine", "ok").await.unwrap();
        assert_eq!(scopes.read("project:app-1/mine").await.unwrap(), "ok");
        assert!(!scopes.prompt_block().unwrap().contains("lib-2"));
        assert!(!root_index(&home, false).contains("lib-2"));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[tokio::test]
    async fn a_store_only_scope_has_no_user_or_project_names() {
        let root = unique_root();
        let scopes = Scopes::store_only(&root);
        assert!(scopes.write("user:x", "y").await.is_err());
        assert!(scopes.read("project:a/b").await.is_err());
        scopes.write("x", "y").await.unwrap();
        assert_eq!(scopes.list().await, vec!["x"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn prompt_block_opens_this_project_and_points_at_the_rest() {
        let (home, current, _other) = scopes_fixture();
        std::fs::create_dir_all(memory_dir(&current)).unwrap();
        std::fs::write(memory_dir(&current).join("build.md"), "Use yarn.").unwrap();
        std::fs::create_dir_all(memory_dir(&home)).unwrap();
        std::fs::write(memory_dir(&home).join("style.md"), "Be terse.").unwrap();

        let block = Scopes {
            store: &current,
            home: Some(&home),
            cross_project: true,
        }
        .prompt_block()
        .unwrap();
        assert!(block.starts_with("# Available Memories"));
        let this = block.find("## This project").unwrap();
        let user = block.find("## User notes").unwrap();
        let others = block.find("## Other projects").unwrap();
        assert!(this < user && user < others, "{block}");
        assert!(block.contains("- `build` - Use yarn."));
        assert!(block.contains("- `user:style` - Be terse."));
        assert!(block.contains("`project:lib-2` - /src/lib (1 note)"));
        assert!(!block.contains("project:app-1"), "the current project is not a pointer");
        assert!(!block.contains("Lib API is frozen."), "bodies stay out of the prompt");
        let _ = std::fs::remove_dir_all(&home);
    }

}
