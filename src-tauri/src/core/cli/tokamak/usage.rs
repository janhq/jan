//! Authoritative usage and spend, read from Tokamak's usage API.
//!
//! This is the counterpart to [`super::super::model_catalog`]'s estimate, not a
//! replacement for it. The estimate is what the client can compute from token
//! counts and a cached price list: it works offline, mid-turn, and for any
//! provider, and it is the only thing available while a request is still in
//! flight. What it can never be is a *charge* -- the price list may be stale or
//! incomplete, the token counts may be reconstructed client-side, and billing
//! can still be pending after a response completes.
//!
//! So the two are kept apart by construction. Everything in this module is a
//! figure the server reported; nothing here is ever summed with, compared
//! against, or substituted for a local estimate. [`Money`] exists to make that
//! separation enforceable at the type level: an estimate is an `f64`, a charge
//! is a `Money`, and there is deliberately no arithmetic between them.
//!
//! ## Why money is a string
//!
//! Tokamak's generation money fields are exact JSON numbers and its analytics
//! money fields are decimal strings, both of which must survive a round trip
//! intact if anyone is going to reconcile a charge against an invoice.
//! `serde_json` without `arbitrary_precision` parses every JSON number through
//! `f64`, so `0.000000123456789012345` comes back subtly different from what
//! the server sent, and the difference lands in exactly the low-order digits a
//! reconciliation cares about. [`Money`] therefore keeps the literal text the
//! server sent, captured through `RawValue` before any numeric conversion can
//! happen, and never converts it back.
//!
//! The same reasoning applies to every payload whose schema this module does
//! not pin down: [`Payload`] walks the raw JSON text rather than a parsed
//! `Value`, so an undocumented money field is rendered exactly as received
//! instead of being quietly rounded on the way through.

use std::time::Duration;

use serde::Deserialize;
use serde_json::value::RawValue;

/// Bound on every call here. Usage endpoints are reads with no side effects, so
/// a slow one is abandoned rather than retried: a retry against a paginated
/// endpoint risks double-reading, and a stale spend figure is worse than a slow
/// one.
const USAGE_TIMEOUT: Duration = Duration::from_secs(20);

/// Header Tokamak returns on an inference response, naming that execution.
/// Every per-request lookup in this module is keyed by it.
pub const EXECUTION_ID_HEADER: &str = "X-Tokamak-Execution-Id";

/// Header a caller may send on an inference request to correlate it later.
/// A correlation value can match several executions; it is not an idempotency
/// key, and nothing here treats it as one.
pub const CLIENT_REQUEST_ID_HEADER: &str = "X-Client-Request-Id";

/// Why a usage read did not produce an answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UsageError {
    /// No Tokamak key is configured, so there is no account to read.
    NotSignedIn,
    /// The execution or correlation id named nothing this credential can see.
    /// Per the API contract a foreign execution is reported as not found, so
    /// this does not distinguish "never existed" from "belongs to someone
    /// else" -- and neither should the message shown for it.
    NotFound,
    /// Anything else: transport failure, an upstream error status, or a body
    /// that could not be read. Already phrased for a user.
    Failed(String),
}

impl std::fmt::Display for UsageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotSignedIn => write!(f, "not signed in to Tokamak - run `jan login`"),
            Self::NotFound => write!(
                f,
                "no such record for this credential (a foreign execution reads as not found)"
            ),
            Self::Failed(message) => write!(f, "{message}"),
        }
    }
}

/// An exact monetary amount, kept as the literal text the server sent.
///
/// Deliberately not a number: see the module docs. There is no `f64`
/// conversion and no arithmetic, because the only correct thing to do with a
/// charge the server computed is show it or hand it to something that does
/// decimal arithmetic properly. Summing charges client-side would reintroduce
/// precisely the rounding this type exists to prevent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Money(String);

