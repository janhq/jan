//! One renderer for provider-reported usage, shared by the TUI readout and
//! the `jan usage` subcommand.
//!
//! Both surfaces answer the same question from the same bytes, so they render
//! through the same code: a fix to how a charge is displayed cannot land in
//! one and miss the other. The output is plain `String` lines rather than
//! styled spans because that is the intersection of what a dock and a pipe
//! can both take; the TUI adds colour by wrapping, not by re-laying-out.
//!
//! Nothing here reformats a money figure. A reported amount is printed as the
//! server wrote it (see [`crate::core::cli::tokamak::usage::Money`]), which is
//! also what keeps it visually distinct from the session estimate's `~$0.57`.

use super::tui::format_tokens;

/// How many rows the account and daily views show before folding.
const TOP_REPORTED_ROWS: usize = 5;

/// How much of a ranked list to show, and whether the reader can change it.
///
/// Not a bool, because "show everything" has two different meanings here and
/// only one of them may print a keybinding. The TUI's docked readout folds and
/// unfolds with `m`; `jan usage` writes to a pipe, where nothing is folded (a
/// view that silently dropped rows would be wrong for the scripts reading it)
/// and there is no `m` to press.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fold {
    /// Docked: the tail is folded away, with the hint that shows it.
    Folded,
    /// Docked and unfolded: every row, with the hint that folds it back.
    Unfolded,
    /// Piped: every row and no hint at all.
    Fixed,
}

impl Fold {
    /// The docked spelling of an `all_rows` flag.
    pub fn docked(all_rows: bool) -> Self {
        if all_rows {
            Self::Unfolded
        } else {
            Self::Folded
        }
    }

    fn shows_all(self) -> bool {
        !matches!(self, Self::Folded)
    }

    /// The trailing line offering the other half of the fold, or `None` when
    /// there is no key to press.
    fn hint(self, hidden: usize, noun: &str) -> Option<String> {
        match self {
            Self::Fixed => None,
            _ if hidden > 0 => Some(format!(
                "  +{hidden} more {noun}{}  ·  m to show all",
                if hidden == 1 { "" } else { "s" }
            )),
            Self::Unfolded => Some("  m to fold the tail".to_string()),
            Self::Folded => None,
        }
    }
}

/// A reported money amount, as the server wrote it, prefixed for display.
///
/// No reformatting and no rounding: the text is the figure. Deliberately not
/// routed through the TUI's `format_usd`, which is the *estimate* formatter -- a
/// provider-recorded charge that rendered identically to a local guess would
/// be indistinguishable from one, which is the confusion this whole split
/// exists to prevent. An estimate reads `~$0.57`; a reported figure reads
/// `$0.570142` exactly as sent.
fn reported_money(amount: Option<&crate::core::cli::tokamak::usage::Money>) -> String {
    amount.map_or_else(
        || crate::core::cli::tokamak::usage::UNAVAILABLE.to_string(),
        |m| format!("${m}"),
    )
}

/// Sort key for a reported amount. Ranking is the one place a charge may be
/// approximated -- the ordering of a list is not a figure anyone reconciles --
/// but the value shown beside it is still the server's exact text. An
/// unparseable or absent amount ranks last rather than as zero.
fn money_rank(amount: Option<&crate::core::cli::tokamak::usage::Money>) -> f64 {
    amount
        .and_then(|m| m.as_str().parse::<f64>().ok())
        .unwrap_or(f64::NEG_INFINITY)
}

/// Just the date out of an RFC 3339 timestamp. For a reporting period, whose
/// bounds are a month apart, the clock is noise.
fn day_only(stamp: &str) -> String {
    stamp.split_once('T').map_or(stamp, |(date, _)| date).to_string()
}

/// Trim an RFC 3339 timestamp to the date, or `YYYY-MM-DD HH:MM` when the time
/// of day distinguishes rows. Long timestamps are most of a row's width and
/// the seconds are never what is being compared.
fn short_date(stamp: &str) -> String {
    let Some((date, rest)) = stamp.split_once('T') else {
        return stamp.to_string();
    };
    match rest.split_once(':') {
        // Midnight is a daily bucket's marker, not a time: show the date alone.
        Some((hour, tail)) if hour == "00" && tail.starts_with("00") => date.to_string(),
        Some((hour, tail)) => format!("{date} {hour}:{}", &tail[..2.min(tail.len())]),
        None => date.to_string(),
    }
}

