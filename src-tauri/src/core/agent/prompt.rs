//! Who may write above the cache line, and who decides.
//!
//! A request's reusable region is its *leading* bytes: a provider reuses the
//! prefix it has already seen only while every byte of it is identical to the
//! previous request. Everything that contributes to a request's front --
//! identity, guidelines, the skill and memory catalogs, the advertised tool
//! array -- therefore shares one cache line, and one contributor that changes
//! per turn invalidates every byte behind it.
//!
//! That failure is compositional: each contributor is locally correct, and no
//! single one of them is obviously the culprit. So placement here is declared
//! rather than conventional:
//!
//! - every contribution is a named [`Composer`], enumerated once, in code;
//! - a composer that declares nothing lands in the tail -- the safe answer, and
//!   the one a new composer gets for free;
//! - a composer that is not constant for the session can never sit above the
//!   cache line, and a policy that would put it there fails loudly instead of
//!   costing money quietly;
//! - `[prompt].prefix_allow` can only *narrow* what sits above the line. Moving
//!   something into the prefix is a code change, where "is this constant for a
//!   session" can actually be reviewed.

use serde::Deserialize;

/// Where a composer's contribution sits relative to the cache line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Placement {
    /// Above the cache line: part of the leading bytes a provider can reuse.
    /// Only for content that is constant for the whole session.
    Prefix,
    /// Below the accepted history: free to change every turn. The default,
    /// because a composer has to argue its way into the prefix, not out of it.
    #[default]
    Tail,
}

impl Placement {
    #[cfg_attr(not(feature = "cli"), allow(dead_code))]
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Placement::Prefix => "prefix",
            Placement::Tail => "tail",
        }
    }
}

/// How a composer's content reaches the request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Source {
    /// A block of the system prompt, placed by [`PromptPolicy`].
    PromptBlock,
    /// A request field outside the prompt: the advertised tool array. The wire
    /// format has no tail for it, so it is always above the cache line and the
    /// allowlist does not apply to it.
    RequestField,
}

impl Source {
    #[cfg_attr(not(feature = "cli"), allow(dead_code))]
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Source::PromptBlock => "prompt",
            Source::RequestField => "request_field",
        }
    }
}

/// Every contribution to the front of a request, as the code declares it.
///
/// This enum *is* the registry: [`Composer::ALL`] enumerates it, `agent status`
/// reports it, and the composition in [`crate::core::agent::context`] matches on
/// it exhaustively -- so adding a contributor without deciding its placement
/// does not compile.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Composer {
    // Above the cache line today.
    AssistantInstructions,
    Guidelines,
    WorkingDirectory,
    RuntimeEnvironment,
    SubagentGuide,
    SkillGuide,
    WebToolsGuide,
    ProjectContext,
    Skills,
    MemoryCatalog,
    ToolSchemas,
    // Below it today: per-turn content, so they can never be in the prefix.
    Date,
    GitState,
    MemoryRecall,
    PlanAddendum,
    TodoAddendum,
}