impl Money {
    /// The amount exactly as the server wrote it.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Accept a JSON number literal or a decimal string, rejecting anything
    /// that is not a plain decimal. A value shaped like `1e-7` is valid JSON
    /// but is not a decimal literal, so it is kept verbatim rather than
    /// normalized -- rewriting it would be the same class of mistake as
    /// rounding it.
    fn parse(raw: &RawValue) -> Option<Self> {
        let text = raw.get().trim();
        if text == "null" {
            return None;
        }
        let unquoted = match text.strip_prefix('"').and_then(|t| t.strip_suffix('"')) {
            // A decimal string carries no escapes worth handling; one that does
            // is not a money field.
            Some(inner) if !inner.contains('\\') => inner,
            Some(_) => return None,
            None => text,
        };
        let body = unquoted.strip_prefix('-').unwrap_or(unquoted);
        let plausible = !body.is_empty()
            && body.chars().all(|c| c.is_ascii_digit() || c == '.' || c == 'e' || c == 'E'
                || c == '+' || c == '-')
            && body.chars().any(|c| c.is_ascii_digit());
        plausible.then(|| Self(unquoted.to_string()))
    }
}

impl std::fmt::Display for Money {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// How far a billing figure has settled. Rendered verbatim rather than mapped
/// onto a local vocabulary: a `pending` charge is not a final one, and calling
/// it anything else would invite treating it as final.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BillingStatus {
    Final,
    Pending,
    NotBilled,
    Cancelled,
    /// A status this build does not know. Forwarded as-is instead of being
    /// folded into one of the above, since guessing which would be a guess
    /// about money.
    Other(String),
}

impl BillingStatus {
    fn from_str(raw: &str) -> Self {
        match raw {
            "final" => Self::Final,
            "pending" => Self::Pending,
            "not_billed" => Self::NotBilled,
            "cancelled" => Self::Cancelled,
            other => Self::Other(other.to_string()),
        }
    }

    /// Whether the charge alongside this status is settled. A `false` here must
    /// suppress any claim that the amount is what was billed.
    pub fn is_final(&self) -> bool {
        matches!(self, Self::Final)
    }
}

impl std::fmt::Display for BillingStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Final => f.write_str("final"),
            Self::Pending => f.write_str("pending"),
            Self::NotBilled => f.write_str("not_billed"),
            Self::Cancelled => f.write_str("cancelled"),
            Self::Other(other) => f.write_str(other),
        }
    }
}

/// One execution's record, as returned by `GET /v1/generation`.
///
/// Every field but `id` is optional, and that is the contract rather than
/// defensive coding: a missing cost or token count means **unavailable**, not
/// zero. Defaulting any of these to `0` would be indistinguishable from an
/// honest zero and would turn "we do not know" into "it was free".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Generation {
    /// Tokamak execution UUID. Not the provider's response id.
    pub id: String,
    pub model: Option<String>,
    pub streamed: Option<bool>,
    pub native_tokens_prompt: Option<u64>,
    pub native_tokens_completion: Option<u64>,
    pub billing_status: Option<BillingStatus>,
    /// The customer charge, when known.
    pub total_cost: Option<Money>,
    pub currency: Option<String>,
    /// Measured usage cost, when returned. Explicitly **not** the customer
    /// charge; reported beside `total_cost`, never in place of it.
    pub rated_cost: Option<Money>,
    /// The admission ceiling, when returned. Also not the customer charge --
    /// it is what the request was authorized to spend, not what it did.
    pub authorized_amount: Option<Money>,
}

/// Raw field layout of a generation record, with every money field captured as
/// unparsed text so it never passes through `f64`.
#[derive(Deserialize)]
struct GenerationWire {
    id: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    streamed: Option<bool>,
    #[serde(default)]
    native_tokens_prompt: Option<u64>,
    #[serde(default)]
    native_tokens_completion: Option<u64>,
    #[serde(default)]
    billing_status: Option<String>,
    #[serde(default)]
    total_cost: Option<Box<RawValue>>,
    #[serde(default)]
    currency: Option<String>,
    #[serde(default)]
    rated_cost: Option<Box<RawValue>>,
    #[serde(default)]
    authorized_amount: Option<Box<RawValue>>,
}

impl From<GenerationWire> for Generation {
    fn from(wire: GenerationWire) -> Self {
        let money = |raw: Option<Box<RawValue>>| raw.as_deref().and_then(Money::parse);
        Self {
            id: wire.id,
            model: wire.model,
            streamed: wire.streamed,
            native_tokens_prompt: wire.native_tokens_prompt,
            native_tokens_completion: wire.native_tokens_completion,
            billing_status: wire.billing_status.as_deref().map(BillingStatus::from_str),
            total_cost: money(wire.total_cost),
            currency: wire.currency,
            rated_cost: money(wire.rated_cost),
            authorized_amount: money(wire.authorized_amount),
        }
    }
}

