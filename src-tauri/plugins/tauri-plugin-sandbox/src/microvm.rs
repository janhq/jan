//! MicroVM code execution via [microsandbox](https://github.com/zerocore-ai/microsandbox).
//!
//! Supported on Linux and macOS (Unix).
//!
//! Start the server externally before use:
//! ```bash
//! export MICROSANDBOX_URL=http://127.0.0.1:5555   # optional override
//! msb server start --dev
//! ```
//!
//! If the server is not reachable, calls fall back to the bundled WASM runtime.

use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::Mutex as TokioMutex;

// ── State ─────────────────────────────────────────────────────────────────────

#[cfg(unix)]
const DEFAULT_SERVER_URL: &str = "http://127.0.0.1:5555";

/// Counts executions for unique sandbox names.
#[cfg(unix)]
static EXEC_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

// ── Workspace constants ───────────────────────────────────────────────────────

/// Destroy a workspace after this many seconds of inactivity.
#[cfg(unix)]
const WORKSPACE_IDLE_SECS: u64 = 30 * 60;

/// Guest port agents should listen on for web servers.
/// Exposed on a free host port via port_map once the microsandbox SDK supports it.
#[cfg(unix)]
#[allow(dead_code)]
const WORKSPACE_GUEST_PORT: u16 = 3000;

/// How many times to probe for a listening port after exec returns.
#[cfg(unix)]
const PORT_PROBE_RETRIES: u32 = 6;

/// Delay between port probes (ms).
#[cfg(unix)]
const PORT_PROBE_DELAY_MS: u64 = 500;

/// `true` once the background eviction task has been spawned.
#[cfg(unix)]
static EVICTION_STARTED: AtomicBool = AtomicBool::new(false);

/// Unique prefix for workspace sandbox names in this process invocation.
///
/// Prevents "5002 sandbox already exists" errors when the CLI restarts while
/// the microsandbox server still has workspaces from the previous run in memory.
/// The model-facing workspace ID (e.g. "blog") is unchanged; internally we use
/// "<prefix>-blog" as the actual sandbox name on the server.
#[cfg(unix)]
static SESSION_PREFIX: OnceLock<String> = OnceLock::new();

#[cfg(unix)]
fn session_prefix() -> &'static str {
    SESSION_PREFIX.get_or_init(|| {
        use std::time::{SystemTime, UNIX_EPOCH};
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        format!("jan{ts}")
    })
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Execute `code` in a microsandbox microVM (async).
pub async fn run_in_microvm(language: &str, code: &str) -> Result<Value, String> {
    #[cfg(unix)]
    return run_microsandbox(language, code).await;

    #[cfg(not(unix))]
    {
        let _ = (language, code);
        Err("microsandbox is not yet supported on Windows.".into())
    }
}

/// Synchronous entry point for Wasmtime `func_wrap` callbacks.
///
/// Bridges into the current Tokio runtime via `Handle::current().block_on()`.
/// Returns `Err` when the server cannot be started — callers fall back to the
/// WASM runtime in that case.
pub fn run_in_microvm_blocking(language: &str, code: &str) -> Result<Value, String> {
    #[cfg(unix)]
    {
        let handle = tokio::runtime::Handle::try_current()
            .map_err(|_| "microsandbox requires a Tokio runtime context".to_string())?;
        handle.block_on(run_microsandbox(language, code))
    }

    #[cfg(not(unix))]
    {
        let _ = (language, code);
        Err("microsandbox is not yet supported on Windows.".into())
    }
}

// ── Core execution ────────────────────────────────────────────────────────────

#[cfg(unix)]
async fn run_microsandbox(language: &str, code: &str) -> Result<Value, String> {
    use microsandbox::{NodeSandbox, PythonSandbox, SandboxOptions};

    let server_url = std::env::var("MICROSANDBOX_URL")
        .unwrap_or_else(|_| DEFAULT_SERVER_URL.to_string());

    let id   = EXEC_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let name = format!("jan-exec-{id}");

    log::info!(
        "[microvm] server={server_url} sandbox={name} language={language} ({} bytes)",
        code.len()
    );

    let options = SandboxOptions::builder()
        .server_url(&server_url)
        .name(&name)
        .build();

    match language {
        "javascript" | "js" => {
            let mut sb = NodeSandbox::create_with_options(options)
                .await
                .map_err(|e| unavailable_msg("NodeSandbox", &e.to_string()))?;
            exec_and_collect(&mut sb, &name, code, false).await
        }

        "python" | "python3" => {
            let mut sb = PythonSandbox::create_with_options(options)
                .await
                .map_err(|e| unavailable_msg_python(&e.to_string()))?;
            exec_and_collect(&mut sb, &name, code, false).await
        }

        other => Err(format!(
            "unsupported language '{other}' (supported: javascript, python)"
        )),
    }
}

