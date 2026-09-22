//! Per-model metadata cached from a provider's `/models` listing.
//!
//! `~/.jan/config.toml` records a provider's model **ids**, and that is all the
//! agent needs to route a request. A router-style endpoint reports much more
//! per model -- `context_length`, `max_completion_tokens` and per-token
//! `pricing` -- which is exactly what the header gauge, `/context` and
//! `/usage` would otherwise have to guess at (see
//! [`super::model_capabilities`], whose catalog is a hand-maintained table of
//! model families).
//!
//! That metadata lives here, in `~/.jan/model_catalog.json`, rather than in
//! `config.toml`: the config is hand-edited and a pricing block per model would
//! bury the three lines a user actually writes. This file is a **cache** --
//! deleting it costs nothing but a refresh, and nothing here is a secret.

use std::collections::BTreeMap;
use std::path::PathBuf;

/// What a provider reports about one model. Every field is optional: a plain
/// OpenAI-compatible endpoint reports nothing but the id, and a partial answer
/// is still worth caching.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ModelInfo {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    /// Total context window in tokens.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_length: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u64>,
    /// USD per token, as the provider prices them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_usd: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completion_usd: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_read_usd: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_write_usd: Option<f64>,
}

impl ModelInfo {
    /// Whether anything was actually learned. An entry that carries nothing is
    /// not written: it would only make a later refresh look like a change.
    fn is_empty(&self) -> bool {
        *self == ModelInfo::default()
    }

    /// Whether this model can be priced at all. Both sides are required: a
    /// listing publishing only `completion` would otherwise bill every input
    /// token at $0 and print that as an ordinary estimate, which reads as a
    /// cheap model rather than as the half-answer it is. Cache rates alone
    /// cannot cost a request either, so they do not count.
    pub fn has_pricing(&self) -> bool {
        self.prompt_usd.is_some() && self.completion_usd.is_some()
    }

    /// The per-token rates for this model, or `None` when it cannot be priced.
    /// This is what a run's money ceiling is metered against, so it is the same
    /// `has_pricing` answer rather than a second, looser notion of "priced".
    pub fn rates(&self) -> Option<crate::core::agent::session::TokenRates> {
        Some(crate::core::agent::session::TokenRates {
            prompt_usd: self.prompt_usd?,
            completion_usd: self.completion_usd?,
            cache_read_usd: self.cache_read_usd,
            cache_write_usd: self.cache_write_usd,
        })
    }

    /// Estimated USD for one request's token counts. An unpriced model costs
    /// nothing here; callers that must not bill a missing price as free go
    /// through [`TokenUsage::cost_usd`], which checks [`Self::has_pricing`]
    /// first.
    pub fn cost_usd(&self, prompt: u64, completion: u64, cached: u64, cache_write: u64) -> f64 {
        self.rates()
            .unwrap_or(crate::core::agent::session::TokenRates {
                prompt_usd: self.prompt_usd.unwrap_or(0.0),
                completion_usd: self.completion_usd.unwrap_or(0.0),
                cache_read_usd: self.cache_read_usd,
                cache_write_usd: self.cache_write_usd,
            })
            .cost_usd(prompt, completion, cached, cache_write)
    }
}

/// Billable tokens accounted for across a run or a session, summed per
/// request. Unlike a context-window fill -- which is the latest request alone
/// -- these are sums: a provider bills every request for the whole prompt it
/// resends, so the spend is the sum.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TokenUsage {
    pub requests: u64,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub cached_tokens: u64,
    pub cache_write_tokens: u64,
}

impl TokenUsage {
    /// Fold in one request's reported usage. A provider that omits a field
    /// contributes nothing for it rather than resetting the total.
    pub fn add(&mut self, usage: &crate::core::agent::events::Usage) {
        self.requests += 1;
        self.prompt_tokens += usage.prompt_tokens.unwrap_or(0);
        self.completion_tokens += usage.completion_tokens.unwrap_or(0);
        self.cached_tokens += usage.cached_tokens.unwrap_or(0);
        self.cache_write_tokens += usage.cache_write_tokens.unwrap_or(0);
    }

    pub fn merge(&mut self, other: &TokenUsage) {
        self.requests += other.requests;
        self.prompt_tokens += other.prompt_tokens;
        self.completion_tokens += other.completion_tokens;
        self.cached_tokens += other.cached_tokens;
        self.cache_write_tokens += other.cache_write_tokens;
    }

