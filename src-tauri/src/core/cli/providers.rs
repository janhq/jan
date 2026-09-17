//! Cloud provider credential loader for the CLI.
//!
//! Jan Agent runs standalone, without Jan Desktop, so provider config is
//! resolved from two `.jan` scopes rather than desktop's `settings.json`:
//!
//! 1. Global `~/.jan/config.toml` (user-wide, [`crate::core::agent::global_config`]) - the base.
//! 2. Desktop `settings.json`, if present, is layered in as an **inherit-only**
//!    additive source (never overwrites a Global entry, never written back to).
//! 3. Project-local `agent.toml` `[provider]` override
//!    ([`crate::core::agent::project::ProviderSection`]) - highest of the
//!    three, since it's an explicit per-project choice.
//! 4. `--provider`/`--api-key` CLI flags (+ `JAN_API_KEY`/`{PROVIDER}_API_KEY`
//!    env fallback via [`ProviderOverrides::with_env`]) win over all of the
//!    above - the most explicit, most ephemeral signal.

use std::{collections::HashMap, path::Path, time::Duration};

use crate::core::agent::global_config::load_global_config;
use crate::core::agent::project::ProviderSection;
use crate::core::app::commands::resolve_jan_data_folder;
use crate::core::state::ProviderConfig;

const MODEL_PROVIDER_KEY: &str = "model-provider";
const API_KEY_SETTING_KEYS: [&str; 2] = ["api-key", "api_key"];

/// CLI/env overrides applied after loading the persisted store.
#[derive(Debug, Default, Clone)]
pub struct ProviderOverrides {
    /// Restrict/target a single provider (e.g. `anthropic`).
    pub provider: Option<String>,
    /// API key to inject for `provider` (or all providers when `provider` is None).
    pub api_key: Option<String>,
}

impl ProviderOverrides {
    /// Fold in environment fallbacks for the API key when not set explicitly.
    /// `JAN_API_KEY` wins, then a provider-specific var (`ANTHROPIC_API_KEY`,
    /// `OPENAI_API_KEY`, ...) when a provider is targeted.
    pub fn with_env(mut self) -> Self {
        if self.api_key.is_none() {
            if let Ok(k) = std::env::var("JAN_API_KEY") {
                if !k.is_empty() {
                    self.api_key = Some(k);
                }
            }
        }
        if self.api_key.is_none() {
            if let Some(provider) = &self.provider {
                let var = format!("{}_API_KEY", provider.to_ascii_uppercase());
                if let Ok(k) = std::env::var(&var) {
                    if !k.is_empty() {
                        self.api_key = Some(k);
                    }
                }
            }
        }
        self
    }
}

/// The desktop app's current selection (`state.selectedProvider` /
/// `state.selectedModel.id` in the `model-provider` store), used to default the
/// CLI `--provider`/`--model` when the user gives none.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct DesktopSelection {
    pub provider: Option<String>,
    pub model: Option<String>,
}

/// Read the desktop's selected provider + model from `settings.json`. Missing or
/// malformed data yields an empty selection (no defaults applied).
pub fn desktop_selection() -> DesktopSelection {
    let path = resolve_jan_data_folder().join("settings.json");
    match std::fs::read_to_string(&path) {
        Ok(raw) => parse_selection(&raw),
        Err(_) => DesktopSelection::default(),
    }
}

/// Extract the selection from a `settings.json` body. Tolerant of shape drift.
fn parse_selection(raw: &str) -> DesktopSelection {
    let root: serde_json::Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(_) => return DesktopSelection::default(),
    };
    let blob = match root.get(MODEL_PROVIDER_KEY).and_then(|v| v.as_str()) {
        Some(s) => s,
        None => return DesktopSelection::default(),
    };
    let parsed: serde_json::Value = match serde_json::from_str(blob) {
        Ok(v) => v,
        Err(_) => return DesktopSelection::default(),
    };
    let state = parsed.get("state");
    let non_empty = |v: Option<&serde_json::Value>| {
        v.and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
    };
    DesktopSelection {
        provider: non_empty(state.and_then(|s| s.get("selectedProvider"))),
        model: non_empty(state.and_then(|s| s.get("selectedModel").and_then(|m| m.get("id")))),
    }
}

/// Whether the CLI can actually reach this provider. A populated `base_url` is
/// an HTTP upstream; an empty one means a local engine (llamacpp, llamacpp-rs,
/// mlx) whose endpoint only exists after the desktop app spawns it. The CLI is
/// remote-only, so those entries are dead options and must not be offered.
/// Mirrors the resolution rule in `agent::upstream::resolve_upstream_for_model`,
/// whose local-engine branches are compiled out of this build.
pub fn is_cli_reachable(config: &ProviderConfig) -> bool {
    config.base_url.as_deref().is_some_and(|u| !u.is_empty())
}

/// Which provider serves `model`, by the same deterministic rule
/// `agent::upstream::resolve_upstream_for_model` routes by: an explicit
/// `<provider>/<model>` prefix, else the reachable credentialed provider
/// offering the bare id, else any provider offering it. `None` when none does.
///
/// Sync and lock-free (the caller holds the map), so a render path or a price
/// lookup can ask without awaiting the upstream resolver.
pub fn provider_for_model(model: &str, pc: &HashMap<String, ProviderConfig>) -> Option<String> {
    if let Some(sep) = model.find('/') {
        if pc.contains_key(&model[..sep]) {
            return Some(model[..sep].to_string());
        }
    }
    let offers = |c: &&ProviderConfig| c.models.iter().any(|m| m == model);
    pc.iter()
        .filter(|(_, c)| is_cli_reachable(c) && offers(c))
        .min_by_key(|(name, c)| (std::cmp::Reverse(c.api_key.is_some()), (*name).clone()))
        .or_else(|| pc.iter().find(|(_, c)| offers(c)))
        .map(|(name, _)| name.clone())
}

/// Log a provider-config load failure at most once per process. Startup probes
/// this in two independent places (the headless sign-in guard and the model
/// fallback), and a malformed `~/.jan/config.toml` fails both, so without this
/// the same multi-line TOML error is printed twice before the fatal error
/// prints it a third time.
fn warn_load_failure_once(context: &str, err: &str) {
    static LOGGED: std::sync::Once = std::sync::Once::new();
    LOGGED.call_once(|| log::warn!("could not load provider configs{context}: {err}"));
}

/// Whether this install can run a turn at all: some provider is reachable and
/// either credentialed or local (a self-hosted endpoint - typically the desktop
/// app's API server - needs no key). `false` is the fresh-install state that
/// triggers the sign-in flow. A remote entry with no key does not count: the
/// request would only fail later with a 401.
pub fn has_usable_provider(project_root: Option<&std::path::Path>) -> bool {
    let overrides = ProviderOverrides::default().with_env();
    match load_provider_configs(project_root, &overrides) {
        Ok(configs) => configs.values().any(is_usable),
        Err(e) => {
            warn_load_failure_once("", &e);
            false
        }
    }
}

/// Whether `provider` has a stored credential or resolves to a usable config.
pub fn provider_is_signed_in(project_root: Option<&Path>, provider: &str) -> bool {
    if matches!(
        crate::core::cli::auth::CredentialStore::load(provider),
        Ok(Some(_))
    ) {
        return true;
    }

    let overrides = ProviderOverrides {
        provider: Some(provider.to_string()),
        api_key: None,
    }
    .with_env();

    load_provider_configs(project_root, &overrides)
        .ok()
        .and_then(|configs| configs.get(provider).map(is_usable))
        .unwrap_or(false)
}

fn is_usable(config: &ProviderConfig) -> bool {
    if !is_cli_reachable(config) {
        return false;
    }
    has_credential(config) || config.base_url.as_deref().is_some_and(is_loopback_url)
}

/// Whether a base URL points at this machine, where an API key is usually not
/// required. Host-only match (no DNS): anything else is treated as remote.
pub(crate) fn is_loopback_url(url: &str) -> bool {
    let authority = url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(url)
        .split('/')
        .next()
        .unwrap_or("");
    // Bracketed IPv6 keeps its colons; everything else splits off the port.
    let host = match authority.strip_prefix('[') {
        Some(rest) => rest.split(']').next().unwrap_or(""),
        None => authority.split(':').next().unwrap_or(""),
    };
    matches!(host, "localhost" | "127.0.0.1" | "0.0.0.0" | "::1")
}

/// `(provider, model_id)` pairs the CLI can actually run: Tokamak first, then
/// every other provider by name, models sorted within each.
///
/// Tokamak leads because it is the provider the product signs users in to; a
/// plain alphabetical sort buried it below whatever else happened to be
/// configured. Ordering only -- nothing is filtered by provider, so a user who
/// prefers another provider still sees it.
pub fn reachable_models(configs: &HashMap<String, ProviderConfig>) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = configs
        .values()
        .filter(|c| is_cli_reachable(c))
        .flat_map(|c| c.models.iter().map(|m| (c.provider.clone(), m.clone())))
        .collect();
    // `false < true`, so the Tokamak rows sort ahead of everything else while
    // the rest stay alphabetical.
    out.sort_by(|a, b| {
        let key = |(provider, model): &(String, String)| {
            (
                provider != super::tokamak::PROVIDER,
                provider.clone(),
                model.clone(),
            )
        };
        key(a).cmp(&key(b))
    });
    out
}

