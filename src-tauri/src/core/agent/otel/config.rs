//! Whether telemetry is on, and where it goes.
//!
//! Off unless something turns it on. Precedence for the switch, highest first:
//! `JAN_AGENT_ENABLE_TELEMETRY` (any explicit value, so `=0` can switch off a
//! config that enables it), the project's `agent.toml` `[telemetry].enabled`,
//! then `~/.jan/config.toml` `[telemetry].enabled`. `OTEL_SDK_DISABLED=true`
//! beats all of them, as the OpenTelemetry spec asks.
//!
//! Everything about the destination is read from the standard `OTEL_*`
//! variables, so a collector setup already written for another agent works
//! unchanged. Nothing here is ever logged: headers carry credentials.

use std::time::Duration;

/// Wire encoding for an OTLP/HTTP export.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Protocol {
    HttpProtobuf,
    HttpJson,
}

impl Protocol {
    /// Pick the encoder for this protocol.
    pub fn encode(self, json: impl FnOnce() -> Vec<u8>, proto: impl FnOnce() -> Vec<u8>) -> Vec<u8> {
        match self {
            Protocol::HttpJson => json(),
            Protocol::HttpProtobuf => proto(),
        }
    }

    pub fn content_type(self) -> &'static str {
        match self {
            Protocol::HttpProtobuf => "application/x-protobuf",
            Protocol::HttpJson => "application/json",
        }
    }
}

/// One signal's destination. `None` in [`Config`] means the signal is off.
#[derive(Debug, Clone, PartialEq)]
pub struct Target {
    pub url: String,
    pub protocol: Protocol,
    /// Sent with every export. Never logged.
    pub headers: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    pub metrics: Option<Target>,
    pub logs: Option<Target>,
    /// `service.name` and `OTEL_RESOURCE_ATTRIBUTES`, in order, service first.
    pub resource: Vec<(String, String)>,
    pub metric_interval: Duration,
    pub logs_interval: Duration,
    pub export_timeout: Duration,
    /// `OTEL_LOG_USER_PROMPTS`: include prompt text on `user_prompt`.
    pub log_user_prompts: bool,
    /// `OTEL_LOG_TOOL_DETAILS`: include tool arguments on `tool_result`.
    pub log_tool_details: bool,
    /// `OTEL_METRICS_INCLUDE_SESSION_ID` (default on): tag metric points with
    /// `session.id`. Off keeps a backend's series count bounded.
    pub metrics_session_id: bool,
    /// Human-readable problems with the configuration, for the caller to log.
    pub warnings: Vec<String>,
}

pub const DEFAULT_ENDPOINT: &str = "http://localhost:4318";
pub const DEFAULT_SERVICE_NAME: &str = "jan-agent";
pub const ENABLE_ENV: &str = "JAN_AGENT_ENABLE_TELEMETRY";

