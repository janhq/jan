//! User-wide `~/.jan/config.toml` provider config. Lets Jan Agent run
//! standalone (no Jan Desktop) with credentials scoped to the whole user, not
//! just one project. Optional: a missing file yields an empty provider set,
//! not an error.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::core::state::ProviderConfig;

const GLOBAL_CONFIG_TEMPLATE: &str = r#"# Jan Agent global provider config.
# Applies to every project unless overridden by that project's
# .jan/agent/agent.toml [provider] section.
#
# default_model = "my-model"        # used when no --model / agent.toml model is set
# smol_model = "my-fast-model"       # fast model for the `smol` role (/goal evaluation);
#                                     # defaults to `default_model` when unset
# mouse = false                      # disable TUI mouse tracking (scroll wheel,
#                                     # click-to-expand); on by default
# sandbox = true                      # run `bash` under OS confinement (same as
#                                     # passing --sandbox); off by default, so
#                                     # shell commands run with your own access
# think_tags = false                  # stop treating <think> tags in model
#                                     # content as reasoning; they render and
#                                     # are resent as ordinary prose. On by
#                                     # default
# stream_reasoning = false            # stop streaming reasoning into the TUI
#                                     # live tail while it folds; only the
#                                     # [thinking] badge shows it. On by default
# terminal_hint = false               # stop the startup note that offers
#                                     # /terminal-setup when this terminal is
#                                     # dropping Shift+Enter or Option+Delete.
#                                     # On by default
# claude_code_alias = false             # allow Jan to reuse Claude Code's
#                                     # keychain login; on by default
# wave = "👋"                          # sweep this glyph along the working row
#                                     # instead of the static throbber. Up to
#                                     # 3 characters ("🍌", "~", "👁️👄👁️").
#                                     # Defaults to 👋; set "" for the plain
#                                     # throbber if your terminal draws tofu
#
# [providers.my-provider]
# api_key = "sk-..."
# base_url = "https://api.example.com/v1"
# models = ["my-model"]
"#;

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
struct GlobalConfigToml {
    /// Explicit default model for a standalone agent, used when neither a CLI
    /// flag nor `agent.toml` names one. Takes precedence over any derived guess.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    default_model: Option<String>,
    /// Fast, cheap model for the `smol` role: goal evaluation and other
    /// lightweight side calls. Falls back to `default_model` when unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    smol_model: Option<String>,
    /// TUI mouse tracking (wheel scrolling, click-to-expand). `None` = the
    /// default, on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    mouse: Option<bool>,
    /// Run the CLI's `bash` tool under OS confinement. `None` = the default,
    /// off. This is the "permanently on" answer to the per-invocation
    /// `--sandbox` flag.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sandbox: Option<bool>,
    /// Parse `<think>` tags in model *content* as reasoning. `None` = the
    /// default, on. Native `reasoning_content` streaming is a separate
    /// mechanism and is unaffected.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    think_tags: Option<bool>,
    /// Stream reasoning into the TUI live tail while it is still folded. `None`
    /// = the default, on. Unrelated to `[agent].show_reasoning`, which unfolds
    /// reasoning for good.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    stream_reasoning: Option<bool>,
    /// Offer `/terminal-setup` at startup when a config file proves this
    /// terminal is dropping a modified key. `None` = the default, on. For the
    /// user who has read the note and decided to keep `Option` composing
    /// characters: nothing lands on disk in that case, so there is no other way
    /// for the check to know it was answered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    terminal_hint: Option<bool>,
    /// Allow Jan to reuse Claude Code's keychain login. `None` = the default,
    /// on; set false to keep Jan from reading or refreshing that credential.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    claude_code_alias: Option<bool>,
    /// Glyph swept along the working row while a turn runs, in place of the
    /// static Braille throbber. Absent = `WAVE_DEFAULT`; `""` = off, the
    /// throbber. See `wave_glyph` for why those are two different things.
    ///
    /// Any string up to `WAVE_MAX_GRAPHEMES` clusters is accepted -- `"🍌"`,
    /// `"~"`, `"<o>"` -- because what reads as a wave is a matter of taste,
    /// and the renderer measures whatever it is given rather than assuming
    /// one cell.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    wave: Option<String>,
    #[serde(default)]
    providers: HashMap<String, GlobalProviderEntry>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
struct GlobalProviderEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    api_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    models: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    api_type: Option<String>,
}

