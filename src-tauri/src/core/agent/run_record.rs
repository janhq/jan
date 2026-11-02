//! A run's record as one JSON document (distinct from `transcript.rs`, the
//! canonical wire history): the prompt it was given, an ordered
//! list of what it did (prose, reasoning, tool calls and their results) and,
//! once it ends, its final output.
//!
//! Subagents write theirs to `<scratch>/subagents/<name>-transcript.json` (see
//! [`session_path`]), the same type and on-disk format as a main thread's
//! `transcript.json`, so a parent that has been told a child finished (or
//! stopped it) can read what it actually did, and `/agents` can replay it
//! through [`load`]. The file is replaced atomically (temp file + rename) at each
//! step boundary, so a reader never sees a half-written document and a stopped or
//! crashed run still leaves everything up to its last boundary.
//!
//! Nothing in a record is cut or dropped. `messages` is the run's wire history
//! exactly as the model was sent it (reasoning, image parts, tool-call ids and
//! raw argument strings, every tool result whole), so anything rebuilt from a
//! record is byte-identical to the original prefix and keeps hitting the
//! provider's prompt cache. The entries are the readable view of the same run.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::core::agent::events::StreamEvent;

/// Suffix of a subagent's transcript file, after its name.
pub const TRANSCRIPT_SUFFIX: &str = "-transcript.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Entry {
    /// A user turn after the first (the first is the document's `prompt`).
    User {
        text: String,
    },
    Prose {
        text: String,
    },
    Reasoning {
        text: String,
    },
    ToolCall {
        id: String,
        name: String,
        args: serde_json::Value,
    },
    ToolResult {
        id: String,
        content: String,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        is_error: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Running,
    Finished,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Transcript {
    pub name: String,
    pub run_id: String,
    pub status: Status,
    pub prompt: String,
    pub transcript: Vec<Entry>,
    /// The wire history as last sent, verbatim (see the module docs). Empty
    /// until a run publishes one.
    #[serde(default)]
    pub messages: Vec<serde_json::Value>,
    /// The final answer; `None` until the run ends, and for a run that failed or
    /// was stopped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    /// Why a failed or stopped run ended.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Transcript {
    pub fn new(name: &str, run_id: &str, prompt: &str) -> Self {
        Self {
            name: name.to_string(),
            run_id: run_id.to_string(),
            status: Status::Running,
            prompt: prompt.to_string(),
            transcript: Vec::new(),
            messages: Vec::new(),
            output: None,
            error: None,
        }
    }

    /// Fold one stream event in. Returns whether it closed a step worth
    /// persisting: a tool result, a new turn or a new wire history, not every
    /// streamed token.
    ///
    /// Token and reasoning deltas extend the last entry of their own kind so a
    /// paragraph is one entry, not one per chunk. A call is recorded when its
    /// arguments are complete (`ToolCall`), never from the streaming deltas.
    pub fn apply(&mut self, event: &StreamEvent) -> bool {
        match event {
            StreamEvent::Token { text } => {
                match self.transcript.last_mut() {
                    Some(Entry::Prose { text: last }) => last.push_str(text),
                    _ => self.transcript.push(Entry::Prose { text: text.clone() }),
                }
                false
            }
            StreamEvent::Reasoning { text } => {
                match self.transcript.last_mut() {
                    Some(Entry::Reasoning { text: last }) => last.push_str(text),
                    _ => self
                        .transcript
                        .push(Entry::Reasoning { text: text.clone() }),
                }
                false
            }
            StreamEvent::ToolCall { id, name, args } => {
                self.transcript.push(Entry::ToolCall {
                    id: id.clone(),
                    name: name.clone(),
                    args: args.clone(),
                });
                false
            }
            StreamEvent::ToolResult {
                id,
                content,
                is_error,
                ..
            } => {
                self.transcript.push(Entry::ToolResult {
                    id: id.clone(),
                    content: content.clone(),
                    is_error: *is_error,
                });
                true
            }
            StreamEvent::MessagesUpdated { messages } => {
                self.messages = messages.clone();
                true
            }
            StreamEvent::Step { .. } => true,
            _ => false,
        }
    }

    /// Close the record with the run's outcome.
    pub fn finish(&mut self, outcome: &Result<String, String>) {
        match outcome {
            Ok(text) => {
                self.status = Status::Finished;
                self.output = Some(text.clone());
            }
            Err(e) => {
                self.status = Status::Failed;
                self.error = Some(e.clone());
            }
        }
    }
}

/// Plain text of a message's `content`: a string, or the text parts of the array
/// form. Images and other parts carry no text and are skipped.
fn content_text(content: Option<&serde_json::Value>) -> String {
    match content {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Array(parts)) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// `<dir>/<stem>-transcript.json` for a subagent name. The name was validated
/// to `[A-Za-z0-9_-]` at dispatch, so it maps to one safe path component.
pub fn transcript_path(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}{TRANSCRIPT_SUFFIX}"))
}

/// Where subagent `name`'s session file lives in the session `scratch`:
/// `<scratch>/subagents/<name>-transcript.json`. In the scratch on purpose, so
/// it goes with the session (exit, thread delete, or the stale sweep).
pub fn session_path(scratch: &Path, name: &str) -> PathBuf {
    transcript_path(
        &scratch.join(tauri_plugin_agent_tools::tools::spill::SUBAGENT_DIR),
        name,
    )
}

/// Read a session file back: the one loader every reader goes through (the
/// `/agents` replay among them), so the on-disk format has a single seam.
/// Refuses anything but a regular file, since the scratch is shell-writable and
/// a planted link would otherwise route the read onto a host file.
pub fn load(path: &Path) -> std::io::Result<Transcript> {
    let meta = std::fs::symlink_metadata(path)?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err(std::io::Error::other(
            "session file is not a regular file",
        ));
    }
    serde_json::from_slice(&std::fs::read(path)?).map_err(std::io::Error::other)
}

