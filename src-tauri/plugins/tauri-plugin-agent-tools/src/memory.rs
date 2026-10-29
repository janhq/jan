//! Long-term agent memory: Markdown notes under `<store_root>/memory/`, owned
//! and curated by the agent, and indexed by a generated `<store_root>/MEMORY.md`.
//!
//! Every function takes a store root rather than a project root, so the same
//! implementation serves the desktop's permanent store in the Jan data folder,
//! a project's store under `~/.jan/projects/<slug>`, and the user-wide store at
//! `~/.jan` itself (whose `MEMORY.md` is the root index: user notes plus one
//! pointer per project). Memory deliberately outlives the ephemeral per-thread
//! sandbox the filesystem tools run in.
//!
//! A note is `memory/<name>.md`, and a name may carry one folder level
//! (`tui/scroll` is `memory/tui/scroll.md`), so related notes collapse to one
//! index line. A note may open with front matter (`---` ... `---`); its first
//! body line is the title the index shows. `status: done` in the front matter
//! archives a note: it stays readable and searchable but is never listed.
//!
//! The index is a pointer chain, titles only, under a fixed token budget
//! ([`INDEX_BUDGET_TOKENS`]): root user notes and project pointers first, then
//! this project's notes by most recent use, folders collapsed to one line, and
//! a single overflow line for whatever does not fit. Recency lives in a side
//! file (`memory/.meta.json`), so reading a note never touches its mtime.
//!
//! [`Scopes`] resolves the names the `memory` tool accepts: `note` or
//! `folder/note` (this project), `user:note`, and, read-only, `project:<slug>`
//! / `project:<slug>/note` for another project.
//!
//! Error strings carry the `ERROR:` prefix the tool protocol expects; the
//! command layer strips it for display.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use crate::workspace::{project_meta, projects_dir, store_dir};

const KIND: &str = "memory";

/// The generated index at the top of every store.
pub const INDEX_FILE: &str = "MEMORY.md";

/// Last-read / last-written times per note, kept beside the notes so a read
/// never rewrites a note's mtime.
const META_FILE: &str = ".meta.json";

/// Marks a store whose notes were brought to the titled format, so the
/// migration runs once.
const MIGRATED_FILE: &str = ".migrated";

const USER_PREFIX: &str = "user:";
const PROJECT_PREFIX: &str = "project:";

/// The token budget for the whole in-prompt memory section.
pub const INDEX_BUDGET_TOKENS: usize = 1_500;

/// Chars per token for budgeting. Conservative for English Markdown, so the
/// real token count lands under the budget rather than over it.
const CHARS_PER_TOKEN: usize = 4;

/// The share of the budget past which `write` warns that the index is filling.
const NEAR_BUDGET_PERCENT: usize = 85;

/// Longest title the index shows; a longer first line is cut.
const MAX_TITLE_CHARS: usize = 100;

/// Most lines a `search` returns.
const MAX_SEARCH_HITS: usize = 30;

/// `<store_root>/memory`.
pub fn memory_dir(store_root: &Path) -> PathBuf {
    store_dir(store_root, KIND)
}

/// Validate a note name and return its path relative to `memory/`. One
/// optional folder level; each part non-empty, with no traversal, separators
/// beyond the one `/`, or leading dot (which would hide it from listings).
fn note_relpath(name: &str) -> Result<PathBuf, String> {
    let trimmed = name.trim();
    let stem = trimmed.strip_suffix(".md").unwrap_or(trimmed);
    let parts: Vec<&str> = stem.split('/').collect();
    let valid = |part: &str| {
        !part.is_empty()
            && !part.contains('\\')
            && !part.contains("..")
            && !part.starts_with('.')
            && part.trim() == part
    };
    if parts.len() > 2 || !parts.iter().all(|p| valid(p)) {
        return Err(format!(
            "ERROR: invalid name '{name}' (use `note` or `folder/note`: no `..`, no leading `.`, one folder level)"
        ));
    }
    let mut path: PathBuf = parts.iter().collect();
    path.set_extension("md");
    Ok(path)
}

/// Note stems the harness's own index files would be confused with: a note
/// named `index` or `MEMORY` reads as an index the agent maintains, and the
/// harness builds the index itself (`MEMORY.md`, the prompt section).
const RESERVED_STEMS: [&str; 2] = ["index", "memory"];

/// [`note_relpath`] for a note about to be created: also refuses a name that
/// collides with the harness index ([`RESERVED_STEMS`], any case, any folder).
fn new_note_relpath(name: &str) -> Result<PathBuf, String> {
    let rel = note_relpath(name)?;
    let stem = rel.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
    if RESERVED_STEMS.iter().any(|r| stem.eq_ignore_ascii_case(r)) {
        return Err(format!(
            "ERROR: '{name}' is reserved: the harness builds the memory index itself, so do not write index or overview notes"
        ));
    }
    Ok(rel)
}

/// Most mutations (write, edit, delete, move) one memory tidy may make. Past
/// it the tool refuses further changes, so a tidy that misjudges the store
/// can only misjudge this many notes.
pub const TIDY_MAX_CHANGES: usize = 30;

/// A run's allowance of memory mutations, enforced by the tool rather than
/// asked of the model. Shared by every call of one run; counts what it let
/// through and what it refused, so the caller can report a cap that was hit.
///
/// It also remembers what the run last saw of each note (a content hash per
/// file), because the run that holds one -- a tidy -- works in the background
/// beside the main agent on the same store: a whole-file `write`, a `move` or
/// a `delete` made from a copy the main agent has since changed would lose
/// that change, so it is refused until the note is viewed again.
#[derive(Debug)]
pub struct ChangeBudget {
    max: usize,
    used: std::sync::atomic::AtomicUsize,
    refused: std::sync::atomic::AtomicUsize,
    seen: std::sync::Mutex<HashMap<PathBuf, u64>>,
}

impl ChangeBudget {
    pub fn new(max: usize) -> Self {
        Self {
            max,
            used: Default::default(),
            refused: Default::default(),
            seen: Default::default(),
        }
    }

    fn seen(&self) -> std::sync::MutexGuard<'_, HashMap<PathBuf, u64>> {
        self.seen.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Record that the run now knows `path` as `content`.
    pub(crate) fn saw(&self, path: &Path, content: &str) {
        self.seen().insert(path.to_path_buf(), content_hash(content));
    }

    /// Forget `path`: it was deleted or moved away.
    pub(crate) fn forget(&self, path: &Path) {
        self.seen().remove(path);
    }

    /// Ok when the note at `path` is missing (nothing to clobber) or is still
    /// what the run last saw; else the refusal asking it to view `name` again.
    pub(crate) fn check_fresh(&self, path: &Path, name: &str) -> Result<(), String> {
        let Ok(current) = std::fs::read_to_string(path) else {
            return Ok(());
        };
        if self.seen().get(path) == Some(&content_hash(&current)) {
            return Ok(());
        }
        Err(format!(
            "ERROR: '{name}' changed since you last viewed it (or you have not viewed it), so this change \
             could overwrite newer content. `view` it again and base the change on what it says now."
        ))
    }

