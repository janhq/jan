//! Workspace abstraction for the Jan agent.
//!
//! A **workspace** is the top-level scope in which an agent operates. It owns:
//!   - identity & metadata (name, id, creation time)
//!   - configuration overrides (model, provider, system prompt additions)
//!   - a root directory for inner components to store state
//!
//! ## Workspace resolution (Claude Code pattern)
//!
//! When no explicit `--workspace` is given, the **current working directory**
//! is used as the workspace identity.  State is stored centrally at:
//!
//! ```text
//! <jan_data_folder>/workspaces/<hash-of-cwd>/
//! ```
//!
//! This avoids scattering `.jan/` directories in every project while still
//! giving each project its own isolated state.  When `--workspace <name>` is
//! given explicitly, the named workspace is used instead (for robots/cloud).
//!
//! ## Design principles
//! - **Trait-based** — swap implementations (filesystem, in-memory, cloud, …).
//! - **Desktop-independent** — lives in `tauri-plugin-agent`, not in the app.
//! - **Minimal core** — inner components extend, not bloat, the workspace.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

// ── Workspace metadata ──────────────────────────────────────────────────────

/// Persistent metadata for a workspace.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceMeta {
    pub id: String,
    pub name: String,
    /// The original directory path that this workspace was created from (CWD).
    /// `None` for explicitly named workspaces.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_dir: Option<String>,
    #[serde(default = "default_created")]
    pub created_at: String,
    #[serde(default)]
    pub description: String,
}

fn default_created() -> String {
    chrono_now()
}

fn chrono_now() -> String {
    // ISO-8601 UTC timestamp without pulling in the `chrono` crate.
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| format!("{}", d.as_secs()))
        .unwrap_or_else(|_| "0".into())
}

/// Per-workspace configuration overrides.
///
/// Every field is optional — `None` means "inherit from the global config".
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkspaceConfig {
    /// Override the default model id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    /// Override the API base URL.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_url: Option<String>,
    /// Extra text appended to the system prompt (e.g. project conventions).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt_extra: Option<String>,
    /// Host directories the sandbox may access.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mounts: Vec<PathBuf>,
}

// ── Workspace trait ─────────────────────────────────────────────────────────

/// Core workspace interface.
///
/// Implementations must be `Send + Sync` so the workspace can be shared across
/// async tasks (e.g. the agent loop and the TUI event loop).
pub trait Workspace: Send + Sync {
    /// Unique identifier for this workspace.
    fn id(&self) -> &str;

    /// Human-readable name.
    fn name(&self) -> &str;

    /// Root directory where this workspace stores its state.
    /// Inner components create subdirectories here (e.g. `threads/`, `memory/`).
    fn root(&self) -> &Path;

    /// Metadata snapshot.
    fn meta(&self) -> &WorkspaceMeta;

    /// Per-workspace configuration overrides.
    fn config(&self) -> &WorkspaceConfig;

    /// Text to inject into the agent's system prompt.
    ///
    /// The default implementation returns `system_prompt_extra` from the
    /// workspace config.  Override to aggregate context from inner components
    /// (memory files, project conventions, etc.).
    fn system_context(&self) -> Option<String> {
        self.config().system_prompt_extra.clone()
    }
}

// ── Workspace manager trait ─────────────────────────────────────────────────

/// Manages the lifecycle of workspaces (create, open, list, delete).
///
/// This is also a trait so the storage backend can be swapped.
pub trait WorkspaceManager: Send + Sync {
    /// Create a new named workspace.
    fn create(&self, name: &str, config: WorkspaceConfig) -> Result<Box<dyn Workspace>, String>;

    /// Open an existing workspace by ID.
    fn open(&self, id: &str) -> Result<Box<dyn Workspace>, String>;

    /// Resolve a workspace for the given working directory.
    ///
    /// If a workspace already exists for this path, it is opened.
    /// Otherwise a new one is created automatically.
    fn resolve_cwd(&self, cwd: &Path) -> Result<Box<dyn Workspace>, String>;

    /// List all workspaces (summary only).
    fn list(&self) -> Result<Vec<WorkspaceMeta>, String>;

    /// Delete a workspace and all its contents.
    fn delete(&self, id: &str) -> Result<(), String>;
}

// ── Filesystem implementation ───────────────────────────────────────────────

const META_FILE: &str = "workspace.json";
const CONFIG_FILE: &str = "config.json";

/// A workspace backed by a directory on the local filesystem.
///
/// ```text
/// <root>/
/// ├── workspace.json   # WorkspaceMeta
/// ├── config.json      # WorkspaceConfig
/// ├── threads/         # (created by thread component)
/// ├── memory/          # (created by memory component)
/// └── …
/// ```
pub struct FsWorkspace {
    meta:   WorkspaceMeta,
    config: WorkspaceConfig,
    root:   PathBuf,
}

impl Workspace for FsWorkspace {
    fn id(&self)     -> &str             { &self.meta.id }
    fn name(&self)   -> &str             { &self.meta.name }
    fn root(&self)   -> &Path            { &self.root }
    fn meta(&self)   -> &WorkspaceMeta   { &self.meta }
    fn config(&self) -> &WorkspaceConfig { &self.config }
}

