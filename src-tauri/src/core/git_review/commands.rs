use serde::Serialize;
use std::{fs, path::Path, process::Command};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReviewFile {
    path: String,
    status: String,
    additions: u32,
    deletions: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReviewStatus {
    cwd: String,
    branch: Option<String>,
    additions: u32,
    deletions: u32,
    files: Vec<GitReviewFile>,
}

fn run_git(cwd: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(["-C", cwd])
        .args(args)
        .output()
        .map_err(|err| format!("Failed to run git: {err}"))?;

    if output.status.success() {
        String::from_utf8(output.stdout).map_err(|err| format!("Git output was not UTF-8: {err}"))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(format!("Git exited with status {}", output.status))
        } else {
            Err(stderr)
        }
    }
}

fn parse_status_line(line: &str) -> Option<(String, String)> {
    if line.len() < 4 {
        return None;
    }

    let status = line.get(0..2)?.trim().to_string();
    let raw_path = line.get(3..)?.trim();
    let path = raw_path
        .rsplit_once(" -> ")
        .map(|(_, to)| to)
        .unwrap_or(raw_path)
        .trim()
        .to_string();

    if path.is_empty() {
        None
    } else {
        Some((path, status))
    }
}

#[tauri::command]
pub async fn git_review_status(cwd: String) -> Result<GitReviewStatus, String> {
    let cwd = if cwd.trim().is_empty() {
        ".".to_string()
    } else {
        cwd
    };
    let status_output = run_git(&cwd, &["status", "--short"])?;
    let numstat_output = run_git(&cwd, &["diff", "--numstat", "HEAD"])?;
    let branch_output = run_git(&cwd, &["branch", "--show-current"]).unwrap_or_default();

    let mut files: Vec<GitReviewFile> = status_output
        .lines()
        .filter_map(parse_status_line)
        .map(|(path, status)| GitReviewFile {
            path,
            status,
            additions: 0,
            deletions: 0,
        })
        .collect();

    for line in numstat_output.lines() {
        let mut parts = line.split('\t');
        let additions = parts
            .next()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        let deletions = parts
            .next()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        let Some(path) = parts.next() else {
            continue;
        };
        let normalized_path = path
            .rsplit_once(" => ")
            .map(|(_, to)| to)
            .unwrap_or(path)
            .trim_matches('{')
            .trim_matches('}')
            .to_string();

        if let Some(file) = files.iter_mut().find(|file| file.path == normalized_path) {
            file.additions = additions;
            file.deletions = deletions;
        }
    }

    let additions = files.iter().map(|file| file.additions).sum();
    let deletions = files.iter().map(|file| file.deletions).sum();
    let branch = branch_output.trim();

    Ok(GitReviewStatus {
        cwd,
        branch: if branch.is_empty() {
            None
        } else {
            Some(branch.to_string())
        },
        additions,
        deletions,
        files,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeResult {
    pub path: String,
    pub branch: String,
}

fn sanitize_branch_name(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '/' {
            out.push(ch);
        } else if ch.is_whitespace() {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches(&['-', '_', '/'][..]).to_string();
    if trimmed.is_empty() {
        "jan-worktree".to_string()
    } else {
        trimmed
    }
}

/// Create a git worktree for Codex --add-dir / extra workspace roots.
/// Defaults to `<repo>/.worktrees/<branch>` with a new branch `jan/<name>-<timestamp>`.
#[tauri::command]
pub async fn git_worktree_add(
    repo_cwd: String,
    name: Option<String>,
    branch_name: Option<String>,
    worktree_path: Option<String>,
) -> Result<GitWorktreeResult, String> {
    let repo_cwd = repo_cwd.trim().to_string();
    if repo_cwd.is_empty() {
        return Err("Repository path is required".to_string());
    }

    run_git(&repo_cwd, &["rev-parse", "--is-inside-work-tree"])
        .map_err(|_| format!("Not a git repository: {repo_cwd}"))?;

    let suffix = name
        .as_deref()
        .map(sanitize_branch_name)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "worktree".to_string());
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let branch = branch_name.unwrap_or_else(|| format!("jan/{suffix}-{timestamp}"));
    let path = worktree_path.unwrap_or_else(|| {
        format!("{repo_cwd}/.worktrees/{suffix}")
    });

    fs::create_dir_all(
        Path::new(&path)
            .parent()
            .ok_or_else(|| "Invalid worktree path".to_string())?,
    )
    .map_err(|err| format!("Failed to create worktree parent directory: {err}"))?;

    run_git(
        &repo_cwd,
        &[
            "worktree",
            "add",
            "-b",
            branch.as_str(),
            path.as_str(),
        ],
    )?;

    Ok(GitWorktreeResult { path, branch })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeEntry {
    pub path: String,
    pub branch: String,
    pub is_main: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorkspaceTargets {
    pub repo_root: String,
    pub current_branch: Option<String>,
    pub branches: Vec<String>,
    pub worktrees: Vec<GitWorktreeEntry>,
}

#[tauri::command]
pub async fn git_workspace_targets(cwd: String) -> Result<GitWorkspaceTargets, String> {
    let cwd = if cwd.trim().is_empty() {
        ".".to_string()
    } else {
        cwd
    };

    let repo_root = run_git(&cwd, &["rev-parse", "--show-toplevel"])?;
    let repo_root = repo_root.trim().to_string();

    let current_branch = run_git(&repo_root, &["branch", "--show-current"])
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let branches_output = run_git(&repo_root, &["branch", "--format=%(refname:short)"])?;
    let branches: Vec<String> = branches_output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect();

    let worktrees_output = run_git(&repo_root, &["worktree", "list", "--porcelain"])?;
    let mut worktrees = Vec::new();
    let mut pending_path: Option<String> = None;
    let mut pending_branch: Option<String> = None;

    for line in worktrees_output.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            pending_path = Some(path.trim().to_string());
            pending_branch = None;
            continue;
        }
        if let Some(branch) = line.strip_prefix("branch ") {
            let raw = branch.trim();
            let short = raw
                .strip_prefix("refs/heads/")
                .unwrap_or(raw)
                .to_string();
            pending_branch = Some(short);
            continue;
        }
        if line.trim().is_empty() {
            if let Some(path) = pending_path.take() {
                let branch = pending_branch
                    .take()
                    .unwrap_or_else(|| "detached".to_string());
                let is_main = path == repo_root;
                worktrees.push(GitWorktreeEntry {
                    path,
                    branch,
                    is_main,
                });
            }
        }
    }

    if let Some(path) = pending_path {
        let branch = pending_branch
            .unwrap_or_else(|| "detached".to_string());
        let is_main = path == repo_root;
        worktrees.push(GitWorktreeEntry {
            path,
            branch,
            is_main,
        });
    }

    if worktrees.is_empty() {
        worktrees.push(GitWorktreeEntry {
            path: repo_root.clone(),
            branch: current_branch.clone().unwrap_or_else(|| "main".to_string()),
            is_main: true,
        });
    }

    Ok(GitWorkspaceTargets {
        repo_root,
        current_branch,
        branches,
        worktrees,
    })
}

#[tauri::command]
pub async fn git_checkout_branch(cwd: String, branch: String) -> Result<(), String> {
    let cwd = if cwd.trim().is_empty() {
        ".".to_string()
    } else {
        cwd
    };
    let branch = branch.trim();
    if branch.is_empty() {
        return Err("Branch name is required".to_string());
    }
    run_git(&cwd, &["checkout", branch])?;
    Ok(())
}

#[tauri::command]
pub async fn git_review_diff(cwd: String, path: Option<String>) -> Result<String, String> {
    let cwd = if cwd.trim().is_empty() {
        ".".to_string()
    } else {
        cwd
    };
    match path {
        Some(path) if !path.trim().is_empty() => {
            run_git(&cwd, &["diff", "HEAD", "--", path.trim()])
        }
        _ => run_git(&cwd, &["diff", "HEAD"]),
    }
}
