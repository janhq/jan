//! Hide Secrets: keep credentials out of the requests sent to a model provider.
//!
//! Off by default. When on, every outbound request body is rewritten just
//! before it leaves the process (`HttpModelInvoker::invoke`, which the main
//! run, every subagent and compaction all go through):
//!
//! * the values of secret-named environment variables,
//! * passwords inside `scheme://user:password@host` URLs, and
//! * credential-shaped tokens (GitHub, OpenAI/Anthropic, AWS, JWTs, `Bearer`
//!   headers, PEM private keys, ...)
//!
//! become reversible placeholders such as `$$GITHUBTOKEN_3P8W5JH1TK2Q$$`. The
//! model's completion is mapped back on the way in, so a tool call that uses a
//! placeholder runs with the real value, and the saved thread stays readable.
//!
//! **Prompt cache.** A placeholder is a function of the secret and a private
//! per-install key, so the same text always yields the same bytes, and the
//! filter never touches an earlier message differently from one request to the
//! next. It adds nothing to the system prompt. `prefix_stability` pins this.
//!
//! The 12-hex-character id is an HMAC of the value under a random key kept in
//! `~/.jan/secret-placeholder.key` (mode 0600, never sent anywhere), so a reader
//! of a transcript cannot dictionary-hash a placeholder back to its secret.

use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, LazyLock, Mutex, OnceLock};

use hmac::{Hmac, Mac};
use rand::RngCore;
use regex::Regex;
use serde_json::Value;
use sha2::Sha256;

/// Env var that overrides the config key: `1`/`true`/`on` or `0`/`false`/`off`.
pub(crate) const ENV: &str = "JAN_HIDE_SECRETS";

/// Values shorter than this are left alone, so ordinary short words survive.
const MIN_SECRET_LEN: usize = 8;

/// Name tokens (split on `_`, `-`, `.`) that mark an environment variable as
/// holding a secret.
const SECRET_NAME_TOKENS: &[&str] = &[
    "KEY",
    "SECRET",
    "TOKEN",
    "PASSWORD",
    "PASSWD",
    "PASS",
    "AUTH",
    "CREDENTIAL",
    "CREDENTIALS",
    "PRIVATE",
    "OAUTH",
];

/// Names that match the rule above but hold a path or a socket, not a secret.
const NOT_SECRETS: &[&str] = &["SSH_AUTH_SOCK", "GPG_AGENT_INFO"];

/// placeholder text -> the secret it stands for. Shared by every filter in the
/// process, so a subagent's or a compaction's completion restores what the main
/// run hid. A placeholder is deterministic, so a restart rebuilds the same ones.
static REVERSE: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// One built-in credential shape. `group` is the capture group to hide (`0` =
/// the whole match).
struct Shape {
    label: &'static str,
    re: Regex,
    group: usize,
}

