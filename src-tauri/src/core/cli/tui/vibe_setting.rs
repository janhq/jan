//! `/vibe-setting` (#9078): describe what you want in plain words and the agent
//! proposes the settings changes that get it, for you to confirm.
//!
//! The model only ever sees the `/settings` catalog (key, scope, type, default,
//! current value, description) and the request, in one stateless side call that
//! never touches the conversation -- so the session's cached prompt prefix is
//! the same whether or not the command is used. It must answer with a list of
//! `{key, scope, new_value, reason}` changes, which are validated here with the
//! same parser `/settings` uses, shown as a diff, and written only after an
//! explicit yes. Free-form TOML is never accepted.
//!
//! Deliberately narrow: only `/settings` keys, never credentials (the Claude
//! Code keychain toggle is left out of the catalog), and a change that widens
//! tool permissions needs a typed `yes` rather than a single key.

use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Paragraph};
use serde_json::{json, Value};

use super::{
    apply_live_setting, apply_live_unset, current_setting_value, parse_setting_input,
    setting_path, wrap_spans_hard, write_setting, AgentSettingDef, AgentSettingKind, App, KeyCode,
    KeyEvent, SettingScope, AGENT_SETTINGS,
};

/// `/settings` keys `/vibe-setting` may not propose. `claude_code_alias` decides
/// whether Jan reuses another tool's keychain login, and `hide_secrets` whether
/// credentials reach the provider: credential decisions, which the issue rules
/// out of anything the model (or text it read) can change.
const EXCLUDED_KEYS: &[&str] = &["claude_code_alias", "hide_secrets"];

/// `/settings` keys that `/reload config` re-applies to the running session
/// (see `reload_config` in tui.rs), so a written one needs no restart. Pinned
/// against `reload_config_entries` by a test, so the note can't drift.
pub(super) const RELOAD_CONFIG_KEYS: &[&str] = &[
    "context_window",
    "compaction_ratio",
    "compaction_reserve_tokens",
    "max_tokens",
    "budget.max_tokens",
    "send_reasoning",
];

/// The keys a proposal may name, in `/settings` order.
pub(super) fn catalog() -> impl Iterator<Item = &'static AgentSettingDef> {
    AGENT_SETTINGS
        .iter()
        .filter(|def| !EXCLUDED_KEYS.contains(&def.key))
}

/// One validated change: the key, what it is now, what it becomes (`None` =
/// removed, so its default applies), and the model's reason.
pub(super) struct VibeChange {
    pub def: &'static AgentSettingDef,
    pub current: Option<String>,
    pub new_value: Option<String>,
    pub item: Option<toml_edit::Item>,
    pub reason: String,
}

/// A proposal waiting on the user's answer in the confirm dock.
pub(super) struct VibeProposal {
    pub changes: Vec<VibeChange>,
    /// Entries the model returned that failed validation, each with why.
    pub refused: Vec<String>,
    /// Keys whose change widens tool permissions; non-empty means the dock asks
    /// for a typed `yes` instead of a single `y`.
    pub widens: Vec<String>,
    /// Anything the model could not do with these settings (a model switch, a
    /// provider), passed on so the request is not silently half-done.
    pub note: Option<String>,
    /// The confirmation line typed so far, for a widening proposal.
    pub typed: String,
    pub error: Option<String>,
}

impl VibeProposal {
    pub(super) fn paste(&mut self, text: &str) {
        if !self.widens.is_empty() {
            self.typed.push_str(text.trim());
        }
    }
}

/// What the model's answer comes to once validated.
pub(super) enum VibeOutcome {
    /// At least one real change: open the confirm dock.
    Propose(VibeProposal),
    /// The request was ambiguous; nothing is proposed until it is clearer.
    Ask(String),
    /// Nothing to change: already set that way, or every entry was refused.
    Nothing {
        refused: Vec<String>,
        note: Option<String>,
    },
}

fn scope_name(scope: SettingScope) -> &'static str {
    match scope {
        SettingScope::Project => "project",
        SettingScope::Global => "global",
    }
}

fn file_label(scope: SettingScope) -> &'static str {
    match scope {
        SettingScope::Project => "agent.toml (this project)",
        SettingScope::Global => "~/.jan/config.toml (all projects)",
    }
}