/// `1/true/yes/on` and `0/false/no/off`, case-insensitively; anything else is
/// no answer at all.
pub fn parse_flag(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

/// Whether telemetry is switched on, given the three places that can say so.
pub fn enabled(
    env: &dyn Fn(&str) -> Option<String>,
    project: Option<bool>,
    global: Option<bool>,
) -> bool {
    if env("OTEL_SDK_DISABLED").as_deref().and_then(parse_flag) == Some(true) {
        return false;
    }
    env(ENABLE_ENV)
        .as_deref()
        .and_then(parse_flag)
        .or(project)
        .or(global)
        .unwrap_or(false)
}

/// Resolve the whole configuration, or `None` when telemetry is off or every
/// signal was switched off.
pub fn resolve(
    env: &dyn Fn(&str) -> Option<String>,
    project: Option<bool>,
    global: Option<bool>,
) -> Option<Config> {
    if !enabled(env, project, global) {
        return None;
    }
    let get = |key: &str| env(key).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    let mut warnings = Vec::new();
    let base = get("OTEL_EXPORTER_OTLP_ENDPOINT").unwrap_or_else(|| DEFAULT_ENDPOINT.to_string());
    let base_protocol = get("OTEL_EXPORTER_OTLP_PROTOCOL");
    let base_headers = get("OTEL_EXPORTER_OTLP_HEADERS");

    let mut target = |signal: &str, path: &str| -> Option<Target> {
        let upper = signal.to_ascii_uppercase();
        match get(&format!("OTEL_{upper}_EXPORTER")).as_deref() {
            None | Some("otlp") => {}
            Some("none") => return None,
            // stdout is the protocol channel for RPC and stream-json, so a
            // console exporter would corrupt it. Refused everywhere (the
            // signal is not exported), so the same environment behaves the
            // same on every surface and nothing is sent that was not asked for.
            Some("console") => {
                warnings.push(format!(
                    "OTEL_{upper}_EXPORTER=console is not supported (stdout carries the \
                     agent protocol); {signal} are not exported"
                ));
                return None;
            }
            Some(other) => {
                warnings.push(format!(
                    "OTEL_{upper}_EXPORTER={other} is not supported (only otlp and none); \
                     {signal} are not exported"
                ));
                return None;
            }
        }
        let url = get(&format!("OTEL_EXPORTER_OTLP_{upper}_ENDPOINT"))
            .unwrap_or_else(|| format!("{}/{path}", base.trim_end_matches('/')));
        let protocol_name = get(&format!("OTEL_EXPORTER_OTLP_{upper}_PROTOCOL"))
            .or_else(|| base_protocol.clone());
        let protocol = match protocol_name.as_deref() {
            None | Some("http/protobuf") => Protocol::HttpProtobuf,
            Some("http/json") => Protocol::HttpJson,
            Some(other) => {
                warnings.push(format!(
                    "OTLP protocol '{other}' is not supported (only http/protobuf and \
                     http/json); using http/protobuf"
                ));
                Protocol::HttpProtobuf
            }
        };
        let mut headers = base_headers.as_deref().map(parse_pairs).unwrap_or_default();
        if let Some(own) = get(&format!("OTEL_EXPORTER_OTLP_{upper}_HEADERS")) {
            for (k, v) in parse_pairs(&own) {
                headers.retain(|(existing, _)| !existing.eq_ignore_ascii_case(&k));
                headers.push((k, v));
            }
        }
        Some(Target { url, protocol, headers })
    };
    let metrics = target("metrics", "v1/metrics");
    let logs = target("logs", "v1/logs");
    if metrics.is_none() && logs.is_none() {
        return None;
    }

    let mut resource = vec![(
        "service.name".to_string(),
        get("OTEL_SERVICE_NAME").unwrap_or_else(|| DEFAULT_SERVICE_NAME.to_string()),
    )];
    for (k, v) in get("OTEL_RESOURCE_ATTRIBUTES").as_deref().map(parse_pairs).unwrap_or_default() {
        // OTEL_SERVICE_NAME wins over a service.name in the attribute list.
        if k == "service.name" && get("OTEL_SERVICE_NAME").is_some() {
            continue;
        }
        resource.retain(|(existing, _)| existing != &k);
        resource.push((k, v));
    }

    let millis = |key: &str, default: u64| {
        Duration::from_millis(
            get(key)
                .and_then(|v| v.parse::<u64>().ok())
                .filter(|v| *v > 0)
                .unwrap_or(default),
        )
    };
    let gate = |key: &str| get(key).as_deref().and_then(parse_flag).unwrap_or(false);
    Some(Config {
        metrics,
        logs,
        resource,
        metric_interval: millis("OTEL_METRIC_EXPORT_INTERVAL", 60_000),
        logs_interval: millis("OTEL_LOGS_EXPORT_INTERVAL", 5_000),
        export_timeout: millis("OTEL_EXPORTER_OTLP_TIMEOUT", 10_000),
        log_user_prompts: gate("OTEL_LOG_USER_PROMPTS"),
        log_tool_details: gate("OTEL_LOG_TOOL_DETAILS"),
        metrics_session_id: get("OTEL_METRICS_INCLUDE_SESSION_ID")
            .as_deref()
            .and_then(parse_flag)
            .unwrap_or(true),
        warnings,
    })
}

/// `k=v,k2=v2` as the OTel spec writes headers and resource attributes, with
/// values percent-decoded. Malformed members are skipped, not fatal.
pub fn parse_pairs(raw: &str) -> Vec<(String, String)> {
    raw.split(',')
        .filter_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            let k = percent_decode(k.trim());
            (!k.is_empty()).then(|| (k, percent_decode(v.trim())))
        })
        .collect()
}

