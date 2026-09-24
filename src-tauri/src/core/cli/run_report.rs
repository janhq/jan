//! Machine-readable result envelope for a non-interactive `jan cli agent run`.
//!
//! The human output of a run is a stream: prose on stdout, progress on stderr.
//! `--output-format json` replaces it with a single object printed once the run
//! is over, so a caller can branch on `is_error` and read `result` without
//! parsing terminal chatter. The object is assembled from the same
//! [`StreamEvent`]s the printer consumes -- there is no second source of truth.
//!
//! `--output-format stream-json` is the same envelope preceded by the trace:
//! one JSON object per line on stdout, flushed as each event is produced, with
//! the envelope as the last line. The wire shape of a trace line is
//! [`StreamEvent`]'s own `#[serde(tag = "type")]` serialization, so the tags a
//! consumer matches on are the snake_case variant names: `token`, `reasoning`,
//! `step`, `tool_call_started`, `tool_call_args_delta`, `tool_call`,
//! `tool_output_delta`, `tool_result`, `subagent_start`, `subagent_queued`,
//! `subagent_end`, `subagent_plan`, `subagent`, `notice`, `monitors`,
//! `parked`, `messages_updated`, `ask_request`, `ask_resolved`, `todo_update`,
//! `turn_usage`, `done`, `error`, `permission_request`, `tool_request`,
//! `tool_request_cancelled`, `tool_details`, `request_provenance`. Four tags are
//! minted by
//! the CLI rather than by the loop: `init`, `permission_decision`, `result` and
//! `input_error`. `init` is the handshake a client reads before any other record
//! (see [`Init`]); `permission_decision` reports how this CLI answered a gated
//! tool call, which the loop never sees; `result` is the terminal envelope;
//! `input_error` (defined in [`stream_input`](super::stream_input)) reports a
//! client line the parser rejected.
//!
//! The tag lists above and in `events.rs` are the contract. One test compares
//! the loop tags against the variants that serialize, and another compares the
//! CLI-minted tags against the records that mint them -- a renamed tag is a
//! breaking change for every consumer, so it must not be able to land quietly.
//!
//! `monitors`, `parked` and `notice` are display-only progress; a consumer that
//! only wants the outcome can read the last line alone. Unknown tags must be
//! ignored rather than treated as an error -- new variants are additive.

use crate::core::agent::events::StreamEvent;
use tauri_plugin_agent_tools::tools::gate::PermissionDecision;

/// How a non-interactive run reports itself.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, clap::ValueEnum)]
pub enum OutputFormat {
    /// Streamed prose on stdout, progress on stderr (the default).
    #[default]
    Text,
    /// A single result object on stdout when the run finishes.
    Json,
    /// One NDJSON record per event on stdout, terminated by the result object.
    StreamJson,
}

impl OutputFormat {
    /// Stdout belongs to a program rather than a person: no prose, no spinner,
    /// and the result envelope is printed even when the run failed at setup.
    pub(crate) fn is_machine(self) -> bool {
        matches!(self, OutputFormat::Json | OutputFormat::StreamJson)
    }

    pub(crate) fn is_stream_json(self) -> bool {
        matches!(self, OutputFormat::StreamJson)
    }
}

/// One NDJSON record: the compact serialization plus its terminating newline.
/// Serialization of a `StreamEvent` is infallible in practice; an encoding
/// failure yields no line rather than a truncated one a consumer would choke on.
pub(crate) fn ndjson_line<T: serde::Serialize>(value: &T) -> Option<String> {
    serde_json::to_string(value).ok().map(|mut s| {
        s.push('\n');
        s
    })
}

/// How the CLI answered a [`StreamEvent::PermissionRequest`]. The loop does not
/// emit this: the decision is made here, and without it a piped consumer sees
/// the request and never learns that the run was denied.
#[derive(serde::Serialize, schemars::JsonSchema)]
pub(crate) struct PermissionDecisionRecord<'a> {
    /// The record's tag. A consumer switches on it, so the schema states the
    /// value rather than leaving it an open string.
    #[serde(rename = "type")]
    #[schemars(extend("const" = "permission_decision"))]
    kind: &'static str,
    request_id: &'a str,
    decision: &'static str,
}

impl<'a> PermissionDecisionRecord<'a> {
    pub(crate) fn new(request_id: &'a str, decision: PermissionDecision) -> Self {
        Self {
            kind: "permission_decision",
            request_id,
            decision: match decision {
                PermissionDecision::AllowOnce => "allow_once",
                PermissionDecision::AllowAlways => "allow_always",
                PermissionDecision::Deny => "deny",
            },
        }
    }
}