/// A response body whose schema this module does not pin down, kept as raw JSON
/// text.
///
/// The account, daily and limit endpoints report figures whose exact field
/// layout is a server concern and changes independently of this client.
/// Deserializing them into a typed struct would mean either dropping fields the
/// server added or rounding money fields the schema did not anticipate, so they
/// are walked as text instead: unknown fields still appear, and an undocumented
/// money field is shown exactly as sent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Payload(String);

impl Payload {
    /// Flatten to `(dotted.path, value)` pairs, sorted by path, with scalars
    /// rendered as their source text. Objects recurse by key, arrays by index.
    ///
    /// Sorted rather than source-ordered because JSON object order is not
    /// meaningful and a stable order is what makes the output diffable between
    /// two runs.
    pub fn fields(&self) -> Vec<(String, String)> {
        let mut out = Vec::new();
        match serde_json::from_str::<&RawValue>(&self.0) {
            Ok(root) => flatten(String::new(), root, &mut out),
            // Unreachable for a body that already parsed once, but a panic here
            // would be a panic over a usage readout.
            Err(_) => out.push((String::new(), self.0.clone())),
        }
        out.sort_by(|a, b| a.0.cmp(&b.0));
        out
    }

    /// The body as received, for `--json` style output that must not reshape it.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Walk raw JSON text, emitting one entry per scalar leaf. Numbers keep their
/// literal text; strings are unquoted for display but not otherwise decoded,
/// since a usage payload's strings are ids, currencies and decimal amounts.
fn flatten(path: String, raw: &RawValue, out: &mut Vec<(String, String)>) {
    let text = raw.get().trim();
    if text.starts_with('{') {
        // BTreeMap and not a Vec of pairs: object key order is not meaningful,
        // and sorting here keeps nested output stable for free.
        if let Ok(map) = serde_json::from_str::<std::collections::BTreeMap<String, &RawValue>>(text)
        {
            if map.is_empty() {
                out.push((path, "{}".to_string()));
                return;
            }
            for (key, value) in map {
                let child = if path.is_empty() {
                    key
                } else {
                    format!("{path}.{key}")
                };
                flatten(child, value, out);
            }
            return;
        }
    } else if text.starts_with('[') {
        if let Ok(items) = serde_json::from_str::<Vec<&RawValue>>(text) {
            if items.is_empty() {
                out.push((path, "[]".to_string()));
                return;
            }
            for (i, item) in items.into_iter().enumerate() {
                flatten(format!("{path}[{i}]"), item, out);
            }
            return;
        }
    }
    let scalar = match text.strip_prefix('"').and_then(|t| t.strip_suffix('"')) {
        Some(inner) if !inner.contains('\\') => inner.to_string(),
        _ => text.to_string(),
    };
    out.push((path, scalar));
}

/// Which read to perform. One enum rather than six functions so the shared
/// request path -- auth, timeout, status mapping -- exists once, and so a
/// caller can name a view without knowing its route.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Query {
    /// `GET /v1/usage/me`: usage across this account's credentials, not only
    /// the key making the request.
    Summary,
    /// `GET /v1/usage/me/requests`: recently recorded requests.
    Requests,
    /// `GET /v1/usage/me/daily`: daily totals.
    Daily,
    /// `GET /v1/usage/limits/current`: usage-limit status. Separate from wallet
    /// credit, which is its own check and is not read here.
    Limits,
    /// `GET /v1/generation?id=`: one execution.
    Generation(String),
    /// `GET /v1/generations?client_request_id=`: every execution a caller
    /// tagged with the same correlation id.
    Correlated(String),
}

impl Query {
    /// Path and query pairs, relative to the API root.
    fn route(&self) -> (&'static str, Vec<(&'static str, &str)>) {
        match self {
            Self::Summary => ("usage/me", Vec::new()),
            Self::Requests => ("usage/me/requests", Vec::new()),
            Self::Daily => ("usage/me/daily", Vec::new()),
            Self::Limits => ("usage/limits/current", Vec::new()),
            Self::Generation(id) => ("generation", vec![("id", id.as_str())]),
            Self::Correlated(id) => ("generations", vec![("client_request_id", id.as_str())]),
        }
    }

    /// How this view is named in output.
    pub fn label(&self) -> &'static str {
        match self {
            Self::Summary => "account usage",
            Self::Requests => "recent requests",
            Self::Daily => "daily totals",
            Self::Limits => "usage limits",
            Self::Generation(_) => "generation",
            Self::Correlated(_) => "correlated generations",
        }
    }
}

