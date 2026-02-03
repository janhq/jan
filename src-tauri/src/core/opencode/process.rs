use super::types::*;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, RwLock};
use log::{error, info, warn};

/// Handle for a running OpenCode task
struct OpenCodeTaskHandle {
    #[allow(dead_code)]
    child: Child,
    stdin_tx: mpsc::Sender<String>,
    cancel_tx: Option<oneshot::Sender<()>>,
}

/// Manages OpenCode subprocess lifecycle
pub struct OpenCodeProcessManager {
    tasks: Arc<RwLock<HashMap<TaskId, OpenCodeTaskHandle>>>,
    binary_path: PathBuf,
}

impl OpenCodeProcessManager {
    /// Create a process manager using a standalone binary
    pub fn with_binary(path: PathBuf) -> Self {
        Self {
            tasks: Arc::new(RwLock::new(HashMap::new())),
            binary_path: path,
        }
    }

    /// Spawn a new OpenCode task
    ///
    /// # Arguments
    /// * `task_id` - Unique identifier for this task
    /// * `project_path` - Path to the project directory
    /// * `prompt` - The task prompt/instruction
    /// * `agent` - Optional agent type (build, plan, explore)
    /// * `api_key` - Optional API key for authenticating with Jan's Local API Server
    /// * `event_tx` - Channel to send events back to the caller
    ///
    /// # Returns
    /// * `Ok(())` if task started successfully
    /// * `Err(String)` if spawn failed
    pub async fn spawn_task(
        &self,
        task_id: TaskId,
        project_path: String,
        prompt: String,
        agent: Option<String>,
        api_key: Option<String>,
        event_tx: mpsc::Sender<(TaskId, OpenCodeToJan)>,
    ) -> Result<(), String> {
        info!(
            "Spawning OpenCode task: {} for project: {} with binary: {:?}",
            task_id, project_path, self.binary_path
        );

        // Build the command
        let mut cmd = Command::new(&self.binary_path);
        cmd.args(["stdio", "--project", &project_path]);

        if let Some(agent_name) = &agent {
            cmd.args(["--agent", agent_name]);
        }

        // Pass the API key as environment variable for OpenAI-compatible provider
        if let Some(key) = &api_key {
            cmd.env("OPENAI_API_KEY", key);
            info!("Set OPENAI_API_KEY environment variable for OpenCode");
        }

        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        // Spawn the process
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn opencode process: {}", e))?;

        // Get handles to stdin/stdout
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to get stdin handle".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to get stdout handle".to_string())?;
        let stderr = child.stderr.take();

        // Create communication channels
        let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(32);
        let (cancel_tx, cancel_rx) = oneshot::channel::<()>();

        // Store the task handle
        {
            let mut tasks = self.tasks.write().await;
            tasks.insert(
                task_id.clone(),
                OpenCodeTaskHandle {
                    child,
                    stdin_tx: stdin_tx.clone(),
                    cancel_tx: Some(cancel_tx),
                },
            );
        }

        // Clone references for the spawned tasks
        let task_id_stdout = task_id.clone();
        let task_id_stdin = task_id.clone();
        let task_id_stderr = task_id.clone();
        let tasks_ref = self.tasks.clone();

