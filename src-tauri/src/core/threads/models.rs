use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Thread {
    pub id: String,
    pub object: String,
    pub title: String,
    pub assistants: Vec<ThreadAssistantInfo>,
    pub created: i64,
    pub updated: i64,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThreadMessage {
    pub id: String,
    pub object: String,
    pub thread_id: String,
    pub assistant_id: Option<String>,
    pub attachments: Option<Vec<Attachment>>,
    pub role: String,
    pub content: Vec<ThreadContent>,
    pub status: String,
    pub created_at: i64,
    pub completed_at: i64,
    pub metadata: Option<serde_json::Value>,
    pub type_: Option<String>,
    pub error_code: Option<String>,
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Attachment {
    pub file_id: Option<String>,
    pub tools: Option<Vec<Tool>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum Tool {
    #[serde(rename = "file_search")]
    FileSearch,
    #[serde(rename = "code_interpreter")]
    CodeInterpreter,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThreadContent {
    pub type_: String,
    pub text: Option<ContentValue>,
    pub image_url: Option<ImageContentValue>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ContentValue {
    pub value: String,
    pub annotations: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImageContentValue {
    pub detail: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThreadAssistantInfo {
    pub id: String,
    pub name: String,
    pub model: ModelInfo,
    pub instructions: Option<String>,
    pub tools: Option<Vec<AssistantTool>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub settings: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum AssistantTool {
    #[serde(rename = "code_interpreter")]
    CodeInterpreter,
    #[serde(rename = "retrieval")]
    Retrieval,
    #[serde(rename = "function")]
    Function {
        name: String,
        description: Option<String>,
        parameters: Option<serde_json::Value>,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThreadState {
    pub has_more: bool,
    pub waiting_for_response: bool,
    pub error: Option<String>,
    pub last_message: Option<String>,
}
