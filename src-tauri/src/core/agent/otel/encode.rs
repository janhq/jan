//! OTLP wire encoding for the three signals this exporter sends: monotonic
//! sums, delta or cumulative (metrics), event log records (logs) and spans
//! (traces).
//!
//! Hand-rolled rather than generated: the subset is small and stable (OTLP v1
//! is frozen for these messages), and carrying `prost` + the generated proto
//! types for a dozen fields would add build time to every `cli` build for no
//! behaviour we need. Both encodings come from the same model, so the JSON a
//! test can read and the protobuf a collector usually wants cannot disagree.
//!
//! Field numbers follow `opentelemetry/proto/{common,resource,metrics,logs}/v1`
//! and `collector/{metrics,logs}/v1`. OTLP/JSON rules applied here: lowerCamel
//! field names, 64-bit integers as decimal strings, enums as integers.

use serde_json::{json, Value};

/// An attribute value. Only the scalar kinds this exporter emits.
#[derive(Debug, Clone, PartialEq)]
pub enum AnyValue {
    Str(String),
    Int(i64),
    Double(f64),
    Bool(bool),
}

pub type Attrs = Vec<(String, AnyValue)>;

/// One point of a monotonic sum: the total over `start..time`.
#[derive(Debug, Clone, PartialEq)]
pub struct Point {
    pub attrs: Attrs,
    pub start_unix_nano: u64,
    pub time_unix_nano: u64,
    pub value: PointValue,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PointValue {
    Int(i64),
    Double(f64),
}

/// OTLP `AggregationTemporality`. The values are the wire enum's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Temporality {
    /// Each point is what accrued since the previous export.
    Delta = 1,
    /// Each point is the running total since the exporter started.
    Cumulative = 2,
}

/// A counter, exported as an OTLP monotonic `Sum`.
#[derive(Debug, Clone, PartialEq)]
pub struct Metric {
    pub name: String,
    pub description: String,
    pub unit: String,
    pub temporality: Temporality,
    pub points: Vec<Point>,
}

/// One event, exported as an OTLP `LogRecord` carrying `event_name`.
#[derive(Debug, Clone, PartialEq)]
pub struct LogRecord {
    pub time_unix_nano: u64,
    /// OTLP `SeverityNumber`: 9 = INFO, 17 = ERROR.
    pub severity_number: u32,
    pub severity_text: &'static str,
    pub event_name: String,
    pub attrs: Attrs,
}

/// OTLP `Span.SpanKind`: 1 = INTERNAL, 3 = CLIENT.
pub const SPAN_KIND_INTERNAL: u32 = 1;
pub const SPAN_KIND_CLIENT: u32 = 3;

/// One finished span.
#[derive(Debug, Clone, PartialEq)]
pub struct Span {
    pub trace_id: [u8; 16],
    pub span_id: [u8; 8],
    pub parent_span_id: Option<[u8; 8]>,
    pub name: String,
    pub kind: u32,
    pub start_unix_nano: u64,
    pub end_unix_nano: u64,
    pub attrs: Attrs,
    /// `Some(message)` sets status ERROR; `None` leaves it UNSET.
    pub error: Option<String>,
}

/// Who produced the batch: resource attributes plus the instrumentation scope.
#[derive(Debug, Clone, PartialEq)]
pub struct Origin {
    pub resource: Attrs,
    pub scope_name: String,
    pub scope_version: String,
}

// ── OTLP/JSON ────────────────────────────────────────────────────────────────

fn any_json(value: &AnyValue) -> Value {
    match value {
        AnyValue::Str(s) => json!({ "stringValue": s }),
        AnyValue::Int(i) => json!({ "intValue": i.to_string() }),
        AnyValue::Double(d) => json!({ "doubleValue": d }),
        AnyValue::Bool(b) => json!({ "boolValue": b }),
    }
}

fn attrs_json(attrs: &Attrs) -> Value {
    Value::Array(
        attrs
            .iter()
            .map(|(k, v)| json!({ "key": k, "value": any_json(v) }))
            .collect(),
    )
}