static SHAPES: LazyLock<Vec<Shape>> = LazyLock::new(|| {
    let table: &[(&str, &str, usize)] = &[
        ("PRIVATEKEY", r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----", 0),
        ("GITHUBTOKEN", r"\bgh[pousr]_[A-Za-z0-9]{20,}", 0),
        ("GITHUBTOKEN", r"\bgithub_pat_[A-Za-z0-9_]{20,}", 0),
        ("GITLABTOKEN", r"\bglpat-[A-Za-z0-9_-]{20,}", 0),
        ("APIKEY", r"\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}", 0),
        ("AWSKEY", r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b", 0),
        ("GOOGLEKEY", r"\bAIza[0-9A-Za-z_-]{30,}", 0),
        ("SLACKTOKEN", r"\bxox[abprs]-[A-Za-z0-9-]{10,}", 0),
        ("NPMTOKEN", r"\bnpm_[A-Za-z0-9]{30,}", 0),
        ("STRIPEKEY", r"\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}", 0),
        ("STRIPEKEY", r"\bwhsec_[A-Za-z0-9]{16,}", 0),
        ("HFTOKEN", r"\bhf_[A-Za-z0-9]{30,}", 0),
        ("SENDGRIDKEY", r"\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}", 0),
        ("JWT", r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}", 0),
        ("BEARER", r"(?i)\bbearer\s+([A-Za-z0-9._~+/=-]{16,})", 1),
        ("URLPASSWORD", r"://[^\s:/@]+:([^\s@/]{3,})@", 1),
    ];
    table
        .iter()
        .map(|(label, pattern, group)| Shape {
            label,
            re: Regex::new(pattern).expect("valid secret pattern"),
            group: *group,
        })
        .collect()
});

static PLACEHOLDER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\$\$(?:[A-Z0-9_]+_)?[0-9A-F]{12}\$\$").expect("valid placeholder pattern"));

/// What one run hides. Cheap to build; holds the literal secrets found in the
/// environment when it was made.
pub(crate) struct SecretFilter {
    key: [u8; 32],
    /// `(label, value)`, longest value first, so a secret that contains another
    /// is replaced whole.
    literals: Vec<(String, String)>,
}

/// `Some` when Hide Secrets is on for this process, `None` when it is off.
/// `JAN_HIDE_SECRETS` wins over `hide_secrets` in `~/.jan/config.toml`.
pub(crate) fn for_run() -> Option<Arc<SecretFilter>> {
    let env = std::env::var(ENV).ok();
    let setting = crate::core::agent::global_config::hide_secrets_setting();
    if !enabled(env.as_deref(), setting) {
        return None;
    }
    let vars: Vec<(String, String)> = std::env::vars().collect();
    Some(Arc::new(SecretFilter::new(process_key(), &vars)))
}

fn enabled(env: Option<&str>, setting: Option<bool>) -> bool {
    match env.map(|v| v.trim().to_ascii_lowercase()).as_deref() {
        Some("1" | "true" | "on" | "yes") => true,
        Some("0" | "false" | "off" | "no") => false,
        _ => setting.unwrap_or(false),
    }
}

/// The key every filter in this process uses. Loaded once: `load_key` makes a
/// new random key per call when the file cannot be saved, and a key that
/// changed between runs, compactions or side calls would change every
/// placeholder and break the provider's prompt cache.
fn process_key() -> [u8; 32] {
    static KEY: OnceLock<[u8; 32]> = OnceLock::new();
    *KEY.get_or_init(load_key)
}

/// The per-install key, created on first use. If it cannot be written the run
/// still works: the key is ephemeral, so placeholders are stable within the
/// process (see [`process_key`]) but not across restarts.
fn load_key() -> [u8; 32] {
    let path = crate::core::agent::global_config::global_jan_dir()
        .ok()
        .map(|dir| dir.join("secret-placeholder.key"));
    load_key_at(path.as_deref())
}

/// [`load_key`] for an explicit file, so a test does not depend on how the
/// platform resolves the home directory (`HOME` is ignored on Windows).
fn load_key_at(path: Option<&std::path::Path>) -> [u8; 32] {
    if let Some(path) = path {
        if let Ok(text) = std::fs::read_to_string(path) {
            if let Ok(bytes) = hex::decode(text.trim()) {
                if let Ok(key) = <[u8; 32]>::try_from(bytes.as_slice()) {
                    return key;
                }
            }
        }
    }
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    if let Some(path) = path {
        if let Err(e) = save_key(path, &key) {
            log::warn!(
                "hide_secrets: could not save {}: {e}; placeholders will change on restart",
                path.display()
            );
        }
    }
    key
}

/// Write the key with mode 0600 from the first byte, so it is never readable by
/// others even briefly.
fn save_key(path: &std::path::Path, key: &[u8; 32]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)?.write_all(hex::encode(key).as_bytes())
}

fn is_secret_name(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    if NOT_SECRETS.contains(&upper.as_str()) {
        return false;
    }
    upper
        .split(['_', '-', '.'])
        .any(|token| SECRET_NAME_TOKENS.contains(&token))
}

/// Keep a name's letters and digits only, for a model-visible label.
fn label_of(name: &str) -> String {
    let label: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .map(|c| c.to_ascii_uppercase())
        .take(32)
        .collect();
    label.trim_matches('_').to_string()
}

/// A value shaped like a file path (`/etc/k`, `~/k`, `./k`, `C:\k`, `\\host\k`).
/// A path is not a secret, and promoting it would rewrite every mention of it.
fn looks_like_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    value.starts_with('/')
        || value.starts_with("~/")
        || value.starts_with("./")
        || value.starts_with("../")
        || value.starts_with("\\\\")
        || (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'\\' || bytes[2] == b'/'))
}

