use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Task ID for tracking OpenCode processes
pub type TaskId = String;

/// Status of a running OpenCode task
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Starting,
    Running,
    WaitingPermission,
    Completed,
    Cancelled,
    Error(String),
}

// ============================================================================
// Messages FROM Jan TO OpenCode (stdin)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum JanToOpenCode {
    Task { id: String, payload: TaskPayload },
    PermissionResponse { id: String, payload: PermissionResponsePayload },
    Cancel { id: String, payload: CancelPayload },
    Input { id: String, payload: InputPayload },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskPayload {
    #[serde(rename = "sessionId", skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(rename = "projectPath")]
    pub project_path: String,
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionResponsePayload {
    #[serde(rename = "permissionId")]
    pub permission_id: String,
    pub action: PermissionAction,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionAction {
    AllowOnce,
    AllowAlways,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CancelPayload {
    #[serde(rename = "sessionId", skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputPayload {
    pub text: String,
}

// ============================================================================
// Messages FROM OpenCode TO Jan (stdout)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OpenCodeToJan {
    Ready { id: String, payload: ReadyPayload },
    Event { id: String, payload: EventPayloadWrapper },
    PermissionRequest { id: String, payload: PermissionRequestPayload },
    Result { id: String, payload: ResultPayload },
    Error { id: String, payload: ErrorPayload },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadyPayload {
    pub version: String,
    #[serde(rename = "projectPath")]
    pub project_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventPayloadWrapper {
    pub event: OpenCodeEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum OpenCodeEvent {
    #[serde(rename = "session.started")]
    SessionStarted {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    #[serde(rename = "step.started")]
    StepStarted { step: u32 },
    #[serde(rename = "step.completed")]
    StepCompleted { step: u32 },
    #[serde(rename = "tool.started")]
    ToolStarted {
        tool: String,
        input: serde_json::Value,
    },
    #[serde(rename = "tool.completed")]
    ToolCompleted {
        tool: String,
        output: serde_json::Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
    },
    #[serde(rename = "text.delta")]
    TextDelta { text: String },
    #[serde(rename = "text.complete")]
    TextComplete { text: String },
    #[serde(rename = "reasoning.delta")]
    ReasoningDelta { text: String },
    #[serde(rename = "file.changed")]
    FileChanged {
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        diff: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRequestPayload {
    #[serde(rename = "permissionId")]
    pub permission_id: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub permission: String,
    pub patterns: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HashMap<String, serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResultPayload {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub status: ResultStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(rename = "filesChanged", skip_serializing_if = "Option::is_none")]
    pub files_changed: Option<Vec<String>>,
    #[serde(rename = "tokensUsed", skip_serializing_if = "Option::is_none")]
    pub tokens_used: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResultStatus {
    Completed,
    Cancelled,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}
