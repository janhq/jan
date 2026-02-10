#![allow(dead_code)]

use super::types::*;
use log::{error, info, warn};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, RwLock};

/// How to launch the OpenCode process
#[derive(Debug, Clone)]
enum LaunchMode {
    /// Run a compiled binary directly
    Binary(PathBuf),
    /// Run via bun in dev mode
    BunDev {
        bun_path: PathBuf,
        assistant_dir: PathBuf,
    },
}

/// Session ID type
pub type SessionId = String;

/// Handle for a running OpenCode task
struct OpenCodeTaskHandle {
    #[allow(dead_code)]
    child: Child,
    stdin_tx: mpsc::Sender<String>,
    cancel_tx: Option<oneshot::Sender<()>>,
}

/// Handle for a long-lived session process
struct OpenCodeSessionHandle {
    session_id: SessionId,
    project_path: String,
    child: Child,
    stdin_tx: mpsc::Sender<String>,
    active_tasks: Arc<RwLock<HashSet<TaskId>>>,
    last_activity: Arc<RwLock<Instant>>,
    agent: Option<String>,
    api_key: Option<String>,
    provider_id: Option<String>,
    model_id: Option<String>,
    base_url: Option<String>,
}

/// Manages OpenCode subprocess lifecycle with session support
pub struct OpenCodeProcessManager {
    tasks: Arc<RwLock<HashMap<TaskId, OpenCodeTaskHandle>>>,
    /// Sessions: reusable long-lived processes keyed by session ID
    sessions: Arc<RwLock<HashMap<SessionId, OpenCodeSessionHandle>>>,
    /// Event senders for session-based tasks (task_id -> event_tx)
    session_task_event_senders: Arc<RwLock<HashMap<TaskId, mpsc::Sender<(TaskId, OpenCodeToJan)>>>>,
    launch_mode: LaunchMode,
    /// Idle session timeout (10 minutes)
    idle_timeout: Duration,
}

impl OpenCodeProcessManager {
    /// Create a process manager using a standalone binary
    pub fn with_binary(path: PathBuf) -> Self {
        Self {
            tasks: Arc::new(RwLock::new(HashMap::new())),
            sessions: Arc::new(RwLock::new(HashMap::new())),
            session_task_event_senders: Arc::new(RwLock::new(HashMap::new())),
            launch_mode: LaunchMode::Binary(path),
            idle_timeout: Duration::from_secs(10 * 60), // 10 minutes
        }
    }

    /// Create a process manager using bun dev mode
    pub fn with_bun_dev(bun_path: PathBuf, assistant_dir: PathBuf) -> Self {
        Self {
            tasks: Arc::new(RwLock::new(HashMap::new())),
            sessions: Arc::new(RwLock::new(HashMap::new())),
            session_task_event_senders: Arc::new(RwLock::new(HashMap::new())),
            launch_mode: LaunchMode::BunDev {
                bun_path,
                assistant_dir,
            },
            idle_timeout: Duration::from_secs(10 * 60), // 10 minutes
        }
    }

