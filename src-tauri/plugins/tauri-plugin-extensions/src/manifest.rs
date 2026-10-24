//! The `jan` manifest of an extension's package.json, checked with the same
//! rules as `validateManifest` in `@janhq/extension-api` (validate.ts), plus
//! what only the host can check: that the API range and `engines.jan` fit
//! this Jan, and that `main` is a real file inside the extracted package.
//!
//! Error paths and messages match the TypeScript validator, so the install UI
//! shows the same text whichever side refused a manifest.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use crate::error::{ManifestErrors, ManifestIssue};
use crate::permissions::{
    is_local_host, is_permission_string, network_host_matches, network_host_of,
};

/// The `@janhq/extension-api` version this host implements. A vitest guard
/// keeps it equal to that package's version and `API_VERSION`.
pub const HOST_API_VERSION: &str = "1.0.0";

/// Largest entry bundle the host will load into a worker.
pub const MAX_MAIN_BYTES: u64 = 5 * 1024 * 1024;

const MANIFEST_KEYS: &[&str] = &[
    "id",
    "displayName",
    "description",
    "publisher",
    "apiVersion",
    "main",
    "permissions",
    "proposals",
    "contributes",
    "l10n",
];
const CONTRIBUTION_KEYS: &[&str] = &[
    "settings",
    "commands",
    "menus",
    "statusItems",
    "tools",
    "providers",
];
const MENU_LOCATIONS: &[&str] = &[
    "commandPalette",
    "thread/context",
    "message/actions",
    "chatInput/actions",
];
const WHEN_CLAUSES: &[&str] = &[
    "always",
    "message.role == assistant",
    "message.role == user",
    "thread.hasMessages",
];
const PROPOSALS: &[&str] = &["chat"];
const INPUT_TYPES: &[&str] = &["text", "url", "number"];

/// What a valid manifest yields: the fields the installer acts on, plus the
/// whole package.json for the UI.
#[derive(Debug, Clone, PartialEq)]
pub struct ValidatedManifest {
    /// `jan.id`, `<publisher>.<name>`.
    pub id: String,
    /// package.json `name`.
    pub name: String,
    /// package.json `version`, a semver version.
    pub version: String,
    /// `jan.displayName`.
    pub display_name: String,
    /// `jan.main`, normalised without a leading `./`.
    pub main: String,
    /// `jan.permissions`, in manifest order, without duplicates.
    pub permissions: Vec<String>,
    /// `engines.jan`, if declared.
    pub engines_jan: Option<String>,
    /// The package.json as read.
    pub package: Value,
}

/// True for an extension id: `<publisher>.<name>`, each part 2-39 lowercase
/// letters, digits or dashes, starting with a letter or digit, and not a
/// Windows device name (the id is a directory name, and Windows reads
/// `con.ab` as the device `con`).
pub fn is_extension_id(value: &str) -> bool {
    fn part(s: &str) -> bool {
        let bytes = s.as_bytes();
        !crate::bundle::RESERVED_NAMES.contains(&s)
            && (2..=39).contains(&bytes.len())
            && (bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit())
            && bytes
                .iter()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
    }
    match value.split_once('.') {
        Some((publisher, name)) => part(publisher) && part(name),
        None => false,
    }
}

/// The grammar of a command, status item or provider id and of a tool name
/// (`isContributionId`): 1-64 letters, digits, `.`, `_` and `-`, starting
/// with a letter or digit.
pub fn is_contribution_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 64
        && bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

fn is_numeric_id(s: &str) -> bool {
    s == "0" || (!s.is_empty() && !s.starts_with('0') && s.bytes().all(|b| b.is_ascii_digit()))
}

fn is_dotted_ids(s: &str) -> bool {
    s.split('.').all(|part| {
        !part.is_empty()
            && part
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    })
}

/// A full semver 2.0.0 version, with the same leniency as the TypeScript
/// regex (numeric prerelease parts may have leading zeros).
pub fn is_semver(version: &str) -> bool {
    let (rest, build) = match version.split_once('+') {
        Some((rest, build)) => (rest, Some(build)),
        None => (version, None),
    };
    if build.is_some_and(|b| !is_dotted_ids(b)) {
        return false;
    }
    let (core, pre) = match rest.split_once('-') {
        Some((core, pre)) => (core, Some(pre)),
        None => (rest, None),
    };
    if pre.is_some_and(|p| !is_dotted_ids(p)) {
        return false;
    }
    let parts: Vec<&str> = core.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| is_numeric_id(p))
}

fn triple(s: &str) -> Option<(u64, u64, u64)> {
    let mut it = s.split('.');
    let mut next = || -> Option<u64> {
        let part = it.next()?;
        if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        part.parse().ok()
    };
    let t = (next()?, next()?, next()?);
    if it.next().is_some() {
        return None;
    }
    Some(t)
}

