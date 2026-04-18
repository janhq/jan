#![allow(non_snake_case)]

use serde::{Deserialize, Serialize};

// ============================================================
// OpenAPI 类型（/openapi/v1/*）
// API 返回原始字段为 snake_case/camelCase，保持原样
// ============================================================

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

// ============================================================
// 内部 API 类型（/api/v1/models/*）
// API 返回原始字段为 PascalCase，全链路透传，不做任何 rename/alias
// ============================================================

/// ModelScope 单个文件信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelScopeFile {
    pub Name: String,
    pub Path: String,
    pub Size: i64,
    pub Sha256: Option<String>,
    pub IsLFS: bool,
}

/// ModelScope 文件列表数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelScopeFileListData {
    pub Files: Vec<ModelScopeFile>,
}

/// ModelScope 文件列表响应（内部 API: /api/v1/models/{id}/repo/files）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelScopeFileListApiResponse {
    pub Code: i32,
    pub Success: bool,
    pub Data: ModelScopeFileListData,
    pub Message: Option<String>,
}

/// 前端可用的文件列表响应
#[derive(Debug, Clone, Serialize)]
pub struct ModelScopeFileListResult {
    pub Files: Vec<ModelScopeFile>,
}

/// ModelScope 仓库单个 GGUF 文件信息
/// 注意：API 返回此部分为 snake_case，保持原样
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelScopeRepoFileInfo {
    pub name: String,
    pub size: i64,
    pub sha256: String,
}

/// ModelScope 仓库 GGUF 条目
/// 注意：API 返回此部分为 snake_case，保持原样
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelScopeRepoGgufItem {
    pub key_name: String,
    pub quantized: String,
    pub file_info: Vec<ModelScopeRepoFileInfo>,
}

/// ModelScope 仓库 ModelInfos
/// 注意：API 返回此部分为 snake_case，保持原样
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelScopeRepoModelInfos {
    pub gguf: Option<ModelScopeRepoGgufList>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelScopeRepoGgufList {
    pub gguf_file_list: Vec<ModelScopeRepoGgufItem>,
}

/// ModelScope 仓库组织信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelScopeRepoOrganization {
    pub Name: String,
}

/// ModelScope 仓库数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelScopeRepoData {
    pub Name: String,
    pub Path: String,
    pub Description: String,
    pub Downloads: i64,
    pub CreatedTime: i64,
    pub LastUpdatedTime: i64,
    pub Tags: Vec<String>,
    pub Libraries: Vec<String>,
    pub ReadMeContent: String,
    pub Organization: Option<ModelScopeRepoOrganization>,
    pub ModelInfos: Option<ModelScopeRepoModelInfos>,
}

/// ModelScope 仓库 API 响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelScopeRepoApiResponse {
    pub Code: i32,
    pub Success: bool,
    pub Data: ModelScopeRepoData,
}

/// 前端可用的仓库响应
#[derive(Debug, Clone, Serialize)]
pub struct ModelScopeRepoResult {
    pub Repo: ModelScopeRepoApiResponse,
}
