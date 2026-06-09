use portable_pty::{
    native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Runtime};

const DEFAULT_COLS: u16 = 80;
const DEFAULT_ROWS: u16 = 24;
const MAX_SCROLLBACK_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionInfo {
    pub session_id: String,
    pub cwd: Option<String>,
    pub shell: String,
    pub status: TerminalSessionStatus,
    pub created_at: u64,
    pub updated_at: u64,
    pub exit_code: Option<i32>,
    pub process_id: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalSessionStatus {
    Running,
    Exited,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputEvent {
    pub session_id: String,
    pub data: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitEvent {
    pub session_id: String,
    pub exit_code: Option<i32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalErrorEvent {
    pub session_id: String,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTerminalSessionRequest {
    pub session_id: Option<String>,
    pub cwd: Option<String>,
    pub shell: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

struct TerminalSession {
    info: TerminalSessionInfo,
    master: Option<Box<dyn MasterPty + Send>>,
    writer: Option<Arc<Mutex<Box<dyn Write + Send>>>>,
    killer: Option<Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>>,
    scrollback: String,
}

static TERMINAL_SESSIONS: OnceLock<Mutex<HashMap<String, TerminalSession>>> = OnceLock::new();

fn terminal_sessions() -> &'static Mutex<HashMap<String, TerminalSession>> {
    TERMINAL_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn default_shell() -> String {
    #[cfg(windows)]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    }

    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    }
}

fn append_scrollback(session_id: &str, data: &str) {
    let Ok(mut registry) = terminal_sessions().lock() else {
        return;
    };
    let Some(session) = registry.get_mut(session_id) else {
        return;
    };

    session.scrollback.push_str(data);
    if session.scrollback.len() > MAX_SCROLLBACK_BYTES {
        let excess = session.scrollback.len() - MAX_SCROLLBACK_BYTES;
        session.scrollback.drain(..excess);
    }
    session.info.updated_at = now_ms();
}

fn mark_session_exit(session_id: &str, status: TerminalSessionStatus, exit_code: Option<i32>) {
    let Ok(mut registry) = terminal_sessions().lock() else {
        return;
    };
    let Some(session) = registry.get_mut(session_id) else {
        return;
    };

    session.info.status = status;
    session.info.exit_code = exit_code;
    session.info.updated_at = now_ms();
    session.writer = None;
    session.killer = None;
    session.master = None;
}

#[tauri::command]
pub fn start_terminal_session<R: Runtime>(
    app: AppHandle<R>,
    request: StartTerminalSessionRequest,
) -> Result<TerminalSessionInfo, String> {
    let session_id = request
        .session_id
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let shell = request.shell.unwrap_or_else(default_shell);
    let cols = request.cols.unwrap_or(DEFAULT_COLS).max(1);
    let rows = request.rows.unwrap_or(DEFAULT_ROWS).max(1);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| format!("Failed to open PTY: {err}"))?;

    let mut command = CommandBuilder::new(&shell);
    if let Some(cwd) = request.cwd.as_ref().filter(|path| !path.trim().is_empty()) {
        command.cwd(cwd);
    }

    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|err| format!("Failed to spawn shell: {err}"))?;
    let process_id = child.process_id();
    let killer = Arc::new(Mutex::new(child.clone_killer()));
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|err| format!("Failed to clone PTY reader: {err}"))?;
    let writer = Arc::new(Mutex::new(
        pair.master
            .take_writer()
            .map_err(|err| format!("Failed to take PTY writer: {err}"))?,
    ));

    let info = TerminalSessionInfo {
        session_id: session_id.clone(),
        cwd: request.cwd,
        shell,
        status: TerminalSessionStatus::Running,
        created_at: now_ms(),
        updated_at: now_ms(),
        exit_code: None,
        process_id,
    };

    {
        let mut registry = terminal_sessions()
            .lock()
            .map_err(|_| "Terminal registry lock poisoned".to_string())?;
        registry.insert(
            session_id.clone(),
            TerminalSession {
                info: info.clone(),
                master: Some(pair.master),
                writer: Some(writer),
                killer: Some(killer),
                scrollback: String::new(),
            },
        );
    }

    let output_app = app.clone();
    let output_session_id = session_id.clone();
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                    append_scrollback(&output_session_id, &data);
                    let _ = output_app.emit(
                        "terminal-output",
                        TerminalOutputEvent {
                            session_id: output_session_id.clone(),
                            data,
                        },
                    );
                }
                Err(err) => {
                    let _ = output_app.emit(
                        "terminal-error",
                        TerminalErrorEvent {
                            session_id: output_session_id.clone(),
                            message: err.to_string(),
                        },
                    );
                    break;
                }
            }
        }
    });

    let exit_app = app;
    let exit_session_id = session_id;
    thread::spawn(move || {
        let exit_code = child.wait().ok().map(|status| status.exit_code() as i32);
        mark_session_exit(&exit_session_id, TerminalSessionStatus::Exited, exit_code);
        let _ = exit_app.emit(
            "terminal-exit",
            TerminalExitEvent {
                session_id: exit_session_id,
                exit_code,
            },
        );
    });

    Ok(info)
}