/// Perform `query` against the configured Tokamak deployment and return the raw
/// body.
///
/// Honours `TOKAMAK_BASE_URL` through [`super::base_url`], so a dev stack is
/// reachable without a rebuild, and shapes failures through the same
/// [`super::describe_failure`] the sign-in path uses -- one voice for upstream
/// problems regardless of which endpoint hit them.
pub async fn fetch(query: &Query) -> Result<Payload, UsageError> {
    let api_key = super::stored_api_key().ok_or(UsageError::NotSignedIn)?;
    let client = reqwest::Client::builder()
        .timeout(USAGE_TIMEOUT)
        .build()
        .map_err(|e| UsageError::Failed(e.to_string()))?;

    let root = super::base_url();
    let (path, params) = query.route();
    let mut request = client
        .get(format!("{root}/{path}"))
        .header("Authorization", format!("Bearer {api_key}"));
    if !params.is_empty() {
        request = request.query(&params);
    }

    let response = request
        .send()
        .await
        .map_err(|e| UsageError::Failed(format!("could not reach {root}: {e}")))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if status.as_u16() == 404 {
        return Err(UsageError::NotFound);
    }
    if !status.is_success() {
        return Err(UsageError::Failed(super::describe_failure(
            status.as_u16(),
            &body,
        )));
    }
    // Parsed once here so every later walk of the text is infallible, and so a
    // truncated body fails as a read error rather than as an empty readout.
    serde_json::from_str::<&RawValue>(&body)
        .map_err(|e| UsageError::Failed(format!("Tokamak returned a response we could not read: {e}")))?;
    Ok(Payload(body))
}

/// Read one execution. The record arrives inside `data`, which holds exactly
/// one entry for this endpoint; an empty `data` is the documented shape of a
/// lookup that matched nothing and so reads as [`UsageError::NotFound`] rather
/// than as an empty success.
pub async fn generation(execution_id: &str) -> Result<Generation, UsageError> {
    let payload = fetch(&Query::Generation(execution_id.to_string())).await?;
    let mut records = parse_generations(payload.as_str())?;
    if records.is_empty() {
        return Err(UsageError::NotFound);
    }
    Ok(records.remove(0))
}

/// Read every execution tagged with `client_request_id`. Unlike a single
/// lookup, an empty result here is a legitimate answer -- the caller may simply
/// never have sent that id -- so it is `Ok(vec![])`, not a not-found.
pub async fn correlated(client_request_id: &str) -> Result<Vec<Generation>, UsageError> {
    let payload = fetch(&Query::Correlated(client_request_id.to_string())).await?;
    parse_generations(payload.as_str())
}

/// Parse an already-fetched payload as generation records, for a caller that
/// fetched through [`fetch`] rather than [`generation`] (the TUI, which runs
/// every view through one off-loop job and renders the result afterwards).
pub fn parse_generations_payload(payload: &Payload) -> Result<Vec<Generation>, UsageError> {
    parse_generations(payload.as_str())
}

/// Pull the `data` array out of a generations body. Both endpoints answer with
/// `data` as an array (the single lookup simply puts one record in it), so one
/// parser serves both.
fn parse_generations(body: &str) -> Result<Vec<Generation>, UsageError> {
    #[derive(Deserialize)]
    struct Envelope {
        #[serde(default)]
        data: Vec<GenerationWire>,
    }
    let envelope: Envelope = serde_json::from_str(body)
        .map_err(|e| UsageError::Failed(format!("could not read the generation record: {e}")))?;
    Ok(envelope.data.into_iter().map(Generation::from).collect())
}

/// Build a [`Payload`] from a literal body, for tests in other modules that
/// need to render a readout without a server to fetch it from.
#[cfg(test)]
pub fn parse_payload_for_test(body: &str) -> Payload {
    Payload(body.to_string())
}

/// One row of aggregated analytics: a model's slice of the account summary, a
/// day's totals, or the account-wide total.
///
/// Token counts default to zero because these endpoints report a count for
/// every bucket they return a row for -- a row exists *because* there was
/// traffic. Cost does not default: it is [`Money`] or nothing, for the same
/// reason a generation's charge is.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Aggregate {
    /// Model id for a by-model row, the date for a daily row, empty for the
    /// account total.
    pub label: String,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
    pub request_count: u64,
    /// What the server computed this slice cost. Exact text, never summed
    /// client-side -- the server already totalled it in the row that says so.
    pub cost: Option<Money>,
    /// What caching saved, when reported.
    pub savings: Option<Money>,
}

