//! Native execution of the built-in tools. Sandbox escape is enforced by the
//! gate before these run; handlers only resolve paths and perform the operation.
//! Errors are returned as a String starting with "ERROR" (matching
//! `execute_mcp_tool_calls`) so the loop flags `is_error` correctly.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use ignore::WalkBuilder;

use crate::core::agent::tools::BuiltinTool;

const MAX_BYTES: usize = 64 * 1024;
const MAX_LINES: usize = 2000;
const GREP_MAX_LINE: usize = 500;
const LS_DEFAULT_LIMIT: usize = 500;
const FIND_DEFAULT_LIMIT: usize = 1000;
const GREP_DEFAULT_LIMIT: usize = 100;

/// Counter for unique temp-file names for truncated bash output.
static TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

fn resolve(project_root: &Path, raw: &str) -> PathBuf {
    if Path::new(raw).is_absolute() {
        PathBuf::from(raw)
    } else {
        project_root.join(raw)
    }
}

fn arg_str<'a>(args: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(|v| v.as_str())
}

fn arg_u64(args: &serde_json::Value, key: &str) -> Option<u64> {
    args.get(key).and_then(|v| v.as_u64())
}

fn arg_bool(args: &serde_json::Value, key: &str) -> bool {
    args.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

fn rel_to(base: &Path, path: &Path) -> String {
    path.strip_prefix(base)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Truncate `s` to the smaller of the line cap or the byte cap, appending
/// `note` when truncation occurred.
fn cap_output(s: &str, max_lines: usize, note: &str) -> String {
    let mut out = String::new();
    let mut truncated = false;
    for (lines, line) in s.split_inclusive('\n').enumerate() {
        if lines >= max_lines || out.len() + line.len() > MAX_BYTES {
            truncated = true;
            break;
        }
        out.push_str(line);
    }
    if truncated {
        out.push_str(note);
    }
    out
}

/// Execute a built-in tool. Returns the tool-result text. Errors are returned
/// as a String STARTING WITH "ERROR" rather than as Err.
pub async fn execute_builtin(
    tool: &BuiltinTool,
    args: &serde_json::Value,
    project_root: &Path,
) -> String {
    match tool.name {
        "read" => read(args, project_root).await,
        "ls" => ls(args, project_root).await,
        "write" => write(args, project_root).await,
        "edit" => edit(args, project_root).await,
        "bash" => bash(args, project_root).await,
        "find" => find(args, project_root).await,
        "grep" => grep(args, project_root).await,
        other => format!("ERROR: unknown built-in tool '{other}'"),
    }
}

async fn read(args: &serde_json::Value, root: &Path) -> String {
    let Some(path) = arg_str(args, "path") else {
        return "ERROR: missing required argument 'path'".to_string();
    };
    let offset = arg_u64(args, "offset").map(|v| v as usize);
    let limit = arg_u64(args, "limit").map(|v| v as usize);
    let target = resolve(root, path);

    let bytes = match tokio::fs::read(&target).await {
        Ok(b) => b,
        Err(e) => return format!("ERROR: {e}"),
    };
    let content = match String::from_utf8(bytes) {
        Ok(c) => c,
        Err(_) => return "ERROR: not a UTF-8 text file".to_string(),
    };

    let selected = if offset.is_some() || limit.is_some() {
        let lines: Vec<&str> = content.split('\n').collect();
        let start = offset.map(|o| o.saturating_sub(1)).unwrap_or(0);
        if start >= lines.len() {
            return format!(
                "ERROR: offset {} is beyond end of file ({} lines total)",
                offset.unwrap_or(1),
                lines.len()
            );
        }
        let end = match limit {
            Some(l) => (start + l).min(lines.len()),
            None => lines.len(),
        };
        lines[start..end].join("\n")
    } else {
        content
    };

    cap_output(
        &selected,
        MAX_LINES,
        "\n[truncated: use offset/limit to read more]",
    )
}

async fn ls(args: &serde_json::Value, root: &Path) -> String {
    let path = arg_str(args, "path").unwrap_or(".");
    let limit = arg_u64(args, "limit")
        .map(|v| v as usize)
        .unwrap_or(LS_DEFAULT_LIMIT);
    let mut entries = match tokio::fs::read_dir(resolve(root, path)).await {
        Ok(rd) => rd,
        Err(e) => return format!("ERROR: {e}"),
    };
    let mut names: Vec<String> = Vec::new();
    loop {
        match entries.next_entry().await {
            Ok(Some(entry)) => {
                let mut name = entry.file_name().to_string_lossy().into_owned();
                if entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
                    name.push('/');
                }
                names.push(name);
            }
            Ok(None) => break,
            Err(e) => return format!("ERROR: {e}"),
        }
    }
    names.sort_by_key(|n| n.to_lowercase());
    let entry_limited = names.len() > limit;
    names.truncate(limit);
    let mut joined = names.join("\n");
    if entry_limited {
        joined.push_str(&format!("\n[truncated: {limit} entry limit]"));
    }
    cap_output(&joined, usize::MAX, "\n[truncated: 64KB limit]")
}

async fn write(args: &serde_json::Value, root: &Path) -> String {
    let Some(path) = arg_str(args, "path") else {
        return "ERROR: missing required argument 'path'".to_string();
    };
    let Some(content) = arg_str(args, "content") else {
        return "ERROR: missing required argument 'content'".to_string();
    };
    let target = resolve(root, path);
    if let Some(parent) = target.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return format!("ERROR: {e}");
        }
    }
    match tokio::fs::write(&target, content).await {
        Ok(()) => format!("Wrote {} bytes to {}", content.len(), path),
        Err(e) => format!("ERROR: {e}"),
    }
}

