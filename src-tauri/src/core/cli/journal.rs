//! Display journal: the transcript as it was shown, so `/resume` can restore
//! reasoning, tool calls and their results.
//!
//! `messages.jsonl` is the wire conversation and cannot carry this: reasoning is
//! deliberately kept out of it (never resent to the model), tool calls are
//! flattened to text on save, and a `/compact` rewrites it. The journal is a
//! separate append-only log of what the TUI rendered, in emission order, written
//! off the render loop at each turn boundary and replayed through the same
//! rendering path on resume.

use std::path::{Path, PathBuf};

/// One rendered transcript event. Only what a replay needs to rebuild rows:
/// notes, turn receipts and permission prompts are transient by design.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DisplayEntry {
    User {
        text: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        images: Vec<String>,
    },
    /// Assistant text exactly as streamed, `<think>` markers included, so the
    /// replay folds reasoning the same way the live turn did.
    Assistant { text: String },
    ToolCall {
        id: String,
        name: String,
        args: serde_json::Value,
    },
    ToolResult {
        id: String,
        content: String,
        #[serde(default)]
        is_error: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        diff: Option<String>,
    },
    /// A closed subagent's summary row (its call labels stay behind the row).
    Subagent {
        name: String,
        #[serde(default)]
        calls: Vec<String>,
        /// False for a child closed with the run instead of by its own
        /// `SubagentEnd`, which the row reports as `interrupted`.
        #[serde(default = "default_true")]
        finished: bool,
    },
}

fn default_true() -> bool {
    true
}

pub const JOURNAL_FILE: &str = "display.jsonl";

pub fn journal_path(agent_dir: &Path, thread_id: &str) -> PathBuf {
    crate::core::threads::utils::get_thread_dir(agent_dir, thread_id).join(JOURNAL_FILE)
}