/// The only range form manifests may use: `^MAJOR.MINOR.PATCH`.
pub fn is_caret_range(range: &str) -> bool {
    range.strip_prefix('^').and_then(triple).is_some()
}

/// `isApiCompatible`: npm caret semantics, where the left-most non-zero part
/// is locked, so before 1.0 every minor is a breaking change.
pub fn is_api_compatible(range: &str, host: &str) -> bool {
    let (Some(floor), Some(version)) = (range.strip_prefix('^').and_then(triple), triple(host))
    else {
        return false;
    };
    if version < floor {
        return false;
    }
    if floor.0 > 0 {
        return version.0 == floor.0;
    }
    if floor.1 > 0 {
        return version.0 == 0 && version.1 == floor.1;
    }
    version == floor
}

fn non_empty(value: Option<&Value>) -> bool {
    matches!(value, Some(Value::String(s)) if !s.trim().is_empty())
}

fn is_identifier(k: &str) -> bool {
    let mut chars = k.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' || c == '$' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
}

fn key(base: &str, k: &str) -> String {
    if !is_identifier(k) {
        format!("{base}['{k}']")
    } else if base.is_empty() {
        k.to_string()
    } else {
        format!("{base}.{k}")
    }
}

#[derive(Default)]
struct Checker {
    errors: Vec<ManifestIssue>,
}

impl Checker {
    fn fail(&mut self, path: impl Into<String>, message: impl Into<String>) -> bool {
        self.errors.push(ManifestIssue {
            path: path.into(),
            message: message.into(),
        });
        false
    }

    fn string(&mut self, obj: &Map<String, Value>, field: &str, path: &str, optional: bool) -> bool {
        let value = obj.get(field);
        if value.is_none() && optional {
            return true;
        }
        non_empty(value) || self.fail(key(path, field), "must be a non-empty string")
    }

    fn number(&mut self, obj: &Map<String, Value>, field: &str, path: &str, optional: bool) -> bool {
        let value = obj.get(field);
        if value.is_none() && optional {
            return true;
        }
        matches!(value, Some(Value::Number(_))) || self.fail(key(path, field), "must be a number")
    }

    fn known(&mut self, obj: &Map<String, Value>, allowed: &[&str], path: &str) {
        for k in obj.keys() {
            if !allowed.contains(&k.as_str()) {
                self.fail(key(path, k), "is not a known field");
            }
        }
    }

    fn list<F>(&mut self, obj: &Map<String, Value>, field: &str, path: &str, mut each: F)
    where
        F: FnMut(&mut Self, &Map<String, Value>, &str),
    {
        let Some(value) = obj.get(field) else {
            return;
        };
        let list_path = key(path, field);
        let Value::Array(items) = value else {
            self.fail(list_path, "must be an array");
            return;
        };
        for (i, item) in items.iter().enumerate() {
            let item_path = format!("{list_path}[{i}]");
            match item {
                Value::Object(map) => each(self, map, &item_path),
                _ => {
                    self.fail(item_path, "must be an object");
                }
            }
        }
    }

    fn contribution_id(&mut self, obj: &Map<String, Value>, field: &str, path: &str) -> bool {
        if !self.string(obj, field, path, false) {
            return false;
        }
        let ok = obj
            .get(field)
            .and_then(Value::as_str)
            .is_some_and(is_contribution_id);
        ok || self.fail(
            key(path, field),
            "must be 1-64 letters, digits, dots, underscores or dashes, starting with a letter or digit",
        )
    }

    fn unique(&mut self, seen: &mut BTreeSet<String>, obj: &Map<String, Value>, field: &str, path: &str) {
        let Some(Value::String(value)) = obj.get(field) else {
            return;
        };
        if !seen.insert(value.clone()) {
            self.fail(key(path, field), format!("duplicates '{value}'"));
        }
    }
}

fn check_main(c: &mut Checker, main: Option<&Value>) {
    let path = "jan.main";
    let Some(main) = main.and_then(Value::as_str).filter(|s| !s.trim().is_empty()) else {
        c.fail(path, "must be a non-empty string");
        return;
    };
    let relative = main.strip_prefix("./").unwrap_or(main);
    // Rejects absolute paths, drive letters, backslashes and any `.`/`..`
    // segment, so the entry always resolves inside the package directory.
    let escapes = main.contains('\\')
        || main.contains(':')
        || relative
            .split('/')
            .any(|s| s.is_empty() || s == "." || s == "..");
    if escapes {
        c.fail(path, "must be a relative path inside the package");
    } else if !relative.ends_with(".js") {
        c.fail(path, "must point at a .js file");
    }
}