async fn edit(args: &serde_json::Value, root: &Path) -> String {
    let Some(path) = arg_str(args, "path") else {
        return "ERROR: missing required argument 'path'".to_string();
    };
    let Some(edits) = args.get("edits").and_then(|v| v.as_array()) else {
        return "ERROR: missing required argument 'edits'".to_string();
    };
    if edits.is_empty() {
        return "ERROR: edits must contain at least one replacement".to_string();
    }
    let target = resolve(root, path);
    let mut content = match tokio::fs::read_to_string(&target).await {
        Ok(c) => c,
        Err(e) => return format!("ERROR: {e}"),
    };

    for (i, e) in edits.iter().enumerate() {
        let Some(old_string) = e.get("old_string").and_then(|v| v.as_str()) else {
            return format!("ERROR: edit {}: missing 'old_string'", i + 1);
        };
        let Some(new_string) = e.get("new_string").and_then(|v| v.as_str()) else {
            return format!("ERROR: edit {}: missing 'new_string'", i + 1);
        };
        let count = content.matches(old_string).count();
        if count == 0 {
            return format!("ERROR: edit {}: old_string not found", i + 1);
        }
        if count > 1 {
            return format!(
                "ERROR: edit {}: old_string not unique ({count} matches)",
                i + 1
            );
        }
        content = content.replacen(old_string, new_string, 1);
    }

    match tokio::fs::write(&target, content).await {
        Ok(()) => format!("Applied {} edit(s) to {}", edits.len(), path),
        Err(e) => format!("ERROR: {e}"),
    }
}

async fn bash(args: &serde_json::Value, root: &Path) -> String {
    let Some(command) = arg_str(args, "command") else {
        return "ERROR: missing required argument 'command'".to_string();
    };
    let timeout = arg_u64(args, "timeout");

    let child = match tokio::process::Command::new("sh")
        .arg("-c")
        .arg(command)
        .current_dir(root)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
    {
        Ok(c) => c,
        Err(e) => return format!("ERROR: failed to run command: {e}"),
    };

    let output = match timeout {
        Some(secs) => {
            let dur = std::time::Duration::from_secs(secs);
            match tokio::time::timeout(dur, child.wait_with_output()).await {
                Ok(res) => res,
                Err(_) => {
                    return format!("ERROR: command timed out after {secs}s");
                }
            }
        }
        None => child.wait_with_output().await,
    };

    match output {
        Ok(out) => {
            let mut combined = String::new();
            combined.push_str(&String::from_utf8_lossy(&out.stdout));
            combined.push_str(&String::from_utf8_lossy(&out.stderr));
            match out.status.code() {
                Some(0) => {}
                Some(code) => combined.push_str(&format!("[exit {code}]")),
                None => combined.push_str("[terminated by signal]"),
            }
            let capped = cap_output(&combined, MAX_LINES, "");
            if capped.len() < combined.len() {
                let full_path = write_temp_output(&combined);
                match full_path {
                    Some(p) => format!("{capped}\n[truncated; full output at {p}]"),
                    None => format!("{capped}\n[truncated]"),
                }
            } else {
                capped
            }
        }
        Err(e) => format!("ERROR: failed to run command: {e}"),
    }
}

