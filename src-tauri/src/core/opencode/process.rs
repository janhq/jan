use super::types::*;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, RwLock};
use log::{error, info, warn};

/// How to launch the OpenCode process
#[derive(Debug, Clone)]
enum LaunchMode {
    /// Run a compiled binary directly
    Binary(PathBuf),
    /// Run via bun in dev mode: `bun run --conditions=browser ./src/index.ts stdio ...`
    BunDev {
        bun_path: PathBuf,
        opencode_dir: PathBuf,
    },
}

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
    launch_mode: LaunchMode,
}

impl OpenCodeProcessManager {
    /// Create a process manager using a standalone binary
    pub fn with_binary(path: PathBuf) -> Self {
        Self {
            tasks: Arc::new(RwLock::new(HashMap::new())),
            launch_mode: LaunchMode::Binary(path),
        }
    }

    /// Create a process manager using bun dev mode
    pub fn with_bun_dev(bun_path: PathBuf, opencode_dir: PathBuf) -> Self {
        Self {
            tasks: Arc::new(RwLock::new(HashMap::new())),
            launch_mode: LaunchMode::BunDev { bun_path, opencode_dir },
        }
    }

    /// Spawn a new OpenCode task
    ///
    /// # Arguments
    /// * `task_id` - Unique identifier for this task
    /// * `project_path` - Path to the project directory
    /// * `prompt` - The task prompt/instruction
    /// * `agent` - Optional agent type (build, plan, explore)
    /// * `api_key` - Optional API key for the LLM provider
    /// * `provider_id` - Optional provider identifier (e.g., "anthropic", "openai")
    /// * `model_id` - Optional model identifier (e.g., "claude-sonnet-4-20250514")
    /// * `base_url` - Optional base URL for the provider API
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
        provider_id: Option<String>,
        model_id: Option<String>,
        base_url: Option<String>,
        event_tx: mpsc::Sender<(TaskId, OpenCodeToJan)>,
    ) -> Result<(), String> {
        info!(
            "Spawning OpenCode task: {} for project: {} with mode: {:?}",
            task_id, project_path, self.launch_mode
        );

        // Build the command depending on launch mode
        let mut cmd = match &self.launch_mode {
            LaunchMode::Binary(binary_path) => {
                let mut c = Command::new(binary_path);
                c.args(["stdio", "--project", &project_path]);
                c
            }
            LaunchMode::BunDev { bun_path, opencode_dir } => {
                let mut c = Command::new(bun_path);
                c.current_dir(opencode_dir);
                c.args([
                    "run",
                    "--conditions=browser",
                    "./src/index.ts",
                    "stdio",
                    "--project",
                    &project_path,
                ]);
                c
            }
        };

        if let Some(agent_name) = &agent {
            cmd.args(["--agent", agent_name]);
        }

        // Build OPENCODE_CONFIG_CONTENT to override OpenCode's global config
        // (~/.config/opencode/opencode.jsonc). OpenCode always uses Jan's selected
        // model via an OpenAI-compatible endpoint — regardless of whether the model
        // is local (llama.cpp) or remote (Anthropic, OpenAI, etc.).
        // Jan's inference server exposes all models through http://127.0.0.1:1337/v1.
        {
            let model_name = model_id.as_deref().unwrap_or("default");
            let server_url = base_url.as_deref().unwrap_or("http://127.0.0.1:1337/v1");
            let jan_provider_id = "jan";

            let mut config = serde_json::Map::new();

            // Set model in "provider/model" format
            config.insert(
                "model".to_string(),
                serde_json::Value::String(format!("{}/{}", jan_provider_id, model_name)),
            );

            // Configure the "jan" provider as OpenAI-compatible
            let mut provider_config = serde_json::Map::new();
            let mut provider_entry = serde_json::Map::new();
            provider_entry.insert("npm".to_string(), serde_json::Value::String("@ai-sdk/openai-compatible".to_string()));
            provider_entry.insert("name".to_string(), serde_json::Value::String("Jan Server".to_string()));

            // Provider options
            let mut options = serde_json::Map::new();
            options.insert("baseURL".to_string(), serde_json::Value::String(server_url.to_string()));
            if let Some(ref key) = api_key {
                options.insert("apiKey".to_string(), serde_json::Value::String(key.clone()));
            }
            provider_entry.insert("options".to_string(), serde_json::Value::Object(options));

            // Register the model in the provider's model list
            let mut models = serde_json::Map::new();
            let mut model_entry = serde_json::Map::new();
            model_entry.insert("name".to_string(), serde_json::Value::String(model_name.to_string()));
            models.insert(model_name.to_string(), serde_json::Value::Object(model_entry));
            provider_entry.insert("models".to_string(), serde_json::Value::Object(models));

            provider_config.insert(jan_provider_id.to_string(), serde_json::Value::Object(provider_entry));
            config.insert("provider".to_string(), serde_json::Value::Object(provider_config));

            let config_json = serde_json::to_string(&serde_json::Value::Object(config))
                .unwrap_or_else(|_| "{}".to_string());
            cmd.env("OPENCODE_CONFIG_CONTENT", &config_json);
            cmd.env("OPENCODE_DISABLE_PROJECT_CONFIG", "true");
            info!("Set OPENCODE_CONFIG_CONTENT: {}", config_json);
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
    /// 1. Dev mode: Use bun to run source directly from opencode/packages/opencode/
    /// 2. Use built OpenCode binary from opencode/packages/opencode/dist (development)
    /// 3. Use bundled OpenCode binary in resources (production)
    /// 4. Fall back to system-installed opencode binary
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
            // Development: Navigate from target/debug -> target -> src-tauri -> jan-app
            let project_root = bin_dir
                .parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent());

            if let Some(root) = project_root {
                let opencode_pkg_dir = root.join("opencode").join("packages").join("opencode");
                let opencode_entry = opencode_pkg_dir.join("src").join("index.ts");

                // Priority 1: Dev mode - use bun to run source directly
                if opencode_entry.exists() {
                    // Find bun binary
                    let bun_candidates: Vec<PathBuf> = vec![
                        // Common bun install locations
                        PathBuf::from(std::env::var("HOME")
                            .unwrap_or_default())
                            .join(".bun/bin/bun"),
                        PathBuf::from("/opt/homebrew/bin/bun"),
                        PathBuf::from("/usr/local/bin/bun"),
                        PathBuf::from("/usr/bin/bun"),
                    ];

                    for bun_path in bun_candidates {
                        if bun_path.exists() {
                            info!(
                                "Using bun dev mode: {} in {}",
                                bun_path.display(),
                                opencode_pkg_dir.display()
                            );
                            return Self::with_bun_dev(bun_path, opencode_pkg_dir);
                        }
                    }

                    // Try bun from PATH via `which`
                    if let Ok(output) = std::process::Command::new("which")
                        .arg("bun")
                        .output()
                    {
                        if output.status.success() {
                            let bun_path = String::from_utf8_lossy(&output.stdout)
                                .trim()
                                .to_string();
                            if !bun_path.is_empty() {
                                let bun_path = PathBuf::from(&bun_path);
                                info!(
                                    "Using bun dev mode (from PATH): {} in {}",
                                    bun_path.display(),
                                    opencode_pkg_dir.display()
                                );
                                return Self::with_bun_dev(bun_path, opencode_pkg_dir);
                            }
                        }
                    }
                }

                // Priority 2: Built binary from dist/
                let built_binary = opencode_pkg_dir
                    .join("dist")
                    .join(platform_dir)
                    .join("bin")
                    .join(binary_name);

                if built_binary.exists() {
                    info!("Found built OpenCode binary at: {}", built_binary.display());
                    return Self::with_binary(built_binary);
                }
            }

            // Priority 3: Bundled binary in resources (production)
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

        // Priority 4: System-installed opencode binary
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
