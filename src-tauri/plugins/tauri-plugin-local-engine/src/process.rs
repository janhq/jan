use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tauri::{Manager, Runtime, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

use crate::error::{EngineResult, LocalEngineError};
use crate::state::{LocalEngineState, SessionInfo};

/// The OpenAI-compatible sidecar that fronts a local engine.
///
/// It is embedded in the binary so the plugin has no runtime dependency on
/// files that may be missing from an install; it is written to the app data
/// directory on first use so the interpreter can run it from disk.
const SERVER_SCRIPT: &str = include_str!("../../../python-engines/server.py");

/// `CREATE_NO_WINDOW`: a console process spawned from a GUI app opens a
/// console window, and that window stays open for as long as the process
/// lives. Every interpreter this plugin starts is a background helper the
/// user never asked to see, so none of them may put a window on screen.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A command that starts without a console window on Windows.
pub fn hidden_command(program: &Path) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// The name a helper process is given, so it is identifiable in the task
/// manager or in `ps`.
///
/// A sidecar that runs as `python.exe` is indistinguishable from every other
/// Python on the machine, which makes it both impossible to tell apart and
/// easy to kill by accident ("stop all python servers" takes the engine with
/// it). Naming it after the engine fixes both.
fn helper_name(engine: &str) -> String {
    format!("jan-{}", engine.replace('-', "_"))
}

/// An executable that runs the given interpreter but is named after the
/// engine.
///
/// On Windows the interpreter is *copied* next to the original: a virtualenv's
/// `python.exe` finds `pyvenv.cfg` in its own directory, so a copy elsewhere
/// would stop being a virtualenv python. On Unix a symlink is enough, and the
/// kernel takes the process name from the path it was exec'd with.
pub fn engine_helper_binary(engine: &str, python: &Path) -> Option<PathBuf> {
    let name = helper_name(engine);

    #[cfg(windows)]
    {
        let target = python.with_file_name(format!("{name}.exe"));
        if target.is_file() {
            return Some(target);
        }
        std::fs::copy(python, &target).ok()?;
        Some(target)
    }

    #[cfg(unix)]
    {
        let dir = std::env::temp_dir().join("jan-engine-helpers");
        std::fs::create_dir_all(&dir).ok()?;
        let link = dir.join(&name);
        if !link.exists() {
            std::os::unix::fs::symlink(python, &link).ok()?;
        }
        Some(link)
    }
}

/// The engines this plugin knows how to drive, with the python package that
/// has to be importable for the engine to work.
pub fn engine_package(engine: &str) -> Option<&'static str> {
    engine_package_spec(engine).map(|(package, _)| package)
}

/// Name of the environment variable that overrides the interpreter for an
/// engine, e.g. `JAN_LITERT_LM_PYTHON`.
fn engine_env_var(engine: &str) -> String {
    format!(
        "JAN_{}_PYTHON",
        engine.to_uppercase().replace('-', "_")
    )
}

/// The python interpreter names to look for on PATH, in preference order.
const PATH_CANDIDATES: &[&str] = &["python3", "python"];

fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