    /// Get or create a session for the given project path
    async fn get_or_create_session(
        &self,
        session_id: &SessionId,
        project_path: String,
        agent: Option<String>,
        api_key: Option<String>,
        provider_id: Option<String>,
        model_id: Option<String>,
        base_url: Option<String>,
    ) -> Result<(), String> {
        let mut sessions = self.sessions.write().await;

        // Check if session already exists
        if let Some(existing_session) = sessions.get(session_id) {
            info!("Reusing existing session: {}", session_id);
            // Update last activity
            *existing_session.last_activity.write().await = Instant::now();
            return Ok(());
        }

        // Create new session process
        info!(
            "Creating new session: {} for project: {}",
            session_id, project_path
        );

        // Build the command
        let mut cmd = match &self.launch_mode {
            LaunchMode::Binary(binary_path) => {
                let mut c = Command::new(binary_path);
                c.args(["stdio", "--project", &project_path, "--session-mode"]);
                c
            }
            LaunchMode::BunDev {
                bun_path,
                assistant_dir,
            } => {
                let mut c = Command::new(bun_path);
                c.current_dir(assistant_dir);
                // Disable bunfig.toml to avoid loading TUI preload in stdio mode
                c.env("BUN_CONFIG_FILE", "");
                c.args([
                    "run",
                    "--conditions=browser",
                    "./src/index.ts",
                    "stdio",
                    "--project",
                    &project_path,
                    "--session-mode",
                ]);
                c
            }
        };

        if let Some(agent_name) = &agent {
            cmd.args(["--agent", agent_name]);
        }

        // Build config content for the assistant
        {
            let model_name = model_id.as_deref().unwrap_or("default");
            let server_url = base_url.as_deref().unwrap_or("http://127.0.0.1:1337/v1");
            let provider_name = provider_id.as_deref().unwrap_or("jan");

            let (npm_package, assistant_provider_id, provider_display_name) =
                match provider_name.to_lowercase().as_str() {
                    "anthropic" => ("@ai-sdk/anthropic", "anthropic", "Anthropic"),
                    "openai" => ("@ai-sdk/openai", "openai", "OpenAI"),
                    "azure" => ("@ai-sdk/azure", "azure", "Azure OpenAI"),
                    "google" | "gemini" => ("@ai-sdk/google", "google", "Google AI"),
                    "mistral" => ("@ai-sdk/mistral", "mistral", "Mistral"),
                    "groq" => ("@ai-sdk/groq", "groq", "Groq"),
                    "cohere" => ("@ai-sdk/cohere", "cohere", "Cohere"),
                    "xai" => ("@ai-sdk/xai", "xai", "xAI"),
                    "openrouter" => ("@openrouter/ai-sdk-provider", "openrouter", "OpenRouter"),
                    "togetherai" | "together" => ("@ai-sdk/togetherai", "togetherai", "Together AI"),
                    "deepinfra" => ("@ai-sdk/deepinfra", "deepinfra", "DeepInfra"),
                    "perplexity" => ("@ai-sdk/perplexity", "perplexity", "Perplexity"),
                    _ => ("@ai-sdk/openai-compatible", "jan", "Jan Server"),
                };

            let mut config = serde_json::Map::new();
            config.insert(
                "model".to_string(),
                serde_json::Value::String(format!("{}/{}", assistant_provider_id, model_name)),
            );

            let mut provider_config = serde_json::Map::new();
            let mut provider_entry = serde_json::Map::new();
            provider_entry.insert(
                "npm".to_string(),
                serde_json::Value::String(npm_package.to_string()),
            );
            provider_entry.insert(
                "name".to_string(),
                serde_json::Value::String(provider_display_name.to_string()),
            );

            let mut options = serde_json::Map::new();
            match npm_package {
                "@ai-sdk/anthropic" => {
                    if !server_url.contains("api.anthropic.com") {
                        options.insert(
                            "baseURL".to_string(),
                            serde_json::Value::String(server_url.to_string()),
                        );
                    }
                }
                "@ai-sdk/openai" => {
                    if !server_url.contains("api.openai.com") {
                        options.insert(
                            "baseURL".to_string(),
                            serde_json::Value::String(server_url.to_string()),
                        );
                    }
                }
                _ => {
                    options.insert(
                        "baseURL".to_string(),
                        serde_json::Value::String(server_url.to_string()),
                    );
                }
            }
            if let Some(ref key) = api_key {
                options.insert(
                    "apiKey".to_string(),
                    serde_json::Value::String(key.clone()),
                );
            }
            provider_entry.insert("options".to_string(), serde_json::Value::Object(options));

            let mut models = serde_json::Map::new();
            let mut model_entry = serde_json::Map::new();
            model_entry.insert(
                "name".to_string(),
                serde_json::Value::String(model_name.to_string()),
            );
            models.insert(
                model_name.to_string(),
                serde_json::Value::Object(model_entry),
            );
            provider_entry.insert("models".to_string(), serde_json::Value::Object(models));

            provider_config.insert(
                assistant_provider_id.to_string(),
                serde_json::Value::Object(provider_entry),
            );
            config.insert(
                "provider".to_string(),
                serde_json::Value::Object(provider_config),
            );

            let config_json = serde_json::to_string(&serde_json::Value::Object(config))
                .unwrap_or_else(|_| "{}".to_string());
            cmd.env("OPENCODE_CONFIG_CONTENT", &config_json);
            cmd.env("OPENCODE_DISABLE_PROJECT_CONFIG", "true");
        }

        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn OpenCode session process: {}", e))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to get stdin handle".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to get stdout handle".to_string())?;
        let stderr = child.stderr.take();

        let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(32);
        let active_tasks = Arc::new(RwLock::new(HashSet::new()));
        let last_activity = Arc::new(RwLock::new(Instant::now()));

        // Store session handle
        let session_handle = OpenCodeSessionHandle {
            session_id: session_id.clone(),
            project_path: project_path.clone(),
            child,
            stdin_tx: stdin_tx.clone(),
            active_tasks: active_tasks.clone(),
            last_activity: last_activity.clone(),
            agent: agent.clone(),
            api_key: api_key.clone(),
            provider_id: provider_id.clone(),
            model_id: model_id.clone(),
            base_url: base_url.clone(),
        };

        sessions.insert(session_id.clone(), session_handle);

        // Clone for async tasks
        let sessions_ref = self.sessions.clone();
        let event_senders_ref = self.session_task_event_senders.clone();
        let session_id_for_stdout = session_id.clone();
        let session_id_for_stderr = session_id.clone();

        // Spawn stdout reader for session - forwards events to task-specific event_tx
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }

                match serde_json::from_str::<OpenCodeToJan>(&line) {
                    Ok(msg) => {
                        // Extract task_id from the message
                        let task_id = match &msg {
                            OpenCodeToJan::Ready { id, .. } => id.clone(),
                            OpenCodeToJan::Event { id, .. } => id.clone(),
                            OpenCodeToJan::PermissionRequest { id, .. } => id.clone(),
                            OpenCodeToJan::Result { id, .. } => id.clone(),
                            OpenCodeToJan::Error { id, .. } => id.clone(),
                        };

                        info!(
                            "OpenCode session [{}] task [{}] -> {:?}",
                            session_id_for_stdout, task_id, msg
                        );

                        // Forward to the task's event sender
                        let event_senders = event_senders_ref.read().await;
                        if let Some(event_tx) = event_senders.get(&task_id) {
                            if event_tx.send((task_id.clone(), msg)).await.is_err() {
                                warn!("Event receiver dropped for task {}", task_id);
                            }
                        } else {
                            warn!("No event sender registered for task {}", task_id);
                        }
                    }
                    Err(e) => {
                        error!(
                            "Failed to parse OpenCode session message {}: {} - raw: {}",
                            session_id_for_stdout, e, line
                        );
                    }
                }
            }

            // Session stdout closed - remove session
            info!(
                "Session {} stdout closed, removing",
                session_id_for_stdout
            );
            let mut sessions = sessions_ref.write().await;
            sessions.remove(&session_id_for_stdout);
        });

        // Spawn stderr reader
        if let Some(stderr) = stderr {
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if !line.trim().is_empty() {
                        warn!(
                            "OpenCode session stderr [{}]: {}",
                            session_id_for_stderr, line
                        );
                    }
                }
            });
        }

        // Spawn stdin writer for session
        let stdin_task_id = session_id.clone();
        tokio::spawn(async move {
            let mut stdin = stdin;
            loop {
                tokio::select! {
                    msg = stdin_rx.recv() => {
                        match msg {
                            Some(data) => {
                                if let Err(e) = stdin.write_all(data.as_bytes()).await {
                                    error!("Failed to write to stdin for session {}: {}", stdin_task_id, e);
                                    break;
                                }
                                if let Err(e) = stdin.write_all(b"\n").await {
                                    error!("Failed to write newline for session {}: {}", stdin_task_id, e);
                                    break;
                                }
                                if let Err(e) = stdin.flush().await {
                                    error!("Failed to flush stdin for session {}: {}", stdin_task_id, e);
                                    break;
                                }
                                // Update last activity
                                last_activity.write().await.clone_from(&Instant::now());
                            }
                            None => {
                                info!("Stdin channel closed for session {}", stdin_task_id);
                                break;
                            }
                        }
                    }
                }
            }
        });

        Ok(())
    }

    /// Send a task to an existing session
    async fn send_task_to_session(
        &self,
        session_id: &SessionId,
        task_id: TaskId,
        prompt: String,
        event_tx: mpsc::Sender<(TaskId, OpenCodeToJan)>,
    ) -> Result<(), String> {
        // Register the event sender for this task BEFORE sending the task
        {
            let mut event_senders = self.session_task_event_senders.write().await;
            event_senders.insert(task_id.clone(), event_tx);
            info!("Registered event sender for task {}", task_id);
        }

        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;

        // Add task to active set
        session.active_tasks.write().await.insert(task_id.clone());

        // Send task message
        let task_msg = JanToOpenCode::Task {
            id: task_id.clone(),
            payload: TaskPayload {
                session_id: Some(session_id.clone()),
                project_path: session.project_path.clone(),
                prompt,
                agent: session.agent.clone(),
            },
        };

        let json = serde_json::to_string(&task_msg)
            .map_err(|e| format!("Failed to serialize task message: {}", e))?;

        session
            .stdin_tx
            .send(json)
            .await
            .map_err(|e| format!("Failed to send task to session: {}", e))?;

        Ok(())
    }

    /// Clean up idle sessions (internal helper)
    async fn cleanup_idle_sessions_internal(&self) {
        let mut sessions = self.sessions.write().await;
        let now = Instant::now();

        let mut to_remove = Vec::new();

        for (session_id, handle) in sessions.iter() {
            let last_activity = *handle.last_activity.read().await;
            let idle_duration = now.duration_since(last_activity);

            if idle_duration > self.idle_timeout {
                let active_count = handle.active_tasks.read().await.len();
                if active_count == 0 {
                    info!(
                        "Cleaning up idle session {} (idle for {:?})",
                        session_id, idle_duration
                    );
                    to_remove.push(session_id.clone());
                }
            }
        }

        for session_id in to_remove {
            if let Some(mut handle) = sessions.remove(&session_id) {
                let _ = handle.child.kill().await;
            }
        }
    }

    /// Spawn a new OpenCode task (legacy - spawns new process per task)
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
            LaunchMode::BunDev {
                bun_path,
                assistant_dir,
            } => {
                let mut c = Command::new(bun_path);
                c.current_dir(assistant_dir);
                // Disable bunfig.toml to avoid loading TUI preload in stdio mode
                c.env("BUN_CONFIG_FILE", "");
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

        // Build config content for the assistant
        {
            let model_name = model_id.as_deref().unwrap_or("default");
            let server_url = base_url.as_deref().unwrap_or("http://127.0.0.1:1337/v1");
            let provider_name = provider_id.as_deref().unwrap_or("jan");

            // Map well-known providers to their native AI SDK packages
            let (npm_package, assistant_provider_id, provider_display_name) =
                match provider_name.to_lowercase().as_str() {
                    "anthropic" => ("@ai-sdk/anthropic", "anthropic", "Anthropic"),
                    "openai" => ("@ai-sdk/openai", "openai", "OpenAI"),
                    "azure" => ("@ai-sdk/azure", "azure", "Azure OpenAI"),
                    "google" | "gemini" => ("@ai-sdk/google", "google", "Google AI"),
                    "mistral" => ("@ai-sdk/mistral", "mistral", "Mistral"),
                    "groq" => ("@ai-sdk/groq", "groq", "Groq"),
                    "cohere" => ("@ai-sdk/cohere", "cohere", "Cohere"),
                    "xai" => ("@ai-sdk/xai", "xai", "xAI"),
                    "openrouter" => ("@openrouter/ai-sdk-provider", "openrouter", "OpenRouter"),
                    "togetherai" | "together" => ("@ai-sdk/togetherai", "togetherai", "Together AI"),
                    "deepinfra" => ("@ai-sdk/deepinfra", "deepinfra", "DeepInfra"),
                    "perplexity" => ("@ai-sdk/perplexity", "perplexity", "Perplexity"),
                    // For local models or unknown providers, use OpenAI-compatible
                    _ => ("@ai-sdk/openai-compatible", "jan", "Jan Server"),
                };

            let mut config = serde_json::Map::new();

            // Set model in "provider/model" format
            config.insert(
                "model".to_string(),
                serde_json::Value::String(format!("{}/{}", assistant_provider_id, model_name)),
            );

            // Configure the provider with appropriate SDK
            let mut provider_config = serde_json::Map::new();
            let mut provider_entry = serde_json::Map::new();
            provider_entry.insert(
                "npm".to_string(),
                serde_json::Value::String(npm_package.to_string()),
            );
            provider_entry.insert(
                "name".to_string(),
                serde_json::Value::String(provider_display_name.to_string()),
            );

            // Provider options
            let mut options = serde_json::Map::new();
            match npm_package {
                "@ai-sdk/anthropic" => {
                    if !server_url.contains("api.anthropic.com") {
                        options.insert(
                            "baseURL".to_string(),
                            serde_json::Value::String(server_url.to_string()),
                        );
                    }
                }
                "@ai-sdk/openai" => {
                    if !server_url.contains("api.openai.com") {
                        options.insert(
                            "baseURL".to_string(),
                            serde_json::Value::String(server_url.to_string()),
                        );
                    }
                }
                _ => {
                    options.insert(
                        "baseURL".to_string(),
                        serde_json::Value::String(server_url.to_string()),
                    );
                }
            }
            if let Some(ref key) = api_key {
                options.insert(
                    "apiKey".to_string(),
                    serde_json::Value::String(key.clone()),
                );
            }
            provider_entry.insert("options".to_string(), serde_json::Value::Object(options));

            // Register the model in the provider's model list
            let mut models = serde_json::Map::new();
            let mut model_entry = serde_json::Map::new();
            model_entry.insert(
                "name".to_string(),
                serde_json::Value::String(model_name.to_string()),
            );
            models.insert(
                model_name.to_string(),
                serde_json::Value::Object(model_entry),
            );
            provider_entry.insert("models".to_string(), serde_json::Value::Object(models));

            provider_config.insert(
                assistant_provider_id.to_string(),
                serde_json::Value::Object(provider_entry),
            );
            config.insert(
                "provider".to_string(),
                serde_json::Value::Object(provider_config),
            );

            let config_json = serde_json::to_string(&serde_json::Value::Object(config))
                .unwrap_or_else(|_| "{}".to_string());
            cmd.env("OPENCODE_CONFIG_CONTENT", &config_json);
            cmd.env("OPENCODE_DISABLE_PROJECT_CONFIG", "true");
            info!(
                "Set config content for provider '{}': {}",
                provider_name, config_json
            );
        }

        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        // Spawn the process
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn OpenCode process: {}", e))?;

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

    // ============================================================================
    // Session-based methods
    // ============================================================================

    /// Spawn a task using session-based process reuse
    pub async fn spawn_task_with_session(
        &self,
        session_id: SessionId,
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
            "Spawning OpenCode task {} in session {} for project: {}",
            task_id, session_id, project_path
        );

        // Get or create session (this spawns a long-lived process if needed)
        self.get_or_create_session(
            &session_id,
            project_path.clone(),
            agent.clone(),
            api_key.clone(),
            provider_id.clone(),
            model_id.clone(),
            base_url.clone(),
        )
        .await?;

        // Send task to the session
        self.send_task_to_session(&session_id, task_id.clone(), prompt, event_tx.clone())
            .await?;

        // Clone for async tasks
        let task_id_clone = task_id.clone();
        let session_id_clone = session_id.clone();
        let sessions_clone = self.sessions.clone();
        let event_senders_clone = self.session_task_event_senders.clone();

        // Track task completion and cleanup
        tokio::spawn(async move {
            // Periodically check if task is still active in session
            let mut interval = tokio::time::interval(Duration::from_secs(5));
            let mut completed = false;

            loop {
                interval.tick().await;

                let sessions = sessions_clone.read().await;
                if let Some(session) = sessions.get(&session_id_clone) {
                    let active_tasks = session.active_tasks.read().await;
                    if !active_tasks.contains(&task_id_clone) && !completed {
                        // Task completed - cleanup event sender
                        completed = true;
                        drop(active_tasks);
                        drop(sessions);
                        let mut event_senders = event_senders_clone.write().await;
                        event_senders.remove(&task_id_clone);
                        info!("Cleaned up event sender for completed task {}", task_id_clone);
                        break;
                    } else if active_tasks.contains(&task_id_clone) {
                        // Task still running, update activity
                        *session.last_activity.write().await = Instant::now();
                    }
                } else {
                    // Session gone - cleanup event sender
                    drop(sessions);
                    let mut event_senders = event_senders_clone.write().await;
                    event_senders.remove(&task_id_clone);
                    info!("Cleaned up event sender for task {} (session gone)", task_id_clone);
                    break;
                }
            }
        });

        info!("Task {} started in session {}", task_id, session_id);
        Ok(())
    }

    /// Get the number of active sessions
    pub async fn session_count(&self) -> usize {
        let sessions = self.sessions.read().await;
        sessions.len()
    }

    /// End a specific session and kill its process
    pub async fn end_session(&self, session_id: &SessionId) -> Result<(), String> {
        let mut sessions = self.sessions.write().await;

        if let Some(mut handle) = sessions.remove(session_id) {
            info!("Ending session {}", session_id);
            if let Err(e) = handle.child.kill().await {
                warn!("Failed to kill session process {}: {}", session_id, e);
            }
            Ok(())
        } else {
            Err(format!("Session {} not found", session_id))
        }
    }

    /// Clean up all idle sessions
    pub async fn cleanup_idle_sessions(&self) {
        self.cleanup_idle_sessions_internal().await
    }
}