/// `N req · 12.3K in (8.1K cached) · 3.4K out`, for a server-reported row.
/// Mirrors [`usage_counts`] so the session and account views read alike --
/// token counts are the one thing the two sources measure the same way.
fn reported_counts(row: &crate::core::cli::tokamak::usage::Aggregate) -> String {
    let mut line = format!(
        "{} req · {} in",
        row.request_count,
        format_tokens(row.prompt_tokens)
    );
    if row.cache_read_tokens > 0 {
        line.push_str(&format!(" ({} cached)", format_tokens(row.cache_read_tokens)));
    }
    line.push_str(&format!(" · {} out", format_tokens(row.completion_tokens)));
    if row.cache_creation_tokens > 0 {
        line.push_str(&format!(
            " · {} cache write",
            format_tokens(row.cache_creation_tokens)
        ));
    }
    line
}

/// Lay out ranked rows as a padded two-column table under a heading, folding
/// past `TOP_REPORTED_ROWS`. Shared by the account and daily views, which
/// differ only in what a row is named after.
fn reported_rows(
    heading: &str,
    rows: &[crate::core::cli::tokamak::usage::Aggregate],
    fold: Fold,
    noun: &str,
) -> Vec<String> {
    if rows.is_empty() {
        return Vec::new();
    }
    let shown = if fold.shows_all() {
        rows.len()
    } else {
        rows.len().min(TOP_REPORTED_ROWS)
    };
    let hidden = rows.len() - shown;
    let mut out = vec![String::new(), heading.to_string()];
    let label_w = rows[..shown]
        .iter()
        .map(|r| r.label.chars().count())
        .max()
        .unwrap_or(0);
    let costs: Vec<String> = rows[..shown]
        .iter()
        .map(|r| reported_money(r.cost.as_ref()))
        .collect();
    let cost_w = costs.iter().map(|c| c.chars().count()).max().unwrap_or(0);
    for (row, cost) in rows[..shown].iter().zip(&costs) {
        out.push(format!(
            "  {:<label_w$}  {:<cost_w$}  {}",
            row.label,
            cost,
            reported_counts(row)
        ));
    }
    out.extend(
        fold.hint(hidden, noun)
            .filter(|_| hidden > 0 || rows.len() > TOP_REPORTED_ROWS),
    );
    out
}

/// The account total, without the per-model table: the amount, what it bought
/// and the window it covers. Three lines, because this is what someone asking
/// "what have I spent" is owed before any breakdown.
fn total_rows(summary: &crate::core::cli::tokamak::usage::AccountSummary) -> Vec<String> {
    let mut out = vec![format!(
        "  {}  {}",
        reported_money(summary.total.cost.as_ref()),
        reported_counts(&summary.total)
    )];
    if let Some(savings) = &summary.total.savings {
        out.push(format!("  caching saved ${savings}"));
    }
    if let Some((start, end)) = &summary.period {
        out.push(format!("  {} to {}", day_only(start), day_only(end)));
    }
    out
}

/// Just the account total, for the overview pane. `None` when the body is not
/// a summary, so the caller can fall back to the generic field walk.
pub fn account_total_lines(
    payload: &crate::core::cli::tokamak::usage::Payload,
) -> Option<Vec<String>> {
    crate::core::cli::tokamak::usage::parse_account_summary(payload).map(|s| total_rows(&s))
}