/// Looks for a python interpreter on PATH.
fn python_on_path() -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&paths) {
        for name in PATH_CANDIDATES {
            for ext in ["", ".exe"] {
                let candidate = dir.join(format!("{name}{ext}"));
                if is_executable_file(&candidate) {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

/// Path of the interpreter inside a virtualenv created for `engine`.
fn venv_python(venv_dir: &Path) -> Option<PathBuf> {
    let candidates = [
        venv_dir.join("Scripts").join("python.exe"),
        venv_dir.join("bin").join("python3"),
        venv_dir.join("bin").join("python"),
    ];
    candidates.into_iter().find(|c| c.is_file())
}

/// Resolves the interpreter used to run the engine sidecar.
///
/// Order: the engine-specific override, the shared override, a virtualenv
/// Jan manages under the data folder, then whatever is on PATH.
pub fn resolve_python<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    engine: &str,
    data_folder: Option<&str>,
) -> EngineResult<PathBuf> {
    let package = engine_package(engine).unwrap_or("the engine runtime");
    let env_var = engine_env_var(engine);

    for var in [env_var.clone(), "JAN_ENGINE_PYTHON".to_string()] {
        if let Some(value) = std::env::var_os(&var) {
            let path = PathBuf::from(value);
            if path.is_file() {
                return Ok(path);
            }
            return Err(LocalEngineError::PythonNotAFile {
                path: path.display().to_string(),
            });
        }
    }

    let venv = data_root(app_handle, data_folder)
        .join("local-engine")
        .join(engine)
        .join("venv");
    if let Some(python) = venv_python(&venv) {
        return Ok(python);
    }

    python_on_path().ok_or_else(|| LocalEngineError::PythonNotFound {
        engine: engine.to_string(),
        env_var,
        package: package.to_string(),
    })
}

/// The root the plugin keeps its files under.
///
/// The frontend passes Jan's data folder so the runtime, the sidecar script
/// and the models all live in the same place, wherever the user moved the
/// data folder to.
fn data_root<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    data_folder: Option<&str>,
) -> PathBuf {
    if let Some(folder) = data_folder.filter(|f| !f.is_empty()) {
        return PathBuf::from(folder);
    }
    app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
}

/// Writes the embedded sidecar script to disk and returns its path.
pub fn resolve_server_script<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    data_folder: Option<&str>,
) -> EngineResult<PathBuf> {
    if let Some(value) = std::env::var_os("JAN_LOCAL_ENGINE_SERVER") {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Ok(path);
        }
        return Err(LocalEngineError::SpawnFailed(format!(
            "JAN_LOCAL_ENGINE_SERVER points at {}, which is not a file",
            path.display()
        )));
    }

    let dir = data_root(app_handle, data_folder).join("local-engine");
    std::fs::create_dir_all(&dir)
        .map_err(|e| LocalEngineError::SpawnFailed(format!("cannot create {}: {e}", dir.display())))?;
    let script = dir.join("server.py");

    // Rewrite only when the content changed, so the file's mtime stays put
    // and the interpreter does not re-read a stale copy.
    let needs_write = match std::fs::read_to_string(&script) {
        Ok(existing) => existing != SERVER_SCRIPT,
        Err(_) => true,
    };
    if needs_write {
        std::fs::write(&script, SERVER_SCRIPT)
            .map_err(|e| LocalEngineError::SpawnFailed(format!("cannot write {}: {e}", script.display())))?;
    }

    Ok(script)
}

/// Configuration for a model load.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct LocalEngineConfig {
    #[serde(default)]
    pub ctx_size: i32,
    #[serde(default)]
    pub threads: i32,
    #[serde(default)]
    pub api_key: Option<String>,
}

/// Starts the sidecar for `model_path` and waits until it answers.
#[allow(clippy::too_many_arguments)]
pub async fn load_model_impl<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    engine: &str,
    model_id: String,
    model_path: String,
    port: u16,
    config: LocalEngineConfig,
    timeout: u64,
    data_folder: Option<&str>,
) -> EngineResult<SessionInfo> {
    if engine_package(engine).is_none() {
        return Err(LocalEngineError::UnknownEngine(engine.to_string()));
    }
    if !Path::new(&model_path).exists() {
        return Err(LocalEngineError::ModelNotFound { path: model_path });
    }

    let python = resolve_python(app_handle, engine, data_folder)?;
    let script = resolve_server_script(app_handle, data_folder)?;
    // The sidecar runs under a name of its own, so it shows up as
    // `jan-openvino` rather than as another `python.exe`.
    let program = engine_helper_binary(engine, &python).unwrap_or_else(|| python.clone());
    let api_key = config
        .api_key
        .unwrap_or_else(|| format!("jan-{}", uuid_like(engine, &model_id)));

    // Port 0 means "pick one": the sidecar has to be told which port to
    // bind, and the session has to report the same one back.
    let port = if port == 0 {
        let used = used_ports(app_handle).await;
        jan_utils::generate_random_port(&used).map_err(LocalEngineError::SpawnFailed)?
    } else {
        port
    };

    let mut command = hidden_command(&program);
    command
        .arg(&script)
        .arg("--engine")
        .arg(engine)
        .arg("--model")
        .arg(&model_path)
        .arg("--model-id")
        .arg(&model_id)
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("--api-key")
        .arg(&api_key)
        .arg("--ctx-size")
        .arg(config.ctx_size.max(0).to_string())
        .arg("--threads")
        .arg(config.threads.max(0).to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = command.spawn().map_err(|e| {
        LocalEngineError::SpawnFailed(format!("could not start {}: {e}", python.display()))
    })?;

    let pid = child.id().unwrap_or(0) as i32;

    // Drain the sidecar's stderr so it can never block on a full pipe, and
    // keep the tail in the log for diagnostics.
    if let Some(stderr) = child.stderr.take() {
        let engine_name = engine.to_string();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                log::info!("[{}] {}", engine_name, line);
            }
        });
    }

    let health_url = format!("http://127.0.0.1:{port}/health");
    if let Err(reason) = wait_for_ready(&health_url, timeout).await {
        // The model failed to come up: stop the process before returning.
        let mut child = child;
        terminate_child(&mut child).await;
        return Err(reason);
    }

    let info = SessionInfo {
        engine: engine.to_string(),
        model_id: model_id.clone(),
        model_path,
        port: port as i32,
        api_key,
        pid,
    };

    let state: State<LocalEngineState> = app_handle.state();
    let mut sessions = state.sessions.lock().await;
    sessions.insert(
        pid,
        crate::state::EngineSession {
            info: info.clone(),
            child: Arc::new(Mutex::new(child)),
        },
    );

    Ok(info)
}

