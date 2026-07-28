//! Read-only plan mode. A first-class run mode for safe repository exploration
//! and plan review: the agent may read/search/list/read-file, do web research,
//! and read memory/skills, but every mutation-capable tool (write/edit/bash,
//! memory_write/skill_write, MCP, subagent dispatch) is blocked at the core
//! dispatcher and never advertised to the model. Enforcement is authoritative;
//! the prompt addendum below is only defense in depth.

use serde::{Deserialize, Serialize};

/// Persisted per-session run mode. `Normal` is the default (normal permission
/// gate / `--yolo`); `Plan` is read-only by enforcement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RunMode {
    #[default]
    Normal,
    Plan,
}

/// System-prompt addendum injected when a run is in `RunMode::Plan`. Wording is
/// defense in depth only: the capability gate rejects mutations regardless.
pub fn plan_mode_prompt_addendum() -> &'static str {
    "PLAN MODE (read only): You are exploring to produce a plan. You may only \
read, search, and list files, do web research, and read memory/skills. You \
CANNOT edit files, run shell commands, or make any change; those tools are \
disabled. Investigate thoroughly, then stage the full phased plan by calling \
the `todo` tool with an `init` action listing every task. When the plan is \
ready, call `ask` with exactly one question: {\"questions\": [{\"id\": \
\"plan_review\", \"question\": \"<concise plan summary>\", \"options\": \
[{\"label\": \"Execute plan\"}, {\"label\": \"Keep planning\"}, {\"label\": \
\"Exit plan mode\"}]}]}. Do not ask for plan review until the todos are staged."
}

/// Reserved `ask` question id the TUI special-cases to drive plan-mode
/// transitions. The model is instructed to emit exactly this id.
pub const PLAN_REVIEW_QUESTION_ID: &str = "plan_review";

/// The three plan-review option labels, in order.
pub const EXECUTE_PLAN_LABEL: &str = "Execute plan";
pub const KEEP_PLANNING_LABEL: &str = "Keep planning";
pub const EXIT_PLAN_LABEL: &str = "Exit plan mode";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_mode_default_is_normal() {
        assert_eq!(RunMode::default(), RunMode::Normal);
    }

    #[test]
    fn run_mode_serializes_snake_case() {
        assert_eq!(
            serde_json::to_value(RunMode::Plan).unwrap(),
            serde_json::json!("plan")
        );
        assert_eq!(
            serde_json::from_value::<RunMode>(serde_json::json!("normal")).unwrap(),
            RunMode::Normal
        );
    }
}
