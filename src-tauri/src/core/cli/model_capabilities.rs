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

/// Strip the configured provider qualifiers (`anthropic/...`) in front of a
/// bare id, as long as each leading segment is one of Jan's catalog providers.
/// A user-provided model id is normally the bare id, but `--model
/// anthropic/claude-sonnet-4-6` and the desktop selection can carry the
/// provider prefix, and a gateway route nests one more
/// (`tokamak/anthropic/claude-...`); all of them must resolve alike.
fn strip_provider_qualifier(mut model_id: &str) -> &str {
    while let Some((first, rest)) = model_id.split_once('/') {
        match first {
            "anthropic" | "openai" | "google" | "tokamak" | "jan" => model_id = rest,
            _ => break,
        }
    }
    model_id
}

/// The `(major, minor)` generation at the front of a Claude version suffix:
/// `4-6` -> (4, 6), `5` -> (5, 0), `4-5-20250929` -> (4, 5). A trailing date
/// snapshot is not a minor version, so an 8-digit segment ends the parse.
fn claude_generation(version: &str) -> (u32, u32) {
    let mut parts = version.split('-').map(|p| {
        if p.len() >= 8 { None } else { p.parse::<u32>().ok() }
    });
    let major = parts.next().flatten().unwrap_or(0);
    let minor = parts.next().flatten().unwrap_or(0);
    (major, minor)
}

/// Look up the catalog window for a bare model id (provider qualifier already
/// stripped). `None` means the id matches no known family -> fallback.
fn catalog_window(model_id: &str) -> Option<u64> {
    // Claude family, per Anthropic's models overview: Sonnet 4.6, Opus 4.6
    // and every later Opus/Sonnet generation, and the Fable and Mythos lines,
    // are 1M by default (no beta header). Everything else, Haiku included, is
    // 200K. Matched by generation so a new point release is not 200K by default.
    if let Some(rest) = model_id.strip_prefix("claude-") {
        let one_million = ["fable-", "mythos-"].iter().any(|f| rest.starts_with(f))
            || ["opus-", "sonnet-"].iter().any(|family| {
                rest.strip_prefix(family)
                    .is_some_and(|version| claude_generation(version) >= (4, 6))
            });
        return Some(if one_million { 1_000_000 } else { 200_000 });
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
    // gpt-4.1 and its mini/nano variants (and their dated snapshots).
    if model_id.starts_with("gpt-4.1") {
        return Some(1_047_576);
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
            resolve_context_window("gpt-4.1", None, None).tokens,
            1_047_576
        );
        assert_eq!(
            resolve_context_window("gpt-4.1-mini-2025-04-14", None, None).tokens,
            1_047_576
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

    /// Anthropic's current lineup: Sonnet/Opus 4.6 and later, Fable and Mythos
    /// are 1M by default; older generations and every Haiku are 200K. A dated
    /// snapshot suffix must not read as a minor version.
    #[test]
    fn claude_windows_follow_the_generation() {
        let window = |m: &str| resolve_context_window(m, None, None).tokens;
        for m in [
            "claude-sonnet-4-6",
            "claude-opus-4-7",
            "claude-opus-4-8",
            "claude-opus-5",
            "claude-sonnet-5",
            "claude-fable-5-1",
            "claude-mythos-5",
        ] {
            assert_eq!(window(m), 1_000_000, "{m}");
        }
        for m in [
            "claude-sonnet-4-5",
            "claude-sonnet-4-5-20250929",
            "claude-sonnet-4-20250514",
            "claude-opus-4-1",
            "claude-opus-4-5",
            "claude-haiku-4-5",
            "claude-haiku-4-6",
            "claude-3-7-sonnet-latest",
        ] {
            assert_eq!(window(m), 200_000, "{m}");
        }
    }

    #[test]
    fn provider_qualifier_does_not_change_resolution() {
        let bare = resolve_context_window("claude-sonnet-4-6", None, None);
        assert_eq!(resolve_context_window("anthropic/claude-sonnet-4-6", None, None), bare);
        // A gateway route nests its upstream's qualifier inside its own.
        assert_eq!(resolve_context_window("tokamak/anthropic/claude-sonnet-4-6", None, None), bare);
        // Only known qualifiers are peeled: an unknown one stops the walk.
        assert_eq!(
            resolve_context_window("tokamak/azure/claude-sonnet-4-6", None, None).source,
            ContextWindowSource::Fallback,
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

    /// Tokamak reports each model's window in its `/models` listing, and that
    /// figure is authoritative: the Claude catalog rows only fill in when the
    /// listing said nothing, so a catalog change can never override it.
    #[test]
    fn tokamak_reported_window_beats_the_claude_catalog() {
        for (model, reported) in [
            ("tokamak/anthropic/claude-opus-5", 400_000),
            ("tokamak/anthropic/claude-sonnet-4-5", 1_000_000),
        ] {
            assert_eq!(
                resolve_context_window(model, None, Some(reported)),
                ResolvedContextWindow {
                    tokens: reported,
                    source: ContextWindowSource::Provider,
                },
                "{model}"
            );
        }
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
