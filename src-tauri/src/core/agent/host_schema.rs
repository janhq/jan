//! Pure helpers behind host tools: argument validation against the host's
//! declared schema, and the mapping from a host's tool name to the function
//! name a provider will accept.

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

/// Nesting past this depth is accepted unjudged. A host schema is untrusted
/// input, and a recursive walk over an arbitrarily deep one would overflow the
/// stack; no real tool argument is nested this deep.
const MAX_DEPTH: usize = 64;

/// Hex characters of the name hash appended to a mapped wire name.
const HASH_LEN: usize = 8;

/// Check a tool call's arguments against the schema its host declared.
///
/// This runs before the host is asked to execute anything, so the constraints
/// a host wrote into its schema (a robot arm's `minItems: 6` joints, a
/// `maximum: 1` speed) are actually enforced and a malformed call goes back to
/// the model as an error instead of reaching hardware. Providers do not
/// enforce the schema they are sent, and a host cannot be assumed to either.
///
/// The supported subset is `type` (a name or an array of names; `integer`
/// accepts any whole number, `number` accepts integers), `properties`,
/// `required`, `additionalProperties` (`false` or a schema), `items` (a
/// schema), `minItems`, `maxItems`, `enum`, `const`, `minLength`, `maxLength`
/// (in characters), `minimum`, `maximum`, `exclusiveMinimum`,
/// `exclusiveMaximum` (numeric form) and `pattern` (an unanchored `regex`
/// search; an invalid pattern is ignored). Boolean schemas are honored. Every
/// other keyword (`format`, `$ref`, `oneOf`, ...) is ignored: an unsupported
/// keyword must never make a valid call fail, so the validator only ever errs
/// on something it understood.
///
/// The error names the first failure as `<json pointer>: <reason>`, with `/`
/// for the root, e.g. `/joints: expected at least 6 items, got 3`.
pub(crate) fn validate(schema: &Value, value: &Value) -> Result<(), String> {
    let mut path = Vec::new();
    check(schema, value, &mut path, 0).map_err(|reason| format!("{}: {reason}", pointer(&path)))
}

/// Map a host's tool name to the function name advertised to the provider.
///
/// Providers only accept function names matching `[A-Za-z0-9_-]{1,64}`, while
/// hosts such as Robot Studio use dotted names (`yam.move_ee_ik`). A name that
/// is already safe, has no `__` (the qualifier separator) and fits `max_len`
/// with its prefix is returned as `prefix + name` unchanged, so existing hosts
/// see no difference. Anything else is sanitized (characters outside
/// `[A-Za-z0-9-]` become `_`, runs collapse, edges are trimmed, an empty result
/// becomes `tool`) and suffixed with `_` and the first 8 hex characters of the
/// SHA-256 of the original name, truncating the stem to fit. The hash keeps
/// names that sanitize alike (`a.b`, `a b`) distinct, and the mapping is
/// deterministic, so the same host gets the same names on every run.
///
/// Refused: an empty or whitespace-only name, a name with a control character,
/// and a `max_len` too small to hold the prefix, a one-character stem and the
/// hash.
pub(crate) fn wire_name(name: &str, max_len: usize, prefix: &str) -> Result<String, String> {
    if name.trim().is_empty() {
        return Err("host tool name must not be empty".to_string());
    }
    if name.chars().any(char::is_control) {
        return Err(format!("host tool name {name:?} contains a control character"));
    }
    let safe = !name.contains("__")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if safe && prefix.len() + name.len() <= max_len {
        return Ok(format!("{prefix}{name}"));
    }
    let budget = max_len
        .checked_sub(prefix.len() + 1 + HASH_LEN)
        .filter(|b| *b > 0)
        .ok_or_else(|| format!("host tool name {name:?} cannot be mapped into {max_len} characters"))?;

    let mut stem = String::with_capacity(name.len());
    for c in name.chars() {
        let c = if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' };
        if !(c == '_' && stem.ends_with('_')) {
            stem.push(c);
        }
    }
    let mut stem = stem.trim_matches('_').to_string();
    if stem.is_empty() {
        stem.push_str("tool");
    }
    // The stem is ASCII, so a byte cut is a char cut. Re-trim: a cut landing just
    // after a '_' would otherwise meet the hash separator as `__`.
    stem.truncate(budget);
    let stem = stem.trim_end_matches('_');

    let digest = Sha256::digest(name.as_bytes());
    let hash: String = digest.iter().take(HASH_LEN / 2).map(|b| format!("{b:02x}")).collect();
    Ok(format!("{prefix}{stem}_{hash}"))
}