/// Polls the sidecar's health endpoint until it answers.
async fn wait_for_ready(health_url: &str, timeout: u64) -> EngineResult<()> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| LocalEngineError::NotReady {
            timeout,
            reason: e.to_string(),
        })?;

    let deadline = std::time::Instant::now() + Duration::from_secs(timeout.max(1));
    let mut last_error = String::from("no response");

    while std::time::Instant::now() < deadline {
        match client.get(health_url).send().await {
            Ok(response) if response.status().is_success() => return Ok(()),
            Ok(response) => last_error = format!("HTTP {}", response.status()),
            Err(err) => last_error = err.to_string(),
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    Err(LocalEngineError::NotReady {
        timeout,
        reason: last_error,
    })
}

/// Stops the sidecar, escalating to a kill when it does not exit.
pub async fn terminate_child(child: &mut tokio::process::Child) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        if let Some(pid) = child.id() {
            // taskkill /T also takes down anything the sidecar spawned.
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output();
        }
        let _ = child.wait().await;
    }

    #[cfg(unix)]
    {
        if let Some(pid) = child.id() {
            let _ = tokio::process::Command::new("kill")
                .args(["-TERM", &pid.to_string()])
                .output()
                .await;
            match tokio::time::timeout(Duration::from_secs(5), child.wait()).await {
                Ok(Ok(_)) => return,
                Ok(Err(_)) => {}
                Err(_) => {}
            }
            let _ = tokio::process::Command::new("kill")
                .args(["-KILL", &pid.to_string()])
                .output()
                .await;
            let _ = child.wait().await;
        }
    }
}

/// Stops every running sidecar; called when the app shuts down.
pub async fn cleanup_processes<R: Runtime>(app_handle: &tauri::AppHandle<R>) {
    let state = match app_handle.try_state::<LocalEngineState>() {
        Some(state) => state,
        None => return,
    };

    let pids: Vec<i32> = {
        let map = state.sessions.lock().await;
        map.keys().copied().collect()
    };

    for pid in pids {
        let session = {
            let mut map = state.sessions.lock().await;
            map.remove(&pid)
        };
        if let Some(session) = session {
            let mut child = session.child.lock().await;
            terminate_child(&mut child).await;
        }
    }
}

/// The python package each engine needs, and the pip name to install it
/// under. They are the same today, but keeping them separate makes the
/// mapping explicit.
pub fn engine_package_spec(engine: &str) -> Option<(&'static str, &'static str)> {
    match engine {
        "litert-lm" => Some(("litert_lm", "litert-lm")),
        "openvino" => Some(("openvino_genai", "openvino openvino-genai")),
        _ => None,
    }
}