/// Terminal outcome of a run, accumulated from its event stream.
#[derive(Default)]
pub(crate) struct RunReport {
    /// Assistant prose of the turn in flight, reset at each `Step` so a failed
    /// run still reports what the model had said before it broke.
    partial: String,
    stop_reason: Option<String>,
    error: Option<(String, String)>,
    num_turns: u32,
    /// Billable tokens across every request of the run, including subagents'.
    /// The same accumulator `/usage` sums a TUI session with.
    usage: super::model_catalog::TokenUsage,
    /// Cache totals, `None` until some request reports the field. A route that
    /// reports no cache fields must not serialize as `0`: that is byte-identical
    /// to an honest zero, and an honest zero -- a prefix written every turn and
    /// never read -- is the alarm this counter exists to raise.
    cached_tokens: Option<u64>,
    cache_write_tokens: Option<u64>,
    /// Provider execution ids seen this run, in request order. Each is a handle
    /// to one billing record; the `usage` above is only an estimate of the same
    /// requests.
    execution_ids: Vec<String>,
}

impl RunReport {
    /// A run that failed before the event stream existed (bad config, no
    /// reachable provider): no turns, no usage, just the failure.
    pub(crate) fn setup_failure(message: &str) -> Self {
        let mut report = Self::default();
        report.observe(&StreamEvent::Error {
            code: "setup_error".to_string(),
            message: message.to_string(),
        });
        report
    }

    /// Fold one event into the report. Cheap enough to call on every event, so
    /// the collector runs in both output formats and only printing differs.
    pub(crate) fn observe(&mut self, ev: &StreamEvent) {
        match ev {
            StreamEvent::Step { index, .. } => {
                self.num_turns = self.num_turns.max(*index);
                self.partial.clear();
            }
            StreamEvent::Token { text } => self.partial.push_str(text),
            // Reasoning is display-only: it must not enter the piped/plain-text
            // report answer, which is reserved for the final completion.
            StreamEvent::Reasoning { .. } => {}
StreamEvent::TurnUsage {
                usage,
                execution_id,
            } => {
                self.usage.add(usage);
                // Recorded so a scripted run can look up what the provider
                // actually charged for each request it made, rather than only
                // the local estimate this report already carries.
                if let Some(id) = execution_id {
                    self.execution_ids.push(id.clone());
                }
                accumulate(&mut self.cached_tokens, usage.cached_tokens);
                accumulate(&mut self.cache_write_tokens, usage.cache_write_tokens);
            }
            // Subagent work is real spend on the same budget, so its usage
            // counts. Its `Step`/`Token` must not: those describe the child's
            // own turns and prose, not this run's.
            StreamEvent::Subagent { event, .. } => {
                if let StreamEvent::TurnUsage { .. } = **event {
                    self.observe(event);
                }
            }
            StreamEvent::Done { stop_reason, .. } => {
                self.stop_reason = Some(stop_reason.clone());
            }
            StreamEvent::Error { code, message } => {
                self.error = Some((code.clone(), message.clone()));
            }
            _ => {}
        }
    }

    /// Render the envelope. `final_text` is the completion the run returned;
    /// on failure there is none and the partial prose stands in for it.
    pub(crate) fn finish(
        self,
        session_id: Option<&str>,
        provider: Option<&str>,
        model: &str,
        duration_ms: u128,
        final_text: Option<&str>,
    ) -> RunResult {
        let is_error = self.error.is_some();
        RunResult {
            kind: "result",
            protocol_version: crate::core::agent::events::PROTOCOL_VERSION,
            is_error,
            result: super::tui::answer_without_reasoning(final_text.unwrap_or(&self.partial)),
            stop_reason: if is_error {
                "error".to_string()
            } else {
                self.stop_reason.unwrap_or_else(|| "stop".to_string())
            },
            error: self.error.map(|(code, message)| RunError {
                code: error_code(&code, &message),
                message,
            }),
            session_id: session_id.map(str::to_string),
            model: model.to_string(),
            num_turns: self.num_turns,
            duration_ms: duration_ms as u64,
            usage: ReportUsage {
                prompt_tokens: self.usage.prompt_tokens,
                completion_tokens: self.usage.completion_tokens,
                total_tokens: self.usage.total_tokens(),
                cached_tokens: self.cached_tokens,
                cache_write_tokens: self.cache_write_tokens,
                // Priced from the model catalog the last `/models` listing
                // cached. Absent for a model whose provider publishes no
                // prices, rather than reported as zero.
                estimated_cost_usd: self
                    .usage
                    .cost_usd(super::model_catalog::load().get(provider, model)),
                execution_ids: (!self.execution_ids.is_empty())
                    .then(|| self.execution_ids.clone()),
            },
        }
    }
}