/// Name of the local-engine provider serving `model_id` when **no** reachable
/// provider offers it, so the caller can reject the run up front instead of
/// failing at upstream resolution. Lookup mirrors
/// `agent::upstream::resolve_upstream_for_model`: an exact hit in a provider's
/// `models` list, or a `<provider>/<model>` prefix.
///
/// `None` for a model nobody claims: provider `models` lists are routinely
/// incomplete (custom deployments, freshly released ids), so an unknown id must
/// still fall through to normal resolution rather than be rejected here.
pub fn unreachable_local_provider(
    configs: &HashMap<String, ProviderConfig>,
    model_id: &str,
) -> Option<String> {
    let offering = |c: &&ProviderConfig| c.models.iter().any(|m| m == model_id);
    if configs.values().filter(offering).any(is_cli_reachable) {
        return None;
    }
    if let Some(local) = configs.values().find(|c| offering(c)) {
        return Some(local.provider.clone());
    }

    let prefix = model_id.split_once('/')?.0;
    configs
        .get(prefix)
        .filter(|c| !is_cli_reachable(c))
        .map(|c| c.provider.clone())
}

/// Runnable `(provider, model_id)` pairs for the TUI `/model` selector, taken
/// from the same layered resolution the agent uses -- so the picker offers
/// exactly what a run can reach, including `~/.jan/config.toml` providers the
/// desktop store knows nothing about.
pub fn list_provider_models(project_root: Option<&std::path::Path>) -> Vec<(String, String)> {
    match load_provider_configs(project_root, &ProviderOverrides::default().with_env()) {
        Ok(configs) => reachable_models(&configs),
        Err(e) => {
            warn_load_failure_once(" for the model picker", &e);
            Vec::new()
        }
    }
}

/// One provider's model-list probe outcome, for the caller to report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderModels {
    pub provider: String,
    /// How many ids are configured for this provider after the probe.
    pub models: usize,
    /// Whether that differed from what was already configured. A refresh that
    /// changes nothing is worth saying so rather than reading as a no-op.
    pub changed: bool,
    /// Configured ids the endpoint did not list, which an additive probe keeps.
    /// Reported rather than dropped: see [`Roster::Additive`].
    pub kept_unlisted: usize,
}

/// What a probe does with configured ids the endpoint did not list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Roster {
    /// The answer is the roster: an id it omits is dropped. Only the explicit
    /// refresh, which the user asked for and whose summary reports the result.
    Replace,
    /// New ids are added and configured ones are kept. Merely opening `/model`
    /// runs a probe, and a permission-scoped or paginated `/models` answering
    /// with a subset must not delete a hand-added alias from
    /// `~/.jan/config.toml` with no confirmation and no way to re-add it.
    Additive,
}

/// What a model-list probe did across every provider it touched.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ModelRefresh {
    /// Providers whose endpoint answered, in name order.
    pub listed: Vec<ProviderModels>,
    /// `(provider, reason)` for each endpoint that could not be listed. Never
    /// fatal: one dead credential must not block the rest.
    pub failed: Vec<(String, String)>,
    /// `default_model`, when this refresh is what stopped a provider from
    /// offering it. A retired model otherwise surfaces as a 404 on the next
    /// run, with nothing to connect it to the refresh that dropped it.
    pub retired_default: Option<String>,
}

impl ModelRefresh {
    /// Whether anything was written to disk.
    pub fn changed_any(&self) -> bool {
        self.listed.iter().any(|p| p.changed)
    }

    /// One-line summary for a note or a terminal line.
    pub fn summary(&self) -> String {
        let mut parts: Vec<String> = self
            .listed
            .iter()
            .map(|p| {
                let suffix = if p.changed { "" } else { ", unchanged" };
                let plural = if p.models == 1 { "" } else { "s" };
                let kept = if p.kept_unlisted > 0 {
                    format!(
                        ", {} kept but no longer listed - `jan cli models refresh` drops them",
                        p.kept_unlisted
                    )
                } else {
                    String::new()
                };
                format!("{}: {} model{plural}{suffix}{kept}", p.provider, p.models)
            })
            .collect();
        parts.extend(
            self.failed
                .iter()
                .map(|(provider, reason)| format!("{provider}: {reason}")),
        );
        if let Some(model) = &self.retired_default {
            parts.push(format!(
                "default model '{model}' is no longer offered - select a different model"
            ));
        }
        if parts.is_empty() {
            "no providers to refresh".to_string()
        } else {
            parts.join(" · ")
        }
    }
}

/// Re-list every reachable provider that has not been probed yet this session,
/// **adding** what its endpoint serves now to the stored model list. This is
/// what `/model` runs on its first open: a roster captured at sign-in goes stale
/// as a router-style endpoint gains and retires models, and the picker is where
/// that is noticed.
///
/// Additive because the user only asked to *see* the picker: a subset answer
/// (a permission-scoped key, a paginated gateway) would otherwise delete
/// configured ids unprompted. Dropping one is [`refresh_models`]'s job.
///
/// `already_probed` records which `(provider, base_url)` pairs were queried, so
/// each is touched at most once per session -- a dead upstream must not cost the
/// picker its full request timeout on every open. The explicit
/// [`refresh_models`] has no such guard.
pub async fn refresh_models_once(
    project_root: Option<&std::path::Path>,
    already_probed: &mut std::collections::HashSet<String>,
) -> Result<ModelRefresh, String> {
    probe_models(project_root, Roster::Additive, |config| {
        mark_probed(already_probed, config)
    })
    .await
}

/// Re-list every reachable provider (or just `provider`) and rewrite its model
/// list, **replacing** a configured one. This is the explicit "my provider added
/// models since I signed in" action -- a router-style endpoint gains and retires
/// models continuously, and nothing else in the CLI ever re-reads `/models`
/// after the list is first populated.
///
/// Unlike [`refresh_models_once`] there is no once-per-session guard: the user
/// asked. Per-model metadata (`context_length`, pricing) is cached alongside in
/// `~/.jan/model_catalog.json` -- see [`super::model_catalog`].
pub async fn refresh_models(
    project_root: Option<&std::path::Path>,
    provider: Option<&str>,
) -> Result<ModelRefresh, String> {
    let mut refresh = probe_models(project_root, Roster::Replace, |config| {
        provider.is_none_or(|name| config.provider == name)
    })
    .await?;
    // A `--provider` that matched nothing is a failed refresh, not an empty
    // one: without this the caller prints "no providers to refresh" and exits
    // 0, so a typo (or a Desktop-inherited name, which has no entry in
    // `~/.jan/config.toml` to rewrite) reads to a script as a complete refresh.
    if let Some(name) = provider {
        if refresh.listed.is_empty() && refresh.failed.is_empty() {
            refresh
                .failed
                .push((name.to_string(), unrefreshable_reason(project_root, name)));
        }
    }
    Ok(refresh)
}

/// Why `provider` could not be refreshed, for the report above. Reads only
/// local config: the endpoint was never reached.
fn unrefreshable_reason(project_root: Option<&std::path::Path>, provider: &str) -> String {
    let known = load_provider_configs(project_root, &ProviderOverrides::default().with_env())
        .ok()
        .and_then(|configs| configs.get(provider).cloned());
    let Some(config) = known else {
        return "not a configured provider".to_string();
    };
    if !is_cli_reachable(&config) {
        return "no base_url, so the CLI cannot reach it".to_string();
    }
    match load_global_config() {
        Ok(global) if !global.contains_key(provider) => {
            "inherited from Jan Desktop, so there is no ~/.jan/config.toml entry to refresh"
                .to_string()
        }
        _ => "could not be listed".to_string(),
    }
}

/// Record `config` in the once-per-session probe set, answering whether it had
/// not been probed yet.
fn mark_probed(
    already_probed: &mut std::collections::HashSet<String>,
    config: &ProviderConfig,
) -> bool {
    let tag = format!(
        "{}|{}",
        config.provider,
        config.base_url.clone().unwrap_or_default()
    );
    already_probed.insert(tag)
}