#[tauri::command]
pub fn write_terminal_stdin(session_id: String, input: String) -> Result<(), String> {
    let writer = {
        let registry = terminal_sessions()
            .lock()
            .map_err(|_| "Terminal registry lock poisoned".to_string())?;
        registry
            .get(session_id.trim())
            .and_then(|session| session.writer.as_ref().cloned())
            .ok_or_else(|| format!("Terminal session '{}' is not running", session_id.trim()))?
    };

    let mut writer = writer
        .lock()
        .map_err(|_| "Terminal writer lock poisoned".to_string())?;
    writer
        .write_all(input.as_bytes())
        .map_err(|err| format!("Failed to write to terminal: {err}"))?;
    writer
        .flush()
        .map_err(|err| format!("Failed to flush terminal input: {err}"))
}

#[tauri::command]
pub fn resize_terminal_session(session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let registry = terminal_sessions()
        .lock()
        .map_err(|_| "Terminal registry lock poisoned".to_string())?;
    let session = registry
        .get(session_id.trim())
        .ok_or_else(|| format!("Terminal session '{}' not found", session_id.trim()))?;
    let master = session
        .master
        .as_ref()
        .ok_or_else(|| format!("Terminal session '{}' is not running", session_id.trim()))?;

    master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| format!("Failed to resize terminal: {err}"))
}

#[tauri::command]
pub fn stop_terminal_session(session_id: String) -> Result<(), String> {
    let killer = {
        let registry = terminal_sessions()
            .lock()
            .map_err(|_| "Terminal registry lock poisoned".to_string())?;
        registry
            .get(session_id.trim())
            .and_then(|session| session.killer.as_ref().cloned())
            .ok_or_else(|| format!("Terminal session '{}' is not running", session_id.trim()))?
    };

    let mut killer = killer
        .lock()
        .map_err(|_| "Terminal killer lock poisoned".to_string())?;
    killer
        .kill()
        .map_err(|err| format!("Failed to stop terminal: {err}"))
}

#[tauri::command]
pub fn list_terminal_sessions() -> Result<Vec<TerminalSessionInfo>, String> {
    let registry = terminal_sessions()
        .lock()
        .map_err(|_| "Terminal registry lock poisoned".to_string())?;
    Ok(registry.values().map(|session| session.info.clone()).collect())
}

#[tauri::command]
pub fn read_terminal_scrollback(session_id: String) -> Result<String, String> {
    let registry = terminal_sessions()
        .lock()
        .map_err(|_| "Terminal registry lock poisoned".to_string())?;
    registry
        .get(session_id.trim())
        .map(|session| session.scrollback.clone())
        .ok_or_else(|| format!("Terminal session '{}' not found", session_id.trim()))
}
