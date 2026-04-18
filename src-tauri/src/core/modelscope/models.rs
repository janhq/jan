use serde::{Deserialize, Serialize};

/// ModelScope API 模型摘要信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelScopeModel {
    pub id: String,
    pub display_name: Option<String>,
    pub description: Option<String>,
    pub downloads: i64,
    pub likes: i64,
    pub license: Option<String>,
    pub tasks: Vec<String>,
    pub created_at: String,
    pub last_modified: String,
    pub file_size: i64,
    pub params: i64,
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub private: bool,
    #[serde(default)]
    pub gated: bool,
}

/// ModelScope 模型列表分页信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelScopeModelList {
    pub models: Vec<ModelScopeModel>,
    pub total_count: i64,
    pub page_number: i64,
    pub page_size: i64,
}

/// ModelScope 列表接口标准响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelScopeListApiResponse {
    pub success: bool,
    pub data: ModelScopeModelList,
    pub request_id: String,
}

/// ModelScope 模型详情（包含 readme）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelScopeModelDetail {
    #[serde(flatten)]
    pub base: ModelScopeModel,
    pub readme: Option<String>,
}

/// ModelScope 详情接口标准响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelScopeDetailApiResponse {
    pub success: bool,
    pub data: ModelScopeModelDetail,
    pub request_id: String,
}

/// 列表查询参数
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ListModelScopeModelsParams {
    pub search: Option<String>,
    pub owner: Option<String>,
    pub sort: Option<String>, // default | downloads | likes | last_modified
    pub page_number: Option<i64>,
    pub page_size: Option<i64>,
    pub filter_task: Option<String>,
    pub filter_library: Option<String>,
    pub filter_model_type: Option<String>,
    pub filter_custom_tag: Option<String>,
    pub filter_license: Option<String>,
    pub filter_deploy: Option<String>,
}

/// 前端可用的模型列表响应
#[derive(Debug, Clone, Serialize)]
pub struct ModelScopeModelsResult {
    pub models: Vec<ModelScopeModel>,
    pub total_count: i64,
    pub page_number: i64,
    pub page_size: i64,
}

/// 前端可用的模型详情响应
#[derive(Debug, Clone, Serialize)]
pub struct ModelScopeDetailResult {
    pub model: ModelScopeModelDetail,
}