fn origin_json(origin: &Origin) -> (Value, Value) {
    (
        json!({ "attributes": attrs_json(&origin.resource) }),
        json!({ "name": origin.scope_name, "version": origin.scope_version }),
    )
}

pub fn metrics_json(origin: &Origin, metrics: &[Metric]) -> Vec<u8> {
    let (resource, scope) = origin_json(origin);
    let metrics: Vec<Value> = metrics
        .iter()
        .map(|m| {
            let points: Vec<Value> = m
                .points
                .iter()
                .map(|p| {
                    let mut point = json!({
                        "attributes": attrs_json(&p.attrs),
                        "startTimeUnixNano": p.start_unix_nano.to_string(),
                        "timeUnixNano": p.time_unix_nano.to_string(),
                    });
                    match p.value {
                        PointValue::Int(i) => point["asInt"] = json!(i.to_string()),
                        PointValue::Double(d) => point["asDouble"] = json!(d),
                    }
                    point
                })
                .collect();
            json!({
                "name": m.name,
                "description": m.description,
                "unit": m.unit,
                "sum": {
                    "dataPoints": points,
                    "aggregationTemporality": m.temporality as u8,
                    "isMonotonic": true,
                },
            })
        })
        .collect();
    serde_json::to_vec(&json!({
        "resourceMetrics": [{
            "resource": resource,
            "scopeMetrics": [{ "scope": scope, "metrics": metrics }],
        }]
    }))
    .unwrap_or_default()
}

pub fn logs_json(origin: &Origin, records: &[LogRecord]) -> Vec<u8> {
    let (resource, scope) = origin_json(origin);
    let records: Vec<Value> = records
        .iter()
        .map(|r| {
            json!({
                "timeUnixNano": r.time_unix_nano.to_string(),
                "observedTimeUnixNano": r.time_unix_nano.to_string(),
                "severityNumber": r.severity_number,
                "severityText": r.severity_text,
                "eventName": r.event_name,
                "body": { "stringValue": r.event_name },
                "attributes": attrs_json(&r.attrs),
            })
        })
        .collect();
    serde_json::to_vec(&json!({
        "resourceLogs": [{
            "resource": resource,
            "scopeLogs": [{ "scope": scope, "logRecords": records }],
        }]
    }))
    .unwrap_or_default()
}

/// OTLP/JSON writes trace and span ids as lowercase hex, not base64.
pub fn spans_json(origin: &Origin, spans: &[Span]) -> Vec<u8> {
    let (resource, scope) = origin_json(origin);
    let spans: Vec<Value> = spans
        .iter()
        .map(|s| {
            let mut span = json!({
                "traceId": hex::encode(s.trace_id),
                "spanId": hex::encode(s.span_id),
                "name": s.name,
                "kind": s.kind,
                "startTimeUnixNano": s.start_unix_nano.to_string(),
                "endTimeUnixNano": s.end_unix_nano.to_string(),
                "attributes": attrs_json(&s.attrs),
                // 2 = STATUS_CODE_ERROR, 0 = UNSET
                "status": match &s.error {
                    Some(m) => json!({ "code": 2, "message": m }),
                    None => json!({}),
                },
            });
            if let Some(parent) = s.parent_span_id {
                span["parentSpanId"] = json!(hex::encode(parent));
            }
            span
        })
        .collect();
    serde_json::to_vec(&json!({
        "resourceSpans": [{
            "resource": resource,
            "scopeSpans": [{ "scope": scope, "spans": spans }],
        }]
    }))
    .unwrap_or_default()
}

// ── OTLP/protobuf ────────────────────────────────────────────────────────────

const VARINT: u64 = 0;
const FIXED64: u64 = 1;
const LEN: u64 = 2;

fn varint(buf: &mut Vec<u8>, mut v: u64) {
    while v >= 0x80 {
        buf.push((v as u8) | 0x80);
        v >>= 7;
    }
    buf.push(v as u8);
}

fn tag(buf: &mut Vec<u8>, field: u64, wire: u64) {
    varint(buf, (field << 3) | wire);
}

fn pb_str(buf: &mut Vec<u8>, field: u64, s: &str) {
    pb_bytes(buf, field, s.as_bytes());
}