/// Fields to update on a provider entry via [`set_provider`]. `None` leaves the
/// existing value untouched (merge semantics); `Some` overwrites it. An
/// explicit `Some("")` for the API key removes it (e.g. a local endpoint that
/// dropped auth).
#[derive(Debug, Default, Clone)]
pub(crate) struct ProviderUpdate {
    pub api_key: Option<String>,
    /// Clear any legacy plaintext key in the entry. Used by the login flow so
    /// a stale key never shadows the secret-store credential it just wrote.
    pub clear_api_key: bool,
    pub base_url: Option<String>,
    /// `Some(vec)` replaces the model list; `Some(empty)` clears it.
    pub models: Option<Vec<String>>,
    pub api_type: Option<String>,
}

/// `~/.jan`, the user-wide config directory.
pub(crate) fn global_jan_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".jan"))
        .ok_or_else(|| "could not resolve the user's home directory".to_string())
}

/// `~/.jan/config.toml`.
pub(crate) fn global_config_path() -> Result<PathBuf, String> {
    Ok(global_jan_dir()?.join("config.toml"))
}

/// Load provider configs from `~/.jan/config.toml`. Missing file -> empty map
/// (standalone-with-no-global-config is valid); malformed file -> error.
pub(crate) fn load_global_config() -> Result<HashMap<String, ProviderConfig>, String> {
    let path = match global_config_path() {
        Ok(p) => p,
        Err(_) => return Ok(HashMap::new()),
    };
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(_) => return Ok(HashMap::new()),
    };
    let parsed: GlobalConfigToml =
        toml::from_str(&raw).map_err(|e| format!("Failed to parse {}: {e}", path.display()))?;

    Ok(parsed
        .providers
        .into_iter()
        .map(|(name, entry)| {
            let api_keys = entry.api_key.iter().cloned().collect();
            (
                name.clone(),
                ProviderConfig {
                    provider: name,
                    api_key: entry.api_key,
                    api_keys,
                    base_url: entry.base_url,
                    custom_headers: Vec::new(),
                    models: entry.models,
                    api_type: entry.api_type,
                },
            )
        })
        .collect())
}

/// Resolve a default model from `~/.jan/config.toml` for a standalone agent:
/// the explicit `default_model` key if set, else the first model of the first
/// provider (providers sorted by name for determinism). `None` when nothing is
/// configured. Errors only on a malformed file.
pub(crate) fn default_model() -> Result<Option<String>, String> {
    let config = load_raw()?;
    if let Some(model) = config.default_model.filter(|m| !m.trim().is_empty()) {
        return Ok(Some(model));
    }
    let mut providers: Vec<_> = config.providers.into_iter().collect();
    providers.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(providers
        .into_iter()
        .find_map(|(_, entry)| entry.models.into_iter().next()))
}

/// Resolve the `smol` role model from `~/.jan/config.toml`: the explicit
/// `smol_model` key if set. `None` when unset (callers fall back to the
/// session's main model). Errors only on a malformed file.
pub(crate) fn smol_model() -> Result<Option<String>, String> {
    let config = load_raw()?;
    Ok(config.smol_model.filter(|m| !m.trim().is_empty()))
}

/// Whether the TUI should track the mouse (`mouse` in `~/.jan/config.toml`),
/// defaulting to on. A display preference must never block startup, so an
/// unreadable or malformed config yields the default rather than an error.
pub(crate) fn mouse_enabled() -> bool {
    load_raw()
        .ok()
        .and_then(|config| config.mouse)
        .unwrap_or(true)
}

/// Whether the TUI may offer `/terminal-setup` at startup (`terminal_hint` in
/// `~/.jan/config.toml`), defaulting to on. Declining the offer leaves no trace
/// on disk -- the check reads the terminal's own config -- so this key is what
/// turns a standing note off. A display preference must never block startup, so
/// an unreadable config yields the default.
pub(crate) fn terminal_hint_enabled() -> bool {
    load_raw()
        .ok()
        .and_then(|config| config.terminal_hint)
        .unwrap_or(true)
}

/// Whether Jan may reuse Claude Code's keychain login
/// (`claude_code_alias` in `~/.jan/config.toml`), defaulting to on. This
/// setting is deliberately opt-out to preserve existing behavior while making
/// the cross-tool credential reuse explicit and reversible.
pub(crate) fn claude_code_alias_enabled() -> bool {
    load_raw()
        .ok()
        .and_then(|config| config.claude_code_alias)
        .unwrap_or(true)
}

/// Whether `bash` runs sandboxed by default (`sandbox` in `~/.jan/config.toml`).
/// `None` when unset, so the caller can let a project's `agent.toml` or the
/// `--sandbox` flag decide before falling back to the surface default.
///
/// An unreadable or malformed config yields `None` rather than an error: the
/// resolved default is the *safe* direction to fall back to, and a config the
/// user cannot parse must not be the thing that blocks a session from starting.
pub(crate) fn sandbox_setting() -> Option<bool> {
    load_raw().ok().and_then(|config| config.sandbox)
}