    /// Take one change, or the refusal the tool returns once the cap is spent.
    pub(crate) fn take(&self) -> Result<(), String> {
        use std::sync::atomic::Ordering;
        let taken = self
            .used
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| (n < self.max).then_some(n + 1));
        if taken.is_ok() {
            return Ok(());
        }
        self.refused.fetch_add(1, Ordering::SeqCst);
        Err(format!(
            "ERROR: this tidy has reached its cap of {} memory changes; no further write, edit, delete or move is allowed. Stop changing notes and write your report, ending it with `cap reached`.",
            self.max
        ))
    }

    /// Give back a change whose operation failed after it was taken.
    pub(crate) fn refund(&self) {
        self.used.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
    }

    /// Changes made so far.
    pub fn used(&self) -> usize {
        self.used.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// Changes refused because the cap was spent.
    pub fn refused(&self) -> usize {
        self.refused.load(std::sync::atomic::Ordering::SeqCst)
    }
}

fn target(store_root: &Path, name: &str) -> Result<PathBuf, String> {
    Ok(memory_dir(store_root).join(note_relpath(name)?))
}

/// The canonical name of a validated note name: no `.md`, trimmed.
fn canonical(name: &str) -> String {
    let trimmed = name.trim();
    trimmed.strip_suffix(".md").unwrap_or(trimmed).to_string()
}

/// One note as parsed from disk.
#[derive(Debug, Clone)]
struct Note {
    /// `note` or `folder/note`.
    name: String,
    title: String,
    done: bool,
    body: String,
    mtime_ms: u64,
}

/// Split optional front matter from a note: `(front matter lines, body)`.
fn split_front_matter(content: &str) -> (Vec<&str>, &str) {
    let Some(rest) = content.strip_prefix("---\n").or_else(|| content.strip_prefix("---\r\n")) else {
        return (Vec::new(), content);
    };
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end() == "---" {
            let front = rest[..offset].lines().collect();
            return (front, &rest[offset + line.len()..]);
        }
        offset += line.len();
    }
    (Vec::new(), content)
}

/// Whether the note's front matter archives it (`status: done`).
fn is_done(content: &str) -> bool {
    split_front_matter(content).0.iter().any(|line| {
        line.split_once(':').is_some_and(|(k, v)| {
            k.trim() == "status" && v.trim().trim_matches(['"', '\'']).eq_ignore_ascii_case("done")
        })
    })
}

/// A note's title: the first non-empty body line, heading marks stripped,
/// capped at [`MAX_TITLE_CHARS`].
fn title_of(content: &str) -> String {
    let line = split_front_matter(content)
        .1
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or_default()
        .trim_start_matches('#')
        .trim();
    if line.chars().count() > MAX_TITLE_CHARS {
        let cut: String = line.chars().take(MAX_TITLE_CHARS - 3).collect();
        format!("{}...", cut.trim_end())
    } else {
        line.to_string()
    }
}

fn mtime_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Every `.md` note in a store, archived ones included, sorted by name. Sync
/// (std::fs) so the sync prompt composition can call it directly.
fn scan(store: &Path) -> Vec<Note> {
    let dir = memory_dir(store);
    let mut notes = Vec::new();
    let mut visit = |path: PathBuf, folder: Option<&str>| {
        if path.extension().and_then(|x| x.to_str()) != Some("md") {
            return;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            return;
        };
        if stem.starts_with('.') {
            return;
        }
        let Ok(body) = std::fs::read_to_string(&path) else {
            return;
        };
        let name = match folder {
            Some(folder) => format!("{folder}/{stem}"),
            None => stem.to_string(),
        };
        notes.push(Note {
            name,
            title: title_of(&body),
            done: is_done(&body),
            mtime_ms: mtime_ms(&path),
            body,
        });
    };
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    for entry in rd.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let Some(folder) = path.file_name().and_then(|f| f.to_str()).map(str::to_string) else {
                continue;
            };
            if folder.starts_with('.') {
                continue;
            }
            if let Ok(inner) = std::fs::read_dir(&path) {
                for sub in inner.flatten() {
                    if sub.path().is_file() {
                        visit(sub.path(), Some(&folder));
                    }
                }
            }
        } else {
            visit(path, None);
        }
    }
    notes.sort_by(|a, b| a.name.cmp(&b.name));
    notes
}

