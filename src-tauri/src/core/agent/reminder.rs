//! Hidden guidance folded into an agent conversation (todo nudges and the
//! like). Two problems this module owns.
//!
//! It is marked with `<SYSTEM>` so the model can tell it from user-authored
//! text, and so the surfaces that enumerate user *turns* -- the rewind picker,
//! input recall, workspace checkpoints -- can skip a message that only exists
//! to carry a reminder. Those indices are shared with the display journal,
//! which never held the reminder, so an unmarked one drifted them out of step.
//!
//! And it is folded into the trailing message rather than pushed as its own
//! whenever that message is the user's own, unanswered. It is never folded into
//! a `tool` message: tool output is untrusted, so guidance appended there would
//! sit inside attacker-reachable text, and output that carried its own
//! `<SYSTEM>` block would be indistinguishable from a real reminder. A `system`
//! message is not an option either -- many models accept only one.

use serde_json::Value;

pub const OPEN_TAG: &str = "<SYSTEM>";
pub const CLOSE_TAG: &str = "</SYSTEM>";

pub fn wrap(text: &str) -> String {
    format!("{OPEN_TAG}\n{text}\n{CLOSE_TAG}")
}

/// Fold a reminder into `messages` so it reaches the model as late as possible
/// without inventing a turn. A trailing `user` message has not been answered
/// yet, so the marked text is appended to it in flight. Anything else trailing
/// -- an assistant turn, or a tool result the reminder must not be mixed into
/// -- means prompting another turn requires a `user` message of its own, so one
/// is pushed carrying the marked text alone, which `is_reminder_only` then
/// recognizes.
pub fn attach(messages: &mut Vec<Value>, text: &str) {
    let marked = wrap(text);
    let open = messages
        .last()
        .and_then(|m| m.get("role"))
        .and_then(|v| v.as_str())
        == Some("user");
    if open {
        let content = messages
            .last_mut()
            .expect("last() matched above")
            .get_mut("content");
        match content {
            Some(Value::String(s)) => {
                s.push_str("\n\n");
                s.push_str(&marked);
                return;
            }
            Some(Value::Array(parts)) => {
                parts.push(serde_json::json!({ "type": "text", "text": marked }));
                return;
            }
            _ => {}
        }
    }
    messages.push(serde_json::json!({ "role": "user", "content": marked }));
}

/// True when `text` is a reminder and nothing else, i.e. it was never typed by
/// the user. Text that merely had one appended is not one.
pub fn is_reminder_text(text: &str) -> bool {
    let text = text.trim();
    text.starts_with(OPEN_TAG) && text.ends_with(CLOSE_TAG)
}

/// Drop every reminder block from `text`, leaving what the user actually typed.
/// The display surfaces (input recall, rewind fill, transcript rebuild) go
/// through this, so an in-flight reminder never comes back as text to re-send.
pub fn strip(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(OPEN_TAG) {
        out.push_str(&rest[..start]);
        rest = match rest[start..].find(CLOSE_TAG) {
            Some(end) => &rest[start + end + CLOSE_TAG.len()..],
            // Unterminated: nothing after the marker is user text either.
            None => "",
        };
    }
    out.push_str(rest);
    out.trim().to_string()
}

/// `is_reminder_text` over a wire `content` field. A content-part array is never
/// reminder-only: `attach` only ever adds a part to a message that had one.
pub fn is_reminder_only(content: &Value) -> bool {
    content.as_str().is_some_and(is_reminder_text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Tool output is untrusted and may itself contain a `<SYSTEM>` block, so a
    /// reminder is never mixed into it -- it takes its own turn instead.
    #[test]
    fn a_trailing_tool_result_is_never_appended_to() {
        let mut messages = vec![
            json!({ "role": "user", "content": "do it" }),
            json!({ "role": "tool", "tool_call_id": "a", "content": "ok" }),
        ];
        attach(&mut messages, "keep going");
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[1]["content"], json!("ok"));
        assert_eq!(messages[2]["role"], json!("user"));
        assert!(is_reminder_only(&messages[2]["content"]));
    }

    #[test]
    fn a_trailing_user_message_absorbs_the_reminder_in_flight() {
        let mut messages = vec![json!({ "role": "user", "content": "do it" })];
        attach(&mut messages, "keep going");
        assert_eq!(messages.len(), 1);
        assert!(messages[0]["content"]
            .as_str()
            .unwrap()
            .starts_with("do it\n\n"));
        assert!(!is_reminder_only(&messages[0]["content"]));
    }

    #[test]
    fn a_content_part_array_gains_a_text_part() {
        let mut messages = vec![json!({
            "role": "user",
            "content": [{ "type": "text", "text": "look" }],
        })];
        attach(&mut messages, "keep going");
        assert_eq!(messages.len(), 1);
        let parts = messages[0]["content"].as_array().unwrap();
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[1]["text"], json!(wrap("keep going")));
    }

    #[test]
    fn a_trailing_assistant_message_gets_a_reminder_only_turn() {
        let mut messages = vec![
            json!({ "role": "user", "content": "do it" }),
            json!({ "role": "assistant", "content": "done" }),
        ];
        attach(&mut messages, "keep going");
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[2]["role"], json!("user"));
        assert!(is_reminder_only(&messages[2]["content"]));
    }

    #[test]
    fn an_empty_conversation_gets_a_reminder_only_turn() {
        let mut messages = Vec::new();
        attach(&mut messages, "keep going");
        assert_eq!(messages.len(), 1);
        assert!(is_reminder_only(&messages[0]["content"]));
    }

    #[test]
    fn strip_leaves_only_what_the_user_typed() {
        assert_eq!(strip(&format!("first\n\n{}", wrap("nudge"))), "first");
        assert_eq!(strip(&wrap("nudge")), "");
        assert_eq!(strip("plain"), "plain");
        assert_eq!(strip("head <SYSTEM>a</SYSTEM> tail"), "head  tail");
        assert_eq!(strip("head <SYSTEM>unterminated"), "head");
    }

    #[test]
    fn ordinary_text_is_not_a_reminder() {
        assert!(!is_reminder_only(&json!("hello")));
        assert!(!is_reminder_only(
            &json!([{ "type": "text", "text": "hi" }])
        ));
        assert!(!is_reminder_only(&Value::Null));
    }
}