/// Whether inline `<think>` tags in model content are parsed as reasoning
/// (`think_tags` in `~/.jan/config.toml`), defaulting to on. `false` makes the
/// tags ordinary prose: rendered verbatim, kept in the answer sent back as
/// history, and never folded into a reasoning block.
///
/// A display preference must never block startup, so an unreadable or malformed
/// config yields the default rather than an error.
pub(crate) fn think_tags_enabled() -> bool {
    load_raw()
        .ok()
        .and_then(|config| config.think_tags)
        .unwrap_or(true)
}

/// Whether the TUI streams reasoning into its live tail while folding is on
/// (`stream_reasoning` in `~/.jan/config.toml`), defaulting to on. `false` keeps
/// a folded block off screen entirely, leaving the header badge to stand for it.
///
/// A display preference must never block startup, so an unreadable or malformed
/// config yields the default rather than an error.
pub(crate) fn stream_reasoning_enabled() -> bool {
    load_raw()
        .ok()
        .and_then(|config| config.stream_reasoning)
        .unwrap_or(true)
}

/// The default glyph swept along the working row when `wave` is absent.
pub(crate) const WAVE_DEFAULT: &str = "👋";

/// The most grapheme clusters a `wave` may hold. Three is the width of the
/// small ASCII-art faces the feature is for (`👁️👄👁️`); past that the glyph
/// stops reading as a traveller and starts overwriting the word it sweeps.
pub(crate) const WAVE_MAX_GRAPHEMES: usize = 3;

/// Grapheme-cluster count, which is what "characters" means to the person
/// typing: `👁️👄👁️` is 3 to them and 5 `char`s to Rust, and an emoji with a
/// skin-tone or ZWJ sequence is worse. Counting `char`s would reject glyphs
/// that visibly fit.
pub(crate) fn wave_len(glyph: &str) -> usize {
    use unicode_segmentation::UnicodeSegmentation;
    glyph.graphemes(true).count()
}

/// Validate a candidate `wave`, returning the reason it is unusable. Empty is
/// valid and means "no sweep" -- the deliberate off switch, distinct from the
/// key being absent, which takes the default.
pub(crate) fn wave_error(glyph: &str) -> Option<String> {
    let len = wave_len(glyph);
    (len > WAVE_MAX_GRAPHEMES).then(|| {
        format!("at most {WAVE_MAX_GRAPHEMES} characters (got {len})")
    })
}

/// The glyph to sweep along the working row (`wave` in `~/.jan/config.toml`).
///
/// Three states, because the key has to distinguish "never touched it" from
/// "turned it off":
///
/// - absent -> `WAVE_DEFAULT`, the wave is on out of the box
/// - `""` -> `None`, the static Braille throbber, chosen deliberately
/// - a glyph -> that glyph
///
/// An all-whitespace glyph is `None` too: an invisible traveller reads as
/// letters going missing, which is the bug this feature had the first time
/// round.
///
/// A value past the length cap falls back to the default rather than
/// erroring. `/settings` rejects an over-long glyph at the point of entry, so
/// this only fires for a hand-edited file, and a display preference must never
/// block startup.
pub(crate) fn wave_glyph() -> Option<String> {
    let Ok(config) = load_raw() else {
        return Some(WAVE_DEFAULT.to_string());
    };
    match config.wave {
        None => Some(WAVE_DEFAULT.to_string()),
        Some(glyph) if glyph.trim().is_empty() => None,
        Some(glyph) if wave_error(&glyph).is_some() => Some(WAVE_DEFAULT.to_string()),
        Some(glyph) => Some(glyph),
    }
}

/// Read `~/.jan/config.toml` into the raw TOML struct for editing. Missing file
/// -> default (empty); malformed file -> error, so a set never silently drops an
/// unparseable file's contents.
fn load_raw() -> Result<GlobalConfigToml, String> {
    let path = global_config_path()?;
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(_) => return Ok(GlobalConfigToml::default()),
    };
    toml::from_str(&raw).map_err(|e| format!("Failed to parse {}: {e}", path.display()))
}

/// Serialize the config back to `~/.jan/config.toml`, creating `~/.jan` if
/// needed. The directory is user-scoped; the file is world-unreadable on Unix
/// since it holds API keys.
fn write_raw(config: &GlobalConfigToml) -> Result<PathBuf, String> {
    let dir = global_jan_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    let path = dir.join("config.toml");
    let body = toml::to_string_pretty(config).map_err(|e| format!("Failed to serialize config: {e}"))?;
    std::fs::write(&path, &body).map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
    restrict_permissions(&path);
    Ok(path)
}

