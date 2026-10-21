use tauri::{Manager, Runtime, State};

use crate::error::LocalEngineError;
use crate::process;
use crate::state::{LocalEngineState, SessionInfo};

/// A session that was stopped.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UnloadResult {
    pub success: bool,
    pub error: Option<String>,
}

/// What the plugin found when checking whether an engine can run here.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EngineAvailability {
    /// The engine id that was checked.
    pub engine: String,
    /// Whether a usable interpreter and runtime were found.
    pub available: bool,
    /// The interpreter that will be used, when one was found.
    pub python: Option<String>,
    /// The runtime package the interpreter has to provide.
    pub package: Option<String>,
    /// Why the engine is not usable.
    pub error: Option<String>,
}

#[tauri::command]
pub async fn cleanup_local_engine_processes<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<(), String> {
    process::cleanup_processes(&app_handle).await;
    Ok(())
}

#[tauri::command]
pub async fn load_local_model<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    engine: String,
    model_id: String,
    model_path: String,
    port: u16,
    config: Option<process::LocalEngineConfig>,
    timeout: Option<u64>,
    data_folder: Option<String>,
) -> Result<SessionInfo, String> {
    process::load_model_impl(
        &app_handle,
        &engine,
        model_id,
        model_path,
        port,
        config.unwrap_or_default(),
        timeout.unwrap_or(600),
        data_folder.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn unload_local_model<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    pid: i32,
) -> Result<UnloadResult, String> {
    let state: State<LocalEngineState> = app_handle.state();
    let session = {
        let mut map = state.sessions.lock().await;
        map.remove(&pid)
    };

    match session {
        Some(session) => {
            let mut child = session.child.lock().await;
            process::terminate_child(&mut child).await;
            Ok(UnloadResult {
                success: true,
                error: None,
            })
        }
        None => Ok(UnloadResult {
            success: false,
            error: Some(format!("No running session with pid {pid}")),
        }),
    }
}

#[tauri::command]
pub async fn is_local_engine_process_running<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    pid: i32,
) -> Result<bool, String> {
    use sysinfo::{Pid, ProcessesToUpdate, System};
    let target = Pid::from(pid as usize);
    let mut system = System::new();
    // Only the one PID: refreshing every process walks the whole table and
    // allocates an entry per process, which is wasteful for a liveness probe
    // that a UI may call on a timer.
    system.refresh_processes(ProcessesToUpdate::Some(&[target]), true);
    let alive = system.process(target).is_some();

    if !alive {
        let state: State<LocalEngineState> = app_handle.state();
        let mut map = state.sessions.lock().await;
        map.remove(&pid);
    }

    Ok(alive)
}

#[tauri::command]
pub async fn get_local_engine_random_port<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<u16, String> {
    let used = process::used_ports(&app_handle).await;
    jan_utils::generate_random_port(&used)
}

#[tauri::command]
pub async fn find_local_session_by_model<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    model_id: String,
) -> Result<Option<SessionInfo>, String> {
    let state: State<LocalEngineState> = app_handle.state();
    let map = state.sessions.lock().await;
    Ok(map
        .values()
        .find(|session| session.info.model_id == model_id)
        .map(|session| session.info.clone()))
}

#[tauri::command]
pub async fn get_local_loaded_models<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<Vec<String>, String> {
    let state: State<LocalEngineState> = app_handle.state();
    let map = state.sessions.lock().await;
    Ok(map
        .values()
        .map(|session| session.info.model_id.clone())
        .collect())
}

#[tauri::command]
pub async fn get_local_all_sessions<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<Vec<SessionInfo>, String> {
    let state: State<LocalEngineState> = app_handle.state();
    let map = state.sessions.lock().await;
    Ok(map.values().map(|session| session.info.clone()).collect())
}

/// The script that answers "is the runtime installed?".
///
/// It uses `importlib.util.find_spec`, which only *looks for* the module on
/// disk. Importing it instead would load the whole runtime -- the OpenVINO
/// libraries alone pull in gigabytes of resident memory and take seconds to
/// initialise -- purely to answer a yes/no question, and the probe would
/// outlive the check.
fn probe_script(package: &str) -> String {
    format!(
        "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('{package}') else 1)"
    )
}

/// How long a runtime check is reused before the answer is looked up again.
///
/// The provider page asks whether the runtime is present every time it is
/// opened, and each answer used to start an interpreter. Caching keeps the
/// page cheap: the runtime does not appear or disappear between two opens a
/// minute apart.
const AVAILABILITY_TTL_SECS: u64 = 60;

/// The last runtime check per engine, with the time it was taken.
fn availability_cache() -> &'static std::sync::Mutex<
    std::collections::HashMap<String, (EngineAvailability, std::time::Instant)>,