/// Type, range and default of a key, as the model and the diff both read it.
fn kind_text(def: &AgentSettingDef) -> (String, String) {
    let opt = |d: Option<String>| d.unwrap_or_else(|| "unset".to_string());
    match def.kind {
        AgentSettingKind::Int { default, min } => (
            format!("integer >= {min}"),
            opt(default.map(|d| d.to_string())),
        ),
        AgentSettingKind::Float { default, min, max } => (
            format!("number {min}-{max}"),
            opt(default.map(|d| d.to_string())),
        ),
        AgentSettingKind::Glyph { default, max } => (
            format!("string of up to {max} characters, \"\" = off"),
            default.to_string(),
        ),
        AgentSettingKind::Text { default } => ("string".to_string(), default.to_string()),
        AgentSettingKind::Enum { options, default } => {
            (format!("one of {}", options.join(" | ")), default.to_string())
        }
        AgentSettingKind::Bool { default } => ("true | false".to_string(), default.to_string()),
    }
}

const SYSTEM_PROMPT: &str = "You map a user's plain-language request onto Jan agent settings. \
You may only use the settings listed below. Reply with one JSON object and nothing else:\n\
{\"changes\": [{\"key\": \"<key>\", \"scope\": \"project\" or \"global\", \"new_value\": <value, or null to reset it to its default>, \"reason\": \"<a few words>\"}], \"question\": null, \"note\": null}\n\n\
Rules:\n\
- Use only keys from the list, with the scope shown. Every value must satisfy the listed type and range.\n\
- Change only what the request asks for. Leave every other key out.\n\
- If the request is ambiguous (\"faster\" could mean a smaller model or fewer tokens per reply), return \"changes\": [] and one short clarifying question in \"question\".\n\
- The model, providers, API keys, MCP servers and skills are not settings here. If the request needs one, name the command that handles it (/model, /login, /mcp, /settings) in \"note\".\n\n\
Settings (key | scope | type | default | current | description):";

/// The side-call request: the catalog with current values as the system
/// message, the user's words as the only user message. Temperature 0: this is
/// a lookup, not writing.
pub(super) fn build_request(
    model: &str,
    request: &str,
    current: &dyn Fn(&AgentSettingDef) -> Option<String>,
) -> Value {
    let mut system = SYSTEM_PROMPT.to_string();
    for def in catalog() {
        let (kind, default) = kind_text(def);
        let now = current(def).unwrap_or_else(|| "unset".to_string());
        system.push_str(&format!(
            "\n- {} | {} | {kind} | {default} | {now} | {}",
            def.key,
            scope_name(def.scope),
            def.desc
        ));
    }
    json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": request },
        ],
        "temperature": 0,
    })
}

/// The first `{` to the last `}`: models wrap JSON in prose or a fence often
/// enough that insisting on a bare object would fail for no good reason.
fn json_object(reply: &str) -> Option<serde_json::Map<String, Value>> {
    let start = reply.find('{')?;
    let end = reply.rfind('}')?;
    if end < start {
        return None;
    }
    match serde_json::from_str::<Value>(&reply[start..=end]).ok()? {
        Value::Object(map) => Some(map),
        _ => None,
    }
}

