//! Pure per-model context-window resolution for the CLI.
//!
//! The effective context window comes from the selected model unless the
//! project explicitly configures one. Resolution is pure: the caller supplies
//! the configured override and whatever the provider itself reported (cached in
//! [`super::model_catalog`] from its `/models` listing, via [`reported_window`]),
//! and a small fixed catalog of known model families covers the rest, with a
//! conservative default under everything. The resolved value drives the header gauge and
//! proactive compaction, and is deliberately never sent up as a generation
//! parameter.

pub(crate) const FALLBACK_CONTEXT_WINDOW: u64 = 128_000;

/// Where a resolved context window came from. `Configured` is authoritative:
/// `[agent].context_window` wins outright. `Provider` is the window the
/// provider's own `/models` listing reported, which beats guessing. `Catalog`
/// is the built-in model family table. `Fallback` is the conservative default
/// for an unknown model.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ContextWindowSource {
    Configured,
    Provider,
    Catalog,
    Fallback,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ResolvedContextWindow {
    pub(crate) tokens: u64,
    pub(crate) source: ContextWindowSource,
}

impl ContextWindowSource {
    /// Short label shown in the header: `ctx N/K <configured|catalog|fallback>`.
    pub(crate) fn label(self) -> &'static str {
        match self {
            ContextWindowSource::Configured => "configured",
            ContextWindowSource::Provider => "provider",
            ContextWindowSource::Catalog => "catalog",
            ContextWindowSource::Fallback => "fallback",
        }
    }
}

/// Strip exactly one configured provider qualifier (`anthropic/...`) when the
/// first segment is one of Jan's catalog providers. A user-provided model id is
/// normally the bare id, but `--model anthropic/claude-sonnet-4-6` and the
/// desktop selection can carry the provider prefix; both must resolve alike.
fn strip_provider_qualifier(model_id: &str) -> &str {
    let mut parts = model_id.splitn(2, '/');
    let first = parts.next().unwrap_or("");
    match (first, parts.next()) {
        ("anthropic" | "openai" | "google" | "tokamak" | "jan", Some(rest)) => rest,
        _ => model_id,
    }
}

/// Look up the catalog window for a bare model id (provider qualifier already
/// stripped). `None` means the id matches no known family -> fallback.
fn catalog_window(model_id: &str) -> Option<u64> {
    // Claude family: the two newest releases get 1M, everything else claude 200K.
    if model_id.starts_with("claude-") {
        let is_new = ["haiku", "sonnet", "opus"]
            .iter()
            .any(|family| {
                let prefix = format!("claude-{family}-4-6");
                let prefix7 = format!("claude-{family}-4-7");
                model_id.starts_with(&prefix) || model_id.starts_with(&prefix7)
            });
        return Some(if is_new { 1_000_000 } else { 200_000 });
    }

    // Codex variants are matched before the base gpt-5.x rows they contain.
    if model_id == "gpt-5.1-codex"
        || model_id == "gpt-5.2-codex"
        || model_id == "gpt-5.3-codex"
    {
        return Some(272_000);
    }
    if model_id == "gpt-5.1" || model_id == "gpt-5.2" {
        return Some(400_000);
    }
    if model_id == "gpt-5.4" || model_id == "gpt-5.5" {
        return Some(1_050_000);
    }
    if model_id == "gpt-4" || model_id == "gpt-4o" || model_id == "gpt-4o-mini" {
        return Some(128_000);
    }

    if model_id.starts_with("gemini-2.5-") || model_id.starts_with("gemini-3-") {
        return Some(1_000_000);
    }
    if model_id.starts_with("tokamak-") {
        return Some(200_000);
    }

    None
}

/// The window the provider itself reported for `model_id`, from the cached
/// `/models` listing. `None` when nothing was cached (a plain
/// OpenAI-compatible endpoint reports only ids) or the model is unknown to it.
pub(crate) fn reported_window(model_id: &str) -> Option<u64> {
    super::model_catalog::load()
        .get(None, model_id)
        .and_then(|info| info.context_length)
        .filter(|tokens| *tokens > 0)
}