    pub fn total_tokens(&self) -> u64 {
        self.prompt_tokens + self.completion_tokens
    }

    /// Estimated USD, or `None` when the provider published no prices for this
    /// model -- a missing price is never billed as free.
    pub fn cost_usd(&self, info: Option<&ModelInfo>) -> Option<f64> {
        let info = info.filter(|i| i.has_pricing())?;
        Some(info.cost_usd(
            self.prompt_tokens,
            self.completion_tokens,
            self.cached_tokens,
            self.cache_write_tokens,
        ))
    }
}

/// The single entry across `maps` whose id matches `model_id` once the
/// `<vendor>/` qualifier is stripped from either side. Two vendors serving the
/// same bare name is an ambiguity, not a hit.
fn unique_bare_match<'a>(
    maps: impl Iterator<Item = &'a BTreeMap<String, ModelInfo>>,
    model_id: &str,
) -> Option<&'a ModelInfo> {
    let bare = model_id.rsplit('/').next().unwrap_or(model_id);
    let mut matches = maps
        .flatten()
        .filter(|(id, _)| id.rsplit('/').next() == Some(bare));
    let first = matches.next()?;
    matches.next().is_none().then_some(first.1)
}

/// The whole cache: provider id -> model id -> metadata.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Catalog {
    #[serde(default)]
    providers: BTreeMap<String, BTreeMap<String, ModelInfo>>,
}

fn catalog_path() -> Result<PathBuf, String> {
    Ok(crate::core::agent::global_config::global_jan_dir()?.join("model_catalog.json"))
}

