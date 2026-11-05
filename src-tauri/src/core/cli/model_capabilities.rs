//! The CLI's side of context-window resolution: what a provider's cached
//! `/models` listing reported. The pure resolver it feeds lives in
//! [`crate::core::agent::model_window`], where the desktop can reach it too.

pub(crate) use crate::core::agent::model_window::{
    resolve_context_window, ContextWindowSource, ResolvedContextWindow,
};

/// The window the provider itself reported for `model_id`, from the cached
/// `/models` listing. `None` when nothing was cached (a plain
/// OpenAI-compatible endpoint reports only ids) or the model is unknown to it.
///
/// `provider` is the one that will actually serve the request: two gateways can
/// list the same id with different deployments, so an unqualified lookup can
/// report a window the request will not get.
pub(crate) fn reported_window(provider: Option<&str>, model_id: &str) -> Option<u64> {
    super::model_catalog::effective()
        .get(provider, model_id)
        .and_then(|info| info.context_length)
        .filter(|tokens| *tokens > 0)
}