fn check_permissions(c: &mut Checker, value: Option<&Value>) -> Vec<String> {
    let Some(Value::Array(items)) = value else {
        c.fail("jan.permissions", "must be an array");
        return Vec::new();
    };
    let mut valid: Vec<String> = Vec::new();
    for (i, p) in items.iter().enumerate() {
        let path = format!("jan.permissions[{i}]");
        match p.as_str() {
            Some(p) if is_permission_string(p) => {
                if valid.iter().any(|v| v == p) {
                    c.fail(path, format!("duplicates '{p}'"));
                } else {
                    valid.push(p.to_string());
                }
            }
            _ => {
                c.fail(path, "is not a known permission");
            }
        }
    }
    valid
}

fn check_proposals(c: &mut Checker, value: Option<&Value>) {
    let Some(value) = value else {
        return;
    };
    let Value::Array(items) = value else {
        c.fail("jan.proposals", "must be an array");
        return;
    };
    for (i, p) in items.iter().enumerate() {
        if !p.as_str().is_some_and(|p| PROPOSALS.contains(&p)) {
            c.fail(format!("jan.proposals[{i}]"), "is not a known proposal");
        }
    }
}

fn check_control(c: &mut Checker, control: Option<&Value>, path: &str) {
    let Some(Value::Object(control)) = control else {
        c.fail(path, "must be an object");
        return;
    };
    let def = control.get("default");
    let def_path = format!("{path}.default");
    match control.get("type").and_then(Value::as_str) {
        Some("input") => {
            c.known(control, &["type", "inputType", "placeholder", "default"], path);
            if let Some(input_type) = control.get("inputType") {
                if !input_type.as_str().is_some_and(|t| INPUT_TYPES.contains(&t)) {
                    c.fail(
                        format!("{path}.inputType"),
                        format!("must be one of {}", INPUT_TYPES.join(", ")),
                    );
                }
            }
            c.string(control, "placeholder", path, true);
            if !matches!(def, Some(Value::String(_))) {
                c.fail(def_path, "must be a string");
            }
        }
        Some("textarea") => {
            c.known(control, &["type", "rows", "default"], path);
            c.number(control, "rows", path, true);
            if !matches!(def, Some(Value::String(_))) {
                c.fail(def_path, "must be a string");
            }
        }
        Some("checkbox") => {
            c.known(control, &["type", "default"], path);
            if !matches!(def, Some(Value::Bool(_))) {
                c.fail(def_path, "must be a boolean");
            }
        }
        Some("dropdown") => {
            c.known(control, &["type", "options", "default"], path);
            let mut values: Vec<String> = Vec::new();
            c.list(control, "options", path, |c, option, option_path| {
                c.known(option, &["value", "label"], option_path);
                if c.string(option, "value", option_path, false) {
                    if let Some(v) = option.get("value").and_then(Value::as_str) {
                        values.push(v.to_string());
                    }
                }
                c.string(option, "label", option_path, false);
            });
            let has_options = matches!(control.get("options"), Some(Value::Array(o)) if !o.is_empty());
            if !has_options {
                c.fail(format!("{path}.options"), "must list at least one option");
            } else if !def
                .and_then(Value::as_str)
                .is_some_and(|d| values.iter().any(|v| v == d))
            {
                c.fail(def_path, "must be one of the option values");
            }
        }
        Some("slider") => {
            c.known(control, &["type", "min", "max", "step", "default"], path);
            let ok = [
                c.number(control, "min", path, false),
                c.number(control, "max", path, false),
                c.number(control, "step", path, false),
                c.number(control, "default", path, false),
            ]
            .iter()
            .all(|ok| *ok);
            if !ok {
                return;
            }
            let num = |k: &str| control.get(k).and_then(Value::as_f64).unwrap_or(0.0);
            let (min, max, step, def) = (num("min"), num("max"), num("step"), num("default"));
            if min > max || step <= 0.0 {
                c.fail(path, "needs min <= max and a positive step");
            } else if def < min || def > max {
                c.fail(def_path, "must lie within min and max");
            }
        }
        _ => {
            c.fail(
                format!("{path}.type"),
                "must be input, textarea, checkbox, dropdown or slider",
            );
        }
    }
}

fn check_provider_url(c: &mut Checker, value: &str, path: &str, permissions: &[String]) {
    let Ok(url) = url::Url::parse(value) else {
        c.fail(path, "must be an absolute URL");
        return;
    };
    let host = url.host_str().unwrap_or("");
    let scheme = url.scheme();
    if scheme != "https" && !(scheme == "http" && is_local_host(host)) {
        c.fail(
            path,
            "must use https (http is allowed only for localhost and 127.0.0.1)",
        );
        return;
    }
    let granted = permissions
        .iter()
        .filter_map(|p| network_host_of(p))
        .any(|grant| network_host_matches(grant, host));
    if !granted {
        c.fail(path, format!("needs the permission network:{host}"));
    }
}

