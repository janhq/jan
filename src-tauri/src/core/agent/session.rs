//! Session-level budget caps for the agent loop. Tracks cumulative token usage
//! across turns and signals when a configured ceiling is reached.

use crate::core::agent::events::Usage;

#[derive(Debug, Default)]
pub(crate) struct SessionBudget {
    max_tokens: Option<u64>,
    spent_tokens: u64,
}

impl SessionBudget {
    pub(crate) fn new(max_tokens: Option<u64>) -> Self {
        Self {
            max_tokens,
            spent_tokens: 0,
        }
    }

    /// Fold a completion's usage into the running total, returning the new total.
    pub(crate) fn record(&mut self, usage: &Option<Usage>) -> u64 {
        if let Some(total) = usage.as_ref().and_then(|u| u.total_tokens) {
            self.spent_tokens = self.spent_tokens.saturating_add(total);
        }
        self.spent_tokens
    }

    pub(crate) fn spent(&self) -> u64 {
        self.spent_tokens
    }

    /// True only when a ceiling is configured and has been reached or exceeded.
    pub(crate) fn exhausted(&self) -> bool {
        matches!(self.max_tokens, Some(max) if self.spent_tokens >= max)
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
        })
    }

    #[test]
    fn no_ceiling_is_never_exhausted() {
        let mut b = SessionBudget::new(None);
        assert_eq!(b.record(&usage(Some(1_000_000))), 1_000_000);
        assert!(!b.exhausted());
    }

    #[test]
    fn accumulates_and_exhausts_at_or_over_ceiling() {
        let mut b = SessionBudget::new(Some(100));
        b.record(&usage(Some(60)));
        assert!(!b.exhausted());
        b.record(&usage(Some(40)));
        assert!(b.exhausted());
        assert_eq!(b.spent(), 100);
    }

    #[test]
    fn absent_usage_does_not_advance_spend() {
        let mut b = SessionBudget::new(Some(10));
        assert_eq!(b.record(&None), 0);
        assert!(!b.exhausted());
    }
}