/// Recency per note: the later of its last read and last write, in Unix ms.
#[derive(Debug, Default, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
struct Meta {
    #[serde(default)]
    notes: BTreeMap<String, NoteMeta>,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
struct NoteMeta {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    read_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    written_ms: Option<u64>,
}

impl NoteMeta {
    fn last_used(&self) -> u64 {
        self.read_ms.max(self.written_ms).unwrap_or(0)
    }
}

/// The recency side file: empty when it does not exist yet, `None` when it
/// exists but cannot be read or parsed. A caller about to save must not treat
/// `None` as empty, or one bad read would wipe every note's recency.
fn load_meta(store: &Path) -> Option<Meta> {
    match std::fs::read_to_string(memory_dir(store).join(META_FILE)) {
        Ok(raw) => serde_json::from_str(&raw).ok(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Some(Meta::default()),
        Err(_) => None,
    }
}

/// One lock per store directory, shared by every thread of the process: the
/// loop runs `memory` calls in parallel (it is a read-capability tool) and a
/// tidy subagent writes the same store as the main agent, so unserialized
/// read-modify-writes of the side file would drop each other's updates.
fn meta_lock(store: &Path) -> std::sync::Arc<std::sync::Mutex<()>> {
    static LOCKS: std::sync::OnceLock<
        std::sync::Mutex<HashMap<PathBuf, std::sync::Arc<std::sync::Mutex<()>>>>,
    > = std::sync::OnceLock::new();
    let locks = LOCKS.get_or_init(Default::default);
    let mut locks = locks.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    locks.entry(memory_dir(store)).or_default().clone()
}

/// Read, change and save the side file under the store's lock. Best-effort:
/// losing a timestamp only reorders the index, it never loses a note. A side
/// file that fails to parse is left as it is rather than replaced with what
/// `update` made of an empty one.
fn update_meta(store: &Path, update: impl FnOnce(&mut Meta) -> bool) {
    let lock = meta_lock(store);
    let _held = lock.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let Some(mut meta) = load_meta(store) else {
        return;
    };
    if update(&mut meta) {
        save_meta(store, &meta);
    }
}

/// Update one note's recency.
fn touch_meta(store: &Path, name: &str, update: impl FnOnce(&mut NoteMeta)) {
    update_meta(store, |meta| {
        update(meta.notes.entry(name.to_string()).or_default());
        true
    });
}

fn forget_meta(store: &Path, name: &str) {
    update_meta(store, |meta| meta.notes.remove(name).is_some());
}

/// Write the side file through a temp file in the same directory and a
/// rename, so a reader sees the old file or the new one, never half of one.
/// Called only under [`meta_lock`], which also keeps the temp name unique.
fn save_meta(store: &Path, meta: &Meta) {
    let dir = memory_dir(store);
    let Ok(raw) = serde_json::to_string_pretty(meta) else {
        return;
    };
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let tmp = dir.join(format!("{META_FILE}.{}.tmp", std::process::id()));
    if std::fs::write(&tmp, raw).is_err() || std::fs::rename(&tmp, dir.join(META_FILE)).is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
}

/// Bring a store's notes to the titled format, once.
///
/// Notes written before titles existed lead with whatever their author wrote,
/// which is already the title the index shows (the first body line), so they
/// are left as they are. A note that announces it is finished (`DONE.` or
/// `OBSOLETE` leading its first line) is archived with `status: done` front
/// matter. Seeds `.meta.json` from mtimes so recency survives the move. No note
/// is renamed or deleted. Idempotent and best-effort; a marker file records
/// that it ran.
pub fn migrate(store: &Path) {
    let dir = memory_dir(store);
    if !dir.is_dir() || dir.join(MIGRATED_FILE).exists() {
        return;
    }
    let notes = scan(store);
    update_meta(store, |meta| {
        for note in &notes {
            meta.notes.entry(note.name.clone()).or_insert(NoteMeta {
                read_ms: None,
                written_ms: Some(note.mtime_ms),
            });
        }
        true
    });
    for note in notes {
        let first = split_front_matter(&note.body)
            .1
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .unwrap_or_default()
            .to_string();
        let finished = first.starts_with("DONE") || first.starts_with("OBSOLETE");
        if finished && !note.done {
            if let Ok(path) = target(store, &note.name) {
                let _ = std::fs::write(&path, set_status_done(&note.body));
            }
        }
    }
    let _ = std::fs::write(dir.join(MIGRATED_FILE), "1\n");
    write_index(store);
}

/// `content` with `status: done` in its front matter, added or replaced.
fn set_status_done(content: &str) -> String {
    let (front, body) = split_front_matter(content);
    let mut lines: Vec<String> = front
        .iter()
        .filter(|l| l.split_once(':').map_or(true, |(k, _)| k.trim() != "status"))
        .map(|l| l.to_string())
        .collect();
    lines.push("status: done".to_string());
    format!("---\n{}\n---\n{}", lines.join("\n"), body)
}

/// Every note name (stems, `folder/note` for a foldered one), sorted, archived
/// ones included. A missing directory yields an empty list rather than an
/// error: a store with no memory yet is not a failure.
pub async fn list(store: &Path) -> Vec<String> {
    let store = store.to_path_buf();
    tokio::task::spawn_blocking(move || scan(&store).into_iter().map(|n| n.name).collect())
        .await
        .unwrap_or_default()
}

/// A note's full content. Records the read in `.meta.json`.
pub async fn read(store: &Path, name: &str) -> Result<String, String> {
    let target = target(store, name)?;
    let content = tokio::fs::read_to_string(&target)
        .await
        .map_err(|e| format!("ERROR: {e}"))?;
    let now = now_ms();
    touch_meta(store, &canonical(name), |m| m.read_ms = Some(now));
    Ok(content)
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

/// The listed (not archived) notes: name + title, name-sorted. The desktop's
/// recall surface; the CLI prompt uses the budgeted index instead.
pub fn catalog(store: &Path) -> Vec<CatalogEntry> {
    scan(store)
        .into_iter()
        .filter(|n| !n.done)
        .map(|n| CatalogEntry {
            name: n.name,
            summary: n.title,
            mtime_ms: n.mtime_ms,
        })
        .collect()
}

/// Create or overwrite a note and regenerate the store's index. Returns the
/// path written relative to `memory/`, so callers can phrase their own result
/// message. Its folder is created as needed.
pub async fn write(store: &Path, name: &str, content: &str) -> Result<String, String> {
    let rel = if target(store, name)?.is_file() {
        note_relpath(name)?
    } else {
        new_note_relpath(name)?
    };
    let path = memory_dir(store).join(&rel);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("ERROR: {e}"))?;
    }
    tokio::fs::write(&path, content)
        .await
        .map_err(|e| format!("ERROR: {e}"))?;
    let now = now_ms();
    touch_meta(store, &canonical(name), |m| m.written_ms = Some(now));
    write_index(store);
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

/// Delete a note and regenerate the store's index; an emptied folder goes
/// with it. Idempotent: a missing note is Ok.
pub async fn delete(store: &Path, name: &str) -> Result<(), String> {
    let target = target(store, name)?;
    match tokio::fs::remove_file(&target).await {
        Ok(()) => {
            if let Some(parent) = target.parent().filter(|p| *p != memory_dir(store)) {
                // Fails while anything is left in it, which is the point.
                let _ = tokio::fs::remove_dir(parent).await;
            }
            forget_meta(store, &canonical(name));
            write_index(store);
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("ERROR: {e}")),
    }
}

/// Rename a note, into or out of a folder, in one step: the file is renamed
/// (content and front matter untouched) and its recency moves with it, so
/// reorganizing is not a write+delete pair that resets either. Refuses a
/// missing source, an existing destination and a reserved destination name.
/// Returns the destination relative to `memory/`, like [`write`].
pub async fn rename(store: &Path, from: &str, to: &str) -> Result<String, String> {
    let source = target(store, from)?;
    let rel = new_note_relpath(to)?;
    let dest = memory_dir(store).join(&rel);
    if !source.is_file() {
        return Err(format!("ERROR: no note '{from}' to move"));
    }
    if dest.exists() {
        return Err(format!(
            "ERROR: '{to}' already exists; merge with `edit` or `write`, then `delete` the other"
        ));
    }
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("ERROR: {e}"))?;
    }
    tokio::fs::rename(&source, &dest)
        .await
        .map_err(|e| format!("ERROR: {e}"))?;
    if let Some(parent) = source.parent().filter(|p| *p != memory_dir(store)) {
        // Fails while anything is left in it, which is the point.
        let _ = tokio::fs::remove_dir(parent).await;
    }
    update_meta(store, |meta| match meta.notes.remove(&canonical(from)) {
        Some(recency) => {
            meta.notes.insert(canonical(to), recency);
            true
        }
        None => false,
    });
    write_index(store);
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

/// One line of an index: a note, or a folder collapsed to its count.
#[derive(Debug, Clone)]
enum Entry {
    Note { name: String, title: String },
    Folder { name: String, notes: usize },
}

impl Entry {
    fn line(&self, prefix: &str) -> String {
        match self {
            Entry::Note { name, title } if title.is_empty() => format!("- `{prefix}{name}`"),
            Entry::Note { name, title } => format!("- `{prefix}{name}` - {title}"),
            Entry::Folder { name, notes } => {
                let plural = if *notes == 1 { "note" } else { "notes" };
                format!("- `{prefix}{name}/` ({notes} {plural})")
            }
        }
    }
}

/// A store's listed notes as index entries, most recently used first: a
/// folder collapses to one entry, ranked by its most recent note.
fn entries(store: &Path) -> Vec<Entry> {
    let meta = load_meta(store).unwrap_or_default();
    let used = |n: &Note| {
        meta.notes
            .get(&n.name)
            .map(NoteMeta::last_used)
            .filter(|t| *t > 0)
            .unwrap_or(n.mtime_ms)
    };
    let mut ranked: Vec<(u64, Entry)> = Vec::new();
    let mut folders: HashMap<String, (u64, usize)> = HashMap::new();
    for note in scan(store).into_iter().filter(|n| !n.done) {
        let when = used(&note);
        match note.name.split_once('/') {
            Some((folder, _)) => {
                let slot = folders.entry(folder.to_string()).or_default();
                slot.0 = slot.0.max(when);
                slot.1 += 1;
            }
            None => ranked.push((
                when,
                Entry::Note {
                    name: note.name,
                    title: note.title,
                },
            )),
        }
    }
    ranked.extend(
        folders
            .into_iter()
            .map(|(name, (when, notes))| (when, Entry::Folder { name, notes })),
    );
    // Newest first; ties by name, so equal timestamps still give stable bytes.
    ranked.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| entry_name(&a.1).cmp(entry_name(&b.1))));
    ranked.into_iter().map(|(_, e)| e).collect()
}