> {
    static CACHE: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, (EngineAvailability, std::time::Instant)>>,
    > = std::sync::OnceLock::new();
    CACHE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// Reports whether an engine can run on this machine.
///
/// The check resolves the interpreter and asks it whether the runtime package
/// imports, so the UI can explain what is missing instead of failing at the
/// first prompt.
#[tauri::command]
pub async fn check_local_engine<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    engine: String,
    data_folder: Option<String>,
) -> Result<EngineAvailability, String> {
    // A recent answer is reused: the provider page asks on every open, and
    // the answer only changes when the user installs or removes the runtime.
    if let Ok(cache) = availability_cache().lock() {
        if let Some((cached, taken)) = cache.get(&engine) {
            if taken.elapsed().as_secs() < AVAILABILITY_TTL_SECS {
                return Ok(cached.clone());
            }
        }
    }

    let answer =
        check_local_engine_uncached(&app_handle, &engine, data_folder.as_deref()).await;
    if let Ok(mut cache) = availability_cache().lock() {
        cache.insert(engine, (answer.clone(), std::time::Instant::now()));
    }
    Ok(answer)
}

/// The runtime check itself, without the cache.
async fn check_local_engine_uncached<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    engine: &str,
    data_folder: Option<&str>,
) -> EngineAvailability {
    let package = match process::engine_package(engine) {
        Some(package) => package.to_string(),
        None => {
            return EngineAvailability {
                engine: engine.to_string(),
                available: false,
                python: None,
                package: None,
                error: Some(format!("Unknown local engine: {engine}")),
            }
        }
    };

    let python = match process::resolve_python(app_handle, engine, data_folder) {
        Ok(path) => path,
        Err(err) => {
            return EngineAvailability {
                engine: engine.to_string(),
                available: false,
                python: None,
                package: Some(package.clone()),
                error: Some(err.to_string()),
            }
        }
    };

    // Writing the sidecar also proves the plugin can lay down its runtime
    // files, so do it before reporting the engine as usable.
    if let Err(err) = process::resolve_server_script(app_handle, data_folder) {
        return EngineAvailability {
            engine: engine.to_string(),
            available: false,
            python: Some(python.display().to_string()),
            package: Some(package.clone()),
            error: Some(err.to_string()),
        };
    }

    let program =
        process::engine_helper_binary(engine, &python).unwrap_or_else(|| python.clone());
    let output = process::hidden_command(&program)
        .arg("-c")
        .arg(probe_script(&package))
        .output()
        .await;

    match output {
        Ok(output) if output.status.success() => EngineAvailability {
            engine: engine.to_string(),
            available: true,
            python: Some(python.display().to_string()),
            package: Some(package),
            error: None,
        },
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let reason = if stderr.is_empty() {
                format!("The '{package}' package is not installed for this interpreter")
            } else {
                stderr
            };
            EngineAvailability {
                engine: engine.to_string(),
                available: false,
                python: Some(python.display().to_string()),
                package: Some(package),
                error: Some(reason),
            }
        }
        Err(err) => EngineAvailability {
            engine: engine.to_string(),
            available: false,
            python: Some(python.display().to_string()),
            package: Some(package),
            error: Some(err.to_string()),
        },
    }
}

/// Installs an engine's runtime into a virtualenv Jan manages.
///
/// The UI calls this when the runtime is missing; afterwards the engine works
/// without the user touching a terminal.
#[tauri::command]
pub async fn install_local_engine_runtime<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    engine: String,
    data_folder: Option<String>,
) -> Result<String, String> {
    process::install_runtime(&app_handle, &engine, data_folder.as_deref())
        .await
        .map_err(|e| e.to_string())
}

/// Keeps the error type in the public surface of the crate.
pub fn describe(error: &LocalEngineError) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The probe has to pass the module name as a string.
    ///
    /// A bare identifier is a NameError at runtime, which reads as "the
    /// runtime is missing" even when it is installed.
    #[test]
    fn the_probe_quotes_the_module_name() {
        let script = probe_script("openvino_genai");
        assert!(
            script.contains("find_spec('openvino_genai')"),
            "the probe does not quote the module: {script}"
        );
        assert!(
            !script.contains("find_spec(openvino_genai)"),
            "the probe passes a bare identifier: {script}"
        );
    }

    /// The probe looks for the module; it must not import it.
    ///
    /// Importing pulls the whole runtime in -- gigabytes of resident memory
    /// for OpenVINO -- to answer a question the filesystem can answer.
    #[test]
    fn the_probe_does_not_import_the_runtime() {
        let script = probe_script("litert_lm");
        assert!(script.contains("importlib.util.find_spec"));
        assert!(!script.contains("import litert_lm"));
    }
}