fn pb_bytes(buf: &mut Vec<u8>, field: u64, bytes: &[u8]) {
    tag(buf, field, LEN);
    varint(buf, bytes.len() as u64);
    buf.extend_from_slice(bytes);
}

fn pb_fixed64(buf: &mut Vec<u8>, field: u64, v: u64) {
    tag(buf, field, FIXED64);
    buf.extend_from_slice(&v.to_le_bytes());
}

fn pb_varint(buf: &mut Vec<u8>, field: u64, v: u64) {
    tag(buf, field, VARINT);
    varint(buf, v);
}

/// `AnyValue { string_value = 1; bool_value = 2; int_value = 3; double_value = 4 }`.
/// A oneof member is written even at its default: presence is the value.
fn any_pb(value: &AnyValue) -> Vec<u8> {
    let mut b = Vec::new();
    match value {
        AnyValue::Str(s) => pb_str(&mut b, 1, s),
        AnyValue::Bool(v) => pb_varint(&mut b, 2, *v as u64),
        AnyValue::Int(i) => pb_varint(&mut b, 3, *i as u64),
        AnyValue::Double(d) => pb_fixed64(&mut b, 4, d.to_bits()),
    }
    b
}

/// `KeyValue { key = 1; value = 2 }`, each appended as field `field` of `buf`.
fn attrs_pb(buf: &mut Vec<u8>, field: u64, attrs: &Attrs) {
    for (k, v) in attrs {
        let mut kv = Vec::new();
        pb_str(&mut kv, 1, k);
        pb_bytes(&mut kv, 2, &any_pb(v));
        pb_bytes(buf, field, &kv);
    }
}

/// `Resource { attributes = 1 }` and `InstrumentationScope { name = 1; version = 2 }`.
fn origin_pb(origin: &Origin) -> (Vec<u8>, Vec<u8>) {
    let mut resource = Vec::new();
    attrs_pb(&mut resource, 1, &origin.resource);
    let mut scope = Vec::new();
    pb_str(&mut scope, 1, &origin.scope_name);
    pb_str(&mut scope, 2, &origin.scope_version);
    (resource, scope)
}

/// `ExportMetricsServiceRequest { resource_metrics = 1 }` ->
/// `ResourceMetrics { resource = 1; scope_metrics = 2 }` ->
/// `ScopeMetrics { scope = 1; metrics = 2 }` ->
/// `Metric { name = 1; description = 2; unit = 3; sum = 7 }` ->
/// `Sum { data_points = 1; aggregation_temporality = 2; is_monotonic = 3 }` ->
/// `NumberDataPoint { start = 2; time = 3; as_double = 4; as_int = 6; attributes = 7 }`.
pub fn metrics_proto(origin: &Origin, metrics: &[Metric]) -> Vec<u8> {
    let (resource, scope) = origin_pb(origin);
    let mut scope_metrics = Vec::new();
    pb_bytes(&mut scope_metrics, 1, &scope);
    for m in metrics {
        let mut sum = Vec::new();
        for p in &m.points {
            let mut point = Vec::new();
            pb_fixed64(&mut point, 2, p.start_unix_nano);
            pb_fixed64(&mut point, 3, p.time_unix_nano);
            match p.value {
                PointValue::Double(d) => pb_fixed64(&mut point, 4, d.to_bits()),
                // sfixed64: the same 8 little-endian bytes as fixed64.
                PointValue::Int(i) => pb_fixed64(&mut point, 6, i as u64),
            }
            attrs_pb(&mut point, 7, &p.attrs);
            pb_bytes(&mut sum, 1, &point);
        }
        pb_varint(&mut sum, 2, m.temporality as u64);
        pb_varint(&mut sum, 3, 1);
        let mut metric = Vec::new();
        pb_str(&mut metric, 1, &m.name);
        pb_str(&mut metric, 2, &m.description);
        pb_str(&mut metric, 3, &m.unit);
        pb_bytes(&mut metric, 7, &sum);
        pb_bytes(&mut scope_metrics, 2, &metric);
    }
    let mut resource_metrics = Vec::new();
    pb_bytes(&mut resource_metrics, 1, &resource);
    pb_bytes(&mut resource_metrics, 2, &scope_metrics);
    let mut request = Vec::new();
    pb_bytes(&mut request, 1, &resource_metrics);
    request
}