fn text_field(map: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    map.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// A JSON value as the text `/settings` would have been typed, or `None` for
/// null (reset). An integral float for an integer key (`1000000.0`) is written
/// as the integer the model meant.
fn value_text(def: &AgentSettingDef, value: &Value) -> Result<Option<String>, String> {
    match value {
        Value::Null => Ok(None),
        Value::String(s) => Ok(Some(s.clone())),
        Value::Bool(b) => Ok(Some(b.to_string())),
        Value::Number(n) => {
            if let (AgentSettingKind::Int { .. }, Some(f)) = (&def.kind, n.as_f64()) {
                if n.as_u64().is_none() && f.fract() == 0.0 && f >= 0.0 {
                    return Ok(Some(format!("{}", f as u64)));
                }
            }
            Ok(Some(n.to_string()))
        }
        _ => Err("expected a single value".to_string()),
    }
}

/// A value normalized through the shared parser, so `0.90` and `0.9` compare
/// equal and a no-op change can be dropped.
fn normalized(def: &AgentSettingDef, value: Option<&str>) -> Option<String> {
    let value = value?;
    parse_setting_input(def, value)
        .ok()
        .flatten()
        .map(|item| item.to_string().trim().to_string())
}

/// `tools.default` rank, loosest last. Unset is the default, `read-only`; an
/// unknown value reads as the default too.
fn permission_rank(value: Option<&str>) -> u8 {
    match value.map(str::trim) {
        Some("deny") => 0,
        Some("allow") => 2,
        _ => 1,
    }
}

/// Whether a change loosens what tools may do without asking.
fn widens_permissions(def: &AgentSettingDef, current: Option<&str>, new: Option<&str>) -> bool {
    def.key == "tools.default" && permission_rank(new) > permission_rank(current)
}

/// Validate the model's reply against the catalog. Every entry is checked with
/// the `/settings` parser; unknown keys, excluded keys, duplicates and bad
/// values are refused with a reason rather than dropped silently, and a change
/// to the value a key already has is left out.
pub(super) fn interpret_reply(
    reply: &str,
    current: &dyn Fn(&AgentSettingDef) -> Option<String>,
) -> Result<VibeOutcome, String> {
    let map = json_object(reply).ok_or_else(|| "the model did not answer with JSON".to_string())?;
    let note = text_field(&map, "note");
    if let Some(question) = text_field(&map, "question") {
        return Ok(VibeOutcome::Ask(question));
    }
    let entries = match map.get("changes") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(entries)) => entries.clone(),
        Some(_) => return Err("the model's \"changes\" is not a list".to_string()),
    };
    let mut changes: Vec<VibeChange> = Vec::new();
    let mut refused: Vec<String> = Vec::new();
    let mut widens: Vec<String> = Vec::new();
    // Bounded: a reply can only name each catalog key once, and anything past
    // that is noise.
    for entry in entries.iter().take(AGENT_SETTINGS.len() * 2) {
        let Some(entry) = entry.as_object() else {
            refused.push("an entry that is not an object".to_string());
            continue;
        };
        let Some(key) = text_field(entry, "key") else {
            refused.push("an entry with no key".to_string());
            continue;
        };
        if EXCLUDED_KEYS.contains(&key.as_str()) {
            refused.push(format!(
                "{key}: credential settings are never changed by /vibe-setting (use /settings)"
            ));
            continue;
        }
        let Some(def) = catalog().find(|d| d.key == key) else {
            refused.push(format!("{key}: not a setting /vibe-setting can change"));
            continue;
        };
        if changes.iter().any(|c| c.def.key == def.key) {
            refused.push(format!("{key}: listed twice"));
            continue;
        }
        match text_field(entry, "scope").as_deref() {
            None | Some("project") | Some("global") => {}
            Some(other) => {
                refused.push(format!("{key}: unknown scope '{other}'"));
                continue;
            }
        }
        let Some(raw) = entry.get("new_value") else {
            refused.push(format!("{key}: no new_value"));
            continue;
        };
        let text = match value_text(def, raw) {
            Ok(text) => text,
            Err(e) => {
                refused.push(format!("{key}: {e}"));
                continue;
            }
        };
        let item = match &text {
            None => None,
            Some(text) => match parse_setting_input(def, text) {
                Ok(item) => item,
                Err(e) => {
                    refused.push(format!("{key} = {text}: {e}"));
                    continue;
                }
            },
        };
        // What the parser made of it: an empty field is an unset for every
        // kind but a glyph, whose "" is the written "off".
        let new_value = item.as_ref().map(|_| text.clone().unwrap_or_default().trim().to_string());
        let now = current(def);
        if normalized(def, now.as_deref()) == normalized(def, new_value.as_deref())
            && now.is_some() == new_value.is_some()
        {
            continue;
        }
        if widens_permissions(def, now.as_deref(), new_value.as_deref()) {
            widens.push(def.key.to_string());
        }
        changes.push(VibeChange {
            def,
            current: now,
            new_value,
            item,
            reason: text_field(entry, "reason").unwrap_or_default(),
        });
    }
    if changes.is_empty() {
        return Ok(VibeOutcome::Nothing { refused, note });
    }
    Ok(VibeOutcome::Propose(VibeProposal {
        changes,
        refused,
        widens,
        note,
        typed: String::new(),
        error: None,
    }))
}