impl Composer {
    /// Every composer, in the order their blocks enter the prompt.
    pub(crate) const ALL: &'static [Composer] = &[
        Composer::AssistantInstructions,
        Composer::Guidelines,
        Composer::WorkingDirectory,
        Composer::RuntimeEnvironment,
        Composer::SubagentGuide,
        Composer::SkillGuide,
        Composer::WebToolsGuide,
        Composer::ProjectContext,
        Composer::Skills,
        Composer::MemoryCatalog,
        Composer::ToolSchemas,
        Composer::Date,
        Composer::GitState,
        Composer::MemoryRecall,
        Composer::PlanAddendum,
        Composer::TodoAddendum,
    ];

    /// The stable id: what `[prompt].prefix_allow` names and `agent status`
    /// prints.
    pub(crate) fn id(self) -> &'static str {
        match self {
            Composer::AssistantInstructions => "assistant_instructions",
            Composer::Guidelines => "guidelines",
            Composer::WorkingDirectory => "working_directory",
            Composer::RuntimeEnvironment => "runtime_environment",
            Composer::SubagentGuide => "subagent_guide",
            Composer::SkillGuide => "skill_guide",
            Composer::WebToolsGuide => "web_tools_guide",
            Composer::ProjectContext => "project_context",
            Composer::Skills => "skills",
            Composer::MemoryCatalog => "memory_catalog",
            Composer::ToolSchemas => "tool_schemas",
            Composer::Date => "date",
            Composer::GitState => "git_state",
            Composer::MemoryRecall => "memory_recall",
            Composer::PlanAddendum => "plan_addendum",
            Composer::TodoAddendum => "todo_addendum",
        }
    }

    /// One line for `agent status` and the docs. Reported by the CLI's status
    /// command only, hence the desktop-build allowance.
    #[cfg_attr(not(feature = "cli"), allow(dead_code))]
    pub(crate) fn what(self) -> &'static str {
        match self {
            Composer::AssistantInstructions => {
                "the assistant's instructions, or the default identity"
            }
            Composer::Guidelines => "the always-on behavioral guidelines",
            Composer::WorkingDirectory => "the project directory relative paths resolve against",
            Composer::RuntimeEnvironment => "OS, architecture, shell, and scratch space",
            Composer::SubagentGuide => "how to delegate context-heavy exploration",
            Composer::SkillGuide => "the skills and memory file conventions",
            Composer::WebToolsGuide => "the native web tools and when to reach for them",
            Composer::ProjectContext => "JAN.md, from the project and its ancestors",
            Composer::Skills => "the installed skill catalog",
            Composer::MemoryCatalog => "the curated memory note catalog",
            Composer::ToolSchemas => "the advertised tool array (a request field)",
            Composer::Date => "today's date",
            Composer::GitState => "the current git branch",
            Composer::MemoryRecall => "memory recalled for this request",
            Composer::PlanAddendum => "the plan-mode instructions",
            Composer::TodoAddendum => "the active todo list",
        }
    }

    pub(crate) fn source(self) -> Source {
        match self {
            Composer::ToolSchemas => Source::RequestField,
            _ => Source::PromptBlock,
        }
    }

    /// The placement this composer asks for. `None` means "no request": the
    /// policy default applies, which is the tail.
    pub(crate) fn declared(self) -> Option<Placement> {
        match self {
            Composer::AssistantInstructions
            | Composer::Guidelines
            | Composer::WorkingDirectory
            | Composer::RuntimeEnvironment
            | Composer::SubagentGuide
            | Composer::SkillGuide
            | Composer::WebToolsGuide
            | Composer::ProjectContext
            | Composer::Skills
            | Composer::MemoryCatalog
            | Composer::ToolSchemas => Some(Placement::Prefix),
            Composer::Date
            | Composer::GitState
            | Composer::MemoryRecall
            | Composer::PlanAddendum
            | Composer::TodoAddendum => None,
        }
    }

    /// Whether this composer's content is constant across the turns of one
    /// run.
    ///
    /// That is what the cache line asks for: composition happens once per run
    /// and every turn of it reuses the same message 0, so a composer whose
    /// bytes can only change when a new run composes the prompt may sit above
    /// the cache line. A composer that reads the clock, the branch, the query,
    /// or the todo list cannot: it would break the prefix on the turn its value
    /// changed. A composer that reads the project directory (project context,
    /// skills, memory) qualifies -- an edit to those files lands on the next
    /// run, which is a new prompt on purpose.
    pub(crate) fn constant(self) -> bool {
        match self {
            Composer::AssistantInstructions
            | Composer::Guidelines
            | Composer::WorkingDirectory
            | Composer::RuntimeEnvironment
            | Composer::SubagentGuide
            | Composer::SkillGuide
            | Composer::WebToolsGuide
            | Composer::ProjectContext
            | Composer::Skills
            | Composer::MemoryCatalog
            | Composer::ToolSchemas => true,
            Composer::Date
            | Composer::GitState
            | Composer::MemoryRecall
            | Composer::PlanAddendum
            | Composer::TodoAddendum => false,
        }
    }

    /// Look a composer up by its id, as `[prompt].prefix_allow` and the status
    /// report spell it.
    pub(crate) fn from_id(id: &str) -> Option<Composer> {
        Composer::ALL.iter().copied().find(|c| c.id() == id)
    }

    /// This composer's position in [`Composer::ALL`]: the order its block
    /// appears in the prompt. Used to merge blocks built by different callers
    /// into one deterministic sequence.
    pub(crate) fn order(self) -> usize {
        Composer::ALL
            .iter()
            .position(|composer| *composer == self)
            .unwrap_or(usize::MAX)
    }
}

/// The resolved `[prompt]` policy: where each composer's content may go.
#[derive(Debug, Clone, Default)]
pub(crate) struct PromptPolicy {
    default: Placement,
    /// `None` when `prefix_allow` is absent, i.e. each composer's own
    /// declaration stands. `Some(list)` narrows the prefix to exactly the
    /// listed ids.
    prefix_allow: Option<Vec<String>>,
}

impl PromptPolicy {
    pub(crate) fn new(default: Placement, prefix_allow: Option<Vec<String>>) -> Self {
        Self {
            default,
            prefix_allow,
        }
    }