fn pointer(path: &[String]) -> String {
    if path.is_empty() {
        return "/".to_string();
    }
    path.iter().map(|seg| format!("/{}", seg.replace('~', "~0").replace('/', "~1"))).collect()
}

fn check(schema: &Value, value: &Value, path: &mut Vec<String>, depth: usize) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Ok(());
    }
    let schema = match schema {
        Value::Bool(true) => return Ok(()),
        Value::Bool(false) => return Err("no value is allowed here".to_string()),
        Value::Object(map) => map,
        // Not a schema at all; nothing it could constrain.
        _ => return Ok(()),
    };

    check_type(schema, value)?;
    if let Some(Value::Array(options)) = schema.get("enum") {
        if !options.iter().any(|o| json_eq(o, value)) {
            return Err(format!("must be one of {}", Value::Array(options.clone())));
        }
    }
    if let Some(expected) = schema.get("const") {
        if !json_eq(expected, value) {
            return Err(format!("must equal {expected}"));
        }
    }

    match value {
        Value::Number(n) => check_number(schema, n.as_f64().unwrap_or(f64::NAN)),
        Value::String(s) => check_string(schema, s),
        Value::Array(items) => check_array(schema, items, path, depth),
        Value::Object(props) => check_object(schema, props, path, depth),
        _ => Ok(()),
    }
}

fn type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) if is_integer(value) => "integer",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/// JSON Schema counts `3.0` as an integer: the type is about the value, not
/// how it was spelled.
fn is_integer(value: &Value) -> bool {
    match value {
        Value::Number(n) => {
            n.is_i64() || n.is_u64() || n.as_f64().is_some_and(|f| f.is_finite() && f.fract() == 0.0)
        }
        _ => false,
    }
}

fn matches_type(name: &str, value: &Value) -> bool {
    match name {
        "integer" => is_integer(value),
        "number" => value.is_number(),
        other => type_name(value) == other,
    }
}

fn check_type(schema: &Map<String, Value>, value: &Value) -> Result<(), String> {
    let names: Vec<&str> = match schema.get("type") {
        Some(Value::String(name)) => vec![name.as_str()],
        Some(Value::Array(names)) => names.iter().filter_map(Value::as_str).collect(),
        _ => return Ok(()),
    };
    if names.is_empty() || names.iter().any(|n| matches_type(n, value)) {
        return Ok(());
    }
    Err(format!("expected {}, got {}", names.join(" or "), type_name(value)))
}

/// `enum`/`const` equality: numbers compare by value, so `1` equals `1.0` as
/// JSON Schema requires, where `Value`'s own `==` would tell them apart.
fn json_eq(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            if let (Some(x), Some(y)) = (x.as_i64(), y.as_i64()) {
                return x == y;
            }
            if let (Some(x), Some(y)) = (x.as_u64(), y.as_u64()) {
                return x == y;
            }
            x.as_f64() == y.as_f64()
        }
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(x, y)| json_eq(x, y))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| json_eq(v, w)))
        }
        _ => a == b,
    }
}

fn check_number(schema: &Map<String, Value>, n: f64) -> Result<(), String> {
    // Only the numeric form of each bound; the draft-4 boolean `exclusive*`
    // modifiers are not numbers and so are skipped like any unknown keyword.
    let bound = |key: &str| schema.get(key).and_then(|v| v.as_f64().map(|f| (f, v)));
    if let Some((min, raw)) = bound("minimum") {
        if n < min {
            return Err(format!("must be >= {raw}"));
        }
    }
    if let Some((max, raw)) = bound("maximum") {
        if n > max {
            return Err(format!("must be <= {raw}"));
        }
    }
    if let Some((min, raw)) = bound("exclusiveMinimum") {
        if n <= min {
            return Err(format!("must be > {raw}"));
        }
    }
    if let Some((max, raw)) = bound("exclusiveMaximum") {
        if n >= max {
            return Err(format!("must be < {raw}"));
        }
    }
    Ok(())
}