// ── Raw RPC client (bypasses SDK to support port mapping) ────────────────────

/// Thin JSON-RPC client for a single microsandbox workspace.
///
/// The `microsandbox` 0.1.2 SDK's `StartOptions` does not expose port mapping,
/// so we call `sandbox.start` / `sandbox.repl.run` / `sandbox.stop` directly
/// via HTTP.  This lets us map guest port 3000 → a free host port so callers
/// can reach web servers started inside the VM.
#[cfg(unix)]
struct RawWorkspace {
    server_url: String,
    namespace:  String,
    name:       String,
    client:     reqwest::Client,
}

#[cfg(unix)]
impl RawWorkspace {
    fn new(server_url: &str, name: &str) -> Self {
        Self {
            server_url: server_url.to_string(),
            namespace:  "default".to_string(),
            name:       name.to_string(),
            client:     reqwest::Client::new(),
        }
    }

    /// Send a JSON-RPC request and return the `result` field.
    async fn rpc(&self, method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
        // Simple incrementing ID — no uuid dependency needed.
        static RPC_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let id = RPC_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

        let body = serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
            "id": id,
        });

        let resp = self.client
            .post(format!("{}/api/v1/rpc", self.server_url))
            .header("content-type", "application/json")
            .json(&body)
            .timeout(Duration::from_secs(1800)) // 30 min — same as WALL_CLOCK_TIMEOUT_SECS
            .send()
            .await
            .map_err(|e| format!("microsandbox RPC {method}: {e}"))?;

        let data: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("microsandbox RPC {method} parse: {e}"))?;

        if let Some(err) = data.get("error") {
            return Err(format!("microsandbox {method}: {err}"));
        }

        Ok(data["result"].clone())
    }

    /// Start the VM with `host_port` mapped to guest port 3000.
    async fn start(&self, host_port: u16) -> Result<(), String> {
        let params = serde_json::json!({
            "namespace": self.namespace,
            "sandbox":   self.name,
            "config": {
                "image":  "microsandbox/node",
                "memory": 512,
                "cpus":   1,
                "ports":  [format!("{host_port}:3000")],
            },
        });
        self.rpc("sandbox.start", params).await?;
        Ok(())
    }

    /// Execute JavaScript code and return `{exit_code, stdout, stderr}`.
    async fn run_js(&self, code: &str) -> Result<serde_json::Value, String> {
        use serde_json::json;

        let params = json!({
            "sandbox":   self.name,
            "namespace": self.namespace,
            "language":  "javascript",
            "code":      code,
        });

        let result = self.rpc("sandbox.repl.run", params).await?;

        // Parse the Execution format: { status, language, output: [{stream, text}…] }
        let status = result["status"].as_str().unwrap_or("unknown");
        let mut stdout = String::new();
        let mut stderr = String::new();

        if let Some(lines) = result["output"].as_array() {
            for line in lines {
                let stream = line["stream"].as_str().unwrap_or("");
                let text   = line["text"].as_str().unwrap_or("");
                if stream == "stdout" {
                    stdout.push_str(text);
                    stdout.push('\n');
                } else if stream == "stderr" {
                    stderr.push_str(text);
                    stderr.push('\n');
                }
            }
        }

        if stdout.ends_with('\n') { stdout.pop(); }
        if stderr.ends_with('\n') { stderr.pop(); }

        let has_error = status == "error" || status == "exception" || !stderr.is_empty();
        let exit_code = if has_error { 1i32 } else { 0i32 };

        Ok(json!({ "exit_code": exit_code, "stdout": stdout, "stderr": stderr }))
    }

    /// Stop the VM.
    async fn stop(&self) -> Result<(), String> {
        let params = serde_json::json!({
            "namespace": self.namespace,
            "sandbox":   self.name,
        });
        let _ = self.rpc("sandbox.stop", params).await;
        Ok(())
    }
}

// ── Workspace registry ────────────────────────────────────────────────────────

/// A long-lived microsandbox VM dedicated to one agent task.
///
/// The sandbox is created on first use and kept alive between `exec` calls.
/// A background task evicts workspaces that have been idle for
/// [`WORKSPACE_IDLE_SECS`] seconds.
#[cfg(unix)]
pub struct Workspace {
    pub id:        String,
    sandbox:       RawWorkspace,
    /// Host-side port mapped → guest port 3000 inside the VM.
    pub host_port: u16,
    last_used:     Instant,
}

