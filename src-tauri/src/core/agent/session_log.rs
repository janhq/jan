//! The session record: one ordered list of what was sent to and received from
//! the model, one ordered list of what the transcript showed, and the single
//! append-only file both live in.
//!
//! The wire messages are kept exactly as they went over the wire -- reasoning,
//! image parts, raw tool-call argument strings, compaction summaries, system
//! prompts, results of any size -- and come back with the same bytes. A resumed
//! request then shares the original's prefix, which is what lets a provider's
//! (or llama.cpp's) prompt cache serve it. Nothing here caps, clips or rewrites
//! a message; display-side caps belong to the renderer and never reach the file.
//!
//! The file is JSON lines. A save appends one batch: an optional `truncate`
//! (a rewind, a compaction or a cancel cut the lists short), the new messages
//! and display entries, then a `sync` line naming the lengths the batch leaves.
//! The batch is written with one `write_all` and synced to disk, and a reader
//! applies only what a `sync` line closed, so a crash loses at most the batch it
//! interrupted. Earlier lines are never rewritten: a truncated span stays in the
//! file, behind the `truncate` that hid it.
//!
//! Loading never writes. A [`SessionWriter`] holds an advisory lock beside the
//! file for as long as it lives, so two processes cannot interleave batches.
//!
//! A delegated run (a subagent) keeps its session in this same format, plus a
//! `meta` line saying who it was and how it ended ([`RunMeta`]); the last
//! committed one holds. Its file sits in the shell-writable session scratch, so
//! neither [`load`] nor [`SessionWriter::open`] follows a link planted at the
//! file's (or the lock's) name.

use std::borrow::Cow;
use std::io::{Seek, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The session file's name inside a thread directory.
pub const SESSION_FILE: &str = "session.jsonl";

/// Format version written in the header line.
const VERSION: u32 = 1;

/// One rendered transcript event, in emission order. Only what a replay needs
/// to rebuild rows.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DisplayEntry {
    User {
        text: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        images: Vec<String>,
    },
    /// A user turn the transcript does not show verbatim: a skill or plugin
    /// command, rendered as the compact `[skill:foo] args` row `label` holds,
    /// or a hidden canned prompt (`/init`), whose `label` is empty and which
    /// renders nothing. Recorded anyway because it *is* a turn: the rewind
    /// picker, recall and checkpoints count it in the conversation, so a
    /// record that skipped it would put every later cut one entry out.
    Invocation {
        /// The `[skill:foo]` tag, styled on its own. Empty for a hidden prompt,
        /// which renders no row at all.
        #[serde(default)]
        label: String,
        /// What followed it on the row: the user's args, else `- <description>`.
        #[serde(default, skip_serializing_if = "String::is_empty")]
        detail: String,
    },
    /// Answer prose exactly as streamed. Reasoning is not inlined into it:
    /// natively streamed `reasoning_content` rides along in `reasoning`, while
    /// an inline-tag provider's `<think>` markers are simply part of the prose
    /// it sent. An entry written before `reasoning` existed has its reasoning
    /// inside `text` as markers, which replays down the inline path unchanged.
    Assistant {
        text: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        reasoning: Vec<ReasoningSeg>,
        /// Milliseconds the turn spent reasoning, for the `Thought for Ns`
        /// label. Absent in an entry written before it existed, which replays
        /// as a plain `Thought`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reasoning_ms: Option<u64>,
    },
    ToolCall {
        id: String,
        name: String,
        args: Value,
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
        /// Why a child that ended on its own ended badly. `None` is a clean
        /// finish; an entry written before this field existed replays as one.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
        /// How long the child ran, in seconds, when it started on screen.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        elapsed_secs: Option<u64>,
        /// Where it worked (see `child_workspace::ChildWorkspace::label`).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        workspace: Option<String>,
    },
    /// A system note the transcript showed (an acknowledgement, a warning, a
    /// failure), so a resumed transcript reads the way the live one did.
    Note { text: String, level: NoteLevel },
    /// A message between the main agent and a subagent, recorded once where
    /// the TUI showed it (see `Transcript::agent_message`). Part of the
    /// conversation, not a note: the main agent's next move may answer it,
    /// so a resume must show it.
    AgentMessage { from: String, to: String, text: String },
    /// A note one subagent's run raised on the main transcript (a notice, a
    /// retry, a compaction), drawn with the agent as its title and `text`
    /// under it, so a resume shows what the child went through.
    AgentNote {
        agent: String,
        tone: NoteTone,
        text: String,
    },
}