fn check_string(schema: &Map<String, Value>, s: &str) -> Result<(), String> {
    let len = s.chars().count() as u64;
    if let Some(min) = schema.get("minLength").and_then(Value::as_u64) {
        if len < min {
            return Err(format!("expected at least {min} characters, got {len}"));
        }
    }
    if let Some(max) = schema.get("maxLength").and_then(Value::as_u64) {
        if len > max {
            return Err(format!("expected at most {max} characters, got {len}"));
        }
    }
    if let Some(pattern) = schema.get("pattern").and_then(Value::as_str) {
        // A pattern the regex crate cannot compile (a lookaround, say) is the
        // host's dialect, not a bad call; skip it rather than refuse every call.
        if let Ok(re) = regex::Regex::new(pattern) {
            if !re.is_match(s) {
                return Err(format!("does not match pattern '{pattern}'"));
            }
        }
    }
    Ok(())
}

fn check_array(
    schema: &Map<String, Value>,
    items: &[Value],
    path: &mut Vec<String>,
    depth: usize,
) -> Result<(), String> {
    let len = items.len() as u64;
    if let Some(min) = schema.get("minItems").and_then(Value::as_u64) {
        if len < min {
            return Err(format!("expected at least {min} items, got {len}"));
        }
    }
    if let Some(max) = schema.get("maxItems").and_then(Value::as_u64) {
        if len > max {
            return Err(format!("expected at most {max} items, got {len}"));
        }
    }
    // Only the single-schema form; the tuple form (an array) is outside the subset.
    if let Some(item_schema @ (Value::Object(_) | Value::Bool(_))) = schema.get("items") {
        for (i, item) in items.iter().enumerate() {
            path.push(i.to_string());
            check(item_schema, item, path, depth + 1)?;
            path.pop();
        }
    }
    Ok(())
}

