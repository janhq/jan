//! Plugin install/removal and marketplace search. A plugin is a directory
//! `.jan/agent/plugins/<name>/` cloned from a git repository, so installing
//! from GitHub (or any git host) is just `git clone`. No lockfile or registry
//! file: an installed plugin is a directory, removed by deleting it. Installing
//! never executes plugin code — a plugin carries skills (instructions) plus an
//! optional `plugin.toml` metadata manifest.
//!
//! A plugin's payload is discovered conventionally, so a repo needs no
//! manifest to be installable:
//!   - `skills/` — folder skills (`<name>/SKILL.md`) and flat `<name>.md`,
//!     the same layout as project skills
//!   - `SKILL.md` at the plugin root — a repo that is itself one skill
//!   - `plugin.toml` — optional metadata: `name`, `description`, `version`,
//!     `repo` (the canonical source URL, recorded at install for provenance)
//!
//! `[plugins] marketplace` in `agent.toml` points at a JSON index of community
//! plugins: `[{ "name", "description", "repo", "ref"? }]`. `install <name>`
//! resolves through it; `install <git-url>` skips it entirely.

use std::path::Path;
use std::process::Command;

use serde::Deserialize;

use crate::core::agent::project::PluginsSection;
use crate::core::agent::skills;

/// Shell metacharacters rejected in install specs. A spec is a git URL or a
/// marketplace name; anything else (including command substitution) is a
/// typo or an injection attempt, so it errors instead of being passed to a
/// shell. `:` `/` `#` `@` `-` `_` `.` are all fine — they appear in URLs.
const SHELL_METACHARS: &[char] = &[
    ';', '&', '|', '`', '$', '(', ')', '{', '}', '<', '>', '\\', '\n', '\r', '\t',
];

const USER_AGENT: &str = "jan-agent-plugin-manager";

/// An installed plugin, from its directory plus optional manifest.
#[derive(Debug, serde::Serialize, Clone)]
pub struct InstalledPlugin {
    pub name: String,
    pub description: String,
    pub version: String,
    pub repo: String,
    /// Number of skills the plugin contributes.
    pub skills: usize,
    /// Number of command prompt templates (`commands/**/*.md`).
    pub commands: usize,
    /// Number of agent definitions (`agents/**/*.md`).
    pub agents: usize,
}

/// A plugin available on the configured marketplace: JSON index entry.
#[derive(serde::Serialize, Deserialize, Clone)]
pub struct MarketEntry {
    pub name: String,
    pub description: String,
    pub repo: String,
    #[serde(default)]
    pub r#ref: Option<String>,
}

/// Optional metadata manifest at the plugin root. Every field is optional so
/// a repo without a manifest is still installable and listable.
#[derive(Debug, Default, Deserialize)]
struct Manifest {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    repo: Option<String>,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("ERROR: {e}"))
}

/// Read the project's `[plugins]` config; missing/malformed falls back to
/// defaults (no marketplace).
fn plugins_section(root: &Path) -> PluginsSection {
    crate::core::agent::project::load_agent_config(root)
        .ok()
        .map(|c| c.plugins)
        .unwrap_or_default()
}

/// Every installed plugin, sorted by display name. Staging directories from
/// interrupted installs are intentionally excluded.
pub(crate) fn installed(root: &Path) -> Vec<InstalledPlugin> {
    installed_entries(root)
        .into_iter()
        .map(|(_, plugin)| plugin)
        .collect()
}

/// Find an installed plugin by directory name or manifest name. Used by the
/// cli `/plugin` popup; the desktop lists plugins through `installed`.
#[cfg(feature = "cli")]
pub(crate) fn find_installed(root: &Path, query: &str) -> Option<(String, InstalledPlugin)> {
    let query = skills::safe_stem(query).ok()?;
    installed_entries(root)
        .into_iter()
        .find(|(directory, plugin)| directory == &query || plugin.name == query)
}