/// Render a fetched account-usage payload.
///
/// Each view leads with the figure that answers the question asked -- the
/// account's total spend, the day's total, whether spending is allowed -- and
/// folds the breakdown beneath it, the same shape bare `/usage` uses for the
/// session estimate. A payload this build cannot parse falls back to the raw
/// field walk rather than reporting nothing, so a server-side schema change
/// degrades to a flat dump instead of an empty readout.
///
/// `fold` says how much of each ranked list to show and whether a keybinding
/// for the other half may be printed -- see [`Fold`], which is what keeps the
/// docked readout's `m` hint out of a piped `jan usage`.
pub fn reported_usage_lines(
    query: &crate::core::cli::tokamak::usage::Query,
    payload: &crate::core::cli::tokamak::usage::Payload,
    fold: Fold,
) -> Vec<String> {
    use crate::core::cli::tokamak::usage;

    // The generic walk: every field the server sent, values verbatim. Used for
    // a view with no typed layout and as the fallback when one fails to parse.
    let raw_fields = || -> Vec<String> {
        let fields = payload.fields();
        if fields.is_empty() {
            vec!["the provider reported no figures for this view".to_string()]
        } else {
            // Padded to the widest path so the values line up as a column;
            // a usage readout is scanned down the numbers, not read across.
            let width = fields.iter().map(|(p, _)| p.len()).max().unwrap_or(0);
            fields
                .iter()
                .map(|(path, value)| format!("{path:width$}  {value}"))
                .collect()
        }
    };

    let mut lines = match query {
        usage::Query::Generation(_) | usage::Query::Correlated(_) => {
            match usage::parse_generations_payload(payload) {
                Ok(records) if records.is_empty() => vec!["no matching execution".to_string()],
                Ok(records) => records
                    .iter()
                    .flat_map(|record| {
                        usage::generation_lines(record)
                            .into_iter()
                            .chain(std::iter::once(String::new()))
                    })
                    .collect(),
                Err(e) => vec![e.to_string()],
            }
        }
        usage::Query::Summary => match usage::parse_account_summary(payload) {
            Some(summary) => {
                let mut out = vec!["account total".to_string()];
                out.extend(total_rows(&summary));
                // Costliest first: a folded list must keep the models that
                // account for the spend, and the server already ranked nothing.
                let mut models = summary.by_model.clone();
                models.sort_by(|a, b| {
                    money_rank(b.cost.as_ref())
                        .partial_cmp(&money_rank(a.cost.as_ref()))
                        .unwrap_or(std::cmp::Ordering::Equal)
                        .then_with(|| a.label.cmp(&b.label))
                });
                out.extend(reported_rows("top models", &models, fold, "model"));
                out
            }
            None => raw_fields(),
        },
        usage::Query::Daily => match usage::parse_daily(payload) {
            Some(days) if days.is_empty() => {
                vec!["no recorded days".to_string()]
            }
            // Sorted, not ranked: a daily view is read in date order rather
            // than by size, so the order is the dates' own. The server already
            // sends them newest-first, but "most recent day" below names a
            // specific date and would state the wrong one if that ever
            // changed -- and a descending sort on an ISO date string is a
            // string sort, so it costs nothing to not depend on it.
            Some(mut days) => {
                days.sort_by(|a, b| b.label.cmp(&a.label));
                let mut out = vec!["most recent day".to_string()];
                out.push(format!(
                    "  {}  {}",
                    reported_money(days[0].cost.as_ref()),
                    reported_counts(&days[0])
                ));
                out.push(format!("  {}", short_date(&days[0].label)));
                let dated: Vec<usage::Aggregate> = days
                    .iter()
                    .map(|day| usage::Aggregate {
                        label: short_date(&day.label),
                        ..day.clone()
                    })
                    .collect();
                out.extend(reported_rows("by day", &dated, fold, "day"));
                out
            }
            None => raw_fields(),
        },
        usage::Query::Requests => match usage::parse_requests(payload) {
            Some(records) if records.is_empty() => {
                vec!["no recorded requests".to_string()]
            }
            Some(records) => {
                let shown = if fold.shows_all() {
                    records.len()
                } else {
                    records.len().min(TOP_REPORTED_ROWS)
                };
                let hidden = records.len() - shown;
                let mut out = vec![format!(
                    "{} recorded request{}",
                    records.len(),
                    if records.len() == 1 { "" } else { "s" }
                )];
                for record in &records[..shown] {
                    let model = record.model.clone().unwrap_or_else(|| {
                        usage::UNAVAILABLE.to_string()
                    });
                    let mut head = format!(
                        "  {}  {}  {}",
                        short_date(record.created_at.as_deref().unwrap_or_default()),
                        reported_money(record.cost.as_ref()),
                        model
                    );
                    // Only worth the width when it changes how the row reads:
                    // an unsettled charge, or a request that failed.
                    if let Some(status) = &record.billing_status {
                        if !status.is_final() {
                            head.push_str(&format!("  ({status})"));
                        }
                    }
                    if record.status.is_some_and(|s| s >= 400) {
                        head.push_str(&format!("  [HTTP {}]", record.status.unwrap_or_default()));
                    }
                    out.push(head);
                    out.push(format!(
                        "    {} in{} · {} out{}",
                        format_tokens(record.prompt_tokens),
                        if record.cache_read_tokens > 0 {
                            format!(" ({} cached)", format_tokens(record.cache_read_tokens))
                        } else {
                            String::new()
                        },
                        format_tokens(record.completion_tokens),
                        record
                            .execution_id
                            .as_deref()
                            .map(|id| format!(" · {id}"))
                            .unwrap_or_default()
                    ));
                }
                out.extend(
                    fold.hint(hidden, "request")
                        .filter(|_| hidden > 0 || records.len() > TOP_REPORTED_ROWS),
                );
                out
            }
            None => raw_fields(),
        },
        usage::Query::Limits => match usage::parse_limits(payload) {
            Some(limits) => {
                let mut out = vec![if limits.allowed {
                    "spending is allowed".to_string()
                } else {
                    "spending is blocked by a usage limit".to_string()
                }];
                if limits.decisions.is_empty() {
                    out.push("  no limit decisions recorded".to_string());
                } else {
                    for decision in &limits.decisions {
                        out.push(format!("  {decision}"));
                    }
                }
                // Named because the two are separate checks upstream: an
                // allowed limit says nothing about whether the wallet is funded.
                out.push(String::new());
                out.push("usage limits and wallet credit are separate checks".to_string());
                out
            }
            None => raw_fields(),
        },
    };
    while lines.last().is_some_and(String::is_empty) {
        lines.pop();
    }
    // The line that keeps the two kinds of number apart. Everything above came
    // from the server; the session estimate lives behind a different command
    // and the two are never added together.
    lines.push(String::new());
    lines.push("reported by the provider - not the local session estimate".to_string());
    lines
}