/// How an [`DisplayEntry::AgentNote`] reads: its gutter mark and colour.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoteTone {
    /// A plain informational note.
    Info,
    /// Something the user should notice: a timeout, a failed command.
    Warn,
    /// A monitor condition matching.
    Monitor,
    /// A background command that finished.
    Finished,
}

/// How loud a note is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoteLevel {
    /// A dim acknowledgement or status note.
    Info,
    /// Something the user should notice but that needs no action.
    Warn,
    /// A failed turn, tool or command.
    Error,
    /// Work that completed successfully.
    Good,
}

/// One stretch of natively streamed reasoning, anchored to the byte offset in
/// the answer prose it arrived at. Keeping the offset (rather than splicing the
/// text into the prose) preserves emission order without ever encoding
/// reasoning as markup a later pass would have to parse back out.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReasoningSeg {
    pub at: usize,
    pub text: String,
}

fn default_true() -> bool {
    true
}

/// Where a delegated run stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Running,
    Finished,
    Failed,
    Stopped,
}

/// Who a delegated run was and how it ended. A main thread has none: its
/// metadata lives in `thread.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RunMeta {
    pub name: String,
    pub run_id: String,
    /// The task it was given.
    pub prompt: String,
    pub status: RunStatus,
    /// The final answer, once it finished.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    /// Why a failed or stopped run ended.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// The session in memory: the wire messages, the transcript entries and, for
/// a delegated run, its metadata.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SessionRecord {
    pub messages: Vec<Value>,
    pub display: Vec<DisplayEntry>,
    pub meta: Option<RunMeta>,
}

/// A loaded record plus how many lines were not applied: unparsable lines and
/// a batch a crash left without its `sync`.
#[derive(Debug, Default)]
pub struct Loaded {
    pub record: SessionRecord,
    pub skipped: usize,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Line<'a> {
    Session { version: u32 },
    Message { message: Cow<'a, Value> },
    Display { entry: Cow<'a, DisplayEntry> },
    Meta { meta: Cow<'a, RunMeta> },
    Truncate { messages: usize, display: usize },
    Sync { messages: usize, display: usize },
}

/// What a file holds, and the byte length its last `sync` closed.
struct Parsed {
    loaded: Loaded,
    committed_len: u64,
}

fn parse(bytes: &[u8]) -> Parsed {
    let mut record = SessionRecord::default();
    let mut pending: Vec<Line<'static>> = Vec::new();
    let mut skipped = 0;
    let mut committed_len = 0;
    let mut offset = 0;
    for raw in bytes.split_inclusive(|b| *b == b'\n') {
        offset += raw.len();
        let Some(body) = raw.strip_suffix(b"\n") else {
            // A torn last line: the write it belonged to never finished.
            skipped += 1;
            continue;
        };
        if body.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let Ok(line) = serde_json::from_slice::<Line<'static>>(body) else {
            skipped += 1;
            continue;
        };
        match line {
            Line::Session { version } => {
                if version > VERSION {
                    log::warn!("session file version {version} is newer than {VERSION}");
                }
            }
            Line::Sync { messages, display } => {
                apply(&mut record, pending.drain(..));
                if record.messages.len() != messages || record.display.len() != display {
                    log::warn!(
                        "session file: sync expected {messages}/{display} entries, \
                         replay has {}/{}",
                        record.messages.len(),
                        record.display.len()
                    );
                }
                committed_len = offset as u64;
            }
            other => pending.push(other),
        }
    }
    skipped += pending.len();
    Parsed {
        loaded: Loaded { record, skipped },
        committed_len,
    }
}

fn apply<'a>(record: &mut SessionRecord, lines: impl Iterator<Item = Line<'a>>) {
    for line in lines {
        match line {
            Line::Message { message } => record.messages.push(message.into_owned()),
            Line::Display { entry } => record.display.push(entry.into_owned()),
            Line::Meta { meta } => record.meta = Some(meta.into_owned()),
            Line::Truncate { messages, display } => {
                record.messages.truncate(messages);
                record.display.truncate(display);
            }
            Line::Session { .. } | Line::Sync { .. } => {}
        }
    }
}

/// Read a session file. Read-only: a torn or uncommitted tail is skipped and
/// counted, never repaired here. A missing file is an empty session; a link or
/// anything else that is not a regular file is refused.
pub fn load(path: &Path) -> std::io::Result<Loaded> {
    let mut file = match open_no_follow(std::fs::OpenOptions::new().read(true), path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Loaded::default()),
        Err(e) => return Err(e),
    };
    let mut bytes = Vec::new();
    std::io::Read::read_to_end(&mut file, &mut bytes)?;
    Ok(parse(&bytes).loaded)
}

