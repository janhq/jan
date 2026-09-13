//! Shared per-agent observability: a live transcript and a compact status
//! header every agent (the main run and each subagent) writes into the run's
//! collaboration scratch, so any peer, the main agent, or the user can read
//! what another agent is doing while it is still running.
//!
//! This is the machine-and-peer-readable record, distinct from the human
//! display journal (`core::cli::journal`): the journal is the top-level run's
//! transcript replayed on `/resume`; these files are per-child, read mid-flight,
//! and swept with the scratch. They meet only at the one-line `SubagentEnd`
//! summary the journal still owns.
//!
//! Every path reuses the same fail-closed discipline as `spill.rs`:
//! [`validated_subdir`] per directory, [`open_excl`] for a first write,
//! `symlink_metadata` real-file re-checks before a read, and atomic temp+rename
//! for the status header so a reader never sees a torn write.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::tools::spill::{
    open_excl, open_truncating, sanitize_stem, validated_subdir, SUBAGENT_DIR,
};

/// Bytes a single `transcript.jsonl` may reach before it rotates to
/// `transcript.1.jsonl` (one prior generation kept). Bounds scratch growth for
/// a long-running worker at ~2x this.
pub const TRANSCRIPT_MAX_BYTES: u64 = 256 * 1024;

/// Transcript lines returned by default when a reader does not ask for a count.
pub const DEFAULT_TAIL_LINES: usize = 40;
/// Ceiling on the tail a reader may request, so one `read_agent` cannot pull an
/// unbounded slice into the model's context.
pub const MAX_TAIL_LINES: usize = 200;

/// The agent lifecycle states a `status.json` header reports.
pub const STATE_QUEUED: &str = "queued";
pub const STATE_RUNNING: &str = "running";
pub const STATE_PARKED: &str = "parked";
pub const STATE_BLOCKED: &str = "blocked";
pub const STATE_DONE: &str = "done";
pub const STATE_FAILED: &str = "failed";

/// The compact header a reader learns an agent's state from without touching the
/// transcript. Doubles as the on-disk `status.json`, the roster entry, and the
/// payload of a `StreamEvent::AgentStatus`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusView {
    pub run_id: String,
    pub name: String,
    /// One of the `STATE_*` constants.
    pub state: String,
    /// Model turns taken so far.
    pub step: u64,
    /// Tool calls issued so far.
    pub tool_calls: u64,
    /// One-line summary of the most recent activity.
    pub last: String,
    /// The work item this agent currently holds, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub work_id: Option<String>,
    /// Epoch seconds of the last write; the heartbeat a claim lease reads.
    pub updated_at: u64,
    /// Transcript lines written since the last rotation.
    pub lines: u64,
    /// Number of rotations so far (older lines dropped from the tail).
    pub dropped: u64,
}

impl AgentStatusView {
    /// A fresh `queued` header for a just-created agent.
    pub fn new(run_id: &str, name: &str, now: u64) -> Self {
        Self {
            run_id: run_id.to_string(),
            name: name.to_string(),
            state: STATE_QUEUED.to_string(),
            step: 0,
            tool_calls: 0,
            last: String::new(),
            work_id: None,
            updated_at: now,
            lines: 0,
            dropped: 0,
        }
    }
}