/// Rewrite the whole journal. A rewind or `/clear` truncates the log, so an
/// append-only writer would leave dropped turns on disk; the write goes to a
/// sibling temp file and is renamed, so a crash mid-dump cannot leave a
/// half-written journal in place of the last good one.
pub fn write_journal(path: &Path, entries: &[DisplayEntry]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut body = String::new();
    for entry in entries {
        let line = serde_json::to_string(entry).map_err(|e| e.to_string())?;
        body.push_str(&line);
        body.push('\n');
    }
    let tmp = path.with_extension("jsonl.tmp");
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Read a journal, skipping any line that no longer parses (a truncated tail, or
/// an entry written by a newer build) so a resume degrades instead of failing.
pub fn read_journal(path: &Path) -> Vec<DisplayEntry> {
    use std::io::BufRead;

    let Ok(file) = std::fs::File::open(path) else {
        return Vec::new();
    };
    std::io::BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(&l).ok())
        .collect()
}

/// Dumps journals on one background thread, so the render loop never pays for a
/// long conversation's rewrite. One thread rather than one per dump because
/// `persist` fires several times a turn: concurrent writers renaming the same
/// path could land out of order and leave a stale journal as the final state.
/// Failures are silent, like the rest of persistence -- a lost dump costs the
/// resume its detail, which is not worth interrupting the session over.
pub struct Writer {
    tx: Option<std::sync::mpsc::Sender<(PathBuf, Vec<DisplayEntry>)>>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl Writer {
    pub fn new() -> Self {
        let (tx, rx) = std::sync::mpsc::channel::<(PathBuf, Vec<DisplayEntry>)>();
        let handle = std::thread::spawn(move || {
            for (path, entries) in rx {
                let _ = write_journal(&path, &entries);
            }
        });
        Self {
            tx: Some(tx),
            handle: Some(handle),
        }
    }

    pub fn dump(&self, path: PathBuf, entries: Vec<DisplayEntry>) {
        if let Some(tx) = self.tx.as_ref() {
            let _ = tx.send((path, entries));
        }
    }

    /// Wait for every queued dump to land. Called on session exit (and by tests)
    /// so the last turn is on disk before the process goes away.
    pub fn join(&mut self) {
        drop(self.tx.take());
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

impl Default for Writer {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for Writer {
    fn drop(&mut self) {
        self.join();
    }
}

/// Index just past the `target`-th (0-based) user entry's turn, i.e. the length
/// the log keeps when a rewind drops that message and everything after it.
pub fn truncate_at_user(entries: &[DisplayEntry], target: usize) -> usize {
    let mut seen = 0;
    for (i, e) in entries.iter().enumerate() {
        if matches!(e, DisplayEntry::User { .. }) {
            if seen == target {
                return i;
            }
            seen += 1;
        }
    }
    entries.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(text: &str) -> DisplayEntry {
        DisplayEntry::User {
            text: text.into(),
            images: Vec::new(),
        }
    }

    fn sample() -> Vec<DisplayEntry> {
        vec![
            user("do it"),
            DisplayEntry::Assistant {
                text: "<think>plan</think>".into(),
            },
            DisplayEntry::ToolCall {
                id: "c1".into(),
                name: "write".into(),
                args: serde_json::json!({ "path": "a.txt" }),
            },
            DisplayEntry::ToolResult {
                id: "c1".into(),
                content: "ok".into(),
                is_error: false,
                diff: Some("@@ created file @@\n+    1 | x".into()),
            },
            DisplayEntry::Subagent {
                name: "scout".into(),
                calls: vec!["Read a.txt".into()],
                finished: true,
            },
            DisplayEntry::Assistant {
                text: "Done.".into(),
            },
        ]
    }

    fn tmp_dir() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn round_trips_every_entry_kind() {
        let dir = tmp_dir();
        let path = dir.path().join(JOURNAL_FILE);
        let entries = sample();
        write_journal(&path, &entries).unwrap();
        assert_eq!(read_journal(&path), entries);
    }

    #[test]
    fn rewrite_replaces_a_truncated_log() {
        let dir = tmp_dir();
        let path = dir.path().join(JOURNAL_FILE);
        write_journal(&path, &sample()).unwrap();
        let kept = sample()[..2].to_vec();
        write_journal(&path, &kept).unwrap();
        assert_eq!(read_journal(&path), kept, "rewind must not leave a tail");
        assert!(
            !path.with_extension("jsonl.tmp").exists(),
            "temp file is renamed, not left behind"
        );
    }

    #[test]
    fn read_skips_unparsable_lines() {
        let dir = tmp_dir();
        let path = dir.path().join(JOURNAL_FILE);
        let good = serde_json::to_string(&user("hi")).unwrap();
        std::fs::write(
            &path,
            format!("{good}\n{{\"kind\":\"from_the_future\"}}\n{{\"kind\":\"user\",\"te\n"),
        )
        .unwrap();
        assert_eq!(read_journal(&path), vec![user("hi")]);
    }

    #[test]
    fn read_of_a_missing_journal_is_empty() {
        assert!(read_journal(&tmp_dir().path().join(JOURNAL_FILE)).is_empty());
    }

    #[test]
    fn truncate_at_user_cuts_the_whole_turn() {
        let mut entries = sample();
        entries.push(user("second"));
        entries.push(DisplayEntry::Assistant {
            text: "more".into(),
        });
        assert_eq!(truncate_at_user(&entries, 0), 0);
        assert_eq!(truncate_at_user(&entries, 1), 6, "cuts at the second user");
        assert_eq!(
            truncate_at_user(&entries, 9),
            entries.len(),
            "an out-of-range target keeps the log"
        );
    }

    #[test]
    fn writer_lands_dumps_in_order() {
        let dir = tmp_dir();
        let path = dir.path().join(JOURNAL_FILE);
        let mut writer = Writer::new();
        writer.dump(path.clone(), sample());
        let last = sample()[..1].to_vec();
        writer.dump(path.clone(), last.clone());
        writer.join();
        assert_eq!(read_journal(&path), last, "the newest dump must win");
    }

    #[test]
    fn journal_sits_in_the_thread_dir() {
        let dir = tmp_dir();
        let base = dir.path();
        assert_eq!(
            journal_path(base, "t1"),
            base.join("threads").join("t1").join(JOURNAL_FILE)
        );
    }
}