/// `/vibe-setting <what you want>`: validate the state, then hand the request
/// to the loop's side call. Idle only, like `/init`: a confirm dock opening
/// over a live run would take the keys from someone steering it.
pub(super) fn command(app: &mut App, arg: &str) {
    let request = arg.trim();
    if request.is_empty() {
        app.note("usage: /vibe-setting <what you want>, e.g. /vibe-setting stop compacting so often");
        return;
    }
    if app.run_is_live() {
        app.note("/vibe-setting is only available once the run has finished");
        return;
    }
    if app.vibe_task.is_some() || app.vibe_confirm.is_some() {
        app.note("/vibe-setting is already working on a request");
        return;
    }
    if app.model.is_empty() {
        app.note("not signed in - run /login to choose a provider");
        return;
    }
    let Some(args) = app.args.clone() else {
        app.note("/vibe-setting unavailable (no active session)");
        return;
    };
    let toml_path = app.agent_dir.join("agent.toml");
    let body = build_request(&app.model, request, &|def| {
        current_setting_value(def, &toml_path)
    });
    let model = app.model.clone();
    app.note("◈ vibe-setting · working out which settings that means...");
    app.vibe_task = Some(tokio::spawn(async move {
        crate::core::agent::r#loop::side_completion(&args, &model, &body).await
    }));
}

/// The side call came back: validate it and open the dock, or say why not.
pub(super) fn finish(app: &mut App, reply: Result<String, String>) {
    let toml_path = app.agent_dir.join("agent.toml");
    let outcome = reply.and_then(|reply| {
        interpret_reply(&reply, &|def| current_setting_value(def, &toml_path))
    });
    match outcome {
        Err(e) => app.note(&format!("◈ vibe-setting failed: {e}; nothing written")),
        Ok(VibeOutcome::Ask(question)) => {
            app.note(&format!("◈ vibe-setting needs more detail: {question}"));
            app.system_detail_text("run /vibe-setting again with the answer; nothing written");
        }
        Ok(VibeOutcome::Nothing { refused, note }) => {
            app.note("◈ vibe-setting · nothing to change; nothing written");
            for line in refused {
                app.system_detail_text(&format!("refused: {line}"));
            }
            if let Some(note) = note {
                app.system_detail_text(&note);
            }
        }
        Ok(VibeOutcome::Propose(proposal)) => app.vibe_confirm = Some(proposal),
    }
}

/// Keys for the confirm dock. `y` applies, `n`/Enter/Esc cancel ([y/N]); a
/// proposal that widens tool permissions needs `yes` typed and Enter.
pub(super) fn handle_key(app: &mut App, key: KeyEvent, ctrl: bool) {
    let Some(proposal) = app.vibe_confirm.as_mut() else {
        return;
    };
    let cancel = key.code == KeyCode::Esc || (ctrl && key.code == KeyCode::Char('c'));
    if cancel {
        app.vibe_confirm = None;
        app.note("◈ vibe-setting · cancelled; nothing written");
        return;
    }
    if !proposal.widens.is_empty() {
        match key.code {
            KeyCode::Enter => {
                if proposal.typed.trim().eq_ignore_ascii_case("yes") {
                    apply(app);
                } else {
                    proposal.error = Some("type yes to apply, or Esc to cancel".to_string());
                }
            }
            KeyCode::Backspace => {
                proposal.typed.pop();
            }
            KeyCode::Char(ch) if !ctrl => proposal.typed.push(ch),
            _ => {}
        }
        return;
    }
    match key.code {
        KeyCode::Char('y') | KeyCode::Char('Y') => apply(app),
        KeyCode::Char('n') | KeyCode::Char('N') | KeyCode::Enter => {
            app.vibe_confirm = None;
            app.note("◈ vibe-setting · cancelled; nothing written");
        }
        _ => {}
    }
}

/// Write every change through the `/settings` writer, then report which took
/// effect now, which `/reload config` applies, and which wait for a restart.
fn apply(app: &mut App) {
    let Some(proposal) = app.vibe_confirm.take() else {
        return;
    };
    let toml_path = app.agent_dir.join("agent.toml");
    let mut written: Vec<String> = Vec::new();
    let mut live: Vec<String> = Vec::new();
    let mut reloadable: Vec<String> = Vec::new();
    let mut restart: Vec<String> = Vec::new();
    let mut failed: Vec<String> = Vec::new();
    for change in &proposal.changes {
        match write_setting(change.def, &toml_path, change.item.clone()) {
            Ok(()) => {
                let now_live = match &change.new_value {
                    Some(value) => apply_live_setting(change.def, value),
                    None => apply_live_unset(change.def),
                };
                let key = change.def.key.to_string();
                if now_live {
                    live.push(key);
                } else if RELOAD_CONFIG_KEYS.contains(&change.def.key) {
                    reloadable.push(key);
                } else {
                    restart.push(key);
                }
                written.push(match &change.new_value {
                    Some(value) => format!("{} = {value}", change.def.key),
                    None => format!("{} unset (default applies)", change.def.key),
                });
            }
            Err(e) => failed.push(format!(
                "{}: failed to write {}: {e}",
                change.def.key,
                setting_path(change.def, &toml_path)
            )),
        }
    }
    let when = apply_when(&live, &reloadable, &restart);
    if !written.is_empty() {
        app.note(&format!(
            "◈ vibe-setting · wrote {} setting(s); {when}",
            written.len()
        ));
        for line in written {
            app.system_detail_text(&line);
        }
    }
    for line in failed {
        app.note(&format!("◈ vibe-setting · {line}"));
    }
}