#[derive(Deserialize)]
struct AggregateWire {
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    date: Option<String>,
    #[serde(default)]
    total_prompt_tokens: u64,
    #[serde(default)]
    total_completion_tokens: u64,
    #[serde(default)]
    cache_read_tokens: u64,
    #[serde(default)]
    cache_creation_tokens: u64,
    #[serde(default)]
    request_count: u64,
    #[serde(default)]
    estimated_cost_usd: Option<Box<RawValue>>,
    #[serde(default)]
    cache_savings_usd: Option<Box<RawValue>>,
}

impl From<AggregateWire> for Aggregate {
    fn from(wire: AggregateWire) -> Self {
        Self {
            // A daily row is named by its date and a model row by its model;
            // the account total carries neither and is labelled by context.
            label: wire
                .model
                .filter(|m| !m.is_empty())
                .or(wire.date)
                .unwrap_or_default(),
            prompt_tokens: wire.total_prompt_tokens,
            completion_tokens: wire.total_completion_tokens,
            cache_read_tokens: wire.cache_read_tokens,
            cache_creation_tokens: wire.cache_creation_tokens,
            request_count: wire.request_count,
            cost: wire.estimated_cost_usd.as_deref().and_then(Money::parse),
            savings: wire.cache_savings_usd.as_deref().and_then(Money::parse),
        }
    }
}

/// `GET /v1/usage/me`: the account total plus its per-model breakdown.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountSummary {
    /// Window the figures cover, as the server dated it.
    pub period: Option<(String, String)>,
    pub total: Aggregate,
    pub by_model: Vec<Aggregate>,
}

/// Parse the account summary. Returns `None` when the body is not that shape,
/// so the caller can fall back to the generic field walk rather than claim the
/// server sent nothing.
pub fn parse_account_summary(payload: &Payload) -> Option<AccountSummary> {
    #[derive(Deserialize)]
    struct Period {
        start_date: String,
        end_date: String,
    }
    #[derive(Deserialize)]
    struct Wire {
        #[serde(default)]
        period: Option<Period>,
        total_usage: AggregateWire,
        #[serde(default)]
        by_model: Vec<AggregateWire>,
    }
    let wire: Wire = serde_json::from_str(payload.as_str()).ok()?;
    Some(AccountSummary {
        period: wire.period.map(|p| (p.start_date, p.end_date)),
        total: wire.total_usage.into(),
        by_model: wire.by_model.into_iter().map(Aggregate::from).collect(),
    })
}

/// Parse `GET /v1/usage/me/daily`, a bare array of per-day totals.
pub fn parse_daily(payload: &Payload) -> Option<Vec<Aggregate>> {
    let wire: Vec<AggregateWire> = serde_json::from_str(payload.as_str()).ok()?;
    Some(wire.into_iter().map(Aggregate::from).collect())
}

/// One recorded request from `GET /v1/usage/me/requests`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestRecord {
    pub execution_id: Option<String>,
    pub model: Option<String>,
    pub billing_status: Option<BillingStatus>,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub cache_read_tokens: u64,
    pub cost: Option<Money>,
    pub created_at: Option<String>,
    /// HTTP status the caller saw. A non-200 is why a row may have no cost.
    pub status: Option<u16>,
}

#[derive(Deserialize)]
struct RequestWire {
    #[serde(default)]
    execution_id: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    billing_status: Option<String>,
    #[serde(default)]
    prompt_tokens: u64,
    #[serde(default)]
    completion_tokens: u64,
    #[serde(default)]
    cache_read_tokens: u64,
    #[serde(default)]
    estimated_cost_usd: Option<Box<RawValue>>,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    status: Option<u16>,
}

/// Parse the recorded-requests list out of its `data` envelope.
pub fn parse_requests(payload: &Payload) -> Option<Vec<RequestRecord>> {
    #[derive(Deserialize)]
    struct Envelope {
        #[serde(default)]
        data: Vec<RequestWire>,
    }
    let envelope: Envelope = serde_json::from_str(payload.as_str()).ok()?;
    Some(
        envelope
            .data
            .into_iter()
            .map(|wire| RequestRecord {
                execution_id: wire.execution_id,
                model: wire.model,
                billing_status: wire.billing_status.as_deref().map(BillingStatus::from_str),
                prompt_tokens: wire.prompt_tokens,
                completion_tokens: wire.completion_tokens,
                cache_read_tokens: wire.cache_read_tokens,
                cost: wire.estimated_cost_usd.as_deref().and_then(Money::parse),
                created_at: wire.created_at,
                status: wire.status,
            })
            .collect(),
    )
}