#[cfg(unix)]
struct WorkspaceRegistry {
    map: std::sync::Mutex<HashMap<String, Arc<TokioMutex<Workspace>>>>,
}

#[cfg(unix)]
impl WorkspaceRegistry {
    fn new() -> Self {
        Self { map: std::sync::Mutex::new(HashMap::new()) }
    }

    /// Return the existing workspace for `id`, or create a new one.
    async fn get_or_create(&self, id: &str) -> Result<Arc<TokioMutex<Workspace>>, String> {
        // Fast path — already running.
        {
            let map = self.map.lock().unwrap();
            if let Some(ws) = map.get(id) {
                return Ok(ws.clone());
            }
        }

        let ws  = create_workspace_vm(id).await?;
        let arc = Arc::new(TokioMutex::new(ws));

        let mut map = self.map.lock().unwrap();
        // Another task may have created it while we were awaiting.
        Ok(map.entry(id.to_string()).or_insert(arc).clone())
    }

    /// Stop and remove all workspaces.  Called on process exit.
    async fn destroy_all(&self) {
        let entries: Vec<_> = self.map.lock().unwrap().drain().collect();
        for (id, arc) in entries {
            let ws = arc.lock().await;
            log::info!("[microvm] shutdown: stopping workspace '{id}'");
            let _ = ws.sandbox.stop().await;
        }
    }

    /// Stop workspaces that have been idle longer than [`WORKSPACE_IDLE_SECS`].
    async fn evict_idle(&self) {
        let stale: Vec<_> = {
            let map = self.map.lock().unwrap();
            map.iter()
                .filter_map(|(k, v)| {
                    v.try_lock().ok().and_then(|ws| {
                        (ws.last_used.elapsed().as_secs() > WORKSPACE_IDLE_SECS)
                            .then(|| k.clone())
                    })
                })
                .collect()
        };

        for id in stale {
            let arc = self.map.lock().unwrap().remove(&id);
            if let Some(arc) = arc {
                log::info!("[microvm] evicting idle workspace '{id}'");
                let _ = arc.lock().await.sandbox.stop().await;
            }
        }
    }
}

#[cfg(unix)]
static WORKSPACES: OnceLock<Arc<WorkspaceRegistry>> = OnceLock::new();

#[cfg(unix)]
fn workspace_registry() -> &'static Arc<WorkspaceRegistry> {
    WORKSPACES.get_or_init(|| Arc::new(WorkspaceRegistry::new()))
}

/// Spawn the background eviction task exactly once.
#[cfg(unix)]
fn ensure_eviction_task() {
    if EVICTION_STARTED
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_ok()
    {
        let registry = workspace_registry().clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(5 * 60)).await;
                registry.evict_idle().await;
            }
        });
    }
}

/// Allocate an OS-assigned free TCP port.
#[cfg(unix)]
fn find_free_port() -> Option<u16> {
    std::net::TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|l| l.local_addr().ok())
        .map(|a| a.port())
}

/// Boot a new workspace VM and return it.
///
/// Uses [`RawWorkspace`] to call `sandbox.start` directly with port mapping,
/// so that guest port 3000 is reachable at `host_port` on the host.
#[cfg(unix)]
async fn create_workspace_vm(id: &str) -> Result<Workspace, String> {
    let server_url = std::env::var("MICROSANDBOX_URL")
        .unwrap_or_else(|_| DEFAULT_SERVER_URL.to_string());

    let host_port = find_free_port()
        .ok_or_else(|| "workspace: no free TCP port available".to_string())?;

    let sandbox = RawWorkspace::new(&server_url, id);

    // Start the VM with host_port → guest:3000 mapped so web servers are reachable.
    sandbox.start(host_port).await
        .map_err(|e| format!("workspace '{id}' create failed: {e}"))?;

    // Wipe contents of /workspace so each logical workspace starts clean even
    // when the VM image retains state from a previous run via overlayfs.
    let init = sandbox.run_js(
        "const fs=require('fs'),p=require('path');\
         fs.mkdirSync('/workspace',{recursive:true});\
         for(const e of fs.readdirSync('/workspace')){\
           try{fs.rmSync(p.join('/workspace',e),{recursive:true,force:true});}catch(_){}\
         }\
         process.stdout.write('workspace-clean\\n');",
    ).await.map_err(|e| format!("workspace '{id}' init failed: {e}"))?;

    log::info!(
        "[microvm] workspace '{id}' started (host_port={host_port}) init={}",
        init["stdout"].as_str().unwrap_or("").trim()
    );

    Ok(Workspace { id: id.to_string(), sandbox, host_port, last_used: Instant::now() })
}