/// Query `GET {base_url}/models` for every reachable global provider `select`
/// accepts, and persist what comes back: ids into `~/.jan/config.toml` and
/// per-model metadata into the model catalog.
///
/// Only providers present in the global store are touched -- writing a
/// models-only entry for a Desktop-inherited provider would shadow it. An
/// endpoint that cannot be listed is reported in [`ModelRefresh::failed`] rather
/// than failing the call, so one dead credential never blocks the others.
async fn probe_models(
    project_root: Option<&std::path::Path>,
    roster: Roster,
    mut select: impl FnMut(&ProviderConfig) -> bool,
) -> Result<ModelRefresh, String> {
    let global = load_global_config()?;
    let configs = load_provider_configs(project_root, &ProviderOverrides::default().with_env())?;
    let mut to_fetch: Vec<(ProviderConfig, Vec<String>)> = configs
        .values()
        .filter(|c| global.contains_key(&c.provider) && is_cli_reachable(c))
        // Filtered before the key is fetched so a re-open cannot re-prompt for
        // a provider already probed.
        .filter(|c| select(c))
        .cloned()
        .map(|mut c| {
            hydrate_provider_keys(&mut c);
            let keys = c.bearer_key_chain();
            (c, keys)
        })
        .collect();
    to_fetch.sort_by(|a, b| a.0.provider.cmp(&b.0.provider));
    if to_fetch.is_empty() {
        return Ok(ModelRefresh::default());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    // Probe providers concurrently so a batch of dead upstreams cannot stall
    // the `/model` picker for the sum of their timeouts; the slowest provider
    // bounds the wait.
    let results = futures::future::join_all(to_fetch.into_iter().map(|(config, keys)| {
        let client = &client;
        async move {
            let base_url = config.base_url.clone().unwrap_or_default();
            let listing = fetch_models(client, &base_url, &keys).await;
            (config, listing)
        }
    }))
    .await;

    let mut catalog = super::model_catalog::load();
    let mut catalog_dirty = false;
    let mut refresh = ModelRefresh::default();
    let default_model = crate::core::agent::global_config::default_model()
        .ok()
        .flatten()
        .filter(|m| !m.trim().is_empty());
    let mut default_dropped = false;
    for (config, result) in results {
        let listing = match result {
            Ok(listing) => listing,
            Err(e) => {
                refresh.failed.push((config.provider, e));
                continue;
            }
        };
        // An endpoint that lists nothing is treated as having said nothing:
        // wiping a working list over an empty answer is never the right guess.
        if listing.ids.is_empty() {
            refresh
                .failed
                .push((config.provider, "the endpoint listed no models".to_string()));
            continue;
        }
        let unlisted: Vec<&String> = config
            .models
            .iter()
            .filter(|m| !listing.ids.contains(m))
            .collect();
        let stored = match roster {
            Roster::Replace => listing.ids.clone(),
            Roster::Additive => {
                let mut merged = listing.ids.clone();
                merged.extend(unlisted.iter().map(|m| (*m).clone()));
                merged.sort();
                merged.dedup();
                merged
            }
        };
        // Only a provider that *used to* offer the default can retire it; one
        // that never listed it says nothing about it either way, and an
        // additive probe drops nothing at all.
        if let Some(model) = &default_model {
            if config.models.contains(model) && !stored.contains(model) {
                default_dropped = true;
            }
        }
        let changed = stored != config.models;
        if changed {
            crate::core::agent::global_config::set_provider(
                &config.provider,
                crate::core::agent::global_config::ProviderUpdate {
                    models: Some(stored.clone()),
                    ..Default::default()
                },
            )?;
        }
        // Metadata is refreshed even when the id list is unchanged: a price or
        // a context window can move without the roster moving. An answer that
        // carried no metadata at all leaves the cache alone rather than
        // clearing it: a degraded id-only response is not a statement that the
        // windows and prices cached earlier are wrong.
        if !listing.info.is_empty() {
            catalog.set_provider(&config.provider, listing.info);
            catalog_dirty = true;
        }
        refresh.listed.push(ProviderModels {
            provider: config.provider,
            models: stored.len(),
            changed,
            kept_unlisted: match roster {
                Roster::Additive => unlisted.len(),
                Roster::Replace => 0,
            },
        });
    }
    // Another provider may still serve it, which is not a retirement.
    if default_dropped {
        if let Some(model) = default_model {
            let still_offered = load_global_config()
                .map(|configs| configs.values().any(|c| c.models.contains(&model)))
                .unwrap_or(true);
            if !still_offered {
                refresh.retired_default = Some(model);
            }
        }
    }
    if catalog_dirty {
        if let Err(e) = catalog.save() {
            // The catalog only ever improves a readout, so a failed write is a
            // warning: the ids it accompanies are already persisted.
            log::warn!("could not save the model catalog: {e}");
        }
    }
    Ok(refresh)
}

/// What one `/models` response carried: the ids the config stores, plus the
/// per-model metadata the catalog caches.
struct ModelListing {
    ids: Vec<String>,
    info: std::collections::BTreeMap<String, super::model_catalog::ModelInfo>,
}

/// Query an OpenAI-compatible `GET {base_url}/models` with Bearer auth (trying
/// each key in the chain on 401/403, matching upstream resolution) and return
/// the parsed, sorted, deduped ids from the response body plus whatever
/// per-model metadata it reported. A provider with no key (a keyless local
/// endpoint) is queried unauthenticated. A remote plaintext-`http` base URL is
/// rejected up front so a bearer key is never sent over a cleartext connection
/// (loopback `http` is allowed).
async fn fetch_models(
    client: &reqwest::Client,
    base_url: &str,
    keys: &[String],
) -> Result<ModelListing, String> {
    if !(base_url.starts_with("https://")
        || (base_url.starts_with("http://") && is_loopback_url(base_url)))
    {
        return Err(format!(
            "base URL must be https:// (or http:// for localhost): {base_url}"
        ));
    }
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let mut last_err = format!("GET {url} failed");
    let attempts: Vec<Option<&String>> = if keys.is_empty() {
        vec![None]
    } else {
        keys.iter().map(Some).collect()
    };
    for key in attempts {
        let mut request = client.get(&url);
        if let Some(key) = key {
            request = request.header("Authorization", format!("Bearer {key}"));
        }
        let response = request
            .send()
            .await
            .map_err(|e| format!("could not reach {url}: {e}"))?;
        let status = response.status();
        if status.is_success() {
            let body = response.text().await.unwrap_or_default();
            let parsed: serde_json::Value = serde_json::from_str(&body)
                .map_err(|e| format!("{url} returned a response we could not read: {e}"))?;
            return Ok(ModelListing {
                ids: super::tokamak::parse_models(&parsed),
                info: super::model_catalog::parse_listing(&parsed),
            });
        }
        if status != reqwest::StatusCode::UNAUTHORIZED && status != reqwest::StatusCode::FORBIDDEN {
            // A non-auth error (rate limit, upstream down) won't be fixed by
            // trying another key, so report it and stop.
            return Err(format!("GET {url} returned {status}"));
        }
        last_err = format!("{url} rejected the key ({status})");
    }
    Err(last_err)
}

/// Load provider configs by layering the four `.jan`-based scopes (see module
/// docs for the priority order): Global `~/.jan/config.toml` -> Desktop
/// `settings.json` (inherit-only, additive) -> project `agent.toml`
/// `[provider]` override -> `--provider`/`--api-key` CLI/env overrides.
///
/// `project_root` is `None` when no project context is available (e.g.
/// `jan cli agent status` without `--project`); the local override is then
/// skipped. A missing/malformed Desktop store is not fatal: it's simply not
/// layered in, since Global config alone is a valid standalone setup.
pub fn load_provider_configs(
    project_root: Option<&std::path::Path>,
    overrides: &ProviderOverrides,
) -> Result<HashMap<String, ProviderConfig>, String> {
    let mut configs = load_global_config()?;

    inherit_desktop_providers(&mut configs);

    if let Some(root) = project_root {
        apply_local_override(&mut configs, root)?;
    }

    apply_overrides(&mut configs, overrides);
    seed_from_credential_store(&mut configs);
    Ok(configs)
}

/// Fill a login-created provider's key chain from the auth credential store
/// when neither persisted configuration nor CLI/env overrides supplied a key.
/// The login flow writes only non-secret metadata to config, so without this
/// seeding a signed-in provider would resolve keyless at runtime and every
/// request would 401. OAuth credentials are resolved by the transport layer
/// and deliberately not seeded here.
fn seed_from_credential_store(configs: &mut HashMap<String, ProviderConfig>) {
    use crate::core::cli::auth::CredentialStore;
    for (name, cfg) in configs.iter_mut() {
        if !cfg.bearer_key_chain().is_empty() {
            continue;
        }
        let Ok(Some(credential)) = CredentialStore::load(name) else {
            continue;
        };
        let Some(key) = credential.as_api_key() else {
            continue;
        };
        cfg.api_key = Some(key.to_string());
        cfg.api_keys = vec![key.to_string()];
    }
}

/// Layer in providers from Desktop's `settings.json` that Global doesn't
/// already define. Read-only inherit: never overwrites a Global entry, never
/// writes back to `settings.json`.
///
/// Their secrets live in the OS keyring (#8388) and are deliberately *not*
/// read here: this runs on startup, on every `/model` open and on every status
/// call, and reading N keychain items costs N macOS authorization prompts for
/// providers a run will never select. Keys are fetched by
/// [`hydrate_provider_keys`] for the one provider that is actually used;
/// [`has_stored_key`] answers presence without touching the secret.
fn inherit_desktop_providers(configs: &mut HashMap<String, ProviderConfig>) {
    let path = resolve_jan_data_folder().join("settings.json");
    let desktop_configs = match std::fs::read_to_string(&path) {
        Ok(raw) => parse_provider_store(&raw),
        Err(_) => return,
    };
    for (name, cfg) in desktop_configs {
        configs.entry(name).or_insert(cfg);
    }
}

/// Apply the project's `agent.toml` `[provider]` section, if present. Highest
/// priority of the three `.jan`-based sources: always wins over Global and the
/// Desktop inherit for the named provider.
fn apply_local_override(
    configs: &mut HashMap<String, ProviderConfig>,
    project_root: &std::path::Path,
) -> Result<(), String> {
    let cfg = match crate::core::agent::project::load_agent_config(project_root) {
        Ok(cfg) => cfg,
        Err(_) => return Ok(()),
    };
    if let Some(section) = cfg.provider {
        configs.insert(section.name.clone(), provider_config_from_section(section));
    }
    Ok(())
}

fn provider_config_from_section(section: ProviderSection) -> ProviderConfig {
    ProviderConfig {
        provider: section.name,
        api_keys: section.api_key.iter().cloned().collect(),
        api_key: section.api_key,
        base_url: section.base_url,
        custom_headers: Vec::new(),
        models: section.models,
        api_type: section.api_type,
    }
}

/// Seed each config's key chain from the secret store when the settings blob
/// carried no key. `load` is injected for testability. Explicit `--api-key`/env
/// overrides run afterward and still win.
/// Fill in a provider's key chain from the OS secret store, on demand.
///
/// No-op when the config already carries one: `~/.jan/config.toml` providers
/// (Tokamak included) hold their key inline, as do `--api-key`/env overrides,
/// so the prioritized path never reaches the keyring at all. Call this only for
/// a provider that is about to be used -- each call can cost a macOS keychain
/// prompt.
pub fn hydrate_provider_keys(config: &mut ProviderConfig) {
    hydrate_with(config, |p| {
        crate::core::server::provider_secrets::load_provider_keys(p)
    })
}

fn hydrate_with(config: &mut ProviderConfig, mut load: impl FnMut(&str) -> Vec<String>) {
    if !config.bearer_key_chain().is_empty() {
        return;
    }
    let keys = load(&config.provider);
    if !keys.is_empty() {
        config.api_key = keys.first().cloned();
        config.api_keys = keys;
    }
}

/// Whether `config` can present a key, without reading one. Inline keys answer
/// themselves; anything else defers to the secret store's presence index.
pub fn has_credential(config: &ProviderConfig) -> bool {
    !config.bearer_key_chain().is_empty()
        || crate::core::server::provider_secrets::has_stored_key(&config.provider)
}

/// Parse the `settings.json` body into provider configs. Tolerant of shape
/// drift: anything it cannot read is skipped rather than erroring. Providers
/// Desktop has marked inactive are skipped too (see `provider_from_json`).
fn parse_provider_store(raw: &str) -> HashMap<String, ProviderConfig> {
    let root: serde_json::Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(_) => return HashMap::new(),
    };

    // The store value is itself a JSON string ("{\"state\":{...}}").
    let blob = match root.get(MODEL_PROVIDER_KEY).and_then(|v| v.as_str()) {
        Some(s) => s,
        None => return HashMap::new(),
    };
    let parsed: serde_json::Value = match serde_json::from_str(blob) {
        Ok(v) => v,
        Err(_) => return HashMap::new(),
    };
    let providers = parsed
        .get("state")
        .and_then(|s| s.get("providers"))
        .and_then(|p| p.as_array());
    let providers = match providers {
        Some(p) => p,
        None => return HashMap::new(),
    };

    let mut out = HashMap::new();
    for p in providers {
        if let Some(cfg) = provider_from_json(p) {
            out.insert(cfg.provider.clone(), cfg);
        }
    }
    out
}

