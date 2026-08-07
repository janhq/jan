use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{oneshot, Mutex};

const OTHER_LABEL: &str = "Other (type your own)";
static NEXT_ASK_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AskRequest {
    pub(crate) questions: Vec<Question>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct Question {
    pub id: String,
    pub question: String,
    pub options: Vec<OptionItem>,
    #[serde(default)]
    pub multi: bool,
    #[serde(default)]
    pub recommended: Option<usize>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct OptionItem {
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
}

// `pub`, not `pub(crate)`: reachable through the `pub` `agent_ask_respond`
// Tauri command's parameter type (see `AgentAsks` in commands.rs) — same
// reasoning as `PermissionDecision`.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct QuestionResult {
    pub id: String,
    #[serde(default)]
    pub selected: Vec<String>,
    #[serde(default)]
    pub custom_input: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum AskError {
    Cancelled,
}

pub(crate) type AskOutcome = Result<Vec<QuestionResult>, AskError>;
pub(crate) type AskRegistry = Arc<Mutex<HashMap<String, oneshot::Sender<AskOutcome>>>>;

impl AskRequest {
    pub(crate) fn parse(value: &Value) -> Result<Self, String> {
        let request: Self = serde_json::from_value(value.clone())
            .map_err(|e| format!("invalid ask request: {e}"))?;
        if request.questions.is_empty() {
            return Err("ask requires at least one question".into());
        }
        let mut ids = HashSet::new();
        for question in &request.questions {
            if question.id.trim().is_empty() || !ids.insert(question.id.as_str()) {
                return Err("question ids must be non-empty and unique".into());
            }
            if question.question.trim().is_empty() {
                return Err(format!("question '{}' has no prompt", question.id));
            }
            if !(2..=5).contains(&question.options.len()) {
                return Err(format!(
                    "question '{}' requires 2 to 5 options",
                    question.id
                ));
            }
            let mut labels = HashSet::new();
            for option in &question.options {
                if option.label.trim().is_empty()
                    || option.label == OTHER_LABEL
                    || !labels.insert(option.label.as_str())
                {
                    return Err(format!(
                        "question '{}' option labels must be non-empty, unique, and omit '{OTHER_LABEL}'",
                        question.id
                    ));
                }
            }
            if question
                .recommended
                .is_some_and(|index| index >= question.options.len())
            {
                return Err(format!(
                    "question '{}' recommended index is out of range",
                    question.id
                ));
            }
        }
        Ok(request)
    }

    pub(crate) fn validate_results(&self, results: &[QuestionResult]) -> Result<(), String> {
        if results.len() != self.questions.len() {
            return Err("ask response must answer every question exactly once".into());
        }
        let mut ids = HashSet::new();
        for result in results {
            if !ids.insert(result.id.as_str()) {
                return Err(format!("duplicate answer for '{}'", result.id));
            }
            let question = self
                .questions
                .iter()
                .find(|question| question.id == result.id)
                .ok_or_else(|| format!("unknown question id '{}'", result.id))?;
            let has_custom = result
                .custom_input
                .as_deref()
                .is_some_and(|text| !text.trim().is_empty());
            if result.custom_input.is_some() && !has_custom {
                return Err(format!("custom answer for '{}' cannot be empty", result.id));
            }
            if has_custom && !result.selected.is_empty() {
                return Err(format!(
                    "answer '{}' cannot select options and custom text",
                    result.id
                ));
            }
            if !has_custom && result.selected.is_empty() {
                return Err(format!("question '{}' requires an answer", result.id));
            }
            if !question.multi && result.selected.len() > 1 {
                return Err(format!("question '{}' accepts one option", result.id));
            }
            let mut selected = HashSet::new();
            for label in &result.selected {
                if !selected.insert(label.as_str())
                    || !question.options.iter().any(|option| option.label == *label)
                {
                    return Err(format!("invalid option '{label}' for '{}'", result.id));
                }
            }
        }
        Ok(())
    }
}

pub(crate) fn ask_tool_schema() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "ask",
            "description": "Ask the user one or more structured questions. Use only when the answer materially changes the work.",
            "parameters": {
                "type": "object",
                "properties": {
                    "questions": {
                        "type": "array",
                        "minItems": 1,
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "string" },
                                "question": { "type": "string" },
                                "options": {
                                    "type": "array",
                                    "minItems": 2,
                                    "maxItems": 5,
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "label": { "type": "string" },
                                            "description": { "type": "string" }
                                        },
                                        "required": ["label"],
                                        "additionalProperties": false
                                    }
                                },
                                "multi": { "type": "boolean" },
                                "recommended": { "type": "integer", "minimum": 0 }
                            },
                            "required": ["id", "question", "options"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": ["questions"],
                "additionalProperties": false
            }
        }
    })
}