/// Open `path` with `options`, refusing a symlink at the last component and
/// anything that is not a regular file. On Unix the open itself does not
/// follow a link (`O_NOFOLLOW`), so a link swapped in after the check is
/// refused too.
pub(crate) fn open_no_follow(
    options: &mut std::fs::OpenOptions,
    path: &Path,
) -> std::io::Result<std::fs::File> {
    if std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(std::io::Error::other(format!(
            "{} is a symlink",
            path.display()
        )));
    }
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::custom_flags(options, libc::O_NOFOLLOW);
    let file = options.open(path)?;
    if !file.metadata()?.is_file() {
        return Err(std::io::Error::other(format!(
            "{} is not a regular file",
            path.display()
        )));
    }
    Ok(file)
}

/// The advisory lock file guarding `path`. A sibling rather than the session
/// file itself, so a reader never contends with the lock (Windows refuses
/// reads of a range another handle has locked).
pub fn lock_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".lock");
    path.with_file_name(name)
}

/// Same value and same key order. `Value`'s own equality ignores the order of
/// object keys, and two objects that differ only there serialize to different
/// bytes -- a different prompt prefix.
fn identical(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .zip(y)
                    .all(|((ka, va), (kb, vb))| ka == kb && identical(va, vb))
        }
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(va, vb)| identical(va, vb))
        }
        _ => a == b,
    }
}