/// Read the cache. A missing or unreadable file is an empty catalog, never an
/// error: this is metadata that improves a display, so a corrupt cache must
/// never block a run.
pub fn load() -> Catalog {
    let Ok(path) = catalog_path() else {
        return Catalog::default();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

impl Catalog {
    /// Replace one provider's entries, dropping the provider when it reported
    /// nothing worth keeping.
    pub fn set_provider(&mut self, provider: &str, models: BTreeMap<String, ModelInfo>) {
        if models.is_empty() {
            self.providers.remove(provider);
        } else {
            self.providers.insert(provider.to_string(), models);
        }
    }

    pub fn remove_provider(&mut self, provider: &str) {
        self.providers.remove(provider);
    }

    /// Metadata for `model_id` as `provider` reports it, matching the exact id
    /// first and then a unique match on the bare id behind a `<vendor>/`
    /// qualifier, since a user may name a model either way.
    ///
    /// When `provider` is cached, its answer is the whole answer: two providers
    /// can serve one id at different prices, so falling through to another
    /// one's entry would bill a request at rates nobody quoted. Only a provider
    /// the catalog has never seen (or no provider at all) searches the rest,
    /// and then only for an unambiguous hit.
    pub fn get(&self, provider: Option<&str>, model_id: &str) -> Option<&ModelInfo> {
        if let Some(models) = provider.and_then(|p| self.providers.get(p)) {
            return models
                .get(model_id)
                .or_else(|| unique_bare_match(std::iter::once(models), model_id));
        }
        let mut exact = self.providers.values().filter_map(|m| m.get(model_id));
        if let Some(found) = exact.next() {
            // One provider knowing the id is an answer; several disagreeing
            // about its price is not, and there is nothing here to choose by.
            return exact.next().is_none().then_some(found);
        }
        unique_bare_match(self.providers.values(), model_id)
    }

    /// Persist the cache, creating `~/.jan` if needed.
    pub fn save(&self) -> Result<(), String> {
        let path = catalog_path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let body = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(&path, body).map_err(|e| format!("{}: {e}", path.display()))
    }

    #[cfg(test)]
    fn provider_ids(&self, provider: &str) -> Vec<String> {
        self.providers
            .get(provider)
            .map(|m| m.keys().cloned().collect())
            .unwrap_or_default()
    }
}

/// Cache whatever `listing` (a raw `/models` body) says about `provider`'s
/// models. Best-effort by contract: this metadata only ever improves a readout,
/// so a sign-in must never fail over it.
pub fn cache_listing(provider: &str, listing: &serde_json::Value) {
    let models = parse_listing(listing);
    if models.is_empty() {
        return;
    }
    let mut catalog = load();
    catalog.set_provider(provider, models);
    if let Err(e) = catalog.save() {
        log::warn!("could not cache model metadata for '{provider}': {e}");
    }
}

/// Drop a provider's cached metadata, for a sign-out that removed its entry.
pub fn forget(provider: &str) {
    let mut catalog = load();
    catalog.remove_provider(provider);
    let _ = catalog.save();
}

/// Per-model metadata from a `/models` payload, keyed by id. Ids with nothing
/// to record are omitted, so a plain OpenAI-compatible endpoint yields an empty
/// map rather than a row of empty entries.
pub fn parse_listing(value: &serde_json::Value) -> BTreeMap<String, ModelInfo> {
    let entries = value
        .get("data")
        .and_then(|d| d.as_array())
        .or_else(|| value.as_array());
    let Some(entries) = entries else {
        return BTreeMap::new();
    };
    entries
        .iter()
        .filter_map(|entry| {
            let id = entry
                .get("id")
                .and_then(|id| id.as_str())
                .map(str::trim)
                .filter(|id| !id.is_empty())?;
            let info = model_info(entry);
            (!info.is_empty()).then(|| (id.to_string(), info))
        })
        .collect()
}

fn model_info(entry: &serde_json::Value) -> ModelInfo {
    let pricing = entry.get("pricing");
    let rate = |key: &str| pricing.and_then(|p| p.get(key)).and_then(number);
    ModelInfo {
        display_name: entry
            .get("model_display_name")
            .or_else(|| entry.get("display_name"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(String::from),
        context_length: entry
            .get("context_length")
            .or_else(|| entry.get("context_window"))
            .and_then(number)
            .map(|v| v as u64),
        max_output_tokens: entry
            .get("max_completion_tokens")
            .or_else(|| entry.get("max_output_tokens"))
            .and_then(number)
            .map(|v| v as u64),
        prompt_usd: rate("prompt"),
        completion_usd: rate("completion"),
        cache_read_usd: rate("input_cache_read"),
        cache_write_usd: rate("input_cache_write"),
    }
}

/// A JSON number, or a number written as a string. Every price in the Jan
/// Router listing is a string (`"0.0000008"`), while `context_length` is a
/// number, and other gateways swap which is which.
fn number(value: &serde_json::Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str()?.trim().parse::<f64>().ok())
        .filter(|v| v.is_finite() && *v >= 0.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::agent::global_config::with_temp_home;
    use serde_json::json;

    /// One entry in the shape the Jan Router serves: pricing as strings, window
    /// and output cap as numbers.
    fn router_entry(id: &str) -> serde_json::Value {
        json!({
            "id": id,
            "object": "model",
            "owned_by": "Jan Router",
            "model_display_name": "claude-opus-5",
            "pricing": {
                "currency": "USD",
                "prompt": "0.000005",
                "completion": "0.000025",
                "input_cache_read": "0.0000005",
                "input_cache_write": "0.00000625",
                "per_million_tokens": {"prompt": "5"}
            },
            "context_length": 1000000,
            "max_completion_tokens": 128000
        })
    }

    #[test]
    fn parses_the_router_listing_shape() {
        let listing = json!({"object": "list", "data": [router_entry("anthropic/claude-opus-5")]});
        let parsed = parse_listing(&listing);
        let info = parsed.get("anthropic/claude-opus-5").expect("entry");
        assert_eq!(info.display_name.as_deref(), Some("claude-opus-5"));
        assert_eq!(info.context_length, Some(1_000_000));
        assert_eq!(info.max_output_tokens, Some(128_000));
        assert_eq!(info.prompt_usd, Some(0.000005));
        assert_eq!(info.completion_usd, Some(0.000025));
        assert_eq!(info.cache_read_usd, Some(0.0000005));
        assert_eq!(info.cache_write_usd, Some(0.00000625));
    }

    /// A plain OpenAI-compatible endpoint reports ids and nothing else; it must
    /// produce no entries rather than a row of empty ones.
    #[test]
    fn a_bare_listing_yields_no_entries() {
        assert!(parse_listing(&json!({"data": [{"id": "m-a"}, {"id": "m-b"}]})).is_empty());
        assert!(parse_listing(&json!(["m-a"])).is_empty());
        assert!(parse_listing(&json!({"unexpected": 1})).is_empty());
    }

    /// Numbers and numeric strings are both accepted, and a nonsense price is
    /// dropped rather than poisoning a cost estimate.
    #[test]
    fn numeric_strings_are_accepted_and_junk_is_dropped() {
        let parsed = parse_listing(&json!({"data": [
            {"id": "a", "context_length": "200000", "pricing": {"prompt": 0.001, "completion": "n/a"}},
        ]}));
        let info = parsed.get("a").expect("entry");
        assert_eq!(info.context_length, Some(200_000));
        assert_eq!(info.prompt_usd, Some(0.001));
        assert_eq!(info.completion_usd, None);
        // Half a price list cannot cost a request; the entry is still cached
        // for its window.
        assert!(!info.has_pricing());
    }

    fn priced() -> ModelInfo {
        ModelInfo {
            prompt_usd: Some(0.000005),
            completion_usd: Some(0.000025),
            cache_read_usd: Some(0.0000005),
            cache_write_usd: Some(0.00000625),
            ..Default::default()
        }
    }

    #[test]
    fn cost_bills_cached_prompt_tokens_at_the_cache_rate() {
        let info = priced();
        // 1000 prompt tokens, of which 800 were cache reads and 200 cache
        // writes -- both shares of the prompt, per the normalized usage shape.
        let expected = 800.0 * 0.0000005 + 200.0 * 0.00000625 + 100.0 * 0.000025;
        assert!((info.cost_usd(1000, 100, 800, 200) - expected).abs() < 1e-12);
        // With no cache rates both shares fall back to the prompt rate, so a
        // provider pricing only prompt/completion bills the whole prompt once.
        let flat = ModelInfo {
            prompt_usd: Some(0.001),
            completion_usd: Some(0.0),
            ..Default::default()
        };
        assert!((flat.cost_usd(1000, 500, 400, 200) - 1.0).abs() < 1e-12);
    }

    /// The shape every pipeline produces: `prompt_tokens` already contains the
    /// cache-creation tokens, so they must be billed once, at the write rate.
    #[test]
    fn cache_write_tokens_are_a_share_of_the_prompt_not_an_addition() {
        let info = priced();
        // 100 fresh input + 2000 cache creation reported as prompt_tokens 2100.
        let expected = 100.0 * 0.000005 + 2000.0 * 0.00000625 + 100.0 * 0.000025;
        let cost = info.cost_usd(2100, 100, 0, 2000);
        assert!((cost - expected).abs() < 1e-12, "{cost} != {expected}");
        // Billing the writes twice is what this pins against.
        assert!(cost < expected + 2000.0 * 0.000005 - 1e-12);
    }

    /// Counts that exceed the prompt (a provider reporting the Anthropic shape
    /// unnormalized) must clamp rather than underflow the fresh remainder.
    #[test]
    fn shares_larger_than_the_prompt_cannot_underflow() {
        let info = priced();
        assert!((info.cost_usd(100, 0, 500, 0) - 100.0 * 0.0000005).abs() < 1e-12);
        assert!((info.cost_usd(100, 0, 0, 500) - 100.0 * 0.00000625).abs() < 1e-12);
        let both = info.cost_usd(100, 0, 80, 500);
        assert!((both - (80.0 * 0.0000005 + 20.0 * 0.00000625)).abs() < 1e-12);
    }

    /// Half a price list is not a price list: billing input at $0 would print
    /// a confident, wrong estimate instead of "no published price".
    #[test]
    fn a_half_published_price_is_not_pricing() {
        let completion_only = ModelInfo {
            completion_usd: Some(0.000025),
            ..Default::default()
        };
        assert!(!completion_only.has_pricing());
        let prompt_only = ModelInfo {
            prompt_usd: Some(0.000005),
            ..Default::default()
        };
        assert!(!prompt_only.has_pricing());
        let usage = TokenUsage {
            prompt_tokens: 1000,
            completion_tokens: 100,
            ..Default::default()
        };
        assert_eq!(usage.cost_usd(Some(&completion_only)), None);
        assert!(usage.cost_usd(Some(&priced())).is_some());
    }

    #[test]
    fn a_model_with_no_pricing_cannot_be_costed() {
        let info = ModelInfo {
            context_length: Some(1000),
            ..Default::default()
        };
        assert!(!info.has_pricing());
        assert_eq!(info.cost_usd(1000, 1000, 0, 0), 0.0);
    }

    #[test]
    fn lookup_prefers_the_named_provider_then_falls_back_to_the_bare_id() {
        let mut catalog = Catalog::default();
        catalog.set_provider(
            "tokamak",
            BTreeMap::from([(
                "anthropic/claude-opus-5".to_string(),
                ModelInfo {
                    context_length: Some(1_000_000),
                    ..Default::default()
                },
            )]),
        );
        assert_eq!(
            catalog
                .get(Some("tokamak"), "anthropic/claude-opus-5")
                .and_then(|i| i.context_length),
            Some(1_000_000)
        );
        // A provider that knows nothing still resolves through the global pass.
        assert!(catalog
            .get(Some("other"), "anthropic/claude-opus-5")
            .is_some());
        // The bare id resolves while it is unambiguous.
        assert!(catalog.get(None, "claude-opus-5").is_some());
        assert!(catalog.get(None, "nothing-like-this").is_none());
    }

    /// Two providers can serve one id at two prices, and a request is billed by
    /// exactly one of them. A cached provider's own answer is therefore the
    /// whole answer, and an unqualified lookup across disagreeing providers is
    /// no answer at all rather than whichever sorts first.
    #[test]
    fn a_price_is_never_taken_from_another_provider() {
        let entry = |usd| {
            BTreeMap::from([(
                "gpt-4o".to_string(),
                ModelInfo {
                    prompt_usd: Some(usd),
                    completion_usd: Some(usd),
                    ..Default::default()
                },
            )])
        };
        let mut catalog = Catalog::default();
        catalog.set_provider("a-cheap", entry(0.000001));
        catalog.set_provider("z-dear", entry(0.00001));
        assert_eq!(
            catalog
                .get(Some("z-dear"), "gpt-4o")
                .and_then(|i| i.prompt_usd),
            Some(0.00001)
        );
        assert!(
            catalog.get(None, "gpt-4o").is_none(),
            "with no provider named there is nothing to choose by"
        );
        // A provider that offers the model but has never been listed still
        // falls through, since there is no answer of its own to prefer.
        catalog.set_provider(
            "only-vendor",
            BTreeMap::from([("solo".to_string(), ModelInfo::default())]),
        );
        assert!(catalog.get(Some("only-vendor"), "gpt-4o").is_none());
        assert!(catalog.get(Some("never-listed"), "solo").is_some());
    }

    /// Two vendors serving the same bare name is an ambiguity: guessing one
    /// would silently price a request against the wrong model.
    #[test]
    fn an_ambiguous_bare_id_resolves_to_nothing() {
        let entry = |usd| {
            BTreeMap::from([(
                format!("{usd}/shared-name"),
                ModelInfo {
                    prompt_usd: Some(1.0),
                    ..Default::default()
                },
            )])
        };
        let mut catalog = Catalog::default();
        catalog.set_provider("a", entry("vendor-a"));
        catalog.set_provider("b", entry("vendor-b"));
        assert!(catalog.get(None, "shared-name").is_none());
        assert!(catalog.get(None, "vendor-a/shared-name").is_some());
    }

    #[test]
    fn the_catalog_round_trips_through_disk() {
        with_temp_home(|_| {
            assert_eq!(load(), Catalog::default(), "a missing cache is empty");
            let mut catalog = Catalog::default();
            catalog.set_provider(
                "tokamak",
                parse_listing(&json!({"data": [router_entry("anthropic/claude-opus-5")]})),
            );
            catalog.save().expect("save");
            let reloaded = load();
            assert_eq!(reloaded, catalog);
            assert_eq!(
                reloaded.provider_ids("tokamak"),
                vec!["anthropic/claude-opus-5".to_string()]
            );

            // A provider that reports nothing is dropped rather than left stale.
            let mut catalog = reloaded;
            catalog.set_provider("tokamak", BTreeMap::new());
            catalog.save().expect("save");
            assert!(load().provider_ids("tokamak").is_empty());
        });
    }

    /// A corrupt cache must degrade to "no metadata", never to an error: it only
    /// ever improves a readout.
    #[test]
    fn a_corrupt_cache_reads_as_empty() {
        with_temp_home(|_| {
            let path = catalog_path().unwrap();
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, "{not json").unwrap();
            assert_eq!(load(), Catalog::default());
        });
    }
}
