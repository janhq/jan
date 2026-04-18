use std::time::Duration;

use tauri::{AppHandle, Runtime};

use super::models::{
    ListModelScopeModelsParams, ModelScopeDetailResult, ModelScopeModelsResult,
};
use crate::core::app::commands::{get_app_configurations, update_app_configuration};

const MODELSCOPE_API_BASE: &str = "https://modelscope.cn/openapi/v1";

fn build_reqwest_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

/// 获取 ModelScope 模型列表（支持匿名访问）
#[tauri::command]
pub async fn list_modelscope_models(
    params: ListModelScopeModelsParams,
    token: Option<String>,
) -> Result<ModelScopeModelsResult, String> {
    let client = build_reqwest_client()?;

    let mut request = client.get(format!("{}/models", MODELSCOPE_API_BASE));

    // Bearer token（可选，提供后可能获得更多权限或更高的 rate limit）
    if let Some(t) = &token {
        request = request.header("Authorization", format!("Bearer {}", t));
    }

    // Query parameters
    if let Some(search) = &params.search {
        request = request.query(&[("search", search.as_str())]);
    }
    if let Some(owner) = &params.owner {
        request = request.query(&[("owner", owner.as_str())]);
    }
    let sort = params.sort.as_deref().unwrap_or("downloads");
    request = request.query(&[("sort", sort)]);

    let page_number = params.page_number.unwrap_or(1).max(1);
    let page_size = params.page_size.unwrap_or(20).clamp(1, 50);
    request = request.query(&[("page_number", page_number.to_string().as_str())]);
    request = request.query(&[("page_size", page_size.to_string().as_str())]);

    if let Some(v) = &params.filter_task {
        request = request.query(&[("filter.task", v.as_str())]);
    }
    if let Some(v) = &params.filter_library {
        request = request.query(&[("filter.library", v.as_str())]);
    }
    if let Some(v) = &params.filter_model_type {
        request = request.query(&[("filter.model_type", v.as_str())]);
    }
    if let Some(v) = &params.filter_custom_tag {
        request = request.query(&[("filter.custom_tag", v.as_str())]);
    }
    if let Some(v) = &params.filter_license {
        request = request.query(&[("filter.license", v.as_str())]);
    }
    if let Some(v) = &params.filter_deploy {
        request = request.query(&[("filter.deploy", v.as_str())]);
    }

    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();

    let body_text = response.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!("ModelScope API error: HTTP {} - {}", status, body_text));
    }

    let api_resp: super::models::ModelScopeListApiResponse =
        serde_json::from_str(&body_text).map_err(|e| {
            format!("Failed to parse ModelScope response: {}. Raw: {}", e, &body_text[..body_text.len().min(500)])
        })?;

    if !api_resp.success {
        return Err(format!("ModelScope API returned success=false"));
    }

    Ok(ModelScopeModelsResult {
        models: api_resp.data.models,
        total_count: api_resp.data.total_count,
        page_number: api_resp.data.page_number,
        page_size: api_resp.data.page_size,
    })
}

/// 获取 ModelScope 模型详情（需要 Bearer token，否则可能 404）
#[tauri::command]
pub async fn get_modelscope_model_detail(
    owner: String,
    repo_name: String,
    token: Option<String>,
) -> Result<ModelScopeDetailResult, String> {
    let client = build_reqwest_client()?;

    let mut request = client.get(format!("{}/models/{}/{}", MODELSCOPE_API_BASE, owner, repo_name));

    if let Some(t) = &token {
        request = request.header("Authorization", format!("Bearer {}", t));
    }

    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();

    let body_text = response.text().await.map_err(|e| e.to_string())?;

    if status.as_u16() == 401 {
        return Err("AUTH_REQUIRED".to_string());
    }
    if status.as_u16() == 404 {
        return Err("NOT_FOUND".to_string());
    }
    if !status.is_success() {
        return Err(format!("ModelScope API error: HTTP {} - {}", status, body_text));
    }

    let api_resp: super::models::ModelScopeDetailApiResponse =
        serde_json::from_str(&body_text).map_err(|e| {
            format!("Failed to parse ModelScope detail response: {}. Raw: {}", e, &body_text[..body_text.len().min(500)])
        })?;

    if !api_resp.success {
        return Err(format!("ModelScope API returned success=false"));
    }

    Ok(ModelScopeDetailResult {
        model: api_resp.data,
    })
}

/// 保存 ModelScope 访问令牌到应用配置
#[tauri::command]
pub fn save_modelscope_token<R: Runtime>(
    app_handle: AppHandle<R>,
    token: String,
) -> Result<(), String> {
    let mut config = get_app_configurations(app_handle.clone());
    config.modelscope_token = Some(token);
    update_app_configuration(app_handle, config)
}

/// 从应用配置读取 ModelScope 访问令牌
#[tauri::command]
pub fn get_modelscope_token<R: Runtime>(app_handle: AppHandle<R>) -> Option<String> {
    get_app_configurations(app_handle).modelscope_token
}

/// 清除 ModelScope 访问令牌
#[tauri::command]
pub fn clear_modelscope_token<R: Runtime>(app_handle: AppHandle<R>) -> Result<(), String> {
    let mut config = get_app_configurations(app_handle.clone());
    config.modelscope_token = None;
    update_app_configuration(app_handle, config)
}