#[cfg(unix)]
fn restrict_permissions(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &std::path::Path) {}

/// Create or update a provider entry in `~/.jan/config.toml`, merging with any
/// existing entry (see [`ProviderUpdate`]). Returns the config path. This is the
/// headless write path that lets a standalone Jan Agent set credentials with no
/// Desktop app present.
pub(crate) fn set_provider(name: &str, update: ProviderUpdate) -> Result<PathBuf, String> {
    if name.trim().is_empty() {
        return Err("provider name must not be empty".to_string());
    }
    let mut config = load_raw()?;
    let entry = config.providers.entry(name.to_string()).or_default();
    if let Some(api_key) = update.api_key {
        // An explicit empty key clears the stored one; `None` leaves it as is.
        entry.api_key = (!api_key.is_empty()).then_some(api_key);
    }
    if update.clear_api_key {
        entry.api_key = None;
    }
    if let Some(base_url) = update.base_url {
        entry.base_url = Some(base_url);
    }
    if let Some(models) = update.models {
        entry.models = models;
    }
    if let Some(api_type) = update.api_type {
        entry.api_type = Some(api_type);
    }
    write_raw(&config)
}

/// Point `default_model` at `model` unless the user already chose one. Returns
/// `true` when it was written. Used by sign-in flows: the first provider a user
/// connects should become runnable without a second config step, but an explicit
/// choice must never be overwritten.
pub(crate) fn set_default_model_if_unset(model: &str) -> Result<bool, String> {
    if model.trim().is_empty() {
        return Ok(false);
    }
    let mut config = load_raw()?;
    if config
        .default_model
        .as_deref()
        .is_some_and(|m| !m.trim().is_empty())
    {
        return Ok(false);
    }
    config.default_model = Some(model.to_string());
    write_raw(&config)?;
    Ok(true)
}

/// Remove a provider entry from `~/.jan/config.toml`. Returns `true` if the
/// provider existed and was removed, `false` if it was already absent.
pub(crate) fn remove_provider(name: &str) -> Result<bool, String> {
    let mut config = load_raw()?;
    if config.providers.remove(name).is_none() {
        return Ok(false);
    }
    write_raw(&config)?;
    Ok(true)
}

/// Read one top-level scalar from `~/.jan/config.toml` as a display string.
/// `None` when the key is absent or the file is unreadable. Reads through
/// `toml_edit` rather than the typed struct so the caller gets the value the
/// user actually typed, and so a key this build does not know about still
/// round-trips.
#[cfg(feature = "cli")]
pub(crate) fn global_value(key: &str) -> Option<String> {
    let raw = std::fs::read_to_string(global_config_path().ok()?).ok()?;
    let doc = raw.parse::<toml_edit::DocumentMut>().ok()?;
    let item = doc.get(key)?;
    Some(match item.as_value() {
        Some(toml_edit::Value::String(s)) => s.value().to_string(),
        Some(toml_edit::Value::Integer(i)) => i.value().to_string(),
        Some(toml_edit::Value::Boolean(b)) => b.value().to_string(),
        _ => item.to_string(),
    })
}

/// Persist a top-level scalar into `~/.jan/config.toml`, format-preserving.
/// `None` removes the key so its default applies again.
///
/// This edits the document rather than round-tripping the typed struct the way
/// [`set_provider`] does: the scaffolded file is mostly *commented* examples,
/// and re-serializing would throw every one of them away the first time a user
/// toggled a display preference. Creates the file from the template when it is
/// missing, so a first toggle lands in a documented file.
#[cfg(feature = "cli")]
pub(crate) fn set_global_key(key: &str, value: Option<toml_edit::Item>) -> Result<PathBuf, String> {
    let path = ensure_global_config()?;
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    let mut doc = raw
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| format!("Failed to parse {}: {e}", path.display()))?;

    match value {
        // `toml_edit` renders a root table's scalars ahead of its sub-tables,
        // so a key appended here still reads back as a document key and not as
        // a member of the last `[providers.*]` table. The round-trip test below
        // pins that.
        Some(v) => doc[key] = v,
        None => {
            doc.remove(key);
        }
    }

    std::fs::write(&path, doc.to_string())
        .map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
    restrict_permissions(&path);
    Ok(path)
}

/// Scaffold `~/.jan/config.toml` with a commented example, if it doesn't exist
/// yet. Idempotent and clobber-safe: never overwrites an existing file.
pub(crate) fn ensure_global_config() -> Result<PathBuf, String> {
    let dir = global_jan_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    let path = dir.join("config.toml");
    if !path.exists() {
        std::fs::write(&path, GLOBAL_CONFIG_TEMPLATE)
            .map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
    }
    Ok(path)
}

