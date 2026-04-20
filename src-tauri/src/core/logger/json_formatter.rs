use log::Record;
use std::fmt::Arguments;
use tauri_plugin_log::fern::FormatCallback;

/// Custom JSON Lines formatter for tauri-plugin-log.
///
/// Output format: `{"ts":"ISO8601","level":"LEVEL","target":"TARGET","msg":"MSG","meta":...}`
/// If the message contains `" |META|"`, the left part becomes `msg` and the right part
/// is parsed as JSON for the `meta` field. Otherwise `meta` is `null`.
pub fn json_formatter(out: FormatCallback<'_>, message: &Arguments, record: &Record) {
    let raw_msg = message.to_string();

    let (msg, meta) = if let Some(idx) = raw_msg.find(" |META|") {
        let left = &raw_msg[..idx];
        let right = &raw_msg[idx + 7..];
        let meta_val = serde_json::from_str(right).unwrap_or(serde_json::Value::Null);
        (left, meta_val)
    } else {
        (raw_msg.as_str(), serde_json::Value::Null)
    };

    let escaped = escape_json_str(msg);

    let ts = chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let json = format!(
        r#"{{"ts":"{}","level":"{}","target":"{}","msg":"{}","meta":{}}}"#,
        ts,
        record.level(),
        record.target(),
        escaped,
        meta
    );

    out.finish(format_args!("{}\n", json));
}

fn escape_json_str(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '\\' => result.push_str("\\\\"),
            '"' => result.push_str("\\\""),
            '\n' => result.push_str("\\n"),
            '\r' => result.push_str("\\r"),
            '\t' => result.push_str("\\t"),
            c => result.push(c),
        }
    }
    result
}