/// Replace `path` with `transcript` atomically: write a sibling temp file, then
/// rename over the target. Refuses a target that is a symlink, since the shell
/// can write the scratch and could have planted one.
pub fn write_atomic(path: &Path, transcript: &Transcript) -> std::io::Result<()> {
    if let Ok(meta) = std::fs::symlink_metadata(path) {
        if meta.file_type().is_symlink() || !meta.is_file() {
            return Err(std::io::Error::other(
                "transcript path is not a regular file",
            ));
        }
    }
    let body = serde_json::to_vec_pretty(transcript).map_err(std::io::Error::other)?;
    let tmp = path.with_extension("json.tmp");
    // `create_new` never writes through a link planted at the temp name.
    let _ = std::fs::remove_file(&tmp);
    {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        file.write_all(&body)?;
    }
    std::fs::rename(&tmp, path)
}

/// Where and how a run's transcript is kept: the target file plus the document
/// being built. Persistence failures are logged, never fatal -- the transcript
/// is a record, and losing it must not fail the run it describes.
pub struct Recorder {
    path: PathBuf,
    doc: Transcript,
    closed: bool,
}

impl Recorder {
    /// A recorder for subagent `name` under `dir` (the scratch's `subagents/`),
    /// written once immediately so the file exists while the child is queued or
    /// starting.
    pub fn start(dir: &Path, name: &str, run_id: &str, prompt: &str) -> Self {
        let recorder = Self {
            path: transcript_path(dir, name),
            doc: Transcript::new(name, run_id, prompt),
            closed: false,
        };
        recorder.persist();
        recorder
    }

    pub fn record(&mut self, event: &StreamEvent) {
        if self.doc.apply(event) {
            self.persist();
        }
    }

    /// A user turn delivered mid-run (a parent's steering message, in the wire
    /// shape the child's history records it in). Persisted at once: it is the
    /// boundary of the turn it starts.
    pub fn user_message(&mut self, message: &serde_json::Value) {
        self.doc.transcript.push(Entry::User {
            text: content_text(message.get("content")),
        });
        self.persist();
    }

    pub fn finish(mut self, outcome: &Result<String, String>) {
        self.doc.finish(outcome);
        self.closed = true;
        self.persist();
    }

    fn persist(&self) {
        if let Err(e) = write_atomic(&self.path, &self.doc) {
            log::warn!("transcript: could not write {}: {e}", self.path.display());
        }
    }
}