impl SecretFilter {
    fn new(key: [u8; 32], vars: &[(String, String)]) -> Self {
        let mut literals: Vec<(String, String)> = Vec::new();
        let mut push = |label: String, value: &str| {
            if value.len() >= MIN_SECRET_LEN
                && !literals.iter().any(|(_, existing)| existing == value)
            {
                literals.push((label, value.to_string()));
            }
        };
        for (name, value) in vars {
            if is_secret_name(name) && !looks_like_path(value) {
                push(label_of(name), value);
            }
        }
        // A password inside a URL-shaped value is a secret whatever the
        // variable is called (`DATABASE_URL`).
        let url_password = &SHAPES
            .iter()
            .find(|s| s.label == "URLPASSWORD")
            .expect("url shape exists")
            .re;
        for (name, value) in vars {
            for caps in url_password.captures_iter(value) {
                let (Some(whole), Some(password)) = (caps.get(0), caps.get(1)) else {
                    continue;
                };
                // `postgres://postgres:postgres@db`: a password that is also
                // the scheme or the user name would turn every "postgres" in
                // the prompt into a placeholder. The URL shape still hides it
                // where it sits in a URL.
                let user = whole.as_str().trim_start_matches("://");
                let user = user.split(':').next().unwrap_or("");
                let before = &value[..whole.start()];
                let scheme = before.rsplit(|c: char| !c.is_ascii_alphanumeric() && c != '+' && c != '-' && c != '.').next().unwrap_or("");
                if password.as_str() == user || password.as_str().eq_ignore_ascii_case(scheme) {
                    continue;
                }
                // A password made only of letters reads as a word (`password`),
                // and as a process-wide literal it would rewrite that word in
                // every prompt. It stays hidden where it sits in a URL, by shape.
                if !password.as_str().chars().any(|c| !c.is_ascii_alphabetic()) {
                    continue;
                }
                push(label_of(name), password.as_str());
            }
        }
        literals.sort_by_key(|(_, value)| std::cmp::Reverse(value.len()));
        Self { key, literals }
    }

    /// A filter over fixed variables and a fixed key, for tests in other modules.
    #[cfg(test)]
    pub(crate) fn for_tests(vars: &[(&str, &str)]) -> Self {
        let vars: Vec<(String, String)> = vars
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        Self::new([7; 32], &vars)
    }