fn check_contributions(c: &mut Checker, contributes: Option<&Value>, permissions: &[String]) {
    let path = "jan.contributes";
    let Some(contributes) = contributes else {
        return;
    };
    let Value::Object(contributes) = contributes else {
        c.fail(path, "must be an object");
        return;
    };
    c.known(contributes, CONTRIBUTION_KEYS, path);

    let mut secret_settings: BTreeMap<String, bool> = BTreeMap::new();
    let mut setting_keys = BTreeSet::new();
    c.list(contributes, "settings", path, |c, s, p| {
        c.known(s, &["key", "title", "description", "secret", "control"], p);
        c.string(s, "key", p, false);
        c.unique(&mut setting_keys, s, "key", p);
        c.string(s, "title", p, false);
        c.string(s, "description", p, true);
        let secret = s.get("secret");
        match secret {
            Some(v) if !v.is_boolean() => {
                c.fail(format!("{p}.secret"), "must be a boolean");
            }
            Some(Value::Bool(true)) => {
                // The OS keyring holds strings only.
                let control_type = s
                    .get("control")
                    .and_then(Value::as_object)
                    .map(|control| control.get("type").and_then(Value::as_str));
                if let Some(t) = control_type {
                    if t != Some("input") && t != Some("textarea") {
                        c.fail(
                            format!("{p}.secret"),
                            "is only allowed on input and textarea controls",
                        );
                    }
                }
            }
            _ => {}
        }
        check_control(c, s.get("control"), &format!("{p}.control"));
        if let Some(k) = s.get("key").and_then(Value::as_str) {
            secret_settings
                .entry(k.to_string())
                .or_insert(matches!(secret, Some(Value::Bool(true))));
        }
    });

    let mut commands = BTreeSet::new();
    c.list(contributes, "commands", path, |c, cmd, p| {
        c.known(cmd, &["id", "title", "category", "icon"], p);
        c.contribution_id(cmd, "id", p);
        c.unique(&mut commands, cmd, "id", p);
        c.string(cmd, "title", p, false);
        c.string(cmd, "category", p, true);
        c.string(cmd, "icon", p, true);
    });
    let command_ref = |c: &mut Checker, obj: &Map<String, Value>, p: &str| {
        if let Some(command) = obj.get("command") {
            if !command.as_str().is_some_and(|s| commands.contains(s)) {
                c.fail(
                    format!("{p}.command"),
                    "must name a command declared in contributes.commands",
                );
            }
        }
    };

    match contributes.get("menus") {
        None => {}
        Some(Value::Object(menus)) => {
            let menus_path = format!("{path}.menus");
            for location in menus.keys() {
                if !MENU_LOCATIONS.contains(&location.as_str()) {
                    c.fail(key(&menus_path, location), "is not a known menu location");
                    continue;
                }
                c.list(menus, location, &menus_path, |c, item, p| {
                    c.known(item, &["command", "when", "group", "order"], p);
                    if c.string(item, "command", p, false) {
                        command_ref(c, item, p);
                    }
                    if let Some(when) = item.get("when") {
                        if !when.as_str().is_some_and(|w| WHEN_CLAUSES.contains(&w)) {
                            c.fail(format!("{p}.when"), "is not a known when clause");
                        }
                    }
                    c.string(item, "group", p, true);
                    c.number(item, "order", p, true);
                });
            }
        }
        Some(_) => {
            c.fail(format!("{path}.menus"), "must be an object");
        }
    }

    let mut status_ids = BTreeSet::new();
    c.list(contributes, "statusItems", path, |c, item, p| {
        c.known(item, &["id", "text", "tooltip", "command", "priority"], p);
        c.contribution_id(item, "id", p);
        c.unique(&mut status_ids, item, "id", p);
        c.string(item, "text", p, false);
        c.string(item, "tooltip", p, true);
        if item.get("command").is_some() && c.string(item, "command", p, false) {
            command_ref(c, item, p);
        }
        c.number(item, "priority", p, true);
    });

    if contributes.contains_key("tools") && !permissions.iter().any(|p| p == "tools") {
        c.fail(format!("{path}.tools"), "needs the permission 'tools'");
    }
    let mut tool_names = BTreeSet::new();
    c.list(contributes, "tools", path, |c, tool, p| {
        c.known(tool, &["name", "description", "inputSchema"], p);
        c.contribution_id(tool, "name", p);
        c.unique(&mut tool_names, tool, "name", p);
        c.string(tool, "description", p, false);
        let schema_ok = tool
            .get("inputSchema")
            .and_then(Value::as_object)
            .is_some_and(|s| s.get("type").and_then(Value::as_str) == Some("object"));
        if !schema_ok {
            c.fail(
                format!("{p}.inputSchema"),
                "must be a JSON Schema with type 'object'",
            );
        }
    });

    if contributes.contains_key("providers") && !permissions.iter().any(|p| p == "providers") {
        c.fail(format!("{path}.providers"), "needs the permission 'providers'");
    }
    let mut provider_ids = BTreeSet::new();
    c.list(contributes, "providers", path, |c, provider, p| {
        c.known(provider, &["id", "displayName", "baseUrl", "apiKeySetting"], p);
        c.contribution_id(provider, "id", p);
        c.unique(&mut provider_ids, provider, "id", p);
        c.string(provider, "displayName", p, false);
        if c.string(provider, "baseUrl", p, false) {
            if let Some(url) = provider.get("baseUrl").and_then(Value::as_str) {
                check_provider_url(c, url, &format!("{p}.baseUrl"), permissions);
            }
        }
        if provider.get("apiKeySetting").is_some() && c.string(provider, "apiKeySetting", p, false) {
            let name = provider.get("apiKeySetting").and_then(Value::as_str).unwrap_or("");
            if secret_settings.get(name) != Some(&true) {
                c.fail(
                    format!("{p}.apiKeySetting"),
                    "must name a secret setting declared in contributes.settings",
                );
            }
        }
    });
}