/// Wrap non-JS languages in Node.js `child_process` calls so that a single
/// `NodeSandbox` can run any language the agent needs.
///
/// The command/code is embedded as a JSON string literal to avoid shell-escaping
/// issues — `serde_json` produces a valid JSON string with all special chars
/// escaped.
#[cfg(unix)]
fn wrap_for_node(language: &str, code: &str) -> Result<String, String> {
    match language {
        // Wrap in an IIFE so `const`/`let` declarations don't leak into the
        // persistent Node.js REPL context across multiple exec calls, which
        // would cause "Identifier already declared" SyntaxErrors on re-use.
        "javascript" | "js" => Ok(format!("(function(){{\n{code}\n}})();")),

        "bash" | "shell" | "sh" => {
            let cmd_json = serde_json::Value::String(code.to_string()).to_string();
            // Wrapped in an IIFE so `const` declarations don't leak into the
            // microsandbox Node.js context across multiple exec calls (which
            // would cause "Identifier already declared" errors).
            //
            // Background commands (ending with `&`) must be spawned with
            // `detached: true` + `stdio: 'ignore'` so that execSync does not
            // wait for the child's stdout/stderr pipe to be closed (which would
            // block forever since a long-running server never closes its fd).
            Ok(format!(
                r#"(function() {{
    const {{execSync, spawn}} = require('child_process');
    const _cmd = {cmd_json};
    const _isBg = _cmd.trimEnd().endsWith('&');
    if (_isBg) {{
        const _bgCmd = _cmd.trimEnd().slice(0, -1).trim();
        const _child = spawn('bash', ['-c', _bgCmd], {{
            cwd: '/workspace',
            stdio: ['ignore', 'ignore', 'ignore'],
            detached: true,
        }});
        _child.unref();
        process.stdout.write('started in background\n');
    }} else {{
        try {{
            const out = execSync(_cmd, {{cwd: '/workspace', encoding: 'utf8', stdio: 'pipe'}});
            process.stdout.write(out ?? '');
        }} catch (e) {{
            if (e.stdout) process.stdout.write(e.stdout);
            if (e.stderr) process.stderr.write(e.stderr);
            process.exitCode = e.status ?? 1;
        }}
    }}
}})();"#
            ))
        }

        "python" | "python3" => {
            let code_json = serde_json::Value::String(code.to_string()).to_string();
            Ok(format!(
                r#"(function() {{
    const {{spawnSync}} = require('child_process');
    const r = spawnSync('python3', ['-c', {code_json}], {{cwd:'/workspace', encoding:'utf8'}});
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.status !== 0) process.exitCode = r.status ?? 1;
}})();"#
            ))
        }

        other => Err(format!(
            "unsupported language '{other}' in workspace (supported: javascript, bash, python)"
        )),
    }
}

/// Probe `host_port` up to [`PORT_PROBE_RETRIES`] times to detect a newly
/// started server.  Returns the URL if something is listening.
#[cfg(unix)]
async fn probe_workspace_port(host_port: u16) -> Option<String> {
    let addr = format!("127.0.0.1:{host_port}");
    for _ in 0..PORT_PROBE_RETRIES {
        tokio::time::sleep(Duration::from_millis(PORT_PROBE_DELAY_MS)).await;
        if tokio::net::TcpStream::connect(&addr).await.is_ok() {
            return Some(format!("http://localhost:{host_port}"));
        }
    }
    None
}