/// The first record of a `--output-format stream-json` channel, and the only
/// one a client may require before any other.
///
/// It exists because the rest of the stream is unversioned and unaddressable: a
/// consumer sees events and nothing else, so it cannot tell which contract it
/// is reading, whose run it is watching, or what it is allowed to send back.
/// Those are the questions a handshake answers, and a consumer that has to
/// infer them from a side channel (a CLI flag it passed, a config file it read)
/// is one refactor away from being wrong.
///
/// Field names are snake_case like the rest of this channel -- the event tags
/// and the envelope's `session_id`/`stop_reason` set that convention, so the
/// handshake follows it rather than introducing a second one for two fields.
///
/// The compatibility rule for what a client may assume:
///
/// - a v1 client may rely on `protocol_version`, `session_id` and `model`
///   always being present;
/// - fields may be added without a version bump, so a client ignores unknown
///   ones and unknown tags rather than failing;
/// - a tag is never renamed and never removed within v1;
/// - behaviour beyond v1 is asserted against `protocol_version`, not assumed.
#[derive(serde::Serialize, schemars::JsonSchema)]
pub(crate) struct Init {
    /// The record's tag. A consumer switches on it, so the schema states the
    /// value rather than leaving it an open string.
    #[serde(rename = "type")]
    #[schemars(extend("const" = "init"))]
    kind: &'static str,
    /// [`PROTOCOL_VERSION`](crate::core::agent::events::PROTOCOL_VERSION) at
    /// the time of the run, so a client can refuse a channel it cannot read
    /// instead of misreading it.
    protocol_version: u32,
    /// The thread this run saves under. Minted before the first turn rather
    /// than at save time, so a client learns the id from the stream: the same
    /// id `--resume` takes. A run that produces no completion saves nothing,
    /// and its terminal envelope reports `session_id: null` -- which is how a
    /// client tells this id apart from one that now exists on disk.
    ///
    /// The envelope reports the short form (the first 8 characters) it has
    /// always reported; this is the same id, unabbreviated.
    session_id: String,
    /// The model this run dispatches to, as the envelope reports it.
    model: String,
    /// The project root the run's tools are confined to, absolute. `null` for
    /// a caller that built the run's arguments without one -- every CLI run
    /// resolves a root before the run starts -- so the field never names a
    /// directory that is not the one the tools are confined to.
    cwd: Option<String>,
    /// The tool names this run advertises, in the order the request carries
    /// them. Order matters to the consumer: it is the prefix of the request a
    /// provider caches on, so a set that reorders between runs is a cache miss
    /// (see the tool-ordering note in `upstream.rs`).
    tools: Vec<String>,
    /// The full schemas of the host tools this run advertises. A host compares
    /// these against what it declared, which is the only way to know its
    /// constraints survived rather than trusting that they did; the names in
    /// `tools` alone cannot answer that.
    ///
    /// This is the advertised subset, not everything declared: a deny list, an
    /// allowlist or Plan mode can withhold a host tool, and its absence here is
    /// how a host learns that happened. Omitted entirely when the run
    /// advertises no host tools, so an ordinary run's handshake is unchanged.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    tool_specs: Vec<serde_json::Value>,
    /// What `--input-format stream-json` accepts from this client, as message
    /// `type` tags. Empty when the run does not read stdin at all, which is
    /// the honest answer for a read-only stream: nothing can be sent back.
    input_kinds: Vec<&'static str>,
    /// The content-part form of the `user` message, when this run accepts it:
    /// the caps a client must stay inside and the image types it may send.
    /// `null` when the run reads no stdin -- there is no channel to describe --
    /// which is also why this is additively separate from `input_kinds`: a
    /// client that reads only the kinds still learns `user`, and one that
    /// negotiates the caps gets them from the same record.
    input_content_parts: Option<InputContentParts>,
}

/// The caps on a content-part array -- a `user` message's, and a `tool_result`'s,
/// which is held to the same limits -- as `init` advertises them.
///
/// A client that sends an image is sending bytes into a channel with no
/// backpressure, so the limits are part of the handshake rather than something
/// to discover by being rejected. Each is the cap the parser enforces: this is
/// the same constant, not a copy of it.
#[derive(serde::Serialize, schemars::JsonSchema)]
pub(crate) struct InputContentParts {
    /// The image types an `image_url` part may name, as MIME types.
    mime_types: Vec<&'static str>,
    /// Most decoded bytes one image may carry.
    max_image_bytes: usize,
    /// Most decoded bytes across the images of one message.
    max_message_image_bytes: usize,
    /// Most images one message may carry.
    max_images: usize,
    /// Most bytes one input line may occupy. Applies to every kind, not just
    /// `user`: the cap is the reader's, before anything is parsed.
    max_line_bytes: usize,
    /// Most bytes of a rejected line `input_error` echoes back.
    max_echo_bytes: usize,
}

impl InputContentParts {
    pub(crate) fn current() -> Self {
        use super::stream_input;
        Self {
            mime_types: super::user_message::IMAGE_MIME_TYPES.to_vec(),
            max_image_bytes: stream_input::MAX_IMAGE_BYTES,
            max_message_image_bytes: stream_input::MAX_MESSAGE_IMAGE_BYTES,
            max_images: stream_input::MAX_IMAGES,
            max_line_bytes: stream_input::MAX_LINE_BYTES,
            max_echo_bytes: stream_input::MAX_ECHO_BYTES,
        }
    }
}

impl Init {
    pub(crate) fn new(
        session_id: &str,
        model: &str,
        cwd: Option<String>,
        tools: Vec<String>,
        tool_specs: Vec<serde_json::Value>,
        input_kinds: Vec<&'static str>,
        input_content_parts: Option<InputContentParts>,
    ) -> Self {
        Self {
            kind: "init",
            protocol_version: crate::core::agent::events::PROTOCOL_VERSION,
            session_id: session_id.to_string(),
            model: model.to_string(),
            cwd,
            tools,
            tool_specs,
            input_kinds,
            input_content_parts,
        }
    }
}