/// Manages workspaces stored as subdirectories under a root path.
///
/// ```text
/// <jan_data_folder>/workspaces/
/// ├── -Users-alice-code-myproject/     # CWD-derived (hashed path)
/// │   ├── workspace.json
/// │   └── config.json
/// ├── my-robot/                         # Explicitly named
/// │   ├── workspace.json
/// │   └── config.json
/// └── …
/// ```
pub struct FsWorkspaceManager {
    root: PathBuf,
}

impl FsWorkspaceManager {
    /// Create a manager rooted at `workspaces_dir`.
    ///
    /// The directory is created if it doesn't exist.
    pub fn new(workspaces_dir: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&workspaces_dir)
            .map_err(|e| format!("create workspaces dir: {e}"))?;
        Ok(Self { root: workspaces_dir })
    }

    /// The root directory where all workspaces live.
    pub fn root(&self) -> &Path {
        &self.root
    }
}

impl WorkspaceManager for FsWorkspaceManager {
    fn create(&self, name: &str, config: WorkspaceConfig) -> Result<Box<dyn Workspace>, String> {
        let id = sanitize_id(name);
        let ws_dir = self.root.join(&id);

        if ws_dir.exists() {
            return Err(format!("workspace '{id}' already exists"));
        }

        std::fs::create_dir_all(&ws_dir)
            .map_err(|e| format!("create workspace dir: {e}"))?;

        let meta = WorkspaceMeta {
            id: id.clone(),
            name: name.to_string(),
            source_dir: None,
            created_at: chrono_now(),
            description: String::new(),
        };

        write_json(&ws_dir.join(META_FILE), &meta)?;
        write_json(&ws_dir.join(CONFIG_FILE), &config)?;

        Ok(Box::new(FsWorkspace { meta, config, root: ws_dir }))
    }

    fn open(&self, id: &str) -> Result<Box<dyn Workspace>, String> {
        let ws_dir = self.root.join(id);
        let meta_path = ws_dir.join(META_FILE);

        if !meta_path.exists() {
            return Err(format!("workspace '{id}' not found"));
        }

        let meta: WorkspaceMeta = read_json(&meta_path)?;

        let config_path = ws_dir.join(CONFIG_FILE);
        let config: WorkspaceConfig = if config_path.exists() {
            read_json(&config_path)?
        } else {
            WorkspaceConfig::default()
        };

        Ok(Box::new(FsWorkspace { meta, config, root: ws_dir }))
    }

    fn resolve_cwd(&self, cwd: &Path) -> Result<Box<dyn Workspace>, String> {
        let id = path_to_id(cwd);
        let ws_dir = self.root.join(&id);
        let meta_path = ws_dir.join(META_FILE);

        if meta_path.exists() {
            return self.open(&id);
        }

        // Auto-create workspace for this CWD
        std::fs::create_dir_all(&ws_dir)
            .map_err(|e| format!("create workspace dir: {e}"))?;

        // Use the last directory component as human-readable name
        let name = cwd
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| id.clone());

        let meta = WorkspaceMeta {
            id: id.clone(),
            name,
            source_dir: Some(cwd.to_string_lossy().to_string()),
            created_at: chrono_now(),
            description: String::new(),
        };

        let config = WorkspaceConfig::default();

        write_json(&ws_dir.join(META_FILE), &meta)?;
        write_json(&ws_dir.join(CONFIG_FILE), &config)?;

