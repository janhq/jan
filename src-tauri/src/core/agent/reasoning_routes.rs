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
//! so a later process starts with it too. Deleting that cache (or the
//! provider's `reasoning_rejected` entry in it) forgets it. A
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
    lookup(route(provider, model_id), persisted_rejects)
}

/// The memoized answer for `key`, reading it with `read` the first time.
///
/// The read is a file load, so it runs with [`ROUTES`] released: every run
/// and subagent asks at its start, and holding a process-wide lock across
/// disk I/O would queue routes that are already known behind one that is not.
/// Two first asks may both read; `or_insert` keeps whichever answer landed
/// first, so a `true` from [`remember`] meanwhile is never overwritten by the
/// older value on disk.
fn lookup(key: Route, read: impl FnOnce(&Route) -> bool) -> bool {
    if let Some(known) = ROUTES.lock().unwrap_or_else(|e| e.into_inner()).get(&key) {
        return *known;
    }
    let persisted = read(&key);
    *ROUTES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .entry(key)
        .or_insert(persisted)
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
///
/// Merged into the file under the catalog's write lock
/// ([`crate::core::cli::model_catalog::update`]), so a listing refresh saved
/// meanwhile is kept and keeps this. Called from the turn loop, so inside a
/// runtime the file work goes to the blocking pool rather than stalling an
/// async worker; the path is resolved here first, on the caller's thread.
#[cfg(feature = "cli")]
fn persist(route: &Route) {
    let path = match crate::core::cli::model_catalog::path() {
        Ok(path) => path,
        Err(e) => return log::warn!("could not locate the model catalog: {e}"),
    };
    let (provider, model) = route.clone();
    let write = move || {
        let written = crate::core::cli::model_catalog::update_at(&path, |catalog| {
            catalog.remember_reasoning_rejected(&provider, &model)
        });
        if let Err(e) = written {
            log::warn!("could not record that {provider}/{model} rejects reasoning_content: {e}");
        }
    };
    match tokio::runtime::Handle::try_current() {
        Ok(runtime) => {
            let task = runtime.spawn_blocking(write);
            let mut pending = PENDING.lock().unwrap_or_else(|e| e.into_inner());
            pending.retain(|t| !t.is_finished());
            pending.push(task);
        }
        Err(_) => write(),
    }
}

/// Catalog writes still running on the blocking pool, so a test can wait for
/// them. Finished ones are pruned on each push, so it stays short.
#[cfg(feature = "cli")]
static PENDING: Mutex<Vec<tokio::task::JoinHandle<()>>> = Mutex::new(Vec::new());

/// Wait for every catalog write started so far.
#[cfg(all(test, feature = "cli"))]
async fn settle_persists() {
    let pending = std::mem::take(&mut *PENDING.lock().unwrap_or_else(|e| e.into_inner()));
    for task in pending {
        let _ = task.await;
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

    /// The catalog is read with the lock released: a read that takes the lock
    /// itself (as another route's lookup or a `remember` on another thread
    /// would) does not deadlock, and a rejection recorded meanwhile is not
    /// overwritten by the older value read from disk.
    #[test]
    fn the_persisted_value_is_read_outside_the_lock_and_never_overwrites() {
        let provider = Some("rr-lock-provider");
        let seen = lookup(route(provider, "rr-lock-model"), |_| {
            remember(provider, "rr-lock-model");
            assert!(!lookup(route(provider, "rr-lock-other"), |_| false));
            false
        });
        assert!(seen, "the rejection recorded during the read wins");
        assert!(rejects(provider, "rr-lock-model"));
        assert!(lookup(route(provider, "rr-lock-fresh"), |_| true));
        assert!(lookup(route(provider, "rr-lock-fresh"), |_| false), "read at most once");
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

    /// The write runs off the async worker thread, and merges into the file
    /// rather than replacing it: a listing refresh saved meanwhile keeps the
    /// rejection, and the rejection keeps the refresh.
    #[cfg(feature = "cli")]
    #[test]
    fn a_rejection_recorded_inside_a_runtime_merges_with_other_writes() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
            rt.block_on(async {
                remember(Some("rr-merge-provider"), "rr-merge-model");
                // A listing refresh lands right behind it.
                crate::core::cli::model_catalog::cache_listing(
                    "rr-merge-provider",
                    &serde_json::json!({"data": [{"id": "rr-merge-model", "context_length": 1000}]}),
                );
                settle_persists().await;
            });
            let after = crate::core::cli::model_catalog::load();
            assert!(after.rejects_reasoning("rr-merge-provider", "rr-merge-model"));
            assert!(after.get(Some("rr-merge-provider"), "rr-merge-model").is_some());
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