/// The envelope itself. A struct rather than a `json!` literal so the fields
/// serialize in declaration order: `serde_json`'s map is sorted, which would
/// print this contract alphabetically and bury `result` in the middle.
#[derive(serde::Serialize, schemars::JsonSchema)]
pub(crate) struct RunResult {
    /// The record's tag. A consumer switches on it, so the schema states the
    /// value rather than leaving it an open string.
    #[serde(rename = "type")]
    #[schemars(extend("const" = "result"))]
    kind: &'static str,
    /// The same contract version `init` carries, so a `--output-format json`
    /// caller -- which never sees an init record -- can still pin what it is
    /// reading. Additive: a consumer that does not know the field ignores it.
    protocol_version: u32,
    is_error: bool,
    result: String,
    stop_reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<RunError>,
    /// `null` when nothing was persisted, which is any run that failed before
    /// producing a completion: there is no session to resume.
    session_id: Option<String>,
    model: String,
    num_turns: u32,
    duration_ms: u64,
    usage: ReportUsage,
}

#[derive(serde::Serialize, schemars::JsonSchema)]
struct RunError {
    code: String,
    message: String,
}

#[derive(serde::Serialize, schemars::JsonSchema)]
struct ReportUsage {
    prompt_tokens: u64,
    completion_tokens: u64,
    total_tokens: u64,
    /// `null` on a route that reports no cache fields at all; `0` when it
    /// reported zero reads. Piped consumers branch on the difference.
    cached_tokens: Option<u64>,
    cache_write_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    estimated_cost_usd: Option<f64>,
    /// Provider execution ids for the requests this run made, when the upstream
    /// returned them. `jan usage generation <id>` turns one into the recorded
    /// charge -- the authoritative counterpart to `estimated_cost_usd`. Omitted
    /// rather than empty when none were reported, so its absence is never read
    /// as "no requests were made".
    #[serde(skip_serializing_if = "Option::is_none")]
    execution_ids: Option<Vec<String>>,
}

/// Fold one request's optional cache total into the run's. An absent field adds
/// nothing -- there is no number to attribute -- so the total stays `None` until
/// a route reports one, while a reported zero creates it. `unwrap_or(0)` here
/// would erase exactly the distinction [ReportUsage] exists to keep.
fn accumulate(total: &mut Option<u64>, reported: Option<u64>) {
    if let Some(value) = reported {
        *total = Some(total.unwrap_or(0) + value);
    }
}

