//! Routes known to reject a resent `reasoning_content` field.
//!
//! A strict OpenAI-compatible endpoint refuses the whole request when an
//! assistant turn carries the DeepSeek `reasoning_content` extension. The turn
//! loop discovers that from the rejection and retries without the field (see
//! `run_turn_cycle`). Without a memory, every later run, every subagent and
//! every resumed session would rediscover it the same way, paying a rejected
//! round trip each time. Once a route has rejected the field, it is recorded
//! here per (provider, model) so later requests on that route never carry it.
//!
//! The answer lives in process memory for the session and, in the CLI build,
//! in `~/.jan/model_catalog.json` beside the other learned per-model metadata,
//! so a later process starts with it too. Deleting that cache forgets it. A
//! route that has never rejected the field is unaffected: it keeps receiving
//! reasoning exactly as before.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

/// `(provider, bare model id)`. The provider is empty when the model resolved
/// to none.
type Route = (String, String);

/// Every route asked about so far: `true` when it rejects the field. A `false`
/// entry only memoizes the disk lookup, so a route is read from the cache at
/// most once per process.
static ROUTES: LazyLock<Mutex<HashMap<Route, bool>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// The key for `model_id` served by `provider`. A `<provider>/` qualifier on
/// the id names the same route as the bare id, so it is stripped.
fn route(provider: Option<&str>, model_id: &str) -> Route {
    let provider = provider.unwrap_or("").trim();
    let model = if provider.is_empty() {
        model_id
    } else {
        model_id
            .strip_prefix(provider)
            .and_then(|rest| rest.strip_prefix('/'))
            .unwrap_or(model_id)
    };
    (provider.to_string(), model.to_string())
}

/// Whether `model_id` on `provider` is known to reject `reasoning_content`.
pub(crate) fn rejects(provider: Option<&str>, model_id: &str) -> bool {
    let key = route(provider, model_id);
    let mut routes = ROUTES.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(known) = routes.get(&key) {
        return *known;
    }
    let persisted = persisted_rejects(&key);
    routes.insert(key, persisted);
    persisted
}

/// Record that `model_id` on `provider` rejected `reasoning_content`, for the
/// rest of this process and, where there is a catalog, for later ones.
pub(crate) fn remember(provider: Option<&str>, model_id: &str) {
    let key = route(provider, model_id);
    let newly = {
        let mut routes = ROUTES.lock().unwrap_or_else(|e| e.into_inner());
        routes.insert(key.clone(), true) != Some(true)
    };
    if newly {
        persist(&key);
    }
}

#[cfg(feature = "cli")]
fn persisted_rejects((provider, model): &Route) -> bool {
    crate::core::cli::model_catalog::load().rejects_reasoning(provider, model)
}

/// No catalog outside the CLI build: the answer lasts for the process.
#[cfg(not(feature = "cli"))]
fn persisted_rejects(_route: &Route) -> bool {
    false
}

/// Best effort: a cache that cannot be written only costs a later process one
/// rejected request, so it never fails the run.
#[cfg(feature = "cli")]
fn persist((provider, model): &Route) {
    let mut catalog = crate::core::cli::model_catalog::load();
    if catalog.remember_reasoning_rejected(provider, model) {
        if let Err(e) = catalog.save() {
            log::warn!("could not record that {provider}/{model} rejects reasoning_content: {e}");
        }
    }
}

#[cfg(not(feature = "cli"))]
fn persist(_route: &Route) {}

#[cfg(test)]
mod tests {
    use super::*;

    /// The memory is process-wide, so each test names routes nobody else uses.
    #[test]
    fn a_remembered_rejection_is_scoped_to_its_provider_and_model() {
        let provider = Some("rr-scope-provider");
        assert!(!rejects(provider, "rr-scope-model"));
        remember(provider, "rr-scope-model");
        assert!(rejects(provider, "rr-scope-model"));
        assert!(
            rejects(provider, "rr-scope-provider/rr-scope-model"),
            "a provider-qualified id names the same route"
        );
        assert!(!rejects(provider, "rr-scope-other-model"));
        assert!(!rejects(Some("rr-scope-other-provider"), "rr-scope-model"));
        assert!(!rejects(None, "rr-scope-model"));
    }

    /// A route that rejected the field in an earlier process starts this one
    /// already knowing it.
    #[cfg(feature = "cli")]
    #[test]
    fn a_rejection_persisted_by_an_earlier_process_is_honored() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let mut catalog = crate::core::cli::model_catalog::load();
            assert!(catalog.remember_reasoning_rejected("rr-disk-provider", "rr-disk-model"));
            catalog.save().expect("save");
            assert!(rejects(Some("rr-disk-provider"), "rr-disk-model"));
            assert!(!rejects(Some("rr-disk-provider"), "rr-disk-other"));
        });
    }

    /// Remembering writes through to the catalog, so the next process sees it.
    #[cfg(feature = "cli")]
    #[test]
    fn remembering_a_rejection_persists_it() {
        crate::core::agent::global_config::with_temp_home(|_| {
            remember(Some("rr-persist-provider"), "rr-persist-provider/rr-persist-model");
            assert!(crate::core::cli::model_catalog::load()
                .rejects_reasoning("rr-persist-provider", "rr-persist-model"));
        });
    }
}