        Ok(Box::new(FsWorkspace { meta, config, root: ws_dir }))
    }

    fn list(&self) -> Result<Vec<WorkspaceMeta>, String> {
        let mut results = Vec::new();
        let entries = std::fs::read_dir(&self.root)
            .map_err(|e| format!("read workspaces dir: {e}"))?;

        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_dir() { continue; }

            let meta_path = path.join(META_FILE);
            if let Ok(meta) = read_json::<WorkspaceMeta>(&meta_path) {
                results.push(meta);
            }
        }

        results.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(results)
    }

    fn delete(&self, id: &str) -> Result<(), String> {
        let ws_dir = self.root.join(id);
        if !ws_dir.exists() {
            return Err(format!("workspace '{id}' not found"));
        }
        std::fs::remove_dir_all(&ws_dir)
            .map_err(|e| format!("delete workspace: {e}"))
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/// Convert an absolute path to a filesystem-safe workspace ID.
///
/// Replaces path separators and special chars with hyphens, similar to
/// Claude Code's `~/.claude/projects/<hash-of-cwd>/` pattern but using a
/// readable encoding instead of an opaque hash.
///
/// `/Users/alice/code/my-project` → `-Users-alice-code-my-project`
pub fn path_to_id(path: &Path) -> String {
    let s = path.to_string_lossy();
    let raw: String = s
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();

    // Collapse consecutive hyphens
    let mut result = String::with_capacity(raw.len());
    let mut prev_hyphen = false;
    for c in raw.chars() {
        if c == '-' {
            if !prev_hyphen { result.push('-'); }
            prev_hyphen = true;
        } else {
            result.push(c);
            prev_hyphen = false;
        }
    }

    // Strip trailing hyphen
    if result.ends_with('-') {
        result.pop();
    }

    if result.is_empty() {
        "workspace".to_string()
    } else {
        result
    }
}

/// Turn a human-readable name into a filesystem-safe ID.
fn sanitize_id(name: &str) -> String {
    let raw: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();

    let mut result = String::with_capacity(raw.len());
    let mut prev_hyphen = true; // strip leading
    for c in raw.chars() {
        if c == '-' {
            if !prev_hyphen { result.push('-'); }
            prev_hyphen = true;
        } else {
            result.push(c);
            prev_hyphen = false;
        }
    }

    if result.ends_with('-') {
        result.pop();
    }

    if result.is_empty() {
        "workspace".to_string()
    } else {
        result
    }
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value)
        .map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(path, json)
        .map_err(|e| format!("write {}: {e}", path.display()))
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let data = std::fs::read_to_string(path)
        .map_err(|e| format!("read {}: {e}", path.display()))?;
    serde_json::from_str(&data)
        .map_err(|e| format!("parse {}: {e}", path.display()))
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_id() {
        assert_eq!(sanitize_id("My Project"), "my-project");
        assert_eq!(sanitize_id("hello---world"), "hello-world");
        assert_eq!(sanitize_id("  leading spaces  "), "leading-spaces");
        assert_eq!(sanitize_id("UPPER_case"), "upper_case");
        assert_eq!(sanitize_id("a/b/c"), "a-b-c");
        assert_eq!(sanitize_id(""), "workspace");
    }

    #[test]
    fn test_path_to_id() {
        assert_eq!(
            path_to_id(Path::new("/Users/alice/code/my-project")),
            "-Users-alice-code-my-project"
        );
        assert_eq!(
            path_to_id(Path::new("/home/bob/work")),
            "-home-bob-work"
        );
        // Windows-style (if ever)
        assert_eq!(
            path_to_id(Path::new("C:\\Users\\alice\\code")),
            "C-Users-alice-code"
        );
    }

    #[test]
    fn test_cwd_workspace_lifecycle() {
        let tmp = std::env::temp_dir().join(format!("jan-ws-cwd-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);

        let mgr = FsWorkspaceManager::new(tmp.clone()).unwrap();

        // Simulate CWD
        let fake_cwd = Path::new("/Users/alice/code/my-project");

        // First resolve: auto-creates
        let ws = mgr.resolve_cwd(fake_cwd).unwrap();
        assert_eq!(ws.name(), "my-project");
        assert_eq!(ws.meta().source_dir.as_deref(), Some("/Users/alice/code/my-project"));
        assert!(ws.root().exists());

        // Second resolve: opens existing
        let ws2 = mgr.resolve_cwd(fake_cwd).unwrap();
        assert_eq!(ws2.id(), ws.id());
        assert_eq!(ws2.name(), "my-project");

        // List shows it
        let list = mgr.list().unwrap();
        assert_eq!(list.len(), 1);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_named_workspace_lifecycle() {
        let tmp = std::env::temp_dir().join(format!("jan-ws-named-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);

        let mgr = FsWorkspaceManager::new(tmp.clone()).unwrap();

        // Create named workspace
        let ws = mgr.create("my-robot", WorkspaceConfig::default()).unwrap();
        assert_eq!(ws.id(), "my-robot");
        assert!(ws.meta().source_dir.is_none());

        // Open by ID
        let ws2 = mgr.open("my-robot").unwrap();
        assert_eq!(ws2.name(), "my-robot");

        // Delete
        mgr.delete("my-robot").unwrap();
        assert!(mgr.list().unwrap().is_empty());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_config_override() {
        let tmp = std::env::temp_dir().join(format!("jan-ws-cfg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);

        let mgr = FsWorkspaceManager::new(tmp.clone()).unwrap();
        let cfg = WorkspaceConfig {
            model_id: Some("claude-sonnet".into()),
            system_prompt_extra: Some("You are a code reviewer.".into()),
            ..Default::default()
        };

        let ws = mgr.create("reviewer", cfg).unwrap();
        assert_eq!(ws.config().model_id.as_deref(), Some("claude-sonnet"));
        assert_eq!(
            ws.system_context().as_deref(),
            Some("You are a code reviewer.")
        );

        // Re-open and verify persistence
        let ws2 = mgr.open("reviewer").unwrap();
        assert_eq!(ws2.config().model_id.as_deref(), Some("claude-sonnet"));

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_duplicate_create_fails() {
        let tmp = std::env::temp_dir().join(format!("jan-ws-dup-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);

        let mgr = FsWorkspaceManager::new(tmp.clone()).unwrap();
        mgr.create("dupe", WorkspaceConfig::default()).unwrap();
        let result = mgr.create("dupe", WorkspaceConfig::default());
        assert!(result.is_err());

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
