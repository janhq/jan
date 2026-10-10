//! A run's record as one JSON document (distinct from `transcript.rs`, the
//! canonical wire history): the prompt it was given, an ordered
//! list of what it did (prose, reasoning, tool calls and their results) and,
//! once it ends, its final output.
//!
//! Subagents write theirs to `<scratch>/subagents/<name>-transcript.json`, so a
//! parent that has been told a child finished (or stopped it) can read what it
//! actually did. The file is replaced atomically (temp file + rename) at each
//! step boundary, so a reader never sees a half-written document and a stopped or
//! crashed run still leaves everything up to its last boundary.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::core::agent::events::StreamEvent;

/// Longest tool result kept in a transcript entry. The full text went to the
/// model; the transcript is a record for reading back, and a child that cats a
/// large file would otherwise make every rewrite of the document that large.
pub const RESULT_MAX_BYTES: usize = 4 * 1024;

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
            output: None,
            error: None,
        }
    }

    /// Fold one stream event in. Returns whether it closed a step worth
    /// persisting: a tool result or a new turn, not every streamed token.
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
                    content: clip(content),
                    is_error: *is_error,
                });
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

impl Transcript {
    /// The record of a whole conversation, derived from its wire history.
    ///
    /// A main thread has no single run to watch -- it is many turns across many
    /// sessions -- so this is rebuilt from the messages each time the thread is
    /// saved. That makes it a projection of the *current* history: a span that
    /// `/compact` replaced with a summary appears as that summary, not as the
    /// calls it stood for. A subagent's record (built from its events) has no
    /// such gap.
    ///
    /// The first user message is the `prompt`; later ones become `user` entries.
    /// `output` is the last assistant message's text, when the conversation ends
    /// on one.
    pub fn from_history(id: &str, history: &[serde_json::Value]) -> Self {
        let mut doc = Self::new("main", id, "");
        doc.status = Status::Finished;
        let mut seen_prompt = false;
        for message in history {
            let role = message.get("role").and_then(|r| r.as_str()).unwrap_or("");
            match role {
                "user" => {
                    let text = content_text(message.get("content"));
                    if seen_prompt {
                        doc.transcript.push(Entry::User { text });
                    } else {
                        doc.prompt = text;
                        seen_prompt = true;
                    }
                }
                "assistant" => {
                    if let Some(text) = message
                        .get("reasoning_content")
                        .and_then(|t| t.as_str())
                        .filter(|t| !t.is_empty())
                    {
                        doc.transcript.push(Entry::Reasoning {
                            text: text.to_string(),
                        });
                    }
                    let text = content_text(message.get("content"));
                    if !text.is_empty() {
                        doc.transcript.push(Entry::Prose { text });
                    }
                    for call in message
                        .get("tool_calls")
                        .and_then(|c| c.as_array())
                        .into_iter()
                        .flatten()
                    {
                        let function = call.get("function");
                        let raw = function
                            .and_then(|f| f.get("arguments"))
                            .and_then(|a| a.as_str())
                            .unwrap_or("");
                        doc.transcript.push(Entry::ToolCall {
                            id: call
                                .get("id")
                                .and_then(|i| i.as_str())
                                .unwrap_or_default()
                                .to_string(),
                            name: function
                                .and_then(|f| f.get("name"))
                                .and_then(|n| n.as_str())
                                .unwrap_or_default()
                                .to_string(),
                            args: serde_json::from_str(raw).unwrap_or(serde_json::Value::Null),
                        });
                    }
                }
                "tool" => {
                    let content = content_text(message.get("content"));
                    doc.transcript.push(Entry::ToolResult {
                        id: message
                            .get("tool_call_id")
                            .and_then(|i| i.as_str())
                            .unwrap_or_default()
                            .to_string(),
                        is_error: content.starts_with("ERROR"),
                        content: clip(&content),
                    });
                }
                _ => {}
            }
        }
        if history
            .last()
            .and_then(|m| m.get("role"))
            .and_then(|r| r.as_str())
            == Some("assistant")
        {
            let text = content_text(history.last().and_then(|m| m.get("content")));
            if !text.is_empty() {
                doc.output = Some(text);
            }
        }
        doc
    }
}

fn clip(content: &str) -> String {
    if content.len() <= RESULT_MAX_BYTES {
        return content.to_string();
    }
    let mut cut = RESULT_MAX_BYTES;
    while cut > 0 && !content.is_char_boundary(cut) {
        cut -= 1;
    }
    format!(
        "{}\n[truncated at {cut} of {} bytes]",
        &content[..cut],
        content.len()
    )
}