fn provider_from_json(p: &serde_json::Value) -> Option<ProviderConfig> {
    let provider = p.get("provider").and_then(|v| v.as_str())?.to_string();

    // A provider the user switched off in Desktop is not an option here either.
    // Desktop stops registering an inactive provider (`syncRemoteProviders`
    // gates on `active`), so inheriting one meant offering an entry whose key
    // Desktop no longer maintains. Absent field = inherit: `active` is written
    // for every provider Desktop creates, so only an explicit `false` is a
    // deliberate opt-out.
    if p.get("active").and_then(|v| v.as_bool()) == Some(false) {
        return None;
    }

    let base_url = p
        .get("base_url")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);

    let api_key = p
        .get("settings")
        .and_then(|s| s.as_array())
        .and_then(|settings| {
            settings.iter().find_map(|s| {
                let key = s.get("key").and_then(|k| k.as_str())?;
                if !API_KEY_SETTING_KEYS.contains(&key) {
                    return None;
                }
                s.get("controller_props")
                    .and_then(|c| c.get("value"))
                    .and_then(|v| v.as_str())
                    .filter(|v| !v.is_empty())
                    .map(String::from)
            })
        });

    let models = p
        .get("models")
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(|id| id.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let api_type = p
        .get("api_type")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);

    Some(ProviderConfig {
        provider,
        api_keys: api_key.iter().cloned().collect(),
        api_key,
        base_url,
        custom_headers: Vec::new(),
        models,
        api_type,
    })
}

/// Inject the override API key into the targeted provider(s). When a provider
/// is named but absent from the store, a minimal config is synthesized so the
/// CLI can reach it purely from flags/env.
fn apply_overrides(configs: &mut HashMap<String, ProviderConfig>, overrides: &ProviderOverrides) {
    let Some(api_key) = &overrides.api_key else {
        return;
    };
    match &overrides.provider {
        Some(provider) => {
            let cfg = configs
                .entry(provider.clone())
                .or_insert_with(|| ProviderConfig {
                    provider: provider.clone(),
                    api_key: None,
                    api_keys: Vec::new(),
                    base_url: None,
                    custom_headers: Vec::new(),
                    models: Vec::new(),
                    api_type: None,
                });
            set_key(cfg, api_key);
        }
        None => {
            for cfg in configs.values_mut() {
                set_key(cfg, api_key);
            }
        }
    }
}

fn set_key(cfg: &mut ProviderConfig, api_key: &str) {
    cfg.api_key = Some(api_key.to_string());
    cfg.api_keys = vec![api_key.to_string()];
}

#[cfg(test)]
mod tests {
    use super::*;

    const STORE: &str = r#"{"setting-general":{"x":1},"model-provider":"{\"state\":{\"providers\":[{\"provider\":\"anthropic\",\"base_url\":\"https://api.anthropic.com/v1\",\"settings\":[{\"key\":\"api-key\",\"controller_props\":{\"value\":\"sk-ant-123\"}}],\"models\":[{\"id\":\"claude-sonnet-4-5\"},{\"id\":\"claude-opus-4\"}]},{\"provider\":\"openai\",\"base_url\":\"https://api.openai.com/v1\",\"settings\":[{\"key\":\"api-key\",\"controller_props\":{\"value\":\"\"}}],\"models\":[{\"id\":\"gpt-4o\"}]}]}}"}"#;

    #[test]
    fn parses_provider_with_key_base_url_and_models() {
        let configs = parse_provider_store(STORE);
        let anthropic = configs.get("anthropic").expect("anthropic present");
        assert_eq!(anthropic.api_key.as_deref(), Some("sk-ant-123"));
        assert_eq!(anthropic.api_keys, vec!["sk-ant-123".to_string()]);
        assert_eq!(
            anthropic.base_url.as_deref(),
            Some("https://api.anthropic.com/v1")
        );
        assert!(anthropic.models.iter().any(|m| m == "claude-sonnet-4-5"));
    }

    #[test]
    fn empty_api_key_becomes_none() {
        let configs = parse_provider_store(STORE);
        let openai = configs.get("openai").expect("openai present");
        assert_eq!(openai.api_key, None);
        assert!(openai.api_keys.is_empty());
    }

    /// Desktop stops maintaining an inactive provider's key, so inheriting one
    /// offers an entry that cannot run and reports as keyless.
    #[test]
    fn an_inactive_desktop_provider_is_not_inherited() {
        let store = STORE.replace(
            r#"{\"provider\":\"openai\""#,
            r#"{\"provider\":\"openai\",\"active\":false"#,
        );
        let configs = parse_provider_store(&store);
        assert!(!configs.contains_key("openai"), "inactive provider skipped");
        assert!(configs.contains_key("anthropic"), "active one still there");
    }

    #[test]
    fn an_active_desktop_provider_is_inherited() {
        let store = STORE.replace(
            r#"{\"provider\":\"openai\""#,
            r#"{\"provider\":\"openai\",\"active\":true"#,
        );
        assert!(parse_provider_store(&store).contains_key("openai"));
    }

    /// Stores predating the flag, and any shape drift, must keep working.
    #[test]
    fn a_provider_without_the_active_flag_is_inherited() {
        assert!(parse_provider_store(STORE).contains_key("openai"));
    }

