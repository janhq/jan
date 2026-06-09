use crate::core::app::commands::get_jan_data_folder_path;
use crate::core::xai_oauth::oauth::{
    poll_device_code_token, request_device_code, resolve_access_token, DeviceCodeResponse,
    XaiOAuthRuntime,
};
use crate::core::xai_oauth::store::{clear_tokens, load_tokens, save_tokens};
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[derive(Clone)]
pub struct XaiOAuthState {
    pub runtime: Arc<XaiOAuthRuntime>,
}

impl Default for XaiOAuthState {
    fn default() -> Self {
        Self {
            runtime: Arc::new(XaiOAuthRuntime::default()),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XaiOAuthStatus {
    pub connected: bool,
    pub expires_at: Option<i64>,
    pub login_in_progress: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XaiOAuthStartLoginResponse {
    pub authorize_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XaiOAuthAccessTokenResponse {
    pub access_token: String,
    pub expires_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XaiOAuthDeviceLoginResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: Option<String>,
    pub expires_in: Option<i64>,
    pub interval: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XaiOAuthLoginResult {
    pub success: bool,
    pub expires_at: Option<i64>,
    pub error: Option<String>,
}

fn data_folder(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(get_jan_data_folder_path(app.clone()))
}

#[tauri::command]
pub async fn xai_oauth_status(
    app: AppHandle,
    state: State<'_, XaiOAuthState>,
) -> Result<XaiOAuthStatus, String> {
    let data_folder = data_folder(&app)?;
    let stored = load_tokens(&data_folder)?;
    let login_in_progress = state.runtime.is_login_in_progress().await;

    Ok(XaiOAuthStatus {
        connected: stored.is_some(),
        expires_at: stored.map(|tokens| tokens.expires_at),
        login_in_progress,
    })
}

#[tauri::command]
pub async fn xai_oauth_start_login(
    app: AppHandle,
    state: State<'_, XaiOAuthState>,
) -> Result<XaiOAuthStartLoginResponse, String> {
    let authorize_url = state.runtime.start_login().await?;
    let app_handle = app.clone();
    let runtime = state.runtime.clone();

    tokio::spawn(async move {
        let data_folder = match data_folder(&app_handle) {
            Ok(path) => path,
            Err(error) => {
                let _ = app_handle.emit(
                    "xai-oauth-login-complete",
                    XaiOAuthLoginResult {
                        success: false,
                        expires_at: None,
                        error: Some(error),
                    },
                );
                return;
            }
        };

        let payload = match runtime.wait_for_login(&data_folder).await {
            Ok(tokens) => XaiOAuthLoginResult {
                success: true,
                expires_at: Some(tokens.expires_at),
                error: None,
            },
            Err(error) => XaiOAuthLoginResult {
                success: false,
                expires_at: None,
                error: Some(error),
            },
        };
        let _ = app_handle.emit("xai-oauth-login-complete", payload);
    });

    Ok(XaiOAuthStartLoginResponse { authorize_url })
}

#[tauri::command]
pub async fn xai_oauth_cancel_login(state: State<'_, XaiOAuthState>) -> Result<(), String> {
    state.runtime.cancel_login().await
}

#[tauri::command]
pub async fn xai_oauth_complete_callback(
    app: AppHandle,
    state: State<'_, XaiOAuthState>,
    callback_url: String,
) -> Result<XaiOAuthLoginResult, String> {
    let data_folder = data_folder(&app)?;
    match state
        .runtime
        .complete_with_callback_url(&data_folder, &callback_url)
        .await
    {
        Ok(tokens) => Ok(XaiOAuthLoginResult {
            success: true,
            expires_at: Some(tokens.expires_at),
            error: None,
        }),
        Err(error) => Ok(XaiOAuthLoginResult {
            success: false,
            expires_at: None,
            error: Some(error),
        }),
    }
}

#[tauri::command]
pub async fn xai_oauth_get_access_token(app: AppHandle) -> Result<XaiOAuthAccessTokenResponse, String> {
    let data_folder = data_folder(&app)?;
    let stored = load_tokens(&data_folder)?.ok_or_else(|| {
        "Not signed in with SuperGrok. Sign in from Settings → Providers → xAI.".to_string()
    })?;
    let resolved = resolve_access_token(&data_folder, &stored).await?;
    Ok(XaiOAuthAccessTokenResponse {
        access_token: resolved.access_token,
        expires_at: resolved.expires_at,
    })
}

#[tauri::command]
pub async fn xai_oauth_logout(app: AppHandle, state: State<'_, XaiOAuthState>) -> Result<(), String> {
    let data_folder = data_folder(&app)?;
    let _ = state.runtime.cancel_login().await;
    clear_tokens(&data_folder)
}

#[tauri::command]
pub async fn xai_oauth_start_device_login() -> Result<XaiOAuthDeviceLoginResponse, String> {
    let device = request_device_code().await?;
    Ok(XaiOAuthDeviceLoginResponse {
        device_code: device.device_code,
        user_code: device.user_code,
        verification_uri: device.verification_uri,
        verification_uri_complete: device.verification_uri_complete,
        expires_in: device.expires_in,
        interval: device.interval,
    })
}

#[tauri::command]
pub async fn xai_oauth_poll_device_login(
    app: AppHandle,
    device_code: String,
    user_code: String,
    verification_uri: String,
    verification_uri_complete: Option<String>,
    expires_in: Option<i64>,
    interval: Option<i64>,
) -> Result<XaiOAuthLoginResult, String> {
    let data_folder = data_folder(&app)?;
    let device = DeviceCodeResponse {
        device_code,
        user_code,
        verification_uri,
        verification_uri_complete,
        expires_in,
        interval,
    };

    match poll_device_code_token(&device).await {
        Ok(tokens) => {
            save_tokens(&data_folder, &tokens)?;
            Ok(XaiOAuthLoginResult {
                success: true,
                expires_at: Some(tokens.expires_at),
                error: None,
            })
        }
        Err(error) => Ok(XaiOAuthLoginResult {
            success: false,
            expires_at: None,
            error: Some(error),
        }),
    }
}