/// Execute `language`/`code` inside a persistent workspace VM.
///
/// The workspace is created on first call with `workspace_id` and reused on
/// subsequent calls.  After execution the host port is probed; if a server
/// is listening the returned JSON includes a `"url"` field.
#[cfg(unix)]
pub async fn workspace_exec(
    workspace_id: &str,
    language: &str,
    code: &str,
) -> Result<Value, String> {
    ensure_eviction_task();

    let js_code = wrap_for_node(language, code)?;

    // Use a session-prefixed sandbox name so that process restarts never
    // collide with workspaces the microsandbox server still has in memory
    // from the previous run (which would return error 5002).
    let sandbox_name = format!("{}-{workspace_id}", session_prefix());

    let registry  = workspace_registry();
    let arc       = registry.get_or_create(&sandbox_name).await?;
    let host_port;

    let mut output = {
        let mut ws = arc.lock().await;
        ws.last_used = Instant::now();
        host_port    = ws.host_port;

        log::info!(
            "[microvm] workspace '{workspace_id}' (sandbox={sandbox_name}) exec: language={language} ({} bytes)",
            code.len()
        );

        // Use RawWorkspace.run_js directly — no re-start needed since the VM
        // was already started (with port mapping) in create_workspace_vm.
        let result = ws.sandbox.run_js(&js_code).await
            .map_err(|e| format!("workspace exec failed: {e}"))?;

        let stdout = result["stdout"].as_str().unwrap_or("").to_string();
        let stderr = result["stderr"].as_str().unwrap_or("").to_string();
        let exit_code = result["exit_code"].as_i64().unwrap_or(0) as i32;

        log::info!(
            "[microvm] '{sandbox_name}' exit_code={exit_code} stdout={} bytes stderr={} bytes",
            stdout.len(), stderr.len()
        );
        if !stdout.is_empty() {
            let preview: String = stdout.chars().take(300).collect();
            log::info!("[microvm] '{sandbox_name}' stdout: {preview}");
        }
        if !stderr.is_empty() {
            let preview: String = stderr.chars().take(500).collect();
            log::warn!("[microvm] '{sandbox_name}' stderr: {preview}");
        }

        result
    };
    // Lock released — probe without holding it so other calls can proceed.

    if let Some(url) = probe_workspace_port(host_port).await {
        log::info!("[microvm] workspace '{workspace_id}' server detected at {url}");
        output["url"] = serde_json::Value::String(url);
    }

    Ok(output)
}

/// Synchronous bridge for use inside Wasmtime `func_wrap` callbacks.
#[cfg(unix)]
pub fn workspace_exec_blocking(
    workspace_id: &str,
    language: &str,
    code: &str,
) -> Result<Value, String> {
    let handle = tokio::runtime::Handle::try_current()
        .map_err(|_| "workspace_exec requires a Tokio runtime".to_string())?;
    handle.block_on(workspace_exec(workspace_id, language, code))
}

/// Stop all running workspace VMs.  Call this before the process exits to
/// avoid orphaned microVMs in the microsandbox server.
pub async fn shutdown_workspaces() {
    #[cfg(unix)]
    workspace_registry().destroy_all().await;
}

// ── Error messages ────────────────────────────────────────────────────────────

#[cfg(unix)]
fn unavailable_msg(kind: &str, cause: &str) -> String {
    format!("microsandbox {kind} unavailable: {cause}")
}

#[cfg(unix)]
fn unavailable_msg_python(cause: &str) -> String {
    format!(
        "microsandbox PythonSandbox unavailable: {cause}\n\
         Python image may not be pulled yet.  Run:\n\
         \x20 msb pull microsandbox/python"
    )
}

// ── Shared execution helper ───────────────────────────────────────────────────

/// Execute `code` in `sb` and collect stdout/stderr.
///
/// `keep_alive` — when `true` the sandbox is **not** stopped after execution
/// (used for workspace VMs that persist across calls).
#[cfg(unix)]
async fn exec_and_collect<S>(sb: &mut S, name: &str, code: &str, keep_alive: bool) -> Result<Value, String>
where
    S: microsandbox::BaseSandbox,
{
    use serde_json::json;

    let exec_result = sb
        .run_or_start(code)
        .await
        .map_err(|e| format!("microsandbox: execution failed: {e}"));

    if keep_alive {
        log::debug!("[microvm] workspace '{name}' keeping alive");
    } else {
        // Ephemeral: always stop — no orphaned microVMs.
        if let Err(e) = sb.stop().await {
            log::warn!("[microvm] failed to stop sandbox '{name}': {e}");
        } else {
            log::debug!("[microvm] sandbox '{name}' stopped");
        }
    }

    let exec = exec_result?;

    let stdout = exec
        .output()
        .await
        .map_err(|e| format!("microsandbox: reading stdout failed: {e}"))?;
    let stderr = exec
        .error()
        .await
        .map_err(|e| format!("microsandbox: reading stderr failed: {e}"))?;

    let exit_code = if exec.has_error() { 1i32 } else { 0i32 };

    log::info!(
        "[microvm] '{name}' exit_code={exit_code} stdout={} bytes stderr={} bytes",
        stdout.len(),
        stderr.len()
    );
    if !stdout.is_empty() {
        let preview: String = stdout.chars().take(300).collect();
        log::info!("[microvm] '{name}' stdout: {preview}");
    }
    if !stderr.is_empty() {
        let preview: String = stderr.chars().take(500).collect();
        log::warn!("[microvm] '{name}' stderr: {preview}");
    }

    Ok(json!({
        "exit_code": exit_code,
        "stdout":    stdout,
        "stderr":    stderr,
    }))
}