/// A stable, machine-readable code for a failure. The loop stamps every
/// terminal error `"error"`, which tells a caller nothing; the message it
/// carries is what distinguishes a blown context window from a refused
/// request, and only those two are classified -- an invented taxonomy would be
/// worse than falling back to the raw code.
fn error_code(code: &str, message: &str) -> String {
    if crate::core::agent::upstream::is_context_overflow_error(message) {
        return "context_overflow".to_string();
    }
    if message.starts_with("Upstream ") {
        return "upstream_error".to_string();
    }
    code.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::agent::events::Usage;

    /// The module's doc comment as one string. The prose is line-wrapped in the
    /// source, so a phrase its marker quotes can straddle a line break, and
    /// reading the doc comment alone keeps a marker from matching its own
    /// mention in the tests below -- which is how a parse can silently return
    /// nothing and still look green.
    fn module_doc(source: &str) -> String {
        source
            .lines()
            .take_while(|line| line.starts_with("//!"))
            .map(|line| line.trim_start_matches("//!").trim_start())
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// The backticked tags in the module doc comment, read from the sentence
    /// that introduces them. Deliberately a parse of the prose: a list nothing
    /// reads is how the tags and the enum drifted apart in the first place, and
    /// the failure mode of a rewording is a test that says so, not a consumer
    /// that meets an unknown tag in production.
    ///
    /// Panics rather than returning an empty list, because "the marker moved"
    /// and "the list is empty" are the same nothing to every caller here.
    fn documented_tags_after<'a>(doc: &'a str, marker: &str) -> Vec<&'a str> {
        let after_marker = doc
            .split_once(marker)
            .unwrap_or_else(|| panic!("the doc comment no longer says {marker:?}"))
            .1;
        // The list reads "`tag`, `tag`, ... `last`.", so the backtick-separated
        // segments alternate gap and tag, and a period in a gap is the sentence
        // boundary that ends it -- the tag before that gap is still in the list.
        let mut segments = after_marker.split('`');
        let mut tags = Vec::new();
        let mut gap = segments.next().unwrap_or_default();
        while !gap.contains('.') {
            let Some(tag) = segments.next() else { break };
            tags.push(tag);
            // Missing trailing prose means the list ran to the end of the text.
            gap = segments.next().unwrap_or(".");
        }
        assert!(
            !tags.is_empty(),
            "no tags parsed after {marker:?}: the doc comment was reworded"
        );
        tags
    }

    /// The variant names the enum declares, read from its own source. Variants
    /// sit at one indentation level inside the body and their fields sit
    /// deeper, which is what tells the two apart.
    fn declared_variants(source: &str) -> Vec<&str> {
        let body = source
            .split_once("pub enum StreamEvent {")
            .expect("the enum's declaration moved")
            .1;
        body.split("\n}")
            .next()
            .expect("the enum is unterminated")
            .lines()
            .filter_map(|line| {
                // Four spaces is the body's own indent: anything deeper is a
                // field inside a variant, and anything else is an attribute or
                // a comment.
                let rest = line.strip_prefix("    ")?;
                if rest.starts_with(' ') || rest.starts_with("//") || rest.starts_with("#[") {
                    return None;
                }
                let end = rest
                    .find(|c: char| !c.is_alphanumeric() && c != '_')
                    .unwrap_or(rest.len());
                rest[..end].starts_with(char::is_uppercase).then_some(&rest[..end])
            })
            .collect()
    }

    /// Two views of the loop's half of the contract: the tags the doc comment
    /// promises and the tags its instances actually serialize. The enum side
    /// is [`every_declared_variant_is_documented_and_sampled`], which pins the
    /// sample list to the variants; between them, a tag cannot be renamed or
    /// dropped without a test saying so.
    #[test]
    fn the_documented_loop_tags_are_the_variants_that_serialize() {
        let source = include_str!("run_report.rs");
        let doc = module_doc(source);
        let documented = documented_tags_after(&doc, "the snake_case variant names: ");

        let samples = crate::core::agent::events::tests::sample_events();
        let mut serialized: Vec<String> = samples
            .iter()
            .map(|(name, ev)| {
                serde_json::to_value(ev).unwrap()["type"]
                    .as_str()
                    .unwrap_or_else(|| panic!("{name} has no tag"))
                    .to_string()
            })
            .collect();
        serialized.sort();

        let mut documented: Vec<String> = documented.iter().map(|t| t.to_string()).collect();
        documented.sort();
        assert_eq!(
            documented, serialized,
            "the loop tags this module documents and the tags that serialize have diverged"
        );
    }

    /// The CLI's half of the contract. These tags have no `StreamEvent` variant
    /// to serialize, so they are compared against the records that do mint them:
    /// the doc comment and each record's `kind` have to move together.
    #[test]
    fn the_documented_minted_tags_are_the_ones_the_records_serialize() {
        let doc = module_doc(include_str!("run_report.rs"));
        let documented =
            documented_tags_after(&doc, "the CLI rather than by the loop: ");

        let minted = [
            serde_json::to_value(Init::new(
                "id",
                "m",
                Some("/tmp".to_string()),
                Vec::new(),
                Vec::new(),
                Vec::new(),
                None,
            ))
            .unwrap(),
            serde_json::to_value(RunReport::default().finish(None, None, "m", 1, None)).unwrap(),
            serde_json::to_value(PermissionDecisionRecord::new(
                "req",
                PermissionDecision::AllowOnce,
            ))
            .unwrap(),
            serde_json::to_value(crate::core::cli::stream_input::InputErrorRecord::new(
                "unknown type 'x'", "{}",
            ))
            .unwrap(),
        ];
        let mut serialized: Vec<&str> = minted
            .iter()
            .map(|record| {
                record["type"]
                    .as_str()
                    .unwrap_or_else(|| panic!("a minted record has no tag: {record}"))
            })
            .collect();
        serialized.sort_unstable();

        let mut documented = documented.clone();
        documented.sort_unstable();
        assert_eq!(
            documented, serialized,
            "the CLI-minted tags the doc comment promises and the tags its records mint have diverged"
        );
    }

    /// The tag list must cover every variant the enum declares, not just the
    /// ones sampled: a variant nobody samples is a tag a consumer can meet
    /// while the documentation still denies it exists.
    #[test]
    fn every_declared_variant_is_documented_and_sampled() {
        let enum_source = include_str!("../agent/events.rs");
        let mut declared = declared_variants(enum_source);
        declared.sort_unstable();
        assert!(declared.len() >= 24, "{} variants", declared.len());

        let mut sampled: Vec<&str> = crate::core::agent::events::tests::sample_events()
            .iter()
            .map(|(name, _)| *name)
            .collect();
        sampled.sort_unstable();
        assert_eq!(
            sampled, declared,
            "the sample list and the enum's own variants disagree"
        );
    }

    /// The handshake's wire shape, field by field. A consumer asserting
    /// `protocol_version == 1` at startup is the whole point of the record, so
    /// the name and the version it carries are the contract, not an internal
    /// detail that a rename may move.
    #[test]
    fn init_carries_the_version_and_the_run_it_names() {
        let out = serde_json::to_value(Init::new(
            "3f7a91c2-0000-0000-0000-000000000000",
            "stub-model",
            Some("/tmp/project".to_string()),
            vec!["read".to_string(), "write".to_string()],
            Vec::new(),
            vec!["user", "abort", "permission"],
            Some(InputContentParts::current()),
        ))
        .unwrap();
        assert_eq!(
            out,
            serde_json::json!({
                "type": "init",
                "protocol_version": crate::core::agent::events::PROTOCOL_VERSION,
                "session_id": "3f7a91c2-0000-0000-0000-000000000000",
                "model": "stub-model",
                "cwd": "/tmp/project",
                "tools": ["read", "write"],
                "input_kinds": ["user", "abort", "permission"],
                // The caps a client stays inside, as the wire carries them.
                // Pinned as literals in both places a client reads them from:
                // here the record, and in the CLI's own suite the handshake as
                // it actually reaches stdout.
                "input_content_parts": {
                    "mime_types": ["image/png", "image/jpeg", "image/gif", "image/webp"],
                    "max_image_bytes": 5_242_880,
                    "max_message_image_bytes": 10_485_760,
                    "max_images": 8,
                    "max_line_bytes": 16_777_216,
                    "max_echo_bytes": 4_096,
                },
            })
        );
    }

    /// R5: a host compares the schemas it gets back against the ones it sent,
    /// so they travel in the handshake verbatim -- constraints a normalizer
    /// would strip included.
    #[test]
    fn init_echoes_the_host_tool_schemas_it_installed() {
        let spec = serde_json::json!({
            "type": "function",
            "function": {
                "name": "host__observe",
                "description": "look",
                "parameters": {
                    "type": "object",
                    "properties": { "n": { "type": "array", "minItems": 2 } },
                    "additionalProperties": false
                }
            }
        });
        let out = serde_json::to_value(Init::new(
            "id",
            "m",
            Some("/tmp".to_string()),
            vec!["host__observe".to_string()],
            vec![spec.clone()],
            vec!["user", "tool_result"],
            None,
        ))
        .unwrap();
        assert_eq!(out["tool_specs"], serde_json::json!([spec]));
    }

    /// A run that does not read stdin accepts nothing, and the record says so
    /// with an empty list rather than by omitting the field: a client asking
    /// "may I send anything back?" gets an answer either way.
    #[test]
    fn init_with_no_input_channel_advertises_no_kinds() {
        let out = serde_json::to_value(Init::new(
            "id",
            "m",
            Some("/tmp".to_string()),
            Vec::new(),
            Vec::new(),
            Vec::new(),
            None,
        ))
        .unwrap();
        assert_eq!(out["input_kinds"], serde_json::json!([]));
        assert_eq!(out["input_kinds"].as_array().unwrap().len(), 0);
        // And no caps to describe: there is no channel for them to bound, so a
        // client reads `null` rather than a limit that applies to nothing.
        assert!(out["input_content_parts"].is_null(), "{out}");
    }

    /// A run given no project root reports none. The alternative -- a path
    /// that stands in for one -- would answer "what are the tools confined
    /// to?" with a directory nothing is confined to.
    #[test]
    fn init_without_a_project_root_reports_cwd_absent() {
        let out = serde_json::to_value(Init::new(
            "id",
            "m",
            None,
            Vec::new(),
            Vec::new(),
            Vec::new(),
            None,
        ))
        .unwrap();
        assert!(out["cwd"].is_null(), "{out}");
        assert!(
            out.get("tool_specs").is_none(),
            "a run with no host tools leaves the handshake as it was: {out}"
        );
    }

    /// The envelope carries the same version, so a `--output-format json`
    /// caller -- which never sees an `init` record -- can pin it too.
    #[test]
    fn the_envelope_carries_the_protocol_version() {
        let out = RunReport::default().finish(None, None, "m", 1, None);
        let out = serde_json::to_value(out).unwrap();
        assert_eq!(
            out["protocol_version"],
            serde_json::json!(crate::core::agent::events::PROTOCOL_VERSION)
        );
    }

    fn usage(prompt: u64, completion: u64) -> Usage {
        Usage {
            prompt_tokens: Some(prompt),
            completion_tokens: Some(completion),
            total_tokens: Some(prompt + completion),
            ..Default::default()
        }
    }

    fn value(result: RunResult) -> serde_json::Value {
        serde_json::to_value(result).unwrap()
    }

    fn token(text: &str) -> StreamEvent {
        StreamEvent::Token {
            text: text.to_string(),
        }
    }

    #[test]
    fn success_envelope_matches_the_documented_shape() {
        let mut report = RunReport::default();
        for ev in [
            StreamEvent::Step { index: 1, max: 0 },
            StreamEvent::TurnUsage {
                usage: usage(9011, 655),
                execution_id: None,
            },
            token("done"),
            StreamEvent::Done {
                stop_reason: "end_turn".to_string(),
                usage: None,
            },
        ] {
            report.observe(&ev);
        }
        let out = value(report.finish(
            Some("3f7a91c2"),
            None,
            "tokamak-1-preview",
            48213,
            Some("done"),
        ));

        assert_eq!(out["type"], "result");
        assert_eq!(out["is_error"], false);
        assert_eq!(out["result"], "done");
        assert_eq!(out["stop_reason"], "end_turn");
        assert_eq!(out["session_id"], "3f7a91c2");
        assert_eq!(out["model"], "tokamak-1-preview");
        assert_eq!(out["num_turns"], 1);
        assert_eq!(out["duration_ms"], 48213u64);
        assert_eq!(out["usage"]["prompt_tokens"], 9011);
        assert_eq!(out["usage"]["completion_tokens"], 655);
        assert_eq!(out["usage"]["total_tokens"], 9666);
        assert!(out.get("error").is_none(), "success carries no error key");
    }

    #[test]
    fn failure_reports_the_partial_answer_and_a_classified_code() {
        let mut report = RunReport::default();
        for ev in [
            StreamEvent::Step { index: 1, max: 0 },
            StreamEvent::TurnUsage {
                usage: usage(8123, 0),
                execution_id: None,
            },
            token("I started reviewing auth.rs and"),
            StreamEvent::Error {
                code: "error".to_string(),
                message: "Upstream returned HTTP 400: tool_choice does not match".to_string(),
            },
        ] {
            report.observe(&ev);
        }
        let out = value(report.finish(Some("3f7a91c2"), None, "tokamak-1-preview", 1204, None));

        assert_eq!(out["is_error"], true);
        assert_eq!(out["result"], "I started reviewing auth.rs and");
        assert_eq!(out["stop_reason"], "error");
        assert_eq!(out["error"]["code"], "upstream_error");
        assert_eq!(
            out["error"]["message"],
            "Upstream returned HTTP 400: tool_choice does not match"
        );
        assert_eq!(out["usage"]["total_tokens"], 8123);
    }

    #[test]
    fn partial_answer_is_the_last_turn_only_and_drops_reasoning() {
        let mut report = RunReport::default();
        for ev in [
            StreamEvent::Step { index: 1, max: 0 },
            token("first turn prose"),
            StreamEvent::Step { index: 2, max: 0 },
            token("<think>deliberating</think>second turn prose"),
            StreamEvent::Error {
                code: "error".to_string(),
                message: "boom".to_string(),
            },
        ] {
            report.observe(&ev);
        }
        let out = value(report.finish(None, None, "m", 1, None));
        assert_eq!(out["result"], "second turn prose");
        assert_eq!(out["num_turns"], 2);
        // Unclassifiable messages keep the code the loop stamped.
        assert_eq!(out["error"]["code"], "error");
        assert_eq!(out["session_id"], serde_json::Value::Null);
    }

    /// A route that reports no cache fields leaves both totals `null`; a route
    /// that honestly reports zero reads reports `0`. `unwrap_or(0)` upstream
    /// would make them the same byte, erasing the one case worth alerting on.
    #[test]
    fn cache_totals_distinguish_a_reported_zero_from_no_report() {
        let envelope = |events: Vec<StreamEvent>| {
            let mut report = RunReport::default();
            for ev in events {
                report.observe(&ev);
            }
            value(report.finish(None, None, "m", 1, Some("done")))
        };
        let turn = |usage| StreamEvent::TurnUsage { usage, execution_id: None };

        let silent = envelope(vec![turn(usage(1_000, 10))]);
        assert!(silent["usage"]["cached_tokens"].is_null(), "{silent}");
        assert!(silent["usage"]["cache_write_tokens"].is_null(), "{silent}");

        let reported = envelope(vec![turn(Usage {
            cached_tokens: Some(0),
            cache_write_tokens: Some(40),
            ..usage(1_000, 10)
        })]);
        assert_eq!(reported["usage"]["cached_tokens"], 0);
        assert_eq!(reported["usage"]["cache_write_tokens"], 40);

        // A later request that omits the fields adds nothing and does not erase
        // what an earlier one reported: the session total still describes the
        // tokens that were really spent.
        let mixed = envelope(vec![
            turn(Usage {
                cached_tokens: Some(900),
                ..usage(1_000, 10)
            }),
            turn(usage(1_000, 10)),
        ]);
        assert_eq!(mixed["usage"]["cached_tokens"], 900);
    }

    #[test]
    fn usage_accumulates_across_turns_and_subagents() {
        let mut report = RunReport::default();
        let child = |ev: StreamEvent| StreamEvent::Subagent {
            run_id: "r".to_string(),
            name: "child".to_string(),
            event: Box::new(ev),
        };
        for ev in [
            StreamEvent::Step { index: 1, max: 0 },
            StreamEvent::TurnUsage {
                usage: usage(100, 10),
                execution_id: None,
            },
            child(StreamEvent::TurnUsage {
                usage: usage(50, 5),
                execution_id: None,
            }),
            // A child's own turns and prose belong to the child, not this run.
            child(StreamEvent::Step { index: 9, max: 0 }),
            child(token("child prose")),
            StreamEvent::Step { index: 2, max: 0 },
            StreamEvent::TurnUsage {
                usage: usage(200, 20),
                execution_id: None,
            },
        ] {
            report.observe(&ev);
        }
        let out = value(report.finish(None, None, "m", 1, Some("answer")));
        assert_eq!(out["num_turns"], 2);
        assert_eq!(out["result"], "answer");
        assert_eq!(out["usage"]["prompt_tokens"], 350);
        assert_eq!(out["usage"]["completion_tokens"], 35);
        assert_eq!(out["usage"]["total_tokens"], 385);
    }

    /// A priced model carries its estimated cost in the envelope, so a script
    /// can budget without re-deriving prices; an unpriced one omits the field
    /// rather than reporting the run as free.
    #[test]
    fn the_envelope_prices_the_run_when_the_catalog_knows_the_model() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let mut catalog = crate::core::cli::model_catalog::Catalog::default();
            catalog.set_provider(
                "tokamak",
                std::collections::BTreeMap::from([(
                    "priced-model".to_string(),
                    crate::core::cli::model_catalog::ModelInfo {
                        prompt_usd: Some(0.000001),
                        completion_usd: Some(0.00001),
                        ..Default::default()
                    },
                )]),
            );
            catalog.save().expect("seed catalog");

            let mut report = RunReport::default();
            report.observe(&StreamEvent::TurnUsage {
                usage: usage(1_000_000, 100_000),
                execution_id: None,
            });
            let out = value(report.finish(None, None, "priced-model", 1, Some("done")));
            assert_eq!(out["usage"]["estimated_cost_usd"], 2.0);

            let mut report = RunReport::default();
            report.observe(&StreamEvent::TurnUsage {
                usage: usage(1_000, 100),
                execution_id: None,
            });
            let out = value(report.finish(None, None, "unknown-model", 1, Some("done")));
            assert!(
                out["usage"].get("estimated_cost_usd").is_none(),
                "an unpriced model must not report a cost"
            );
        });
    }

    /// The printed order is part of the contract: a human reading the envelope
    /// should hit `result` near the top, not alphabetically between `num_turns`
    /// and `session_id`.
    #[test]
    fn keys_serialize_in_the_documented_order() {
        let mut report = RunReport::default();
        report.observe(&StreamEvent::Error {
            code: "error".to_string(),
            message: "boom".to_string(),
        });
        let printed = serde_json::to_string(&report.finish(None, None, "m", 1, None)).unwrap();
        let order = [
            "\"type\"",
            "\"is_error\"",
            "\"result\"",
            "\"stop_reason\"",
            "\"error\"",
            "\"session_id\"",
            "\"model\"",
            "\"num_turns\"",
            "\"duration_ms\"",
            "\"usage\"",
        ];
        let mut at = 0;
        for key in order {
            let found = printed[at..]
                .find(key)
                .unwrap_or_else(|| panic!("{key} missing or out of order in {printed}"));
            at += found + key.len();
        }
    }

    /// The stream-json contract: every record is independently parseable on its
    /// own line, carries a `type` tag, and the envelope is the last one.
    #[test]
    fn the_ndjson_stream_parses_line_by_line_and_ends_with_the_result() {
        let events = [
            StreamEvent::Step { index: 1, max: 0 },
            StreamEvent::ToolCall {
                id: "call_1".to_string(),
                name: "bash".to_string(),
                args: serde_json::json!({ "command": "echo \"hi\"\nls" }),
            },
            token("done\nand done"),
            StreamEvent::Done {
                stop_reason: "end_turn".to_string(),
                usage: None,
            },
        ];
        let mut report = RunReport::default();
        let mut stream = String::new();
        for ev in &events {
            report.observe(ev);
            stream.push_str(&ndjson_line(ev).unwrap());
        }
        stream.push_str(
            &ndjson_line(&PermissionDecisionRecord::new(
                "perm-1",
                PermissionDecision::Deny,
            ))
            .unwrap(),
        );
        stream.push_str(
            &ndjson_line(&report.finish(None, None, "m", 1, Some("done\nand done"))).unwrap(),
        );

        assert!(stream.ends_with('\n'));
        let lines: Vec<&str> = stream.lines().collect();
        assert_eq!(lines.len(), events.len() + 2);
        let parsed: Vec<serde_json::Value> = lines
            .iter()
            .map(|line| serde_json::from_str(line).expect("each line parses on its own"))
            .collect();
        let tags: Vec<&str> = parsed
            .iter()
            .map(|v| v["type"].as_str().expect("every record is tagged"))
            .collect();
        assert_eq!(
            tags,
            [
                "step",
                "tool_call",
                "token",
                "done",
                "permission_decision",
                "result"
            ]
        );
        assert_eq!(parsed[4]["decision"], "deny");
        assert_eq!(parsed[4]["request_id"], "perm-1");
        assert_eq!(parsed[5]["result"], "done\nand done");
    }

    #[test]
    fn context_overflow_is_classified_from_the_marker() {
        let mut report = RunReport::default();
        report.observe(&StreamEvent::Error {
            code: "error".to_string(),
            message: "[context-overflow] Upstream returned HTTP 400: too long".to_string(),
        });
        let out = value(report.finish(None, None, "m", 1, None));
        assert_eq!(out["error"]["code"], "context_overflow");
    }
}
