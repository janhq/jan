//! Agent-status emission for terminal integrations (Orca, #8819).
//!
//! Two evidence layers are produced, both written straight to the PTY (raw
//! stdout) rather than through the ratatui frame buffer, so status reaches
//! the host terminal even when no terminal view is rendered:
//!
//! 1. **OSC 9999 agent-status protocol** - `\x1b]9999;{json}\x07` with a JSON
//!    payload carrying `agentType` and `state` (`working` | `blocked` |
//!    `waiting` | `done`).
//! 2. **Terminal titles (OSC 2)** - a spinner glyph + `Jan` while working,
//!    `Jan - action required` while blocked/waiting, and `Jan ready` when idle.
//!
//! Orca 1.4.191 accepts Jan's OSC 9999 status, but its `tui-idle` wait does not
//! consume that protocol or recognize Jan's settled titles. Jan icons and
//! title-based idle recognition require Orca-side support.

use std::io::{self, Write};

/// `agentType` value reported to status consumers.
const AGENT_TYPE: &str = "jan";
/// OSC 9999 introducer; the payload is terminated by BEL (or ST, not used here).
const OSC_9999_PREFIX: &str = "\x1b]9999;";
/// OSC 2 sets the window title.
const OSC_TITLE_PREFIX: &str = "\x1b]2;";

/// Agent states understood by the OSC 9999 protocol.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentStatusState {
    /// A turn is in progress.
    Working,
    /// A permission prompt needs a decision.
    Blocked,
    /// The agent asked a question and awaits the user's answer.
    Waiting,
    /// No turn is running; the session is idle.
    Done,
}

impl AgentStatusState {
    /// Wire representation of the state.
    pub fn as_str(self) -> &'static str {
        match self {
            AgentStatusState::Working => "working",
            AgentStatusState::Blocked => "blocked",
            AgentStatusState::Waiting => "waiting",
            AgentStatusState::Done => "done",
        }
    }
}

/// Braille frames used to animate the working title.
const SPINNER_FRAMES: [&str; 10] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/// Title shown while a turn is running (spinner frame + agent name).
fn working_title(frame: usize) -> String {
    format!("{} Jan", SPINNER_FRAMES[frame % SPINNER_FRAMES.len()])
}

/// Title shown when waiting for input or idle.
fn settled_title(state: AgentStatusState) -> &'static str {
    match state {
        AgentStatusState::Blocked | AgentStatusState::Waiting => "Jan - action required",
        AgentStatusState::Working | AgentStatusState::Done => "Jan ready",
    }
}

/// Build the OSC 9999 escape sequence for a state transition.
///
/// The payload is a single-line JSON object; BEL terminates the sequence.
/// `prompt` is the optional activity preview Orca renders on its cards; it is
/// truncated to 160 Unicode scalar values before JSON escaping.
pub fn agent_status_sequence(state: AgentStatusState, prompt: Option<&str>) -> String {
    let prompt = prompt
        .map(|p| p.chars().take(160).collect::<String>())
        .unwrap_or_default();
    if prompt.is_empty() {
        // Omit an empty preview.
        format!(
            "{OSC_9999_PREFIX}{{\"agentType\":\"{AGENT_TYPE}\",\"state\":\"{}\"}}\x07",
            state.as_str()
        )
    } else {
        // Escape terminal controls as JSON so prompt text cannot end the OSC.
        let prompt = serde_json::to_string(&prompt).expect("string serialization cannot fail");
        format!(
            "{OSC_9999_PREFIX}{{\"agentType\":\"{AGENT_TYPE}\",\"state\":\"{}\",\"prompt\":{prompt}}}\x07",
            state.as_str()
        )
    }
}

/// Build the OSC 2 window-title sequence for a state.
///
/// `spinner_frame` selects the animated indicator used while working; it is
/// ignored for terminal states.
pub fn title_sequence(state: AgentStatusState, spinner_frame: usize) -> String {
    let title = match state {
        AgentStatusState::Working => working_title(spinner_frame),
        _ => settled_title(state).to_string(),
    };
    format!("{OSC_TITLE_PREFIX}{title}\x07")
}