/// `GET /v1/usage/limits/current`: whether the account is currently allowed to
/// spend, and the decisions behind that.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LimitStatus {
    pub allowed: bool,
    /// Each limit the server evaluated, rendered from whatever fields it
    /// carried -- the decision schema is not pinned here.
    pub decisions: Vec<String>,
}

/// Parse the current-limits view. A `null` `decisions` is the documented shape
/// of "nothing to report", not an error.
pub fn parse_limits(payload: &Payload) -> Option<LimitStatus> {
    #[derive(Deserialize)]
    struct Wire {
        allowed: bool,
        #[serde(default)]
        decisions: Option<Vec<Box<RawValue>>>,
    }
    let wire: Wire = serde_json::from_str(payload.as_str()).ok()?;
    Some(LimitStatus {
        allowed: wire.allowed,
        decisions: wire
            .decisions
            .unwrap_or_default()
            .iter()
            .map(|raw| {
                // Unpinned schema: flatten each decision to `key=value` pairs
                // so an added field shows up instead of being dropped.
                let mut fields = Vec::new();
                flatten(String::new(), raw, &mut fields);
                fields
                    .iter()
                    .map(|(path, value)| format!("{path}={value}"))
                    .collect::<Vec<_>>()
                    .join("  ")
            })
            .collect(),
    })
}

/// How a field with no value is shown. Never `0` and never blank: the whole
/// point is that unavailable and zero are different answers, and a blank cell
/// reads as zero to most people.
pub const UNAVAILABLE: &str = "unavailable";