/// A caller-supplied id names a single component under `subagents/`: `main`, or
/// a `sub-<name>-<seq>` run id. Charset and length mirror `is_result_file_name`
/// in `spill.rs`; a leading dot is refused so it can never be a dotfile.
pub fn is_agent_id(id: &str) -> bool {
    if id == "main" {
        return true;
    }
    !id.is_empty()
        && id.len() <= 96
        && !id.starts_with('.')
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// `<scratch>/subagents/<run_id>/`, created if missing. Used by the writers.
pub fn agent_run_dir(scratch: &Path, run_id: &str) -> Option<PathBuf> {
    let base = validated_subdir(scratch, SUBAGENT_DIR)?;
    validated_subdir(&base, &sanitize_stem(run_id))
}

/// `<scratch>/subagents/<run_id>/` only if it already exists as a real dir.
/// Readers never create.
fn agent_dir_existing(scratch: &Path, run_id: &str) -> Option<PathBuf> {
    let dir = scratch.join(SUBAGENT_DIR).join(sanitize_stem(run_id));
    match std::fs::symlink_metadata(&dir) {
        Ok(m) if m.is_dir() && !m.file_type().is_symlink() => Some(dir),
        _ => None,
    }
}

fn subagents_dir_existing(scratch: &Path) -> Option<PathBuf> {
    let dir = scratch.join(SUBAGENT_DIR);
    match std::fs::symlink_metadata(&dir) {
        Ok(m) if m.is_dir() && !m.file_type().is_symlink() => Some(dir),
        _ => None,
    }
}

/// Read a path only if it is a real file (not a symlink the shell may have
/// planted), the exact guard `fill_subagent_result` uses before a write.
fn read_real_to_string(path: &Path) -> Option<String> {
    match std::fs::symlink_metadata(path) {
        Ok(m) if m.is_file() && !m.file_type().is_symlink() => std::fs::read_to_string(path).ok(),
        _ => None,
    }
}

/// Append-only transcript writer. Created once at agent start via [`open_excl`]
/// (so a planted file/symlink is refused); the `File` handle is retained for the
/// agent's whole life, so appends hit the inode and survive a later path swap.
pub struct TranscriptWriter {
    file: std::fs::File,
    path: PathBuf,
    prev_path: PathBuf,
    bytes: u64,
    dropped: u64,
    lines: u64,
}

impl TranscriptWriter {
    /// Open `subagents/<run_id>/transcript.jsonl` for the run's lifetime.
    ///
    /// On `AlreadyExists` (a `/resume` reusing surviving scratch minted the same
    /// process-reset run id), truncate-to-own iff the existing node is an
    /// ordinary file we own by convention; a symlink or non-file fails closed.
    pub fn create(scratch: &Path, run_id: &str) -> Option<Self> {
        let dir = agent_run_dir(scratch, run_id)?;
        let path = dir.join("transcript.jsonl");
        let prev_path = dir.join("transcript.1.jsonl");
        let file = match open_excl(&path) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                match std::fs::symlink_metadata(&path) {
                    Ok(m) if m.is_file() && !m.file_type().is_symlink() => {
                        open_truncating(&path).ok()?
                    }
                    _ => return None,
                }
            }
            Err(_) => return None,
        };
        Some(Self {
            file,
            path,
            prev_path,
            bytes: 0,
            dropped: 0,
            lines: 0,
        })
    }

    /// Append one whole `\n`-terminated JSON line. `kind` mirrors a
    /// `StreamEvent` kind (`step`/`tool_call`/`tool_result`/`work`); `err`
    /// distinguishes a failed tool result. A single `write_all`, so a concurrent
    /// tail sees either the whole line or nothing after the last terminator.
    pub fn append(&mut self, kind: &str, detail: &str, err: Option<bool>) {
        let entry = TranscriptLine {
            t: crate::tools::epoch_secs(),
            k: kind,
            d: detail,
            err,
        };
        let Ok(mut line) = serde_json::to_string(&entry) else {
            return;
        };
        line.push('\n');
        let len = line.len() as u64;
        if self.bytes.saturating_add(len) > TRANSCRIPT_MAX_BYTES {
            self.rotate();
        }
        if self.file.write_all(line.as_bytes()).is_ok() {
            self.bytes = self.bytes.saturating_add(len);
            self.lines = self.lines.saturating_add(1);
        }
    }

    /// Rename the live log to `transcript.1.jsonl` and reopen fresh. Best-effort:
    /// if either step fails the old handle keeps taking appends.
    fn rotate(&mut self) {
        if std::fs::rename(&self.path, &self.prev_path).is_err() {
            return;
        }
        if let Ok(f) = open_excl(&self.path) {
            self.file = f;
            self.bytes = 0;
            self.lines = 0;
            self.dropped = self.dropped.saturating_add(1);
        }
    }

    pub fn dropped(&self) -> u64 {
        self.dropped
    }

    pub fn lines(&self) -> u64 {
        self.lines
    }
}

#[derive(serde::Serialize)]
struct TranscriptLine<'a> {
    t: u64,
    k: &'a str,
    d: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    err: Option<bool>,
}