pub(crate) fn new_registry() -> AskRegistry {
    Arc::new(Mutex::new(HashMap::new()))
}

pub(crate) async fn register(registry: &AskRegistry) -> (String, oneshot::Receiver<AskOutcome>) {
    let id = format!("ask-{}", NEXT_ASK_ID.fetch_add(1, Ordering::Relaxed));
    let (sender, receiver) = oneshot::channel();
    registry.lock().await.insert(id.clone(), sender);
    (id, receiver)
}

pub(crate) async fn respond(
    registry: &AskRegistry,
    request_id: &str,
    outcome: AskOutcome,
) -> Result<(), String> {
    let sender = registry
        .lock()
        .await
        .remove(request_id)
        .ok_or_else(|| format!("ask request '{request_id}' is no longer pending"))?;
    sender
        .send(outcome)
        .map_err(|_| format!("ask request '{request_id}' is no longer pending"))
}

pub(crate) async fn cancel_all(registry: &AskRegistry) {
    let pending = std::mem::take(&mut *registry.lock().await);
    for (_, sender) in pending {
        let _ = sender.send(Err(AskError::Cancelled));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request() -> AskRequest {
        AskRequest::parse(&json!({
            "questions": [{
                "id": "scope",
                "question": "Which scope?",
                "options": [
                    {"label": "Small", "description": "Only this module"},
                    {"label": "Large"}
                ],
                "multi": false,
                "recommended": 0
            }]
        }))
        .unwrap()
    }

    #[test]
    fn parses_valid_request_and_rejects_invalid_shapes() {
        let parsed = request();
        assert_eq!(parsed.questions[0].id, "scope");
        assert_eq!(parsed.questions[0].options.len(), 2);
        assert_eq!(parsed.questions[0].recommended, Some(0));

        for invalid in [
            json!({"questions": []}),
            json!({"questions": [{"id":"x","question":"?","options":[{"label":"one"}]}]}),
            json!({"questions": [
                {"id":"x","question":"?","options":[{"label":"one"},{"label":"two"}]},
                {"id":"x","question":"again?","options":[{"label":"one"},{"label":"two"}]}
            ]}),
            json!({"questions": [{"id":"x","question":"?","options":[{"label":"one"},{"label":"Other (type your own)"}]}]}),
            json!({"questions": [{"id":"x","question":"?","options":[{"label":"one"},{"label":"two"}],"recommended":2}]}),
        ] {
            assert!(AskRequest::parse(&invalid).is_err(), "accepted {invalid}");
        }
    }

    #[test]
    fn validates_structured_results_against_stable_ids_and_labels() {
        let req = request();
        let result = vec![QuestionResult {
            id: "scope".into(),
            selected: vec!["Small".into()],
            custom_input: None,
        }];
        assert!(req.validate_results(&result).is_ok());

        let unknown = vec![QuestionResult {
            id: "scope".into(),
            selected: vec!["Missing".into()],
            custom_input: None,
        }];
        assert!(req.validate_results(&unknown).is_err());

        let both = vec![QuestionResult {
            id: "scope".into(),
            selected: vec!["Small".into()],
            custom_input: Some("custom".into()),
        }];
        assert!(req.validate_results(&both).is_err());
    }

    #[tokio::test]
    async fn registry_rejects_stale_response_and_cancel_drains_waiters() {
        let registry = new_registry();
        let (first_id, first_rx) = register(&registry).await;
        let (second_id, second_rx) = register(&registry).await;
        assert_ne!(first_id, second_id);
        assert_eq!(registry.lock().await.len(), 2);

        assert!(respond(&registry, "missing", Ok(vec![])).await.is_err());
        cancel_all(&registry).await;
        assert!(matches!(first_rx.await.unwrap(), Err(AskError::Cancelled)));
        assert!(matches!(second_rx.await.unwrap(), Err(AskError::Cancelled)));
        assert!(registry.lock().await.is_empty());
    }
}
