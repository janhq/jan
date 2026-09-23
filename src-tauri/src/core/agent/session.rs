//! Session-level budget caps for the agent loop. Tracks cumulative token usage
//! across turns and signals when a configured ceiling is reached.
//!
//! Two ceilings live here and they are not the same kind of thing. The token
//! ceiling is *marginal*: replayed context is not recharged each turn, because
//! it measures how much new work a run is doing. The money ceiling is
//! *cumulative*, because a provider bills the whole prompt it is resent on
//! every request -- so the run's actual charge is the sum over requests, and
//! costing it marginally would understate a long tool-calling run by exactly
//! the factor that makes such runs expensive.

use crate::core::agent::events::Usage;

/// What a provider charges per token, in USD. The rates a run started with,
/// snapshotted: a money ceiling is enforced against the prices the user was
/// shown when they set it, not against a listing refetched mid-run.
///
/// Lives here rather than beside the model catalog it is read from because the
/// agent loop -- which is not `cli`-gated -- is what enforces the ceiling, and
/// the catalog is gated. `cli::model_catalog::ModelInfo` delegates to this, so
/// there is one formula rather than a second one that drifts.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TokenRates {
    pub prompt_usd: f64,
    pub completion_usd: f64,
    /// A rate the provider did not publish falls back to the prompt rate, which
    /// is what a prompt/completion-only price list already charges.
    pub cache_read_usd: Option<f64>,
    pub cache_write_usd: Option<f64>,
}

impl TokenRates {
    /// USD for one request's token counts.
    ///
    /// `cached` and `cache_write` are **shares of `prompt`**, not additions to
    /// it: every pipeline that reaches here normalizes Anthropic's usage the
    /// OpenAI way, so `prompt_tokens = input + cache_read + cache_write` (genai
    /// `anthropic/adapter_shared.rs`, and `core::server::converters` for Jan's
    /// own responses). Each share is billed at its own rate and the remainder
    /// at the prompt rate.
    pub fn cost_usd(&self, prompt: u64, completion: u64, cached: u64, cache_write: u64) -> f64 {
        // Clamped so a provider reporting a share larger than the prompt (or
        // two shares that together exceed it) cannot underflow the remainder.
        let cached = cached.min(prompt);
        let written = cache_write.min(prompt - cached);
        let fresh = prompt - cached - written;
        fresh as f64 * self.prompt_usd
            + cached as f64 * self.cache_read_usd.unwrap_or(self.prompt_usd)
            + written as f64 * self.cache_write_usd.unwrap_or(self.prompt_usd)
            + completion as f64 * self.completion_usd
    }

    /// USD for one reported usage record. An omitted count contributes nothing
    /// rather than being guessed at.
    fn cost_of(&self, usage: &Usage) -> f64 {
        self.cost_usd(
            usage.prompt_tokens.unwrap_or(0),
            usage.completion_tokens.unwrap_or(0),
            usage.cached_tokens.unwrap_or(0),
            usage.cache_write_tokens.unwrap_or(0),
        )
    }
}

/// A run's money ceiling: the rates to charge at, and the limit to stop at.
/// Both or neither -- a ceiling with no rates cannot be enforced, and the CLI
/// refuses such a run up front rather than letting it proceed uncapped.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CostCeiling {
    pub rates: TokenRates,
    pub max_usd: f64,
}

#[derive(Debug, Default)]
pub(crate) struct SessionBudget {
    max_tokens: Option<u64>,
    spent_tokens: u64,
    last_total: u64,
    last_prompt: Option<u64>,
    /// `None` leaves money unmetered, which is the default: without published
    /// prices there is no honest number to meter against.
    ceiling: Option<CostCeiling>,
    spent_usd: f64,
}

impl SessionBudget {
    pub(crate) fn new(max_tokens: Option<u64>) -> Self {
        Self {
            max_tokens,
            spent_tokens: 0,
            last_total: 0,
            last_prompt: None,
            ceiling: None,
            spent_usd: 0.0,
        }
    }

    /// Meter this run's spend against a money ceiling.
    pub(crate) fn with_cost_ceiling(mut self, ceiling: Option<CostCeiling>) -> Self {
        self.ceiling = ceiling;
        self
    }