    /// The placement for a composer the policy does not mention. Reported by
    /// the CLI's status command only.
    #[cfg_attr(not(feature = "cli"), allow(dead_code))]
    pub(crate) fn default_placement(&self) -> Placement {
        self.default
    }

    /// The configured allowlist, when it is set. Reported by the CLI's status
    /// command only.
    #[cfg_attr(not(feature = "cli"), allow(dead_code))]
    pub(crate) fn prefix_allow(&self) -> Option<&[String]> {
        self.prefix_allow.as_deref()
    }

    /// Reject an allowlist that names something that is not a composer: a typo
    /// would otherwise move a contributor to the tail (or read as an empty
    /// prefix policy) instead of saying what is wrong.
    pub(crate) fn validate(&self) -> Result<(), String> {
        let Some(allow) = &self.prefix_allow else {
            return Ok(());
        };
        let unknown: Vec<&str> = allow
            .iter()
            .filter(|id| Composer::from_id(id).is_none())
            .map(String::as_str)
            .collect();
        if unknown.is_empty() {
            return Ok(());
        }
        let registered: Vec<&str> = Composer::ALL.iter().map(|c| c.id()).collect();
        Err(format!(
            "`[prompt].prefix_allow` names no such composer: {}. Registered composers: {}.",
            unknown.join(", "),
            registered.join(", ")
        ))
    }

    /// Whether the operator explicitly allowed this composer above the cache
    /// line (as opposed to it being there by its own declaration).
    pub(crate) fn explicitly_allowed(&self, composer: Composer) -> bool {
        self.prefix_allow
            .as_ref()
            .is_some_and(|allow| allow.iter().any(|id| id == composer.id()))
    }

    /// Where `composer`'s content goes, or why the policy cannot be honored.
    ///
    /// A hard failure, not a warning: the whole point is that a contributor
    /// which varies cannot quietly reach the cache line. The two ways to ask
    /// for that are a composer that declares `prefix` while varying (a code
    /// bug) and a `[prompt].prefix_allow` that names one (a config bug).
    pub(crate) fn placement_of(&self, composer: Composer) -> Result<Placement, String> {
        // A request field is not a prompt block: the wire format has no tail
        // for it, so no policy can move it and the allowlist does not apply.
        if composer.source() == Source::RequestField {
            return Ok(Placement::Prefix);
        }
        if !composer.constant() {
            if composer.declared() == Some(Placement::Prefix) {
                return Err(format!(
                    "`{}` is declared above the cache line but its content is not constant across \
                     the turns of one run. \
                     A composer that varies would break the cached prefix on the turn its value changed: \
                     declare it in the tail (see Composer::declared), or make it constant.",
                    composer.id()
                ));
            }
            if self.explicitly_allowed(composer) {
                return Err(format!(
                    "`[prompt].prefix_allow` lists `{}`, which varies within a session. Only a composer \
                     that is constant for the session can sit above the cache line; remove it from the list.",
                    composer.id()
                ));
            }
            return Ok(Placement::Tail);
        }
        Ok(if self.prefix_allow.is_some() {
            // An allowlist is the whole answer, not a starting point: what it
            // names sits above the line and everything else sits below it,
            // whatever the composer declared and whatever `default` says. It
            // narrows; it cannot widen.
            if self.explicitly_allowed(composer) {
                Placement::Prefix
            } else {
                Placement::Tail
            }
        } else {
            // No list: the composer's own declaration decides, and `default`
            // answers for one the code does not classify.
            composer.declared().unwrap_or(self.default)
        })
    }