/// `ExportLogsServiceRequest { resource_logs = 1 }` ->
/// `ResourceLogs { resource = 1; scope_logs = 2 }` ->
/// `ScopeLogs { scope = 1; log_records = 2 }` ->
/// `LogRecord { time = 1; severity_number = 2; severity_text = 3; body = 5;
///              attributes = 6; observed_time = 11; event_name = 12 }`.
pub fn logs_proto(origin: &Origin, records: &[LogRecord]) -> Vec<u8> {
    let (resource, scope) = origin_pb(origin);
    let mut scope_logs = Vec::new();
    pb_bytes(&mut scope_logs, 1, &scope);
    for r in records {
        let mut record = Vec::new();
        pb_fixed64(&mut record, 1, r.time_unix_nano);
        pb_varint(&mut record, 2, r.severity_number as u64);
        pb_str(&mut record, 3, r.severity_text);
        pb_bytes(&mut record, 5, &any_pb(&AnyValue::Str(r.event_name.clone())));
        attrs_pb(&mut record, 6, &r.attrs);
        pb_fixed64(&mut record, 11, r.time_unix_nano);
        pb_str(&mut record, 12, &r.event_name);
        pb_bytes(&mut scope_logs, 2, &record);
    }
    let mut resource_logs = Vec::new();
    pb_bytes(&mut resource_logs, 1, &resource);
    pb_bytes(&mut resource_logs, 2, &scope_logs);
    let mut request = Vec::new();
    pb_bytes(&mut request, 1, &resource_logs);
    request
}

/// `ExportTraceServiceRequest { resource_spans = 1 }` ->
/// `ResourceSpans { resource = 1; scope_spans = 2 }` ->
/// `ScopeSpans { scope = 1; spans = 2 }` ->
/// `Span { trace_id = 1; span_id = 2; parent_span_id = 4; name = 5; kind = 6;
///         start = 7; end = 8; attributes = 9; status = 15 }` ->
/// `Status { message = 2; code = 3 }`.
pub fn spans_proto(origin: &Origin, spans: &[Span]) -> Vec<u8> {
    let (resource, scope) = origin_pb(origin);
    let mut scope_spans = Vec::new();
    pb_bytes(&mut scope_spans, 1, &scope);
    for s in spans {
        let mut span = Vec::new();
        pb_bytes(&mut span, 1, &s.trace_id);
        pb_bytes(&mut span, 2, &s.span_id);
        if let Some(parent) = s.parent_span_id {
            pb_bytes(&mut span, 4, &parent);
        }
        pb_str(&mut span, 5, &s.name);
        pb_varint(&mut span, 6, s.kind as u64);
        pb_fixed64(&mut span, 7, s.start_unix_nano);
        pb_fixed64(&mut span, 8, s.end_unix_nano);
        attrs_pb(&mut span, 9, &s.attrs);
        if let Some(message) = &s.error {
            let mut status = Vec::new();
            pb_str(&mut status, 2, message);
            pb_varint(&mut status, 3, 2);
            pb_bytes(&mut span, 15, &status);
        }
        pb_bytes(&mut scope_spans, 2, &span);
    }
    let mut resource_spans = Vec::new();
    pb_bytes(&mut resource_spans, 1, &resource);
    pb_bytes(&mut resource_spans, 2, &scope_spans);
    let mut request = Vec::new();
    pb_bytes(&mut request, 1, &resource_spans);
    request
}

#[cfg(test)]
mod tests {
    use super::*;

    fn origin() -> Origin {
        Origin {
            resource: vec![("service.name".into(), AnyValue::Str("jan-agent".into()))],
            scope_name: "jan-agent".into(),
            scope_version: "1.2.3".into(),
        }
    }

    fn counter(temporality: Temporality) -> Metric {
        Metric {
            name: "jan_agent.token.usage".into(),
            description: "tokens".into(),
            unit: "tokens".into(),
            temporality,
            points: vec![Point {
                attrs: vec![("type".into(), AnyValue::Str("input".into()))],
                start_unix_nano: 1,
                time_unix_nano: 2,
                value: PointValue::Int(42),
            }],
        }
    }