        // Spawn stdout reader task
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }

                match serde_json::from_str::<OpenCodeToJan>(&line) {
                    Ok(msg) => {
                        info!("OpenCode [{}] -> {:?}", task_id_stdout, msg);
                        if event_tx.send((task_id_stdout.clone(), msg)).await.is_err() {
                            warn!("Event receiver dropped for task {}", task_id_stdout);
                            break;
                        }
                    }
                    Err(e) => {
                        error!(
                            "Failed to parse OpenCode message for task {}: {} - raw: {}",
                            task_id_stdout, e, line
                        );
                    }
                }
            }

            info!("Stdout reader finished for task {}", task_id_stdout);

            // Cleanup task on exit
            let mut tasks = tasks_ref.write().await;
            tasks.remove(&task_id_stdout);
        });

        // Spawn stderr reader task (for debugging)
        if let Some(stderr) = stderr {
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();

                while let Ok(Some(line)) = lines.next_line().await {
                    if !line.trim().is_empty() {
                        warn!("OpenCode stderr [{}]: {}", task_id_stderr, line);
                    }
                }
            });
        }

        // Spawn stdin writer task
        tokio::spawn(async move {
            let mut stdin = stdin;
            let mut cancel_rx = cancel_rx;

            loop {
                tokio::select! {
                    biased;

                    // Check for cancellation first
                    _ = &mut cancel_rx => {
                        info!("Task {} cancelled via cancel channel", task_id_stdin);
                        break;
                    }

                    // Handle incoming messages to write to stdin
                    msg = stdin_rx.recv() => {
                        match msg {
                            Some(data) => {
                                if let Err(e) = stdin.write_all(data.as_bytes()).await {
                                    error!("Failed to write to stdin for task {}: {}", task_id_stdin, e);
                                    break;
                                }
                                if let Err(e) = stdin.write_all(b"\n").await {
                                    error!("Failed to write newline for task {}: {}", task_id_stdin, e);
                                    break;
                                }
                                if let Err(e) = stdin.flush().await {
                                    error!("Failed to flush stdin for task {}: {}", task_id_stdin, e);
                                    break;
                                }
                            }
                            None => {
                                info!("Stdin channel closed for task {}", task_id_stdin);
                                break;
                            }
                        }
                    }
                }
            }

            info!("Stdin writer finished for task {}", task_id_stdin);
        });

        // Send the initial task message
        let task_msg = JanToOpenCode::Task {
            id: task_id.clone(),
            payload: TaskPayload {
                session_id: None,
                project_path,
                prompt,
                agent,
            },
        };

        let json = serde_json::to_string(&task_msg)
            .map_err(|e| format!("Failed to serialize task message: {}", e))?;

        stdin_tx
            .send(json)
            .await
            .map_err(|e| format!("Failed to send initial task message: {}", e))?;

        info!("Task {} started successfully", task_id);
        Ok(())
    }

    /// Write a message to a running task's stdin
    pub async fn write_message(
        &self,
        task_id: &TaskId,
        message: JanToOpenCode,
    ) -> Result<(), String> {
        let tasks = self.tasks.read().await;
        let task = tasks
            .get(task_id)
            .ok_or_else(|| format!("Task {} not found", task_id))?;

        let json = serde_json::to_string(&message)
            .map_err(|e| format!("Failed to serialize message: {}", e))?;

        task.stdin_tx
            .send(json)
            .await
            .map_err(|e| format!("Failed to send message: {}", e))?;

        Ok(())
    }

    /// Cancel a running task
    pub async fn cancel_task(&self, task_id: &TaskId) -> Result<(), String> {
        let mut tasks = self.tasks.write().await;

        if let Some(mut task) = tasks.remove(task_id) {
            info!("Cancelling task {}", task_id);

            // Signal cancellation
            if let Some(cancel_tx) = task.cancel_tx.take() {
                let _ = cancel_tx.send(());
            }

            // Kill the child process
            if let Err(e) = task.child.kill().await {
                warn!("Failed to kill process for task {}: {}", task_id, e);
            }

            Ok(())
        } else {
            Err(format!("Task {} not found", task_id))
        }
    }

    /// Respond to a permission request
    pub async fn respond_to_permission(
        &self,
        task_id: &TaskId,
        permission_id: String,
        action: PermissionAction,
        message: Option<String>,
    ) -> Result<(), String> {
        let msg = JanToOpenCode::PermissionResponse {
            id: task_id.clone(),
            payload: PermissionResponsePayload {
                permission_id,
                action,
                message,
            },
        };

        self.write_message(task_id, msg).await
    }

    /// Send user input to a task
    pub async fn send_input(&self, task_id: &TaskId, text: String) -> Result<(), String> {
        let msg = JanToOpenCode::Input {
            id: task_id.clone(),
            payload: InputPayload { text },
        };

        self.write_message(task_id, msg).await
    }

    /// Check if a task is still running
    pub async fn is_task_running(&self, task_id: &TaskId) -> bool {
        let tasks = self.tasks.read().await;
        tasks.contains_key(task_id)
    }

    /// Get the number of running tasks
    pub async fn running_task_count(&self) -> usize {
        let tasks = self.tasks.read().await;
        tasks.len()
    }

    /// Cancel all running tasks
    pub async fn cancel_all_tasks(&self) {
        let mut tasks = self.tasks.write().await;

        for (task_id, mut task) in tasks.drain() {
            info!("Cancelling task {} during shutdown", task_id);

            if let Some(cancel_tx) = task.cancel_tx.take() {
                let _ = cancel_tx.send(());
            }

            if let Err(e) = task.child.kill().await {
                warn!("Failed to kill process for task {}: {}", task_id, e);
            }
        }
    }
}