/// Paths of every user-visible string that may be a `%key%` reference.
fn localizable_strings(jan: &Map<String, Value>) -> Vec<(String, Option<&Value>)> {
    let mut out = vec![
        ("jan.displayName".to_string(), jan.get("displayName")),
        ("jan.description".to_string(), jan.get("description")),
    ];
    let Some(Value::Object(contributes)) = jan.get("contributes") else {
        return out;
    };
    let base = "jan.contributes";
    let lists: &[(&str, &[&str])] = &[
        ("settings", &["title", "description"]),
        ("commands", &["title", "category"]),
        ("statusItems", &["text", "tooltip"]),
        ("providers", &["displayName"]),
    ];
    for (list, fields) in lists {
        let Some(Value::Array(items)) = contributes.get(*list) else {
            continue;
        };
        for (i, item) in items.iter().enumerate() {
            for field in *fields {
                out.push((format!("{base}.{list}[{i}].{field}"), item.get(*field)));
            }
        }
    }
    out
}

/// The key of a `%key%` reference, if `value` is one.
fn l10n_ref(value: &str) -> Option<&str> {
    let inner = value.strip_prefix('%')?.strip_suffix('%')?;
    let ok = !inner.is_empty()
        && inner
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'));
    ok.then_some(inner)
}

fn check_l10n(c: &mut Checker, jan: &Map<String, Value>) {
    let l10n = jan.get("l10n");
    if let Some(l10n) = l10n {
        let valid = l10n.as_object().is_some_and(|locales| {
            locales.values().all(|table| {
                table
                    .as_object()
                    .is_some_and(|t| t.values().all(Value::is_string))
            })
        });
        if !valid {
            c.fail("jan.l10n", "must map locales to tables of strings");
            return;
        }
    }
    let en = l10n
        .and_then(Value::as_object)
        .and_then(|l| l.get("en"))
        .and_then(Value::as_object);
    for (path, value) in localizable_strings(jan) {
        let Some(reference) = value.and_then(Value::as_str).and_then(l10n_ref) else {
            continue;
        };
        if !en.is_some_and(|en| en.contains_key(reference)) {
            c.fail(
                path,
                format!("references '{reference}', which l10n.en does not define"),
            );
        }
    }
}

/// Validates a whole package.json: the `validateManifest` rules, then that
/// `jan.apiVersion` accepts `host_api_version` and that `engines.jan` (when
/// declared) accepts `app_version`. Every problem is reported at once.
pub fn validate(
    pkg: &Value,
    app_version: &str,
    host_api_version: &str,
) -> Result<ValidatedManifest, ManifestErrors> {
    let mut c = Checker::default();
    let Value::Object(obj) = pkg else {
        c.fail("", "package.json must be an object");
        return Err(ManifestErrors(c.errors));
    };
    c.string(obj, "name", "", false);
    if !obj.get("version").and_then(Value::as_str).is_some_and(is_semver) {
        c.fail("version", "must be a semver version");
    }
    let jan_engine = obj
        .get("engines")
        .and_then(Value::as_object)
        .and_then(|e| e.get("jan"));
    if jan_engine.is_some() && !non_empty(jan_engine) {
        c.fail("engines.jan", "must be a version range");
    }

    let Some(Value::Object(jan)) = obj.get("jan") else {
        c.fail("jan", "must be an object");
        return Err(ManifestErrors(c.errors));
    };
    c.known(jan, MANIFEST_KEYS, "jan");
    if !jan.get("id").and_then(Value::as_str).is_some_and(is_extension_id) {
        c.fail(
            "jan.id",
            "must be '<publisher>.<name>' in lowercase letters, digits and dashes",
        );
    }
    c.string(jan, "displayName", "jan", false);
    c.string(jan, "description", "jan", true);
    c.string(jan, "publisher", "jan", false);
    let api_version = jan.get("apiVersion").and_then(Value::as_str);
    match api_version {
        Some(range) if is_caret_range(range) => {
            if !is_api_compatible(range, host_api_version) {
                c.fail(
                    "jan.apiVersion",
                    format!("'{range}' does not accept the extension API {host_api_version} of this Jan"),
                );
            }
        }
        _ => {
            c.fail("jan.apiVersion", "must be a caret range such as '^1.0.0'");
        }
    }
    check_main(&mut c, jan.get("main"));
    let permissions = check_permissions(&mut c, jan.get("permissions"));
    check_proposals(&mut c, jan.get("proposals"));
    check_contributions(&mut c, jan.get("contributes"), &permissions);
    check_l10n(&mut c, jan);

    let engines_jan = jan_engine.and_then(Value::as_str).map(str::to_string);
    if let Some(range) = engines_jan.as_deref().filter(|r| !r.trim().is_empty()) {
        check_engine(&mut c, range, app_version);
    }

    if !c.errors.is_empty() {
        return Err(ManifestErrors(c.errors));
    }
    let text = |k: &str| jan.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
    let main = text("main");
    Ok(ValidatedManifest {
        id: text("id"),
        name: obj.get("name").and_then(Value::as_str).unwrap_or_default().to_string(),
        version: obj.get("version").and_then(Value::as_str).unwrap_or_default().to_string(),
        display_name: text("displayName"),
        main: main.strip_prefix("./").unwrap_or(&main).to_string(),
        permissions,
        engines_jan,
        package: pkg.clone(),
    })
}