fn check_object(
    schema: &Map<String, Value>,
    props: &Map<String, Value>,
    path: &mut Vec<String>,
    depth: usize,
) -> Result<(), String> {
    if let Some(Value::Array(required)) = schema.get("required") {
        if let Some(missing) = required.iter().filter_map(Value::as_str).find(|k| !props.contains_key(*k)) {
            return Err(format!("missing required property '{missing}'"));
        }
    }
    let declared = schema.get("properties").and_then(Value::as_object);
    if let Some(declared) = declared {
        for (key, sub) in declared {
            if let Some(v) = props.get(key) {
                path.push(key.clone());
                check(sub, v, path, depth + 1)?;
                path.pop();
            }
        }
    }
    // `additionalProperties` is judged relative to `patternProperties` too, which
    // is outside the subset; without it we cannot tell what counts as extra.
    if schema.contains_key("patternProperties") {
        return Ok(());
    }
    let extra_schema = match schema.get("additionalProperties") {
        Some(s @ (Value::Object(_) | Value::Bool(false))) => s,
        _ => return Ok(()),
    };
    for (key, v) in props {
        if declared.is_some_and(|d| d.contains_key(key)) {
            continue;
        }
        path.push(key.clone());
        if extra_schema == &Value::Bool(false) {
            return Err("property is not allowed".to_string());
        }
        check(extra_schema, v, path, depth + 1)?;
        path.pop();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn err(schema: Value, value: Value) -> String {
        validate(&schema, &value).expect_err("expected a validation failure")
    }

    fn ok(schema: Value, value: Value) {
        if let Err(e) = validate(&schema, &value) {
            panic!("expected {value} to satisfy {schema}, got: {e}");
        }
    }

    #[test]
    fn type_string_and_mismatch() {
        ok(json!({"type": "string"}), json!("x"));
        assert_eq!(err(json!({"type": "string"}), json!(1)), "/: expected string, got integer");
        assert_eq!(err(json!({"type": "object"}), json!([])), "/: expected object, got array");
        assert_eq!(err(json!({"type": "boolean"}), json!(null)), "/: expected boolean, got null");
    }

    #[test]
    fn integer_is_a_number_but_not_vice_versa() {
        ok(json!({"type": "number"}), json!(3));
        ok(json!({"type": "number"}), json!(3.5));
        ok(json!({"type": "integer"}), json!(3));
        ok(json!({"type": "integer"}), json!(-3));
        // JSON Schema counts a number with a zero fractional part as an integer.
        ok(json!({"type": "integer"}), json!(3.0));
        assert_eq!(err(json!({"type": "integer"}), json!(3.5)), "/: expected integer, got number");
    }

    #[test]
    fn type_may_be_an_array_of_types() {
        let s = json!({"type": ["string", "null"]});
        ok(s.clone(), json!("x"));
        ok(s.clone(), json!(null));
        assert_eq!(err(s, json!(1)), "/: expected string or null, got integer");
    }

    #[test]
    fn required_names_the_missing_property() {
        let s = json!({"type": "object", "required": ["target"]});
        assert_eq!(err(s.clone(), json!({})), "/: missing required property 'target'");
        ok(s, json!({"target": 1}));
    }

    #[test]
    fn properties_recurse_with_a_pointer() {
        let s = json!({"type": "object", "properties": {"speed": {"type": "number", "maximum": 1}}});
        assert_eq!(err(s.clone(), json!({"speed": 2})), "/speed: must be <= 1");
        assert_eq!(err(s.clone(), json!({"speed": "x"})), "/speed: expected number, got string");
        ok(s, json!({"speed": 0.5}));
    }

    #[test]
    fn nested_pointers_include_array_indices() {
        let s = json!({"properties": {"a": {"items": {"properties": {"b": {"type": "string"}}}}}});
        assert_eq!(err(s, json!({"a": [{"b": "x"}, {"b": 2}]})), "/a/1/b: expected string, got integer");
    }

    #[test]
    fn pointer_segments_are_escaped() {
        let s = json!({"properties": {"a/b~c": {"type": "string"}}});
        assert_eq!(err(s, json!({"a/b~c": 1})), "/a~1b~0c: expected string, got integer");
    }

    #[test]
    fn additional_properties_false_refuses_extras() {
        let s = json!({"properties": {"a": {}}, "additionalProperties": false});
        assert_eq!(err(s.clone(), json!({"a": 1, "extra": 2})), "/extra: property is not allowed");
        ok(s, json!({"a": 1}));
    }

    #[test]
    fn additional_properties_schema_applies_to_extras_only() {
        let s = json!({"properties": {"a": {"type": "string"}}, "additionalProperties": {"type": "integer"}});
        ok(s.clone(), json!({"a": "x", "b": 1}));
        assert_eq!(err(s, json!({"a": "x", "b": "y"})), "/b: expected integer, got string");
    }

    #[test]
    fn additional_properties_true_or_absent_allows_extras() {
        ok(json!({"properties": {"a": {}}}), json!({"b": 1}));
        ok(json!({"properties": {"a": {}}, "additionalProperties": true}), json!({"b": 1}));
    }

    #[test]
    fn additional_properties_is_skipped_when_pattern_properties_exist() {
        // patternProperties is outside the subset; judging extras without it would
        // refuse keys the host meant to allow.
        ok(
            json!({"patternProperties": {"^x": {}}, "additionalProperties": false}),
            json!({"x1": 1}),
        );
    }

    #[test]
    fn items_min_items_and_max_items() {
        let s = json!({"properties": {"joints": {"type": "array", "items": {"type": "number"}, "minItems": 6, "maxItems": 7}}});
        assert_eq!(err(s.clone(), json!({"joints": [1, 2, 3]})), "/joints: expected at least 6 items, got 3");
        assert_eq!(
            err(s.clone(), json!({"joints": [1, 2, 3, 4, 5, 6, 7, 8]})),
            "/joints: expected at most 7 items, got 8"
        );
        assert_eq!(
            err(s.clone(), json!({"joints": [1, 2, 3, 4, 5, "x"]})),
            "/joints/5: expected number, got string"
        );
        ok(s, json!({"joints": [1, 2, 3, 4, 5, 6]}));
    }

    #[test]
    fn enum_and_const() {
        let s = json!({"enum": ["a", "b"]});
        ok(s.clone(), json!("a"));
        assert_eq!(err(s, json!("c")), "/: must be one of [\"a\",\"b\"]");
        ok(json!({"const": 5}), json!(5));
        assert_eq!(err(json!({"const": 5}), json!(6)), "/: must equal 5");
    }

    #[test]
    fn enum_and_const_compare_numbers_by_value() {
        ok(json!({"enum": [1, 2]}), json!(1.0));
        ok(json!({"const": 1.0}), json!(1));
        ok(json!({"const": {"a": [1]}}), json!({"a": [1.0]}));
    }

    #[test]
    fn string_lengths_count_chars_not_bytes() {
        let s = json!({"minLength": 2, "maxLength": 3});
        ok(s.clone(), json!("\u{e9}\u{e9}\u{e9}"));
        assert_eq!(err(s.clone(), json!("\u{e9}")), "/: expected at least 2 characters, got 1");
        assert_eq!(err(s, json!("abcd")), "/: expected at most 3 characters, got 4");
    }

    #[test]
    fn numeric_bounds() {
        assert_eq!(err(json!({"minimum": 0}), json!(-1)), "/: must be >= 0");
        ok(json!({"minimum": 0}), json!(0));
        ok(json!({"maximum": 1}), json!(1));
        assert_eq!(err(json!({"exclusiveMinimum": 0}), json!(0)), "/: must be > 0");
        ok(json!({"exclusiveMinimum": 0}), json!(0.1));
        assert_eq!(err(json!({"exclusiveMaximum": 1.5}), json!(1.5)), "/: must be < 1.5");
        ok(json!({"exclusiveMaximum": 1.5}), json!(1));
    }

    #[test]
    fn draft4_boolean_exclusive_bounds_are_ignored() {
        // Only the numeric form is in the subset; the draft-4 boolean form must
        // not break a schema that also carries a plain bound.
        ok(json!({"maximum": 1, "exclusiveMaximum": true}), json!(1));
    }

    #[test]
    fn pattern_is_an_unanchored_search() {
        let s = json!({"pattern": "b+"});
        ok(s.clone(), json!("abbc"));
        assert_eq!(err(s, json!("ac")), "/: does not match pattern 'b+'");
        ok(json!({"pattern": "^a$"}), json!("a"));
        assert!(validate(&json!({"pattern": "^a$"}), &json!("ab")).is_err());
    }

    #[test]
    fn an_invalid_pattern_is_ignored() {
        ok(json!({"pattern": "(unclosed"}), json!("anything"));
    }

    #[test]
    fn keywords_only_apply_to_their_own_type() {
        // minLength says nothing about a number, minimum nothing about a string.
        ok(json!({"minLength": 5, "minimum": 10, "minItems": 3, "required": ["a"]}), json!(1.0e9));
        ok(json!({"minimum": 10}), json!("short"));
        ok(json!({"required": ["a"]}), json!([]));
    }

    #[test]
    fn unknown_keywords_are_ignored() {
        ok(
            json!({
                "$schema": "http://json-schema.org/draft-07/schema#",
                "$ref": "#/definitions/nowhere",
                "title": "t",
                "description": "d",
                "format": "email",
                "x-vendor": {"anything": true},
                "type": "string"
            }),
            json!("not an email"),
        );
    }

    #[test]
    fn boolean_schemas() {
        ok(json!(true), json!({"a": 1}));
        assert_eq!(err(json!(false), json!(1)), "/: no value is allowed here");
        let s = json!({"properties": {"x": false}});
        assert_eq!(err(s.clone(), json!({"x": 1})), "/x: no value is allowed here");
        ok(s, json!({}));
    }

    #[test]
    fn a_non_object_schema_constrains_nothing() {
        ok(json!(null), json!(1));
        ok(json!("string"), json!(1));
    }

    #[test]
    fn the_first_failure_is_reported() {
        let s = json!({"type": "object", "required": ["a", "b"]});
        assert_eq!(err(s, json!({})), "/: missing required property 'a'");
    }

    #[test]
    fn deep_nesting_does_not_overflow() {
        // A schema and value nested far past the cap: validation stops judging at
        // the cap rather than recursing until the stack runs out. An uncapped
        // walk would reach the leaf and fail, so Ok proves the cap. (Not deeper:
        // serde_json's own Drop of a Value recurses and would overflow first.)
        let mut schema = json!({"type": "string"});
        let mut value = json!(1);
        for _ in 0..500 {
            schema = json!({"items": schema});
            value = json!([value]);
        }
        assert!(validate(&schema, &value).is_ok());
    }

    #[test]
    fn nesting_within_the_cap_is_still_checked() {
        let mut schema = json!({"type": "string"});
        let mut value = json!(1);
        for _ in 0..10 {
            schema = json!({"items": schema});
            value = json!([value]);
        }
        assert!(validate(&schema, &value).is_err());
    }

    const P: &str = "host__";

    fn is_wire_safe(s: &str) -> bool {
        !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    }

    #[test]
    fn a_safe_name_is_prefixed_unchanged() {
        assert_eq!(wire_name("observe", 64, P).unwrap(), "host__observe");
        assert_eq!(wire_name("move-ee_ik2", 64, P).unwrap(), "host__move-ee_ik2");
        let exact = "a".repeat(64 - P.len());
        assert_eq!(wire_name(&exact, 64, P).unwrap(), format!("{P}{exact}"));
    }

    #[test]
    fn a_dotted_name_is_sanitized_and_hashed() {
        let got = wire_name("yam.move_ee_ik", 64, P).unwrap();
        let (stem, hash) = got.rsplit_once('_').unwrap();
        assert_eq!(stem, "host__yam_move_ee_ik");
        assert_eq!(hash.len(), 8);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        assert!(is_wire_safe(&got));
    }

    #[test]
    fn the_hash_is_sha256_of_the_original_name() {
        // sha256("yam.move_ee_ik"), first 4 bytes.
        use sha2::{Digest, Sha256};
        let digest = Sha256::digest("yam.move_ee_ik".as_bytes());
        let hex: String = digest[..4].iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(wire_name("yam.move_ee_ik", 64, P).unwrap(), format!("host__yam_move_ee_ik_{hex}"));
    }

    #[test]
    fn unsafe_names_map_to_wire_safe_names() {
        for name in ["has space", "unicode\u{e9}", "a__b", "__lead", "trail__", "a...b", "-dash-"] {
            let got = wire_name(name, 64, P).unwrap();
            assert!(is_wire_safe(&got), "{name:?} -> {got:?}");
            assert!(got.starts_with(P), "{got}");
            assert!(!got[P.len()..].contains("__"), "{name:?} -> {got:?}");
            assert!(!got[P.len()..].starts_with('_'), "{name:?} -> {got:?}");
        }
        assert!(wire_name("has space", 64, P).unwrap().starts_with("host__has_space_"));
        assert!(wire_name("unicode\u{e9}", 64, P).unwrap().starts_with("host__unicode_"));
        assert!(wire_name("a__b", 64, P).unwrap().starts_with("host__a_b_"));
    }

    #[test]
    fn mapping_is_deterministic() {
        assert_eq!(wire_name("a.b", 64, P).unwrap(), wire_name("a.b", 64, P).unwrap());
    }

    #[test]
    fn names_that_sanitize_alike_stay_distinct() {
        let a = wire_name("a.b", 64, P).unwrap();
        let b = wire_name("a b", 64, P).unwrap();
        let c = wire_name("a__b", 64, P).unwrap();
        assert_ne!(a, b);
        assert_ne!(a, c);
        assert_ne!(b, c);
        assert!(a.starts_with("host__a_b_") && b.starts_with("host__a_b_"));
    }

    #[test]
    fn an_over_long_name_is_truncated_and_hashed() {
        let long = "x".repeat(100);
        let got = wire_name(&long, 64, P).unwrap();
        assert_eq!(got.len(), 64);
        assert!(is_wire_safe(&got));
        let other = wire_name(&format!("{long}y"), 64, P).unwrap();
        assert_ne!(got, other);
        // One past the safe limit is hashed too.
        let just_over = "a".repeat(64 - P.len() + 1);
        assert!(wire_name(&just_over, 64, P).unwrap().len() <= 64);
    }

    #[test]
    fn truncation_never_leaves_a_double_underscore() {
        // The cut lands right after a '_' in the stem; the join must not become '__'.
        let budget = 64 - P.len() - 9;
        let name = format!("{}.b{}", "a".repeat(budget - 1), "c".repeat(20));
        let got = wire_name(&name, 64, P).unwrap();
        assert!(!got[P.len()..].contains("__"), "{got}");
        assert!(got.len() <= 64);
    }

    #[test]
    fn a_name_with_nothing_safe_uses_a_placeholder_stem() {
        let got = wire_name("...", 64, P).unwrap();
        assert!(got.starts_with("host__tool_"), "{got}");
        assert_eq!(got.len(), "host__tool_".len() + 8);
        assert_ne!(got, wire_name("___", 64, P).unwrap());
    }

    #[test]
    fn empty_and_control_names_are_refused() {
        assert!(wire_name("", 64, P).is_err());
        assert!(wire_name("   ", 64, P).is_err());
        assert!(wire_name("a\nb", 64, P).is_err());
        assert!(wire_name("a\u{7f}b", 64, P).is_err());
        assert!(wire_name("a\u{0}", 64, P).is_err());
    }

    #[test]
    fn a_budget_too_small_for_the_hash_is_refused() {
        assert!(wire_name("a.b", P.len() + 9, P).is_err());
        assert!(wire_name("a.b", P.len() + 10, P).is_ok());
    }
}
