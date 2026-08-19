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

use std::io::{self, Write};
use std::path::{Path, PathBuf};
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
// How a bare collection URL that holds several plugins is resolved after the
// clone. A collection has no payload at the root, so we enumerate the plugins
// inside it and either ask the user which one to install (interactive CLI) or
// fail with an actionable listing (TUI/desktop, where stdin is owned by the
// render loop and cannot be read mid-install).
#[derive(Clone, Copy, PartialEq, Eq)]
enum CollectionChoice {
    ListError,
    Prompt,
}
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
/// Walk `root` (recursively, skipping hidden dirs) and collect every directory
/// that is itself a plugin payload. A collection repo can nest plugins at any
/// depth (e.g. `plugins/` and `external_plugins/` are only wrapper dirs),
/// so a bare collection URL can't rely on a one-level scan.
fn find_plugin_dirs(root: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let rd = match std::fs::read_dir(dir) {
            Ok(rd) => rd,
            Err(_) => return,
        };
        for entry in rd.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with('.')
            {
                continue;
            }
            if plugin_has_content(&path) {
                out.push(path);
            } else {
                walk(&path, out);
            }
        }
    }
    let mut out = Vec::new();
    walk(root, &mut out);
    out
}

/// Present the plugin choices of a collection on stdout and collect the
/// 0-based indices the user wants to install, reading from `input`. The caller
/// has already cloned the collection, so this only asks which to install.
///
/// Accepts a comma/space-separated list of numbers, the keyword `all` (every
/// plugin), or a blank line to cancel. Already-installed plugins are marked
/// `[installed]` and skipped, never errored.
fn prompt_multi_choice(
    url: &str,
    paths: &[String],
    already: &[bool],
    input: &mut dyn io::BufRead,
) -> Result<Vec<usize>, String> {
    let mut stdout = io::stdout().lock();
    writeln!(stdout, "'{url}' is a plugin collection ({n} plugins):", n = paths.len())
        .map_err(|e| format!("ERROR: {e}"))?;
    let width = paths.len().to_string().len();
    for (i, (path, inst)) in paths.iter().zip(already).enumerate() {
        let mark = if *inst { "  [installed]" } else { "" };
        writeln!(stdout, "  {:>width$}. {path}{mark}", i + 1).map_err(|e| format!("ERROR: {e}"))?;
    }
    writeln!(
        stdout,
        "Install which? numbers (e.g. 1 3 5) or 'all' [enter to cancel]:"
    )
    .map_err(|e| format!("ERROR: {e}"))?;
    let _ = stdout.flush();

    let mut line = String::new();
    loop {
        line.clear();
        match input.read_line(&mut line) {
            Ok(0) => return Err("ERROR: no plugin selected - install aborted".into()),
            Ok(_) => {}
            Err(e) => return Err(format!("ERROR: reading plugin choice: {e}")),
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Err("ERROR: no plugin selected - install aborted".into());
        }
        if trimmed.eq_ignore_ascii_case("all") {
            return Ok((0..paths.len()).collect());
        }
        let mut picked: Vec<usize> = Vec::new();
        let mut ok = true;
        for tok in trimmed.split(|c: char| c == ',' || c.is_whitespace()) {
            if tok.is_empty() {
                continue;
            }
            match tok.parse::<usize>() {
                Ok(n) if (1..=paths.len()).contains(&n) => {
                    let idx = n - 1;
                    if !picked.contains(&idx) {
                        picked.push(idx);
                    }
                }
                _ => {
                    ok = false;
                    break;
                }
            }
        }
        if ok && !picked.is_empty() {
            return Ok(picked);
        }
        writeln!(
            stdout,
            "'{trimmed}' is not a valid choice; enter numbers like '1 3 5' or 'all' [enter to cancel]:"
        )
        .map_err(|e| format!("ERROR: {e}"))?;
        let _ = stdout.flush();
    }
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

/// Clone a plugin source into a temporary dir, discover which plugin(s) inside
/// it to install, and move each selected payload into place under its final
/// name. A failed clone or an empty repo leaves nothing behind (the temp dir is
/// removed).
///
/// `install_git` returns one installed plugin for a normal source or a single-
/// plugin collection, and several for a multi-plugin collection when the user
/// asked for more than one (interactive CLI). Already-installed plugins are
/// skipped, not reported as errors.
fn install_git(
    root: &Path,
    url: &str,
    r#ref: Option<&str>,
    collection: CollectionChoice,
) -> Result<Vec<InstalledPlugin>, String> {
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

    let payload_root = source
        .subdir
        .as_deref()
        .map(|subdir| tmp.join(subdir))
        .unwrap_or_else(|| tmp.clone());
    if !payload_root.is_dir() {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(format!(
            "ERROR: plugin subdirectory does not exist: '{}'",
            source.subdir.as_deref().unwrap_or("")
        ));
    }

    // Decide which payload directory(ies) to install, as
    // (dir, fallback name, is a subdir of the clone) triples.
    let mut targets: Vec<(PathBuf, Option<String>, bool)> = Vec::new();
    if plugin_has_content(&payload_root) {
        // A single plugin: either the repo root or an explicit `#tree` subdir.
        let fallback = source
            .subdir
            .as_deref()
            .and_then(|subdir| subdir.rsplit('/').next())
            .map(str::to_string)
            .or_else(|| repo_dir_name(&source.url).map(str::to_string));
        targets.push((payload_root.clone(), fallback, source.subdir.is_some()));
    } else {
        // A collection repo (e.g. anthropics/claude-plugins-official) has no
        // payload at its root; plugins can be nested any number of dirs deep
        // (`plugins/` and `external_plugins/` are only wrapper dirs).
        let mut candidates = find_plugin_dirs(&payload_root);
        candidates.sort_by_key(|p| {
            p.strip_prefix(&payload_root)
                .map(|rel| rel.to_string_lossy().into_owned())
                .unwrap_or_default()
        });
        let rels: Vec<String> = candidates
            .iter()
            .map(|p| {
                p.strip_prefix(&payload_root)
                    .map(|rel| rel.to_string_lossy().into_owned())
                    .unwrap_or_default()
            })
            .collect();
        let picked: Vec<usize> = match candidates.len() {
            0 => {
                let _ = std::fs::remove_dir_all(&tmp);
                return Err(format!(
                    "ERROR: '{url}' has no plugin manifest, skills/, commands/, agents/, or SKILL.md - nothing to install"
                ));
            }
            // Exactly one plugin in the collection: no ambiguity, install it.
            1 => vec![0],
            n => match collection {
                CollectionChoice::ListError => {
                    let _ = std::fs::remove_dir_all(&tmp);
                    return Err(format!(
                        "ERROR: '{url}' is a plugin collection ({n} plugins: {}) - install one directly, e.g. {url}/tree/<ref>/<relative/path>",
                        rels.join(", ")
                    ));
                }
                CollectionChoice::Prompt => {
                    // Mark plugins already installed so the user can see why a
                    // pick will be skipped.
                    let already: Vec<bool> = candidates
                        .iter()
                        .map(|p| {
                            p.file_name()
                                .and_then(|n| n.to_str())
                                .map(|n| plugins.join(n).exists())
                                .unwrap_or(false)
                        })
                        .collect();
                    match prompt_multi_choice(url, &rels, &already, &mut io::stdin().lock()) {
                        Ok(picked) => picked,
                        Err(e) => {
                            let _ = std::fs::remove_dir_all(&tmp);
                            return Err(e);
                        }
                    }
                }
            },
        };
        for idx in picked {
            let dir = candidates[idx].clone();
            let fallback = dir
                .file_name()
                .and_then(|n| n.to_str())
                .map(str::to_string);
            targets.push((dir, fallback, true));
        }
    }

    // Installing one plugin reports an already-installed collision as an error
    // (the caller asked for that exact plugin); a batch skips it and installs
    // the rest.
    let single = targets.len() == 1;
    let mut installs: Vec<InstalledPlugin> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    for (dir, fallback, narrowed) in targets {
        let outcome = install_payload_dir(
            root,
            &plugins,
            &tmp,
            &dir,
            narrowed,
            fallback.as_deref(),
            &source.url,
        );
        match outcome {
            Ok(PayloadOutcome::Installed(plugin)) => installs.push(plugin),
            Ok(PayloadOutcome::AlreadyInstalled(stem)) => {
                if single {
                    let _ = std::fs::remove_dir_all(&tmp);
                    return Err(format!("ERROR: plugin '{stem}' is already installed"));
                }
                skipped.push(stem);
            }
            Err(e) => {
                let _ = std::fs::remove_dir_all(&tmp);
                return Err(e);
            }
        }
    }
    let _ = std::fs::remove_dir_all(&tmp);
    if installs.is_empty() {
        return Err(format!(
            "ERROR: nothing installed - already installed: {}",
            skipped.join(", ")
        ));
    }
    Ok(installs)
}

/// What happened to one candidate payload during an install.
enum PayloadOutcome {
    Installed(InstalledPlugin),
    /// A plugin of this name is already installed. A single-plugin install
    /// reports this as an error; a batch install skips it.
    AlreadyInstalled(String),
}

/// Move one plugin payload directory into `plugins/<stem>` and report it.
///
/// `payload_narrowed` says whether `payload` is a subdirectory of the clone
/// (rename the subdirectory) or the clone root itself (rename `tmp`).
/// `fallback_name` names the plugin when the manifest does not.
///
/// The shared clone `tmp` is NOT removed here so a batch can install several
/// payloads out of one clone; the caller removes it once at the end.
fn install_payload_dir(
    root: &Path,
    plugins: &Path,
    tmp: &Path,
    payload: &Path,
    payload_narrowed: bool,
    fallback_name: Option<&str>,
    source_url: &str,
) -> Result<PayloadOutcome, String> {
    let manifest = read_manifest(payload);
    let name = match (manifest.name.as_deref(), fallback_name) {
        (Some(name), _) if !name.is_empty() => name.to_string(),
        (_, Some(dir)) => dir.to_string(),
        _ => return Err(format!("ERROR: cannot determine plugin name from '{source_url}'")),
    };
    let stem = match skills::safe_stem(&name) {
        Ok(stem) if stem == name => stem,
        _ => return Err(format!("ERROR: invalid plugin name '{name}'")),
    };
    let target = plugins.join(&stem);
    if target.exists() {
        return Ok(PayloadOutcome::AlreadyInstalled(stem));
    }
    let move_from = if payload_narrowed { payload } else { tmp };
    std::fs::rename(move_from, &target).map_err(|e| format!("ERROR: {e}"))?;

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
    Ok(PayloadOutcome::Installed(InstalledPlugin {
        name: stem,
        description: manifest.description.unwrap_or_default(),
        version: manifest.version.unwrap_or_else(|| "0.0.0".to_string()),
        repo: manifest.repo.unwrap_or_else(|| source_url.to_string()),
        skills: skills_count,
        commands: commands_count,
        agents: agents_count,
    }))
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
///
/// Non-interactive: a multi-plugin collection fails with a listing error, so
/// this always resolves to exactly one plugin.
pub(crate) async fn install(root: &Path, spec: &str) -> Result<InstalledPlugin, String> {
    install_with(root, spec, CollectionChoice::ListError)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| "ERROR: no plugins installed".to_string())
}

/// Install like [`install`], but a multi-plugin collection prompts the user to
/// pick which plugins to install (the interactive CLI path), so this can return
/// several. Already-installed picks are skipped.
pub(crate) async fn install_interactive(
    root: &Path,
    spec: &str,
) -> Result<Vec<InstalledPlugin>, String> {
    install_with(root, spec, CollectionChoice::Prompt).await
}

/// Core install. Resolves git URLs on a blocking thread and marketplace names
/// through the index, then runs the git clone/filesystem work off the async
/// runtime (the TUI render loop must keep repainting during a large clone).
async fn install_with(
    root: &Path,
    spec: &str,
    collection: CollectionChoice,
) -> Result<Vec<InstalledPlugin>, String> {
    let spec = spec.trim();
    validate_spec(spec)?;
    if looks_like_git(spec) {
        // `install_git` shells out to `git clone`, which is network-bound and
        // blocks its thread for the whole clone. Run it on a blocking thread so
        // the TUI keeps repainting (a large plugin repo otherwise freezes the
        // render loop for seconds).
        let root = root.to_path_buf();
        let spec = spec.to_string();
        return tokio::task::spawn_blocking(move || install_git(&root, &spec, None, collection))
            .await
            .map_err(|e| format!("ERROR: install task failed: {e}"))?;
    }
    let marketplace = plugins_section(root)
        .marketplace
        .ok_or("ERROR: no marketplace configured - set [plugins] marketplace in agent.toml, or install a git URL directly")?;
    let index = fetch_index(&marketplace).await?;
    let entry = index
        .into_iter()
        .find(|e| e.name == spec)
        .ok_or_else(|| format!("ERROR: plugin '{spec}' not found on the marketplace"))?;
    // Marketplace installs clone a git repo too: same blocking-work treatment.
    let root = root.to_path_buf();
    let repo = entry.repo.clone();
    let r#ref = entry.r#ref.clone();
    tokio::task::spawn_blocking(move || install_git(&root, &repo, r#ref.as_deref(), collection))
        .await
        .map_err(|e| format!("ERROR: install task failed: {e}"))?
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

    /// A plugin *collection* repo: no payload at the root, each direct child
    /// is its own plugin. Multiple children -> an actionable error naming them.
    #[tokio::test]
    async fn install_collection_lists_plugin_choices() {
        let repo = std::env::temp_dir().join(format!(
            "jan_plugin_collection_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&repo);
        for name in ["alpha", "beta"] {
            let d = repo.join(name).join("skills").join("prepare");
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(
                d.join("SKILL.md"),
                format!("---\ndescription: {name}\n---\n\n# {name}\n\nBody.\n"),
            )
            .unwrap();
            std::fs::write(
                repo.join(name).join("plugin.toml"),
                format!("name = \"{name}\"\ndescription = \"{name}\"\n"),
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
            "collection",
        ])
        .unwrap();

        let root = unique_root("collection1");
        let err = install(&root, &format!("file://{}", repo.display()))
            .await
            .unwrap_err();
        assert!(err.contains("alpha") && err.contains("beta"), "{err}");
        assert!(err.contains("plugin collection"), "{err}");
        assert_eq!(
            std::fs::read_dir(skills::plugins_dir(&root))
                .unwrap()
                .count(),
            0,
            "nothing should be installed for an ambiguous collection"
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(repo);
    }

    /// A collection with a single plugin child auto-installs that one.
    #[tokio::test]
    async fn install_collection_with_single_plugin_installs_it() {
        let repo = std::env::temp_dir().join(format!(
            "jan_plugin_singleton_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&repo);
        let d = repo.join("only").join("skills").join("prepare");
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("SKILL.md"), "---\ndescription: only\n---\n\n# only\n\nBody.\n")
            .unwrap();
        std::fs::write(
            repo.join("only").join("plugin.toml"),
            "name = \"only\"\ndescription = \"only\"\n",
        )
        .unwrap();
        git(&["init", repo.to_str().unwrap()]).unwrap();
        git(&["-C", repo.to_str().unwrap(), "add", "-A"]).unwrap();
        git(&[
            "-C",
            repo.to_str().unwrap(),
            "commit",
            "-m",
            "singleton",
        ])
        .unwrap();

        let root = unique_root("singleton1");
        let p = install(&root, &format!("file://{}", repo.display()))
            .await
            .unwrap();
        assert_eq!(p.name, "only");
        assert_eq!(p.skills, 1);
        assert!(skills::plugins_dir(&root).join("only").is_dir());
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(repo);
    }

    /// A collection with plugins nested under wrapper dirs (like claude-plugins-
    /// official's `plugins/` + `external_plugins/`) still reports an actionable
    /// list of relative paths and installs nothing by default.
    #[tokio::test]
    async fn install_nested_collection_lists_plugin_choices() {
        let repo = std::env::temp_dir().join(format!(
            "jan_nested_collection_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&repo);
        for name in ["alpha", "beta"] {
            let d = repo.join("plugins").join(name).join("skills").join("prepare");
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(d.join("SKILL.md"), format!("---\ndescription: {name}\n---\n\n# {name}\n\nBody.\n"))
                .unwrap();
            std::fs::write(
                repo.join("plugins").join(name).join("plugin.toml"),
                format!("name = \"{name}\"\ndescription = \"{name}\"\n"),
            )
            .unwrap();
        }
        let d = repo
            .join("external_plugins")
            .join("gamma")
            .join(".claude-plugin");
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("plugin.json"), "{\"name\":\"gamma\"}").unwrap();
        git(&["init", repo.to_str().unwrap()]).unwrap();
        git(&["-C", repo.to_str().unwrap(), "add", "-A"]).unwrap();
        git(&[
            "-C",
            repo.to_str().unwrap(),
            "commit",
            "-m",
            "nested collection",
        ])
        .unwrap();

        let root = unique_root("nestedcollection1");
        let err = install(&root, &format!("file://{}", repo.display()))
            .await
            .unwrap_err();
        assert!(err.contains("plugins/alpha") && err.contains("plugins/beta"), "{err}");
        assert!(err.contains("external_plugins/gamma"), "{err}");
        assert!(err.contains("plugin collection"), "{err}");
        assert!(
            err.contains("/tree/<ref>/<relative/path>"),
            "error should show the path-form tree syntax: {err}"
        );
        assert_eq!(
            std::fs::read_dir(skills::plugins_dir(&root))
                .unwrap()
                .count(),
            0,
            "nothing should be installed for an ambiguous nested collection"
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(repo);
    }

    /// A nested collection with a single plugin auto-installs it.
    #[tokio::test]
    async fn install_nested_collection_with_single_plugin_installs_it() {
        let repo = std::env::temp_dir().join(format!(
            "jan_nested_singleton_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&repo);
        let d = repo.join("plugins").join("only").join("skills").join("prepare");
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("SKILL.md"), "---\ndescription: only\n---\n\n# only\n\nBody.\n")
            .unwrap();
        std::fs::write(
            repo.join("plugins").join("only").join("plugin.toml"),
            "name = \"only\"\ndescription = \"only\"\n",
        )
        .unwrap();
        git(&["init", repo.to_str().unwrap()]).unwrap();
        git(&["-C", repo.to_str().unwrap(), "add", "-A"]).unwrap();
        git(&["-C", repo.to_str().unwrap(), "commit", "-m", "nested singleton"]).unwrap();

        let root = unique_root("nestedsingleton1");
        let p = install(&root, &format!("file://{}", repo.display()))
            .await
            .unwrap();
        assert_eq!(p.name, "only");
        assert_eq!(p.skills, 1);
        assert!(skills::plugins_dir(&root).join("only").is_dir());
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(repo);
    }

    #[test]
    fn prompt_multi_choice_parses_selections_and_cancels() {
        let paths: [String; 3] = [
            "plugins/alpha".into(),
            "plugins/beta".into(),
            "external_plugins/gamma".into(),
        ];
        let none = [false, false, false];
        // Single pick -> one 0-based index.
        let mut input = std::io::BufReader::new(&b"2\n"[..]);
        assert_eq!(
            prompt_multi_choice("http://x", &paths, &none, &mut input).unwrap(),
            vec![1]
        );
        // Surrounding whitespace is trimmed.
        let mut input = std::io::BufReader::new(&b"  3  \n"[..]);
        assert_eq!(
            prompt_multi_choice("http://x", &paths, &none, &mut input).unwrap(),
            vec![2]
        );
        // Comma and space separated lists, in the order given, deduped.
        let mut input = std::io::BufReader::new(&b"3,1 1\n"[..]);
        assert_eq!(
            prompt_multi_choice("http://x", &paths, &none, &mut input).unwrap(),
            vec![2, 0]
        );
        // `all` selects everything, case insensitively.
        let mut input = std::io::BufReader::new(&b"ALL\n"[..]);
        assert_eq!(
            prompt_multi_choice("http://x", &paths, &none, &mut input).unwrap(),
            vec![0, 1, 2]
        );
        // Out-of-range, then a valid answer: re-prompts rather than failing.
        let mut input = std::io::BufReader::new(&b"9\n1\n"[..]);
        assert_eq!(
            prompt_multi_choice("http://x", &paths, &none, &mut input).unwrap(),
            vec![0]
        );
        // A non-numeric token invalidates the whole line, then retries.
        let mut input = std::io::BufReader::new(&b"1,nope\n2\n"[..]);
        assert_eq!(
            prompt_multi_choice("http://x", &paths, &none, &mut input).unwrap(),
            vec![1]
        );
        // Already-installed entries stay selectable; the caller skips them.
        let mut input = std::io::BufReader::new(&b"1\n"[..]);
        assert_eq!(
            prompt_multi_choice("http://x", &paths, &[true, false, false], &mut input).unwrap(),
            vec![0]
        );
        // Blank line cancels.
        let mut input = std::io::BufReader::new(&b"\n"[..]);
        let err = prompt_multi_choice("http://x", &paths, &none, &mut input).unwrap_err();
        assert!(err.contains("aborted"), "{err}");
        // EOF cancels.
        let mut input = std::io::BufReader::new(&b""[..]);
        let err = prompt_multi_choice("http://x", &paths, &none, &mut input).unwrap_err();
        assert!(err.contains("aborted"), "{err}");
    }

    /// Installing several payloads out of one clone: each lands under its own
    /// name, and a payload whose name is already taken reports
    /// `AlreadyInstalled` instead of failing, so a batch can skip it.
    #[test]
    fn batch_install_lands_each_payload_and_reports_already_installed() {
        let root = unique_root("batchskip");
        let _ = std::fs::remove_dir_all(&root);
        let plugins = skills::plugins_dir(&root);
        std::fs::create_dir_all(&plugins).unwrap();
        let tmp = plugins.join(".installing-batchskip");

        // Stage two plugin payloads inside one shared clone dir.
        let stage = |name: &str| {
            let dir = tmp.join(name);
            std::fs::create_dir_all(dir.join("skills").join("prepare")).unwrap();
            std::fs::write(
                dir.join("skills").join("prepare").join("SKILL.md"),
                format!("---\ndescription: {name}\n---\n\n# {name}\n\nBody.\n"),
            )
            .unwrap();
            std::fs::write(
                dir.join("plugin.toml"),
                format!("name = \"{name}\"\ndescription = \"{name}\"\n"),
            )
            .unwrap();
            dir
        };
        let alpha = stage("alpha");
        let beta = stage("beta");

        // Both install out of the same clone: the shared tmp must survive the
        // first move for the second to succeed.
        for (dir, name) in [(&alpha, "alpha"), (&beta, "beta")] {
            let outcome =
                install_payload_dir(&root, &plugins, &tmp, dir, true, Some(name), "http://x")
                    .unwrap();
            match outcome {
                PayloadOutcome::Installed(p) => {
                    assert_eq!(p.name, name);
                    assert_eq!(p.skills, 1, "{name} skills");
                }
                PayloadOutcome::AlreadyInstalled(s) => panic!("unexpected skip of {s}"),
            }
            assert!(plugins.join(name).join("plugin.toml").is_file());
        }

        // A second payload claiming an installed name is skipped, not an error.
        let again = stage("alpha");
        match install_payload_dir(&root, &plugins, &tmp, &again, true, Some("alpha"), "http://x")
            .unwrap()
        {
            PayloadOutcome::AlreadyInstalled(stem) => assert_eq!(stem, "alpha"),
            PayloadOutcome::Installed(p) => panic!("reinstalled {}", p.name),
        }

        let _ = std::fs::remove_dir_all(&root);
    }
}