/// Rewrite `subagents/<run_id>/status.json` atomically: [`open_excl`] a unique
/// temp then `rename` over the header, so a reader always sees a whole file.
pub fn write_status(scratch: &Path, status: &AgentStatusView) -> bool {
    let Some(dir) = agent_run_dir(scratch, &status.run_id) else {
        return false;
    };
    let final_path = dir.join("status.json");
    static NONCE: AtomicU64 = AtomicU64::new(1);
    let nonce = NONCE.fetch_add(1, Ordering::Relaxed);
    let tmp = dir.join(format!("status.json.tmp-{}-{nonce}", std::process::id()));
    let mut file = match open_excl(&tmp) {
        Ok(f) => f,
        Err(_) => return false,
    };
    if serde_json::to_writer(&mut file, status).is_err() {
        drop(file);
        let _ = std::fs::remove_file(&tmp);
        return false;
    }
    drop(file);
    if std::fs::rename(&tmp, &final_path).is_err() {
        let _ = std::fs::remove_file(&tmp);
        return false;
    }
    true
}

/// The cheap read: an agent's status header, or `None` if it has none.
pub fn read_status(scratch: &Path, run_id: &str) -> Option<AgentStatusView> {
    let dir = agent_dir_existing(scratch, run_id)?;
    let raw = read_real_to_string(&dir.join("status.json"))?;
    serde_json::from_str(&raw).ok()
}

/// The last `max_lines` complete transcript lines. A trailing fragment with no
/// newline terminator (a torn concurrent append) is dropped, so a reader never
/// parses half a line; the next append completes it.
pub fn tail_transcript(scratch: &Path, run_id: &str, max_lines: usize) -> Option<String> {
    let dir = agent_dir_existing(scratch, run_id)?;
    let content = read_real_to_string(&dir.join("transcript.jsonl"))?;
    let mut parts: Vec<&str> = content.split('\n').collect();
    // A complete log ends with '\n' (last element ""); an incomplete one ends
    // with a fragment. Either way the last element is not a whole line.
    parts.pop();
    let lines: Vec<&str> = parts.into_iter().filter(|l| !l.is_empty()).collect();
    let start = lines.len().saturating_sub(max_lines.min(MAX_TAIL_LINES));
    Some(lines[start..].join("\n"))
}

/// One status header per agent that has one, ordered by run id. The roster a
/// `read_agent{}` with no id returns.
pub fn roster(scratch: &Path) -> Vec<AgentStatusView> {
    let Some(base) = subagents_dir_existing(scratch) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&base) {
        for entry in rd.flatten() {
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if !is_dir {
                continue;
            }
            if let Some(name) = entry.file_name().to_str() {
                if let Some(status) = read_status(scratch, name) {
                    out.push(status);
                }
            }
        }
    }
    out.sort_by(|a, b| a.run_id.cmp(&b.run_id));
    out
}

/// The loop-dispatched shared-observability tool name (not a built-in).
pub const READ_AGENT_TOOL: &str = "read_agent";

/// OpenAI tool schema for `read_agent`.
pub fn read_agent_tool_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "function",
        "function": {
            "name": READ_AGENT_TOOL,
            "description": "See what another agent is doing. With no run_id, returns a roster of every agent (the main agent and each worker) with its current state. With a run_id, returns that agent's status plus the tail of its live activity log -- use it to check on a worker mid-flight.",
            "parameters": {
                "type": "object",
                "properties": {
                    "run_id": { "type": "string", "description": "The agent to inspect (from the roster). Omit for the full roster." },
                    "tail": { "type": "integer", "description": "How many recent log lines to include (default 40, max 200)." }
                }
            }
        }
    })
}