/// Write `content` to a uniquely named temp file, returning its path on success.
fn write_temp_output(content: &str) -> Option<String> {
    let n = TEMP_COUNTER.fetch_add(1, Ordering::SeqCst);
    let path = std::env::temp_dir().join(format!("jan-bash-{}-{}.txt", std::process::id(), n));
    std::fs::write(&path, content).ok()?;
    Some(path.to_string_lossy().into_owned())
}

async fn find(args: &serde_json::Value, root: &Path) -> String {
    let pattern = arg_str(args, "pattern").map(String::from);
    let path = arg_str(args, "path").unwrap_or(".").to_string();
    let limit = arg_u64(args, "limit")
        .map(|v| v as usize)
        .unwrap_or(FIND_DEFAULT_LIMIT);
    let base = resolve(root, &path);

    let Some(pattern) = pattern else {
        return "ERROR: missing required argument 'pattern'".to_string();
    };
    let res = tokio::task::spawn_blocking(move || {
        let pat = match glob::Pattern::new(&pattern) {
            Ok(p) => p,
            Err(e) => return format!("ERROR: invalid pattern: {e}"),
        };
        let opts = glob::MatchOptions {
            case_sensitive: true,
            require_literal_separator: false,
            require_literal_leading_dot: false,
        };
        let mut matches: Vec<String> = Vec::new();
        for entry in WalkBuilder::new(&base)
            .hidden(false)
            .require_git(false)
            .build()
            .flatten()
        {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(true) {
                continue;
            }
            let rel = rel_to(&base, entry.path());
            if pat.matches_with(&rel, opts) {
                matches.push(rel);
                if matches.len() >= limit {
                    break;
                }
            }
        }
        if matches.is_empty() {
            "No matches.".to_string()
        } else {
            matches.join("\n")
        }
    })
    .await;
    res.unwrap_or_else(|e| format!("ERROR: {e}"))
}

async fn grep(args: &serde_json::Value, root: &Path) -> String {
    let pattern = arg_str(args, "pattern").map(String::from);
    let path = arg_str(args, "path").unwrap_or(".").to_string();
    let glob_filter = arg_str(args, "glob").map(String::from);
    let ignore_case = arg_bool(args, "ignore_case");
    let literal = arg_bool(args, "literal");
    let context = arg_u64(args, "context").map(|v| v as usize).unwrap_or(0);
    let limit = arg_u64(args, "limit")
        .map(|v| v as usize)
        .unwrap_or(GREP_DEFAULT_LIMIT);
    let base = resolve(root, &path);

    let Some(pattern) = pattern else {
        return "ERROR: missing required argument 'pattern'".to_string();
    };
    let res = tokio::task::spawn_blocking(move || {
        let effective = if literal {
            regex::escape(&pattern)
        } else {
            pattern.clone()
        };
        let re = match regex::RegexBuilder::new(&effective)
            .case_insensitive(ignore_case)
            .build()
        {
            Ok(r) => r,
            Err(e) => return format!("ERROR: invalid pattern: {e}"),
        };
        let glob_pat = match &glob_filter {
            Some(g) => match glob::Pattern::new(g) {
                Ok(p) => Some(p),
                Err(e) => return format!("ERROR: invalid glob: {e}"),
            },
            None => None,
        };

        let is_file = base.is_file();
        let mut matches: Vec<String> = Vec::new();
        let mut count = 0usize;

        let mut search_file = |file: &Path, rel_base: &Path| -> bool {
            if let Some(gp) = &glob_pat {
                let rel = rel_to(rel_base, file);
                if !gp.matches(&rel)
                    && !gp.matches(
                        &file
                            .file_name()
                            .map(|n| n.to_string_lossy().into_owned())
                            .unwrap_or_default(),
                    )
                {
                    return true;
                }
            }
            let content = match std::fs::read_to_string(file) {
                Ok(c) => c,
                Err(_) => return true,
            };
            let rel = rel_to(rel_base, file);
            let lines: Vec<&str> = content.lines().collect();
            for (i, line) in lines.iter().enumerate() {
                if re.is_match(line) {
                    if context > 0 {
                        let start = i.saturating_sub(context);
                        let end = (i + context + 1).min(lines.len());
                        for (j, item) in lines.iter().enumerate().take(end).skip(start) {
                            let text = truncate_line(item);
                            if j == i {
                                matches.push(format!("{rel}:{}:{text}", j + 1));
                            } else {
                                matches.push(format!("{rel}-{}-{text}", j + 1));
                            }
                        }
                    } else {
                        matches.push(format!("{rel}:{}:{}", i + 1, truncate_line(line)));
                    }
                    count += 1;
                    if count >= limit {
                        return false;
                    }
                }
            }
            true
        };

        if is_file {
            let rel_base = base.parent().unwrap_or(&base);
            search_file(&base, rel_base);
        } else {
            for entry in WalkBuilder::new(&base)
                .hidden(false)
                .require_git(false)
                .build()
                .flatten()
            {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(true) {
                    continue;
                }
                if !search_file(entry.path(), &base) {
                    break;
                }
            }
        }

        if matches.is_empty() {
            "No matches.".to_string()
        } else {
            cap_output(&matches.join("\n"), usize::MAX, "\n[truncated: 64KB limit]")
        }
    })
    .await;
    res.unwrap_or_else(|e| format!("ERROR: {e}"))
}