    /// Walk one level of a protobuf message: (field number, wire type, payload).
    fn fields(mut b: &[u8]) -> Vec<(u64, u64, Vec<u8>)> {
        fn read_varint(b: &mut &[u8]) -> u64 {
            let mut v = 0u64;
            let mut shift = 0;
            loop {
                let byte = b[0];
                *b = &b[1..];
                v |= ((byte & 0x7f) as u64) << shift;
                if byte & 0x80 == 0 {
                    return v;
                }
                shift += 7;
            }
        }
        let mut out = Vec::new();
        while !b.is_empty() {
            let key = read_varint(&mut b);
            let (field, wire) = (key >> 3, key & 7);
            let payload = match wire {
                0 => read_varint(&mut b).to_le_bytes().to_vec(),
                1 => {
                    let p = b[..8].to_vec();
                    b = &b[8..];
                    p
                }
                2 => {
                    let n = read_varint(&mut b) as usize;
                    let p = b[..n].to_vec();
                    b = &b[n..];
                    p
                }
                other => panic!("unexpected wire type {other}"),
            };
            out.push((field, wire, payload));
        }
        out
    }

    fn only(b: &[u8], field: u64) -> Vec<u8> {
        let found: Vec<_> = fields(b).into_iter().filter(|f| f.0 == field).collect();
        assert_eq!(found.len(), 1, "field {field} once in {b:?}");
        found.into_iter().next().unwrap().2
    }

    #[test]
    fn a_key_value_encodes_to_the_canonical_bytes() {
        let mut b = Vec::new();
        attrs_pb(&mut b, 1, &vec![("a".into(), AnyValue::Str("b".into()))]);
        // field 1 LEN(8) { key: "a", value: AnyValue { string_value: "b" } }
        assert_eq!(b, vec![0x0a, 8, 0x0a, 1, b'a', 0x12, 3, 0x0a, 1, b'b']);
    }

    #[test]
    fn metrics_protobuf_nests_a_monotonic_sum_under_its_resource() {
        let bytes = metrics_proto(&origin(), &[counter(Temporality::Cumulative)]);
        let resource_metrics = only(&bytes, 1);
        let scope_metrics = only(&resource_metrics, 2);
        let metric = only(&scope_metrics, 2);
        assert_eq!(only(&metric, 1), b"jan_agent.token.usage");
        let sum = only(&metric, 7);
        assert_eq!(only(&sum, 2)[0], 2, "cumulative");
        assert_eq!(only(&sum, 3)[0], 1, "monotonic");
        let delta = metrics_proto(&origin(), &[counter(Temporality::Delta)]);
        let delta_sum = only(&only(&only(&only(&delta, 1), 2), 2), 7);
        assert_eq!(only(&delta_sum, 2)[0], 1, "delta");
        let point = only(&sum, 1);
        assert_eq!(i64::from_le_bytes(only(&point, 6).try_into().unwrap()), 42);
        let resource = only(&resource_metrics, 1);
        let kv = only(&resource, 1);
        assert_eq!(only(&kv, 1), b"service.name");
    }

    #[test]
    fn logs_protobuf_carries_the_event_name() {
        let record = LogRecord {
            time_unix_nano: 7,
            severity_number: 9,
            severity_text: "INFO",
            event_name: "jan_agent.user_prompt".into(),
            attrs: vec![("prompt_length".into(), AnyValue::Int(5))],
        };
        let bytes = logs_proto(&origin(), &[record]);
        let scope_logs = only(&only(&bytes, 1), 2);
        let log = only(&scope_logs, 2);
        assert_eq!(only(&log, 12), b"jan_agent.user_prompt");
        assert_eq!(u64::from_le_bytes(only(&log, 1).try_into().unwrap()), 7);
    }

