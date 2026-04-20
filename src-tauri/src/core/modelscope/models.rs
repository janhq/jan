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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ModelScopeFile {
    pub Name: String,
    pub Path: String,
    pub Size: i64,
    pub Sha256: Option<String>,
    pub IsLFS: bool,
    pub Type: String,
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

// ============================================================
// 下载配置类型（model_catalog.json / download_config.json）
// ============================================================

/// ModelScope 下载配置（轻量 JSON，模型市场写，推理中心读）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModelScopeDownloadConfig {
    /// 用户配置的下载目录列表
    pub download_dirs: Vec<String>,
    /// 下载历史记录
    pub downloads: Vec<ModelScopeDownloadRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelScopeDownloadRecord {
    pub model_id: String,
    pub quant_dir: Option<String>,
    pub save_dir: String,
    pub downloaded_at: String, // ISO 8601
    pub files_count: usize,
    pub total_size_bytes: u64,
}

/// 批量下载请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelScopeBatchDownloadRequest {
    pub model_id: String,
    pub quant_dir: Option<String>,
    /// 指定单个文件路径（优先于 quant_dir，用于单文件下载）
    pub file_path: Option<String>,
    /// 下载后重命名（仅当 file_path 指定时有效）
    pub save_name: Option<String>,
    pub save_dir: String,
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

// ============================================================
// Tests - based on real ModelScope API responses
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    // Real response from:
    // GET https://modelscope.cn/api/v1/models/qwen/Qwen2.5-0.5B-Instruct-GGUF/repo/files?Recursive=true
    const REAL_QWEN_RESPONSE: &str = r#"
    {
      "Code": 200,
      "Success": true,
      "Data": {
        "Files": [
          {
            "CommitMessage": "merge main",
            "CommittedDate": 1726842501,
            "CommitterName": "ai-modelscope",
            "InCheck": false,
            "IsLFS": false,
            "Mode": "33188",
            "Name": ".gitattributes",
            "Path": ".gitattributes",
            "Revision": "cbee0850956aeb6fd9ac074a0270da820788ada7",
            "Sha256": "c04fe798248680304f09bdd123b107f87a982ab46bb8a4286864c465adf7f486",
            "Size": 1630,
            "Type": "blob"
          },
          {
            "CommitMessage": "upload weights",
            "CommittedDate": 1726665606,
            "CommitterName": "ai-modelscope",
            "InCheck": false,
            "IsLFS": true,
            "Mode": "33188",
            "Name": "qwen2.5-0.5b-instruct-q4_k_m.gguf",
            "Path": "qwen2.5-0.5b-instruct-q4_k_m.gguf",
            "Revision": "2e50b77b0eee3083842019e257b74854323d880a",
            "Sha256": "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db",
            "Size": 491400032,
            "Type": "blob"
          }
        ]
      },
      "Message": "success",
      "RequestId": "test-request-id"
    }
    "#;

    #[test]
    fn test_parse_real_qwen_response() {
        let resp: ModelScopeFileListApiResponse = serde_json::from_str(REAL_QWEN_RESPONSE)
            .expect("should parse real qwen response");

        assert!(resp.Success);
        assert_eq!(resp.Code, 200);
        assert_eq!(resp.Data.Files.len(), 2);

        // First file: .gitattributes
        let first = &resp.Data.Files[0];
        assert_eq!(first.Name, ".gitattributes");
        assert_eq!(first.Path, ".gitattributes");
        assert_eq!(first.Size, 1630);
        assert_eq!(
            first.Sha256,
            Some("c04fe798248680304f09bdd123b107f87a982ab46bb8a4286864c465adf7f486".to_string())
        );
        assert!(!first.IsLFS);

        // Second file: q4_k_m GGUF
        let second = &resp.Data.Files[1];
        assert_eq!(second.Name, "qwen2.5-0.5b-instruct-q4_k_m.gguf");
        assert_eq!(second.Size, 491400032);
        assert!(second.IsLFS);
    }

    #[test]
    fn test_parse_response_with_extra_fields() {
        // ModelScope API returns many extra fields (CommitMessage, Revision, Type, etc.)
        // serde should ignore them by default
        let json = r#"{
            "Code": 200,
            "Success": true,
            "Data": {
                "Files": [
                    {
                        "Name": "test.gguf",
                        "Path": "test.gguf",
                        "Size": 123,
                        "Sha256": "abc",
                        "IsLFS": true,
                        "ExtraField": "should be ignored",
                        "NestedExtra": { "foo": 1 }
                    }
                ],
                "ExtraData": "ignored"
            },
            "Message": "success",
            "ExtraTopLevel": 42
        }"#;

        let resp: ModelScopeFileListApiResponse = serde_json::from_str(json)
            .expect("should ignore extra fields");

        assert_eq!(resp.Data.Files.len(), 1);
        assert_eq!(resp.Data.Files[0].Name, "test.gguf");
    }

    #[test]
    fn test_parse_empty_files_array() {
        let json = r#"{"Code":200,"Success":true,"Data":{"Files":[]},"Message":"success"}"#;
        let resp: ModelScopeFileListApiResponse = serde_json::from_str(json)
            .expect("should parse empty files");

        assert_eq!(resp.Data.Files.len(), 0);
    }

    #[test]
    fn test_parse_error_response() {
        let json = r#"{"Code":404,"Success":false,"Data":{"Files":[]},"Message":"Model not found"}"#;
        let resp: ModelScopeFileListApiResponse = serde_json::from_str(json)
            .expect("should parse error response");

        assert!(!resp.Success);
        assert_eq!(resp.Code, 404);
        assert_eq!(resp.Message, Some("Model not found".to_string()));
    }

    #[test]
    fn test_serialize_file_list_result() {
        let result = ModelScopeFileListResult {
            Files: vec![
                ModelScopeFile {
                    Name: "model-q4_k_m.gguf".to_string(),
                    Path: "model-q4_k_m.gguf".to_string(),
                    Size: 491400032,
                    Sha256: Some("abc123".to_string()),
                    IsLFS: true,
                },
            ],
        };

        let json = serde_json::to_string(&result).expect("should serialize");
        assert!(json.contains("\"Files\""));
        assert!(json.contains("\"Name\":\"model-q4_k_m.gguf\""));
        assert!(json.contains("\"Size\":491400032"));
    }

    #[test]
    fn test_model_scope_file_list_result_json_shape() {
        // ModelScopeFileListResult only derives Serialize (not Deserialize).
        // This test verifies the exact JSON shape that the frontend receives via Tauri IPC.
        let original = ModelScopeFileListResult {
            Files: vec![
                ModelScopeFile {
                    Name: "test.gguf".to_string(),
                    Path: "dir/test.gguf".to_string(),
                    Size: 1234567890,
                    Sha256: Some("deadbeef".to_string()),
                    IsLFS: true,
                },
            ],
        };

        let json = serde_json::to_string(&original).expect("serialize");
        let value: serde_json::Value = serde_json::from_str(&json).expect("parse as value");

        // Verify PascalCase field names (matching frontend TypeScript types)
        let files = value.get("Files").expect("has Files field").as_array().expect("Files is array");
        assert_eq!(files.len(), 1);

        let file = &files[0];
        assert_eq!(file.get("Name").expect("has Name").as_str().expect("Name is string"), "test.gguf");
        assert_eq!(file.get("Path").expect("has Path").as_str().expect("Path is string"), "dir/test.gguf");
        assert_eq!(file.get("Size").expect("has Size").as_i64().expect("Size is number"), 1234567890);
        assert_eq!(
            file.get("Sha256").expect("has Sha256").as_str().expect("Sha256 is string"),
            "deadbeef"
        );
        assert!(file.get("IsLFS").expect("has IsLFS").as_bool().expect("IsLFS is bool"));
    }
}