/// A run that is aborted (stopped by its parent, or torn down with the session)
/// never reaches `finish`, and its task cannot run code as it is cancelled. The
/// recorder is dropped with it, so closing the record here is what keeps a
/// stopped run from reading as `running` forever.
impl Drop for Recorder {
    fn drop(&mut self) {
        if !self.closed {
            self.doc.status = Status::Stopped;
            self.doc.error = Some("stopped before it finished".to_string());
            self.persist();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "jan-transcript-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn token(t: &str) -> StreamEvent {
        StreamEvent::Token { text: t.into() }
    }

    #[test]
    fn deltas_of_one_kind_merge_into_one_entry() {
        let mut t = Transcript::new("a", "sub-a-1", "do it");
        t.apply(&token("hel"));
        t.apply(&token("lo"));
        t.apply(&StreamEvent::Reasoning { text: "hm".into() });
        t.apply(&token("again"));
        assert_eq!(
            t.transcript,
            vec![
                Entry::Prose { text: "hello".into() },
                Entry::Reasoning { text: "hm".into() },
                Entry::Prose { text: "again".into() },
            ]
        );
    }

    /// Bigger than any display cap (the TUI's is 64 KB), with a multibyte
    /// character on every byte offset, so a cut anywhere would show.
    fn big_result() -> String {
        format!("{}\u{20ac}{}", "a".repeat(64 * 1024 - 1), "\u{e9}x".repeat(40 * 1024))
    }

    #[test]
    fn a_tool_result_is_a_step_boundary_and_is_kept_whole() {
        let mut t = Transcript::new("a", "sub-a-1", "p");
        assert!(!t.apply(&StreamEvent::ToolCall {
            id: "1".into(),
            name: "read".into(),
            args: serde_json::json!({ "path": "x" }),
        }));
        assert!(t.apply(&StreamEvent::ToolResult {
            id: "1".into(),
            content: big_result(),
            is_error: false,
            diff: None,
        }));
        let Some(Entry::ToolResult { content, .. }) = t.transcript.last() else {
            panic!("no result entry");
        };
        assert_eq!(*content, big_result());
    }

    /// The wire history a resume would resend, with every field the model saw:
    /// reasoning, an image part, a call id and its raw argument string (spacing
    /// and all), and a tool result past 64 KB.
    fn wire_history() -> Vec<serde_json::Value> {
        vec![
            serde_json::json!({ "role": "system", "content": "you are jan" }),
            serde_json::json!({
                "role": "user",
                "content": [
                    { "type": "text", "text": "what is in this?" },
                    { "type": "image_url", "image_url": { "url": "data:image/png;base64,QUJD", "detail": "auto" } }
                ]
            }),
            serde_json::json!({
                "role": "assistant",
                "content": null,
                "reasoning_content": format!("think {}", "r".repeat(70 * 1024)),
                "tool_calls": [{
                    "id": "call_9f", "type": "function",
                    "function": { "name": "read", "arguments": "{ \"path\" : \"a.txt\",\"n\":1.50 }" }
                }]
            }),
            serde_json::json!({ "role": "tool", "tool_call_id": "call_9f", "content": big_result() }),
            serde_json::json!({ "role": "assistant", "content": "done", "reasoning_content": "sure" }),
        ]
    }

    /// What a resume rebuilds its request from must be byte-identical to what
    /// the model was sent, or the provider's prompt cache misses. Nothing in a
    /// record is cut: a >64 KB result and the reasoning survive save -> load.
    #[test]
    fn a_large_tool_result_and_reasoning_survive_save_and_load_byte_identically() {
        let dir = tmp("verbatim");
        let path = transcript_path(&dir, "w");
        let messages = wire_history();
        let mut t = Transcript::new("w", "sub-w-1", "p");
        t.apply(&StreamEvent::Reasoning { text: "r".repeat(70 * 1024) });
        t.apply(&StreamEvent::ToolResult {
            id: "call_9f".into(),
            content: big_result(),
            is_error: false,
            diff: None,
        });
        assert!(t.apply(&StreamEvent::MessagesUpdated { messages: messages.clone() }));
        write_atomic(&path, &t).unwrap();
        let loaded = load(&path).unwrap();
        assert_eq!(loaded, t);
        assert_eq!(
            serde_json::to_vec(&loaded.messages).unwrap(),
            serde_json::to_vec(&messages).unwrap(),
            "the rebuilt request messages serialize identically"
        );
        assert!(loaded.transcript.contains(&Entry::Reasoning { text: "r".repeat(70 * 1024) }));
        assert!(loaded.transcript.contains(&Entry::ToolResult {
            id: "call_9f".into(),
            content: big_result(),
            is_error: false,
        }));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A child's history reaches its recorder as `MessagesUpdated`, which is
    /// filtered from the parent's stream but not from the record.
    #[test]
    fn a_recorder_persists_the_childs_wire_history_whole() {
        let dir = tmp("verbatim-recorder");
        let mut r = Recorder::start(&dir, "w", "sub-w-1", "p");
        r.record(&StreamEvent::MessagesUpdated { messages: wire_history() });
        let doc = load(&transcript_path(&dir, "w")).unwrap();
        assert_eq!(
            serde_json::to_vec(&doc.messages).unwrap(),
            serde_json::to_vec(&wire_history()).unwrap()
        );
        drop(r);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_document_has_prompt_transcript_and_output_keys() {
        let mut t = Transcript::new("a", "sub-a-1", "the task");
        t.apply(&token("done"));
        t.finish(&Ok("final".to_string()));
        let v = serde_json::to_value(&t).unwrap();
        assert_eq!(v["prompt"], "the task");
        assert_eq!(v["output"], "final");
        assert_eq!(v["status"], "finished");
        assert_eq!(v["transcript"][0]["kind"], "prose");
        assert!(v.get("error").is_none());
    }

    #[test]
    fn a_failed_run_has_an_error_and_no_output() {
        let mut t = Transcript::new("a", "sub-a-1", "p");
        t.finish(&Err("boom".to_string()));
        let v = serde_json::to_value(&t).unwrap();
        assert_eq!(v["status"], "failed");
        assert_eq!(v["error"], "boom");
        assert!(v.get("output").is_none());
    }

    #[test]
    fn the_file_exists_at_start_and_tracks_each_step() {
        let dir = tmp("steps");
        let mut r = Recorder::start(&dir, "worker", "sub-worker-1", "p");
        let path = transcript_path(&dir, "worker");
        let read = |p: &Path| -> serde_json::Value {
            serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap()
        };
        assert_eq!(read(&path)["status"], "running");
        r.record(&token("partial"));
        assert_eq!(
            read(&path)["transcript"].as_array().unwrap().len(),
            0,
            "tokens alone do not rewrite the file"
        );
        r.record(&StreamEvent::Step { index: 2, max: 0 });
        assert_eq!(read(&path)["transcript"].as_array().unwrap().len(), 1);
        r.finish(&Ok("ok".into()));
        assert_eq!(read(&path)["status"], "finished");
        assert!(!path.with_extension("json.tmp").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_dropped_recorder_marks_the_run_stopped() {
        let dir = tmp("drop");
        let r = Recorder::start(&dir, "w", "sub-w-1", "p");
        drop(r);
        let v: serde_json::Value =
            serde_json::from_slice(&std::fs::read(transcript_path(&dir, "w")).unwrap()).unwrap();
        assert_eq!(v["status"], "stopped");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// `finish` consumes the recorder and then it drops: the drop must see the
    /// record already closed, or every clean run would be rewritten `stopped`.
    #[test]
    fn a_finished_recorder_stays_finished_after_it_drops() {
        let dir = tmp("finish-drop");
        let r = Recorder::start(&dir, "w", "sub-w-1", "p");
        r.finish(&Ok("answer".to_string()));
        let v: serde_json::Value =
            serde_json::from_slice(&std::fs::read(transcript_path(&dir, "w")).unwrap()).unwrap();
        assert_eq!(v["status"], "finished");
        assert_eq!(v["output"], "answer");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_failed_recorder_stays_failed_after_it_drops() {
        let dir = tmp("fail-drop");
        let r = Recorder::start(&dir, "w", "sub-w-1", "p");
        r.finish(&Err("upstream 500".to_string()));
        let v: serde_json::Value =
            serde_json::from_slice(&std::fs::read(transcript_path(&dir, "w")).unwrap()).unwrap();
        assert_eq!(v["status"], "failed");
        assert_eq!(v["error"], "upstream 500");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_tool_call_is_recorded_from_the_completed_event_not_the_stream_deltas() {
        let mut t = Transcript::new("a", "sub-a-1", "p");
        t.apply(&StreamEvent::ToolCallStarted { id: "1".into(), name: "read".into() });
        t.apply(&StreamEvent::ToolCallArgsDelta { id: "1".into(), delta: "{\"pa".into() });
        t.apply(&StreamEvent::ToolOutputDelta { id: "1".into(), delta: "x".into() });
        assert!(t.transcript.is_empty(), "partial JSON is never recorded");
    }

    /// A message the parent steers a child with is part of the child's run, so
    /// the record keeps it as a user turn, persisted at once.
    #[test]
    fn a_steering_message_is_recorded_as_a_user_turn() {
        let dir = tmp("steer");
        let mut r = Recorder::start(&dir, "w", "sub-w-1", "p");
        r.record(&token("working"));
        r.user_message(&serde_json::json!({ "role": "user", "content": "also check b" }));
        let doc = load(&transcript_path(&dir, "w")).unwrap();
        assert_eq!(
            doc.transcript,
            vec![
                Entry::Prose { text: "working".into() },
                Entry::User { text: "also check b".into() },
            ]
        );
        drop(r);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_session_file_round_trips_through_the_loader() {
        let dir = tmp("load");
        let path = transcript_path(&dir, "w");
        let mut t = Transcript::new("w", "sub-w-1", "task");
        t.apply(&token("hi"));
        t.finish(&Ok("done".to_string()));
        write_atomic(&path, &t).unwrap();
        assert_eq!(load(&path).unwrap(), t);
        assert!(load(&dir.join("missing.json")).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The scratch is shell-writable: a link planted at a session file's name
    /// must not make `/agents` read a host file.
    #[cfg(unix)]
    #[test]
    fn the_loader_refuses_a_planted_symlink() {
        let dir = tmp("load-link");
        let real = dir.join("real.json");
        write_atomic(&real, &Transcript::new("w", "sub-w-1", "p")).unwrap();
        let path = transcript_path(&dir, "w");
        std::os::unix::fs::symlink(&real, &path).unwrap();
        assert!(load(&path).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The session file is in the scratch, so ending the session deletes it.
    #[tokio::test]
    async fn a_subagent_session_file_is_deleted_with_the_session_scratch() {
        use tauri_plugin_agent_tools::workspace::{ensure_scratch_dir, remove_scratch_dir};
        let session = format!("run-record-exit-{}", std::process::id());
        let scratch = ensure_scratch_dir(&session).await.unwrap();
        let dir = tauri_plugin_agent_tools::tools::spill::validated_subdir(
            &scratch,
            tauri_plugin_agent_tools::tools::spill::SUBAGENT_DIR,
        )
        .unwrap();
        Recorder::start(&dir, "w", "sub-w-1", "p").finish(&Ok("ok".into()));
        let path = session_path(&scratch, "w");
        assert!(load(&path).is_ok());
        remove_scratch_dir(&session).await.unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn a_subagent_session_lives_under_the_scratch_subagents_dir() {
        let scratch = Path::new("/tmp/jan-agent-s");
        assert_eq!(
            session_path(scratch, "explore-2"),
            Path::new("/tmp/jan-agent-s/subagents/explore-2-transcript.json")
        );
    }

    #[test]
    fn a_leftover_temp_file_does_not_block_the_next_write() {
        let dir = tmp("stale-tmp");
        let path = transcript_path(&dir, "w");
        std::fs::write(path.with_extension("json.tmp"), "junk from a crash").unwrap();
        write_atomic(&path, &Transcript::new("w", "sub-w-1", "p")).unwrap();
        assert!(std::fs::read_to_string(&path).unwrap().contains("sub-w-1"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_directory_at_the_target_is_refused() {
        let dir = tmp("dir-target");
        let path = transcript_path(&dir, "w");
        std::fs::create_dir(&path).unwrap();
        assert!(write_atomic(&path, &Transcript::new("w", "sub-w-1", "p")).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_planted_symlink_is_not_written_through() {
        let dir = tmp("link");
        let victim = dir.join("victim.txt");
        std::fs::write(&victim, "keep").unwrap();
        let path = transcript_path(&dir, "w");
        std::os::unix::fs::symlink(&victim, &path).unwrap();
        let t = Transcript::new("w", "sub-w-1", "p");
        assert!(write_atomic(&path, &t).is_err());
        assert_eq!(std::fs::read_to_string(&victim).unwrap(), "keep");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