fn check_engine(c: &mut Checker, range: &str, app_version: &str) {
    let Ok(req) = semver::VersionReq::parse(range) else {
        c.fail("engines.jan", format!("'{range}' is not a version range Jan can read"));
        return;
    };
    // A development or nightly build carries a prerelease or build suffix;
    // compare its release triple so `>=0.9.0` accepts `0.9.0-nightly.3`.
    let release = semver::Version::parse(app_version)
        .map(|v| semver::Version::new(v.major, v.minor, v.patch));
    match release {
        Ok(version) if req.matches(&version) => {}
        Ok(_) => {
            c.fail(
                "engines.jan",
                format!("needs Jan {range}, and this is Jan {app_version}"),
            );
        }
        Err(_) => {
            c.fail(
                "engines.jan",
                format!("cannot be checked against this Jan's version '{app_version}'"),
            );
        }
    }
}

/// Checks that `main` (as normalised by [`validate`]) names a regular file
/// of at most [`MAX_MAIN_BYTES`] inside `package_root`, and returns its path.
pub fn check_main_file(package_root: &Path, main: &str) -> Result<PathBuf, ManifestErrors> {
    let fail = |message: &str| {
        Err(ManifestErrors(vec![ManifestIssue {
            path: "jan.main".into(),
            message: message.into(),
        }]))
    };
    let mut path = package_root.to_path_buf();
    for part in main.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.contains(['\\', ':']) {
            return fail("must be a relative path inside the package");
        }
        path.push(part);
    }
    // symlink_metadata: a link is never followed out of the package. The
    // extractor writes none, so this only matters for a tampered install.
    match std::fs::symlink_metadata(&path) {
        Ok(meta) if !meta.file_type().is_file() => fail("must name a regular file in the package"),
        Ok(meta) if meta.len() > MAX_MAIN_BYTES => fail("must be at most 5 MiB"),
        Ok(_) => Ok(path),
        Err(_) => fail("names a file the package does not contain"),
    }
}