/// Resolve the effective context window for `model_id`. `configured` (from
/// `[agent].context_window`) is authoritative when set, then `reported` (what
/// the provider's own listing said, via [`reported_window`]), then the built-in
/// catalog; an unknown model gets the conservative fallback.
pub(crate) fn resolve_context_window(
    model_id: &str,
    configured: Option<u64>,
    reported: Option<u64>,
) -> ResolvedContextWindow {
    if let Some(tokens) = configured {
        return ResolvedContextWindow {
            tokens,
            source: ContextWindowSource::Configured,
        };
    }
    // The provider knows its own deployment: a gateway serving a 1M-window
    // variant of a model the catalog knows at 200K is right and the table is
    // wrong.
    if let Some(tokens) = reported.filter(|t| *t > 0) {
        return ResolvedContextWindow {
            tokens,
            source: ContextWindowSource::Provider,
        };
    }
    let bare = strip_provider_qualifier(model_id);
    match catalog_window(bare) {
        Some(tokens) => ResolvedContextWindow {
            tokens,
            source: ContextWindowSource::Catalog,
        },
        None => ResolvedContextWindow {
            tokens: FALLBACK_CONTEXT_WINDOW,
            source: ContextWindowSource::Fallback,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configured_window_overrides_every_catalog_entry() {
        let resolved = resolve_context_window("claude-sonnet-4-6", Some(333_000), None);
        assert_eq!(resolved.tokens, 333_000);
        assert_eq!(resolved.source, ContextWindowSource::Configured);
    }

    #[test]
    fn catalog_resolves_supported_model_families() {
        assert_eq!(
            resolve_context_window("claude-sonnet-4-5", None, None).tokens,
            200_000
        );
        assert_eq!(
            resolve_context_window("claude-sonnet-4-6", None, None).tokens,
            1_000_000
        );
        assert_eq!(
            resolve_context_window("gpt-5.2", None, None).tokens,
            400_000
        );
        assert_eq!(
            resolve_context_window("gpt-5.2-codex", None, None).tokens,
            272_000
        );
        assert_eq!(
            resolve_context_window("gemini-3-pro", None, None).tokens,
            1_000_000
        );
    }

    #[test]
    fn provider_qualifier_does_not_change_resolution() {
        assert_eq!(
            resolve_context_window("anthropic/claude-sonnet-4-6", None, None),
            resolve_context_window("claude-sonnet-4-6", None, None),
        );
    }

    #[test]
    fn unknown_model_uses_conservative_fallback() {
        assert_eq!(
            resolve_context_window("private-gateway-model", None, None),
            ResolvedContextWindow {
                tokens: 128_000,
                source: ContextWindowSource::Fallback,
            },
        );
    }

    /// What the provider reports beats the built-in table, and loses only to an
    /// explicit `[agent].context_window`.
    #[test]
    fn a_provider_reported_window_outranks_the_catalog() {
        let resolved = resolve_context_window("claude-sonnet-4-5", None, Some(1_000_000));
        assert_eq!(resolved.tokens, 1_000_000);
        assert_eq!(resolved.source, ContextWindowSource::Provider);

        assert_eq!(
            resolve_context_window("claude-sonnet-4-5", Some(50_000), Some(1_000_000)),
            ResolvedContextWindow {
                tokens: 50_000,
                source: ContextWindowSource::Configured,
            }
        );
        // A model the table has never heard of stops falling back to 128K the
        // moment its provider says otherwise.
        assert_eq!(
            resolve_context_window("openai/gpt-oss-120b-medium", None, Some(131_072)),
            ResolvedContextWindow {
                tokens: 131_072,
                source: ContextWindowSource::Provider,
            }
        );
        // A nonsense report is ignored rather than yielding a zero window.
        assert_eq!(
            resolve_context_window("claude-sonnet-4-5", None, Some(0)).source,
            ContextWindowSource::Catalog
        );
    }

    #[test]
    fn non_catalog_provider_qualifier_is_not_stripped() {
        // A provider Jan doesn't ship keeps its qualifier: the id must still
        // fall through to the conservative default rather than mis-matching.
        assert_eq!(
            resolve_context_window("azure/claude-sonnet-4-6", None, None).source,
            ContextWindowSource::Fallback,
        );
    }
}
