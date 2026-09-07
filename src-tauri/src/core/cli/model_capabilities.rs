//! Pure per-model context-window resolution for the CLI.
//!
//! The effective context window comes from the selected model unless the
//! project explicitly configures one. This module resolves that without any
//! provider metadata request: a small fixed catalog of known model families
//! covers the models Jan ships, and everything else falls back to a
//! conservative default. The resolved value drives the header gauge and
//! proactive compaction, and is deliberately never sent up as a generation
//! parameter.

pub(crate) const FALLBACK_CONTEXT_WINDOW: u64 = 128_000;

/// Where a resolved context window came from. `Configured` is authoritative:
/// `[agent].context_window` wins outright. `Catalog` is the built-in model
/// family table. `Fallback` is the conservative default for an unknown model.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ContextWindowSource {
    Configured,
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

/// Resolve the effective context window for `model_id`. `configured` (from
/// `[agent].context_window`) is authoritative when set; otherwise the built-in
/// catalog is consulted; an unknown model gets the conservative fallback.
pub(crate) fn resolve_context_window(
    model_id: &str,
    configured: Option<u64>,
) -> ResolvedContextWindow {
    if let Some(tokens) = configured {
        return ResolvedContextWindow {
            tokens,
            source: ContextWindowSource::Configured,
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
        let resolved = resolve_context_window("claude-sonnet-4-6", Some(333_000));
        assert_eq!(resolved.tokens, 333_000);
        assert_eq!(resolved.source, ContextWindowSource::Configured);
    }

    #[test]
    fn catalog_resolves_supported_model_families() {
        assert_eq!(
            resolve_context_window("claude-sonnet-4-5", None).tokens,
            200_000
        );
        assert_eq!(
            resolve_context_window("claude-sonnet-4-6", None).tokens,
            1_000_000
        );
        assert_eq!(resolve_context_window("gpt-5.2", None).tokens, 400_000);
        assert_eq!(
            resolve_context_window("gpt-5.2-codex", None).tokens,
            272_000
        );
        assert_eq!(
            resolve_context_window("gemini-3-pro", None).tokens,
            1_000_000
        );
    }

    #[test]
    fn provider_qualifier_does_not_change_resolution() {
        assert_eq!(
            resolve_context_window("anthropic/claude-sonnet-4-6", None),
            resolve_context_window("claude-sonnet-4-6", None),
        );
    }

    #[test]
    fn unknown_model_uses_conservative_fallback() {
        assert_eq!(
            resolve_context_window("private-gateway-model", None),
            ResolvedContextWindow {
                tokens: 128_000,
                source: ContextWindowSource::Fallback,
            },
        );
    }

    #[test]
    fn non_catalog_provider_qualifier_is_not_stripped() {
        // A provider Jan doesn't ship keeps its qualifier: the id must still
        // fall through to the conservative default rather than mis-matching.
        assert_eq!(
            resolve_context_window("azure/claude-sonnet-4-6", None).source,
            ContextWindowSource::Fallback,
        );
    }
}