    /// Fold a completion's usage into the running total, returning the new total.
    ///
    /// Counts new completion tokens and positive prompt-token growth rather than
    /// replayed prompt history. The first request uses its reported total as the
    /// baseline. When providers omit prompt or completion fields, the total-token
    /// delta remains the fallback.
    pub(crate) fn record(&mut self, usage: &Option<Usage>) -> u64 {
        let Some(usage) = usage.as_ref() else {
            return self.spent_tokens;
        };

        let delta = match usage.total_tokens {
            Some(total) => {
                let delta = match (
                    usage.prompt_tokens,
                    self.last_prompt,
                    usage.completion_tokens,
                ) {
                    (Some(prompt), Some(last_prompt), Some(completion)) => {
                        completion.saturating_add(prompt.saturating_sub(last_prompt))
                    }
                    (Some(_), None, _) => total,
                    (_, Some(_), Some(completion)) => {
                        completion.max(total.saturating_sub(self.last_total))
                    }
                    _ => total.saturating_sub(self.last_total),
                };
                self.last_total = total;
                delta
            }
            None => usage.completion_tokens.unwrap_or(0),
        };

        self.last_prompt = usage.prompt_tokens.or(self.last_prompt);
        self.spent_tokens = self.spent_tokens.saturating_add(delta);
        // Money is charged on the request as billed -- the whole prompt, every
        // time -- rather than on the marginal `delta` above.
        if let Some(ceiling) = &self.ceiling {
            self.spent_usd += ceiling.rates.cost_of(usage);
        }
        self.spent_tokens
    }

    /// Charge a request that is not part of the conversation being replayed --
    /// today, the compaction summarizer.
    ///
    /// Money is charged in full, exactly as the provider bills it: this is a
    /// paid request, and a turn can make several of them (the preflight
    /// compaction plus each overflow retry), so leaving them out would let a
    /// run spend past its ceiling while the ceiling read as unreached.
    ///
    /// Tokens count the completion only, and the prompt baseline is left alone.
    /// [`Self::record`] meters the conversation's *marginal* growth by
    /// comparing each request's prompt against the last one's; a side request
    /// carries a different prompt entirely (a rendered transcript), so letting
    /// it set that baseline would make the next real turn's growth arbitrary.
    pub(crate) fn record_side_request(&mut self, usage: &Option<Usage>) {
        let Some(usage) = usage.as_ref() else {
            return;
        };
        self.spent_tokens = self
            .spent_tokens
            .saturating_add(usage.completion_tokens.unwrap_or(0));
        if let Some(ceiling) = &self.ceiling {
            self.spent_usd += ceiling.rates.cost_of(usage);
        }
    }

    pub(crate) fn spent(&self) -> u64 {
        self.spent_tokens
    }

    /// USD charged so far, or `None` when this run meters no money at all --
    /// which is not the same as having spent nothing.
    pub(crate) fn spent_usd(&self) -> Option<f64> {
        self.ceiling.is_some().then_some(self.spent_usd)
    }

    pub(crate) fn max_usd(&self) -> Option<f64> {
        self.ceiling.as_ref().map(|c| c.max_usd)
    }

    /// True only when a token ceiling is configured and has been reached or
    /// exceeded. Advisory: the run carries on past it.
    pub(crate) fn exhausted(&self) -> bool {
        matches!(self.max_tokens, Some(max) if self.spent_tokens >= max)
    }