    #[test]
    fn malformed_store_yields_empty_map() {
        assert!(parse_provider_store("not json").is_empty());
        assert!(parse_provider_store(r#"{"model-provider":"not json"}"#).is_empty());
        assert!(parse_provider_store(r#"{"other":1}"#).is_empty());
    }

    #[test]
    fn override_injects_key_into_named_provider() {
        let mut configs = parse_provider_store(STORE);
        let ov = ProviderOverrides {
            provider: Some("openai".to_string()),
            api_key: Some("sk-new".to_string()),
        };
        apply_overrides(&mut configs, &ov);
        let openai = configs.get("openai").unwrap();
        assert_eq!(openai.api_key.as_deref(), Some("sk-new"));
        assert_eq!(openai.api_keys, vec!["sk-new".to_string()]);
    }

    #[test]
    fn override_synthesizes_absent_provider() {
        let mut configs = HashMap::new();
        let ov = ProviderOverrides {
            provider: Some("anthropic".to_string()),
            api_key: Some("sk-ant".to_string()),
        };
        apply_overrides(&mut configs, &ov);
        assert_eq!(
            configs.get("anthropic").and_then(|c| c.api_key.as_deref()),
            Some("sk-ant")
        );
    }

    #[test]
    fn override_without_provider_sets_all() {
        let mut configs = parse_provider_store(STORE);
        let ov = ProviderOverrides {
            provider: None,
            api_key: Some("shared".to_string()),
        };
        apply_overrides(&mut configs, &ov);
        assert!(configs
            .values()
            .all(|c| c.api_key.as_deref() == Some("shared")));
    }

    #[test]
    fn hydrate_fills_missing_key_from_store() {
        let mut configs = parse_provider_store(STORE);
        // openai has an empty key in the blob -> should be filled in.
        let openai = configs.get_mut("openai").unwrap();
        hydrate_with(openai, |p| match p {
            "openai" => vec!["sk-stored-1".to_string(), "sk-stored-2".to_string()],
            _ => Vec::new(),
        });
        assert_eq!(openai.api_key.as_deref(), Some("sk-stored-1"));
        assert_eq!(
            openai.api_keys,
            vec!["sk-stored-1".to_string(), "sk-stored-2".to_string()]
        );
    }

    #[test]
    fn hydrate_does_not_clobber_existing_key() {
        let mut configs = parse_provider_store(STORE);
        // anthropic already has sk-ant-123 from the blob -> store must not win.
        let anthropic = configs.get_mut("anthropic").unwrap();
        hydrate_with(anthropic, |_| vec!["sk-should-not-apply".to_string()]);
        assert_eq!(anthropic.api_key.as_deref(), Some("sk-ant-123"));
    }

    /// The whole point of deferring: a desktop-inherited provider is keyless
    /// as loaded, and reaches the secret store exactly once, only when it is
    /// the provider actually being used -- each read can cost a macOS keychain
    /// prompt.
    #[test]
    fn a_desktop_provider_stays_keyless_until_hydrated() {
        let mut configs = parse_provider_store(STORE);
        let openai = configs.get_mut("openai").unwrap();
        assert_eq!(openai.api_key, None, "keyless until hydrated");

        let mut reads = 0;
        hydrate_with(openai, |_| {
            reads += 1;
            Vec::new()
        });
        assert_eq!(reads, 1, "and exactly one read when it is");
        assert_eq!(openai.api_key, None);
    }

    #[test]
    fn hydrate_skips_the_store_when_a_key_is_already_present() {
        let mut configs = parse_provider_store(STORE);
        let anthropic = configs.get_mut("anthropic").unwrap();
        let mut reads = 0;
        hydrate_with(anthropic, |_| {
            reads += 1;
            Vec::new()
        });
        assert_eq!(reads, 0, "an inline key must not trigger a store read");
    }

    #[test]
    fn provider_models_from_store_are_flattened_and_sorted() {
        let mut pairs: Vec<(String, String)> = parse_provider_store(STORE)
            .values()
            .flat_map(|c| c.models.iter().map(|m| (c.provider.clone(), m.clone())))
            .collect();
        pairs.sort();
        assert_eq!(
            pairs,
            vec![
                ("anthropic".to_string(), "claude-opus-4".to_string()),
                ("anthropic".to_string(), "claude-sonnet-4-5".to_string()),
                ("openai".to_string(), "gpt-4o".to_string()),
            ]
        );
    }

    #[test]
    fn parses_desktop_selection() {
        let store = r#"{"model-provider":"{\"state\":{\"selectedProvider\":\"anthropic\",\"selectedModel\":{\"id\":\"claude-sonnet-4-5\",\"provider\":\"anthropic\"},\"providers\":[]}}"}"#;
        let sel = parse_selection(store);
        assert_eq!(sel.provider.as_deref(), Some("anthropic"));
        assert_eq!(sel.model.as_deref(), Some("claude-sonnet-4-5"));
    }

    #[test]
    fn selection_absent_or_empty_is_none() {
        assert_eq!(parse_selection("not json"), DesktopSelection::default());
        assert_eq!(
            parse_selection(r#"{"model-provider":"{\"state\":{\"providers\":[]}}"}"#),
            DesktopSelection::default()
        );
        // Empty strings / null model are treated as unset.
        let blank = r#"{"model-provider":"{\"state\":{\"selectedProvider\":\"\",\"selectedModel\":null}}"}"#;
        assert_eq!(parse_selection(blank), DesktopSelection::default());
    }

    #[test]
    fn only_providers_with_a_base_url_are_cli_reachable() {
        let remote = ProviderConfig {
            provider: "anthropic".into(),
            base_url: Some("https://api.anthropic.com/v1".into()),
            ..Default::default()
        };
        // Local engines (llamacpp, llamacpp-rs, mlx) are stored by the desktop
        // app without a base_url: their upstream only exists once the desktop
        // has spawned the engine, which the CLI never does.
        let local = ProviderConfig {
            provider: "llamacpp".into(),
            base_url: None,
            ..Default::default()
        };
        let blank = ProviderConfig {
            provider: "mlx".into(),
            base_url: Some(String::new()),
            ..Default::default()
        };
        assert!(is_cli_reachable(&remote));
        assert!(!is_cli_reachable(&local));
        assert!(!is_cli_reachable(&blank));
    }

    #[test]
    fn usable_requires_a_key_only_for_remote_upstreams() {
        let keyed_remote = ProviderConfig {
            provider: "tokamak".into(),
            base_url: Some("https://api.tokamak.sh/v1".into()),
            api_key: Some("tk".into()),
            ..Default::default()
        };
        let keyless_remote = ProviderConfig {
            provider: "openai".into(),
            base_url: Some("https://api.openai.com/v1".into()),
            ..Default::default()
        };
        let keyless_local = ProviderConfig {
            provider: "jan".into(),
            base_url: Some("http://localhost:1337/v1".into()),
            ..Default::default()
        };
        let engine = ProviderConfig {
            provider: "llamacpp".into(),
            base_url: None,
            api_key: Some("k".into()),
            ..Default::default()
        };
        assert!(is_usable(&keyed_remote));
        assert!(!is_usable(&keyless_remote));
        assert!(is_usable(&keyless_local));
        assert!(!is_usable(&engine));
    }

    #[test]
    fn loopback_detection_ignores_ports_paths_and_lookalike_hosts() {
        assert!(is_loopback_url("http://127.0.0.1:1337/v1"));
        assert!(is_loopback_url("http://localhost/v1"));
        assert!(is_loopback_url("http://[::1]:1337/v1"));
        assert!(is_loopback_url("localhost:1337"));
        assert!(!is_loopback_url("https://localhost.evil.com/v1"));
        assert!(!is_loopback_url("https://api.tokamak.sh/v1"));
        assert!(!is_loopback_url(""));
    }

    /// Tokamak leads the `/model` picker; everything else keeps its alphabetical
    /// order behind it, and models stay sorted within each provider.
    #[test]
    fn reachable_models_lists_tokamak_first() {
        let mut configs = HashMap::new();
        configs.insert(
            "anthropic".to_string(),
            cfg("anthropic", Some("https://api.anthropic.com/v1"), &["claude-sonnet-5"]),
        );
        configs.insert(
            "tokamak".to_string(),
            cfg("tokamak", Some("https://api.tokamak.sh/v1"), &["tokamak-1-preview"]),
        );
        configs.insert(
            "openai".to_string(),
            cfg("openai", Some("https://api.openai.com/v1"), &["gpt-5", "gpt-4o"]),
        );

        assert_eq!(
            reachable_models(&configs),
            vec![
                ("tokamak".to_string(), "tokamak-1-preview".to_string()),
                ("anthropic".to_string(), "claude-sonnet-5".to_string()),
                ("openai".to_string(), "gpt-4o".to_string()),
                ("openai".to_string(), "gpt-5".to_string()),
            ]
        );
    }

    /// Ordering is the only change: with no Tokamak entry the list is exactly
    /// the alphabetical order it always was.
    #[test]
    fn without_tokamak_the_order_is_unchanged() {
        let mut configs = HashMap::new();
        configs.insert("zeta".to_string(), cfg("zeta", Some("https://z.example/v1"), &["z1"]));
        configs.insert("alpha".to_string(), cfg("alpha", Some("https://a.example/v1"), &["a1"]));
        assert_eq!(
            reachable_models(&configs),
            vec![
                ("alpha".to_string(), "a1".to_string()),
                ("zeta".to_string(), "z1".to_string()),
            ]
        );
    }

    #[test]
    fn reachable_models_skips_local_engine_providers() {
        let mut configs = HashMap::new();
        configs.insert(
            "llamacpp".to_string(),
            ProviderConfig {
                provider: "llamacpp".into(),
                base_url: None,
                models: vec!["gemma-4-E2B-it-IQ4_XS".into()],
                ..Default::default()
            },
        );
        configs.insert(
            "anthropic".to_string(),
            ProviderConfig {
                provider: "anthropic".into(),
                base_url: Some("https://api.anthropic.com/v1".into()),
                models: vec!["claude-sonnet-5".into(), "claude-opus-5".into()],
                ..Default::default()
            },
        );
        let pairs = reachable_models(&configs);
        assert_eq!(
            pairs,
            vec![
                ("anthropic".to_string(), "claude-opus-5".to_string()),
                ("anthropic".to_string(), "claude-sonnet-5".to_string()),
            ]
        );
    }

    fn cfg(provider: &str, base_url: Option<&str>, models: &[&str]) -> ProviderConfig {
        ProviderConfig {
            provider: provider.into(),
            base_url: base_url.map(String::from),
            models: models.iter().map(|m| m.to_string()).collect(),
            ..Default::default()
        }
    }

    fn two_provider_store() -> HashMap<String, ProviderConfig> {
        let mut c = HashMap::new();
        c.insert(
            "llamacpp".into(),
            cfg("llamacpp", None, &["gemma-4-E2B-it-IQ4_XS", "shared-id"]),
        );
        c.insert(
            "anthropic".into(),
            cfg(
                "anthropic",
                Some("https://api.anthropic.com/v1"),
                &["claude-sonnet-5", "shared-id"],
            ),
        );
        c
    }

    #[test]
    fn local_only_model_is_reported_with_its_provider() {
        assert_eq!(
            unreachable_local_provider(&two_provider_store(), "gemma-4-E2B-it-IQ4_XS"),
            Some("llamacpp".to_string())
        );
    }

    #[test]
    fn remote_model_is_not_flagged() {
        assert_eq!(
            unreachable_local_provider(&two_provider_store(), "claude-sonnet-5"),
            None
        );
    }

    #[test]
    fn model_offered_by_both_local_and_remote_is_not_flagged() {
        // A reachable provider also serves it, so the run can proceed.
        assert_eq!(
            unreachable_local_provider(&two_provider_store(), "shared-id"),
            None
        );
    }

    #[test]
    fn unknown_model_is_not_flagged() {
        // Provider `models` lists are often incomplete (custom deployments), so
        // an id nobody claims must fall through to normal upstream resolution
        // rather than being rejected here.
        assert_eq!(
            unreachable_local_provider(&two_provider_store(), "some-custom-model"),
            None
        );
    }

    #[test]
    fn provider_prefixed_local_model_is_flagged() {
        assert_eq!(
            unreachable_local_provider(&two_provider_store(), "llamacpp/whatever"),
            Some("llamacpp".to_string())
        );
    }

    #[test]
    fn no_override_is_noop() {
        let mut configs = parse_provider_store(STORE);
        apply_overrides(&mut configs, &ProviderOverrides::default());
        assert_eq!(
            configs.get("anthropic").and_then(|c| c.api_key.as_deref()),
            Some("sk-ant-123")
        );
    }

    /// One-shot `/models` stub on a random loopback port. Returns the bound
    /// address; each accepted connection gets `body` back as JSON.
    fn models_stub(body: String, connections: usize) -> std::net::SocketAddr {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming().take(connections) {
                let Ok(mut stream) = stream else { continue };
                let mut buf = [0u8; 4096];
                let _ = std::io::Read::read(&mut stream, &mut buf);
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = std::io::Write::write_all(&mut stream, resp.as_bytes());
            }
        });
        addr
    }

    #[test]
    fn refresh_models_once_populates_and_persists_empty_providers() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let addr = models_stub(
                serde_json::json!({"data": [{"id": "m-b"}, {"id": "m-a"}]}).to_string(),
                1,
            );
            crate::core::agent::global_config::set_provider(
                "bare",
                crate::core::agent::global_config::ProviderUpdate {
                    api_key: Some("k".into()),
                    base_url: Some(format!("http://{addr}/v1")),
                    clear_api_key: false,
                    models: Some(vec![]),
                    api_type: None,
                                    ..Default::default()
                },
            )
            .unwrap();

            let rt = tokio::runtime::Runtime::new().unwrap();
            let populated = rt
                .block_on(refresh_models_once(
                    None,
                    &mut std::collections::HashSet::new(),
                ))
                .expect("fetch")
                .changed_any();
            assert!(populated);

            let configs = load_global_config().unwrap();
            assert_eq!(
                configs.get("bare").unwrap().models,
                vec!["m-a".to_string(), "m-b".to_string()],
                "discovered ids persist sorted"
            );
        });
    }