/// Installs an engine's runtime into a virtualenv Jan manages.
///
/// The virtualenv lives at `<app data>/local-engine/<engine>/venv`, which is
/// where `resolve_python` looks, so an installed runtime is picked up
/// automatically.
pub async fn install_runtime<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    engine: &str,
    data_folder: Option<&str>,
) -> EngineResult<String> {
    let (package, pip_names) = engine_package_spec(engine)
        .ok_or_else(|| LocalEngineError::UnknownEngine(engine.to_string()))?;

    // The interpreter that creates the virtualenv must not be the virtualenv
    // itself, so the managed venv is skipped here.
    let base_python = base_python(app_handle, data_folder)?;

    let venv_dir = data_root(app_handle, data_folder)
        .join("local-engine")
        .join(engine)
        .join("venv");
    std::fs::create_dir_all(venv_dir.parent().unwrap())
        .map_err(|e| LocalEngineError::SpawnFailed(e.to_string()))?;

    if !venv_python(&venv_dir).is_some() {
        // The install runs for minutes, so it is named after the engine too:
        // a `pip install` that shows up as `python` is impossible to tell
        // apart from anything else the user is running.
        let program = engine_helper_binary(engine, &base_python)
            .unwrap_or_else(|| base_python.clone());
        let output = hidden_command(&program)
            .arg("-m")
            .arg("venv")
            .arg(&venv_dir)
            .output()
            .await
            .map_err(|e| {
                LocalEngineError::SpawnFailed(format!("could not create the virtualenv: {e}"))
            })?;
        if !output.status.success() {
            return Err(LocalEngineError::SpawnFailed(format!(
                "could not create the virtualenv: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
    }

    let venv_python = venv_python(&venv_dir).ok_or_else(|| {
        LocalEngineError::SpawnFailed("the virtualenv has no python interpreter".to_string())
    })?;

    log::info!("installing the {engine} runtime ({pip_names}) into {venv_dir:?}");
    let pip_program =
        engine_helper_binary(engine, &venv_python).unwrap_or_else(|| venv_python.clone());
    let output = hidden_command(&pip_program)
        .arg("-m")
        .arg("pip")
        .arg("install")
        .arg("--upgrade")
        .arg(pip_names)
        .output()
        .await
        .map_err(|e| {
            LocalEngineError::SpawnFailed(format!("could not run pip: {e}"))
        })?;

    if !output.status.success() {
        return Err(LocalEngineError::SpawnFailed(format!(
            "pip install failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }

    // Confirm the runtime actually imports before reporting success. This one
    // does import (rather than only look for it), because the point is to
    // prove the runtime works, not that it is present.
    let check = hidden_command(&pip_program)
        .arg("-c")
        .arg(format!("import {package}"))
        .output()
        .await
        .map_err(|e| LocalEngineError::SpawnFailed(e.to_string()))?;
    if !check.status.success() {
        return Err(LocalEngineError::SpawnFailed(format!(
            "the runtime was installed but '{package}' does not import: {}",
            String::from_utf8_lossy(&check.stderr).trim()
        )));
    }

    Ok(venv_python.display().to_string())
}

/// The interpreter used to create a virtualenv: an explicit override, or
/// whatever python is on PATH. The managed virtualenv is deliberately not
/// considered, or the engine would try to create itself.
fn base_python<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    data_folder: Option<&str>,
) -> EngineResult<PathBuf> {
    for var in ["JAN_ENGINE_PYTHON", "JAN_BASE_PYTHON"] {
        if let Some(value) = std::env::var_os(var) {
            let path = PathBuf::from(value);
            if path.is_file() {
                return Ok(path);
            }
            return Err(LocalEngineError::PythonNotAFile {
                path: path.display().to_string(),
            });
        }
    }

    // A managed virtualenv of another engine is a fine base: it has the same
    // python the user wants to run with.
    let managed = data_root(app_handle, data_folder).join("local-engine");
    if let Ok(entries) = std::fs::read_dir(&managed) {
        for entry in entries.flatten() {
            if let Some(python) = venv_python(&entry.path().join("venv")) {
                return Ok(python);
            }
        }
    }

    python_on_path().ok_or_else(|| LocalEngineError::PythonNotFound {
        engine: "python".to_string(),
        env_var: "JAN_ENGINE_PYTHON".to_string(),
        package: "python 3.10+".to_string(),
    })
}

/// Ports already taken by a running session.
pub async fn used_ports<R: Runtime>(app_handle: &tauri::AppHandle<R>) -> HashSet<u16> {
    let state: State<LocalEngineState> = app_handle.state();
    let map = state.sessions.lock().await;
    map.values()
        .filter_map(|session| {
            let port = session.info.port;
            if port > 0 && port <= u16::MAX as i32 {
                Some(port as u16)
            } else {
                None
            }
        })
        .collect()
}

/// A short, stable token derived from the engine and model id.
fn uuid_like(engine: &str, model_id: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(engine.as_bytes());
    hasher.update(b":");
    hasher.update(model_id.as_bytes());
    let digest = hasher.finalize();
    digest[..16].iter().map(|b| format!("{b:02x}")).collect()
}