fn installed_entries(root: &Path) -> Vec<(String, InstalledPlugin)> {
    let dir = skills::plugins_dir(root);
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    // Scan each artifact kind once; per-plugin counts filter the shared lists
    // rather than re-walking the whole plugin tree per plugin.
    let all_skills = skills::discover_plugins(root);
    let all_commands = crate::core::agent::plugin_commands::discover(root);
    let mut out = Vec::new();
    for entry in rd.flatten() {
        let path = entry.path();
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let Some(directory) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if directory.starts_with(".installing-") {
            continue;
        }
        let manifest = read_manifest(&path);
        let plugin_skills = all_skills
            .iter()
            .filter(|e| e.plugin.as_deref() == Some(directory))
            .count();
        let plugin_commands = all_commands
            .iter()
            .filter(|e| e.plugin == directory)
            .count();
        let plugin_agents = crate::core::agent::subagent::count_plugin_agents(root, directory);
        out.push((
            directory.to_string(),
            InstalledPlugin {
                name: manifest.name.unwrap_or_else(|| directory.to_string()),
                description: manifest.description.unwrap_or_default(),
                version: manifest.version.unwrap_or_else(|| "0.0.0".to_string()),
                repo: manifest.repo.unwrap_or_default(),
                skills: plugin_skills,
                commands: plugin_commands,
                agents: plugin_agents,
            },
        ));
    }
    out.sort_by(|a, b| a.1.name.cmp(&b.1.name));
    out
}

fn read_manifest(root: &Path) -> Manifest {
    std::fs::read_to_string(root.join("plugin.toml"))
        .ok()
        .and_then(|raw| toml::from_str::<Manifest>(&raw).ok())
        .or_else(|| {
            std::fs::read_to_string(root.join(".claude-plugin/plugin.json"))
                .ok()
                .and_then(|raw| serde_json::from_str::<Manifest>(&raw).ok())
        })
        .unwrap_or_default()
}

/// Reject specs that could inject shell commands. The spec is later passed as
/// literal argv to `git clone`, never to a shell, but a spec full of `$()`
/// is a typo at best — error early and clearly.
fn validate_spec(spec: &str) -> Result<(), String> {
    let spec = spec.trim();
    if spec.is_empty() {
        return Err("ERROR: nothing to install".into());
    }
    if spec.chars().any(|c| SHELL_METACHARS.contains(&c)) {
        return Err(format!(
            "ERROR: invalid plugin spec '{spec}' (shell metacharacters are not allowed)"
        ));
    }
    Ok(())
}

/// Does the spec name a git source directly (URL, scp-like, or host shorthand)
/// rather than a marketplace name?
fn looks_like_git(spec: &str) -> bool {
    spec.contains("://")
        || spec.starts_with("git@")
        || ["github:", "gitlab:", "bitbucket:", "codeberg:"]
            .iter()
            .any(|p| spec.starts_with(p))
}

#[derive(Debug, PartialEq, Eq)]
struct GitSource {
    url: String,
    r#ref: Option<String>,
    subdir: Option<String>,
}

/// Parse a git URL and the optional GitHub `/tree/<ref>/<subdir>` payload path.
fn parse_git_source(spec: &str) -> Result<GitSource, String> {
    let (base, suffix_ref) = split_ref(spec.trim());
    if let Some(path) = base.strip_prefix("https://github.com/") {
        let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
        if parts.len() >= 4 && parts[2] == "tree" {
            let repo = format!("https://github.com/{}/{}.git", parts[0], parts[1]);
            let tree_ref = parts[3].to_string();
            let subdir = (parts.len() > 4).then(|| parts[4..].join("/"));
            if subdir
                .as_deref()
                .is_some_and(|path| path.split('/').any(|part| part == "." || part == ".."))
            {
                return Err("ERROR: plugin subdirectory cannot contain '.' or '..'".into());
            }
            return Ok(GitSource {
                url: repo,
                r#ref: Some(suffix_ref.unwrap_or(&tree_ref).to_string()),
                subdir,
            });
        }
    }
    Ok(GitSource {
        url: base.to_string(),
        r#ref: suffix_ref.map(str::to_string),
        subdir: None,
    })
}