impl OpenCodeProcessManager {
    /// Create a process manager that auto-detects the best way to run OpenCode
    ///
    /// Priority:
    /// 1. Use built OpenCode binary from opencode/packages/opencode/dist (development)
    /// 2. Use bundled OpenCode binary in resources (production)
    /// 3. Fall back to system-installed opencode binary
    pub fn auto_detect() -> Self {
        // Get the current executable's directory (where Jan is installed)
        let exe_path = std::env::current_exe().ok();
        let exe_dir = exe_path.as_ref().and_then(|p| p.parent());

        // Determine platform-specific binary name and directory
        let (platform_dir, binary_name) = if cfg!(target_os = "windows") {
            ("opencode-windows-x64", "opencode.exe")
        } else if cfg!(target_os = "macos") {
            if cfg!(target_arch = "aarch64") {
                ("opencode-darwin-arm64", "opencode")
            } else {
                ("opencode-darwin-x64", "opencode")
            }
        } else {
            // Linux
            if cfg!(target_arch = "aarch64") {
                ("opencode-linux-arm64", "opencode")
            } else {
                ("opencode-linux-x64", "opencode")
            }
        };

        if let Some(bin_dir) = exe_dir {
            // Development: Look for built binary in opencode/packages/opencode/dist
            // Path: target/debug -> target -> src-tauri -> jan-app (3 levels up)
            let dev_opencode_root = bin_dir
                .parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .map(|p| p.join("opencode"));

            if let Some(opencode_root) = dev_opencode_root {
                let built_binary = opencode_root
                    .join("packages/opencode/dist")
                    .join(platform_dir)
                    .join("bin")
                    .join(binary_name);

                if built_binary.exists() {
                    info!("Found built OpenCode binary at: {}", built_binary.display());
                    return Self::with_binary(built_binary);
                }
            }

            // Production: Look for bundled binary in resources
            let bundled_binary = bin_dir
                .join("resources")
                .join("opencode")
                .join("bin")
                .join(binary_name);

            if bundled_binary.exists() {
                info!("Found bundled OpenCode binary at: {}", bundled_binary.display());
                return Self::with_binary(bundled_binary);
            }

            // Alternative: next to executable
            let adjacent_binary = bin_dir.join("opencode").join("bin").join(binary_name);
            if adjacent_binary.exists() {
                info!("Found adjacent OpenCode binary at: {}", adjacent_binary.display());
                return Self::with_binary(adjacent_binary);
            }
        }

        // Fall back to system-installed opencode binary
        let binary_candidates = [
            "/opt/homebrew/bin/opencode",
            "/usr/local/bin/opencode",
            "/usr/bin/opencode",
        ];

        for path in binary_candidates {
            let path_buf = PathBuf::from(path);
            if path_buf.exists() {
                info!("Found system opencode at: {}", path);
                return Self::with_binary(path_buf);
            }
        }

        // Check user's home directory
        if let Ok(home) = std::env::var("HOME") {
            let home_paths = [
                format!("{}/.local/bin/opencode", home),
                format!("{}/go/bin/opencode", home),
            ];
            for path in home_paths {
                let path_buf = PathBuf::from(&path);
                if path_buf.exists() {
                    info!("Found opencode in home at: {}", path);
                    return Self::with_binary(path_buf);
                }
            }
        }

        // Last resort: hope it's in PATH
        warn!("OpenCode not found, falling back to PATH lookup");
        Self::with_binary(PathBuf::from("opencode"))
    }
}

impl Default for OpenCodeProcessManager {
    fn default() -> Self {
        Self::auto_detect()
    }
}