/// Take the lock, giving a holder that is on its way out a moment to let go:
/// a session that is exiting, or a child process that inherited the handle
/// between its fork and its exec.
fn try_lock(lock: &std::fs::File) -> Result<(), fs4::TryLockError> {
    const ATTEMPTS: u32 = 25;
    for _ in 1..ATTEMPTS {
        match fs4::FileExt::try_lock(lock) {
            Err(fs4::TryLockError::WouldBlock) => {
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            done => return done,
        }
    }
    fs4::FileExt::try_lock(lock)
}

fn common_prefix<T>(a: &[T], b: &[T], same: impl Fn(&T, &T) -> bool) -> usize {
    a.iter().zip(b).take_while(|(x, y)| same(x, y)).count()
}

fn push_line(body: &mut String, line: &Line<'_>) -> std::io::Result<()> {
    body.push_str(&serde_json::to_string(line).map_err(std::io::Error::other)?);
    body.push('\n');
    Ok(())
}

/// The one writer of a session file. Holds the advisory lock until dropped.
pub struct SessionWriter {
    path: PathBuf,
    file: std::fs::File,
    _lock: std::fs::File,
    record: SessionRecord,
    /// Bytes the last committed batch ended at: where a failed write is cut
    /// back to, so a half-written batch never merges with the next one.
    len: u64,
}

impl SessionWriter {
    /// Take the lock on `path` and read what it holds. Fails when another
    /// writer holds the lock. A tail no `sync` closed is cut off here, the one
    /// repair a writer makes, so its next batch starts on a clean line.
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let lock = open_no_follow(
            std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false),
            &lock_path(path),
        )
        .map_err(|e| e.to_string())?;
        try_lock(&lock).map_err(|e| match e {
            fs4::TryLockError::WouldBlock => format!(
                "{} is open in another session; close it there first",
                path.display()
            ),
            fs4::TryLockError::Error(e) => e.to_string(),
        })?;
        // Write access, not append: Windows grants an append-only handle no
        // `set_len`, and cutting the dead tail is what this open is for. Each
        // batch seeks to `len` itself instead.
        let mut file = open_no_follow(
            std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false),
            path,
        )
        .map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        std::io::Read::read_to_end(&mut file, &mut bytes).map_err(|e| e.to_string())?;
        let parsed = parse(&bytes);
        if parsed.committed_len < bytes.len() as u64 {
            file.set_len(parsed.committed_len)
                .map_err(|e| e.to_string())?;
        }
        Ok(Self {
            path: path.to_path_buf(),
            file,
            _lock: lock,
            record: parsed.loaded.record,
            len: parsed.committed_len,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// What the file holds.
    pub fn record(&self) -> &SessionRecord {
        &self.record
    }

    /// Bring the file to `messages` (and `display`, or the file's own display
    /// list when `None`): append a batch holding only what changed, cut back by
    /// a `truncate` when the lists shrank or diverged. Returns whether anything
    /// was written.
    pub fn sync(
        &mut self,
        messages: &[Value],
        display: Option<&[DisplayEntry]>,
    ) -> std::io::Result<bool> {
        let keep_m = common_prefix(&self.record.messages, messages, identical);
        let (keep_d, new_display) = match display {
            Some(d) => {
                let keep = common_prefix(&self.record.display, d, |a, b| a == b);
                (keep, &d[keep..])
            }
            None => (self.record.display.len(), &[][..]),
        };
        let shrinks = keep_m < self.record.messages.len() || keep_d < self.record.display.len();
        let display_len = keep_d + new_display.len();
        if !shrinks && keep_m == messages.len() && new_display.is_empty() {
            return Ok(false);
        }
        let mut body = String::new();
        if self.len == 0 {
            push_line(&mut body, &Line::Session { version: VERSION })?;
        }
        if shrinks {
            push_line(
                &mut body,
                &Line::Truncate {
                    messages: keep_m,
                    display: keep_d,
                },
            )?;
        }
        for message in &messages[keep_m..] {
            push_line(
                &mut body,
                &Line::Message {
                    message: Cow::Borrowed(message),
                },
            )?;
        }
        for entry in new_display {
            push_line(
                &mut body,
                &Line::Display {
                    entry: Cow::Borrowed(entry),
                },
            )?;
        }
        push_line(
            &mut body,
            &Line::Sync {
                messages: messages.len(),
                display: display_len,
            },
        )?;
        self.commit(&body)?;
        self.record.messages.truncate(keep_m);
        self.record.messages.extend_from_slice(&messages[keep_m..]);
        self.record.display.truncate(keep_d);
        self.record.display.extend_from_slice(new_display);
        Ok(true)
    }

    /// Record a delegated run's metadata as one `meta` + `sync` batch. Returns
    /// whether anything was written (nothing when it is unchanged).
    pub fn sync_meta(&mut self, meta: &RunMeta) -> std::io::Result<bool> {
        if self.record.meta.as_ref() == Some(meta) {
            return Ok(false);
        }
        let mut body = String::new();
        if self.len == 0 {
            push_line(&mut body, &Line::Session { version: VERSION })?;
        }
        push_line(
            &mut body,
            &Line::Meta {
                meta: Cow::Borrowed(meta),
            },
        )?;
        push_line(
            &mut body,
            &Line::Sync {
                messages: self.record.messages.len(),
                display: self.record.display.len(),
            },
        )?;
        self.commit(&body)?;
        self.record.meta = Some(meta.clone());
        Ok(true)
    }

    /// Append one batch with a single write and sync it to disk.
    fn commit(&mut self, body: &str) -> std::io::Result<()> {
        let written = self
            .file
            .seek(std::io::SeekFrom::Start(self.len))
            .and_then(|_| self.file.write_all(body.as_bytes()))
            .and_then(|()| self.file.sync_data());
        if let Err(e) = written {
            // Cut the partial batch off; if even that fails, the next load
            // still ignores it, since no `sync` closed it.
            let _ = self.file.set_len(self.len);
            return Err(e);
        }
        self.len += body.len() as u64;
        Ok(())
    }
}

/// Index just past the `target`-th (0-based) user turn, i.e. the length the
/// display list keeps when a rewind drops that message and everything after it.
/// `Invocation` counts alongside `User`: `target` comes from `is_user_turn` over
/// the conversation, which counts a skill, command or hidden prompt as a turn.
pub fn truncate_at_user(entries: &[DisplayEntry], target: usize) -> usize {
    let mut seen = 0;
    for (i, e) in entries.iter().enumerate() {
        if matches!(
            e,
            DisplayEntry::User { .. } | DisplayEntry::Invocation { .. }
        ) {
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
    use serde_json::json;

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
                reasoning: vec![ReasoningSeg {
                    at: 0,
                    text: "hm".into(),
                }],
                reasoning_ms: Some(1200),
            },
            DisplayEntry::ToolCall {
                id: "c1".into(),
                name: "write".into(),
                args: json!({ "path": "a.txt" }),
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
                error: None,
                elapsed_secs: Some(12),
                workspace: Some("/tmp/wt-a (jan/agent/scout)".into()),
            },
            DisplayEntry::Note {
                text: "compacted 40 -> 6 messages".into(),
                level: NoteLevel::Info,
            },
            DisplayEntry::Assistant {
                text: "Done.".into(),
                reasoning: Vec::new(),
                reasoning_ms: None,
            },
        ]
    }

    fn messages() -> Vec<Value> {
        vec![
            json!({ "role": "system", "content": "You are Jan." }),
            json!({ "role": "user", "content": [
                { "type": "text", "text": "look" },
                { "type": "image_url", "image_url": { "url": "data:image/png;base64,AAAA" } }
            ]}),
            json!({ "role": "assistant", "content": "", "reasoning_content": "think",
                    "tool_calls": [{ "id": "c1", "type": "function",
                    "function": { "name": "write", "arguments": "{ \"path\":\"a\" }" } }] }),
            json!({ "role": "tool", "tool_call_id": "c1", "content": "ok" }),
        ]
    }

    fn file() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t").join(SESSION_FILE);
        (dir, path)
    }

    #[test]
    fn a_synced_record_loads_back_whole() {
        let (_dir, path) = file();
        let mut writer = SessionWriter::open(&path).unwrap();
        assert!(writer.sync(&messages(), Some(&sample())).unwrap());
        let loaded = load(&path).unwrap();
        assert_eq!(loaded.skipped, 0);
        assert_eq!(loaded.record.messages, messages());
        assert_eq!(loaded.record.display, sample());
        assert_eq!(writer.record(), &loaded.record);
    }

    /// The bytes a message was sent with are the bytes it loads with: key
    /// order, raw argument strings and large payloads included.
    #[test]
    fn messages_keep_their_exact_bytes() {
        let (_dir, path) = file();
        let big = "x".repeat(200 * 1024);
        let sent: Vec<Value> = vec![
            serde_json::from_str(r#"{"z":1,"role":"user","a":[{"y":2.5,"b":null}],"content":"hi"}"#)
                .unwrap(),
            json!({ "role": "tool", "tool_call_id": "c", "content": big }),
        ];
        SessionWriter::open(&path)
            .unwrap()
            .sync(&sent, None)
            .unwrap();
        let back = load(&path).unwrap().record.messages;
        assert_eq!(
            serde_json::to_string(&back).unwrap(),
            serde_json::to_string(&sent).unwrap()
        );
    }

    /// Reordering an object's keys changes the request's bytes, so a sync must
    /// write it again even though `Value` equality calls it unchanged.
    #[test]
    fn a_key_reorder_is_a_change() {
        let (_dir, path) = file();
        let mut writer = SessionWriter::open(&path).unwrap();
        let a: Value = serde_json::from_str(r#"{"role":"user","content":"x"}"#).unwrap();
        let b: Value = serde_json::from_str(r#"{"content":"x","role":"user"}"#).unwrap();
        assert_eq!(a, b);
        writer.sync(std::slice::from_ref(&a), None).unwrap();
        assert!(writer.sync(std::slice::from_ref(&b), None).unwrap());
        assert_eq!(
            serde_json::to_string(&load(&path).unwrap().record.messages[0]).unwrap(),
            r#"{"content":"x","role":"user"}"#
        );
    }

    #[test]
    fn an_unchanged_record_writes_nothing() {
        let (_dir, path) = file();
        let mut writer = SessionWriter::open(&path).unwrap();
        writer.sync(&messages(), Some(&sample())).unwrap();
        let before = std::fs::read(&path).unwrap();
        assert!(!writer.sync(&messages(), Some(&sample())).unwrap());
        assert!(!writer.sync(&messages(), None).unwrap());
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }

    /// Growth appends; a cut is a `truncate` line, and the lines it hides stay
    /// in the file: earlier bytes are never rewritten.
    #[test]
    fn the_file_is_append_only() {
        let (_dir, path) = file();
        let mut writer = SessionWriter::open(&path).unwrap();
        let all = messages();
        writer.sync(&all[..2], Some(&sample()[..1])).unwrap();
        let first = std::fs::read(&path).unwrap();
        writer.sync(&all, Some(&sample())).unwrap();
        let second = std::fs::read(&path).unwrap();
        assert!(second.starts_with(&first));
        writer.sync(&all[..1], Some(&sample()[..1])).unwrap();
        let third = std::fs::read(&path).unwrap();
        assert!(third.starts_with(&second));
        let loaded = load(&path).unwrap().record;
        assert_eq!(loaded.messages, all[..1].to_vec());
        assert_eq!(loaded.display, sample()[..1].to_vec());
        let text = String::from_utf8(third).unwrap();
        assert!(text.contains("\"type\":\"truncate\""));
        assert!(text.contains("reasoning_content"), "the hidden span is kept");
    }

    /// `None` keeps the display list a surface without a transcript (headless,
    /// RPC, ACP) did not build, instead of cutting it.
    #[test]
    fn a_sync_without_display_keeps_the_display() {
        let (_dir, path) = file();
        let mut writer = SessionWriter::open(&path).unwrap();
        writer.sync(&messages()[..2], Some(&sample())).unwrap();
        writer.sync(&messages(), None).unwrap();
        assert_eq!(load(&path).unwrap().record.display, sample());
    }

    /// A crash mid-batch leaves lines with no `sync` (and maybe a torn one):
    /// the load ignores them and says so, and leaves the file as it found it.
    #[test]
    fn an_unsynced_tail_is_skipped_and_counted_without_a_write() {
        let (_dir, path) = file();
        let mut writer = SessionWriter::open(&path).unwrap();
        writer.sync(&messages()[..1], None).unwrap();
        drop(writer);
        std::fs::remove_file(lock_path(&path)).unwrap();
        let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(f, "{}", json!({ "type": "message", "message": { "role": "user" } })).unwrap();
        write!(f, "{{\"type\":\"mess").unwrap();
        drop(f);
        let before = std::fs::read(&path).unwrap();

        let loaded = load(&path).unwrap();
        assert_eq!(loaded.record.messages, messages()[..1].to_vec());
        assert_eq!(loaded.skipped, 2);
        assert_eq!(std::fs::read(&path).unwrap(), before, "loading never writes");
        assert!(!lock_path(&path).exists(), "loading takes no lock");

        // A writer cuts the dead tail before appending, so its batch parses.
        let mut writer = SessionWriter::open(&path).unwrap();
        writer.sync(&messages(), None).unwrap();
        let loaded = load(&path).unwrap();
        assert_eq!(loaded.record.messages, messages());
        assert_eq!(loaded.skipped, 0);
    }

    #[test]
    fn unknown_lines_are_skipped() {
        let (_dir, path) = file();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            "{\"type\":\"from_the_future\"}\n\
             {\"type\":\"display\",\"entry\":{\"kind\":\"user\",\"text\":\"hi\"}}\n\
             {\"type\":\"display\",\"entry\":{\"kind\":\"hologram\"}}\n\
             {\"type\":\"sync\",\"messages\":0,\"display\":1}\n",
        )
        .unwrap();
        let loaded = load(&path).unwrap();
        assert_eq!(loaded.record.display, vec![user("hi")]);
        assert_eq!(loaded.skipped, 2);
    }

    #[test]
    fn a_missing_file_is_an_empty_session() {
        let (_dir, path) = file();
        let loaded = load(&path).unwrap();
        assert_eq!(loaded.record, SessionRecord::default());
        assert_eq!(loaded.skipped, 0);
    }

    /// One writer per session file, across handles and processes alike.
    #[test]
    fn a_second_writer_is_refused_until_the_first_drops() {
        let (_dir, path) = file();
        let first = SessionWriter::open(&path).unwrap();
        let err = SessionWriter::open(&path).err().expect("lock is held");
        assert!(err.contains("another session"), "{err}");
        drop(first);
        assert!(SessionWriter::open(&path).is_ok());
    }

    fn meta(status: RunStatus) -> RunMeta {
        RunMeta {
            name: "scout".into(),
            run_id: "sub-scout-1".into(),
            prompt: "look around".into(),
            status,
            output: None,
            error: None,
        }
    }

    /// A delegated run's outcome rides in the same file as its messages and
    /// display entries: the last committed `meta` line is the one that holds.
    #[test]
    fn the_last_committed_meta_line_is_the_runs() {
        let (_dir, path) = file();
        let mut writer = SessionWriter::open(&path).unwrap();
        assert!(writer.sync_meta(&meta(RunStatus::Running)).unwrap());
        writer.sync(&messages(), Some(&sample())).unwrap();
        let done = RunMeta {
            output: Some("found it".into()),
            ..meta(RunStatus::Finished)
        };
        assert!(writer.sync_meta(&done).unwrap());
        assert!(!writer.sync_meta(&done).unwrap(), "an unchanged meta writes nothing");
        let loaded = load(&path).unwrap();
        assert_eq!(loaded.skipped, 0);
        assert_eq!(loaded.record.meta, Some(done));
        assert_eq!(loaded.record.messages, messages());
        assert_eq!(loaded.record.display, sample());
        assert_eq!(writer.record(), &loaded.record);
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("{\"type\":\"session\",\"version\":1}\n"), "{text}");
        assert!(text.contains("{\"type\":\"meta\",\"meta\":{\"name\":\"scout\""), "{text}");
    }

    /// A main thread's file has no `meta` line, and one written before the line
    /// existed loads as it always did.
    #[test]
    fn a_file_without_meta_loads_with_none() {
        let (_dir, path) = file();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            "{\"type\":\"session\",\"version\":1}\n\
             {\"type\":\"message\",\"message\":{\"role\":\"user\",\"content\":\"hi\"}}\n\
             {\"type\":\"sync\",\"messages\":1,\"display\":0}\n",
        )
        .unwrap();
        let loaded = load(&path).unwrap();
        assert_eq!(loaded.skipped, 0);
        assert_eq!(loaded.record.meta, None);
        assert_eq!(loaded.record.messages, vec![json!({ "role": "user", "content": "hi" })]);
    }

    /// A meta line no `sync` closed is a torn batch like any other.
    #[test]
    fn an_uncommitted_meta_line_is_skipped() {
        let (_dir, path) = file();
        let mut writer = SessionWriter::open(&path).unwrap();
        writer.sync_meta(&meta(RunStatus::Running)).unwrap();
        drop(writer);
        let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        let line = Line::Meta {
            meta: Cow::Owned(meta(RunStatus::Finished)),
        };
        writeln!(f, "{}", serde_json::to_string(&line).unwrap()).unwrap();
        drop(f);
        let loaded = load(&path).unwrap();
        assert_eq!(loaded.record.meta, Some(meta(RunStatus::Running)));
        assert_eq!(loaded.skipped, 1);
    }

    /// A session file can live in the shell-writable scratch (a subagent's), so
    /// a link planted at its name or its lock's must route nothing onto the
    /// file it points at, read or write.
    #[cfg(unix)]
    #[test]
    fn a_planted_symlink_is_neither_read_nor_written() {
        let (dir, path) = file();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let victim = dir.path().join("victim");
        std::fs::write(&victim, "keep\n").unwrap();
        std::os::unix::fs::symlink(&victim, &path).unwrap();
        assert!(load(&path).is_err());
        assert!(SessionWriter::open(&path).is_err());
        assert_eq!(std::fs::read_to_string(&victim).unwrap(), "keep\n");

        std::fs::remove_file(&path).unwrap();
        let _ = std::fs::remove_file(lock_path(&path));
        std::os::unix::fs::symlink(&victim, lock_path(&path)).unwrap();
        assert!(SessionWriter::open(&path).is_err());
        assert_eq!(std::fs::read_to_string(&victim).unwrap(), "keep\n");
    }

    #[test]
    fn a_directory_at_the_session_path_is_refused() {
        let (_dir, path) = file();
        std::fs::create_dir_all(&path).unwrap();
        assert!(load(&path).is_err());
        assert!(SessionWriter::open(&path).is_err());
    }

    #[test]
    fn truncate_at_user_cuts_the_whole_turn() {
        let mut entries = sample();
        entries.push(user("second"));
        entries.push(DisplayEntry::Assistant {
            text: "more".into(),
            reasoning: Vec::new(),
            reasoning_ms: None,
        });
        assert_eq!(truncate_at_user(&entries, 0), 0);
        assert_eq!(truncate_at_user(&entries, 1), 7, "cuts at the second user");
        assert_eq!(
            truncate_at_user(&entries, 9),
            entries.len(),
            "an out-of-range target keeps the log"
        );
    }

    /// A skill/command/hidden turn is a turn the rewind picker offers, so it
    /// has to advance the count as well or every later cut lands one turn late.
    #[test]
    fn truncate_at_user_counts_invocations_as_turns() {
        let entries = vec![
            user("first"),
            DisplayEntry::Invocation {
                label: "[skill:deploy]".into(),
                detail: String::new(),
            },
            DisplayEntry::Assistant {
                text: "ok".into(),
                reasoning: Vec::new(),
                reasoning_ms: None,
            },
            user("third"),
        ];
        assert_eq!(truncate_at_user(&entries, 1), 1, "cuts at the invocation");
        assert_eq!(truncate_at_user(&entries, 2), 3);
    }
}