/// Render one generation as aligned `label: value` lines.
///
/// `rated_cost` and `authorized_amount` are labelled for what they are rather
/// than presented alongside the charge as if interchangeable, and a
/// non-`final` billing status is called out on the cost line itself so the
/// number is never read as settled.
pub fn generation_lines(record: &Generation) -> Vec<String> {
    let optional = |value: Option<String>| value.unwrap_or_else(|| UNAVAILABLE.to_string());
    let currency = record
        .currency
        .as_deref()
        .map(|c| format!(" {c}"))
        .unwrap_or_default();

    let mut lines = vec![
        format!("execution:   {}", record.id),
        format!("model:       {}", optional(record.model.clone())),
        format!(
            "streamed:    {}",
            optional(record.streamed.map(|s| s.to_string()))
        ),
        format!(
            "tokens in:   {}",
            optional(record.native_tokens_prompt.map(|t| t.to_string()))
        ),
        format!(
            "tokens out:  {}",
            optional(record.native_tokens_completion.map(|t| t.to_string()))
        ),
        format!(
            "billing:     {}",
            optional(record.billing_status.as_ref().map(|s| s.to_string()))
        ),
    ];

    let settled = record.billing_status.as_ref().is_some_and(BillingStatus::is_final);
    lines.push(match &record.total_cost {
        Some(cost) if settled => format!("charge:      {cost}{currency}"),
        // A figure that is not final is still worth showing -- it is the best
        // information there is -- but it must not be called a charge.
        Some(cost) => format!("charge:      {cost}{currency} (not final)"),
        None => format!("charge:      {UNAVAILABLE}"),
    });
    if let Some(rated) = &record.rated_cost {
        lines.push(format!("rated cost:  {rated}{currency} (measured usage, not the charge)"));
    }
    if let Some(authorized) = &record.authorized_amount {
        lines.push(format!(
            "authorized:  {authorized}{currency} (admission ceiling, not the charge)"
        ));
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(text: &str) -> Box<RawValue> {
        RawValue::from_string(text.to_string()).expect("valid json")
    }

    /// The whole reason [`Money`] is not an `f64`. This literal has more
    /// significant digits than a double can hold, so a parse-and-reformat round
    /// trip changes it -- and the digits it changes are the ones a
    /// reconciliation against an invoice would be looking at.
    #[test]
    fn money_survives_a_value_f64_would_round() {
        let exact = "0.1234567890123456789012345";
        let money = Money::parse(&raw(exact)).expect("a decimal literal is money");
        assert_eq!(money.as_str(), exact);

        let through_f64 = exact.parse::<f64>().expect("parses as a double");
        assert_ne!(
            through_f64.to_string(),
            exact,
            "the test value must actually be one f64 mangles, or it proves nothing"
        );
    }

    /// Analytics money arrives as a decimal string while generation money
    /// arrives as a bare number. Both are the same kind of thing and both must
    /// come back byte-identical.
    #[test]
    fn money_accepts_both_the_string_and_number_forms() {
        assert_eq!(
            Money::parse(&raw("\"12.3456789\"")).map(|m| m.as_str().to_string()),
            Some("12.3456789".to_string())
        );
        assert_eq!(
            Money::parse(&raw("12.3456789")).map(|m| m.as_str().to_string()),
            Some("12.3456789".to_string())
        );
        assert_eq!(
            Money::parse(&raw("-0.5")).map(|m| m.as_str().to_string()),
            Some("-0.5".to_string())
        );
    }

    /// A null cost is unavailable, not zero -- the distinction this whole
    /// module is built around.
    #[test]
    fn a_null_amount_is_not_money() {
        assert_eq!(Money::parse(&raw("null")), None);
        assert_eq!(Money::parse(&raw("\"\"")), None);
        assert_eq!(Money::parse(&raw("{}")), None);
    }

    #[test]
    fn a_generation_record_keeps_its_exact_charge() {
        let body = r#"{"data":[{
            "id":"exec-1",
            "model":"gpt-5",
            "streamed":true,
            "native_tokens_prompt":1200,
            "native_tokens_completion":34,
            "billing_status":"final",
            "total_cost":0.000000123456789012345678,
            "currency":"USD"
        }]}"#;
        let mut records = parse_generations(body).expect("parses");
        let record = records.remove(0);
        assert_eq!(record.id, "exec-1");
        assert_eq!(record.model.as_deref(), Some("gpt-5"));
        assert_eq!(record.streamed, Some(true));
        assert_eq!(record.native_tokens_prompt, Some(1200));
        assert_eq!(record.billing_status, Some(BillingStatus::Final));
        assert_eq!(
            record.total_cost.as_ref().map(Money::as_str),
            Some("0.000000123456789012345678"),
            "the charge must be exactly what the server sent"
        );
    }

    /// Missing fields must stay missing all the way to the rendered line, and
    /// must never be defaulted into a zero that reads as "it was free".
    #[test]
    fn missing_fields_render_as_unavailable_not_zero() {
        let body = r#"{"data":[{"id":"exec-2"}]}"#;
        let mut records = parse_generations(body).expect("parses");
        let record = records.remove(0);
        assert_eq!(record.total_cost, None);
        assert_eq!(record.native_tokens_prompt, None);

        let lines = generation_lines(&record).join("\n");
        assert!(lines.contains("charge:      unavailable"), "{lines}");
        assert!(lines.contains("tokens in:   unavailable"), "{lines}");
        assert!(!lines.contains(" 0"), "nothing may be defaulted to zero: {lines}");
    }

    /// An honest zero is a different answer from an absent one, and has to
    /// render as a zero.
    #[test]
    fn a_reported_zero_is_reported_as_zero() {
        let body = r#"{"data":[{"id":"e","native_tokens_completion":0,"total_cost":0,"billing_status":"not_billed"}]}"#;
        let mut records = parse_generations(body).expect("parses");
        let record = records.remove(0);
        assert_eq!(record.native_tokens_completion, Some(0));
        assert_eq!(record.total_cost.as_ref().map(Money::as_str), Some("0"));
        let lines = generation_lines(&record).join("\n");
        assert!(lines.contains("tokens out:  0"), "{lines}");
    }

    /// A pending charge is shown, because it is the best figure available, but
    /// never as a settled one.
    #[test]
    fn a_pending_charge_is_never_presented_as_final() {
        let body = r#"{"data":[{"id":"e","total_cost":1.25,"currency":"USD","billing_status":"pending"}]}"#;
        let mut records = parse_generations(body).expect("parses");
        let lines = generation_lines(&records.remove(0)).join("\n");
        assert!(lines.contains("billing:     pending"), "{lines}");
        assert!(lines.contains("1.25 USD (not final)"), "{lines}");
    }

    /// Neither of these is the customer charge, and the output has to say so
    /// rather than let them be mistaken for it.
    #[test]
    fn rated_and_authorized_are_labelled_as_not_the_charge() {
        let body = r#"{"data":[{"id":"e","rated_cost":"0.30","authorized_amount":"5.00","billing_status":"pending"}]}"#;
        let mut records = parse_generations(body).expect("parses");
        let lines = generation_lines(&records.remove(0)).join("\n");
        assert!(lines.contains("rated cost:  0.30 (measured usage, not the charge)"), "{lines}");
        assert!(
            lines.contains("authorized:  5.00 (admission ceiling, not the charge)"),
            "{lines}"
        );
    }

    /// An unknown billing status is forwarded rather than guessed at, and is
    /// not treated as final.
    #[test]
    fn an_unknown_billing_status_is_forwarded_and_not_final() {
        let status = BillingStatus::from_str("reconciling");
        assert_eq!(status, BillingStatus::Other("reconciling".to_string()));
        assert!(!status.is_final());
        assert_eq!(status.to_string(), "reconciling");
    }

    /// The documented shape of a lookup that matched nothing.
    #[test]
    fn an_empty_data_array_is_no_records() {
        assert!(parse_generations(r#"{"data":[]}"#).expect("parses").is_empty());
        assert!(parse_generations("{}").expect("parses").is_empty());
    }

    #[test]
    fn a_body_that_is_not_a_generation_envelope_is_an_error() {
        assert!(matches!(
            parse_generations("not json"),
            Err(UsageError::Failed(_))
        ));
    }

    /// The undocumented-schema path: unknown fields survive, and money keeps
    /// its digits because the walk never parses a number.
    #[test]
    fn payload_flattens_unknown_shapes_without_rounding_money() {
        let payload = Payload(
            r#"{"spend":"0.1234567890123456789","buckets":[{"day":"2026-09-01","cost":0.000000000000000001}],"future_field":true}"#
                .to_string(),
        );
        let fields = payload.fields();
        let lookup = |name: &str| {
            fields
                .iter()
                .find(|(path, _)| path == name)
                .map(|(_, value)| value.as_str())
        };
        assert_eq!(lookup("spend"), Some("0.1234567890123456789"));
        assert_eq!(lookup("buckets[0].day"), Some("2026-09-01"));
        assert_eq!(lookup("buckets[0].cost"), Some("0.000000000000000001"));
        assert_eq!(
            lookup("future_field"),
            Some("true"),
            "a field this build has never heard of must still be reported"
        );
    }

    #[test]
    fn payload_fields_are_sorted_so_output_is_stable() {
        let payload = Payload(r#"{"z":1,"a":2,"m":{"b":3}}"#.to_string());
        let paths: Vec<String> = payload.fields().into_iter().map(|(p, _)| p).collect();
        assert_eq!(paths, vec!["a".to_string(), "m.b".to_string(), "z".to_string()]);
    }

    #[test]
    fn empty_containers_are_reported_rather_than_dropped() {
        let payload = Payload(r#"{"rows":[],"meta":{}}"#.to_string());
        let fields = payload.fields();
        assert!(fields.iter().any(|(p, v)| p == "rows" && v == "[]"), "{fields:?}");
        assert!(fields.iter().any(|(p, v)| p == "meta" && v == "{}"), "{fields:?}");
    }

    #[test]
    fn routes_match_the_documented_endpoints() {
        assert_eq!(Query::Summary.route().0, "usage/me");
        assert_eq!(Query::Requests.route().0, "usage/me/requests");
        assert_eq!(Query::Daily.route().0, "usage/me/daily");
        assert_eq!(Query::Limits.route().0, "usage/limits/current");
        let generation = Query::Generation("x".to_string());
        let (path, params) = generation.route();
        assert_eq!((path, params), ("generation", vec![("id", "x")]));
        let correlated = Query::Correlated("c".to_string());
        let (path, params) = correlated.route();
        assert_eq!(
            (path, params),
            ("generations", vec![("client_request_id", "c")])
        );
    }

    /// A not-found is phrased so it cannot be read as "you were charged
    /// nothing", and does not speculate about whose execution it was.
    #[test]
    fn the_not_found_message_does_not_imply_a_zero_charge() {
        let message = UsageError::NotFound.to_string();
        assert!(message.contains("not found"), "{message}");
        assert!(!message.contains('0'), "{message}");
    }
}