    #[test]
    fn json_follows_the_otlp_json_mapping() {
        let v: Value = serde_json::from_slice(&metrics_json(
            &origin(),
            &[counter(Temporality::Cumulative)],
        ))
        .unwrap();
        let metric = &v["resourceMetrics"][0]["scopeMetrics"][0]["metrics"][0];
        assert_eq!(metric["name"], "jan_agent.token.usage");
        assert_eq!(metric["sum"]["aggregationTemporality"], 2);
        assert_eq!(metric["sum"]["isMonotonic"], true);
        let point = &metric["sum"]["dataPoints"][0];
        // 64-bit integers travel as strings in OTLP/JSON.
        assert_eq!(point["asInt"], "42");
        assert_eq!(point["timeUnixNano"], "2");
        assert_eq!(point["attributes"][0]["value"]["stringValue"], "input");
        assert_eq!(
            v["resourceMetrics"][0]["resource"]["attributes"][0]["key"],
            "service.name"
        );

        let logs: Value = serde_json::from_slice(&logs_json(
            &origin(),
            &[LogRecord {
                time_unix_nano: 7,
                severity_number: 17,
                severity_text: "ERROR",
                event_name: "jan_agent.api_error".into(),
                attrs: vec![("success".into(), AnyValue::Bool(false))],
            }],
        ))
        .unwrap();
        let record = &logs["resourceLogs"][0]["scopeLogs"][0]["logRecords"][0];
        assert_eq!(record["eventName"], "jan_agent.api_error");
        assert_eq!(record["severityNumber"], 17);
        assert_eq!(record["attributes"][0]["value"]["boolValue"], false);
    }

    fn span(error: Option<&str>, parent: Option<[u8; 8]>) -> Span {
        Span {
            trace_id: [0xab; 16],
            span_id: [0xcd; 8],
            parent_span_id: parent,
            name: "jan_agent.llm_request".into(),
            kind: SPAN_KIND_CLIENT,
            start_unix_nano: 10,
            end_unix_nano: 20,
            attrs: vec![("gen_ai.request.model".into(), AnyValue::Str("m".into()))],
            error: error.map(str::to_string),
        }
    }

    #[test]
    fn spans_protobuf_carries_ids_times_and_status() {
        let bytes = spans_proto(&origin(), &[span(Some("boom"), Some([0xef; 8]))]);
        let scope_spans = only(&only(&bytes, 1), 2);
        let s = only(&scope_spans, 2);
        assert_eq!(only(&s, 1), vec![0xab; 16]);
        assert_eq!(only(&s, 2), vec![0xcd; 8]);
        assert_eq!(only(&s, 4), vec![0xef; 8]);
        assert_eq!(only(&s, 5), b"jan_agent.llm_request");
        assert_eq!(only(&s, 6)[0], SPAN_KIND_CLIENT as u8);
        assert_eq!(u64::from_le_bytes(only(&s, 7).try_into().unwrap()), 10);
        assert_eq!(u64::from_le_bytes(only(&s, 8).try_into().unwrap()), 20);
        let kv = only(&s, 9);
        assert_eq!(only(&kv, 1), b"gen_ai.request.model");
        let status = only(&s, 15);
        assert_eq!(only(&status, 2), b"boom");
        assert_eq!(only(&status, 3)[0], 2, "STATUS_CODE_ERROR");
    }

    #[test]
    fn a_root_span_has_no_parent_and_an_ok_span_no_status() {
        let bytes = spans_proto(&origin(), &[span(None, None)]);
        let s = only(&only(&only(&bytes, 1), 2), 2);
        assert!(fields(&s).iter().all(|f| f.0 != 4 && f.0 != 15));
    }

    #[test]
    fn spans_json_writes_ids_as_hex() {
        let v: Value =
            serde_json::from_slice(&spans_json(&origin(), &[span(Some("x"), Some([1; 8]))])).unwrap();
        let s = &v["resourceSpans"][0]["scopeSpans"][0]["spans"][0];
        assert_eq!(s["traceId"], "ab".repeat(16));
        assert_eq!(s["spanId"], "cd".repeat(8));
        assert_eq!(s["parentSpanId"], "01".repeat(8));
        assert_eq!(s["startTimeUnixNano"], "10");
        assert_eq!(s["status"]["code"], 2);
        assert_eq!(s["kind"], 3);
    }
}