impl OpenCodeProcessManager {
    /// Create a process manager that auto-detects the best way to run the assistant
    pub fn auto_detect() -> Self {
        // Get the current executable's directory
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
                let assistant_pkg_dir = root.join("opencode").join("packages").join("opencode");
                let assistant_entry = assistant_pkg_dir.join("src").join("index.ts");

                // Priority 1: Dev mode - use bun to run source directly
                if assistant_entry.exists() {
                    // Find bun binary
                    let bun_candidates: Vec<PathBuf> = vec![
                        PathBuf::from(std::env::var("HOME").unwrap_or_default())
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
                                assistant_pkg_dir.display()
                            );
                            return Self::with_bun_dev(bun_path, assistant_pkg_dir);
                        }
                    }

                    // Try bun from PATH via `which`
                    if let Ok(output) = std::process::Command::new("which").arg("bun").output() {
                        if output.status.success() {
                            let bun_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                            if !bun_path.is_empty() {
                                let bun_path = PathBuf::from(&bun_path);
                                info!(
                                    "Using bun dev mode (from PATH): {} in {}",
                                    bun_path.display(),
                                    assistant_pkg_dir.display()
                                );
                                return Self::with_bun_dev(bun_path, assistant_pkg_dir);
                            }
                        }
                    }
                }

                // Priority 2: Built binary from dist/
                let built_binary = assistant_pkg_dir
                    .join("dist")
                    .join(platform_dir)
                    .join("bin")
                    .join(binary_name);

                if built_binary.exists() {
                    info!(
                        "Found built OpenCode binary at: {}",
                        built_binary.display()
                    );
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
                info!(
                    "Found bundled OpenCode binary at: {}",
                    bundled_binary.display()
                );
                return Self::with_binary(bundled_binary);
            }

            // Alternative: next to executable
            let adjacent_binary = bin_dir.join("opencode").join("bin").join(binary_name);
            if adjacent_binary.exists() {
                info!(
                    "Found adjacent OpenCode binary at: {}",
                    adjacent_binary.display()
                );
                return Self::with_binary(adjacent_binary);
            }
        }

        // Priority 4: System-installed binary
        let binary_candidates = [
            "/opt/homebrew/bin/opencode",
            "/usr/local/bin/opencode",
            "/usr/bin/opencode",
        ];

        for path in binary_candidates {
            let path_buf = PathBuf::from(path);
            if path_buf.exists() {
                info!("Found system OpenCode at: {}", path);
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
                    info!("Found OpenCode in home at: {}", path);
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