/// [`validate`] followed by [`check_main_file`] against the extracted package.
pub fn validate_package(
    package_root: &Path,
    pkg: &Value,
    app_version: &str,
    host_api_version: &str,
) -> Result<ValidatedManifest, ManifestErrors> {
    let manifest = validate(pkg, app_version, host_api_version)?;
    check_main_file(package_root, &manifest.main)?;
    Ok(manifest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample() -> Value {
        json!({
            "name": "@acme/hello",
            "version": "0.1.0",
            "engines": { "jan": ">=0.8.0" },
            "jan": {
                "id": "acme.hello",
                "displayName": "%name%",
                "publisher": "Acme",
                "apiVersion": "^1.0.0",
                "main": "./dist/index.js",
                "permissions": ["ui:notify", "tools", "providers", "network:127.0.0.1"],
                "contributes": {
                    "settings": [
                        { "key": "key", "title": "Key", "secret": true,
                          "control": { "type": "input", "default": "" } },
                        { "key": "level", "title": "Level",
                          "control": { "type": "slider", "min": 0, "max": 10, "step": 1, "default": 5 } },
                        { "key": "mode", "title": "Mode",
                          "control": { "type": "dropdown", "options": [{ "value": "a", "label": "A" }], "default": "a" } }
                    ],
                    "commands": [{ "id": "hello.greet", "title": "Greet" }],
                    "menus": { "commandPalette": [{ "command": "hello.greet", "when": "always" }] },
                    "statusItems": [{ "id": "hello.status", "text": "Hi", "command": "hello.greet" }],
                    "tools": [{ "name": "echo_upper", "description": "d", "inputSchema": { "type": "object" } }],
                    "providers": [{ "id": "local", "displayName": "Local",
                                    "baseUrl": "http://127.0.0.1:11999/v1", "apiKeySetting": "key" }]
                },
                "l10n": { "en": { "name": "Hello" } }
            }
        })
    }

    fn paths(pkg: &Value) -> Vec<String> {
        match validate(pkg, "0.8.5", HOST_API_VERSION) {
            Ok(_) => Vec::new(),
            Err(ManifestErrors(errors)) => errors.into_iter().map(|e| e.path).collect(),
        }
    }

    #[test]
    fn accepts_a_complete_manifest() {
        let m = validate(&sample(), "0.8.5", HOST_API_VERSION).unwrap();
        assert_eq!(m.id, "acme.hello");
        assert_eq!(m.main, "dist/index.js");
        assert_eq!(m.version, "0.1.0");
        assert_eq!(m.permissions.len(), 4);
        assert_eq!(m.engines_jan.as_deref(), Some(">=0.8.0"));
    }

    #[test]
    fn id_grammar() {
        for good in ["acme.hello", "a1.b-2", "jan-samples.hello-provider"] {
            assert!(is_extension_id(good), "{good}");
        }
        for bad in ["acme", "a.hello", "Acme.hello", "-a.hello", "acme.hello.x", "acme._x", ""] {
            assert!(!is_extension_id(bad), "{bad}");
        }
    }

    #[test]
    fn id_parts_cannot_be_windows_device_names() {
        for bad in ["con.ab", "nul.xx", "aux.zz", "prn.hello", "acme.com1", "lpt9.hello", "acme.nul"] {
            assert!(!is_extension_id(bad), "{bad}");
        }
        for good in ["cons.ab", "acme.com10", "acme.nul-x", "conx.hello"] {
            assert!(is_extension_id(good), "{good}");
        }
    }

    #[test]
    fn contribution_id_grammar() {
        assert!(is_contribution_id("constructor"));
        assert!(is_contribution_id("a.b_c-d"));
        assert!(!is_contribution_id("__proto__"));
        assert!(!is_contribution_id(""));
        assert!(!is_contribution_id(&"a".repeat(65)));
        assert!(!is_contribution_id("a b"));
    }

    #[test]
    fn semver_and_caret() {
        assert!(is_semver("1.2.3"));
        assert!(is_semver("1.2.3-beta.1+build.5"));
        assert!(!is_semver("01.2.3"));
        assert!(!is_semver("1.2"));
        assert!(!is_semver("1.2.3-"));
        assert!(is_caret_range("^0.1.0"));
        assert!(!is_caret_range("~0.1.0"));
        assert!(!is_caret_range(">=0.1.0"));
        assert!(is_api_compatible("^0.1.0", "0.1.5"));
        assert!(!is_api_compatible("^0.1.0", "0.2.0"));
        assert!(!is_api_compatible("^0.1.2", "0.1.1"));
        assert!(is_api_compatible("^1.2.0", "1.9.0"));
        assert!(!is_api_compatible("^1.2.0", "2.0.0"));
        assert!(is_api_compatible("^0.0.3", "0.0.3"));
        assert!(!is_api_compatible("^0.0.3", "0.0.4"));
    }

    #[test]
    fn rejects_unknown_fields_at_every_level() {
        let mut pkg = sample();
        pkg["jan"]["scripts"] = json!({});
        pkg["jan"]["contributes"]["commands"][0]["run"] = json!("x");
        pkg["jan"]["contributes"]["settings"][0]["control"]["extra"] = json!(1);
        assert_eq!(
            paths(&pkg),
            vec![
                "jan.scripts",
                "jan.contributes.settings[0].control.extra",
                "jan.contributes.commands[0].run",
            ]
        );
    }

    #[test]
    fn main_path_rules() {
        for (main, ok) in [
            ("dist/index.js", true),
            ("./index.js", true),
            ("/abs.js", false),
            ("../x.js", false),
            ("a/./b.js", false),
            ("C:\\x.js", false),
            ("c:/x.js", false),
            ("dist/index.mjs", false),
            ("", false),
        ] {
            let mut pkg = sample();
            pkg["jan"]["main"] = json!(main);
            assert_eq!(paths(&pkg).is_empty(), ok, "{main}");
        }
    }

    #[test]
    fn permission_strings() {
        let mut pkg = sample();
        pkg["jan"]["permissions"] = json!([
            "ui:notify", "network:*.example.com", "network:*", "ui:notify",
            "network:Example.com", "network:a.com:443", "fs:read", "tools", "providers",
            "network:127.0.0.1"
        ]);
        assert_eq!(
            paths(&pkg),
            vec!["jan.permissions[3]", "jan.permissions[4]", "jan.permissions[5]", "jan.permissions[6]"]
        );
    }

    #[test]
    fn contribution_rules() {
        let mut pkg = sample();
        pkg["jan"]["contributes"]["commands"] = json!([
            { "id": "__proto__", "title": "x" },
            { "id": "a", "title": "x" },
            { "id": "a", "title": "y" }
        ]);
        pkg["jan"]["contributes"]["menus"] = json!({
            "nowhere": [],
            "commandPalette": [{ "command": "missing", "when": "sometimes" }]
        });
        pkg["jan"]["contributes"]["statusItems"][0]["command"] = json!("a");
        // Object key order depends on serde_json's preserve_order feature,
        // which the app build may unify on, so compare as a set.
        let mut found = paths(&pkg);
        found.sort();
        assert_eq!(
            found,
            vec![
                "jan.contributes.commands[0].id",
                "jan.contributes.commands[2].id",
                "jan.contributes.menus.commandPalette[0].command",
                "jan.contributes.menus.commandPalette[0].when",
                "jan.contributes.menus.nowhere",
            ]
        );
    }

    #[test]
    fn tools_and_providers_need_their_permissions_and_grants() {
        let mut pkg = sample();
        pkg["jan"]["permissions"] = json!(["ui:notify"]);
        pkg["jan"]["contributes"]["providers"][0]["apiKeySetting"] = json!("level");
        assert_eq!(
            paths(&pkg),
            vec![
                "jan.contributes.tools",
                "jan.contributes.providers",
                "jan.contributes.providers[0].baseUrl",
                "jan.contributes.providers[0].apiKeySetting",
            ]
        );
        let mut pkg = sample();
        pkg["jan"]["contributes"]["providers"][0]["baseUrl"] = json!("http://example.com/v1");
        assert_eq!(paths(&pkg), vec!["jan.contributes.providers[0].baseUrl"]);
    }

    #[test]
    fn setting_controls() {
        let mut pkg = sample();
        pkg["jan"]["contributes"]["settings"] = json!([
            { "key": "a", "title": "A", "control": { "type": "slider", "min": 5, "max": 1, "step": 1, "default": 2 } },
            { "key": "b", "title": "B", "control": { "type": "dropdown", "options": [{ "value": "x", "label": "X" }], "default": "y" } },
            { "key": "c", "title": "C", "secret": true, "control": { "type": "checkbox", "default": true } },
            { "key": "c", "title": "D", "control": { "type": "wheel", "default": 1 } }
        ]);
        pkg["jan"]["contributes"]["providers"][0]
            .as_object_mut()
            .unwrap()
            .remove("apiKeySetting");
        assert_eq!(
            paths(&pkg),
            vec![
                "jan.contributes.settings[0].control",
                "jan.contributes.settings[1].control.default",
                "jan.contributes.settings[2].secret",
                "jan.contributes.settings[3].key",
                "jan.contributes.settings[3].control.type",
            ]
        );
    }

    #[test]
    fn l10n_references_must_resolve() {
        let mut pkg = sample();
        pkg["jan"]["l10n"] = json!({ "fr": { "name": "Bonjour" } });
        assert_eq!(paths(&pkg), vec!["jan.displayName"]);
        pkg["jan"]["l10n"] = json!({ "en": { "name": 1 } });
        assert_eq!(paths(&pkg), vec!["jan.l10n"]);
    }

    #[test]
    fn host_compatibility() {
        let mut pkg = sample();
        pkg["jan"]["apiVersion"] = json!("^0.2.0");
        pkg["engines"]["jan"] = json!(">=0.9.0");
        assert_eq!(paths(&pkg), vec!["jan.apiVersion", "engines.jan"]);
        // A nightly of the required release is accepted.
        assert!(validate(&sample(), "0.8.0-nightly.3", HOST_API_VERSION).is_ok());
    }

    #[test]
    fn keys_outside_identifier_grammar_are_bracketed() {
        let mut pkg = sample();
        pkg["jan"]["contributes"]["menus"] = json!({ "message/oops": [] });
        assert_eq!(paths(&pkg), vec!["jan.contributes.menus['message/oops']"]);
    }

    #[test]
    fn main_file_must_exist_and_be_small() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("dist")).unwrap();
        std::fs::write(dir.path().join("dist/index.js"), "var JanExtension = {}").unwrap();
        assert!(check_main_file(dir.path(), "dist/index.js").is_ok());
        assert!(check_main_file(dir.path(), "dist/missing.js").is_err());
        assert!(check_main_file(dir.path(), "dist").is_err());
        let big = vec![b' '; (MAX_MAIN_BYTES + 1) as usize];
        std::fs::write(dir.path().join("big.js"), big).unwrap();
        assert!(check_main_file(dir.path(), "big.js").is_err());
    }
}