    /// Every composer's resolved placement, for `jan cli agent status` and the
    /// `[prompt]` docs. Fails on the same contradiction composition would.
    #[cfg_attr(not(feature = "cli"), allow(dead_code))]
    pub(crate) fn placements(&self) -> Result<Vec<(Composer, Placement)>, String> {
        self.validate()?;
        Composer::ALL
            .iter()
            .copied()
            .map(|composer| self.placement_of(composer).map(|p| (composer, p)))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_undeclared_composer_takes_the_policy_default() {
        // A composer that asks for nothing is the case a new contributor
        // starts from: the default policy puts it in the tail, so a new writer
        // is safe before anybody reviews it.
        let policy = PromptPolicy::default();
        assert_eq!(Placement::default(), Placement::Tail);
        assert_eq!(Composer::Date.declared(), None);
        assert_eq!(
            policy.placement_of(Composer::Date).unwrap(),
            Placement::Tail
        );
    }

    #[test]
    fn an_undeclared_composer_stays_in_the_tail_even_under_a_blanket_prefix_default() {
        // `default` is a blanket answer, but the constancy rule outranks it:
        // a composer that varies is demoted rather than allowed to break the
        // prefix on the turn it changes.
        let policy = PromptPolicy::new(Placement::Prefix, None);
        assert_eq!(
            policy.placement_of(Composer::Date).unwrap(),
            Placement::Tail
        );
        assert_eq!(
            policy.placement_of(Composer::Guidelines).unwrap(),
            Placement::Prefix
        );
    }

    #[test]
    fn a_declared_prefix_composer_sits_in_the_prefix_by_default() {
        let policy = PromptPolicy::default();
        for composer in Composer::ALL.iter().copied().filter(|c| c.constant()) {
            assert_eq!(
                policy.placement_of(composer).unwrap(),
                Placement::Prefix,
                "{} declares the prefix",
                composer.id()
            );
        }
    }

    #[test]
    fn the_allowlist_narrows_the_prefix_and_denies_win() {
        // The case the issue is about: an operator lists the two contributors
        // they trust above the cache line, and everything else moves below it
        // whatever it asked for.
        let policy = PromptPolicy::new(
            Placement::Tail,
            Some(vec!["assistant_instructions".to_string()]),
        );
        assert_eq!(
            policy
                .placement_of(Composer::AssistantInstructions)
                .unwrap(),
            Placement::Prefix
        );
        assert_eq!(
            policy.placement_of(Composer::Skills).unwrap(),
            Placement::Tail,
            "a declared-prefix composer is denied by an allowlist that omits it"
        );
    }

    #[test]
    fn the_allowlist_is_exhaustive_even_when_the_default_asks_for_the_prefix() {
        // `default` answers for a composer the code does not classify. It must
        // not re-open a narrowed prefix: listing one contributor while leaving
        // `default = "prefix"` would otherwise keep every other declared
        // contributor above the cache line -- the silent widening the
        // allowlist exists to prevent.
        let policy = PromptPolicy::new(
            Placement::Prefix,
            Some(vec!["assistant_instructions".to_string()]),
        );
        assert_eq!(
            policy
                .placement_of(Composer::AssistantInstructions)
                .unwrap(),
            Placement::Prefix
        );
        assert_eq!(
            policy.placement_of(Composer::Guidelines).unwrap(),
            Placement::Tail,
            "the list is exhaustive: a composer it omits is below the line"
        );
        assert_eq!(
            policy.placement_of(Composer::ProjectContext).unwrap(),
            Placement::Tail
        );
        assert_eq!(
            policy.placement_of(Composer::ToolSchemas).unwrap(),
            Placement::Prefix,
            "a request field has no tail to move to"
        );
    }

    #[test]
    fn allowing_a_composer_that_varies_is_a_hard_failure() {
        let policy = PromptPolicy::new(Placement::Tail, Some(vec!["date".to_string()]));
        let error = policy
            .placement_of(Composer::Date)
            .expect_err("a per-turn composer cannot be allowed into the prefix");
        assert!(error.contains("date"), "{error}");
        assert!(error.contains("prefix_allow"), "{error}");
        // ...and the failure is reported for the policy as a whole, so a run
        // cannot start without resolving every composer.
        assert!(policy.placements().is_err());
    }

    #[test]
    fn the_tool_array_cannot_be_moved_out_of_the_prefix() {
        // It is a request field, not a prompt block: `prefix_allow` governs
        // prompt blocks, and the wire format has no tail for tools.
        let policy = PromptPolicy::new(Placement::Tail, Some(vec!["guidelines".to_string()]));
        assert_eq!(
            policy.placement_of(Composer::ToolSchemas).unwrap(),
            Placement::Prefix
        );
    }

    #[test]
    fn composer_ids_are_unique_and_resolvable() {
        let mut ids: Vec<&str> = Composer::ALL.iter().map(|c| c.id()).collect();
        let count = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(
            ids.len(),
            count,
            "ids name composers in config: no duplicates"
        );
        for composer in Composer::ALL {
            assert_eq!(Composer::from_id(composer.id()), Some(*composer));
        }
        assert_eq!(Composer::from_id("nope"), None);
    }

    #[test]
    fn every_composer_is_classified() {
        // The registry's whole job is that nothing is unclassified: a constant
        // composer has to say where it goes, and a varying one has to be
        // reported as varying.
        for composer in Composer::ALL.iter().copied() {
            if composer.constant() {
                assert!(
                    composer.declared().is_some(),
                    "{} is constant, so it must declare a placement",
                    composer.id()
                );
            } else {
                assert_eq!(
                    composer.declared(),
                    None,
                    "{} varies, so it cannot request the prefix",
                    composer.id()
                );
            }
        }
    }

    #[test]
    fn placements_cover_every_composer() {
        let resolved = PromptPolicy::default().placements().unwrap();
        assert_eq!(resolved.len(), Composer::ALL.len());
    }
}