#[cfg(test)]
mod tests {
    /// Every server-sourced readout has to declare itself as such, because the
    /// same command one word apart prints a local estimate.
    #[test]
    fn a_reported_readout_says_it_is_not_the_local_estimate() {
        use crate::core::cli::tokamak::usage::{parse_payload_for_test, Query};
        // A body in no shape this build knows still renders: the generic
        // field walk is the fallback, so a server-side schema change degrades
        // to a flat dump rather than an empty readout.
        let payload = parse_payload_for_test(r#"{"spend_usd":"1.25"}"#);
        let lines = super::reported_usage_lines(&Query::Summary, &payload, super::Fold::Folded).join("\n");
        assert!(lines.contains("spend_usd"), "{lines}");
        assert!(lines.contains("1.25"), "{lines}");
        assert!(
            lines.contains("reported by the provider - not the local session estimate"),
            "{lines}"
        );
    }

    /// The account view answers "what have I spent" on its first line, with
    /// the per-model breakdown folded beneath it -- the same shape bare
    /// `/usage` uses. Before this it printed `by_model[7].cache_read_tokens`
    /// style paths, which is the JSON object rather than an answer.
    #[test]
    fn the_account_view_leads_with_the_total_and_folds_the_models() {
        use crate::core::cli::tokamak::usage::{parse_payload_for_test, Query};
        let payload = parse_payload_for_test(ACCOUNT_BODY);
        let folded = super::reported_usage_lines(&Query::Summary, &payload, super::Fold::Folded).join("\n");

        assert!(folded.contains("account total"), "{folded}");
        // Exact server text, never reformatted through the estimate's
        // formatter -- a reconciliation reads these digits.
        assert!(folded.contains("$1240.10224445"), "{folded}");
        assert!(folded.contains("15049 req"), "{folded}");
        assert!(folded.contains("caching saved $1200.5278263"), "{folded}");
        assert!(folded.contains("2026-08-23 to 2026-09-22"), "{folded}");
        assert!(!folded.contains("by_model["), "no raw JSON paths: {folded}");

        // Six models, five shown, ranked by spend: the cheapest is the one hidden.
        assert!(folded.contains("top models"), "{folded}");
        assert!(folded.contains("anthropic/claude-opus-5"), "{folded}");
        assert!(folded.contains("+1 more model  ·  m to show all"), "{folded}");
        assert!(!folded.contains("cheap-model"), "the cheapest folds: {folded}");

        let all = super::reported_usage_lines(&Query::Summary, &payload, super::Fold::Unfolded).join("\n");
        assert!(all.contains("cheap-model"), "{all}");
        assert!(!all.contains("more model"), "{all}");
        // The figure that matters does not move between the two.
        assert!(all.contains("$1240.10224445"), "{all}");
    }

    /// `jan usage` writes to a pipe, where every row is printed (a view that
    /// silently dropped rows would be wrong for the scripts reading it) and
    /// there is no `m` to press. Offering the keystroke anyway names an
    /// affordance that does not exist on this surface.
    #[test]
    fn a_piped_view_shows_every_row_and_offers_no_keystroke() {
        use crate::core::cli::tokamak::usage::{parse_payload_for_test, Query};
        let payload = parse_payload_for_test(ACCOUNT_BODY);
        let piped = super::reported_usage_lines(&Query::Summary, &payload, super::Fold::Fixed)
            .join("\n");

        // Nothing folded: the row the docked view hides is here.
        assert!(piped.contains("cheap-model"), "{piped}");
        assert!(!piped.contains(" m to "), "no keybinding in a pipe: {piped}");
        assert!(!piped.contains("more model"), "{piped}");
        // The figures are the same ones the dock shows.
        assert!(piped.contains("$1240.10224445"), "{piped}");
    }

    /// Ranking is by spend, so a folded list keeps the models the money went
    /// to. Sorting by name would hide the expensive one behind an alphabet.
    #[test]
    fn account_models_rank_by_spend_not_by_name() {
        use crate::core::cli::tokamak::usage::{parse_payload_for_test, Query};
        let payload = parse_payload_for_test(ACCOUNT_BODY);
        let lines = super::reported_usage_lines(&Query::Summary, &payload, super::Fold::Unfolded);
        let position = |needle: &str| {
            lines
                .iter()
                .position(|l| l.contains(needle))
                .unwrap_or_else(|| panic!("{needle} missing from {lines:?}"))
        };
        assert!(
            position("anthropic/claude-opus-5") < position("tokamak-1-preview"),
            "195.67 outranks 69.45: {lines:?}"
        );
        assert!(
            position("tokamak-1-preview") < position("anthropic/claude-sonnet-5"),
            "69.45 outranks 46.71: {lines:?}"
        );
        assert!(
            position("anthropic/claude-sonnet-5") < position("cheap-model"),
            "46.71 outranks 0.08: {lines:?}"
        );
    }

    /// A model the server reported no cost for is unavailable, not free, and
    /// must rank last rather than as a zero that reads like "cost nothing".
    #[test]
    fn an_account_model_with_no_cost_reads_as_unavailable() {
        use crate::core::cli::tokamak::usage::{parse_payload_for_test, Query};
        let payload = parse_payload_for_test(
            r#"{"total_usage":{"request_count":2,"estimated_cost_usd":"1.0"},
                "by_model":[{"model":"priced","request_count":1,"estimated_cost_usd":"1.0"},
                            {"model":"unpriced","request_count":1,"estimated_cost_usd":null}]}"#,
        );
        let lines = super::reported_usage_lines(&Query::Summary, &payload, super::Fold::Unfolded);
        let text = lines.join("\n");
        assert!(text.contains("unavailable"), "{text}");
        assert!(!text.contains("$0"), "an unknown cost is never a zero: {text}");
        let position = |needle: &str| lines.iter().position(|l| l.contains(needle)).unwrap();
        assert!(position("priced") < position("unpriced"), "{lines:?}");
    }