fn plugin_has_content(root: &Path) -> bool {
    root.join("plugin.toml").is_file()
        || root.join(".claude-plugin/plugin.json").is_file()
        || root.join("skills").is_dir()
        || root.join("commands").is_dir()
        || root.join("agents").is_dir()
        || root.join("SKILL.md").is_file()
        || root.join(".mcp.json").is_file()
}

/// Split a `#ref` suffix off a git URL (`https://host/repo#main`).
fn split_ref(url: &str) -> (&str, Option<&str>) {
    match url.split_once('#') {
        Some((base, r#ref)) => (base, Some(r#ref)),
        None => (url, None),
    }
}

/// The default plugin name for a repo URL: the last path segment, `.git`
/// stripped. `https://github.com/acme/release-tools.git` -> `release-tools`.
fn repo_dir_name(url: &str) -> Option<&str> {
    let (base, _) = split_ref(url);
    let base = base.trim_end_matches('/');
    let name = base.rsplit('/').next()?;
    Some(name.strip_suffix(".git").unwrap_or(name))
}

fn git(args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .args(args)
        .output()
        .map_err(|e| format!("ERROR: git: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(format!(
            "ERROR: git: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

/// Clone a plugin source into a temporary dir, validate it, and move it into
/// place under its final name. A failed clone or an empty repo leaves nothing
/// behind (the temp dir is removed).
async fn install_git(
    root: &Path,
    url: &str,
    r#ref: Option<&str>,
) -> Result<InstalledPlugin, String> {
    let source = parse_git_source(url)?;
    let plugins = skills::plugins_dir(root);
    std::fs::create_dir_all(&plugins).map_err(|e| format!("ERROR: {e}"))?;
    let tmp = plugins.join(format!(".installing-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);

    let r#ref = r#ref.or(source.r#ref.as_deref());
    let mut args = vec!["clone", "--depth", "1"];
    if let Some(r#ref) = r#ref {
        args.extend(["--branch", r#ref]);
    }
    args.extend([source.url.as_str(), tmp.to_str().expect("utf-8 path")]);
    if let Err(e) = git(&args) {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(e);
    }

    let payload = source
        .subdir
        .as_deref()
        .map(|subdir| tmp.join(subdir))
        .unwrap_or_else(|| tmp.clone());
    if !payload.is_dir() {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(format!(
            "ERROR: plugin subdirectory does not exist: '{}'",
            source.subdir.as_deref().unwrap_or("")
        ));
    }
    let manifest = read_manifest(&payload);
    let fallback_name = source
        .subdir
        .as_deref()
        .and_then(|subdir| subdir.rsplit('/').next())
        .or_else(|| repo_dir_name(&source.url));
    let name = match (manifest.name.as_deref(), fallback_name) {
        (Some(name), _) if !name.is_empty() => name.to_string(),
        (_, Some(dir)) => dir.to_string(),
        _ => {
            let _ = std::fs::remove_dir_all(&tmp);
            return Err(format!("ERROR: cannot determine plugin name from '{url}'"));
        }
    };
    let stem = match skills::safe_stem(&name) {
        Ok(stem) if stem == name => stem,
        _ => {
            let _ = std::fs::remove_dir_all(&tmp);
            return Err(format!("ERROR: invalid plugin name '{name}'"));
        }
    };

    if !plugin_has_content(&payload) {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(format!(
            "ERROR: '{url}' has no plugin manifest, skills/, commands/, agents/, or SKILL.md - nothing to install"
        ));
    }
    let target = plugins.join(&stem);
    if target.exists() {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(format!("ERROR: plugin '{stem}' is already installed"));
    }
    if source.subdir.is_some() {
        std::fs::rename(&payload, &target).map_err(|e| {
            let _ = std::fs::remove_dir_all(&tmp);
            format!("ERROR: {e}")
        })?;
        let _ = std::fs::remove_dir_all(&tmp);
    } else {
        std::fs::rename(&tmp, &target).map_err(|e| {
            let _ = std::fs::remove_dir_all(&tmp);
            format!("ERROR: {e}")
        })?;
    }

    // Recompute counts after the move (discovery reads from `root`).
    let skills_count = skills::discover_plugins(root)
        .into_iter()
        .filter(|e| e.plugin.as_deref() == Some(stem.as_str()))
        .count();
    let commands_count = crate::core::agent::plugin_commands::discover(root)
        .into_iter()
        .filter(|e| e.plugin == stem)
        .count();
    let agents_count = crate::core::agent::subagent::count_plugin_agents(root, &stem);
    Ok(InstalledPlugin {
        name: stem,
        description: manifest.description.unwrap_or_default(),
        version: manifest.version.unwrap_or_else(|| "0.0.0".to_string()),
        repo: manifest.repo.unwrap_or(source.url),
        skills: skills_count,
        commands: commands_count,
        agents: agents_count,
    })
}

/// Fetch and parse the marketplace index. The marketplace URL lives in
/// `[plugins] marketplace`; without it, name-based installs cannot resolve.
async fn fetch_index(url: &str) -> Result<Vec<MarketEntry>, String> {
    let resp = client()?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("ERROR: fetching marketplace index: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "ERROR: marketplace index returned {}",
            resp.status()
        ));
    }
    resp.json::<Vec<MarketEntry>>()
        .await
        .map_err(|e| format!("ERROR: parsing marketplace index: {e}"))
}

/// Install a plugin. `spec` is either a git source (URL, `git@host:path`,
/// `github:owner/repo`, with an optional `#ref`) or a marketplace name.
pub(crate) async fn install(root: &Path, spec: &str) -> Result<InstalledPlugin, String> {
    let spec = spec.trim();
    validate_spec(spec)?;
    if looks_like_git(spec) {
        return install_git(root, spec, None).await;
    }
    let marketplace = plugins_section(root)
        .marketplace
        .ok_or("ERROR: no marketplace configured - set [plugins] marketplace in agent.toml, or install a git URL directly")?;
    let index = fetch_index(&marketplace).await?;
    let entry = index
        .into_iter()
        .find(|e| e.name == spec)
        .ok_or_else(|| format!("ERROR: plugin '{spec}' not found on the marketplace"))?;
    install_git(root, &entry.repo, entry.r#ref.as_deref()).await
}

/// Remove an installed plugin by directory name.
pub(crate) fn remove(root: &Path, name: &str) -> Result<(), String> {
    let stem = skills::safe_stem(name)?;
    let target = skills::plugins_dir(root).join(&stem);
    if !target.is_dir() {
        return Err(format!("ERROR: plugin '{name}' is not installed"));
    }
    std::fs::remove_dir_all(&target).map_err(|e| format!("ERROR: {e}"))
}

/// List marketplace plugins matching `query` (name or description, case
/// insensitive; empty query lists everything).
pub(crate) async fn search(root: &Path, query: &str) -> Result<Vec<MarketEntry>, String> {
    let url = plugins_section(root)
        .marketplace
        .ok_or("ERROR: no marketplace configured - set [plugins] marketplace in agent.toml")?;
    let mut entries = fetch_index(&url).await?;
    let query = query.trim().to_lowercase();
    if !query.is_empty() {
        entries.retain(|e| {
            e.name.to_lowercase().contains(&query) || e.description.to_lowercase().contains(&query)
        });
    }
    Ok(entries)
}

#[cfg(all(test, feature = "cli"))]
mod tests {
    use std::path::PathBuf;

    use super::*;

    /// A local git repo fixture containing a plugin payload.
    fn make_repo(tag: &str, with_manifest: bool) -> PathBuf {
        let repo =
            std::env::temp_dir().join(format!("jan_plugin_repo_{tag}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&repo);
        std::fs::create_dir_all(repo.join("skills").join("prepare")).unwrap();
        std::fs::write(
            repo.join("skills").join("prepare").join("SKILL.md"),
            "---\ndescription: Prepare the thing\n---\n\n# prepare\n\nBody.\n",
        )
        .unwrap();
        if with_manifest {
            std::fs::write(
                repo.join("plugin.toml"),
                "name = \"release-tools\"\ndescription = \"Release automation\"\nversion = \"1.2.0\"\n",
            )
            .unwrap();
        }
        git(&["init", repo.to_str().unwrap()]).unwrap();
        git(&["-C", repo.to_str().unwrap(), "add", "-A"]).unwrap();
        git(&[
            "-C",
            repo.to_str().unwrap(),
            "commit",
            "-m",
            "init",
            "--author=Jan Test <test@jan.ai>",
        ])
        .unwrap();
        repo
    }

    fn unique_root(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!("jan_plugin_test_{tag}_{}", std::process::id()))
    }

    #[test]
    fn validate_spec_rejects_shell_metachars() {
        assert!(validate_spec("https://github.com/a/b").is_ok());
        assert!(validate_spec("github:a/b").is_ok());
        assert!(validate_spec("release-tools").is_ok());
        for bad in [
            "https://x/y;rm -rf ~",
            "https://x/y$(id)",
            "a`b",
            "x && y",
            "x | y",
            "x < y",
        ] {
            assert!(validate_spec(bad).is_err(), "accepted {bad:?}");
        }
        assert!(validate_spec("").is_err());
        assert!(validate_spec("  ").is_err());
    }

    #[test]
    fn split_ref_and_repo_name() {
        assert_eq!(split_ref("https://h/r"), ("https://h/r", None));
        assert_eq!(split_ref("https://h/r#main"), ("https://h/r", Some("main")));
        assert_eq!(
            repo_dir_name("https://github.com/acme/release-tools.git"),
            Some("release-tools")
        );
        assert_eq!(
            repo_dir_name("https://github.com/acme/release-tools#v2"),
            Some("release-tools")
        );
        assert_eq!(
            repo_dir_name("git@github.com:acme/tools.git"),
            Some("tools")
        );
    }
    #[test]
    fn parses_github_tree_specs_as_repo_ref_and_subdirectory() {
        let source = parse_git_source(
            "https://github.com/anthropics/claude-plugins-official/tree/main/plugins/claude-code-setup",
        )
        .unwrap();
        assert_eq!(
            source.url,
            "https://github.com/anthropics/claude-plugins-official.git"
        );
        assert_eq!(source.r#ref.as_deref(), Some("main"));
        assert_eq!(source.subdir.as_deref(), Some("plugins/claude-code-setup"));
    }

    #[test]
    fn installed_skips_staging_dirs_and_finds_manifest_names() {
        let root = unique_root("installed-filter");
        let plugins = skills::plugins_dir(&root);
        let release = plugins.join("release-tools");
        let staging = plugins.join(".installing-123");
        std::fs::create_dir_all(&release).unwrap();
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::write(
            release.join("plugin.toml"),
            "name = \"release-automation\"\nversion = \"1.2.0\"\n",
        )
        .unwrap();
        std::fs::write(staging.join("plugin.toml"), "name = \"incomplete\"\n").unwrap();

        let listed = installed(&root);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "release-automation");
        assert_eq!(
            find_installed(&root, "release-tools").map(|(directory, _)| directory),
            Some("release-tools".to_string())
        );
        assert_eq!(
            find_installed(&root, "release-automation").map(|(directory, _)| directory),
            Some("release-tools".to_string())
        );
        assert!(find_installed(&root, ".installing-123").is_none());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_traversal_in_github_tree_subdirectory() {
        assert!(parse_git_source("https://github.com/acme/tools/tree/main/../../outside").is_err());
    }
    #[test]
    fn reads_claude_plugin_json_manifest() {
        let root = unique_root("json-manifest");
        std::fs::create_dir_all(root.join(".claude-plugin")).unwrap();
        std::fs::write(
            root.join(".claude-plugin/plugin.json"),
            r#"{"name":"claude-code-setup","description":"Claude Code setup","version":"1.0.0"}"#,
        )
        .unwrap();
        let manifest = read_manifest(&root);
        assert_eq!(manifest.name.as_deref(), Some("claude-code-setup"));
        assert_eq!(manifest.description.as_deref(), Some("Claude Code setup"));
        assert_eq!(manifest.version.as_deref(), Some("1.0.0"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn install_clones_and_validates() {
        let repo = make_repo("install1", true);
        let root = unique_root("install1");
        let p = install(&root, &format!("file://{}", repo.display()))
            .await
            .unwrap();
        assert_eq!(p.name, "release-tools");
        assert_eq!(p.skills, 1);
        let dir = skills::plugins_dir(&root).join("release-tools");
        assert!(dir.join("plugin.toml").is_file());
        assert!(dir.join("skills/prepare/SKILL.md").is_file());
        // Re-install collides.
        let err = install(&root, &format!("file://{}", repo.display()))
            .await
            .unwrap_err();
        assert!(err.contains("already installed"), "{err}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn install_names_from_repo_dir_without_manifest() {
        let repo = make_repo("install2", false);
        let root = unique_root("install2");
        let p = install(&root, &format!("file://{}", repo.display()))
            .await
            .unwrap();
        // Repo dir name is the fallback name; skills still discovered.
        let dir_name = repo.file_name().unwrap().to_str().unwrap();
        assert_eq!(p.name, dir_name);
        assert_eq!(p.skills, 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn install_rejects_empty_repo_and_cleans_up() {
        let repo = std::env::temp_dir().join(format!("jan_plugin_empty_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&repo);
        std::fs::create_dir_all(&repo).unwrap();
        git(&["init", repo.to_str().unwrap()]).unwrap();
        git(&[
            "-C",
            repo.to_str().unwrap(),
            "commit",
            "--allow-empty",
            "-m",
            "empty",
        ])
        .unwrap();
        let root = unique_root("empty");
        let err = install(&root, &format!("file://{}", repo.display()))
            .await
            .unwrap_err();
        assert!(err.contains("nothing to install"), "{err}");
        // No leftover temp or installed dir.
        assert_eq!(
            std::fs::read_dir(skills::plugins_dir(&root))
                .unwrap()
                .count(),
            0
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn remove_deletes_installed_plugin() {
        let repo = make_repo("remove1", false);
        let root = unique_root("remove1");
        let p = install(&root, &format!("file://{}", repo.display()))
            .await
            .unwrap();
        assert!(skills::plugins_dir(&root).join(&p.name).is_dir());
        remove(&root, &p.name).unwrap();
        assert!(!skills::plugins_dir(&root).join(&p.name).exists());
        assert!(remove(&root, &p.name).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn marketplace_name_install_and_search() {
        let repo = make_repo("mkt", true);
        let root = unique_root("mkt");
        let index = serde_json::json!([{
            "name": "release-tools",
            "description": "Release automation",
            "repo": format!("file://{}", repo.display()),
        }]);
        let body = index.to_string();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming().take(3) {
                let Ok(mut stream) = stream else { continue };
                let mut buf = [0u8; 4096];
                let _ = std::io::Read::read(&mut stream, &mut buf);
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = std::io::Write::write_all(&mut stream, resp.as_bytes());
            }
        });
        std::fs::create_dir_all(&root).unwrap();
        crate::core::agent::project::ensure_project(&root).unwrap();
        std::fs::write(
            crate::core::agent::project::agent_toml_path(&root),
            format!("[plugins]\nmarketplace = \"http://{addr}/index.json\"\n"),
        )
        .unwrap();

        let hits = search(&root, "release").await.unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "release-tools");

        let p = install(&root, "release-tools").await.unwrap();
        assert_eq!(p.name, "release-tools");
        assert!(skills::plugins_dir(&root).join("release-tools").is_dir());

        // Unknown name errors.
        let err = install(&root, "nope").await.unwrap_err();
        assert!(err.contains("not found on the marketplace"), "{err}");
        let _ = std::fs::remove_dir_all(&root);
    }
}