/// Run a `read_agent` call and format its model-facing result. Shared by the
/// CLI loop and the desktop/Cowork command layer. `self_id` is the caller's own
/// collaboration id (`"main"` or a `sub-...` run id): an agent reading its own
/// log is a no-op loop -- the last line it gets back is the `read_agent` call it
/// just made -- so any surface passes its caller here and the read is refused.
pub fn run_read_agent(scratch: &Path, args: &serde_json::Value, self_id: &str) -> String {
    let run_id = args
        .get("run_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    match run_id {
        Some(id) if id == self_id => {
            "ERROR: that run_id is you. read_agent inspects *other* agents; reading your own log \
             tells you nothing. If your task is done, report your result (call complete_work, or \
             give your final answer) instead of polling."
                .to_string()
        }
        None => {
            let r = roster(scratch);
            if r.is_empty() {
                return "No agents are registered yet.".to_string();
            }
            let mut out = String::from("Agents:");
            for s in r {
                out.push_str(&format!(
                    "\n- {} ({}) [{}] step {}, {} tool calls{}{}",
                    s.name,
                    s.run_id,
                    s.state,
                    s.step,
                    s.tool_calls,
                    s.work_id
                        .as_ref()
                        .map(|w| format!(", on {w}"))
                        .unwrap_or_default(),
                    if s.last.is_empty() {
                        String::new()
                    } else {
                        format!(" -- {}", s.last)
                    }
                ));
            }
            out
        }
        Some(id) => {
            if !is_agent_id(id) {
                return format!("ERROR: invalid run_id {id}");
            }
            let Some(status) = read_status(scratch, id) else {
                return format!(
                    "No agent {id} found. Call read_agent with no run_id to see the roster."
                );
            };
            let tail = args
                .get("tail")
                .and_then(|v| v.as_u64())
                .map(|n| (n as usize).min(MAX_TAIL_LINES))
                .unwrap_or(DEFAULT_TAIL_LINES);
            let mut out = format!(
                "{} ({}) [{}] step {}, {} tool calls{}.",
                status.name,
                status.run_id,
                status.state,
                status.step,
                status.tool_calls,
                status
                    .work_id
                    .as_ref()
                    .map(|w| format!(", on {w}"))
                    .unwrap_or_default()
            );
            if !status.last.is_empty() {
                out.push_str(&format!("\nLast: {}", status.last));
            }
            if let Some(lines) = tail_transcript(scratch, id, tail) {
                if !lines.is_empty() {
                    out.push_str(&format!("\n\nRecent activity:\n{lines}"));
                }
            }
            out
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    fn tmp(tag: &str) -> PathBuf {
        static N: AtomicUsize = AtomicUsize::new(0);
        let n = N.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("jan-observ-{tag}-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn accepts_main_and_run_ids_rejects_hostile() {
        assert!(is_agent_id("main"));
        assert!(is_agent_id("sub-reviewer-3"));
        assert!(!is_agent_id(""));
        assert!(!is_agent_id(".hidden"));
        assert!(!is_agent_id("../escape"));
        assert!(!is_agent_id("a/b"));
    }

    #[test]
    fn status_round_trips_atomically() {
        let scratch = tmp("status");
        let mut s = AgentStatusView::new("sub-a-1", "a", 100);
        s.state = STATE_RUNNING.to_string();
        s.step = 4;
        s.tool_calls = 12;
        s.last = "edit src/auth.rs".to_string();
        s.work_id = Some("w-7".to_string());
        assert!(write_status(&scratch, &s));
        let back = read_status(&scratch, "sub-a-1").unwrap();
        assert_eq!(back, s);
        // No temp files linger.
        let dir = scratch.join("subagents/sub-a-1");
        let leftover: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(leftover.is_empty(), "temp file left behind");
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn transcript_appends_and_tails_dropping_a_torn_line() {
        let scratch = tmp("tail");
        {
            let mut w = TranscriptWriter::create(&scratch, "sub-a-1").unwrap();
            w.append("step", "1", None);
            w.append("tool_call", "edit {\"path\":\"a.rs\"}", None);
            w.append("tool_result", "ok", Some(false));
        }
        // Simulate a torn trailing append (no newline terminator).
        let path = scratch.join("subagents/sub-a-1/transcript.jsonl");
        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        f.write_all(b"{\"t\":1,\"k\":\"step\",\"d\":\"tor").unwrap();
        drop(f);
        let tail = tail_transcript(&scratch, "sub-a-1", 10).unwrap();
        let lines: Vec<&str> = tail.lines().collect();
        assert_eq!(lines.len(), 3, "torn fragment dropped: {tail}");
        assert!(lines[0].contains("\"k\":\"step\""));
        assert!(lines[2].contains("tool_result"));
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[cfg(unix)]
    #[test]
    fn refuses_to_read_through_a_swapped_link() {
        let scratch = tmp("swap");
        let host = tmp("swap-host").join("secret");
        std::fs::write(&host, "original").unwrap();
        // Create the agent dir, then plant a link where status.json would be.
        let dir = agent_run_dir(&scratch, "sub-a-1").unwrap();
        std::os::unix::fs::symlink(&host, dir.join("status.json")).unwrap();
        assert!(read_status(&scratch, "sub-a-1").is_none());
        let _ = std::fs::remove_dir_all(&scratch);
        let _ = std::fs::remove_dir_all(host.parent().unwrap());
    }

    #[test]
    fn create_reclaims_a_stale_transcript_on_resume() {
        let scratch = tmp("resume");
        {
            let mut w = TranscriptWriter::create(&scratch, "sub-a-1").unwrap();
            w.append("step", "old", None);
        }
        // A new process minting the same run id reopens truncate-to-own.
        {
            let mut w = TranscriptWriter::create(&scratch, "sub-a-1").unwrap();
            w.append("step", "new", None);
        }
        let tail = tail_transcript(&scratch, "sub-a-1", 10).unwrap();
        assert!(tail.contains("\"d\":\"new\""), "{tail}");
        assert!(
            !tail.contains("\"d\":\"old\""),
            "stale lines survived: {tail}"
        );
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[cfg(unix)]
    #[test]
    fn create_refuses_a_planted_transcript_symlink() {
        let scratch = tmp("plant");
        let host = tmp("plant-host").join("target");
        std::fs::write(&host, "x").unwrap();
        let dir = agent_run_dir(&scratch, "sub-a-1").unwrap();
        std::os::unix::fs::symlink(&host, dir.join("transcript.jsonl")).unwrap();
        assert!(TranscriptWriter::create(&scratch, "sub-a-1").is_none());
        assert_eq!(std::fs::read_to_string(&host).unwrap(), "x");
        let _ = std::fs::remove_dir_all(&scratch);
        let _ = std::fs::remove_dir_all(host.parent().unwrap());
    }

    #[test]
    fn rotation_bumps_dropped_and_keeps_one_prior_generation() {
        let scratch = tmp("rotate");
        let mut w = TranscriptWriter::create(&scratch, "sub-a-1").unwrap();
        let big = "x".repeat(2000);
        // Enough lines to force at least one rotation.
        for _ in 0..200 {
            w.append("tool_result", &big, Some(false));
        }
        assert!(w.dropped() >= 1, "expected a rotation");
        let dir = scratch.join("subagents/sub-a-1");
        assert!(dir.join("transcript.jsonl").exists());
        assert!(dir.join("transcript.1.jsonl").exists());
        drop(w);
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn refuses_reading_your_own_log() {
        let scratch = tmp("selfread");
        assert!(write_status(&scratch, &AgentStatusView::new("sub-a-1", "a", 100)));
        // A peer can read it.
        let peer = run_read_agent(&scratch, &serde_json::json!({ "run_id": "sub-a-1" }), "main");
        assert!(peer.contains("sub-a-1"), "{peer}");
        // Reading yourself is refused, whoever you are.
        let own = run_read_agent(&scratch, &serde_json::json!({ "run_id": "sub-a-1" }), "sub-a-1");
        assert!(own.starts_with("ERROR") && own.contains("you"), "{own}");
        let main = run_read_agent(&scratch, &serde_json::json!({ "run_id": "main" }), "main");
        assert!(main.starts_with("ERROR"), "main cannot read itself either: {main}");
        // The roster (no run_id) is not a self-read and still works.
        let roster = run_read_agent(&scratch, &serde_json::json!({}), "sub-a-1");
        assert!(roster.contains("Agents"), "{roster}");
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn roster_lists_every_agent_header() {
        let scratch = tmp("roster");
        for (id, name) in [("main", "main"), ("sub-a-1", "a"), ("sub-b-1", "b")] {
            let s = AgentStatusView::new(id, name, 100);
            assert!(write_status(&scratch, &s));
        }
        let r = roster(&scratch);
        let ids: Vec<&str> = r.iter().map(|s| s.run_id.as_str()).collect();
        assert_eq!(ids, vec!["main", "sub-a-1", "sub-b-1"]);
        let _ = std::fs::remove_dir_all(&scratch);
    }
}