    /// The daily view keeps the server's date order rather than re-ranking by
    /// spend: a run of days is read as a timeline, and the newest day is the
    /// one the question is usually about.
    #[test]
    fn the_daily_view_leads_with_the_newest_day_in_date_order() {
        use crate::core::cli::tokamak::usage::{parse_payload_for_test, Query};
        let payload = parse_payload_for_test(
            r#"[{"date":"2026-09-22T00:00:00Z","total_prompt_tokens":2643716,
                 "total_completion_tokens":624644,"request_count":1095,
                 "estimated_cost_usd":"66.8881106"},
                {"date":"2026-09-21T00:00:00Z","total_prompt_tokens":3475890,
                 "total_completion_tokens":939555,"request_count":915,
                 "estimated_cost_usd":"57.56311"}]"#,
        );
        let lines = super::reported_usage_lines(&Query::Daily, &payload, super::Fold::Folded);
        let text = lines.join("\n");
        assert!(text.contains("most recent day"), "{text}");
        assert!(text.contains("$66.8881106"), "{text}");
        // A midnight bucket is a date, not a time of day.
        assert!(text.contains("2026-09-22"), "{text}");
        assert!(!text.contains("00:00"), "a daily bucket has no clock: {text}");
        let position = |needle: &str| lines.iter().rposition(|l| l.contains(needle)).unwrap();
        assert!(position("2026-09-22") < position("2026-09-21"), "{lines:?}");
    }

    /// "most recent day" names a specific date, so it must be the newest one in
    /// the body rather than whichever the server happened to send first. The
    /// server sends them newest-first today; this view does not depend on it.
    #[test]
    fn the_daily_view_finds_the_newest_day_whatever_order_it_arrives_in() {
        use crate::core::cli::tokamak::usage::{parse_payload_for_test, Query};
        // Oldest-first, the reverse of what the server sends.
        let payload = parse_payload_for_test(
            r#"[{"date":"2026-09-21T00:00:00Z","total_prompt_tokens":10,
                 "total_completion_tokens":1,"request_count":1,
                 "estimated_cost_usd":"1.00"},
                {"date":"2026-09-22T00:00:00Z","total_prompt_tokens":20,
                 "total_completion_tokens":2,"request_count":2,
                 "estimated_cost_usd":"2.00"}]"#,
        );
        let lines = super::reported_usage_lines(&Query::Daily, &payload, super::Fold::Folded);
        let head = lines[..3].join("\n");
        assert!(head.contains("most recent day"), "{head}");
        assert!(head.contains("2026-09-22"), "the newest date, not the first: {head}");
        assert!(head.contains("$2.00"), "{head}");
        // And the table under it reads newest-first too.
        let position = |needle: &str| lines.iter().rposition(|l| l.contains(needle)).unwrap();
        assert!(position("2026-09-22") < position("2026-09-21"), "{lines:?}");
    }

    /// The requests view is a list of executions, each with the id a user
    /// needs to look the charge up with `/usage <execution-id>`.
    #[test]
    fn the_requests_view_lists_executions_with_their_ids() {
        use crate::core::cli::tokamak::usage::{parse_payload_for_test, Query};
        let payload = parse_payload_for_test(
            r#"{"data":[{"execution_id":"4b1e70d6","billing_status":"not_billed",
                 "model":"anthropic/claude-opus-5","prompt_tokens":460,
                 "completion_tokens":371,"cache_read_tokens":41339,
                 "estimated_cost_usd":"0.0322445","status":200,
                 "created_at":"2026-09-22T08:57:20.751721Z"}]}"#,
        );
        let text = super::reported_usage_lines(&Query::Requests, &payload, super::Fold::Folded).join("\n");
        assert!(text.contains("1 recorded request"), "{text}");
        assert!(text.contains("4b1e70d6"), "the id to look up: {text}");
        assert!(text.contains("$0.0322445"), "{text}");
        assert!(text.contains("41K cached"), "{text}");
        // Not yet billed, so the figure must not read as a settled charge.
        assert!(text.contains("(not_billed)"), "{text}");
        assert!(text.contains("2026-09-22 08:57"), "{text}");
    }

    /// The limits view answers a yes/no question, so it says yes or no instead
    /// of printing `allowed  true`.
    #[test]
    fn the_limits_view_answers_whether_spending_is_allowed() {
        use crate::core::cli::tokamak::usage::{parse_payload_for_test, Query};
        let allowed = parse_payload_for_test(r#"{"allowed":true,"decisions":null}"#);
        let text = super::reported_usage_lines(&Query::Limits, &allowed, super::Fold::Folded).join("\n");
        assert!(text.contains("spending is allowed"), "{text}");
        assert!(text.contains("no limit decisions recorded"), "{text}");
        // The two checks are separate upstream; an allowed limit is not credit.
        assert!(text.contains("wallet credit are separate"), "{text}");

        let blocked = parse_payload_for_test(
            r#"{"allowed":false,"decisions":[{"limit":"monthly","used":"120.00"}]}"#,
        );
        let text = super::reported_usage_lines(&Query::Limits, &blocked, super::Fold::Folded).join("\n");
        assert!(text.contains("blocked by a usage limit"), "{text}");
        assert!(text.contains("monthly"), "{text}");
        assert!(text.contains("120.00"), "{text}");
    }


    /// A live account summary, trimmed to six models. Shaped exactly as
    /// `GET /v1/usage/me` answers, including the empty `provider` fields and
    /// money as decimal strings.
    const ACCOUNT_BODY: &str = r#"{
        "period": {"start_date":"2026-08-23T08:57:21.160234939Z",
                   "end_date":"2026-09-22T08:57:21.160234939Z"},
        "total_usage": {"model":"","provider":"","total_prompt_tokens":277414219,
            "total_completion_tokens":10931093,"total_tokens":1892976850,
            "request_count":15049,"estimated_cost_usd":"1240.10224445",
            "cache_read_tokens":1577470525,"cache_creation_tokens":27161013,
            "cache_savings_usd":"1200.5278263"},
        "by_model": [
          {"model":"cheap-model","total_prompt_tokens":56073,
           "total_completion_tokens":2217,"request_count":29,
           "estimated_cost_usd":"0.087158","cache_read_tokens":0,
           "cache_creation_tokens":0,"cache_savings_usd":"0"},
          {"model":"anthropic/claude-sonnet-5","total_prompt_tokens":4408975,
           "total_completion_tokens":1295731,"request_count":1238,
           "estimated_cost_usd":"46.7142352","cache_read_tokens":105369976,
           "cache_creation_tokens":1545992,"cache_savings_usd":"189.6659568"},
          {"model":"anthropic/claude-opus-5","total_prompt_tokens":8639502,
           "total_completion_tokens":1546976,"request_count":2987,
           "estimated_cost_usd":"195.67393925","cache_read_tokens":224635971,
           "cache_creation_tokens":237447,"cache_savings_usd":"1010.8618695"},
          {"model":"tokamak-1-preview","total_prompt_tokens":263419660,
           "total_completion_tokens":2879420,"request_count":4884,
           "estimated_cost_usd":"69.454827","cache_read_tokens":0,
           "cache_creation_tokens":0,"cache_savings_usd":"0"},
          {"model":"claude-opus-4-8","total_prompt_tokens":890009,
           "total_completion_tokens":120000,"request_count":300,
           "estimated_cost_usd":"12.5","cache_read_tokens":0,
           "cache_creation_tokens":0,"cache_savings_usd":"0"},
          {"model":"claude-haiku-4-5","total_prompt_tokens":100000,
           "total_completion_tokens":20000,"request_count":120,
           "estimated_cost_usd":"3.25","cache_read_tokens":0,
           "cache_creation_tokens":0,"cache_savings_usd":"0"}
        ]}"#;
}