/// Redirect `HOME` to a scratch dir for the duration of `f`. Every test that
/// touches `~/.jan` must go through this one helper: `HOME` is process-wide, so
/// a second lock elsewhere would let those tests race each other.
#[cfg(test)]
pub(crate) fn with_temp_home<T>(f: impl FnOnce(&std::path::Path) -> T) -> T {
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());
    static COUNTER: AtomicU32 = AtomicU32::new(0);

    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let home = std::env::temp_dir().join(format!("jan_global_cfg_test_{n}"));
    std::fs::create_dir_all(&home).unwrap();
    let prev = std::env::var_os("HOME");
    std::env::set_var("HOME", &home);
    let result = f(&home);
    match prev {
        Some(p) => std::env::set_var("HOME", p),
        None => std::env::remove_var("HOME"),
    }
    let _ = std::fs::remove_dir_all(&home);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_yields_empty_map() {
        with_temp_home(|_| {
            let configs = load_global_config().expect("load");
            assert!(configs.is_empty());
        });
    }

    #[test]
    fn mouse_defaults_on_and_reads_the_toml_key() {
        with_temp_home(|_| {
            assert!(mouse_enabled(), "missing file -> tracking on");
            let path = ensure_global_config().expect("ensure");
            assert!(mouse_enabled(), "scaffolded file -> tracking on");

            std::fs::write(&path, "mouse = false\n").unwrap();
            assert!(!mouse_enabled());
            std::fs::write(&path, "mouse = true\n").unwrap();
            assert!(mouse_enabled());

            std::fs::write(&path, "not valid toml [[[").unwrap();
            assert!(mouse_enabled(), "an unreadable config keeps the default");
        });
    }

    #[test]
    fn terminal_hint_defaults_on_and_reads_the_toml_key() {
        with_temp_home(|_| {
            assert!(terminal_hint_enabled(), "missing file -> hint on");
            let path = ensure_global_config().expect("ensure");
            assert!(terminal_hint_enabled(), "scaffolded file -> hint on");

            std::fs::write(&path, "terminal_hint = false\n").unwrap();
            assert!(!terminal_hint_enabled());
            std::fs::write(&path, "terminal_hint = true\n").unwrap();
            assert!(terminal_hint_enabled());

            std::fs::write(&path, "not valid toml [[[").unwrap();
            assert!(
                terminal_hint_enabled(),
                "an unreadable config keeps the default"
            );
        });
    }

    #[test]
    fn claude_code_alias_defaults_on_and_reads_the_toml_key() {
        with_temp_home(|_| {
            assert!(claude_code_alias_enabled(), "missing file -> alias on");
            let path = ensure_global_config().expect("ensure");
            assert!(claude_code_alias_enabled(), "scaffolded file -> alias on");

            std::fs::write(&path, "claude_code_alias = false\n").unwrap();
            assert!(!claude_code_alias_enabled());
            std::fs::write(&path, "claude_code_alias = true\n").unwrap();
            assert!(claude_code_alias_enabled());

            std::fs::write(&path, "not valid toml [[[").unwrap();
            assert!(
                claude_code_alias_enabled(),
                "an unreadable config keeps the default"
            );
        });
    }

    #[test]
    fn think_tags_default_on_and_read_from_the_toml_key() {
        with_temp_home(|_| {
            assert!(think_tags_enabled(), "missing file -> parsing on");
            let path = ensure_global_config().expect("ensure");
            assert!(think_tags_enabled(), "scaffolded file -> parsing on");

            std::fs::write(&path, "think_tags = false\n").unwrap();
            assert!(!think_tags_enabled());
            std::fs::write(&path, "think_tags = true\n").unwrap();
            assert!(think_tags_enabled());

            std::fs::write(&path, "not valid toml [[[").unwrap();
            assert!(think_tags_enabled(), "an unreadable config keeps the default");
        });
    }

    #[test]
    fn wave_defaults_to_the_hand_and_reads_the_toml_key() {
        with_temp_home(|_| {
            assert_eq!(
                wave_glyph().as_deref(),
                Some(WAVE_DEFAULT),
                "missing file -> the default sweep, not off"
            );
            let path = ensure_global_config().expect("ensure");
            assert_eq!(
                wave_glyph().as_deref(),
                Some(WAVE_DEFAULT),
                "scaffolded file only comments the key, so the default still applies"
            );

            // Any string within the cap, not a fixed set: the point of the key
            // is the user's own glyph.
            std::fs::write(&path, "wave = \"🍌\"\n").unwrap();
            assert_eq!(wave_glyph().as_deref(), Some("🍌"));
            std::fs::write(&path, "wave = \"<o>\"\n").unwrap();
            assert_eq!(wave_glyph().as_deref(), Some("<o>"));
            // Three clusters that are five `char`s: the cap counts what the
            // eye counts, so this fits.
            std::fs::write(&path, "wave = \"👁️👄👁️\"\n").unwrap();
            assert_eq!(wave_glyph().as_deref(), Some("👁️👄👁️"));

            // An explicit empty string is the off switch, and the one case
            // that must not fall back to the default.
            std::fs::write(&path, "wave = \"\"\n").unwrap();
            assert_eq!(wave_glyph(), None, "empty is a deliberate off");

            // A blank glyph would sweep an invisible traveller along the row,
            // which reads as characters going missing.
            std::fs::write(&path, "wave = \"   \"\n").unwrap();
            assert_eq!(wave_glyph(), None, "whitespace is off too");

            // Hand-edited past the cap: a display preference must not break
            // the console, so it reverts rather than erroring.
            std::fs::write(&path, "wave = \"abcd\"\n").unwrap();
            assert_eq!(
                wave_glyph().as_deref(),
                Some(WAVE_DEFAULT),
                "over the cap falls back to the default"
            );

            std::fs::write(&path, "not valid toml [[[").unwrap();
            assert_eq!(
                wave_glyph().as_deref(),
                Some(WAVE_DEFAULT),
                "an unreadable config keeps the default"
            );
        });
    }

    #[test]
    fn wave_length_counts_grapheme_clusters() {
        // The whole reason the cap is not `chars().count()`: each of these is
        // one thing to the person typing it.
        assert_eq!(wave_len(""), 0);
        assert_eq!(wave_len("~"), 1);
        assert_eq!(wave_len("👋"), 1);
        assert_eq!(wave_len("👋🏽"), 1, "skin-tone modifier joins the cluster");
        assert_eq!(wave_len("👁️"), 1, "variation selector joins the cluster");
        assert_eq!(wave_len("👨‍👩‍👧"), 1, "ZWJ family is one cluster");
        assert_eq!(wave_len("👁️👄👁️"), 3, "5 chars, 3 clusters");

        assert!(wave_error("").is_none(), "empty is the off switch, not an error");
        assert!(wave_error("👁️👄👁️").is_none(), "exactly at the cap");
        assert!(wave_error("<o>").is_none());
        let err = wave_error("abcd").expect("over the cap");
        assert!(err.contains('3') && err.contains('4'), "names cap and actual: {err}");
    }

    /// The `/settings` write path. Two properties matter and neither is
    /// obvious: the commented template survives a write (the typed round-trip
    /// `write_raw` does would throw every example line away), and a key added
    /// to a file that already holds `[providers.*]` tables reads back as a
    /// document key rather than as a member of the last table.
    #[test]
    fn set_global_key_preserves_comments_and_stays_out_of_provider_tables() {
        with_temp_home(|_| {
            let path = ensure_global_config().expect("ensure");
            std::fs::write(
                &path,
                "# keep me\n[providers.openai]\napi_key = \"sk-x\"\n",
            )
            .unwrap();

            set_global_key("wave", Some(toml_edit::value("🍌"))).expect("set");
            let raw = std::fs::read_to_string(&path).unwrap();
            assert!(raw.contains("# keep me"), "comment survives the write: {raw}");
            assert!(raw.contains("sk-x"), "provider survives the write: {raw}");
            assert_eq!(
                wave_glyph().as_deref(),
                Some("🍌"),
                "key must parse as a document key, not a provider field: {raw}"
            );
            assert_eq!(global_value("wave").as_deref(), Some("🍌"));

            set_global_key("wave", None).expect("unset");
            assert_eq!(global_value("wave"), None, "None removes the key");
            assert_eq!(
                wave_glyph().as_deref(),
                Some(WAVE_DEFAULT),
                "a removed key falls back to the default, not to off"
            );
            let raw = std::fs::read_to_string(&path).unwrap();
            assert!(raw.contains("sk-x"), "unset leaves the rest alone: {raw}");
        });
    }

    /// A first toggle on a machine with no config must land in a real file
    /// rather than error, and that file should be the documented template.
    #[test]
    fn set_global_key_scaffolds_a_missing_config() {
        with_temp_home(|home| {
            let path = home.join(".jan").join("config.toml");
            assert!(!path.exists(), "starting from no config");

            set_global_key("wave", Some(toml_edit::value("~"))).expect("set");
            let raw = std::fs::read_to_string(&path).unwrap();
            assert!(raw.contains("Jan Agent global provider config"), "{raw}");
            assert_eq!(wave_glyph().as_deref(), Some("~"));
        });
    }

    #[test]
    fn stream_reasoning_default_on_and_read_from_the_toml_key() {
        with_temp_home(|_| {
            assert!(stream_reasoning_enabled(), "missing file -> streaming on");
            let path = ensure_global_config().expect("ensure");
            assert!(stream_reasoning_enabled(), "scaffolded file -> streaming on");

            std::fs::write(&path, "stream_reasoning = false\n").unwrap();
            assert!(!stream_reasoning_enabled());
            std::fs::write(&path, "stream_reasoning = true\n").unwrap();
            assert!(stream_reasoning_enabled());

            std::fs::write(&path, "not valid toml [[[").unwrap();
            assert!(
                stream_reasoning_enabled(),
                "an unreadable config keeps the default"
            );
        });
    }

    #[test]
    fn ensure_scaffolds_and_is_idempotent() {
        with_temp_home(|home| {
            let path = ensure_global_config().expect("ensure");
            assert_eq!(path, home.join(".jan").join("config.toml"));
            assert!(path.exists());

            std::fs::write(&path, "[providers.openai]\napi_key = \"sk-x\"\n").unwrap();
            ensure_global_config().expect("ensure again");
            let raw = std::fs::read_to_string(&path).unwrap();
            assert!(raw.contains("sk-x"), "must not clobber existing file");
        });
    }

    #[test]
    fn loads_providers_from_config() {
        with_temp_home(|_| {
            ensure_global_config().expect("ensure");
            let path = global_config_path().unwrap();
            std::fs::write(
                &path,
                r#"[providers.openai]
api_key = "sk-abc"
base_url = "https://api.openai.com/v1"
models = ["gpt-4o"]
"#,
            )
            .unwrap();

            let configs = load_global_config().expect("load");
            let openai = configs.get("openai").expect("openai present");
            assert_eq!(openai.api_key.as_deref(), Some("sk-abc"));
            assert_eq!(openai.base_url.as_deref(), Some("https://api.openai.com/v1"));
            assert_eq!(openai.models, vec!["gpt-4o".to_string()]);
        });
    }

    #[test]
    fn malformed_file_errors() {
        with_temp_home(|_| {
            let path = ensure_global_config().expect("ensure");
            std::fs::write(&path, "not valid toml [[[").unwrap();
            assert!(load_global_config().is_err());
        });
    }

    #[test]
    fn set_provider_creates_and_roundtrips() {
        with_temp_home(|_| {
            set_provider(
                "openai",
                ProviderUpdate {
                    api_key: Some("sk-1".into()),
                    clear_api_key: false,
                    base_url: Some("https://api.openai.com/v1".into()),
                    models: Some(vec!["gpt-4o".into()]),
                    api_type: None,
                },
            )
            .expect("set");
            let configs = load_global_config().expect("load");
            let openai = configs.get("openai").expect("present");
            assert_eq!(openai.api_key.as_deref(), Some("sk-1"));
            assert_eq!(openai.base_url.as_deref(), Some("https://api.openai.com/v1"));
            assert_eq!(openai.models, vec!["gpt-4o".to_string()]);
        });
    }

    #[test]
    fn set_provider_merges_without_clobbering_other_fields_or_providers() {
        with_temp_home(|_| {
            set_provider(
                "openai",
                ProviderUpdate {
                    api_key: Some("sk-1".into()),
                    clear_api_key: false,
                    base_url: Some("https://a".into()),
                    models: Some(vec!["gpt-4o".into()]),
                    api_type: None,
                },
            )
            .unwrap();
            set_provider("anthropic", ProviderUpdate { api_key: Some("sk-ant".into()), ..Default::default() }).unwrap();
            // Update only the openai key; base_url + models must survive.
            set_provider("openai", ProviderUpdate { api_key: Some("sk-2".into()), ..Default::default() }).unwrap();

            let configs = load_global_config().expect("load");
            let openai = configs.get("openai").unwrap();
            assert_eq!(openai.api_key.as_deref(), Some("sk-2"));
            assert_eq!(openai.base_url.as_deref(), Some("https://a"));
            assert_eq!(openai.models, vec!["gpt-4o".to_string()]);
            assert_eq!(configs.get("anthropic").unwrap().api_key.as_deref(), Some("sk-ant"));
        });
    }

    /// `Some("")` for the api key clears the stored one (a local endpoint
    /// that dropped auth), while `None` still merges (key kept).
    #[test]
    fn set_provider_empty_key_clears_none_keeps() {
        with_temp_home(|_| {
            set_provider(
                "local",
                ProviderUpdate {
                    api_key: Some("sk-1".into()),
                    base_url: Some("http://127.0.0.1:1234/v1".into()),
                    ..Default::default()
                },
            )
            .unwrap();
            set_provider("local", ProviderUpdate::default()).unwrap();
            assert_eq!(
                load_global_config().unwrap().get("local").unwrap().api_key.as_deref(),
                Some("sk-1"),
                "None merges: key kept"
            );
            set_provider("local", ProviderUpdate { api_key: Some(String::new()), ..Default::default() }).unwrap();
            assert_eq!(
                load_global_config().unwrap().get("local").unwrap().api_key,
                None,
                "explicit empty key clears"
            );
        });
    }

    #[test]
    fn set_provider_rejects_empty_name() {
        with_temp_home(|_| {
            assert!(set_provider("  ", ProviderUpdate::default()).is_err());
        });
    }

    #[test]
    fn default_model_none_when_empty() {
        with_temp_home(|_| {
            assert_eq!(default_model().expect("default"), None);
        });
    }

    #[test]
    fn default_model_derives_from_first_provider_model() {
        with_temp_home(|_| {
            set_provider("openai", ProviderUpdate { models: Some(vec!["gpt-4o".into()]), ..Default::default() }).unwrap();
            assert_eq!(default_model().expect("default").as_deref(), Some("gpt-4o"));
        });
    }

    #[test]
    fn default_model_prefers_explicit_key() {
        with_temp_home(|_| {
            let path = global_config_path().unwrap();
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(
                &path,
                "default_model = \"claude-sonnet-5\"\n[providers.openai]\nmodels = [\"gpt-4o\"]\n",
            )
            .unwrap();
            assert_eq!(default_model().expect("default").as_deref(), Some("claude-sonnet-5"));
        });
    }

    #[test]
    fn default_model_derivation_is_deterministic_by_provider_name() {
        with_temp_home(|_| {
            set_provider("zeta", ProviderUpdate { models: Some(vec!["z-model".into()]), ..Default::default() }).unwrap();
            set_provider("alpha", ProviderUpdate { models: Some(vec!["a-model".into()]), ..Default::default() }).unwrap();
            assert_eq!(default_model().expect("default").as_deref(), Some("a-model"));
        });
    }

    #[test]
    fn set_provider_preserves_default_model_key() {
        with_temp_home(|_| {
            let path = global_config_path().unwrap();
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, "default_model = \"m1\"\n").unwrap();
            set_provider("openai", ProviderUpdate { api_key: Some("sk".into()), ..Default::default() }).unwrap();
            assert_eq!(default_model().expect("default").as_deref(), Some("m1"));
        });
    }

    #[test]
    fn default_model_is_set_once_and_never_overwritten() {
        with_temp_home(|_| {
            assert!(set_default_model_if_unset("m1").expect("set"));
            assert_eq!(default_model().expect("read").as_deref(), Some("m1"));
            assert!(!set_default_model_if_unset("m2").expect("set again"));
            assert_eq!(default_model().expect("read").as_deref(), Some("m1"));
        });
    }

    #[test]
    fn default_model_set_keeps_existing_providers_and_rejects_blank() {
        with_temp_home(|_| {
            set_provider(
                "tokamak",
                ProviderUpdate { api_key: Some("tk".into()), ..Default::default() },
            )
            .unwrap();
            assert!(!set_default_model_if_unset("  ").expect("blank"));
            assert!(set_default_model_if_unset("m1").expect("set"));
            let configs = load_global_config().expect("load");
            assert_eq!(configs.get("tokamak").unwrap().api_key.as_deref(), Some("tk"));
        });
    }

    #[test]
    fn remove_provider_reports_presence() {
        with_temp_home(|_| {
            set_provider("openai", ProviderUpdate { api_key: Some("sk-1".into()), ..Default::default() }).unwrap();
            assert!(remove_provider("openai").expect("remove"));
            assert!(!remove_provider("openai").expect("remove again"));
            assert!(!load_global_config().unwrap().contains_key("openai"));
        });
    }

    #[test]
    fn set_provider_preserves_commented_scaffold_is_lost_but_data_kept() {
        // A hand-edited file with real entries roundtrips through set (comments in
        // the scaffold are not preserved, but no provider data is lost).
        with_temp_home(|_| {
            let path = global_config_path().unwrap();
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, "[providers.groq]\napi_key = \"gk\"\n").unwrap();
            set_provider("openai", ProviderUpdate { api_key: Some("sk".into()), ..Default::default() }).unwrap();
            let configs = load_global_config().unwrap();
            assert_eq!(configs.get("groq").unwrap().api_key.as_deref(), Some("gk"));
            assert_eq!(configs.get("openai").unwrap().api_key.as_deref(), Some("sk"));
        });
    }
}
