//! Import skills from Anthropic's public skill hub (github.com/anthropics/skills).
//! Skills live at `skills/<name>/SKILL.md` with optional bundled files; import
//! copies the whole folder into the project's `.jan/agent/skills/<name>/`.
//!
//! All network I/O goes through the backend (no CORS/CSP limits) using the git
//! tree API (1 request to enumerate paths) plus raw.githubusercontent.com for
//! file contents (not subject to the API's 60/hr unauthenticated limit).

use std::path::Path;

use futures::future::join_all;

use tauri_plugin_agent_tools::{skills, workspace};

const TREE_URL: &str = "https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1";
const RAW_BASE: &str = "https://raw.githubusercontent.com/anthropics/skills/main/";
const SKILLS_PREFIX: &str = "skills/";
const USER_AGENT: &str = "jan-agent-skill-import";

/// A skill available on the hub: folder name + its frontmatter description.
#[derive(serde::Serialize)]
pub struct HubSkill {
    pub name: String,
    pub description: String,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("ERROR: {e}"))
}

/// All blob paths in the repo, via the recursive git tree API (one request).
async fn tree_paths(client: &reqwest::Client) -> Result<Vec<String>, String> {
    let resp = client
        .get(TREE_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("ERROR: fetching skill hub index: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("ERROR: skill hub index returned {}", resp.status()));
    }
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("ERROR: parsing skill hub index: {e}"))?;
    let tree = json
        .get("tree")
        .and_then(|t| t.as_array())
        .ok_or("ERROR: unexpected skill hub index shape")?;
    Ok(tree
        .iter()
        .filter(|e| e.get("type").and_then(|t| t.as_str()) == Some("blob"))
        .filter_map(|e| e.get("path").and_then(|p| p.as_str()).map(String::from))
        .collect())
}

/// The skill folder name for a `skills/<name>/SKILL.md` path, else None.
fn skill_name_of(path: &str) -> Option<&str> {
    path.strip_prefix(SKILLS_PREFIX)?
        .strip_suffix("/SKILL.md")
        .filter(|n| !n.is_empty() && !n.contains('/'))
}

async fn fetch_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("ERROR: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("ERROR: {} returned {}", url, resp.status()));
    }
    resp.text().await.map_err(|e| format!("ERROR: {e}"))
}

/// List the skills available on the hub with their descriptions. Descriptions
/// are read from each skill's SKILL.md frontmatter (fetched concurrently).
pub async fn list() -> Result<Vec<HubSkill>, String> {
    let client = client()?;
    let paths = tree_paths(&client).await?;
    let names: Vec<String> = paths
        .iter()
        .filter_map(|p| skill_name_of(p).map(String::from))
        .collect();

    let fetches = names.into_iter().map(|name| {
        let client = client.clone();
        async move {
            let url = format!("{RAW_BASE}{SKILLS_PREFIX}{name}/SKILL.md");
            let description = match fetch_text(&client, &url).await {
                Ok(raw) => skills::parse(&raw).description.unwrap_or_default(),
                Err(_) => String::new(),
            };
            HubSkill { name, description }
        }
    });
    let mut out = join_all(fetches).await;
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Download one hub skill (SKILL.md + every bundled file) into the project's
/// `.jan/agent/skills/<name>/`, replacing any existing skill of the same name.
///
/// Atomic on failure: every file is fetched into memory first, and only once all
/// downloads succeed is the destination cleared and rewritten — a mid-download
/// error leaves the existing skill untouched, and re-import never leaves stale
/// files from a prior version behind.
pub async fn import(root: &Path, name: &str) -> Result<(), String> {
    // Reuse the shared workspace name guard (rejects separators, `..`, `.`, empty).
    let stem = skills::safe_stem(name)?;
    let client = client()?;
    let prefix = format!("{SKILLS_PREFIX}{stem}/");
    let files: Vec<String> = tree_paths(&client)
        .await?
        .into_iter()
        .filter(|p| p.starts_with(&prefix) && !p.ends_with('/'))
        .collect();
    if files.is_empty() {
        return Err(format!("ERROR: skill '{name}' not found on the hub"));
    }

    // Phase 1: fetch every file into memory (relative path + bytes). No writes yet.
    let downloads = files.into_iter().map(|path| {
        let client = client.clone();
        let prefix = prefix.clone();
        async move {
            // Path came from GitHub and is prefix-checked; guard components anyway.
            let rel = path.strip_prefix(&prefix).unwrap_or(&path).to_string();
            if rel.split('/').any(|seg| seg == "..") {
                return Err(format!("ERROR: unsafe path '{path}'"));
            }
            let resp = client
                .get(format!("{RAW_BASE}{path}"))
                .send()
                .await
                .map_err(|e| format!("ERROR: {e}"))?;
            if !resp.status().is_success() {
                return Err(format!("ERROR: downloading {path}: {}", resp.status()));
            }
            let bytes = resp.bytes().await.map_err(|e| format!("ERROR: {e}"))?;
            Ok::<_, String>((rel, bytes))
        }
    });
    let mut fetched = Vec::new();
    for result in join_all(downloads).await {
        fetched.push(result?);
    }

    // Phase 2: replace the destination with the freshly fetched files.
    let skills_dir = skills::skills_dir(&workspace::project_store(root));
    let dest_root = skills_dir.join(&stem);
    let flat = skills_dir.join(format!("{stem}.md"));
    let _ = tokio::fs::remove_dir_all(&dest_root).await;
    let _ = tokio::fs::remove_file(&flat).await; // drop a legacy flat form, if any
    for (rel, bytes) in fetched {
        let target = dest_root.join(&rel);
        if let Some(parent) = target.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("ERROR: {e}"))?;
        }
        tokio::fs::write(&target, &bytes)
            .await
            .map_err(|e| format!("ERROR: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skill_name_extracted_from_skill_md_path() {
        assert_eq!(skill_name_of("skills/pdf/SKILL.md"), Some("pdf"));
        assert_eq!(skill_name_of("skills/pdf/scripts/x.py"), None);
        assert_eq!(skill_name_of("skills/pdf/reference.md"), None);
        assert_eq!(skill_name_of("README.md"), None);
        assert_eq!(skill_name_of("skills/a/b/SKILL.md"), None);
    }
}