/// The "when does it apply" half of the result note, one clause per bucket.
fn apply_when(live: &[String], reloadable: &[String], restart: &[String]) -> String {
    let mut parts: Vec<String> = Vec::new();
    if !live.is_empty() {
        parts.push(format!("{} in effect now", live.join(", ")));
    }
    if !reloadable.is_empty() {
        parts.push(format!("run /reload config to apply {}", reloadable.join(", ")));
    }
    if !restart.is_empty() {
        let verb = if restart.len() == 1 { "applies" } else { "apply" };
        parts.push(format!("{} {verb} when jan restarts", restart.join(", ")));
    }
    parts.join("; ")
}

fn shown(def: &AgentSettingDef, value: Option<&str>) -> String {
    match value {
        Some("") if matches!(def.kind, AgentSettingKind::Glyph { .. }) => "\"\" (off)".to_string(),
        Some(v) => v.to_string(),
        None => format!("default ({})", kind_text(def).1),
    }
}

/// The dock's contents at `width`: the diff grouped by file, what was refused,
/// the permission warning, and the confirmation line.
pub(super) fn lines(proposal: &VibeProposal, width: u16) -> Vec<Line<'static>> {
    let dim = Style::new().dark_gray();
    let max = width.max(1) as usize;
    let mut out: Vec<Line<'static>> = Vec::new();
    let mut push = |spans: Vec<Span<'static>>| {
        out.extend(wrap_spans_hard(spans, max).into_iter().map(Line::from));
    };
    let key_width = proposal
        .changes
        .iter()
        .map(|c| c.def.key.chars().count())
        .max()
        .unwrap_or_default();
    for scope in [SettingScope::Project, SettingScope::Global] {
        let rows: Vec<&VibeChange> = proposal
            .changes
            .iter()
            .filter(|c| c.def.scope == scope)
            .collect();
        if rows.is_empty() {
            continue;
        }
        push(vec![Span::styled(file_label(scope), Style::new().bold())]);
        for change in rows {
            let mut spans = vec![
                Span::raw(format!("  {:<key_width$}  ", change.def.key)),
                Span::styled(shown(change.def, change.current.as_deref()), dim),
                Span::raw(" -> "),
                Span::styled(
                    shown(change.def, change.new_value.as_deref()),
                    Style::new().cyan(),
                ),
            ];
            if !change.reason.is_empty() {
                spans.push(Span::styled(format!("   {}", change.reason), dim));
            }
            push(spans);
        }
    }
    for line in &proposal.refused {
        push(vec![Span::styled(
            format!("refused: {line}"),
            Style::new().yellow(),
        )]);
    }
    if let Some(note) = &proposal.note {
        push(vec![Span::styled(note.clone(), dim)]);
    }
    if proposal.widens.is_empty() {
        push(vec![Span::styled(
            "Apply? [y/N]",
            Style::new().bold(),
        )]);
    } else {
        push(vec![Span::styled(
            format!(
                "This widens tool permissions ({}): tools may run without asking.",
                proposal.widens.join(", ")
            ),
            Style::new().red().bold(),
        )]);
        push(vec![
            Span::styled("Type yes to apply: ", Style::new().bold()),
            Span::raw(proposal.typed.clone()),
        ]);
    }
    if let Some(error) = &proposal.error {
        push(vec![Span::styled(error.clone(), Style::new().red())]);
    }
    out
}

