//! The Tauri commands: thin wrappers that move the blocking work of
//! [`crate::install`] off the main thread and forward network calls to
//! [`crate::http`].

use std::path::PathBuf;
use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Manager, Runtime, State};

use crate::error::{Error, Result};
use crate::http::{self, HttpRequest, HttpResponse, HttpStreamEvent};
use crate::install::{self, EntrySource, InstalledExtension, ListResult, StagedInstall};
use crate::state::{safe_mode_from_env, ExtensionsState, Options};
use crate::store::random_id;

type Shared<'a> = State<'a, Arc<ExtensionsState>>;

async fn blocking<T, F>(state: &Shared<'_>, f: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(&ExtensionsState) -> Result<T> + Send + 'static,
{
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || f(&state))
        .await
        .map_err(|e| Error::Io(std::io::Error::other(e.to_string())))?
}

#[tauri::command]
async fn stage_bundle(state: Shared<'_>, path: String) -> Result<StagedInstall> {
    blocking(&state, move |s| install::stage_bundle(s, &PathBuf::from(path))).await
}

#[tauri::command]
async fn confirm_install(
    state: Shared<'_>,
    stage_id: String,
    granted: Vec<String>,
) -> Result<InstalledExtension> {
    blocking(&state, move |s| install::confirm_install(s, &stage_id, &granted)).await
}

#[tauri::command]
async fn discard_stage(state: Shared<'_>, stage_id: String) -> Result<()> {
    blocking(&state, move |s| install::discard_stage(s, &stage_id)).await
}

#[tauri::command]
async fn list(state: Shared<'_>) -> Result<ListResult> {
    blocking(&state, install::list).await
}

#[tauri::command]
async fn set_enabled(state: Shared<'_>, id: String, enabled: bool) -> Result<()> {
    blocking(&state, move |s| install::set_enabled(s, &id, enabled)).await
}

#[tauri::command]
async fn set_grants(state: Shared<'_>, id: String, granted: Vec<String>) -> Result<()> {
    blocking(&state, move |s| install::set_grants(s, &id, &granted)).await
}

#[tauri::command]
async fn uninstall(state: Shared<'_>, id: String) -> Result<()> {
    blocking(&state, move |s| install::uninstall(s, &id)).await
}

#[tauri::command]
async fn rollback(state: Shared<'_>, id: String) -> Result<InstalledExtension> {
    blocking(&state, move |s| install::rollback(s, &id)).await
}

#[tauri::command]
async fn read_entry(state: Shared<'_>, id: String) -> Result<EntrySource> {
    blocking(&state, move |s| install::read_entry(s, &id)).await
}

#[tauri::command]
async fn set_safe_mode(state: Shared<'_>, on: bool) -> Result<()> {
    blocking(&state, move |s| install::set_safe_mode(s, on)).await
}

#[tauri::command]
async fn http_fetch(
    state: Shared<'_>,
    id: String,
    req: HttpRequest,
    request_id: Option<String>,
) -> Result<HttpResponse> {
    let request_id = request_id.unwrap_or_else(random_id);
    http::http_fetch(&state, &id, &request_id, &req).await
}

#[tauri::command]
async fn http_fetch_stream(
    state: Shared<'_>,
    id: String,
    request_id: String,
    req: HttpRequest,
    on_event: Channel<HttpStreamEvent>,
) -> Result<u16> {
    http::http_fetch_stream(&state, &id, &request_id, &req, |event| {
        on_event.send(event).is_ok()
    })
    .await
}

#[tauri::command]
fn http_cancel(state: Shared<'_>, id: String, request_id: String) {
    http::cancel(&state, &id, &request_id);
}

/// The plugin. `root` resolves the extensions root
/// (`<jan data folder>/extensions`) at setup, when the app's configured data
/// folder can be read. Safe mode is forced for the run when
/// `JAN_EXTENSIONS_SAFE_MODE=1`.
pub fn init<R, F>(root: F) -> TauriPlugin<R>
where
    R: Runtime,
    F: FnOnce(&AppHandle<R>) -> PathBuf + Send + 'static,
{
    Builder::new("extensions")
        .invoke_handler(tauri::generate_handler![
            stage_bundle,
            confirm_install,
            discard_stage,
            list,
            set_enabled,
            set_grants,
            uninstall,
            rollback,
            read_entry,
            set_safe_mode,
            http_fetch,
            http_fetch_stream,
            http_cancel,
        ])
        .setup(move |app, _api| {
            let options = Options {
                app_version: app.package_info().version.to_string(),
                safe_mode_forced: safe_mode_from_env(),
            };
            let state = ExtensionsState::new(root(app), options)?;
            app.manage(Arc::new(state));
            Ok(())
        })
        .build()
}

/// Tells the plugin which port Jan's local API server listens on (`None`
/// once it stops), so no extension request reaches it on a local host.
/// A no-op when the plugin is not registered.
pub fn set_local_api_port<R: Runtime>(app: &AppHandle<R>, port: Option<u16>) {
    if let Some(state) = app.try_state::<Arc<ExtensionsState>>() {
        state.set_local_api_port(port);
    }
}