    /// True once the money ceiling is reached. Unlike [`Self::exhausted`] this
    /// **stops the run**: the user named a sum they were willing to spend, and
    /// a ceiling that only filed a note would let a loop spend past it without
    /// limit.
    ///
    /// Checked after a request rather than before, because the cost of a
    /// request is not known until the provider reports its usage. The overshoot
    /// is therefore bounded by the requests made between two checks, which is
    /// the tightest bound available to a caller that cannot price a completion
    /// it has not yet received. That is the metered dispatch plus any
    /// compactions the same turn made -- all of them charged (see
    /// [`Self::record_side_request`]), so the ceiling is never read as unreached
    /// because of spend nobody counted.
    pub(crate) fn over_cost_ceiling(&self) -> bool {
        matches!(self.ceiling, Some(c) if self.spent_usd >= c.max_usd)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::agent::events::Usage;

    fn usage(total: Option<u64>) -> Option<Usage> {
        Some(Usage {
            prompt_tokens: None,
            completion_tokens: None,
            total_tokens: total,
            ..Default::default()
        })
    }

    fn usage_with_parts(
        prompt_tokens: u64,
        completion_tokens: u64,
        total_tokens: u64,
    ) -> Option<Usage> {
        Some(Usage {
            prompt_tokens: Some(prompt_tokens),
            completion_tokens: Some(completion_tokens),
            total_tokens: Some(total_tokens),
            ..Default::default()
        })
    }

    #[test]
    fn compaction_still_charges_completion_tokens() {
        let mut b = SessionBudget::new(Some(1_100));
        b.record(&usage_with_parts(900, 100, 1_000));
        assert!(!b.exhausted());

        // The compacted prompt is smaller, but this request still consumed
        // another 100 completion tokens and must exhaust the session budget.
        b.record(&usage_with_parts(400, 100, 500));
        assert_eq!(b.spent(), 1_100);
        assert!(b.exhausted());
    }

    #[test]
    fn no_ceiling_is_never_exhausted() {
        let mut b = SessionBudget::new(None);
        assert_eq!(b.record(&usage(Some(1_000_000))), 1_000_000);
        assert!(!b.exhausted());
    }

    #[test]
    fn accumulates_marginal_spend_and_exhausts_at_or_over_ceiling() {
        let mut b = SessionBudget::new(Some(100));
        // First request counts its full total, since there is no baseline yet.
        b.record(&usage(Some(60)));
        assert!(!b.exhausted());
        // Context grew by only a little between requests, so only the marginal
        // increase counts — the replayed prior history must not be double-charged.
        b.record(&usage(Some(64)));
        assert_eq!(b.spent(), 64);
        assert!(!b.exhausted());
        // A big single-request increase (e.g. a large new completion) trips it.
        b.record(&usage(Some(200)));
        assert_eq!(b.spent(), 200);
        assert!(b.exhausted());
    }

    #[test]
    fn compaction_does_not_refund_or_double_charge_spend() {
        let mut b = SessionBudget::new(Some(100));
        b.record(&usage(Some(60)));
        b.record(&usage(Some(90)));
        assert_eq!(b.spent(), 90);
        // Compaction shrinks the replay below the last total; must not refund, and
        // later small growth is counted from the compacted baseline.
        b.record(&usage(Some(70)));
        assert_eq!(b.spent(), 90);
        b.record(&usage(Some(80)));
        assert_eq!(b.spent(), 100);
        assert!(b.exhausted());
    }

    fn rates() -> TokenRates {
        TokenRates {
            prompt_usd: 1e-6,
            completion_usd: 10e-6,
            cache_read_usd: None,
            cache_write_usd: None,
        }
    }

    fn capped(max_usd: f64) -> SessionBudget {
        SessionBudget::new(None).with_cost_ceiling(Some(CostCeiling {
            rates: rates(),
            max_usd,
        }))
    }

    /// Money is cumulative where tokens are marginal. A provider bills the whole
    /// prompt it is resent on every request, so a run that replays a large
    /// context over many turns is charged for it every time -- costing it the
    /// way `spent_tokens` is counted would understate exactly the runs that get
    /// expensive.
    #[test]
    fn cost_charges_every_request_for_the_whole_prompt() {
        let mut b = capped(1.0);
        // Three turns replaying a 10K prompt: marginally almost nothing new,
        // but billed three times over.
        b.record(&usage_with_parts(10_000, 100, 10_100));
        b.record(&usage_with_parts(10_100, 100, 10_200));
        b.record(&usage_with_parts(10_200, 100, 10_300));
        let spent = b.spent_usd().expect("metered");
        assert!(
            (spent - (30_300.0 * 1e-6 + 300.0 * 10e-6)).abs() < 1e-9,
            "every request pays for its whole prompt: {spent}"
        );
        // Marginal token spend over the same three turns is a third of the 30K
        // tokens actually billed: the baseline plus 100 new completion and 100
        // prompt-growth tokens a turn. The two ceilings measure different
        // things, which is why money could not simply be priced off `spent()`.
        assert_eq!(b.spent(), 10_500);
    }

    /// An unmetered run reports `None`, not `0.0`. "This run tracks no money"
    /// and "this run has spent nothing" are different answers, and a surface
    /// that renders the second for the first would show a $0.00 spend for a run
    /// that is in fact spending.
    #[test]
    fn an_unmetered_run_reports_no_cost_rather_than_zero() {
        let mut b = SessionBudget::new(Some(100));
        b.record(&usage_with_parts(10_000, 500, 10_500));
        assert_eq!(b.spent_usd(), None);
        assert_eq!(b.max_usd(), None);
        assert!(!b.over_cost_ceiling(), "nothing to be over");
    }

    /// The ceiling trips at or past the limit, and only then.
    #[test]
    fn the_cost_ceiling_trips_once_spend_reaches_it() {
        // 100K prompt at $1/M plus 10K completion at $10/M = $0.20 a request.
        let mut b = capped(0.5);
        b.record(&usage_with_parts(100_000, 10_000, 110_000));
        assert!(!b.over_cost_ceiling(), "$0.20 of $0.50");
        b.record(&usage_with_parts(100_000, 10_000, 110_000));
        assert!(!b.over_cost_ceiling(), "$0.40 of $0.50");
        b.record(&usage_with_parts(100_000, 10_000, 110_000));
        assert!(b.over_cost_ceiling(), "$0.60 is past $0.50");
    }

    /// A compaction is a paid request, and a turn can make several of them (the
    /// preflight plus each overflow retry). Spend the budget never saw would let
    /// a run go past its ceiling while `/usage` and the ceiling agreed with each
    /// other about a figure that was simply too low.
    #[test]
    fn a_side_request_is_charged_without_moving_the_prompt_baseline() {
        let mut b = capped(1.0);
        b.record(&usage_with_parts(100_000, 10_000, 110_000));
        let after_turn = b.spent_usd().expect("metered");

        // A summarizer call: its own prompt, its own completion, all billed.
        b.record_side_request(&usage_with_parts(20_000, 500, 20_500));
        let charged = b.spent_usd().expect("metered") - after_turn;
        let expected = 20_000.0 * 1e-6 + 500.0 * 10e-6;
        assert!((charged - expected).abs() < 1e-12, "{charged} != {expected}");

        // The next real turn's marginal token spend is still measured against
        // the conversation's own last prompt (100K), not the summarizer's 20K:
        // a side request replays a different prompt entirely, so letting it set
        // that baseline would make the next turn's growth arbitrary.
        b.record(&usage_with_parts(100_100, 200, 100_300));
        assert_eq!(
            b.spent(),
            110_000 + 500 + 300,
            "the turn after a side request grows by 100 prompt + 200 completion"
        );
    }

    /// An unmetered run charges a side request nothing and reports nothing,
    /// exactly as it does for an ordinary one.
    #[test]
    fn a_side_request_on_an_unmetered_run_stays_unmetered() {
        let mut b = SessionBudget::new(None);
        b.record_side_request(&usage_with_parts(1_000, 100, 1_100));
        assert_eq!(b.spent_usd(), None);
        assert_eq!(b.spent(), 100);
    }

    /// A `0` ceiling is honest rather than a synonym for unbounded -- which is
    /// what `max_tokens` means by `0`, so the two must not be confused. Asking
    /// to spend nothing stops at the first billed request.
    #[test]
    fn a_zero_ceiling_stops_at_the_first_billed_request() {
        let mut b = capped(0.0);
        assert!(b.over_cost_ceiling(), "zero is reached before anything runs");
        b.record(&usage_with_parts(10, 1, 11));
        assert!(b.over_cost_ceiling());
    }

    /// Cache shares are billed at their own rates and come *out of* the prompt,
    /// never on top of it: the pipelines normalize Anthropic's usage the OpenAI
    /// way, so `prompt = fresh + cache_read + cache_write`. Adding them would
    /// double-charge a cached prompt, which is the case caching exists to make
    /// cheaper.
    #[test]
    fn cache_shares_come_out_of_the_prompt_at_their_own_rates() {
        let r = TokenRates {
            prompt_usd: 10e-6,
            completion_usd: 0.0,
            cache_read_usd: Some(1e-6),
            cache_write_usd: Some(20e-6),
        };
        // 1000 prompt = 700 fresh + 200 read + 100 written.
        let cost = r.cost_usd(1_000, 0, 200, 100);
        let expected = 700.0 * 10e-6 + 200.0 * 1e-6 + 100.0 * 20e-6;
        assert!((cost - expected).abs() < 1e-12, "{cost} != {expected}");

        // A provider reporting shares larger than the prompt cannot underflow
        // the remainder into a negative charge.
        let clamped = r.cost_usd(100, 0, 900, 900);
        assert!(clamped >= 0.0, "{clamped}");
    }

    /// An unpublished cache rate falls back to the prompt rate, which is what a
    /// prompt/completion-only price list already charges -- not to zero, which
    /// would bill a cached prompt as free.
    #[test]
    fn an_unpublished_cache_rate_bills_at_the_prompt_rate() {
        let r = rates();
        assert_eq!(r.cost_usd(1_000, 0, 400, 0), r.cost_usd(1_000, 0, 0, 0));
    }

    #[test]
    fn absent_usage_does_not_advance_spend() {
        let mut b = SessionBudget::new(Some(10));
        assert_eq!(b.record(&None), 0);
        assert!(!b.exhausted());
    }
}