/// `<dir>/<stem>-transcript.json` for a subagent name. The name was validated
/// to `[A-Za-z0-9_-]` at dispatch, so it maps to one safe path component.
pub fn transcript_path(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}{TRANSCRIPT_SUFFIX}"))
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

    #[test]
    fn a_tool_result_is_a_step_boundary_and_is_clipped() {
        let mut t = Transcript::new("a", "sub-a-1", "p");
        assert!(!t.apply(&StreamEvent::ToolCall {
            id: "1".into(),
            name: "read".into(),
            args: serde_json::json!({ "path": "x" }),
        }));
        let big = "é".repeat(RESULT_MAX_BYTES);
        assert!(t.apply(&StreamEvent::ToolResult {
            id: "1".into(),
            content: big,
            is_error: false,
            diff: None,
        }));
        let Some(Entry::ToolResult { content, .. }) = t.transcript.last() else {
            panic!("no result entry");
        };
        assert!(content.contains("[truncated at"));
        assert!(content.len() < RESULT_MAX_BYTES + 64);
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
    fn a_thread_history_becomes_prompt_transcript_and_output() {
        let history = vec![
            serde_json::json!({ "role": "user", "content": "fix it" }),
            serde_json::json!({
                "role": "assistant",
                "content": "looking",
                "reasoning_content": "hmm",
                "tool_calls": [{
                    "id": "c1", "type": "function",
                    "function": { "name": "read", "arguments": "{\"path\":\"a\"}" }
                }]
            }),
            serde_json::json!({ "role": "tool", "tool_call_id": "c1", "content": "ERROR: nope" }),
            serde_json::json!({ "role": "user", "content": [{ "type": "text", "text": "again" }] }),
            serde_json::json!({ "role": "assistant", "content": "done" }),
        ];
        let t = Transcript::from_history("thread-1", &history);
        assert_eq!(t.prompt, "fix it");
        assert_eq!(t.output.as_deref(), Some("done"));
        assert_eq!(t.status, Status::Finished);
        assert_eq!(
            t.transcript,
            vec![
                Entry::Reasoning { text: "hmm".into() },
                Entry::Prose { text: "looking".into() },
                Entry::ToolCall {
                    id: "c1".into(),
                    name: "read".into(),
                    args: serde_json::json!({ "path": "a" }),
                },
                Entry::ToolResult {
                    id: "c1".into(),
                    content: "ERROR: nope".into(),
                    is_error: true,
                },
                Entry::User { text: "again".into() },
                Entry::Prose { text: "done".into() },
            ]
        );
    }

    #[test]
    fn a_history_ending_on_a_tool_result_has_no_output() {
        let history = vec![
            serde_json::json!({ "role": "user", "content": "go" }),
            serde_json::json!({ "role": "tool", "tool_call_id": "c", "content": "x" }),
        ];
        assert!(Transcript::from_history("t", &history).output.is_none());
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

    #[test]
    fn clip_never_splits_a_multibyte_character() {
        // A 3-byte char straddling the limit forces the boundary walk-back.
        let text = format!("{}{}", "a".repeat(RESULT_MAX_BYTES - 1), "\u{20ac}\u{20ac}");
        let clipped = clip(&text);
        assert!(clipped.is_char_boundary(clipped.len()));
        assert!(clipped.contains("[truncated at"));
        assert!(!clipped.starts_with(&text));
    }

    #[test]
    fn a_result_at_exactly_the_limit_is_kept_whole() {
        let text = "b".repeat(RESULT_MAX_BYTES);
        assert_eq!(clip(&text), text);
    }

    #[test]
    fn history_with_unparsable_tool_arguments_keeps_the_call_with_null_args() {
        let history = vec![
            serde_json::json!({ "role": "user", "content": "go" }),
            serde_json::json!({
                "role": "assistant", "content": "",
                "tool_calls": [{ "id": "c", "function": { "name": "edit", "arguments": "{\"pa" } }]
            }),
        ];
        let t = Transcript::from_history("t", &history);
        assert_eq!(
            t.transcript,
            vec![Entry::ToolCall {
                id: "c".into(),
                name: "edit".into(),
                args: serde_json::Value::Null,
            }]
        );
        assert!(t.output.is_none(), "empty assistant text is not an output");
    }

    #[test]
    fn history_image_parts_contribute_no_text_and_text_parts_join() {
        let history = vec![serde_json::json!({
            "role": "user",
            "content": [
                { "type": "text", "text": "look" },
                { "type": "image_url", "image_url": { "url": "data:image/png;base64,AAAA" } },
                { "type": "text", "text": "here" }
            ]
        })];
        let t = Transcript::from_history("t", &history);
        assert_eq!(t.prompt, "look\nhere");
        assert!(!t.prompt.contains("base64"));
    }

    #[test]
    fn an_empty_history_is_an_empty_finished_record() {
        let t = Transcript::from_history("t", &[]);
        assert_eq!(t.prompt, "");
        assert!(t.transcript.is_empty() && t.output.is_none());
        assert_eq!(t.name, "main");
        assert_eq!(t.run_id, "t");
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