    /// The placeholder for `value`, remembered so a completion can be restored.
    fn placeholder(&self, label: &str, value: &str) -> String {
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.key).expect("hmac takes any key length");
        mac.update(value.as_bytes());
        let id = hex::encode_upper(&mac.finalize().into_bytes()[..6]);
        let text = if label.is_empty() {
            format!("$${id}$$")
        } else {
            format!("$${label}_{id}$$")
        };
        REVERSE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entry(text.clone())
            .or_insert_with(|| value.to_string());
        text
    }

    /// `text` with every secret replaced by its placeholder. Text that holds no
    /// secret comes back unchanged, and a placeholder is never rewritten: each
    /// pass skips the spans that already are placeholders, so a hidden value is
    /// not matched again by a shape (`://user:$$PLACEHOLDER$$@`).
    pub(crate) fn hide(&self, text: &str) -> String {
        let literals = map_plain(text, |plain| self.hide_literals(plain));
        map_plain(&literals, |plain| self.hide_shapes(plain))
    }

    fn hide_literals(&self, text: &str) -> String {
        let mut out = text.to_string();
        for (label, value) in &self.literals {
            if out.contains(value.as_str()) {
                out = out.replace(value.as_str(), &self.placeholder(label, value));
            }
        }
        out
    }

    fn hide_shapes(&self, text: &str) -> String {
        let mut out = text.to_string();
        for shape in SHAPES.iter() {
            if !shape.re.is_match(&out) {
                continue;
            }
            out = shape
                .re
                .replace_all(&out, |caps: &regex::Captures| {
                    let whole = caps.get(0).expect("group 0").as_str();
                    match caps.get(shape.group) {
                        Some(hidden) => {
                            let placeholder = self.placeholder(shape.label, hidden.as_str());
                            // Keep the text around the hidden group (`://user:`),
                            // splicing at its position: the same text can appear
                            // earlier in the match (`guest:guest@`).
                            let start = hidden.start() - caps.get(0).expect("group 0").start();
                            let end = hidden.end() - caps.get(0).expect("group 0").start();
                            format!("{}{}{}", &whole[..start], placeholder, &whole[end..])
                        }
                        None => whole.to_string(),
                    }
                })
                .into_owned();
        }
        out
    }

    /// A copy of a chat/completions request with every provider-visible string
    /// run through [`hide`](Self::hide): message text, tool results, and the
    /// arguments of earlier tool calls. Images, tool schemas and ids are left.
    pub(crate) fn filter_request(&self, request: &Value) -> Value {
        let mut out = request.clone();
        let Some(messages) = out.get_mut("messages").and_then(Value::as_array_mut) else {
            return out;
        };
        for message in messages {
            for field in ["content", "reasoning_content"] {
                if let Some(value) = message.get_mut(field) {
                    self.hide_in_content(value);
                }
            }
            if let Some(calls) = message.get_mut("tool_calls").and_then(Value::as_array_mut) {
                for call in calls {
                    if let Some(args) = call.pointer_mut("/function/arguments") {
                        self.hide_in_content(args);
                    }
                }
            }
        }
        out
    }

    /// [`hide`](Self::hide) for a string the provider reads. When the result is
    /// a JSON object or array (tool-call arguments, a JSON tool result), the
    /// secrets are also hidden per decoded string: a value with a quote, a
    /// backslash or a newline is stored escaped there, so the plain pass cannot
    /// match it. Text that changes in neither pass keeps its exact bytes.
    fn hide_text(&self, text: &str) -> String {
        let hidden = self.hide(text);
        if matches!(hidden.trim_start().as_bytes().first(), Some(b'{' | b'[')) {
            if let Ok(mut parsed) = serde_json::from_str::<Value>(&hidden) {
                if self.hide_json(&mut parsed) {
                    return parsed.to_string();
                }
            }
        }
        hidden
    }

    /// Hide the strings of a JSON value in place; `true` when any changed.
    fn hide_json(&self, value: &mut Value) -> bool {
        match value {
            Value::String(text) => {
                let hidden = self.hide(text);
                let changed = hidden != *text;
                *text = hidden;
                changed
            }
            Value::Array(items) => items.iter_mut().fold(false, |any, v| self.hide_json(v) | any),
            Value::Object(map) => map.values_mut().fold(false, |any, v| self.hide_json(v) | any),
            _ => false,
        }
    }

    fn hide_in_content(&self, value: &mut Value) {
        match value {
            Value::String(text) => *text = self.hide_text(text),
            Value::Array(parts) => {
                for part in parts {
                    if let Some(text) = part.get_mut("text") {
                        self.hide_in_content(text);
                    }
                }
            }
            _ => {}
        }
    }
}

/// A secret whose value holds another placeholder needs another round; this
/// bounds a pathological cycle.
const MAX_RESTORE_ROUNDS: usize = 8;

/// `text` with every placeholder this process knows put back to its secret,
/// repeated until no known placeholder is left. An unknown placeholder is left
/// as it is.
pub(crate) fn restore(text: &str) -> String {
    if !text.contains("$$") {
        return text.to_string();
    }
    let reverse = REVERSE.lock().unwrap_or_else(|e| e.into_inner());
    let mut out = text.to_string();
    for _ in 0..MAX_RESTORE_ROUNDS {
        let mut known = false;
        let next = PLACEHOLDER
            .replace_all(&out, |caps: &regex::Captures| {
                let found = caps.get(0).expect("group 0").as_str();
                match reverse.get(found) {
                    Some(secret) => {
                        known = true;
                        secret.clone()
                    }
                    None => found.to_string(),
                }
            })
            .into_owned();
        if !known {
            break;
        }
        out = next;
    }
    out
}

