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
pub(crate) struct InstalledPlugin {
    pub name: String,
    pub description: String,
    pub version: String,
    pub repo: String,
    /// Number of skills the plugin contributes.
    pub skills: usize,
}

/// A plugin available on the configured marketplace: JSON index entry.
#[derive(serde::Serialize, Deserialize, Clone)]
pub(crate) struct MarketEntry {
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

/// Every installed plugin, sorted by name. A dir without a parseable manifest
/// is still listed (its name is the directory name).
pub(crate) fn installed(root: &Path) -> Vec<InstalledPlugin> {
    let dir = skills::plugins_dir(root);
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in rd.flatten() {
        let path = entry.path();
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        let manifest = std::fs::read_to_string(path.join("plugin.toml"))
            .ok()
            .and_then(|raw| toml::from_str::<Manifest>(&raw).ok())
            .unwrap_or_default();
        let plugin_skills = skills::discover_plugins(root)
            .into_iter()
            .filter(|e| e.plugin.as_deref() == Some(name))
            .count();
        out.push(InstalledPlugin {
            name: manifest.name.unwrap_or_else(|| name.to_string()),
            description: manifest.description.unwrap_or_default(),
            version: manifest.version.unwrap_or_else(|| "0.0.0".to_string()),
            repo: manifest.repo.unwrap_or_default(),
            skills: plugin_skills,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
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
async fn install_git(root: &Path, url: &str, r#ref: Option<&str>) -> Result<InstalledPlugin, String> {
    let plugins = skills::plugins_dir(root);
    std::fs::create_dir_all(&plugins).map_err(|e| format!("ERROR: {e}"))?;
    let tmp = plugins.join(format!(".installing-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);

    let (clean_url, url_ref) = split_ref(url);
    let r#ref = r#ref.or(url_ref);
    let mut args = vec!["clone", "--depth", "1"];
    if let Some(r#ref) = r#ref {
        args.extend(["--branch", r#ref]);
    }
    args.extend([clean_url, tmp.to_str().expect("utf-8 path")]);
    if let Err(e) = git(&args) {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(e);
    }

    let manifest = std::fs::read_to_string(tmp.join("plugin.toml"))
        .ok()
        .and_then(|raw| toml::from_str::<Manifest>(&raw).ok())
        .unwrap_or_default();
    let name = match (manifest.name.as_deref(), repo_dir_name(url)) {
        (Some(name), _) if !name.is_empty() => name.to_string(),
        (_, Some(dir)) => dir.to_string(),
        _ => {
            let _ = std::fs::remove_dir_all(&tmp);
            return Err("ERROR: cannot determine plugin name from '{}'".replace("{}", url));
        }
    };
    let stem = match skills::safe_stem(&name) {
        Ok(stem) if stem == name => stem,
        _ => {
            let _ = std::fs::remove_dir_all(&tmp);
            return Err(format!("ERROR: invalid plugin name '{name}'"));
        }
    };

    // A plugin must carry something the agent can use.
    let has_content = tmp.join("plugin.toml").is_file()
        || tmp.join("skills").is_dir()
        || tmp.join("SKILL.md").is_file();
    if !has_content {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(format!(
            "ERROR: '{url}' has no plugin.toml, skills/, or SKILL.md - nothing to install"
        ));
    }
    let target = plugins.join(&stem);
    if target.exists() {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(format!("ERROR: plugin '{stem}' is already installed"));
    }
    std::fs::rename(&tmp, &target).map_err(|e| {
        let _ = std::fs::remove_dir_all(&tmp);
        format!("ERROR: {e}")
    })?;

    // Recompute counts after the move (discovery reads from `root`).
    let skills_count = skills::discover_plugins(root)
        .into_iter()
        .filter(|e| e.plugin.as_deref() == Some(stem.as_str()))
        .count();
    Ok(InstalledPlugin {
        name: stem,
        description: manifest.description.unwrap_or_default(),
        version: manifest.version.unwrap_or_else(|| "0.0.0".to_string()),
        repo: manifest.repo.unwrap_or_else(|| clean_url.to_string()),
        skills: skills_count,
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
        return Err(format!("ERROR: marketplace index returned {}", resp.status()));
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
            e.name.to_lowercase().contains(&query)
                || e.description.to_lowercase().contains(&query)
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
        let repo = std::env::temp_dir().join(format!("jan_plugin_repo_{tag}_{}", std::process::id()));
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
        assert_eq!(repo_dir_name("https://github.com/acme/release-tools.git"), Some("release-tools"));
        assert_eq!(repo_dir_name("https://github.com/acme/release-tools#v2"), Some("release-tools"));
        assert_eq!(repo_dir_name("git@github.com:acme/tools.git"), Some("tools"));
    }

    #[tokio::test]
    async fn install_clones_and_validates() {
        let repo = make_repo("install1", true);
        let root = unique_root("install1");
        let p = install(&root, &format!("file://{}", repo.display())).await.unwrap();
        assert_eq!(p.name, "release-tools");
        assert_eq!(p.skills, 1);
        let dir = skills::plugins_dir(&root).join("release-tools");
        assert!(dir.join("plugin.toml").is_file());
        assert!(dir.join("skills/prepare/SKILL.md").is_file());
        // Re-install collides.
        let err = install(&root, &format!("file://{}", repo.display())).await.unwrap_err();
        assert!(err.contains("already installed"), "{err}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn install_names_from_repo_dir_without_manifest() {
        let repo = make_repo("install2", false);
        let root = unique_root("install2");
        let p = install(&root, &format!("file://{}", repo.display())).await.unwrap();
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
        git(&["-C", repo.to_str().unwrap(), "commit", "--allow-empty", "-m", "empty"]).unwrap();
        let root = unique_root("empty");
        let err = install(&root, &format!("file://{}", repo.display())).await.unwrap_err();
        assert!(err.contains("nothing to install"), "{err}");
        // No leftover temp or installed dir.
        assert_eq!(std::fs::read_dir(skills::plugins_dir(&root)).unwrap().count(), 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn remove_deletes_installed_plugin() {
        let repo = make_repo("remove1", false);
        let root = unique_root("remove1");
        let p = install(&root, &format!("file://{}", repo.display())).await.unwrap();
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