/// Tracks the last reported state and writes transitions to the PTY.
///
/// Every state change is emitted exactly once (deduped), as an OSC 9999
/// payload plus an OSC 2 title. Writes happen directly on stdout, outside the
/// ratatui frame, so hidden/background sessions are tracked too. Until
/// [`AgentStatusReporter::enable`] is called the reporter is inert: no bytes
/// reach stdout, which keeps test-driven state machines quiet.
#[derive(Debug, Default)]
pub struct AgentStatusReporter {
    enabled: bool,
    last_state: Option<AgentStatusState>,
    last_prompt: Option<String>,
    spinner_frame: usize,
}

impl AgentStatusReporter {
    /// Create a disabled reporter (emits nothing until enabled).
    pub fn new() -> Self {
        Self::default()
    }

    /// Start emitting to stdout. Called by the real TUI once the terminal is
    /// set up; unit tests construct `App` through paths that leave it off.
    pub fn enable(&mut self) {
        self.enabled = true;
    }

    /// Compute the sequences for a state transition.
    ///
    /// Returns `None` when the state is unchanged and the prompt preview is
    /// identical (transitions are deduped), otherwise the `(status, title)`
    /// sequences to write.
    fn transition(
        &mut self,
        state: AgentStatusState,
        prompt: Option<&str>,
    ) -> Option<(String, String)> {
        if self.last_state == Some(state) && self.last_prompt.as_deref() == prompt {
            return None;
        }
        self.last_state = Some(state);
        self.last_prompt = prompt.map(str::to_string);
        self.spinner_frame = 0;
        Some((
            agent_status_sequence(state, prompt),
            title_sequence(state, self.spinner_frame),
        ))
    }

    /// Report a state transition, writing OSC 9999 and the title to stdout.
    pub fn set_state(&mut self, state: AgentStatusState, prompt: Option<&str>) {
        let Some((status, title)) = self.transition(state, prompt) else {
            return;
        };
        if self.enabled {
            write_raw(&status);
            write_raw(&title);
        }
    }

    /// Advance the animated working title by one frame.
    ///
    /// No-op unless currently `working`. Call from the render tick; the deduped
    /// OSC 9999 payload is not re-sent. The frame advances even when disabled
    /// (so test state machines track it); only the stdout write is gated.
    pub fn animate(&mut self) {
        if self.last_state != Some(AgentStatusState::Working) {
            return;
        }
        self.spinner_frame = (self.spinner_frame + 1) % SPINNER_FRAMES.len();
        if self.enabled {
            write_raw(&title_sequence(
                AgentStatusState::Working,
                self.spinner_frame,
            ));
        }
    }
}

