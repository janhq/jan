//! A subagent's session record: the same `session.jsonl` format a main thread
//! keeps (see `session_log`), written by the child as it runs.
//!
//! The file is `<scratch>/subagents/<name>-session.jsonl` ([`session_path`]).
//! It lives in the session scratch on purpose, so it goes with the session
//! (exit, thread delete, or the stale sweep). It holds the child's wire
//! messages exactly as its loop published them (`MessagesUpdated`, never
//! clipped), the transcript as the same `DisplayEntry` kinds the main
//! conversation records, and a `meta` line with the run's name, id, prompt,
//! status and outcome. A parent told a child finished (or stopped it) can read
//! what it actually did, and `/agents` replays it through [`load`].
//!
//! Each step boundary is one appended, synced batch, so a stopped or crashed
//! run still leaves everything up to its last boundary. Persistence failures
//! are logged, never fatal: the record describes the run and must not fail it.

use std::path::{Path, PathBuf};
use std::time::Instant;

use serde_json::Value;

use crate::core::agent::events::StreamEvent;
use crate::core::agent::session_log::{
    self, DisplayEntry, Loaded, ReasoningSeg, RunMeta, RunStatus, SessionWriter,
};

/// Suffix of a subagent's session file, after its name.
pub const SESSION_SUFFIX: &str = "-session.jsonl";

/// `<scratch>/subagents/<name>-session.jsonl`. The name was validated to
/// `[A-Za-z0-9_-]` at dispatch, so it maps to one safe path component.
pub fn session_path(scratch: &Path, name: &str) -> PathBuf {
    session_file(&scratch.join(tauri_plugin_agent_tools::tools::spill::SUBAGENT_DIR), name)
}

/// `<dir>/<name>-session.jsonl`, for `dir` the scratch's validated `subagents/`.
pub fn session_file(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}{SESSION_SUFFIX}"))
}

/// Read subagent `name`'s session back from the session `scratch`. Read-only.
/// The scratch is shell-writable, so a `subagents/` that is not a real
/// directory is refused here, and `session_log::load` refuses a link at the
/// file itself.
pub fn load(scratch: &Path, name: &str) -> std::io::Result<Loaded> {
    let dir = scratch.join(tauri_plugin_agent_tools::tools::spill::SUBAGENT_DIR);
    let meta = std::fs::symlink_metadata(&dir)?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err(std::io::Error::other(
            "the subagents directory is not a real directory",
        ));
    }
    session_log::load(&session_file(&dir, name))
}

/// Builds a run's display entries from its event stream the way the TUI
/// journals the main conversation: prose and reasoning are buffered until a
/// call, a result, a new request or a user turn closes them into one
/// `Assistant` entry.
#[derive(Default)]
struct DisplayBuilder {
    entries: Vec<DisplayEntry>,
    prose: String,
    reasoning: Vec<ReasoningSeg>,
    thinking_since: Option<Instant>,
    reasoning_ms: Option<u64>,
}

impl DisplayBuilder {
    fn token(&mut self, text: &str) {
        self.stop_thinking();
        self.prose.push_str(text);
    }

    fn reasoning(&mut self, text: &str) {
        if text.is_empty() {
            return;
        }
        let at = self.prose.len();
        match self.reasoning.last_mut() {
            Some(seg) if seg.at == at => seg.text.push_str(text),
            _ => self.reasoning.push(ReasoningSeg {
                at,
                text: text.to_string(),
            }),
        }
        self.thinking_since.get_or_insert_with(Instant::now);
    }

    fn stop_thinking(&mut self) {
        if let Some(started) = self.thinking_since.take() {
            let ms = started.elapsed().as_millis() as u64;
            self.reasoning_ms = Some(self.reasoning_ms.unwrap_or(0) + ms);
        }
    }

    fn flush(&mut self) {
        self.stop_thinking();
        let text = std::mem::take(&mut self.prose);
        let reasoning = std::mem::take(&mut self.reasoning);
        let reasoning_ms = self.reasoning_ms.take();
        if text.trim().is_empty() && reasoning.is_empty() {
            return;
        }
        self.entries.push(DisplayEntry::Assistant {
            text,
            reasoning,
            reasoning_ms,
        });
    }

    fn push(&mut self, entry: DisplayEntry) {
        self.flush();
        self.entries.push(entry);
    }
}