fn entry_name(entry: &Entry) -> &str {
    match entry {
        Entry::Note { name, .. } | Entry::Folder { name, .. } => name,
    }
}

/// A folder's listed notes, for `view` of a folder.
fn folder_entries(store: &Path, folder: &str) -> Vec<Entry> {
    scan(store)
        .into_iter()
        .filter(|n| !n.done && n.name.split_once('/').is_some_and(|(f, _)| f == folder))
        .map(|n| Entry::Note {
            name: n.name,
            title: n.title,
        })
        .collect()
}

/// Notes a store archived (`status: done`), counted for the index footer.
fn archived_count(store: &Path) -> usize {
    scan(store).iter().filter(|n| n.done).count()
}

/// A project store's `MEMORY.md`: one line per note or folder. Empty when it
/// has nothing listed.
pub fn project_index(store: &Path) -> String {
    let lines: Vec<String> = entries(store).iter().map(|e| e.line("")).collect();
    if lines.is_empty() {
        return String::new();
    }
    format!("# Project memory\n\n{}\n", lines.join("\n"))
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
/// listed note, except `exclude` (the current project). Sorted by slug.
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

fn pointer_line(p: &ProjectPointer) -> String {
    let plural = if p.notes == 1 { "note" } else { "notes" };
    match &p.path {
        Some(path) => format!("- `{PROJECT_PREFIX}{}` - {path} ({} {plural})", p.slug, p.notes),
        None => format!("- `{PROJECT_PREFIX}{}` - ({} {plural})", p.slug, p.notes),
    }
}

/// The root `~/.jan/MEMORY.md`: user-wide notes, then (when `cross_project`) a
/// pointer to every project with memory. Empty when there is nothing to list.
pub fn root_index(jan_home: &Path, cross_project: bool) -> String {
    let mut sections = Vec::new();
    let user: Vec<String> = entries(jan_home).iter().map(|e| e.line(USER_PREFIX)).collect();
    if !user.is_empty() {
        sections.push(format!("## User notes (all projects)\n\n{}", user.join("\n")));
    }
    if cross_project {
        let projects: Vec<String> =
            project_pointers(jan_home, None).iter().map(pointer_line).collect();
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

/// Estimated tokens in `text`, rounded up.
pub fn estimate_tokens(text: &str) -> usize {
    text.chars().count().div_ceil(CHARS_PER_TOKEN)
}

fn content_hash(content: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    content.hash(&mut h);
    h.finish()
}

/// A content hash per note in `store`, archived ones included (archiving is a
/// change worth reporting).
fn note_hashes(store: &Path, prefix: &str, out: &mut BTreeMap<String, u64>) {
    for note in scan(store) {
        out.insert(format!("{prefix}{}", note.name), content_hash(&note.body));
    }
}

/// Feed every entry of a store's `memory/` (one folder level, like [`scan`])
/// into `h` by name, size and mtime, in a stable order.
fn stamp_store(store: &Path, h: &mut impl std::hash::Hasher) {
    use std::hash::Hash;
    let mut rows: Vec<(PathBuf, u64, u64)> = Vec::new();
    let mut push = |path: PathBuf| {
        let meta = std::fs::metadata(&path).ok();
        let len = meta.as_ref().map_or(0, std::fs::Metadata::len);
        rows.push((path.clone(), len, mtime_ms(&path)));
    };
    let Ok(rd) = std::fs::read_dir(memory_dir(store)) else {
        return;
    };
    for entry in rd.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Ok(inner) = std::fs::read_dir(&path) {
                inner.flatten().for_each(|sub| push(sub.path()));
            }
        } else if !path.file_name().and_then(|f| f.to_str()).is_some_and(|f| f.starts_with('.')) {
            // Side files skipped: every read rewrites `.meta.json`, and
            // recency alone never moves the index over its budget.
            push(path);
        }
    }
    rows.sort();
    rows.hash(h);
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
    /// The prefix that names this store in results (`user:`, `project:x/`).
    prefix: String,
}

/// The index header every rendering of the prompt section starts with.
const PROMPT_HEADER: &str = "# Available Memories\n\nYour memory index (titles only, as of session start). Open a note with `memory` op `view` and a `name`; `view` a folder (`name/`) to list its notes.";

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
                prefix: USER_PREFIX.to_string(),
            });
        }
        let Some(rest) = name.strip_prefix(PROJECT_PREFIX) else {
            return Ok(Resolved {
                store: self.store.to_path_buf(),
                note: Some(name.to_string()),
                writable: true,
                prefix: String::new(),
            });
        };
        let (slug, note) = match rest.split_once('/') {
            Some((slug, note)) => (slug, Some(note.to_string()).filter(|n| !n.is_empty())),
            None => (rest, None),
        };
        if slug.is_empty() || slug.contains(['/', '\\']) || slug.contains("..") {
            return Err(format!("ERROR: invalid project '{slug}'"));
        }
        let store = projects_dir(self.home()?).join(slug);
        let prefix = format!("{PROJECT_PREFIX}{slug}/");
        if store == self.store {
            return Ok(Resolved {
                store,
                note,
                writable: true,
                prefix,
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
            prefix,
        })
    }

    fn writable(&self, name: &str) -> Result<(PathBuf, String, String), String> {
        let target = self.resolve(name)?;
        match target.note.filter(|_| target.writable) {
            Some(note) => Ok((target.store, note, target.prefix)),
            None => Err(format!(
                "ERROR: '{name}' is read-only: change this project's notes (`name`) or your own (`user:name`)"
            )),
        }
    }

    /// The file a note name resolves to, when it names a single note (not a
    /// folder or a project index). It may not exist.
    pub(crate) fn note_file(&self, name: &str) -> Option<PathBuf> {
        let target = self.resolve(name).ok()?;
        let note = target.note.filter(|n| !n.ends_with('/'))?;
        let path = memory_dir(&target.store).join(note_relpath(&note).ok()?);
        (!path.is_dir() && !path.with_extension("").is_dir()).then_some(path)
    }

    /// `view`: no name is the full index; a folder (`tui/` or `tui`) lists its
    /// notes; a note returns its content; `project:<slug>` that project's index.
    pub async fn view(&self, name: Option<&str>) -> Result<String, String> {
        let Some(name) = name.map(str::trim).filter(|n| !n.is_empty()) else {
            return Ok(self.full_index());
        };
        let target = self.resolve(name)?;
        let Some(note) = target.note else {
            let index = project_index(&target.store);
            return Ok(if index.is_empty() {
                "(no memory notes)".to_string()
            } else {
                index
            });
        };
        let folder = note.trim_end_matches('/');
        let is_folder = note.ends_with('/')
            || (!folder.contains('/') && memory_dir(&target.store).join(folder).is_dir());
        if is_folder {
            let lines: Vec<String> = folder_entries(&target.store, folder)
                .iter()
                .map(|e| e.line(&target.prefix))
                .collect();
            return Ok(if lines.is_empty() {
                format!("(no listed notes in {folder}/)")
            } else {
                lines.join("\n")
            });
        }
        read(&target.store, &note).await
    }

    /// Every listed note and pointer, with no budget: what `view` with no name
    /// returns when the in-prompt index had to cut some.
    fn full_index(&self) -> String {
        let mut sections = Vec::new();
        let project: Vec<String> = entries(self.store).iter().map(|e| e.line("")).collect();
        if !project.is_empty() {
            sections.push(format!("## This project\n\n{}", project.join("\n")));
        }
        if let Some(home) = self.home {
            let user: Vec<String> = entries(home).iter().map(|e| e.line(USER_PREFIX)).collect();
            if !user.is_empty() {
                sections.push(format!("## User notes (all projects)\n\n{}", user.join("\n")));
            }
            if self.cross_project {
                let others: Vec<String> = project_pointers(home, Some(self.store))
                    .iter()
                    .map(pointer_line)
                    .collect();
                if !others.is_empty() {
                    sections.push(format!("## Other projects (read-only)\n\n{}", others.join("\n")));
                }
            }
        }
        let archived = archived_count(self.store);
        if archived > 0 {
            sections.push(format!(
                "{archived} archived (status: done) note(s) are not listed; `search` finds them."
            ));
        }
        if sections.is_empty() {
            return "(no memory notes)".to_string();
        }
        sections.join("\n\n")
    }

    /// `search`: case-insensitive keyword match over titles and bodies of this
    /// project's and the user's notes, archived ones included. Every word of
    /// `query` must appear in the note. Returns names and matching lines.
    pub fn search(&self, query: &str) -> Result<String, String> {
        let words: Vec<String> = query
            .split_whitespace()
            .map(str::to_lowercase)
            .collect();
        if words.is_empty() {
            return Err("ERROR: search needs a non-empty query".to_string());
        }
        let mut stores: Vec<(&Path, &str)> = vec![(self.store, "")];
        if let Some(home) = self.home {
            stores.push((home, USER_PREFIX));
        }
        let mut out: Vec<String> = Vec::new();
        let mut notes = 0usize;
        for (store, prefix) in stores {
            for note in scan(store) {
                let haystack = format!("{}\n{}", note.name, note.body).to_lowercase();
                if !words.iter().all(|w| haystack.contains(w.as_str())) {
                    continue;
                }
                notes += 1;
                let archived = if note.done { " (archived)" } else { "" };
                out.push(format!("`{prefix}{}`{archived} - {}", note.name, note.title));
                for line in note.body.lines().map(str::trim) {
                    let lower = line.to_lowercase();
                    if !line.is_empty() && words.iter().any(|w| lower.contains(w.as_str())) {
                        let cut: String = line.chars().take(160).collect();
                        out.push(format!("    {cut}"));
                    }
                }
            }
        }
        if notes == 0 {
            return Ok(format!("No notes match '{query}'."));
        }
        let total = out.len();
        out.truncate(MAX_SEARCH_HITS);
        if total > MAX_SEARCH_HITS {
            out.push(format!("... {} more matching lines; narrow the query", total - MAX_SEARCH_HITS));
        }
        Ok(out.join("\n"))
    }

    /// `write`: create or overwrite a note in the current project or the user
    /// scope, `title` as its first line. A `title` already leading `content`
    /// is not repeated. Returns the result line, with a warning when the
    /// in-prompt index is near or over its budget.
    pub async fn write(&self, name: &str, title: Option<&str>, content: &str) -> Result<String, String> {
        let (store, note, prefix) = self.writable(name)?;
        let content = with_title(title, content);
        let file = write(&store, &note, &content).await?;
        if let Some(home) = self.home {
            write_root_index(home, self.cross_project);
        }
        Ok(format!(
            "Wrote {} bytes to memory/{prefix}{file}{}",
            content.len(),
            self.budget_note()
        ))
    }

    /// `edit`: replace the one exact occurrence of `old` with `new`.
    pub async fn edit(&self, name: &str, old: &str, new: &str) -> Result<String, String> {
        if old.is_empty() {
            return Err("ERROR: `old` must not be empty".to_string());
        }
        let (store, note, prefix) = self.writable(name)?;
        let path = target(&store, &note)?;
        let current = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| format!("ERROR: {e}"))?;
        match current.matches(old).count() {
            0 => return Err(format!("ERROR: `old` not found in '{name}'")),
            1 => {}
            n => {
                return Err(format!(
                    "ERROR: `old` matches {n} times in '{name}'; include more context to make it unique"
                ))
            }
        }
        let updated = current.replacen(old, new, 1);
        write(&store, &note, &updated).await?;
        if let Some(home) = self.home {
            write_root_index(home, self.cross_project);
        }
        let archived = if is_done(&updated) && !is_done(&current) {
            " (archived: status: done)"
        } else {
            ""
        };
        Ok(format!("Edited memory/{prefix}{}{archived}", canonical(&note)))
    }

    /// `delete`: remove a note and its index row. Deleting a missing note is
    /// reported, not an error, so a repeated tidy does not fail.
    pub async fn delete(&self, name: &str) -> Result<String, String> {
        let (store, note, prefix) = self.writable(name)?;
        let existed = target(&store, &note)?.is_file();
        delete(&store, &note).await?;
        if let Some(home) = self.home {
            write_root_index(home, self.cross_project);
        }
        Ok(if existed {
            format!("Deleted memory/{prefix}{}", canonical(&note))
        } else {
            format!("No note '{name}' to delete")
        })
    }

    /// `move`: rename `name` to `to` (see [`rename`]). Both must be in the
    /// same writable scope: a move between this project and `user:` is a
    /// `write` there and a `delete` here.
    pub async fn rename(&self, name: &str, to: &str) -> Result<String, String> {
        let (store, note, prefix) = self.writable(name)?;
        let (to_store, to_note, _) = self.writable(to)?;
        if to_store != store {
            return Err(format!(
                "ERROR: '{name}' and '{to}' are in different scopes; `write` the note there and `delete` it here"
            ));
        }
        let file = rename(&store, &note, &to_note).await?;
        if let Some(home) = self.home {
            write_root_index(home, self.cross_project);
        }
        Ok(format!(
            "Moved memory/{prefix}{} to memory/{prefix}{}",
            canonical(&note),
            file.trim_end_matches(".md")
        ))
    }

    /// `" Index: N/B tokens ..."` when the index is near or past its budget,
    /// else empty.
    fn budget_note(&self) -> String {
        let used = self.index_tokens();
        if used * 100 < INDEX_BUDGET_TOKENS * NEAR_BUDGET_PERCENT {
            return String::new();
        }
        format!(
            "\nNote: the memory index is ~{used} tokens against a {INDEX_BUDGET_TOKENS}-token budget; overflow is cut from the prompt. Archive finished work (`status: done`), merge duplicates, or move related notes into a folder."
        )
    }

    /// Estimated tokens of the full, unbudgeted index section.
    pub fn index_tokens(&self) -> usize {
        estimate_tokens(&format!("{PROMPT_HEADER}\n\n{}", self.full_index()))
    }

    /// Whether the unbudgeted index no longer fits the prompt budget: the
    /// signal auto-tidy runs on.
    pub fn over_budget(&self) -> bool {
        self.index_tokens() > INDEX_BUDGET_TOKENS
    }

    /// A cheap stamp of this project's and the user's notes, from file
    /// metadata alone (name, size, mtime; nothing is read): equal stamps mean
    /// [`Self::over_budget`] would answer as it did before, so a caller that
    /// asks every turn only pays for the full index when a note changed.
    /// Other projects are not stamped: they only add one pointer line each.
    pub fn stamp(&self) -> u64 {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        stamp_store(self.store, &mut h);
        if let Some(home) = self.home {
            stamp_store(home, &mut h);
        }
        self.cross_project.hash(&mut h);
        h.finish()
    }

    /// The list of `user:`/project notes with names and hashes, used to tell
    /// what changed between two points. See [`Self::fingerprint`].
    pub fn fingerprint(&self) -> BTreeMap<String, u64> {
        let mut out = BTreeMap::new();
        note_hashes(self.store, "", &mut out);
        if let Some(home) = self.home {
            note_hashes(home, USER_PREFIX, &mut out);
        }
        out
    }

    /// The prompt's memory section, never over [`INDEX_BUDGET_TOKENS`].
    ///
    /// Root user notes and other-project pointers first (they are few and they
    /// orient), then this project's notes by most recent use, folders collapsed
    /// to one line. Whatever does not fit becomes one overflow line pointing at
    /// `memory view`. Rendered from the notes, not from the `MEMORY.md` files,
    /// so a stale or hand-edited index can never reach the model. `None` when
    /// there is nothing to show.
    pub fn prompt_block(&self) -> Option<String> {
        let mut user: Vec<String> = Vec::new();
        let mut others: Vec<String> = Vec::new();
        if let Some(home) = self.home {
            user = entries(home).iter().map(|e| e.line(USER_PREFIX)).collect();
            if self.cross_project {
                others = project_pointers(home, Some(self.store))
                    .iter()
                    .map(pointer_line)
                    .collect();
            }
        }
        let project = entries(self.store);
        if user.is_empty() && others.is_empty() && project.is_empty() {
            return None;
        }

        let budget = INDEX_BUDGET_TOKENS * CHARS_PER_TOKEN;
        // Reserved for the overflow line, so adding it can never break the budget.
        let reserve = 120;
        let mut used = PROMPT_HEADER.chars().count();
        let fits = |line: &str, used: &mut usize| {
            let cost = line.chars().count() + 1;
            if *used + cost + reserve > budget {
                return false;
            }
            *used += cost;
            true
        };
        let mut dropped: Vec<&Entry> = Vec::new();
        let mut dropped_lines = 0usize;
        let mut take = |lines: Vec<String>, header: &str, used: &mut usize| -> Vec<String> {
            let mut kept = Vec::new();
            if lines.is_empty() || !fits(header, used) {
                dropped_lines += lines.len();
                return kept;
            }
            for line in lines {
                if fits(&line, used) {
                    kept.push(line);
                } else {
                    dropped_lines += 1;
                }
            }
            kept
        };
        let user_header = "\n## User notes (all projects)\n";
        let others_header = "\n## Other projects (read-only: `view` `project:<slug>`)\n";
        let user = take(user, user_header, &mut used);
        let others = take(others, others_header, &mut used);
        let project_header = "\n## This project\n";
        let mut project_lines: Vec<String> = Vec::new();
        if !project.is_empty() && fits(project_header, &mut used) {
            for entry in &project {
                let line = entry.line("");
                if fits(&line, &mut used) {
                    project_lines.push(line);
                } else {
                    dropped.push(entry);
                }
            }
        } else {
            dropped.extend(project.iter());
        }

        let mut sections = vec![PROMPT_HEADER.to_string()];
        if !project_lines.is_empty() {
            sections.push(format!("## This project\n\n{}", project_lines.join("\n")));
        }
        if !user.is_empty() {
            sections.push(format!("## User notes (all projects)\n\n{}", user.join("\n")));
        }
        if !others.is_empty() {
            sections.push(format!(
                "## Other projects (read-only: `view` `project:<slug>`)\n\n{}",
                others.join("\n")
            ));
        }
        let more_notes: usize = dropped
            .iter()
            .map(|e| match e {
                Entry::Note { .. } => 1,
                Entry::Folder { notes, .. } => *notes,
            })
            .sum::<usize>()
            + dropped_lines;
        if more_notes > 0 {
            let folders = dropped
                .iter()
                .filter(|e| matches!(e, Entry::Folder { .. }))
                .count();
            sections.push(format!(
                "+{more_notes} more ({folders} folders) not shown: `memory` op `view` lists everything"
            ));
        }
        Some(sections.join("\n\n"))
    }
}