fn truncate_line(line: &str) -> String {
    if line.chars().count() > GREP_MAX_LINE {
        let truncated: String = line.chars().take(GREP_MAX_LINE).collect();
        format!("{truncated}...")
    } else {
        line.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::agent::tools::lookup;
    use serde_json::json;

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn unique_root() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir =
            std::env::temp_dir().join(format!("jan_handlers_test_{}_{}", std::process::id(), n));
        std::fs::create_dir_all(&dir).expect("create test root");
        dir
    }

    #[tokio::test]
    async fn read_returns_contents() {
        let root = unique_root();
        std::fs::write(root.join("a.txt"), b"hello").unwrap();
        let out = execute_builtin(lookup("read").unwrap(), &json!({"path": "a.txt"}), &root).await;
        assert_eq!(out, "hello");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn read_with_offset_and_limit_slices_lines() {
        let root = unique_root();
        std::fs::write(root.join("lines.txt"), b"l1\nl2\nl3\nl4\nl5").unwrap();
        let out = execute_builtin(
            lookup("read").unwrap(),
            &json!({"path": "lines.txt", "offset": 2, "limit": 2}),
            &root,
        )
        .await;
        assert_eq!(out, "l2\nl3");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn read_rejects_binary() {
        let root = unique_root();
        std::fs::write(root.join("bin"), [0xff, 0xfe, 0x00]).unwrap();
        let out = execute_builtin(lookup("read").unwrap(), &json!({"path": "bin"}), &root).await;
        assert!(out.starts_with("ERROR"), "unexpected: {out}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn write_then_read_roundtrips() {
        let root = unique_root();
        let w = execute_builtin(
            lookup("write").unwrap(),
            &json!({"path": "sub/b.txt", "content": "data"}),
            &root,
        )
        .await;
        assert!(w.starts_with("Wrote"), "unexpected: {w}");
        let r = execute_builtin(
            lookup("read").unwrap(),
            &json!({"path": "sub/b.txt"}),
            &root,
        )
        .await;
        assert_eq!(r, "data");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn edit_applies_two_edits_atomically() {
        let root = unique_root();
        std::fs::write(root.join("c.txt"), b"foo bar baz").unwrap();
        let ok = execute_builtin(
            lookup("edit").unwrap(),
            &json!({"path": "c.txt", "edits": [
                {"old_string": "foo", "new_string": "FOO"},
                {"old_string": "baz", "new_string": "BAZ"}
            ]}),
            &root,
        )
        .await;
        assert_eq!(ok, "Applied 2 edit(s) to c.txt");
        assert_eq!(
            std::fs::read_to_string(root.join("c.txt")).unwrap(),
            "FOO bar BAZ"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn edit_errors_without_partial_write() {
        let root = unique_root();
        std::fs::write(root.join("d.txt"), b"one two two").unwrap();
        // First edit ok, second not unique -> whole op fails, file unchanged.
        let out = execute_builtin(
            lookup("edit").unwrap(),
            &json!({"path": "d.txt", "edits": [
                {"old_string": "one", "new_string": "ONE"},
                {"old_string": "two", "new_string": "TWO"}
            ]}),
            &root,
        )
        .await;
        assert!(
            out.starts_with("ERROR: edit 2: old_string not unique"),
            "unexpected: {out}"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("d.txt")).unwrap(),
            "one two two"
        );

        let miss = execute_builtin(
            lookup("edit").unwrap(),
            &json!({"path": "d.txt", "edits": [{"old_string": "nope", "new_string": "x"}]}),
            &root,
        )
        .await;
        assert!(
            miss.starts_with("ERROR: edit 1: old_string not found"),
            "unexpected: {miss}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn ls_lists_created_file() {
        let root = unique_root();
        std::fs::write(root.join("listed.txt"), b"x").unwrap();
        let out = execute_builtin(lookup("ls").unwrap(), &json!({}), &root).await;
        assert!(out.contains("listed.txt"), "unexpected: {out}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn find_glob_respects_gitignore() {
        let root = unique_root();
        std::fs::create_dir_all(root.join("keep")).unwrap();
        std::fs::create_dir_all(root.join("skip")).unwrap();
        std::fs::write(root.join("keep/a.txt"), b"x").unwrap();
        std::fs::write(root.join("skip/b.txt"), b"x").unwrap();
        std::fs::write(root.join(".gitignore"), b"skip/\n").unwrap();
        let out = execute_builtin(
            lookup("find").unwrap(),
            &json!({"pattern": "**/*.txt"}),
            &root,
        )
        .await;
        assert!(out.contains("keep/a.txt"), "should include keep: {out}");
        assert!(
            !out.contains("skip/b.txt"),
            "should exclude gitignored skip: {out}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn grep_regex_and_literal_and_ignore_case() {
        let root = unique_root();
        std::fs::write(
            root.join("code.rs"),
            b"fn main() {}\nLet x = 1.5;\nother line",
        )
        .unwrap();

        let re = execute_builtin(
            lookup("grep").unwrap(),
            &json!({"pattern": "fn \\w+"}),
            &root,
        )
        .await;
        assert!(re.contains("code.rs:1:fn main"), "regex: {re}");

        // Literal: "1.5" as regex would match "1x5" too; literal must match exactly.
        let lit = execute_builtin(
            lookup("grep").unwrap(),
            &json!({"pattern": "1.5", "literal": true}),
            &root,
        )
        .await;
        assert!(lit.contains("code.rs:2:"), "literal: {lit}");

        let ci = execute_builtin(
            lookup("grep").unwrap(),
            &json!({"pattern": "let", "ignore_case": true}),
            &root,
        )
        .await;
        assert!(ci.contains("code.rs:2:"), "ignore_case: {ci}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn grep_invalid_pattern_errors() {
        let root = unique_root();
        std::fs::write(root.join("f.txt"), b"x").unwrap();
        let out = execute_builtin(lookup("grep").unwrap(), &json!({"pattern": "("}), &root).await;
        assert!(
            out.starts_with("ERROR: invalid pattern"),
            "unexpected: {out}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn bash_timeout_returns_error() {
        let root = unique_root();
        let out = execute_builtin(
            lookup("bash").unwrap(),
            &json!({"command": "sleep 5", "timeout": 1}),
            &root,
        )
        .await;
        assert!(
            out.starts_with("ERROR: command timed out"),
            "unexpected: {out}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn bash_nonzero_exit_is_not_error() {
        let root = unique_root();
        let out = execute_builtin(
            lookup("bash").unwrap(),
            &json!({"command": "echo hi; exit 3"}),
            &root,
        )
        .await;
        assert!(!out.starts_with("ERROR"), "unexpected: {out}");
        assert!(out.contains("hi"), "unexpected: {out}");
        assert!(out.contains("[exit 3]"), "unexpected: {out}");
        let _ = std::fs::remove_dir_all(&root);
    }
}