fn percent_decode(s: &str) -> String {
    let hex = |b: u8| (b as char).to_digit(16).map(|d| d as u8);
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push(hi << 4 | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> =
            pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        move |key| map.get(key).cloned()
    }

    #[test]
    fn off_by_default() {
        assert!(resolve(&env(&[]), None, None).is_none());
        // OTEL_* alone does not opt in: it may be set for some other program.
        assert!(resolve(&env(&[("OTEL_EXPORTER_OTLP_ENDPOINT", "http://x:4318")]), None, None)
            .is_none());
    }

    #[test]
    fn env_beats_project_beats_global() {
        assert!(enabled(&env(&[]), None, Some(true)));
        assert!(!enabled(&env(&[]), Some(false), Some(true)), "agent.toml wins");
        assert!(enabled(&env(&[]), Some(true), Some(false)));
        assert!(enabled(&env(&[(ENABLE_ENV, "1")]), Some(false), None), "env wins");
        assert!(!enabled(&env(&[(ENABLE_ENV, "0")]), Some(true), Some(true)));
        // An unparseable value is no answer, so the files decide.
        assert!(enabled(&env(&[(ENABLE_ENV, "maybe")]), None, Some(true)));
        assert!(
            !enabled(&env(&[(ENABLE_ENV, "1"), ("OTEL_SDK_DISABLED", "true")]), None, None),
            "the SDK kill switch wins"
        );
    }

    #[test]
    fn defaults_follow_the_otel_spec() {
        let c = resolve(&env(&[(ENABLE_ENV, "true")]), None, None).unwrap();
        let m = c.metrics.unwrap();
        assert_eq!(m.url, "http://localhost:4318/v1/metrics");
        assert_eq!(m.protocol, Protocol::HttpProtobuf);
        assert_eq!(c.logs.unwrap().url, "http://localhost:4318/v1/logs");
        assert_eq!(c.resource, vec![("service.name".into(), "jan-agent".into())]);
        assert_eq!(c.metric_interval, Duration::from_secs(60));
        assert!(!c.log_user_prompts && !c.log_tool_details);
        assert!(c.metrics_session_id);
        assert!(c.warnings.is_empty());
    }

    #[test]
    fn standard_env_vars_are_honoured() {
        let c = resolve(
            &env(&[
                (ENABLE_ENV, "1"),
                ("OTEL_EXPORTER_OTLP_ENDPOINT", "https://collector:4318/"),
                ("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT", "https://logs.example/ingest"),
                ("OTEL_EXPORTER_OTLP_PROTOCOL", "http/json"),
                ("OTEL_EXPORTER_OTLP_HEADERS", "Authorization=Bearer%20abc,x-team=a"),
                ("OTEL_EXPORTER_OTLP_METRICS_HEADERS", "x-team=b"),
                ("OTEL_SERVICE_NAME", "robot-studio"),
                ("OTEL_RESOURCE_ATTRIBUTES", "service.name=ignored,tenant.id=t1"),
                ("OTEL_METRIC_EXPORT_INTERVAL", "1000"),
                ("OTEL_LOG_USER_PROMPTS", "1"),
                ("OTEL_METRICS_INCLUDE_SESSION_ID", "false"),
            ]),
            None,
            None,
        )
        .unwrap();
        let m = c.metrics.unwrap();
        assert_eq!(m.url, "https://collector:4318/v1/metrics");
        assert_eq!(m.protocol, Protocol::HttpJson);
        assert_eq!(
            m.headers,
            vec![
                ("Authorization".into(), "Bearer abc".into()),
                ("x-team".into(), "b".into())
            ]
        );
        let l = c.logs.unwrap();
        assert_eq!(l.url, "https://logs.example/ingest", "signal URL is used as-is");
        assert_eq!(l.headers[1], ("x-team".into(), "a".into()));
        assert_eq!(
            c.resource,
            vec![
                ("service.name".into(), "robot-studio".into()),
                ("tenant.id".into(), "t1".into())
            ]
        );
        assert_eq!(c.metric_interval, Duration::from_secs(1));
        assert!(c.log_user_prompts && !c.log_tool_details);
        assert!(!c.metrics_session_id);
    }

    #[test]
    fn grpc_falls_back_and_console_disables_the_signal() {
        let c = resolve(
            &env(&[
                (ENABLE_ENV, "1"),
                ("OTEL_EXPORTER_OTLP_PROTOCOL", "grpc"),
                ("OTEL_LOGS_EXPORTER", "console"),
            ]),
            None,
            None,
        )
        .unwrap();
        assert_eq!(c.metrics.unwrap().protocol, Protocol::HttpProtobuf);
        assert!(c.logs.is_none(), "console must not fall back to OTLP");
        assert_eq!(c.warnings.len(), 2, "{:?}", c.warnings);
    }

    #[test]
    fn an_unknown_exporter_disables_the_signal() {
        let c = resolve(
            &env(&[(ENABLE_ENV, "1"), ("OTEL_METRICS_EXPORTER", "prometheus")]),
            None,
            None,
        )
        .unwrap();
        assert!(c.metrics.is_none());
        assert!(c.logs.is_some());
        assert_eq!(c.warnings.len(), 1, "{:?}", c.warnings);
    }

    #[test]
    fn a_signal_can_be_switched_off() {
        let c = resolve(&env(&[(ENABLE_ENV, "1"), ("OTEL_LOGS_EXPORTER", "none")]), None, None)
            .unwrap();
        assert!(c.metrics.is_some() && c.logs.is_none());
        assert!(resolve(
            &env(&[
                (ENABLE_ENV, "1"),
                ("OTEL_LOGS_EXPORTER", "none"),
                ("OTEL_METRICS_EXPORTER", "none")
            ]),
            None,
            None
        )
        .is_none());
    }

    #[test]
    fn pairs_skip_malformed_members_and_decode_values() {
        assert_eq!(
            parse_pairs("a=1, bad ,=x,b=%3D%2C,c=50%"),
            vec![
                ("a".into(), "1".into()),
                ("b".into(), "=,".into()),
                ("c".into(), "50%".into())
            ]
        );
    }
}