pub(super) fn draw(f: &mut Frame, area: Rect, proposal: &VibeProposal) {
    use ratatui::widgets::Clear;
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::new().cyan())
        .title(Span::styled(
            " vibe-setting: proposed changes ",
            Style::new().on_cyan().black().bold(),
        ));
    f.render_widget(Clear, area);
    let inner = block.inner(area);
    f.render_widget(block, area);
    f.render_widget(Paragraph::new(lines(proposal, inner.width)), inner);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_when_names_each_bucket() {
        let v = |xs: &[&str]| xs.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(apply_when(&v(&["wave"]), &[], &[]), "wave in effect now");
        assert_eq!(
            apply_when(&[], &v(&["context_window", "max_tokens"]), &[]),
            "run /reload config to apply context_window, max_tokens"
        );
        assert_eq!(
            apply_when(&[], &[], &v(&["show_reasoning", "tools.default"])),
            "show_reasoning, tools.default apply when jan restarts"
        );
        assert_eq!(
            apply_when(&v(&["wave"]), &v(&["max_tokens"]), &v(&["show_reasoning"])),
            "wave in effect now; run /reload config to apply max_tokens; show_reasoning applies when jan restarts"
        );
    }

    fn unset(_: &AgentSettingDef) -> Option<String> {
        None
    }

    fn propose(reply: &str, current: &dyn Fn(&AgentSettingDef) -> Option<String>) -> VibeProposal {
        match interpret_reply(reply, current).expect("a valid reply") {
            VibeOutcome::Propose(p) => p,
            VibeOutcome::Ask(q) => panic!("asked instead: {q}"),
            VibeOutcome::Nothing { refused, .. } => panic!("nothing proposed: {refused:?}"),
        }
    }

    /// The request carries the catalog with current values and nothing else:
    /// no credentials row, and the user's words as the only user message.
    #[test]
    fn the_request_carries_only_the_catalog_and_the_words() {
        let body = build_request("m", "show me its thinking", &|def| {
            (def.key == "context_window").then(|| "200000".to_string())
        });
        let system = body["messages"][0]["content"].as_str().unwrap();
        assert!(system.contains("- context_window | project | integer >= 1 | 128000 | 200000 |"));
        assert!(system.contains("- wave | global |"));
        assert!(!system.contains("claude_code_alias"), "{system}");
        assert_eq!(body["messages"][1]["content"], "show me its thinking");
        assert_eq!(body["messages"].as_array().unwrap().len(), 2);
    }

    /// The issue's own example parses into a three-row diff, JSON wrapped in
    /// prose included.
    #[test]
    fn parses_the_issue_example() {
        let reply = r#"Here you go:
```json
{"changes": [
  {"key": "context_window", "scope": "project", "new_value": 1000000, "reason": "Opus has 1M"},
  {"key": "compaction_ratio", "scope": "project", "new_value": 0.9, "reason": "compact later"},
  {"key": "show_reasoning", "scope": "project", "new_value": true, "reason": "show thinking"}
], "question": null}
```"#;
        let current = |def: &AgentSettingDef| match def.key {
            "context_window" => Some("128000".to_string()),
            "compaction_ratio" => Some("0.8".to_string()),
            _ => None,
        };
        let p = propose(reply, &current);
        let keys: Vec<&str> = p.changes.iter().map(|c| c.def.key).collect();
        assert_eq!(keys, ["context_window", "compaction_ratio", "show_reasoning"]);
        assert_eq!(p.changes[0].new_value.as_deref(), Some("1000000"));
        assert!(p.refused.is_empty() && p.widens.is_empty());
        let text: String = lines(&p, 120)
            .iter()
            .flat_map(|l| l.spans.iter().map(|s| s.content.to_string()))
            .collect::<Vec<_>>()
            .join("");
        assert!(text.contains("agent.toml (this project)"), "{text}");
        assert!(text.contains("128000 -> 1000000"), "{text}");
        assert!(text.contains("Apply? [y/N]"), "{text}");
    }

    /// The privacy filter is a credential decision too: the model is never shown
    /// the row, and a proposal for it is refused.
    #[test]
    fn hide_secrets_cannot_be_proposed() {
        let body = build_request("m", "stop hiding secrets", &|_| None);
        let system = body["messages"][0]["content"].as_str().unwrap();
        assert!(!system.contains("hide_secrets"), "{system}");
        match interpret_reply(r#"{"changes":[{"key":"hide_secrets","new_value":false}]}"#, &unset)
            .expect("a valid reply")
        {
            VibeOutcome::Nothing { refused, .. } => assert!(
                refused.join("\n").contains("hide_secrets: credential settings are never changed"),
                "{refused:?}"
            ),
            _ => panic!("hide_secrets must not be proposed"),
        }
    }

    /// Every value goes through the `/settings` parser: out of range, wrong
    /// type, unknown key, credential key and duplicates are refused with a
    /// reason, and the valid rest is still proposed.
    #[test]
    fn invalid_entries_are_refused_with_a_reason() {
        let reply = r#"{"changes": [
          {"key": "compaction_ratio", "new_value": 1.5},
          {"key": "max_parallel_subagents", "new_value": "lots"},
          {"key": "api_key", "new_value": "sk-123"},
          {"key": "claude_code_alias", "new_value": false},
          {"key": "tools.default", "new_value": "yolo"},
          {"key": "max_parallel_subagents", "new_value": 4},
          {"key": "max_parallel_subagents", "new_value": 5},
          {"key": "show_reasoning", "new_value": [true]},
          {"key": "send_reasoning"}
        ]}"#;
        let p = propose(reply, &unset);
        assert_eq!(p.changes.len(), 1, "only the valid entry");
        assert_eq!(p.changes[0].def.key, "max_parallel_subagents");
        assert_eq!(p.changes[0].new_value.as_deref(), Some("4"));
        let refused = p.refused.join("\n");
        for needle in [
            "compaction_ratio = 1.5: must be between",
            "max_parallel_subagents = lots: 'lots' is not an integer",
            "api_key: not a setting",
            "claude_code_alias: credential settings are never changed",
            "tools.default = yolo: must be one of",
            "max_parallel_subagents: listed twice",
            "show_reasoning: expected a single value",
            "send_reasoning: no new_value",
        ] {
            assert!(refused.contains(needle), "missing {needle:?} in:\n{refused}");
        }
    }

    /// Ambiguity asks back instead of guessing, even with changes attached.
    #[test]
    fn a_question_wins_over_changes() {
        let reply = r#"{"changes": [{"key": "max_tokens", "new_value": 512}],
                        "question": "Faster as in a smaller model, or shorter replies?"}"#;
        match interpret_reply(reply, &unset).unwrap() {
            VibeOutcome::Ask(q) => assert!(q.contains("smaller model")),
            _ => panic!("must ask back"),
        }
    }

    /// A change to the value a key already has is no change; with nothing
    /// left, nothing is proposed.
    #[test]
    fn no_op_changes_are_dropped() {
        let reply = r#"{"changes": [{"key": "compaction_ratio", "new_value": 0.90}],
                        "note": "use /model to switch to Opus"}"#;
        let current = |def: &AgentSettingDef| {
            (def.key == "compaction_ratio").then(|| "0.9".to_string())
        };
        match interpret_reply(reply, &current).unwrap() {
            VibeOutcome::Nothing { refused, note } => {
                assert!(refused.is_empty());
                assert_eq!(note.as_deref(), Some("use /model to switch to Opus"));
            }
            _ => panic!("nothing to change"),
        }
    }

    /// `null` resets a key to its default: the change is an unset.
    #[test]
    fn null_resets_to_the_default() {
        let current = |def: &AgentSettingDef| {
            (def.key == "max_tokens").then(|| "4096".to_string())
        };
        let p = propose(r#"{"changes": [{"key": "max_tokens", "new_value": null}]}"#, &current);
        assert!(p.changes[0].new_value.is_none() && p.changes[0].item.is_none());
    }

    /// Loosening `tools.default` is flagged; tightening it is not.
    #[test]
    fn widening_tool_permissions_is_flagged() {
        let allow = r#"{"changes": [{"key": "tools.default", "new_value": "allow"}]}"#;
        assert_eq!(propose(allow, &unset).widens, ["tools.default"]);
        let deny = r#"{"changes": [{"key": "tools.default", "new_value": "deny"}]}"#;
        assert!(propose(deny, &unset).widens.is_empty());
        let from_deny = |def: &AgentSettingDef| {
            (def.key == "tools.default").then(|| "deny".to_string())
        };
        let reset = r#"{"changes": [{"key": "tools.default", "new_value": null}]}"#;
        assert_eq!(
            propose(reset, &from_deny).widens,
            ["tools.default"],
            "resetting deny to the read-only default loosens it"
        );
    }

    #[test]
    fn a_reply_that_is_not_json_is_an_error() {
        assert!(interpret_reply("sure, I set it for you", &unset).is_err());
        assert!(interpret_reply(r#"{"changes": "all of them"}"#, &unset).is_err());
    }
}