/// `content` led by `title` as its first body line, after any front matter.
/// A content that already opens with the title (or a heading of it) is kept.
fn with_title(title: Option<&str>, content: &str) -> String {
    let Some(title) = title.map(str::trim).filter(|t| !t.is_empty()) else {
        return content.to_string();
    };
    let title = title.lines().next().unwrap_or_default().trim();
    let (front, body) = split_front_matter(content);
    if title_of(body) == title_of(title) {
        return content.to_string();
    }
    let body = format!("{title}\n\n{}", body.trim_start_matches('\n'));
    if front.is_empty() {
        body
    } else {
        format!("---\n{}\n---\n{body}", front.join("\n"))
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

    fn put(store: &Path, name: &str, body: &str) {
        let path = memory_dir(store).join(note_relpath(name).unwrap());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
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
    async fn list_is_sorted_and_ignores_non_markdown_and_the_side_files() {
        let root = unique_root();
        write(&root, "b", "b").await.unwrap();
        write(&root, "a", "a").await.unwrap();
        std::fs::write(memory_dir(&root).join("notes.txt"), "ignored").unwrap();
        assert!(memory_dir(&root).join(META_FILE).is_file(), "writes are timed");

        assert_eq!(list(&root).await, vec!["a", "b"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn folders_hold_one_level_of_notes() {
        let root = unique_root();
        assert_eq!(write(&root, "tui/scroll", "Scroll").await.unwrap(), "tui/scroll.md");
        assert_eq!(read(&root, "tui/scroll").await.unwrap(), "Scroll");
        assert_eq!(list(&root).await, vec!["tui/scroll"]);
        delete(&root, "tui/scroll").await.unwrap();
        assert!(!memory_dir(&root).join("tui").exists(), "an emptied folder goes too");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn traversal_names_are_rejected() {
        let root = unique_root();
        for bad in ["../escape", "a/b/c", "..", "", ".", ".hidden", "a/.x", "a\\b", "/abs"] {
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

    #[tokio::test]
    async fn a_read_is_timed_in_the_side_file_and_leaves_the_mtime_alone() {
        let root = unique_root();
        put(&root, "fact", "A fact.");
        let before = mtime_ms(&memory_dir(&root).join("fact.md"));
        read(&root, "fact").await.unwrap();
        assert_eq!(mtime_ms(&memory_dir(&root).join("fact.md")), before);
        assert!(load_meta(&root).unwrap().notes["fact"].read_ms.is_some());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn catalog_lists_titles_and_skips_archived_notes() {
        let root = unique_root();
        put(&root, "decisions", "# Decisions\nWe use Yarn not npm.");
        put(&root, "prefs", "Keep it minimal.");
        put(&root, "old", "---\nstatus: done\n---\nShipped in 0.8.");
        std::fs::write(memory_dir(&root).join("notes.txt"), "ignored").unwrap();

        let notes = catalog(&root);
        let named: Vec<(&str, &str)> = notes
            .iter()
            .map(|n| (n.name.as_str(), n.summary.as_str()))
            .collect();
        assert_eq!(named, vec![("decisions", "Decisions"), ("prefs", "Keep it minimal.")]);
        assert!(notes.iter().all(|n| n.mtime_ms > 0), "{notes:?}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn catalog_missing_dir_is_empty() {
        let root = unique_root();
        assert!(catalog(&root).is_empty());
    }

    #[test]
    fn front_matter_and_titles_parse() {
        assert!(is_done("---\nstatus: done\n---\nx"));
        assert!(is_done("---\ntags: a\nstatus: \"Done\"\n---\nx"));
        assert!(!is_done("status: done\nnot front matter"));
        assert!(!is_done("---\nstatus: active\n---\nx"));
        assert_eq!(title_of("---\nstatus: done\n---\n\n## Title here\nbody"), "Title here");
        assert_eq!(title_of(&"y".repeat(300)).chars().count(), MAX_TITLE_CHARS);
        assert_eq!(set_status_done("Body"), "---\nstatus: done\n---\nBody");
        assert_eq!(
            set_status_done("---\nstatus: open\nx: 1\n---\nBody"),
            "---\nx: 1\nstatus: done\n---\nBody"
        );
    }

    #[test]
    fn a_title_leads_the_note_once() {
        assert_eq!(with_title(Some("Build"), "Use yarn."), "Build\n\nUse yarn.");
        assert_eq!(with_title(Some("Build"), "# Build\nUse yarn."), "# Build\nUse yarn.");
        assert_eq!(with_title(None, "Use yarn."), "Use yarn.");
        assert_eq!(
            with_title(Some("Old"), "---\nstatus: done\n---\nGone."),
            "---\nstatus: done\n---\nOld\n\nGone."
        );
    }

    fn scopes_fixture() -> (PathBuf, PathBuf, PathBuf) {
        let home = unique_root();
        let current = projects_dir(&home).join("app-1");
        let other = projects_dir(&home).join("lib-2");
        std::fs::create_dir_all(&current).unwrap();
        put(&other, "api", "Lib API is frozen.");
        std::fs::write(other.join("project.json"), "{\"path\": \"/src/lib\"}").unwrap();
        (home, current, other)
    }

    #[tokio::test]
    async fn write_generates_the_store_index_and_delete_removes_it() {
        let root = unique_root();
        write(&root, "prefs", "# Prefs\nKeep it minimal.").await.unwrap();
        let index = std::fs::read_to_string(root.join(INDEX_FILE)).unwrap();
        assert!(index.contains("- `prefs` - Prefs"), "{index}");

        delete(&root, "prefs").await.unwrap();
        assert!(!root.join(INDEX_FILE).exists(), "an empty store has no index");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn every_op_routes_through_scoped_names() {
        let (home, current, _other) = scopes_fixture();
        let scopes = Scopes {
            store: &current,
            home: Some(&home),
            cross_project: true,
        };

        let w = scopes.write("local", Some("Local fact"), "Here.").await.unwrap();
        assert!(w.starts_with("Wrote") && w.contains("memory/local.md"), "{w}");
        let u = scopes.write("user:prefs", Some("Prefs"), "Everywhere.").await.unwrap();
        assert!(u.contains("memory/user:prefs.md"), "{u}");
        assert_eq!(scopes.view(Some("local")).await.unwrap(), "Local fact\n\nHere.");
        assert_eq!(scopes.view(Some("user:prefs")).await.unwrap(), "Prefs\n\nEverywhere.");

        // edit: exact, unique match only.
        scopes.edit("local", "Here.", "There.").await.unwrap();
        assert!(scopes.view(Some("local")).await.unwrap().ends_with("There."));
        assert!(scopes.edit("local", "missing", "x").await.unwrap_err().contains("not found"));
        scopes.write("dup", None, "a a").await.unwrap();
        assert!(scopes.edit("dup", "a", "b").await.unwrap_err().contains("2 times"));

        // search: titles and bodies, both scopes.
        let hits = scopes.search("everywhere").unwrap();
        assert!(hits.contains("`user:prefs` - Prefs"), "{hits}");
        assert!(hits.contains("    Everywhere."), "{hits}");
        assert!(scopes.search("nothing-like-this").unwrap().starts_with("No notes match"));

        // delete.
        assert!(scopes.delete("dup").await.unwrap().starts_with("Deleted"));
        assert!(scopes.delete("dup").await.unwrap().starts_with("No note"));

        // Another project is readable, index and note, but never writable.
        assert!(scopes.view(Some("project:lib-2")).await.unwrap().contains("`api`"));
        assert_eq!(scopes.view(Some("project:lib-2/api")).await.unwrap(), "Lib API is frozen.");
        for op in [
            scopes.write("project:lib-2/api", None, "x").await,
            scopes.edit("project:lib-2/api", "Lib", "x").await,
            scopes.delete("project:lib-2/api").await,
        ] {
            assert!(op.unwrap_err().contains("read-only"));
        }
        assert!(scopes.view(Some("project:nope/api")).await.is_err());
        assert!(scopes.view(Some("project:../x/api")).await.is_err());

        // The root index lists user notes and points at projects with memory.
        let root = std::fs::read_to_string(home.join(INDEX_FILE)).unwrap();
        assert!(root.contains("- `user:prefs` - Prefs"), "{root}");
        assert!(root.contains("- `project:lib-2` - /src/lib (1 note)"), "{root}");
        assert!(root.contains("- `project:app-1`"), "{root}");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[tokio::test]
    async fn archived_notes_are_readable_and_searchable_but_never_listed() {
        let root = unique_root();
        let scopes = Scopes::store_only(&root);
        scopes.write("pr-1", Some("PR 1 merged"), "Shipped the parser.").await.unwrap();
        let edited = scopes.edit("pr-1", "PR 1 merged", "---\nstatus: done\n---\nPR 1 merged").await.unwrap();
        assert!(edited.contains("archived"), "{edited}");

        assert!(scopes.prompt_block().is_none(), "nothing listed");
        assert!(catalog(&root).is_empty());
        assert!(scopes.view(None).await.unwrap().contains("1 archived"));
        assert!(scopes.view(Some("pr-1")).await.unwrap().contains("Shipped the parser."));
        assert!(scopes.search("parser").unwrap().contains("`pr-1` (archived)"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn a_folder_views_as_its_notes_and_collapses_in_the_index() {
        let root = unique_root();
        let scopes = Scopes::store_only(&root);
        scopes.write("tui/scroll", Some("Scroll fix"), "x").await.unwrap();
        scopes.write("tui/theme", Some("Theme"), "y").await.unwrap();
        let listed = scopes.view(Some("tui/")).await.unwrap();
        assert_eq!(listed, "- `tui/scroll` - Scroll fix\n- `tui/theme` - Theme");
        assert_eq!(scopes.view(Some("tui")).await.unwrap(), listed);
        let block = scopes.prompt_block().unwrap();
        assert!(block.contains("- `tui/` (2 notes)"), "{block}");
        assert!(!block.contains("Scroll fix"), "{block}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn cross_project_off_hides_and_refuses_other_projects() {
        let (home, current, _other) = scopes_fixture();
        let scopes = Scopes {
            store: &current,
            home: Some(&home),
            cross_project: false,
        };
        assert!(scopes.view(Some("project:lib-2/api")).await.unwrap_err().contains("cross-project"));
        // The current project stays addressable by its own slug.
        scopes.write("mine", None, "ok").await.unwrap();
        assert_eq!(scopes.view(Some("project:app-1/mine")).await.unwrap(), "ok");
        assert!(!scopes.prompt_block().unwrap().contains("lib-2"));
        assert!(!root_index(&home, false).contains("lib-2"));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[tokio::test]
    async fn a_store_only_scope_has_no_user_or_project_names() {
        let root = unique_root();
        let scopes = Scopes::store_only(&root);
        assert!(scopes.write("user:x", None, "y").await.is_err());
        assert!(scopes.view(Some("project:a/b")).await.is_err());
        scopes.write("x", None, "y").await.unwrap();
        assert_eq!(list(&root).await, vec!["x"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn prompt_block_lists_this_project_then_the_user_then_pointers() {
        let (home, current, _other) = scopes_fixture();
        put(&current, "build", "Use yarn.");
        put(&home, "style", "Be terse.");

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

    /// The acceptance fixture: 120+ notes stay within the token budget, the
    /// most recently used ones are the ones listed, and the rest collapse to
    /// one overflow line.
    #[test]
    fn a_large_store_stays_within_the_budget() {
        let (home, current, _other) = scopes_fixture();
        for i in 0..130 {
            put(
                &current,
                &format!("note-{i:03}"),
                &format!("Fact number {i}: a reasonably long title describing finished work on a merged pull request"),
            );
        }
        for i in 0..20 {
            put(&current, &format!("pr/n{i}"), "A PR note.");
        }
        for i in 0..8 {
            put(&home, &format!("pref-{i}"), "A user-wide preference that applies everywhere.");
        }
        // The newest note by use sorts first.
        touch_meta(&current, "note-000", |m| m.read_ms = Some(u64::MAX / 2));
        let scopes = Scopes {
            store: &current,
            home: Some(&home),
            cross_project: true,
        };
        let block = scopes.prompt_block().unwrap();
        let tokens = estimate_tokens(&block);
        assert!(tokens <= INDEX_BUDGET_TOKENS, "{tokens} tokens:\n{block}");
        assert!(scopes.over_budget(), "the unbudgeted index does not fit");
        assert!(block.contains("- `note-000` -"), "most recent use is kept");
        assert!(block.contains("- `user:pref-0`"), "user notes come first");
        assert!(block.contains("`project:lib-2`"), "pointers come first");
        let overflow = block.lines().last().unwrap();
        assert!(overflow.starts_with('+') && overflow.contains("`view`"), "{overflow}");
        assert_eq!(block, scopes.prompt_block().unwrap(), "deterministic bytes");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[tokio::test]
    async fn write_warns_when_the_index_nears_its_budget() {
        let root = unique_root();
        let scopes = Scopes::store_only(&root);
        let quiet = scopes.write("one", Some("One"), "x").await.unwrap();
        assert!(!quiet.contains("budget"), "{quiet}");
        for i in 0..80 {
            put(&root, &format!("n{i}"), &"A long enough title for the index row ".repeat(2));
        }
        let loud = scopes.write("two", Some("Two"), "y").await.unwrap();
        assert!(loud.contains("token budget"), "{loud}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn migration_archives_finished_notes_once_and_loses_none() {
        let root = unique_root();
        put(&root, "live", "Still true.");
        put(&root, "merged", "DONE. PR 9 merged.");
        put(&root, "stale", "OBSOLETE as of 2026-09-25: replaced.");
        put(&root, "tui/x", "Folder note.");
        migrate(&root);
        assert_eq!(scan(&root).len(), 4, "no note is lost");
        assert!(is_done(&std::fs::read_to_string(memory_dir(&root).join("merged.md")).unwrap()));
        assert!(is_done(&std::fs::read_to_string(memory_dir(&root).join("stale.md")).unwrap()));
        let live = std::fs::read_to_string(memory_dir(&root).join("live.md")).unwrap();
        assert_eq!(live, "Still true.", "live notes are untouched");
        let names: Vec<String> = catalog(&root).into_iter().map(|e| e.name).collect();
        assert_eq!(names, vec!["live", "tui/x"]);
        assert!(load_meta(&root).unwrap().notes.contains_key("tui/x"), "recency is seeded");

        // Once: a note marked DONE later is the agent's business, not the migration's.
        put(&root, "later", "DONE. later");
        migrate(&root);
        assert!(!is_done(&std::fs::read_to_string(memory_dir(&root).join("later.md")).unwrap()));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn concurrent_recency_updates_are_all_kept_and_leave_no_temp_file() {
        let root = unique_root();
        std::fs::create_dir_all(memory_dir(&root)).unwrap();
        let threads: Vec<_> = (0..8)
            .map(|t| {
                let root = root.clone();
                std::thread::spawn(move || {
                    for i in 0..25 {
                        touch_meta(&root, &format!("n{t}-{i}"), |m| m.read_ms = Some(1));
                    }
                })
            })
            .collect();
        threads.into_iter().for_each(|t| t.join().unwrap());
        let meta = load_meta(&root).expect("parses");
        assert_eq!(meta.notes.len(), 200, "no update was lost");
        let leftovers: Vec<_> = std::fs::read_dir(memory_dir(&root))
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n != META_FILE)
            .collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn a_corrupt_side_file_is_never_overwritten_with_empty_recency() {
        let root = unique_root();
        put(&root, "a", "one");
        let path = memory_dir(&root).join(META_FILE);
        std::fs::write(&path, "{\"notes\": {\"a\": {\"read_ms\": 5").unwrap();
        read(&root, "a").await.unwrap();
        write(&root, "b", "two").await.unwrap();
        delete(&root, "b").await.unwrap();
        rename(&root, "a", "c").await.unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "{\"notes\": {\"a\": {\"read_ms\": 5",
            "left for a human to repair, not wiped"
        );
        assert!(scan(&root).iter().any(|n| n.name == "c"), "the ops themselves still work");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_stamp_moves_with_the_notes_but_not_with_recency() {
        let root = unique_root();
        put(&root, "a", "one");
        let scopes = Scopes::store_only(&root);
        let before = scopes.stamp();
        assert_eq!(scopes.stamp(), before, "stable");
        touch_meta(&root, "a", |m| m.read_ms = Some(42));
        assert_eq!(scopes.stamp(), before, "a read changes nothing that counts");
        put(&root, "b", "two");
        assert_ne!(scopes.stamp(), before, "a new note does");
        let with_b = scopes.stamp();
        put(&root, "b", "two, longer");
        assert_ne!(scopes.stamp(), with_b, "so does a rewrite");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_fingerprint_changes_with_content_and_archiving() {
        let root = unique_root();
        put(&root, "a", "one");
        let scopes = Scopes::store_only(&root);
        let first = scopes.fingerprint();
        put(&root, "a", "---\nstatus: done\n---\none");
        assert_ne!(scopes.fingerprint(), first);
        let _ = std::fs::remove_dir_all(&root);
    }
}