/// Plain text and image URLs of a user message's `content`: a string, or the
/// parts of the array form.
fn user_parts(content: Option<&Value>) -> (String, Vec<String>) {
    match content {
        Some(Value::String(s)) => (s.clone(), Vec::new()),
        Some(Value::Array(parts)) => {
            let text = parts
                .iter()
                .filter_map(|p| p.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n");
            let images = parts
                .iter()
                .filter_map(|p| p.pointer("/image_url/url").and_then(Value::as_str))
                .map(str::to_string)
                .collect();
            (text, images)
        }
        _ => (String::new(), Vec::new()),
    }
}

/// Writes a subagent's session file while it runs.
pub struct Recorder {
    writer: Option<SessionWriter>,
    meta: RunMeta,
    messages: Vec<Value>,
    display: DisplayBuilder,
    closed: bool,
}

impl Recorder {
    /// A recorder for subagent `name` under `dir` (the scratch's validated
    /// `subagents/`), written once immediately so the file exists while the
    /// child is queued or starting. A file an earlier run of the same name
    /// left is cut back to nothing by the first batch.
    pub fn start(dir: &Path, name: &str, run_id: &str, prompt: &str) -> Self {
        let path = session_file(dir, name);
        let writer = SessionWriter::open(&path)
            .map_err(|e| log::warn!("subagent session: could not open {}: {e}", path.display()))
            .ok();
        let mut recorder = Self {
            writer,
            meta: RunMeta {
                name: name.to_string(),
                run_id: run_id.to_string(),
                prompt: prompt.to_string(),
                status: RunStatus::Running,
                output: None,
                error: None,
            },
            messages: Vec::new(),
            display: DisplayBuilder::default(),
            closed: false,
        };
        recorder.persist();
        recorder
    }

    /// Fold one event of the child's own stream in, persisting at a step
    /// boundary (a result, a new request, a new wire history), not on every
    /// streamed token. A call is recorded once its arguments are complete
    /// (`ToolCall`), never from the streaming deltas.
    pub fn record(&mut self, event: &StreamEvent) {
        match event {
            StreamEvent::Token { text } => self.display.token(text),
            StreamEvent::Reasoning { text } => self.display.reasoning(text),
            StreamEvent::ToolCall { id, name, args } => self.display.push(DisplayEntry::ToolCall {
                id: id.clone(),
                name: name.clone(),
                args: args.clone(),
            }),
            StreamEvent::ToolResult {
                id,
                content,
                is_error,
                diff,
            } => {
                self.display.push(DisplayEntry::ToolResult {
                    id: id.clone(),
                    content: content.clone(),
                    is_error: *is_error,
                    diff: diff.clone(),
                });
                self.persist();
            }
            StreamEvent::MessagesUpdated { messages } => {
                self.messages = messages.clone();
                self.persist();
            }
            StreamEvent::Step { .. } => {
                self.display.flush();
                self.persist();
            }
            _ => {}
        }
    }

    /// A user turn delivered mid-run (a parent's steering message, in the wire
    /// shape the child's history records it in). Persisted at once: it is the
    /// boundary of the turn it starts.
    pub fn user_message(&mut self, message: &Value) {
        let (text, images) = user_parts(message.get("content"));
        self.display.push(DisplayEntry::User { text, images });
        self.persist();
    }

    /// Close the record with the run's outcome.
    pub fn finish(mut self, outcome: &Result<String, String>) {
        match outcome {
            Ok(text) => {
                self.meta.status = RunStatus::Finished;
                self.meta.output = Some(text.clone());
            }
            Err(e) => {
                self.meta.status = RunStatus::Failed;
                self.meta.error = Some(e.clone());
            }
        }
        self.closed = true;
        self.display.flush();
        self.persist();
    }

    fn persist(&mut self) {
        let Some(writer) = self.writer.as_mut() else {
            return;
        };
        let written = writer
            .sync(&self.messages, Some(&self.display.entries))
            .and_then(|_| writer.sync_meta(&self.meta));
        if let Err(e) = written {
            log::warn!(
                "subagent session: could not write {}: {e}",
                writer.path().display()
            );
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
            self.meta.status = RunStatus::Stopped;
            self.meta.error = Some("stopped before it finished".to_string());
            self.display.flush();
            self.persist();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn token(t: &str) -> StreamEvent {
        StreamEvent::Token { text: t.into() }
    }

    fn read(dir: &Path, name: &str) -> session_log::SessionRecord {
        let loaded = session_log::load(&session_file(dir, name)).unwrap();
        assert_eq!(loaded.skipped, 0);
        loaded.record
    }

    fn status(dir: &Path, name: &str) -> RunStatus {
        read(dir, name).meta.expect("meta line").status
    }

    /// Bigger than any display cap (the TUI's is 64 KB), with a multibyte
    /// character on every byte offset, so a cut anywhere would show.
    fn big_result() -> String {
        format!("{}\u{20ac}{}", "a".repeat(64 * 1024 - 1), "\u{e9}x".repeat(40 * 1024))
    }

    /// The wire history a resume would resend, with every field the model saw:
    /// reasoning, an image part, a call id and its raw argument string (spacing
    /// and all), and a tool result past 64 KB.
    fn wire_history() -> Vec<Value> {
        let raw = format!(
            r#"[
            {{"role":"system","content":"you are jan"}},
            {{"role":"user","content":[{{"type":"text","text":"what is in this?"}},{{"type":"image_url","image_url":{{"url":"data:image/png;base64,QUJD","detail":"auto"}}}}]}},
            {{"role":"assistant","content":null,"reasoning_content":"think {r}","tool_calls":[{{"id":"call_9f","type":"function","function":{{"name":"read","arguments":"{{ \"path\" : \"a.txt\",\"n\":1.50 }}"}}}}]}},
            {{"role":"tool","tool_call_id":"call_9f","content":"{big}"}},
            {{"role":"assistant","content":"done","reasoning_content":"sure"}}
            ]"#,
            r = "r".repeat(70 * 1024),
            big = big_result(),
        );
        serde_json::from_str(&raw).unwrap()
    }

    /// What a resume rebuilds its request from must be byte-identical to what
    /// the model was sent, or the provider's prompt cache misses. Nothing in a
    /// child's record is cut: a >64 KB result and the reasoning survive
    /// record -> load, in the messages and in the display entries alike.
    #[test]
    fn a_large_tool_result_and_reasoning_survive_byte_identically() {
        let dir = tmp();
        let mut r = Recorder::start(dir.path(), "w", "sub-w-1", "p");
        r.record(&StreamEvent::Reasoning {
            text: "r".repeat(70 * 1024),
        });
        r.record(&StreamEvent::ToolCall {
            id: "call_9f".into(),
            name: "read".into(),
            args: serde_json::json!({ "path": "a.txt" }),
        });
        r.record(&StreamEvent::ToolResult {
            id: "call_9f".into(),
            content: big_result(),
            is_error: false,
            diff: None,
        });
        r.record(&StreamEvent::MessagesUpdated {
            messages: wire_history(),
        });
        let record = read(dir.path(), "w");
        assert_eq!(
            serde_json::to_vec(&record.messages).unwrap(),
            serde_json::to_vec(&wire_history()).unwrap(),
            "the rebuilt request messages serialize identically"
        );
        assert!(matches!(
            &record.display[0],
            DisplayEntry::Assistant { text, reasoning, .. }
                if text.is_empty() && reasoning[0].text == "r".repeat(70 * 1024)
        ));
        assert!(record.display.contains(&DisplayEntry::ToolResult {
            id: "call_9f".into(),
            content: big_result(),
            is_error: false,
            diff: None,
        }));
        drop(r);
    }

    /// A main thread and a subagent keep one format: the child's file is a
    /// `session_log` file, read by the same loader into the same type.
    #[test]
    fn a_subagent_session_is_the_main_session_format() {
        let dir = tmp();
        let r = Recorder::start(dir.path(), "w", "sub-w-1", "task");
        r.finish(&Ok("answer".into()));
        let path = session_file(dir.path(), "w");
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("{\"type\":\"session\",\"version\":1}\n"), "{text}");
        let main_path = dir.path().join("t").join(session_log::SESSION_FILE);
        let mut main = SessionWriter::open(&main_path).unwrap();
        main.sync(&wire_history(), None).unwrap();
        let record: session_log::SessionRecord = session_log::load(&path).unwrap().record;
        assert_eq!(record.meta.unwrap().output.as_deref(), Some("answer"));
        assert_eq!(session_log::load(&main_path).unwrap().record.meta, None);
        assert!(lock_released(&path), "a closed recorder lets go of the lock");
    }

    fn lock_released(path: &Path) -> bool {
        SessionWriter::open(path).is_ok()
    }

    #[test]
    fn deltas_of_one_kind_merge_and_a_call_closes_the_prose() {
        let dir = tmp();
        let mut r = Recorder::start(dir.path(), "a", "sub-a-1", "do it");
        r.record(&StreamEvent::Reasoning { text: "h".into() });
        r.record(&StreamEvent::Reasoning { text: "m".into() });
        r.record(&token("hel"));
        r.record(&token("lo"));
        r.record(&StreamEvent::ToolCallStarted {
            id: "1".into(),
            name: "read".into(),
        });
        r.record(&StreamEvent::ToolCallArgsDelta {
            id: "1".into(),
            delta: "{\"pa".into(),
        });
        r.record(&StreamEvent::ToolCall {
            id: "1".into(),
            name: "read".into(),
            args: serde_json::json!({ "path": "x" }),
        });
        r.record(&StreamEvent::Step { index: 2, max: 0 });
        let display = read(dir.path(), "a").display;
        assert_eq!(display.len(), 2, "{display:?}");
        let DisplayEntry::Assistant {
            text, reasoning, ..
        } = &display[0]
        else {
            panic!("{display:?}");
        };
        assert_eq!(text, "hello");
        assert_eq!(
            reasoning,
            &vec![ReasoningSeg {
                at: 0,
                text: "hm".into()
            }]
        );
        assert!(matches!(&display[1], DisplayEntry::ToolCall { id, .. } if id == "1"));
        r.finish(&Ok("hello".into()));
    }

    #[test]
    fn the_file_exists_at_start_and_tracks_each_step() {
        let dir = tmp();
        let mut r = Recorder::start(dir.path(), "worker", "sub-worker-1", "the task");
        let meta = read(dir.path(), "worker").meta.unwrap();
        assert_eq!(meta.status, RunStatus::Running);
        assert_eq!(meta.prompt, "the task");
        assert_eq!(meta.run_id, "sub-worker-1");
        r.record(&token("partial"));
        assert!(
            read(dir.path(), "worker").display.is_empty(),
            "tokens alone do not write the file"
        );
        r.record(&StreamEvent::Step { index: 2, max: 0 });
        assert_eq!(read(dir.path(), "worker").display.len(), 1);
        r.finish(&Ok("ok".into()));
        let meta = read(dir.path(), "worker").meta.unwrap();
        assert_eq!(meta.status, RunStatus::Finished);
        assert_eq!(meta.output.as_deref(), Some("ok"));
        assert_eq!(meta.error, None);
    }

    #[test]
    fn a_dropped_recorder_marks_the_run_stopped() {
        let dir = tmp();
        drop(Recorder::start(dir.path(), "w", "sub-w-1", "p"));
        assert_eq!(status(dir.path(), "w"), RunStatus::Stopped);
    }

    /// `finish` consumes the recorder and then it drops: the drop must see the
    /// record already closed, or every clean run would be rewritten `stopped`.
    #[test]
    fn a_finished_or_failed_recorder_keeps_its_status_after_it_drops() {
        let dir = tmp();
        Recorder::start(dir.path(), "w", "sub-w-1", "p").finish(&Ok("answer".into()));
        assert_eq!(status(dir.path(), "w"), RunStatus::Finished);
        Recorder::start(dir.path(), "x", "sub-x-1", "p").finish(&Err("upstream 500".into()));
        let meta = read(dir.path(), "x").meta.unwrap();
        assert_eq!(meta.status, RunStatus::Failed);
        assert_eq!(meta.error.as_deref(), Some("upstream 500"));
        assert_eq!(meta.output, None);
    }

    /// A message the parent steers a child with is part of the child's run, so
    /// the record keeps it as a user turn, persisted at once.
    #[test]
    fn a_steering_message_is_recorded_as_a_user_turn() {
        let dir = tmp();
        let mut r = Recorder::start(dir.path(), "w", "sub-w-1", "p");
        r.record(&token("working"));
        r.user_message(&serde_json::json!({ "role": "user", "content": "also check b" }));
        let display = read(dir.path(), "w").display;
        assert!(matches!(&display[0], DisplayEntry::Assistant { text, .. } if text == "working"));
        assert_eq!(
            display[1],
            DisplayEntry::User {
                text: "also check b".into(),
                images: Vec::new()
            }
        );
        drop(r);
    }

    /// A later run under a reused name starts from nothing: the earlier run's
    /// entries are cut back, not mixed into the new one.
    #[test]
    fn a_reused_name_starts_a_clean_record() {
        let dir = tmp();
        let mut first = Recorder::start(dir.path(), "w", "sub-w-1", "one");
        first.record(&token("old"));
        first.record(&StreamEvent::MessagesUpdated {
            messages: wire_history(),
        });
        first.finish(&Ok("old".into()));
        let second = Recorder::start(dir.path(), "w", "sub-w-2", "two");
        let record = read(dir.path(), "w");
        assert!(record.messages.is_empty() && record.display.is_empty(), "{record:?}");
        assert_eq!(record.meta.unwrap().run_id, "sub-w-2");
        drop(second);
    }

    #[test]
    fn a_subagent_session_lives_under_the_scratch_subagents_dir() {
        let scratch = Path::new("/c/jan/p-1/scratch/s");
        assert_eq!(
            session_path(scratch, "explore-2"),
            Path::new("/c/jan/p-1/scratch/s/subagents/explore-2-session.jsonl")
        );
    }

    /// The scratch is shell-writable: a link planted at the session file's
    /// name, or in place of `subagents/`, must not make `/agents` read (or the
    /// recorder write) a host file.
    #[cfg(unix)]
    #[test]
    fn planted_symlinks_are_refused() {
        let dir = tmp();
        let scratch = dir.path().join("scratch");
        let subagents = scratch.join(tauri_plugin_agent_tools::tools::spill::SUBAGENT_DIR);
        std::fs::create_dir_all(&subagents).unwrap();
        let victim = dir.path().join("victim");
        std::fs::write(&victim, "keep\n").unwrap();
        std::os::unix::fs::symlink(&victim, session_path(&scratch, "w")).unwrap();
        assert!(load(&scratch, "w").is_err());
        drop(Recorder::start(&subagents, "w", "sub-w-1", "p"));
        assert_eq!(std::fs::read_to_string(&victim).unwrap(), "keep\n");

        let elsewhere = dir.path().join("elsewhere");
        std::fs::create_dir_all(&elsewhere).unwrap();
        Recorder::start(&elsewhere, "v", "sub-v-1", "p").finish(&Ok("x".into()));
        std::fs::remove_dir_all(&subagents).unwrap();
        std::os::unix::fs::symlink(&elsewhere, &subagents).unwrap();
        assert!(load(&scratch, "v").is_err());
    }

    #[test]
    fn a_missing_session_loads_empty() {
        let dir = tmp();
        let scratch = dir.path();
        std::fs::create_dir_all(scratch.join("subagents")).unwrap();
        let loaded = load(scratch, "nobody").unwrap();
        assert_eq!(loaded.record, session_log::SessionRecord::default());
    }

    /// The session file is in the scratch, so ending the session takes it
    /// away with the scratch (the CLI/TUI exit path: into trash).
    #[tokio::test]
    async fn a_subagent_session_file_is_deleted_with_the_session_scratch() {
        use tauri_plugin_agent_tools::workspace::{ensure_scratch_dir_path, trash_scratch_dir_in};
        let project = tmp();
        let session = format!("subagent-session-exit-{}", std::process::id());
        let cache = crate::core::agent::project::project_cache_dir(project.path());
        let scratch = ensure_scratch_dir_path(&crate::core::agent::project::scratch_dir(
            project.path(),
            &session,
        ))
        .await
        .unwrap();
        let dir = tauri_plugin_agent_tools::tools::spill::validated_subdir(
            &scratch,
            tauri_plugin_agent_tools::tools::spill::SUBAGENT_DIR,
        )
        .unwrap();
        Recorder::start(&dir, "w", "sub-w-1", "p").finish(&Ok("ok".into()));
        let path = session_path(&scratch, "w");
        assert_eq!(
            load(&scratch, "w").unwrap().record.meta.unwrap().status,
            RunStatus::Finished
        );
        trash_scratch_dir_in(&cache, &session).await.unwrap();
        assert!(!path.exists());
        assert!(!session_log::lock_path(&path).exists());
        let _ = std::fs::remove_dir_all(&cache);
    }
}