/// Write a raw escape sequence to stdout and flush, ignoring errors the way
/// the clipboard OSC 52 write does: a failed PTY write must never take down
/// the TUI.
fn write_raw(sequence: &str) {
    let mut out = io::stdout();
    let _ = out.write_all(sequence.as_bytes());
    let _ = out.flush();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Extract the JSON payload from an OSC 9999 sequence, i.e. the bytes
    /// between the fixed introducer and the trailing BEL terminator.
    fn extract_payload(seq: &str) -> &str {
        seq.strip_prefix(OSC_9999_PREFIX)
            .and_then(|p| p.strip_suffix('\x07'))
            .expect("sequence must be framed by the OSC 9999 prefix and a trailing BEL")
    }

    /// Decode the extracted OSC 9999 payload as JSON.
    fn parse_payload(seq: &str) -> serde_json::Value {
        serde_json::from_str(extract_payload(seq)).expect("payload must be valid JSON")
    }

    #[test]
    fn payload_carries_agent_type_and_state() {
        assert_eq!(
            agent_status_sequence(AgentStatusState::Working, None),
            "\x1b]9999;{\"agentType\":\"jan\",\"state\":\"working\"}\x07"
        );
        assert_eq!(
            agent_status_sequence(AgentStatusState::Done, None),
            "\x1b]9999;{\"agentType\":\"jan\",\"state\":\"done\"}\x07"
        );
        assert_eq!(
            agent_status_sequence(AgentStatusState::Blocked, None),
            "\x1b]9999;{\"agentType\":\"jan\",\"state\":\"blocked\"}\x07"
        );
        assert_eq!(
            agent_status_sequence(AgentStatusState::Waiting, None),
            "\x1b]9999;{\"agentType\":\"jan\",\"state\":\"waiting\"}\x07"
        );
    }

    #[test]
    fn prompt_roundtrips_as_valid_json_payload() {
        // The prompt must survive decode exactly: quotes, backslashes,
        // tabs, newlines, carriage returns, and control chars all roundtrip.
        let prompt = "tab\there\nnewline\rCR \"double\" \\backslash \u{7}bel \u{1b}esc";
        let seq = agent_status_sequence(AgentStatusState::Working, Some(prompt));
        let payload = parse_payload(&seq);
        assert_eq!(
            payload["prompt"],
            serde_json::Value::String(prompt.to_string())
        );
        assert_eq!(payload["agentType"], "jan");
        assert_eq!(payload["state"], "working");
    }

    #[test]
    fn prompt_has_only_outer_framing_control_escapes() {
        // ESC and BEL must appear only as the OSC 9999 framing delimiters, never
        // inside the payload from an embedded control char.
        let prompt = "raw \u{7}\u{1b} control chars";
        let seq = agent_status_sequence(AgentStatusState::Working, Some(prompt));
        let body = extract_payload(&seq);
        assert!(!body.contains('\x1b') && !body.contains('\x07'));
        // The payload itself decodes to the original prompt.
        assert_eq!(
            parse_payload(&seq)["prompt"],
            serde_json::Value::String(prompt.to_string())
        );
    }

    #[test]
    fn prompt_truncation_holds_a_char_bound() {
        // A 160-char cap must never split a Unicode scalar; the truncated
        // prompt plus the escaped form must still decode to a valid string.
        let long: String = "a".repeat(400);
        let seq = agent_status_sequence(AgentStatusState::Working, Some(&long));
        let decoded = parse_payload(&seq)["prompt"]
            .as_str()
            .expect("prompt should be a JSON string")
            .to_string();
        assert_eq!(decoded.chars().count(), 160);

        // CJK/emoji scalars count as one char each and stay intact.
        let cjk: String = "漢".repeat(200);
        let seq = agent_status_sequence(AgentStatusState::Working, Some(&cjk));
        let decoded = parse_payload(&seq)["prompt"]
            .as_str()
            .expect("prompt should be a JSON string")
            .to_string();
        assert_eq!(decoded, "漢".repeat(160));

        let emoji: String = "🧑‍💻".repeat(200);
        let seq = agent_status_sequence(AgentStatusState::Working, Some(&emoji));
        let decoded = parse_payload(&seq)["prompt"]
            .as_str()
            .expect("prompt should be a JSON string")
            .to_string();
        assert!(decoded.chars().count() <= 160);
    }

    #[test]
    fn titles_describe_agent_state() {
        // Working: animated indicator + "Jan".
        assert!(title_sequence(AgentStatusState::Working, 0).contains(" Jan\x07"));
        assert_eq!(
            title_sequence(AgentStatusState::Working, 0),
            "\x1b]2;⠋ Jan\x07"
        );
        // Both kinds of input wait require user attention.
        assert_eq!(
            title_sequence(AgentStatusState::Blocked, 3),
            "\x1b]2;Jan - action required\x07"
        );
        assert_eq!(
            title_sequence(AgentStatusState::Waiting, 3),
            "\x1b]2;Jan - action required\x07"
        );
        // Idle: ready for another message.
        assert_eq!(
            title_sequence(AgentStatusState::Done, 3),
            "\x1b]2;Jan ready\x07"
        );
    }

    #[test]
    fn transitions_dedupe_and_reset_spinner() {
        let mut reporter = AgentStatusReporter::new();
        assert!(reporter.transition(AgentStatusState::Done, None).is_some());
        // Same state again: nothing to emit.
        assert!(reporter.transition(AgentStatusState::Done, None).is_none());
        assert!(reporter
            .transition(AgentStatusState::Working, None)
            .is_some());
        // Spinner frame survives across animate() calls and resets on
        // transitions.
        reporter.animate();
        assert_eq!(
            title_sequence(AgentStatusState::Working, reporter.spinner_frame),
            "\x1b]2;⠙ Jan\x07"
        );
        assert!(reporter.transition(AgentStatusState::Done, None).is_some());
        assert_eq!(reporter.spinner_frame, 0);
    }
}