    /// A stored list is no longer sacred: the first `/model` open of a session
    /// re-lists a provider that already names models, which is the only way a
    /// roster captured at sign-in ever picks up what the endpoint added since.
    #[test]
    fn refresh_models_once_re_lists_a_configured_provider() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let addr = models_stub(
                serde_json::json!({"data": [{"id": "m-new"}, {"id": "my-model"}]}).to_string(),
                1,
            );
            crate::core::agent::global_config::set_provider(
                "chosen",
                crate::core::agent::global_config::ProviderUpdate {
                    api_key: Some("k".into()),
                    base_url: Some(format!("http://{addr}/v1")),
                    models: Some(vec!["my-model".into()]),
                    ..Default::default()
                },
            )
            .unwrap();

            let rt = tokio::runtime::Runtime::new().unwrap();
            let refreshed = rt
                .block_on(refresh_models_once(
                    None,
                    &mut std::collections::HashSet::new(),
                ))
                .expect("fetch");
            assert!(refreshed.changed_any());
            let configs = load_global_config().unwrap();
            assert_eq!(
                configs.get("chosen").unwrap().models,
                vec!["m-new".to_string(), "my-model".to_string()]
            );
        });
    }

    /// Merely opening `/model` runs the automatic probe, so a subset answer (a
    /// permission-scoped key, a paginated gateway) must not delete a
    /// hand-configured id from `~/.jan/config.toml`.
    #[test]
    fn an_automatic_probe_keeps_an_id_the_endpoint_stopped_listing() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let addr = models_stub(serde_json::json!({"data": [{"id": "gpt-4o"}]}).to_string(), 1);
            crate::core::agent::global_config::set_provider(
                "gateway",
                crate::core::agent::global_config::ProviderUpdate {
                    api_key: Some("k".into()),
                    base_url: Some(format!("http://{addr}/v1")),
                    models: Some(vec!["gpt-4o".into(), "my-alias".into()]),
                    ..Default::default()
                },
            )
            .unwrap();

            let rt = tokio::runtime::Runtime::new().unwrap();
            let refreshed = rt
                .block_on(refresh_models_once(
                    None,
                    &mut std::collections::HashSet::new(),
                ))
                .expect("fetch");
            assert!(!refreshed.changed_any(), "nothing was added or dropped");
            assert_eq!(refreshed.listed[0].kept_unlisted, 1);
            assert!(refreshed.summary().contains("no longer listed"));
            assert_eq!(
                load_global_config().unwrap().get("gateway").unwrap().models,
                vec!["gpt-4o".to_string(), "my-alias".to_string()],
                "a configured id survives a probe the user did not ask for"
            );
        });
    }

    /// The explicit refresh is the one that drops: the user asked for the
    /// endpoint's roster, and the summary reports what it did.
    #[test]
    fn an_explicit_refresh_drops_an_id_the_endpoint_stopped_listing() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let addr = models_stub(serde_json::json!({"data": [{"id": "gpt-4o"}]}).to_string(), 1);
            crate::core::agent::global_config::set_provider(
                "gateway",
                crate::core::agent::global_config::ProviderUpdate {
                    api_key: Some("k".into()),
                    base_url: Some(format!("http://{addr}/v1")),
                    models: Some(vec!["gpt-4o".into(), "my-alias".into()]),
                    ..Default::default()
                },
            )
            .unwrap();

            let rt = tokio::runtime::Runtime::new().unwrap();
            let refreshed = rt
                .block_on(refresh_models(None, Some("gateway")))
                .expect("fetch");
            assert!(refreshed.changed_any());
            assert_eq!(refreshed.listed[0].kept_unlisted, 0);
            assert_eq!(
                load_global_config().unwrap().get("gateway").unwrap().models,
                vec!["gpt-4o".to_string()]
            );
        });
    }

    /// `--provider` naming nothing refreshable is a failure, not an empty
    /// refresh: the caller's exit code reads `failed`, and a typo that exits 0
    /// tells a script the refresh completed.
    #[test]
    fn refreshing_an_unknown_provider_is_reported_as_failed() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            let refreshed = rt
                .block_on(refresh_models(None, Some("typo")))
                .expect("call");
            assert!(refreshed.listed.is_empty());
            assert_eq!(
                refreshed.failed,
                vec![("typo".to_string(), "not a configured provider".to_string())]
            );
        });
    }

    /// A degraded answer that lists ids and no metadata is not a statement that
    /// the cached windows and prices are wrong, so it must not clear them.
    #[test]
    fn an_id_only_listing_keeps_the_cached_metadata() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let addr = models_stub(serde_json::json!({"data": [{"id": "m-a"}]}).to_string(), 1);
            crate::core::agent::global_config::set_provider(
                "gateway",
                crate::core::agent::global_config::ProviderUpdate {
                    api_key: Some("k".into()),
                    base_url: Some(format!("http://{addr}/v1")),
                    models: Some(vec!["m-a".into()]),
                    ..Default::default()
                },
            )
            .unwrap();
            let mut catalog = super::super::model_catalog::Catalog::default();
            catalog.set_provider(
                "gateway",
                std::collections::BTreeMap::from([(
                    "m-a".to_string(),
                    super::super::model_catalog::ModelInfo {
                        context_length: Some(200_000),
                        ..Default::default()
                    },
                )]),
            );
            catalog.save().unwrap();

            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(refresh_models(None, Some("gateway")))
                .expect("fetch");
            assert_eq!(
                super::super::model_catalog::load()
                    .get(Some("gateway"), "m-a")
                    .and_then(|i| i.context_length),
                Some(200_000)
            );
        });
    }

    #[test]
    fn refresh_models_once_queries_keyless_loopback_providers() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let addr = models_stub(
                serde_json::json!({"data": [{"id": "local-model"}]}).to_string(),
                1,
            );
            crate::core::agent::global_config::set_provider(
                "local",
                crate::core::agent::global_config::ProviderUpdate {
                    api_key: None,
                    base_url: Some(format!("http://{addr}/v1")),
                    clear_api_key: false,
                    models: Some(vec![]),
                    api_type: None,
                                    ..Default::default()
                },
            )
            .unwrap();

            let rt = tokio::runtime::Runtime::new().unwrap();
            let populated = rt
                .block_on(refresh_models_once(
                    None,
                    &mut std::collections::HashSet::new(),
                ))
                .expect("fetch")
                .changed_any();
            assert!(populated, "a keyless endpoint is queried unauthenticated");
            let configs = load_global_config().unwrap();
            assert_eq!(
                configs.get("local").unwrap().models,
                vec!["local-model".to_string()]
            );
        });
    }

    /// Probes must run concurrently, not sequentially: each stub here only
    /// responds after BOTH providers have connected, so a sequential
    /// implementation (probe one to completion before starting the next)
    /// deadlocks into its 15s timeout and populates only one provider.
    #[test]
    fn refresh_models_once_probes_concurrently() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
            let stub = |models: &str| {
                let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
                let addr = listener.local_addr().unwrap();
                let body = serde_json::json!({"data": [{"id": models}]}).to_string();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let Ok((mut stream, _)) = listener.accept() else { return };
                    let mut buf = [0u8; 4096];
                    let _ = std::io::Read::read(&mut stream, &mut buf);
                    barrier.wait();
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = std::io::Write::write_all(&mut stream, resp.as_bytes());
                });
                addr
            };
            let addr_a = stub("model-a");
            let addr_b = stub("model-b");
            for (name, addr) in [("prov-a", addr_a), ("prov-b", addr_b)] {
                crate::core::agent::global_config::set_provider(
                    name,
                    crate::core::agent::global_config::ProviderUpdate {
                        api_key: Some("k".into()),
                        base_url: Some(format!("http://{addr}/v1")),
                        clear_api_key: false,
                        models: Some(vec![]),
                        api_type: None,
                                            ..Default::default()
                    },
                )
                .unwrap();
            }

            let rt = tokio::runtime::Runtime::new().unwrap();
            let populated = rt
                .block_on(refresh_models_once(
                    None,
                    &mut std::collections::HashSet::new(),
                ))
                .expect("fetch")
                .changed_any();
            assert!(populated);
            let configs = load_global_config().unwrap();
            assert_eq!(
                configs.get("prov-a").unwrap().models,
                vec!["model-a".to_string()]
            );
            assert_eq!(
                configs.get("prov-b").unwrap().models,
                vec!["model-b".to_string()]
            );
        });
    }

    /// The point of the refresh: a provider whose list was captured at sign-in
    /// picks up models the endpoint has gained since, and its per-model
    /// metadata is cached alongside for `/context` and `/usage`.
    #[test]
    fn refresh_models_replaces_a_configured_list_and_caches_metadata() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let addr = models_stub(
                serde_json::json!({"data": [
                    {"id": "anthropic/claude-opus-5", "context_length": 1000000,
                     "pricing": {"prompt": "0.000005", "completion": "0.000025"}},
                    {"id": "openai/gpt-oss-120b-medium", "context_length": 131072},
                ]})
                .to_string(),
                1,
            );
            crate::core::agent::global_config::set_provider(
                "tokamak",
                crate::core::agent::global_config::ProviderUpdate {
                    api_key: Some("k".into()),
                    base_url: Some(format!("http://{addr}/v1")),
                    models: Some(vec!["stale-model".into()]),
                    ..Default::default()
                },
            )
            .unwrap();

            let rt = tokio::runtime::Runtime::new().unwrap();
            let refreshed = rt.block_on(refresh_models(None, None)).expect("refresh");
            assert!(refreshed.changed_any());
            assert_eq!(refreshed.failed, Vec::new());
            assert_eq!(
                refreshed.listed,
                vec![ProviderModels {
                    provider: "tokamak".to_string(),
                    models: 2,
                    changed: true,
                    kept_unlisted: 0,
                }]
            );

            let configs = load_global_config().unwrap();
            assert_eq!(
                configs.get("tokamak").unwrap().models,
                vec![
                    "anthropic/claude-opus-5".to_string(),
                    "openai/gpt-oss-120b-medium".to_string()
                ],
                "a stale list is replaced, not merged"
            );

            let catalog = crate::core::cli::model_catalog::load();
            let info = catalog
                .get(Some("tokamak"), "anthropic/claude-opus-5")
                .expect("metadata cached");
            assert_eq!(info.context_length, Some(1_000_000));
            assert_eq!(info.prompt_usd, Some(0.000005));
        });
    }

    /// A refresh that retires the model `default_model` points at must say so:
    /// otherwise the next run fails with a 404 nothing connects to the refresh.
    #[test]
    fn refresh_models_reports_a_retired_default_model() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let addr = models_stub(
                serde_json::json!({"data": [{"id": "m-new"}]}).to_string(),
                1,
            );
            crate::core::agent::global_config::set_provider(
                "prov",
                crate::core::agent::global_config::ProviderUpdate {
                    api_key: Some("k".into()),
                    base_url: Some(format!("http://{addr}/v1")),
                    models: Some(vec!["m-retired".into()]),
                    ..Default::default()
                },
            )
            .unwrap();
            crate::core::agent::global_config::set_default_model_if_unset("m-retired").unwrap();

            let rt = tokio::runtime::Runtime::new().unwrap();
            let refreshed = rt.block_on(refresh_models(None, None)).expect("refresh");
            assert_eq!(refreshed.retired_default.as_deref(), Some("m-retired"));
            assert!(refreshed.summary().contains("no longer offered"));
        });
    }

    /// A default still served by some other provider was not retired, so the
    /// warning must stay quiet.
    #[test]
    fn a_default_another_provider_still_serves_is_not_retired() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let addr = models_stub(
                serde_json::json!({"data": [{"id": "m-new"}]}).to_string(),
                1,
            );
            crate::core::agent::global_config::set_provider(
                "prov",
                crate::core::agent::global_config::ProviderUpdate {
                    api_key: Some("k".into()),
                    base_url: Some(format!("http://{addr}/v1")),
                    models: Some(vec!["shared".into()]),
                    ..Default::default()
                },
            )
            .unwrap();
            crate::core::agent::global_config::set_provider(
                "backup",
                crate::core::agent::global_config::ProviderUpdate {
                    api_key: Some("k".into()),
                    base_url: Some("https://other.example/v1".into()),
                    models: Some(vec!["shared".into()]),
                    ..Default::default()
                },
            )
            .unwrap();
            crate::core::agent::global_config::set_default_model_if_unset("shared").unwrap();

            let rt = tokio::runtime::Runtime::new().unwrap();
            let refreshed = rt
                .block_on(refresh_models(None, Some("prov")))
                .expect("refresh");
            assert_eq!(refreshed.retired_default, None);
        });
    }

    /// A refresh that finds the same roster must say so rather than reading as
    /// a failure, and must not rewrite the config.
    #[test]
    fn refresh_models_reports_an_unchanged_roster() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let addr = models_stub(serde_json::json!({"data": [{"id": "m-a"}]}).to_string(), 1);
            crate::core::agent::global_config::set_provider(
                "prov",
                crate::core::agent::global_config::ProviderUpdate {
                    api_key: Some("k".into()),
                    base_url: Some(format!("http://{addr}/v1")),
                    models: Some(vec!["m-a".into()]),
                    ..Default::default()
                },
            )
            .unwrap();

            let rt = tokio::runtime::Runtime::new().unwrap();
            let refreshed = rt.block_on(refresh_models(None, None)).expect("refresh");
            assert!(!refreshed.changed_any());
            assert_eq!(refreshed.listed[0].models, 1);
            assert!(
                refreshed.summary().contains("unchanged"),
                "{}",
                refreshed.summary()
            );
        });
    }

    /// One dead upstream must not cost the others their refresh, and must be
    /// reported rather than silently dropped.
    #[test]
    fn refresh_models_reports_failures_without_blocking_the_rest() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let addr = models_stub(serde_json::json!({"data": [{"id": "m-a"}]}).to_string(), 1);
            for (name, base) in [
                ("alive", format!("http://{addr}/v1")),
                ("dead", "http://127.0.0.1:9/v1".to_string()),
            ] {
                crate::core::agent::global_config::set_provider(
                    name,
                    crate::core::agent::global_config::ProviderUpdate {
                        api_key: Some("k".into()),
                        base_url: Some(base),
                        models: Some(vec![]),
                        ..Default::default()
                    },
                )
                .unwrap();
            }

            let rt = tokio::runtime::Runtime::new().unwrap();
            let refreshed = rt.block_on(refresh_models(None, None)).expect("refresh");
            assert_eq!(refreshed.listed.len(), 1);
            assert_eq!(refreshed.listed[0].provider, "alive");
            assert_eq!(refreshed.failed.len(), 1);
            assert_eq!(refreshed.failed[0].0, "dead");
        });
    }

    /// `--provider` scopes the probe: nothing else is contacted, which is what
    /// keeps a refresh of one provider from waiting on every other one.
    #[test]
    fn refresh_models_can_target_one_provider() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let addr = models_stub(serde_json::json!({"data": [{"id": "m-a"}]}).to_string(), 1);
            crate::core::agent::global_config::set_provider(
                "wanted",
                crate::core::agent::global_config::ProviderUpdate {
                    api_key: Some("k".into()),
                    base_url: Some(format!("http://{addr}/v1")),
                    models: Some(vec![]),
                    ..Default::default()
                },
            )
            .unwrap();
            // A dead endpoint that must never be contacted.
            crate::core::agent::global_config::set_provider(
                "other",
                crate::core::agent::global_config::ProviderUpdate {
                    api_key: Some("k".into()),
                    base_url: Some("http://127.0.0.1:9/v1".into()),
                    models: Some(vec![]),
                    ..Default::default()
                },
            )
            .unwrap();

            let rt = tokio::runtime::Runtime::new().unwrap();
            let refreshed = rt
                .block_on(refresh_models(None, Some("wanted")))
                .expect("refresh");
            assert_eq!(refreshed.listed.len(), 1);
            assert!(
                refreshed.failed.is_empty(),
                "the other provider is untouched"
            );
        });
    }

    /// An endpoint that answers with an empty roster must not wipe a working
    /// list: "nothing listed" is far more often an outage than a retirement.
    #[test]
    fn refresh_models_never_wipes_a_list_over_an_empty_answer() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let addr = models_stub(serde_json::json!({"data": []}).to_string(), 1);
            crate::core::agent::global_config::set_provider(
                "prov",
                crate::core::agent::global_config::ProviderUpdate {
                    api_key: Some("k".into()),
                    base_url: Some(format!("http://{addr}/v1")),
                    models: Some(vec!["keep-me".into()]),
                    ..Default::default()
                },
            )
            .unwrap();

            let rt = tokio::runtime::Runtime::new().unwrap();
            let refreshed = rt.block_on(refresh_models(None, None)).expect("refresh");
            assert!(refreshed.listed.is_empty());
            assert_eq!(refreshed.failed.len(), 1);
            let configs = load_global_config().unwrap();
            assert_eq!(
                configs.get("prov").unwrap().models,
                vec!["keep-me".to_string()]
            );
        });
    }

    #[test]
    fn refresh_models_once_short_circuits_already_probed() {
        crate::core::agent::global_config::with_temp_home(|_| {
            // A dead endpoint: if it were contacted, the 15s timeout would hang.
            crate::core::agent::global_config::set_provider(
                "dead",
                crate::core::agent::global_config::ProviderUpdate {
                    api_key: Some("k".into()),
                    base_url: Some("http://127.0.0.1:9/v1".into()), // refuses instantly
                    clear_api_key: false,
                    models: Some(vec![]),
                    api_type: None,
                                    ..Default::default()
                },
            )
            .unwrap();

            let rt = tokio::runtime::Runtime::new().unwrap();
            let mut probed = std::collections::HashSet::new();
            // First probe hits the dead endpoint (fast refusal) and warns.
            let populated = rt
                .block_on(refresh_models_once(None, &mut probed))
                .expect("fetch")
                .changed_any();
            assert!(!populated);
            assert_eq!(probed.len(), 1, "dead provider is recorded as probed");

            // A second fetch must not re-contact the dead endpoint at all
            // (the probed set short-circuits it), and must not error.
            let again = rt
                .block_on(refresh_models_once(None, &mut probed))
                .expect("second fetch")
                .changed_any();
            assert!(!again, "already-probed provider is not re-fetched");
        });
    }

    /// Redirects the secret store (data folder + forced file fallback) for the
    /// duration of `f`. `JAN_DATA_FOLDER` is process-wide, so tests touching it
    /// must not run concurrently.
    fn with_temp_secrets<T>(f: impl FnOnce() -> T) -> T {
        let _guard = crate::core::server::provider_secrets::SECRET_STORE_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::tempdir().unwrap();
        let prev = std::env::var("JAN_DATA_FOLDER").ok();
        std::env::set_var("JAN_DATA_FOLDER", dir.path());
        crate::core::server::provider_secrets::force_file_secrets();
        let result = f();
        match &prev {
            Some(v) => std::env::set_var("JAN_DATA_FOLDER", v),
            None => std::env::remove_var("JAN_DATA_FOLDER"),
        }
        result
    }

    #[test]
    fn provider_is_signed_in_when_api_key_credential_exists() {
        use crate::core::agent::global_config::with_temp_home;
        use crate::core::cli::auth::{Credential, CredentialStore};

        with_temp_secrets(|| {
            with_temp_home(|_| {
                CredentialStore::store("deepseek", &Credential::ApiKey("sk-live".into())).unwrap();

                assert!(provider_is_signed_in(None, "deepseek"));
            });
        });
    }

    #[test]
    fn provider_is_signed_in_when_oauth_credential_exists() {
        use crate::core::agent::global_config::with_temp_home;
        use crate::core::cli::auth::{Credential, CredentialStore, OAuthToken};

        with_temp_secrets(|| {
            with_temp_home(|_| {
                CredentialStore::store(
                    "anthropic",
                    &Credential::OAuthToken(OAuthToken {
                        access_token: "access".into(),
                        refresh_token: Some("refresh".into()),
                        expires_at: Some(1_800_000_000),
                        token_type: "Bearer".into(),
                        scopes: vec!["model.read".into()],
                    }),
                )
                .unwrap();

                assert!(provider_is_signed_in(None, "anthropic"));
            });
        });
    }

    #[test]
    fn provider_is_not_signed_in_without_credential_or_usable_config() {
        use crate::core::agent::global_config::with_temp_home;

        with_temp_secrets(|| {
            with_temp_home(|_| {
                assert!(!provider_is_signed_in(None, "deepseek"));
            });
        });
    }

    #[test]
    fn provider_is_signed_in_when_resolved_config_is_usable() {
        use crate::core::agent::global_config::{set_provider, with_temp_home, ProviderUpdate};

        with_temp_secrets(|| {
            with_temp_home(|_| {
                set_provider(
                    "jan",
                    ProviderUpdate {
                        api_key: None,
                        clear_api_key: true,
                        base_url: Some("http://localhost:1337/v1".into()),
                        models: Some(vec!["jan-local".into()]),
                        api_type: None,
                        ..Default::default()
                    },
                )
                .unwrap();

                assert!(provider_is_signed_in(None, "jan"));
            });
        });
    }

    #[test]
    fn runtime_uses_secret_store_when_non_secret_config_has_no_key() {
        use crate::core::agent::global_config::{set_provider, with_temp_home, ProviderUpdate};
        use crate::core::cli::auth::{Credential, CredentialStore};

        with_temp_secrets(|| {
            with_temp_home(|_| {
                // The login flow writes only non-secret metadata to config.
                set_provider(
                    "deepseek",
                    ProviderUpdate {
                        api_key: None,
                        clear_api_key: true,
                        base_url: Some("https://mock/v1".into()),
                        models: Some(vec!["deepseek-chat".into()]),
                        api_type: None,
                        ..Default::default()
                    },
                )
                .unwrap();
                CredentialStore::store("deepseek", &Credential::ApiKey("sk-live".into())).unwrap();

                let configs = load_provider_configs(None, &ProviderOverrides::default()).unwrap();
                assert_eq!(
                    configs.get("deepseek").unwrap().bearer_key_chain(),
                    vec!["sk-live".to_string()]
                );
            });
        });
    }

    #[test]
    fn secret_store_never_overrides_an_explicit_override_key() {
        use crate::core::agent::global_config::{set_provider, with_temp_home, ProviderUpdate};
        use crate::core::cli::auth::{Credential, CredentialStore};

        with_temp_secrets(|| {
            with_temp_home(|_| {
                set_provider(
                    "deepseek",
                    ProviderUpdate {
                        api_key: None,
                        clear_api_key: true,
                        base_url: Some("https://mock/v1".into()),
                        models: Some(vec!["deepseek-chat".into()]),
                        api_type: None,
                        ..Default::default()
                    },
                )
                .unwrap();
                CredentialStore::store("deepseek", &Credential::ApiKey("sk-stored".into())).unwrap();

                // A CLI/env override is the most explicit, most ephemeral signal
                // and must win over the persisted secret.
                let overrides = ProviderOverrides {
                    provider: Some("deepseek".into()),
                    api_key: Some("sk-flag".into()),
                };
                let configs = load_provider_configs(None, &overrides).unwrap();
                assert_eq!(
                    configs.get("deepseek").unwrap().bearer_key_chain(),
                    vec!["sk-flag".to_string()]
                );
            });
        });
    }
}