/// Run `f` over the parts of `text` that are not placeholders and keep the
/// placeholders as they are.
fn map_plain(text: &str, f: impl Fn(&str) -> String) -> String {
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for m in PLACEHOLDER.find_iter(text) {
        out.push_str(&f(&text[last..m.start()]));
        out.push_str(m.as_str());
        last = m.end();
    }
    out.push_str(&f(&text[last..]));
    out
}

/// Restore placeholders in the strings of a JSON value, so a secret containing
/// a quote or a backslash is escaped by the serializer, not by this function.
fn restore_json(value: &mut Value) {
    match value {
        Value::String(text) => *text = restore(text),
        Value::Array(items) => items.iter_mut().for_each(restore_json),
        Value::Object(map) => map.values_mut().for_each(restore_json),
        _ => {}
    }
}

/// Put real values back into a completion: the answer text, the reasoning, and
/// the arguments of every tool call, so the tool runs with the real value and
/// the saved thread reads normally. The next request hides them again.
pub(crate) fn restore_completion(completion: &mut Value) {
    let Some(choices) = completion.get_mut("choices").and_then(Value::as_array_mut) else {
        return;
    };
    for choice in choices {
        let Some(message) = choice.get_mut("message") else { continue };
        for field in ["content", "reasoning_content"] {
            if let Some(Value::String(text)) = message.get_mut(field) {
                *text = restore(text);
            }
        }
        let Some(calls) = message.get_mut("tool_calls").and_then(Value::as_array_mut) else {
            continue;
        };
        for call in calls {
            let Some(Value::String(args)) = call.pointer_mut("/function/arguments") else {
                continue;
            };
            if !args.contains("$$") {
                continue;
            }
            *args = match serde_json::from_str::<Value>(args) {
                Ok(mut parsed) => {
                    restore_json(&mut parsed);
                    parsed.to_string()
                }
                Err(_) => restore(args),
            };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const KEY: [u8; 32] = [7; 32];

    fn filter(vars: &[(&str, &str)]) -> SecretFilter {
        let vars: Vec<(String, String)> = vars
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        SecretFilter::new(KEY, &vars)
    }

    #[test]
    fn the_switch_is_off_unless_asked_for_and_the_env_wins() {
        assert!(!enabled(None, None));
        assert!(enabled(None, Some(true)));
        assert!(!enabled(None, Some(false)));
        assert!(enabled(Some("1"), None));
        assert!(enabled(Some("TRUE"), Some(false)));
        assert!(!enabled(Some("0"), Some(true)), "=0 turns it off");
        assert!(enabled(Some("maybe"), Some(true)), "unknown value defers to the config");
    }

    #[test]
    fn secret_names_are_matched_by_token_not_substring() {
        for yes in ["OPENAI_API_KEY", "GITHUB_TOKEN", "DB_PASSWORD", "AWS_SECRET_ACCESS_KEY", "AUTH"] {
            assert!(is_secret_name(yes), "{yes}");
        }
        for no in ["PATH", "GIT_AUTHOR_NAME", "KEYBOARD_LAYOUT", "SSH_AUTH_SOCK", "HOME"] {
            assert!(!is_secret_name(no), "{no}");
        }
    }

    #[test]
    fn an_env_secret_is_hidden_and_a_short_value_or_plain_word_is_not() {
        let f = filter(&[
            ("OPENAI_API_KEY", "live-value-1234567890"),
            ("SHORT_TOKEN", "abc123"),
            ("EDITOR", "vim-the-editor"),
        ]);
        let out = f.hide("export OPENAI_API_KEY=live-value-1234567890 abc123 vim-the-editor");
        assert!(!out.contains("live-value-1234567890"), "{out}");
        assert!(out.contains("$$OPENAI_API_KEY_"), "{out}");
        assert!(out.contains("abc123"), "short values are not hidden");
        assert!(out.contains("vim-the-editor"), "non-secret names are not hidden");
    }

    #[test]
    fn built_in_token_shapes_are_hidden() {
        let f = filter(&[]);
        let samples = [
            "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
            "sk-proj-abcdefghijklmnopqrstuvwx",
            "sk-ant-abcdefghijklmnopqrstuvwxyz0123",
            "AKIAABCDEFGHIJKLMNOP",
            "xoxb-1234567890-abcdefghij",
            "hf_abcdefghijklmnopqrstuvwxyz012345",
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop",
            "-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\n-----END RSA PRIVATE KEY-----",
        ];
        for sample in samples {
            let out = f.hide(&format!("token is {sample} ok"));
            assert!(!out.contains(sample), "{sample} leaked: {out}");
            assert!(out.starts_with("token is $$") && out.ends_with("$$ ok"), "{out}");
        }
        let bearer = f.hide("Authorization: Bearer abcdefghijklmnop1234");
        assert!(bearer.starts_with("Authorization: Bearer $$BEARER_"), "{bearer}");
    }

    #[test]
    fn a_url_password_is_hidden_and_the_rest_of_the_url_stays() {
        let f = filter(&[("DATABASE_URL", "postgres://app:hunter2hunter2@db.local:5432/x")]);
        let out = f.hide("postgres://app:hunter2hunter2@db.local:5432/x and postgres://u:otherpass@h/y");
        assert!(!out.contains("hunter2hunter2") && !out.contains("otherpass"), "{out}");
        assert!(out.contains("postgres://app:$$") && out.contains("@db.local:5432/x"), "{out}");
    }

    #[test]
    fn hiding_is_deterministic_idempotent_and_leaves_clean_text_alone() {
        let f = filter(&[("MY_SECRET", "s3cr3t-value-xyz")]);
        let once = f.hide("a s3cr3t-value-xyz b");
        assert_eq!(once, f.hide("a s3cr3t-value-xyz b"), "same input, same bytes");
        assert_eq!(once, f.hide(&once), "a placeholder is not rewritten");
        assert_eq!(f.hide("nothing to see"), "nothing to see");
        let other = SecretFilter::new([9; 32], &[("MY_SECRET".into(), "s3cr3t-value-xyz".into())]);
        assert_ne!(once, other.hide("a s3cr3t-value-xyz b"), "the id depends on the key");
    }

    #[test]
    fn a_tool_call_with_a_placeholder_runs_with_the_real_value() {
        let f = filter(&[("MY_SECRET", "p@ss\"word\\value1")]);
        let hidden = f.hide("p@ss\"word\\value1");
        let args = json!({ "command": format!("login {hidden}") }).to_string();
        let mut completion = json!({"choices":[{"message":{
            "content": format!("using {hidden}"),
            "tool_calls":[{"id":"c1","type":"function","function":{"name":"bash","arguments": args}}]
        }}]});
        restore_completion(&mut completion);
        assert_eq!(completion["choices"][0]["message"]["content"], "using p@ss\"word\\value1");
        let args = completion["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"]
            .as_str()
            .unwrap();
        let parsed: Value = serde_json::from_str(args).expect("still valid JSON");
        assert_eq!(parsed["command"], "login p@ss\"word\\value1");
    }

    #[test]
    fn an_unknown_placeholder_is_left_alone() {
        let text = "$$NOPE_0123456789AB$$";
        assert_eq!(restore(text), text);
    }

    #[test]
    fn a_request_is_filtered_everywhere_the_provider_reads_text() {
        let f = filter(&[("MY_TOKEN", "tok-1234567890abc")]);
        let request = json!({
            "model": "m",
            "tools": [{"type":"function","function":{"name":"bash","description":"tok-1234567890abc"}}],
            "messages": [
                {"role":"system","content":"you are Jan"},
                {"role":"user","content":[{"type":"text","text":"use tok-1234567890abc"},
                                          {"type":"image_url","image_url":{"url":"data:image/png;base64,AAAA"}}]},
                {"role":"assistant","content":null,"tool_calls":[
                    {"id":"c1","type":"function","function":{"name":"bash","arguments":"{\"c\":\"echo tok-1234567890abc\"}"}}]},
                {"role":"tool","tool_call_id":"c1","content":"tok-1234567890abc"}
            ]
        });
        let out = f.filter_request(&request);
        let text = out["messages"].to_string();
        assert!(!text.contains("tok-1234567890abc"), "{text}");
        assert!(text.contains("data:image/png;base64,AAAA"), "images are untouched");
        assert_eq!(out["messages"][2]["content"], Value::Null);
        assert_eq!(out["tools"], request["tools"], "tool schemas are not part of the pass");
        assert_eq!(request["messages"][3]["content"], "tok-1234567890abc", "the input is not mutated");
    }

    /// The cache rule: a request that extends an earlier one keeps the earlier
    /// bytes exactly.
    #[test]
    fn a_longer_request_keeps_the_filtered_prefix_byte_identical() {
        let f = filter(&[("MY_TOKEN", "tok-1234567890abc")]);
        let first = json!({"model":"m","messages":[
            {"role":"system","content":"sys"},
            {"role":"user","content":"key is tok-1234567890abc"}]});
        let mut second = first.clone();
        second["messages"].as_array_mut().unwrap().extend([
            json!({"role":"assistant","content":"ok"}),
            json!({"role":"user","content":"again ghp_abcdefghijklmnopqrstuvwxyz0123456789"}),
        ]);
        let a = f.filter_request(&first)["messages"].as_array().unwrap().clone();
        let b = f.filter_request(&second)["messages"].as_array().unwrap().clone();
        for (i, message) in a.iter().enumerate() {
            assert_eq!(
                serde_json::to_string(message).unwrap(),
                serde_json::to_string(&b[i]).unwrap(),
                "message {i} moved"
            );
        }
    }

    #[test]
    fn the_key_is_created_once_private_and_reused() {
        let dir = std::env::temp_dir().join(format!("jan_secret_key_{}", std::process::id()));
        let path = dir.join(".jan").join("secret-placeholder.key");
        let _ = std::fs::remove_dir_all(&dir);
        let first = load_key_at(Some(&path));
        assert!(path.exists(), "{}", path.display());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        assert_eq!(first, load_key_at(Some(&path)), "the same key on the next call");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_process_key_is_loaded_once() {
        crate::core::agent::global_config::with_temp_home(|_| {
            assert_eq!(process_key(), process_key());
        });
    }

    #[test]
    fn an_env_url_password_is_hidden_once_and_restores_to_the_password() {
        let f = filter(&[("DATABASE_URL", "postgres://app:hunter2hunter2@db.local:5432/x")]);
        let text = "dsn postgres://app:hunter2hunter2@db.local:5432/x";
        let once = f.hide(text);
        assert!(!once.contains("hunter2hunter2"), "{once}");
        assert_eq!(once.matches("$$").count(), 2, "one placeholder, not a wrapped one: {once}");
        assert_eq!(once, f.hide(&once), "hiding hidden text changes nothing");
        assert_eq!(restore(&once), text);
    }

    #[test]
    fn a_password_equal_to_the_user_name_is_hidden_at_its_own_position() {
        let f = filter(&[]);
        let out = f.hide("amqp://guest:guest@host/vhost");
        assert!(out.starts_with("amqp://guest:$$URLPASSWORD_"), "the user stays, the password goes: {out}");
        assert!(out.ends_with("$$@host/vhost"), "{out}");
        assert_eq!(restore(&out), "amqp://guest:guest@host/vhost");
    }

    #[test]
    fn a_path_valued_secret_name_is_not_promoted_to_a_literal() {
        for path in [
            r"C:\Users\me\credentials-file.json",
            "C:/Users/me/credentials-file.json",
            "~/.config/gcloud/credentials.json",
            "./secrets/credentials.json",
            "../secrets/credentials.json",
            r"\\server\share\credentials.json",
            "/etc/secrets/credentials.json",
        ] {
            let f = filter(&[("GOOGLE_APPLICATION_CREDENTIALS", path)]);
            let text = format!("read {path} now");
            assert_eq!(f.hide(&text), text, "{path}");
        }
        // A real value in the same kind of variable is still hidden.
        let f = filter(&[("GOOGLE_APPLICATION_CREDENTIALS", "abc123def456ghi")]);
        assert!(!f.hide("key abc123def456ghi").contains("abc123def456ghi"));
    }

    #[test]
    fn a_letters_only_url_password_is_hidden_in_the_url_only() {
        for (url, word) in [
            ("postgres://app:password@localhost/db", "password"),
            ("mysql://root:SECRETWORD@db/x", "SECRETWORD"),
        ] {
            let f = filter(&[("DATABASE_URL", url)]);
            let prose = format!("the {word} field is required");
            assert_eq!(f.hide(&prose), prose, "{url}: prose survives");
            let hidden = f.hide(url);
            assert!(hidden.contains("$$URLPASSWORD_"), "{hidden}");
            assert!(!hidden.contains(&format!(":{word}@")), "{url} leaked: {hidden}");
            assert_eq!(restore(&hidden), url);
        }
    }

    #[test]
    fn an_env_url_password_that_is_a_common_word_does_not_rewrite_the_prompt() {
        for url in [
            "postgres://postgres:postgres@db.local:5432/x",
            "redis://default:default@cache.local:6379",
        ] {
            let f = filter(&[("DATABASE_URL", url)]);
            let prose = "the postgres docs say default settings apply; run postgres and redis default";
            assert_eq!(f.hide(prose), prose, "{url}: ordinary words survive");
            let hidden = f.hide(&format!("dsn {url}"));
            let password = url.split(':').nth(2).unwrap().split('@').next().unwrap();
            assert!(hidden.contains("$$URLPASSWORD_"), "{hidden}");
            assert!(!hidden.contains(&format!(":{password}@")), "{url} leaked: {hidden}");
            assert_eq!(restore(&hidden), format!("dsn {url}"));
        }
        // A distinct password is still hidden where it appears alone.
        let f = filter(&[("DATABASE_URL", "postgres://app:hunter2hunter2@db/x")]);
        assert!(!f.hide("password is hunter2hunter2").contains("hunter2hunter2"));
    }

    #[test]
    fn restore_runs_until_no_known_placeholder_is_left() {
        let f = filter(&[("MY_SECRET", "inner-secret-value")]);
        let inner = f.hide("inner-secret-value");
        let outer = f.placeholder("OUTER", &format!("wrap-{inner}-wrap"));
        assert_eq!(restore(&outer), "wrap-inner-secret-value-wrap");
    }

    #[test]
    fn a_secret_with_a_quote_backslash_or_newline_is_hidden_in_json_text() {
        for secret in ["abc\"defghij", "p@ss\\word\\value1", "line1\nline2secret"] {
            let f = filter(&[("MY_SECRET", secret)]);
            let args = json!({ "command": format!("login {secret}"), "n": 1 }).to_string();
            let request = json!({"messages":[
                {"role":"assistant","content":null,"tool_calls":[
                    {"id":"c1","type":"function","function":{"name":"bash","arguments": args}}]},
                {"role":"tool","tool_call_id":"c1","content": json!({"out": secret}).to_string()}
            ]});
            let out = f.filter_request(&request);
            assert!(!out.to_string().contains(&json!(secret).to_string()[1..json!(secret).to_string().len() - 1]), "{secret:?} leaked: {out}");
            let sent = out["messages"][0]["tool_calls"][0]["function"]["arguments"].as_str().unwrap();
            let parsed: Value = serde_json::from_str(sent).expect("still valid JSON");
            assert!(parsed["command"].as_str().unwrap().starts_with("login $$MY_SECRET_"), "{secret:?}");
            assert_eq!(parsed["n"], 1);
            let result: Value =
                serde_json::from_str(out["messages"][1]["content"].as_str().unwrap()).unwrap();
            assert!(result["out"].as_str().unwrap().starts_with("$$MY_SECRET_"), "{secret:?}");
            let mut completion = json!({"choices":[{"message":{"tool_calls":[
                {"id":"c2","type":"function","function":{"name":"bash","arguments": sent}}]}}]});
            restore_completion(&mut completion);
            let args = completion["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"]
                .as_str()
                .unwrap();
            let restored: Value = serde_json::from_str(args).unwrap();
            assert_eq!(restored["command"], format!("login {secret}"));
        }
    }

    #[test]
    fn json_text_without_a_secret_keeps_its_exact_bytes() {
        let f = filter(&[("MY_SECRET", "s3cr3t-value-xyz")]);
        let args = "{ \"command\" :  \"ls\" }";
        let request = json!({"messages":[{"role":"assistant","content":null,"tool_calls":[
            {"id":"c1","type":"function","function":{"name":"bash","arguments": args}}]}]});
        let out = f.filter_request(&request);
        assert_eq!(out["messages"][0]["tool_calls"][0]["function"]["arguments"], args);
    }
}
