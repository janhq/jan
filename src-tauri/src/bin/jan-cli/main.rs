//! jan — headless CLI for Jan.
//!
//! Shares all core logic with the Jan desktop app.
//! Build with: cargo build --features cli --bin jan

#[cfg(feature = "mimalloc")]
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

mod agent_tui;

use std::collections::HashMap;
use std::sync::Arc;

use clap::{Args, CommandFactory, FromArgMatches, Parser, Subcommand};
use console::Style;
use indicatif::{ProgressBar, ProgressStyle};
use serde::{Deserialize, Serialize};

// Import the library crate so we can access core modules.
// The lib target is named "app_lib" (see [lib] section in Cargo.toml).
use app_lib::core::cli::{
    cli_delete_thread, cli_get_data_folder, cli_get_thread,
    cli_list_messages, cli_list_threads, create_agent,
    discover_llamacpp_binary,
    discover_mlx_binary, download_hf_model, fetch_hf_gguf_files, init_llamacpp_state,
    init_mlx_state, list_models,
    load_llama_model_impl, load_mlx_model_impl, looks_like_hf_repo, resolve_model_by_id,
    resolve_model_engine, AgentEvent, HfFileInfo, LlamacppConfig, MlxConfig,
};
use std::path::PathBuf;

// ── Top-level CLI ──────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(
    name = "jan",
    about = "Serve local AI models and wire them to agents — no cloud required",
    long_about = "Jan runs local AI models (LlamaCPP / MLX) and exposes them via an\n\
OpenAI-compatible API, then wires AI coding agent like Claude Code\n\
directly to your own hardware — no cloud account, no usage fees, full privacy.\n\n\
Models downloaded in the Jan desktop app are automatically available here.",
    after_help = "Examples:\n  \
  jan launch claude                                      # pick a model, then run Claude Code against it\n  \
  jan launch claude --model janhq/Jan-code-4b-gguf       # use a specific model\n  \
  jan launch openclaw --model janhq/Jan-code-4b-gguf     # wire openclaw to a local model\n  \
  jan serve janhq/Jan-code-4b-gguf                       # expose a model at localhost:6767/v1\n  \
  jan serve janhq/Jan-code-4b-gguf --fit                 # auto-fit context to available VRAM\n  \
  jan serve janhq/Jan-code-4b-gguf --detach              # run in the background\n  \
  jan models list                                        # show all installed models",
    version
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Load a local model and expose it at localhost:6767/v1 (auto-detects LlamaCPP or MLX)
    #[command(display_order = 1)]
    Serve {
        #[command(flatten)]
        args: ServeArgs,
    },
    /// Start a local model, then launch an AI agent with it pre-wired (env vars set automatically)
    #[command(display_order = 2)]
    Launch {
        /// Agent or program to run after the model is ready (e.g. claude, openclaw)
        /// Omit to pick interactively from: claude, openclaw
        program: Option<String>,
        /// Arguments forwarded to the program
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        program_args: Vec<String>,
        /// Model ID to load (omit to pick interactively)
        #[arg(long)]
        model: Option<String>,
        /// Path to the inference binary (auto-discovered from Jan data folder when omitted)
        #[arg(long)]
        bin: Option<String>,
        /// Port the model server listens on
        #[arg(long, default_value_t = 6767)]
        port: u16,
        /// API key for the model server (exported as OPENAI_API_KEY and ANTHROPIC_AUTH_TOKEN)
        #[arg(long, default_value = "jan")]
        api_key: String,
        /// GPU layers to offload (-1 = all layers, 0 = CPU only)
        #[arg(long, default_value_t = -1)]
        n_gpu_layers: i32,
        /// Context window size in tokens (default: 4096; disables --fit when set explicitly)
        #[arg(long)]
        ctx_size: Option<i32>,
        /// Auto-fit context to available VRAM (default: on when launching claude, unless --ctx-size is set)
        #[arg(long)]
        fit: Option<bool>,
        /// Print full server logs (llama.cpp / mlx output) instead of the loading spinner
        #[arg(long, short = 'v', default_value_t = false)]
        verbose: bool,
        /// When downloading a model, show quantization selection list
        #[arg(long, default_value_t = false)]
        select: bool,
    },
    /// List and inspect conversation threads saved by the Jan app
    #[command(display_order = 10)]
    Threads {
        #[command(subcommand)]
        cmd: ThreadsCommands,
    },
    /// List and load models installed in the Jan data folder
    #[command(display_order = 11)]
    Models {
        #[command(subcommand)]
        cmd: ModelsCommands,
    },
    /// pi-mono-style minimal agent
    #[command(display_order = 12)]
    Agent {
        #[command(subcommand)]
        cmd: AgentCommands,
    },
}

// ── Agent subcommands ──────────────────────────────────────────────────────

#[derive(Subcommand)]
enum AgentCommands {
    /// pi-mono-style minimal agent with read, write, edit, bash, and web search.
    /// Spins up a local model automatically. Pass --message for one-shot mode.
    /// Use --api-url to point at an external OpenAI-compatible endpoint instead.
    Chat {
        #[command(flatten)]
        serve: ServeArgs,
        /// Run a single prompt non-interactively then exit (one-shot mode).
        /// Omit for an interactive chat session.
        #[arg(long, short = 'm', value_name = "PROMPT")]
        message: Option<String>,
        /// Host directories the agent's code sandbox may read (repeatable).
        /// Example: --mount /home/user/project --mount /tmp/data
        /// Omit for a fully isolated sandbox with no filesystem access.
        #[arg(long, value_name = "DIR")]
        mount: Vec<PathBuf>,
        /// Use this API base URL instead of starting a local model
        /// (e.g. https://api.openai.com/v1). The model name is the first
        /// positional arg; --api-key is used as the Authorization key.
        #[arg(long, value_name = "URL")]
        api_url: Option<String>,
        /// Agent backend to use. Currently only "react" is available.
        /// Future values: "openai-assistant", "claude", etc.
        #[arg(long, value_name = "IMPL", default_value = "react")]
        agent: String,
        /// Connect to a ProcTHOR / robot HTTP server for vision + navigation.
        /// The agent receives camera frames and gains WASD movement tools.
        /// Example: --robot-url http://localhost:8765
        #[arg(long, value_name = "URL")]
        robot_url: Option<String>,
    },
}


// ── Threads subcommands ────────────────────────────────────────────────────

#[derive(Subcommand)]
enum ThreadsCommands {
    /// Print all threads as JSON
    List,
    /// Print a single thread's metadata as JSON
    Get {
        /// Thread ID
        id: String,
    },
    /// Permanently delete a thread and all its messages
    Delete {
        /// Thread ID
        id: String,
    },
    /// Print all messages in a thread as JSON
    Messages {
        /// Thread ID
        thread_id: String,
    },
}

// ── Serve args (shared by `models load` and top-level `serve`) ────────────

#[derive(Args)]
struct ServeArgs {
    /// Model ID to load (omit to pick interactively from installed models)
    model_id: Option<String>,
    /// Path to the GGUF file (auto-resolved from model.yml when omitted)
    #[arg(long)]
    model_path: Option<String>,
    /// Path to the inference binary (auto-discovered from Jan data folder when omitted)
    #[arg(long)]
    bin: Option<String>,
    /// Port the model server listens on (0 = pick a random free port)
    #[arg(long, default_value_t = 6767)]
    port: u16,
    /// mmproj path for vision-language models (auto-resolved from model.yml when omitted)
    #[arg(long)]
    mmproj: Option<String>,
    /// Treat the model as an embedding model
    #[arg(long, default_value_t = false)]
    embedding: bool,
    /// Seconds to wait for the model server to become ready
    #[arg(long, default_value_t = 120)]
    timeout: u64,
    /// GPU layers to offload (-1 = all layers, 0 = CPU only)
    #[arg(long, default_value_t = -1)]
    n_gpu_layers: i32,
    /// Context window size in tokens (0 = model default)
    #[arg(long, default_value_t = 32768)]
    ctx_size: i32,
    /// Auto-fit context to available VRAM, maximising the context window
    #[arg(long, default_value_t = false)]
    fit: bool,
    /// CPU threads for inference (0 = auto-detect)
    #[arg(long, default_value_t = 0)]
    threads: i32,
    /// API key required by clients (sets LLAMA_API_KEY / MLX_API_KEY on the server)
    #[arg(long, default_value = "")]
    api_key: String,
    /// Run in the background (detach from terminal) and print the PID
    #[arg(long, short = 'd', default_value_t = false)]
    detach: bool,
    /// Log file for background mode (default: <data-folder>/logs/serve.log)
    #[arg(long)]
    log: Option<String>,
    /// Print full server logs (llama.cpp / mlx output) instead of the loading spinner
    #[arg(long, short = 'v', default_value_t = false)]
    verbose: bool,
    /// When downloading a model, show quantization selection list
    #[arg(long, default_value_t = false)]
    select: bool,
}

// ── Models subcommands ─────────────────────────────────────────────────────

#[derive(Subcommand)]
enum ModelsCommands {
    /// Print all installed models as JSON (from the Jan data folder)
    List {
        /// Filter by engine: llamacpp, mlx, or all
        #[arg(long, default_value = "all")]
        engine: String,
    },
    /// Load a model and serve it — alias for the top-level `serve` command
    Load {
        #[command(flatten)]
        args: ServeArgs,
    },
    /// Load an MLX model directly (macOS / Apple Silicon only)
    LoadMlx {
        /// Model ID as shown by `jan models list --engine mlx`
        #[arg(long)]
        model_id: String,
        /// Path to the MLX model directory (auto-resolved from model.yml when omitted)
        #[arg(long)]
        model_path: Option<String>,
        /// Path to the mlx-server binary (auto-discovered from Jan.app when omitted)
        #[arg(long)]
        bin: Option<String>,
        /// Port the model server listens on (0 = pick a random free port)
        #[arg(long, default_value_t = 6767)]
        port: u16,
        /// Context window size in tokens (0 = model default)
        #[arg(long, default_value_t = 0)]
        ctx_size: i32,
        /// Treat the model as an embedding model
        #[arg(long, default_value_t = false)]
        embedding: bool,
        /// Seconds to wait for the model server to become ready
        #[arg(long, default_value_t = 120)]
        timeout: u64,
        /// API key required by clients (sets MLX_API_KEY on the server)
        #[arg(long, default_value = "")]
        api_key: String,
    },
}

// ── Agent config file ──────────────────────────────────────────────────

/// Model entry inside a provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgentConfigModel {
    id: String,
    #[serde(default)]
    name: Option<String>,
}

/// A single model provider (e.g. "jan", "openai").
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentConfigProvider {
    #[serde(default)]
    base_url: Option<String>,
    #[serde(default)]
    models: Vec<AgentConfigModel>,
}

/// Default provider + model selection.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct AgentConfigDefaults {
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    model: Option<String>,
}

/// The `models` section: providers map + defaults.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct AgentConfigModels {
    #[serde(default)]
    providers: HashMap<String, AgentConfigProvider>,
    #[serde(default)]
    defaults: AgentConfigDefaults,
}

/// Agent-specific settings (impl, mounts, robot).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentConfigAgent {
    #[serde(default, rename = "impl")]
    agent_impl: Option<String>,
    #[serde(default)]
    mounts: Option<Vec<String>>,
    #[serde(default)]
    robot_url: Option<String>,
}

/// Model server / serve settings.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentConfigServe {
    #[serde(default)]
    port: Option<u16>,
    #[serde(default)]
    n_gpu_layers: Option<i32>,
    #[serde(default)]
    ctx_size: Option<i32>,
    #[serde(default)]
    threads: Option<i32>,
    #[serde(default)]
    timeout: Option<u64>,
    #[serde(default)]
    fit: Option<bool>,
    #[serde(default)]
    embedding: Option<bool>,
    #[serde(default)]
    verbose: Option<bool>,
    #[serde(default, rename = "select")]
    select_quant: Option<bool>,
    #[serde(default)]
    model_path: Option<String>,
    #[serde(default)]
    bin: Option<String>,
    #[serde(default)]
    mmproj: Option<String>,
}

/// Top-level agent-config.json.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct AgentConfig {
    #[serde(default)]
    models: AgentConfigModels,
    #[serde(default)]
    agent: AgentConfigAgent,
    #[serde(default)]
    serve: AgentConfigServe,
}

impl AgentConfig {
    /// Path to the config file: same directory as the running executable.
    fn config_path() -> Option<PathBuf> {
        std::env::current_exe().ok().and_then(|exe| {
            exe.parent().map(|dir| dir.join("agent-config.json"))
        })
    }

    /// Load from disk. Returns default if file doesn't exist or is invalid.
    fn load() -> Self {
        let Some(path) = Self::config_path() else { return Self::default() };
        match std::fs::read_to_string(&path) {
            Ok(contents) => serde_json::from_str(&contents).unwrap_or_else(|e| {
                eprintln!("  warning: invalid agent-config.json, using defaults ({e})");
                Self::default()
            }),
            Err(_) => Self::default(),
        }
    }

    /// Save to disk.
    fn save(&self) {
        let Some(path) = Self::config_path() else { return };
        if let Ok(json) = serde_json::to_string_pretty(self) {
            if let Err(e) = std::fs::write(&path, json) {
                eprintln!("  warning: could not save agent-config.json: {e}");
            }
        }
    }
}

/// Check whether a specific arg was explicitly provided on the CLI.
/// `id` is the clap long-name (e.g. "port", "ctx-size").
/// Navigates into the `agent chat` subcommand matches.
fn arg_is_present(matches: &clap::ArgMatches, id: &str) -> bool {
    // Navigate: top-level → "agent" subcommand → "chat" subcommand
    matches
        .subcommand_matches("agent")
        .and_then(|m| m.subcommand_matches("chat"))
        .map_or(false, |m| {
            m.value_source(id) == Some(clap::parser::ValueSource::CommandLine)
        })
}

/// Merge config file values into ServeArgs + agent Chat args, respecting
/// the priority: explicit CLI arg > config file > clap default.
/// Returns the set of fields that were overridden by the config (for write-back).
/// Also returns whether any CLI arg was explicitly set (triggers write-back).
fn merge_agent_config(
    matches: &clap::ArgMatches,
    config: &AgentConfig,
    serve: &mut ServeArgs,
    api_url: &mut Option<String>,
    agent_impl: &mut String,
    mount: &mut Vec<PathBuf>,
    robot_url: &mut Option<String>,
) -> bool {
    let mut any_cli_override = false;

    // Helper: apply config value if CLI arg was not explicitly set
    macro_rules! merge_option {
        ($field:expr, $config_val:expr, $arg_name:expr) => {
            if arg_is_present(matches, $arg_name) {
                any_cli_override = true;
            } else if let Some(v) = $config_val {
                $field = Some(v);
            }
        };
    }
    macro_rules! merge_val {
        ($field:expr, $config_val:expr, $arg_name:expr) => {
            if arg_is_present(matches, $arg_name) {
                any_cli_override = true;
            } else if let Some(v) = $config_val {
                $field = v;
            }
        };
    }

    // ── Resolve model_id from config defaults ──
    // If no model_id on CLI, use config defaults.model
    if serve.model_id.is_none() {
        if let Some(ref m) = config.models.defaults.model {
            serve.model_id = Some(m.clone());
        }
    } else {
        any_cli_override = true;
    }

    // ── Resolve api_url from config provider ──
    if arg_is_present(matches, "api-url") {
        any_cli_override = true;
    } else if api_url.is_none() {
        // Determine the default provider, then use its baseUrl
        let provider_name = config.models.defaults.provider.as_deref().unwrap_or("jan");
        if let Some(provider) = config.models.providers.get(provider_name) {
            if let Some(ref url) = provider.base_url {
                *api_url = Some(url.clone());
            }
        }
    }

    // ── Agent settings ──
    merge_val!(*agent_impl, config.agent.agent_impl.clone(), "agent");
    if arg_is_present(matches, "robot-url") {
        any_cli_override = true;
    } else if robot_url.is_none() {
        *robot_url = config.agent.robot_url.clone();
    }
    if arg_is_present(matches, "mount") {
        any_cli_override = true;
    } else if mount.is_empty() {
        if let Some(ref dirs) = config.agent.mounts {
            *mount = dirs.iter().map(PathBuf::from).collect();
        }
    }

    // ── Serve settings ──
    merge_val!(serve.port, config.serve.port, "port");
    merge_val!(serve.n_gpu_layers, config.serve.n_gpu_layers, "n-gpu-layers");
    merge_val!(serve.ctx_size, config.serve.ctx_size, "ctx-size");
    merge_val!(serve.threads, config.serve.threads, "threads");
    merge_val!(serve.timeout, config.serve.timeout, "timeout");
    merge_val!(serve.fit, config.serve.fit, "fit");
    merge_val!(serve.embedding, config.serve.embedding, "embedding");
    merge_val!(serve.verbose, config.serve.verbose, "verbose");
    merge_val!(serve.select, config.serve.select_quant, "select");
    merge_option!(serve.model_path, config.serve.model_path.clone(), "model-path");
    merge_option!(serve.bin, config.serve.bin.clone(), "bin");
    merge_option!(serve.mmproj, config.serve.mmproj.clone(), "mmproj");

    any_cli_override
}

/// Update the config struct from the current (merged) values and save.
fn write_back_agent_config(
    config: &mut AgentConfig,
    serve: &ServeArgs,
    api_url: &Option<String>,
    agent_impl: &str,
    mount: &[PathBuf],
    robot_url: &Option<String>,
) {
    // ── Model defaults ──
    if let Some(ref mid) = serve.model_id {
        config.models.defaults.model = Some(mid.clone());
    }

    // ── Provider / api_url ──
    if let Some(ref url) = api_url {
        let provider_name = config.models.defaults.provider
            .clone()
            .unwrap_or_else(|| "jan".to_string());
        let provider = config.models.providers
            .entry(provider_name.clone())
            .or_insert_with(|| AgentConfigProvider {
                base_url: None,
                models: vec![],
            });
        provider.base_url = Some(url.clone());
        config.models.defaults.provider = Some(provider_name);
    }

    // ── Agent settings ──
    config.agent.agent_impl = Some(agent_impl.to_string());
    if !mount.is_empty() {
        config.agent.mounts = Some(mount.iter().map(|p| p.to_string_lossy().into_owned()).collect());
    }
    config.agent.robot_url = robot_url.clone();

    // ── Serve settings ──
    config.serve.port = Some(serve.port);
    config.serve.n_gpu_layers = Some(serve.n_gpu_layers);
    config.serve.ctx_size = Some(serve.ctx_size);
    config.serve.threads = Some(serve.threads);
    config.serve.timeout = Some(serve.timeout);
    config.serve.fit = Some(serve.fit);
    config.serve.embedding = Some(serve.embedding);
    config.serve.verbose = Some(serve.verbose);
    config.serve.select_quant = Some(serve.select);
    config.serve.model_path = serve.model_path.clone();
    config.serve.bin = serve.bin.clone();
    config.serve.mmproj = serve.mmproj.clone();

    config.save();
}

// ── ASCII logo ─────────────────────────────────────────────────────────────

/// Build a left-aligned, bright-yellow ASCII logo for the help header.
fn make_logo() -> String {
    // "JAN" in ANSI Shadow block letters
    let lines = [
        r"     ██╗ █████╗ ███╗  ██╗",
        r"     ██║██╔══██╗████╗ ██║",
        r"     ██║███████║██╔██╗██║",
        r"██   ██║██╔══██║██║╚████║",
        r"╚█████╔╝██║  ██║██║ ╚███║",
        r" ╚════╝ ╚═╝  ╚═╝╚═╝  ╚══╝",
    ];

    // Fixed left-aligned indent (2 spaces)
    let indent = "  ";

    let yellow = Style::new().yellow().bold();

    let mut out: Vec<String> = Vec::new();

    // Add padding at top
    out.push(String::new());
    out.push(String::new());

    // Logo lines
    for l in &lines {
        out.push(format!("{}{}", indent, yellow.apply_to(l)));
    }

    out.join("\n")
}

// ── Entry point ────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    // Pre-scan raw args for --verbose / -v before full parse so we can set
    // the log level before any logging happens.
    let verbose = std::env::args().any(|a| a == "--verbose" || a == "-v");
    agent_tui::CapturingLogger::init(verbose);

    // Inject the logo at runtime so we can use ANSI styling.
    let logo = make_logo();
    let matches = Cli::command()
        .before_help(logo.clone())
        .before_long_help(logo)
        .get_matches();
    let cli = Cli::from_arg_matches(&matches).unwrap_or_else(|e| e.exit());

    match cli.command {
        Commands::Threads { cmd } => handle_threads(cmd).await,
        Commands::Models { cmd } => handle_models(cmd).await,
        Commands::Serve { args } => handle_serve(args).await,
        Commands::Launch { program, program_args, model, bin, port, api_key, n_gpu_layers, ctx_size, fit, verbose, select } => {
            let program = program.unwrap_or_else(select_program_interactively);
            let ctx_size_val = ctx_size.unwrap_or(32768);
            handle_launch(program, program_args, model, bin, port, api_key, n_gpu_layers, ctx_size_val, fit, ctx_size.is_none(), verbose, select).await
        }
        Commands::Agent { cmd } => handle_agent(cmd, &matches).await,
    }

    // Stop any workspace VMs that are still running.
    tauri_plugin_sandbox::microvm::shutdown_workspaces().await;
}


// ── Threads handlers ───────────────────────────────────────────────────────

async fn handle_threads(cmd: ThreadsCommands) {
    match cmd {
        ThreadsCommands::List => match cli_list_threads().await {
            Ok(threads) => {
                println!("{}", serde_json::to_string_pretty(&threads).unwrap());
            }
            Err(e) => {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
        },

        ThreadsCommands::Get { id } => match cli_get_thread(&id) {
            Ok(thread) => println!("{}", serde_json::to_string_pretty(&thread).unwrap()),
            Err(e) => {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
        },

        ThreadsCommands::Delete { id } => match cli_delete_thread(&id) {
            Ok(()) => println!("{}", serde_json::json!({ "deleted": true, "id": id })),
            Err(e) => {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
        },

        ThreadsCommands::Messages { thread_id } => match cli_list_messages(&thread_id) {
            Ok(messages) => println!("{}", serde_json::to_string_pretty(&messages).unwrap()),
            Err(e) => {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
        },
    }
}

// ── Models handlers ────────────────────────────────────────────────────────

async fn handle_models(cmd: ModelsCommands) {
    match cmd {
        ModelsCommands::List { engine } => {
            let engines: &[&str] = match engine.as_str() {
                "all" => &["llamacpp", "mlx"],
                other => &[other],
            };
            let mut output: Vec<serde_json::Value> = Vec::new();
            for eng in engines {
                for (id, yml) in list_models(eng) {
                    output.push(serde_json::json!({
                        "id": id,
                        "engine": eng,
                        "name": yml.name,
                        "model_path": yml.model_path,
                        "size_bytes": yml.size_bytes,
                        "embedding": yml.embedding,
                        "capabilities": yml.capabilities,
                        "mmproj_path": yml.mmproj_path,
                    }));
                }
            }
            println!("{}", serde_json::to_string_pretty(&output).unwrap());
        }

        ModelsCommands::Load { args } => handle_serve(args).await,

        ModelsCommands::LoadMlx {
            model_id,
            model_path,
            bin,
            port,
            ctx_size,
            embedding,
            timeout,
            api_key,
        } => {
            use std::path::Path;

            // Resolve model path from model.yml when not explicitly given
            let resolved_model_path = match model_path {
                Some(p) => p,
                None => match resolve_model_by_id(&model_id, "mlx") {
                    Ok((mp, _)) => mp.to_string_lossy().into_owned(),
                    Err(e) => {
                        eprintln!("Error: {e}");
                        std::process::exit(1);
                    }
                },
            };

            // Resolve binary path: use --bin if provided, otherwise auto-discover
            let bin_path = match bin {
                Some(b) => b,
                None => match discover_mlx_binary() {
                    Some(p) => p.to_string_lossy().into_owned(),
                    None => {
                        eprintln!(
                            "Error: mlx-server binary not found. \
                            Install Jan from https://jan.ai or pass --bin <path>."
                        );
                        std::process::exit(1);
                    }
                },
            };

            let mlx_state = Arc::new(init_mlx_state());
            let mut envs: HashMap<String, String> = HashMap::new();
            if !api_key.is_empty() {
                envs.insert("MLX_API_KEY".to_string(), api_key);
            }

            match load_mlx_model_impl(
                mlx_state.mlx_server_process.clone(),
                Path::new(&bin_path),
                model_id,
                resolved_model_path,
                port,
                MlxConfig { ctx_size },
                envs,
                embedding,
                timeout,
            )
            .await
            {
                Ok(info) => println!("{}", serde_json::to_string_pretty(&info).unwrap()),
                Err(e) => {
                    eprintln!(
                        "Error loading MLX model:\n{}",
                        serde_json::to_string_pretty(&e)
                            .unwrap_or_else(|_| format!("{e:?}"))
                    );
                    std::process::exit(1);
                }
            }
        }
    }
}

// ── Spinner / progress helpers ─────────────────────────────────────────────

fn make_spinner(msg: impl Into<std::borrow::Cow<'static, str>>) -> ProgressBar {
    let pb = ProgressBar::new_spinner();
    pb.set_style(
        ProgressStyle::default_spinner()
            .tick_strings(&["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"])
            .template("{spinner:.cyan} {msg}")
            .unwrap(),
    );
    pb.set_message(msg);
    pb.enable_steady_tick(std::time::Duration::from_millis(80));
    pb
}

/// Start a spinner, or print a plain status line if verbose mode is on.
/// Returns `None` in verbose mode so callers know to skip spinner updates.
fn start_progress(verbose: bool, msg: impl Into<String>) -> Option<ProgressBar> {
    if verbose {
        eprintln!("{}", msg.into());
        None
    } else {
        Some(make_spinner(msg.into()))
    }
}

/// Finish the spinner with a final message, or print the message plainly in verbose mode.
fn finish_progress(pb: Option<ProgressBar>, msg: impl AsRef<str>) {
    match pb {
        Some(pb) => {
            pb.finish_and_clear();
            eprintln!("{}", msg.as_ref());
        }
        None => eprintln!("{}", msg.as_ref()),
    }
}

// ── HuggingFace auto-download ──────────────────────────────────────────────

/// Read `HF_TOKEN` or `HUGGING_FACE_HUB_TOKEN` from the environment.
fn hf_token() -> Option<String> {
    std::env::var("HF_TOKEN")
        .or_else(|_| std::env::var("HUGGING_FACE_HUB_TOKEN"))
        .ok()
        .filter(|s| !s.is_empty())
}

/// Format a byte count as a human-readable string (GB / MB / KB).
fn fmt_bytes(b: u64) -> String {
    if b >= 1_000_000_000 {
        format!("{:.1} GB", b as f64 / 1_000_000_000.0)
    } else if b >= 1_000_000 {
        format!("{:.0} MB", b as f64 / 1_000_000.0)
    } else {
        format!("{:.0} KB", b as f64 / 1_000.0)
    }
}

/// Show an interactive picker for a list of HF GGUF files and return the chosen one.
///
/// If there is only one file it is returned immediately without prompting.
fn pick_hf_file(files: &[HfFileInfo]) -> &HfFileInfo {
    if files.len() == 1 {
        return &files[0];
    }

    let labels: Vec<String> = files
        .iter()
        .map(|f| format!("{:<55} {}", f.filename, fmt_bytes(f.size)))
        .collect();

    let idx = dialoguer::Select::new()
        .with_prompt("Select a quantization to download")
        .items(&labels)
        .default(0)
        .interact()
        .unwrap_or_else(|_| std::process::exit(1));

    &files[idx]
}

/// Fetch GGUF files from HuggingFace, let the user pick one, download it,
/// and return the local model ID ready to load.
///
/// Exits the process on any unrecoverable error.
async fn auto_download_hf_model(repo_id: &str, select_quantization: bool) -> String {
    let token = hf_token();
    let tok_ref = token.as_deref();

    // Fetch available GGUF files from the HF API
    eprintln!();
    let fetch_pb = make_spinner(format!("Fetching file list for '{repo_id}' from HuggingFace…"));
    let files = fetch_hf_gguf_files(repo_id, tok_ref)
        .await
        .unwrap_or_else(|e| {
            fetch_pb.finish_with_message(format!("✗ {e}"));
            std::process::exit(1);
        });
    fetch_pb.finish_and_clear();

    // Select quantization: show picker if select_quantization is true, otherwise auto-pick Q4_K_XL
    let chosen = if select_quantization {
        pick_hf_file(&files)
    } else {
        files
            .iter()
            .find(|f| f.filename.contains("Q4_K_XL"))
            .unwrap_or_else(|| {
                files.iter().max_by_key(|f| f.size).unwrap()
            })
    };
    eprintln!("  Downloading  {}", chosen.filename);
    eprintln!("  Size         {}", fmt_bytes(chosen.size));
    eprintln!();

    // Progress bar — byte-count style
    let dl_pb = ProgressBar::new(chosen.size);
    dl_pb.set_style(
        ProgressStyle::default_bar()
            .template(
                "  {bar:45.yellow/dim}  {bytes:>9}/{total_bytes}  {bytes_per_sec}  eta {eta}",
            )
            .unwrap()
            .progress_chars("█▉▊▋▌▍▎▏  "),
    );

    let dl_pb_clone = dl_pb.clone();
    let model_id = download_hf_model(repo_id, chosen, tok_ref, move |done, _total| {
        dl_pb_clone.set_position(done);
    })
    .await
    .unwrap_or_else(|e| {
        dl_pb.finish_with_message(format!("✗ Download failed: {e}"));
        std::process::exit(1);
    });

    dl_pb.finish_and_clear();
    eprintln!("  ✓ Saved to Jan data folder\n");

    model_id
}

// ── Interactive pickers ────────────────────────────────────────────────────

/// Present an interactive menu for the supported AI agents.
fn select_program_interactively() -> String {
    const CHOICES: &[(&str, &str)] = &[
        ("claude",   "Claude Code  — Anthropic's AI coding agent"),
        ("openclaw", "OpenClaw     — Open-source autonomous AI agent"),
    ];

    println!();
    let header = Style::new().cyan().bold().apply_to("━━━ Select Agent ━━━");
    println!("{}", header);
    println!();

    let installed: Vec<bool> = CHOICES
        .iter()
        .map(|(key, _)| {
            is_command_installed(key) || (*key == "openclaw" && is_command_installed("opencode"))
        })
        .collect();

    if !installed.iter().any(|&i| i) {
        eprintln!("  No supported agents are installed.");
        eprintln!("  Install Claude Code: npm install -g @anthropic-ai/claude-code");
        eprintln!("  Install OpenClaw:    curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard");
        std::process::exit(1);
    }

    let labels: Vec<String> = CHOICES
        .iter()
        .zip(installed.iter())
        .map(|((_, desc), &ok)| {
            if ok {
                desc.to_string()
            } else {
                format!("{} {}", Style::new().dim().apply_to(desc), Style::new().dim().apply_to("[not installed]"))
            }
        })
        .collect();

    // Keep re-prompting until the user picks an installed agent
    loop {
        let idx = dialoguer::Select::new()
            .with_prompt("Choose an agent to launch")
            .items(&labels)
            .default(0)
            .interact()
            .unwrap_or_else(|_| std::process::exit(1));

        if installed[idx] {
            return CHOICES[idx].0.to_string();
        }

        eprintln!("  {} is not installed. Please choose an installed agent.", CHOICES[idx].1);
    }
}

async fn select_model_interactively(select_quantization: bool) -> String {
    let mut all: Vec<(String, String)> = Vec::new(); // (id, engine)
    for engine in &["llamacpp", "mlx"] {
        for (id, _) in list_models(engine) {
            all.push((id, engine.to_string()));
        }
    }

    if all.is_empty() {
        let default_model = "janhq/Jan-v3-4B-base-instruct-gguf";
        println!();
        let msg = Style::new().yellow().apply_to(
            "No models found. Downloading default model..."
        );
        println!("{}", msg);
        println!();
        println!("  {} {}", Style::new().dim().apply_to("Model:"), default_model);
        println!();

        // Auto-download the default model
        let model_id = auto_download_hf_model(default_model, select_quantization).await;
        return model_id;
    }

    println!();
    let header = Style::new().cyan().bold().apply_to("━━━ Select Model ━━━");
    println!("{}", header);
    println!();

    // Group by engine for better display
    let mut llamacpp_models: Vec<&String> = Vec::new();
    let mut mlx_models: Vec<&String> = Vec::new();

    for (id, engine) in &all {
        match engine.as_str() {
            "llamacpp" => llamacpp_models.push(id),
            "mlx" => mlx_models.push(id),
            _ => {}
        }
    }

    // Build selection list with engine indicator next to model name
    let selection_items: Vec<(usize, String)> = all
        .iter()
        .enumerate()
        .map(|(i, (id, engine))| {
            let indicator = match engine.as_str() {
                "llamacpp" => Style::new().green().apply_to("[LlamaCPP]"),
                "mlx" => Style::new().magenta().apply_to("[MLX]"),
                _ => Style::new().dim().apply_to("[---]"),
            };
            (i, format!("{} {}", id, indicator))
        })
        .collect();

    // If only one model, skip interactive selection
    if selection_items.len() == 1 {
        println!("  Using model: {}", selection_items[0].1);
        println!();
        return all[selection_items[0].0].0.clone();
    }

    let labels: Vec<String> = selection_items.iter().map(|(_, label)| label.clone()).collect();

    let selection = dialoguer::Select::new()
        .with_prompt("Choose a model")
        .items(&labels)
        .default(0)
        .interact()
        .unwrap_or_else(|_| std::process::exit(1));

    all[selection_items[selection].0].0.clone()
}

// ── Detached spawn ─────────────────────────────────────────────────────────

fn spawn_detached(model_id: &str, args: &ServeArgs) {
    let exe = std::env::current_exe().expect("cannot resolve current exe");

    // Rebuild argv from ServeArgs fields so we have full control
    // (avoids needing to filter --detach/-d from the raw OS args).
    // Use --flag=value format throughout to avoid negative numbers being
    // misinterpreted as short flags (e.g. --n-gpu-layers -1 → -1 looks like a flag).
    let mut argv: Vec<String> = vec!["serve".into(), model_id.to_string()];
    if let Some(p) = &args.model_path { argv.push(format!("--model-path={p}")); }
    if let Some(b) = &args.bin        { argv.push(format!("--bin={b}")); }
    argv.push(format!("--port={}", args.port));
    if let Some(m) = &args.mmproj     { argv.push(format!("--mmproj={m}")); }
    if args.embedding                  { argv.push("--embedding".into()); }
    argv.push(format!("--timeout={}",      args.timeout));
    argv.push(format!("--n-gpu-layers={}", args.n_gpu_layers));
    argv.push(format!("--ctx-size={}",     args.ctx_size));
    argv.push(format!("--threads={}",      args.threads));
    if !args.api_key.is_empty()        { argv.push(format!("--api-key={}", args.api_key)); }
    if args.fit                        { argv.push("--fit".into()); }
    if args.verbose                    { argv.push("--verbose".into()); }

    // Resolve log file path
    let log_path: PathBuf = args.log.as_deref()
        .map(PathBuf::from)
        .unwrap_or_else(|| cli_get_data_folder().join("logs").join("serve.log"));

    if let Some(parent) = log_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let log_file = std::fs::OpenOptions::new()
        .create(true).append(true).open(&log_path)
        .unwrap_or_else(|e| { eprintln!("Cannot open log file {}: {e}", log_path.display()); std::process::exit(1); });
    let log_out = log_file.try_clone().expect("clone log file");

    let mut cmd = std::process::Command::new(&exe);
    cmd.args(&argv)
        .stdin(std::process::Stdio::null())
        .stdout(log_out)
        .stderr(log_file);

    // Detach from the current terminal session on Unix
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            cmd.pre_exec(|| {
                nix::unistd::setsid()
                    .map(|_| ())
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
            });
        }
    }

    let child = cmd.spawn().unwrap_or_else(|e| {
        eprintln!("Failed to spawn detached process: {e}");
        std::process::exit(1);
    });

    println!("{}", serde_json::to_string_pretty(&serde_json::json!({
        "pid":      child.id(),
        "model_id": model_id,
        "log":      log_path.display().to_string(),
    })).unwrap());
}

// ── Serve handler (shared by `models load` and top-level `serve`) ──────────

async fn handle_serve(args: ServeArgs) {
    // Resolve model_id:
    // 1. Use the explicit model_id if it is non-empty.
    // 2. When --model-path is given, derive the id from the filename stem (e.g.
    //    "/path/to/my-model.gguf" → "my-model") so the user never has to pass
    //    a dummy empty-string id.
    // 3. Fall back to the interactive picker only when neither is available.
    let model_id = match args.model_id.as_deref() {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => {
            if let Some(ref path) = args.model_path {
                PathBuf::from(path)
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "model".to_string())
            } else {
                select_model_interactively(args.select).await
            }
        }
    };

    if args.detach {
        spawn_detached(&model_id, &args);
        return;
    }

    let ServeArgs {
        model_id: _,
        model_path,
        bin,
        port,
        mmproj,
        embedding,
        timeout,
        n_gpu_layers,
        ctx_size: ctx_size_arg,
        threads,
        api_key,
        fit,
        detach: _,
        log: _,
        verbose,
        select,
    } = args;

    // When --fit is on, let llama.cpp decide the context size automatically
    let ctx_size = if fit { 0 } else { ctx_size_arg };

    // Auto-detect engine from data folder.
    // If the model isn't found locally and the ID looks like a HuggingFace repo,
    // offer to download it automatically before proceeding.
    let (engine, resolved_model_path, resolved_mmproj) =
        match resolve_model_engine(&model_id) {
            Ok((eng, mp, mmp)) => (
                eng,
                model_path.unwrap_or_else(|| mp.to_string_lossy().into_owned()),
                mmproj.or_else(|| mmp.map(|p| p.to_string_lossy().into_owned())),
            ),
            Err(_) if model_path.is_some() => {
                // Explicit --model-path provided: skip engine detection entirely.
                ("llamacpp".to_string(), model_path.unwrap(), mmproj)
            }
            Err(_) if looks_like_hf_repo(&model_id) => {
                // Looks like a HuggingFace repo ID — download then resolve.
                auto_download_hf_model(&model_id, select).await;
                match resolve_model_engine(&model_id) {
                    Ok((eng, mp, mmp)) => (
                        eng,
                        mp.to_string_lossy().into_owned(),
                        mmp.map(|p| p.to_string_lossy().into_owned()),
                    ),
                    Err(e) => {
                        eprintln!("Error after download: {e}");
                        std::process::exit(1);
                    }
                }
            }
            Err(e) => {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
        };

    let pb = start_progress(verbose, format!("Loading {} ({engine})…", model_id));

    match load_model_inner(
        &engine, &model_id,
        resolved_model_path, resolved_mmproj, bin,
        port, &api_key, n_gpu_layers, ctx_size, fit, threads, timeout, embedding,
    )
    .await
    {
        Ok((pid, actual_port)) => {
            let url = format!("http://127.0.0.1:{actual_port}");
            finish_progress(pb, format!("✓ {model_id} ready · {url}"));
            eprintln!();
            eprintln!("  Endpoint  {url}/v1");
            eprintln!();
            eprintln!("  Press Ctrl+C to stop.");
            wait_for_shutdown(pid).await;
        }
        Err(e) => {
            finish_progress(pb, format!("✗ Failed to load {model_id}"));
            eprintln!("\n{e}");
            std::process::exit(1);
        }
    }
}

/// Block until Ctrl+C, then terminate the child process.
async fn wait_for_shutdown(pid: i32) {
    tokio::signal::ctrl_c().await.ok();
    eprintln!("\nShutting down (pid {pid})...");
    kill_process(pid);
}

/// Send a termination signal to a child process by PID.
fn kill_process(pid: i32) {
    #[cfg(unix)]
    {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;
        let _ = kill(Pid::from_raw(pid), Signal::SIGTERM);
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .status();
    }
}

// ── Agent installer ─────────────────────────────────────────────────────────

/// Check if a command is available in PATH
fn is_command_installed(cmd: &str) -> bool {
    let which = if cfg!(windows) { "where" } else { "which" };
    std::process::Command::new(which)
        .arg(cmd)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

// ── Launch handler ─────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
async fn handle_launch(
    program: String,
    program_args: Vec<String>,
    model: Option<String>,
    bin: Option<String>,
    port: u16,
    api_key: String,
    n_gpu_layers: i32,
    ctx_size: i32,
    fit: Option<bool>,
    ctx_size_is_default: bool,
    verbose: bool,
    select: bool,
) {
    let model_id = model.unwrap_or_else(|| -> String {
        futures::executor::block_on(select_model_interactively(select))
    });

    // Detect known agents early so we can set fit default before starting the server.
    let prog_name = std::path::Path::new(&program)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&program);
    let is_claude   = prog_name.contains("claude");
    let is_openclaw = prog_name.contains("openclaw");

    // --fit defaults to true when launching claude, but only if --ctx-size was
    // not explicitly provided (an explicit ctx-size means the user wants that
    // exact context, so fit would override it — don't do that).
    let effective_fit = fit.unwrap_or(is_claude && ctx_size_is_default);

    // Start the model server inline (same process, no detach).
    let (pid, actual_port) = start_model_server(&model_id, bin, port, api_key.clone(), n_gpu_layers, ctx_size, effective_fit, verbose).await;

    // Model is ready — silence server request/response logs so they don't
    // flood the launched program's terminal (e.g. Claude Code's shell).
    if verbose {
        log::set_max_level(log::LevelFilter::Warn);
    }

    let base_url = format!("http://127.0.0.1:{actual_port}");
    let v1_url   = format!("{base_url}/v1");

    // openclaw is configured via ~/.openclaw/openclaw.json, not env vars.
    // Write the jan provider entry and set the default model, then launch `openclaw tui`.
    let mut program_args = program_args;
    if is_openclaw {
        configure_openclaw(&v1_url, &api_key, &model_id);
        // openclaw's TUI is a sub-command; prepend it unless the caller already did
        if program_args.first().map(|s| s.as_str()) != Some("tui") {
            program_args.insert(0, "tui".to_string());
        }
        eprintln!();
        eprintln!("  ~/.openclaw/openclaw.json → jan provider configured");
        eprintln!("  agents.defaults.model.primary = jan/{model_id}");
    } else {
        let anthropic_key_var = if is_claude { "ANTHROPIC_AUTH_TOKEN" } else { "ANTHROPIC_API_KEY" };
        eprintln!();
        eprintln!("  OPENAI_BASE_URL={v1_url}");
        eprintln!("  OPENAI_API_KEY={api_key}");
        eprintln!("  OPENAI_MODEL={model_id}");
        eprintln!("  ANTHROPIC_BASE_URL={base_url}");
        eprintln!("  {anthropic_key_var}={api_key}");
        eprintln!("  ANTHROPIC_DEFAULT_OPUS_MODEL={model_id}");
        eprintln!("  ANTHROPIC_DEFAULT_SONNET_MODEL={model_id}");
        eprintln!("  ANTHROPIC_DEFAULT_HAIKU_MODEL={model_id}");
    }
    eprintln!();
    let launch_cmd = if is_openclaw {
        format!("openclaw {}", program_args.join(" "))
    } else {
        format!("{} {}", program, program_args.join(" "))
    };
    eprintln!("  → Launching: {}", launch_cmd);
    eprintln!();

    // For openclaw, use npx if not installed locally
    let (cmd_program, cmd_args) = if is_openclaw {
        if is_command_installed("openclaw") {
            (program.clone(), program_args.clone())
        } else {
            let mut args = vec!["openclaw".to_string()];
            args.extend(program_args.clone());
            ("npx".to_string(), args)
        }
    } else {
        (program.clone(), program_args.clone())
    };

    let mut cmd = std::process::Command::new(&cmd_program);
    cmd.args(&cmd_args);
    if is_openclaw {
        // Clear any provider API keys that could override openclaw's config
        for var in &[
            "OPENAI_API_KEY", "OPENAI_BASE_URL",
            "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_OAUTH_TOKEN",
            "GEMINI_API_KEY", "MISTRAL_API_KEY", "GROQ_API_KEY",
            "XAI_API_KEY", "OPENROUTER_API_KEY",
        ] {
            cmd.env_remove(var);
        }
    } else {
        let anthropic_key_var = if is_claude { "ANTHROPIC_AUTH_TOKEN" } else { "ANTHROPIC_API_KEY" };
        cmd.env("OPENAI_BASE_URL", &v1_url)
            .env("OPENAI_API_KEY",  &api_key)
            .env("OPENAI_MODEL",    &model_id)
            .env("ANTHROPIC_BASE_URL", &base_url)
            .env(anthropic_key_var,    &api_key)
            .env("ANTHROPIC_DEFAULT_OPUS_MODEL",   &model_id)
            .env("ANTHROPIC_DEFAULT_SONNET_MODEL", &model_id)
            .env("ANTHROPIC_DEFAULT_HAIKU_MODEL",  &model_id);
    }
    let status = cmd.status();

    // Kill the model server when the program exits.
    kill_process(pid);

    match status {
        Ok(s) => std::process::exit(s.code().unwrap_or(0)),
        Err(e) => {
            eprintln!("Error launching '{program}': {e}");
            std::process::exit(1);
        }
    }
}

// ── openclaw config writer ─────────────────────────────────────────────────

/// Write (or merge into) `~/.openclaw/openclaw.json` so that openclaw uses
/// the local Jan server as its provider and selects `model_id` by default.
///
/// The "jan" provider entry is always overwritten with the current server
/// address and key. All other config values are preserved.
/// Also clears the session model override so the new default takes effect.
fn configure_openclaw(v1_url: &str, api_key: &str, model_id: &str) {
    let home = dirs::home_dir().unwrap_or_default();
    let config_path = home.join(".openclaw").join("openclaw.json");

    // Read existing config so we don't clobber other settings.
    let mut config: serde_json::Value = config_path
        .exists()
        .then(|| std::fs::read_to_string(&config_path).ok())
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::json!({}));

    // Inject (or overwrite) the jan provider.
    config["models"]["providers"]["jan"] = serde_json::json!({
        "baseUrl": v1_url,
        "apiKey":  api_key,
        "api":     "openai-completions",
        "models": [{
            "id":            model_id,
            "name":          model_id,
            "input":         ["text"],
            "reasoning":     false,
            "contextWindow": 131072,
            "maxTokens":     16384,
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }]
    });

    // Set jan/<model_id> as the primary default model.
    config["agents"]["defaults"]["model"]["primary"] =
        serde_json::json!(format!("jan/{model_id}"));

    if let Some(parent) = config_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(&config) {
        let _ = std::fs::write(&config_path, json);
    }

    // Clear any per-session model override so the new default is picked up.
    let sessions_path = home
        .join(".openclaw")
        .join("agents")
        .join("main")
        .join("sessions")
        .join("sessions.json");
    if sessions_path.exists() {
        let _ = std::fs::write(&sessions_path, "{}");
    }
}

/// Start the model server and return `(pid, actual_port)`.
/// Resolves the engine automatically (LlamaCPP or MLX).
async fn start_model_server(
    model_id: &str,
    bin: Option<String>,
    port: u16,
    api_key: String,
    n_gpu_layers: i32,
    ctx_size: i32,
    fit: bool,
    verbose: bool,
) -> (i32, u16) {
    let (engine, model_path, mmproj) = match resolve_model_engine(model_id) {
        Ok(r) => r,
        Err(_) if looks_like_hf_repo(model_id) => {
            auto_download_hf_model(model_id, false).await;
            match resolve_model_engine(model_id) {
                Ok(r) => r,
                Err(e) => { eprintln!("Error after download: {e}"); std::process::exit(1); }
            }
        }
        Err(e) => { eprintln!("Error: {e}"); std::process::exit(1); }
    };
    let model_path = model_path.to_string_lossy().into_owned();

    let pb = start_progress(verbose, format!("Loading {} ({engine})…", model_id));

    let effective_ctx_size = if fit { 0 } else { ctx_size };
    match load_model_inner(
        &engine, model_id,
        model_path, mmproj.map(|p| p.to_string_lossy().into_owned()), bin,
        port, &api_key, n_gpu_layers, effective_ctx_size, fit, 0, 120, false,
    )
    .await
    {
        Ok((pid, actual_port)) => {
            let url = format!("http://127.0.0.1:{actual_port}");
            finish_progress(pb, format!("✓ {model_id} ready · {url}"));
            (pid, actual_port)
        }
        Err(e) => {
            finish_progress(pb, format!("✗ Failed to load {model_id}"));
            eprintln!("{e}");
            std::process::exit(1);
        }
    }
}

// ── LlamaCPP config builder ────────────────────────────────────────────────

/// Build a `LlamacppConfig` with the values the CLI controls; everything else
/// stays at a sensible default.
fn build_llamacpp_config(n_gpu_layers: i32, ctx_size: i32, timeout: i32, fit: bool, threads: i32) -> LlamacppConfig {
    LlamacppConfig {
        version_backend: "cli/llama-server".to_string(),
        auto_update_engine: false,
        auto_unload: false,
        timeout,
        llamacpp_env: String::new(),
        fit,
        fit_target: String::new(),
        fit_ctx: String::new(),
        chat_template: String::new(),
        n_gpu_layers,
        offload_mmproj: true,
        cpu_moe: false,
        n_cpu_moe: 0,
        override_tensor_buffer_t: String::new(),
        ctx_size,
        threads,
        threads_batch: 0,
        n_predict: -1,
        batch_size: 512,
        ubatch_size: 512,
        device: String::new(),
        split_mode: String::new(),
        main_gpu: 0,
        flash_attn: "auto".to_string(),
        cont_batching: true,
        no_mmap: false,
        mlock: false,
        no_kv_offload: false,
        cache_type_k: "q8_0".to_string(),
        cache_type_v: "q8_0".to_string(),
        defrag_thold: -1.0,
        rope_scaling: String::new(),
        rope_scale: 0.0,
        rope_freq_base: 0.0,
        rope_freq_scale: 0.0,
        ctx_shift: false,
        parallel: 1
    }
}


// ── Core model loader ──────────────────────────────────────────────────

/// Resolve the binary, init backend state, and load the model.
/// Returns `(pid, actual_port)` or a human-readable error string.
/// Engine-specific branching lives here and nowhere else.
async fn load_model_inner(
    engine: &str,
    model_id: &str,
    model_path: String,
    mmproj: Option<String>,
    bin: Option<String>,
    port: u16,
    api_key: &str,
    n_gpu_layers: i32,
    ctx_size: i32,
    fit: bool,
    threads: i32,
    timeout: u64,
    embedding: bool,
) -> Result<(i32, u16), String> {
    if engine == "mlx" {
        use std::path::Path;
        let bin_path = bin
            .or_else(|| discover_mlx_binary().map(|p| p.to_string_lossy().into_owned()))
            .ok_or_else(|| {
                "mlx-server binary not found. \
                 Install Jan from https://jan.ai or pass --bin <path>.".to_string()
            })?;
        let mlx_state = Arc::new(init_mlx_state());
        let mut envs: HashMap<String, String> = HashMap::new();
        if !api_key.is_empty() { envs.insert("MLX_API_KEY".into(), api_key.into()); }
        load_mlx_model_impl(
            mlx_state.mlx_server_process.clone(),
            Path::new(&bin_path),
            model_id.to_string(),
            model_path,
            port,
            MlxConfig { ctx_size },
            envs,
            embedding,
            timeout,
        )
        .await
        .map(|info| (info.pid, info.port as u16))
        .map_err(|e| serde_json::to_string_pretty(&e).unwrap_or_else(|_| format!("{e:?}")))
    } else {
        let bin_path = bin
            .or_else(|| discover_llamacpp_binary().map(|p| p.to_string_lossy().into_owned()))
            .ok_or_else(|| {
                "llama-server binary not found. \
                 Install a backend from Jan's settings or pass --bin <path>.".to_string()
            })?;
        let llama_state = Arc::new(init_llamacpp_state());
        let mut envs: HashMap<String, String> = HashMap::new();
        if !api_key.is_empty() { envs.insert("LLAMA_API_KEY".into(), api_key.into()); }
        let config = build_llamacpp_config(n_gpu_layers, ctx_size, timeout as i32, fit, threads);
        load_llama_model_impl(
            llama_state.llama_server_process.clone(),
            &bin_path,
            model_id.to_string(),
            model_path,
            port,
            config,
            envs,
            mmproj,
            embedding,
            timeout,
        )
        .await
        .map(|info| (info.pid, info.port as u16))
        .map_err(|e| serde_json::to_string_pretty(&e).unwrap_or_else(|_| format!("{e:?}")))
    }
}

// ── Agent observability ────────────────────────────────────────────────────

/// Build a live event handler that drives a spinner.
///
/// - The spinner message is updated on every `Thinking` / `ToolCall` / `Retrying`
///   event so the user always sees what the agent is doing right now.
/// - Completed events (`ToolResult`, `SkillLog`, …) are printed *above* the
///   spinner via `pb.println()` — indicatif suspends the bar briefly, prints
///   the line, then resumes without flickering.
///
/// Call `pb.finish_and_clear()` after `agent.run` returns.
fn make_agent_handler(pb: ProgressBar) -> impl FnMut(AgentEvent) {
    let dim    = Style::new().dim();
    let green  = Style::new().green().bold();
    let yellow = Style::new().yellow();
    let red    = Style::new().red().bold();
    let blue   = Style::new().blue();

    move |event: AgentEvent| {
        match &event {
            AgentEvent::Thinking { step } => {
                pb.set_message(format!("step {step} · thinking…"));
            }
            AgentEvent::ToolCall { step, tool_id, args } => {
                let raw     = serde_json::to_string(args).unwrap_or_default();
                let preview = if raw.len() > 80 { format!("{}…", &raw[..80]) } else { raw };
                pb.set_message(format!("step {step} · 🔧 {tool_id}  {}", dim.apply_to(preview)));
            }
            AgentEvent::ToolResult { tool_id, ok, elapsed_ms, summary, .. } => {
                let icon = if *ok {
                    green.apply_to("✓").to_string()
                } else {
                    red.apply_to("✗").to_string()
                };
                let time_str = if *elapsed_ms >= 1000 {
                    format!("{:.1}s", *elapsed_ms as f64 / 1000.0)
                } else {
                    format!("{elapsed_ms}ms")
                };
                let label = if *ok {
                    dim.apply_to(tool_id.as_str()).to_string()
                } else {
                    red.apply_to(tool_id.as_str()).to_string()
                };
                pb.println(format!(
                    "  {icon}  {label}  {}  {}",
                    dim.apply_to(summary.as_str()),
                    dim.apply_to(format!("({time_str})")),
                ));
            }
            AgentEvent::ToolLog { tool_id, message, .. } => {
                let trunc = if message.len() > 120 {
                    format!("{}…", &message[..120])
                } else {
                    message.clone()
                };
                pb.println(format!(
                    "     {} {}",
                    blue.apply_to(format!("[{tool_id}]")),
                    dim.apply_to(trunc),
                ));
            }
            AgentEvent::TokenBudget { used, total } => {
                let pct = (*used as f32 / *total as f32 * 100.0) as u32;
                pb.println(format!(
                    "{}",
                    yellow.apply_to(format!("  ⚠  token budget {pct}% ({used}/{total})"))
                ));
            }
            AgentEvent::Retrying { step, attempt, delay_ms } => {
                let delay_sec = *delay_ms as f64 / 1000.0;
                pb.set_message(format!(
                    "step {step} · ↻ retry {attempt}/3 — waiting {delay_sec:.1}s"
                ));
            }
            AgentEvent::ContextCompacted { turns_removed } => {
                pb.println(format!(
                    "{}",
                    dim.apply_to(format!("  ✂  context compacted ({turns_removed} turns removed)"))
                ));
            }
        }
    }
}

// ── Agent handler ──────────────────────────────────────────────────────────

/// Spin up a local model using the same engine-detection + loading logic as
/// `handle_serve`, but return `(base_url, model_id, pid)` instead of blocking.
async fn start_model_for_agent(
    args: ServeArgs,
) -> Result<(String, String, i32), String> {
    // ── 1. Resolve model_id ────────────────────────────────────────────────
    let model_id = match args.model_id.as_deref() {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => {
            if let Some(ref path) = args.model_path {
                PathBuf::from(path)
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "model".to_string())
            } else {
                select_model_interactively(args.select).await
            }
        }
    };

    // Use a random free port if the default is already taken
    let port = args.port;

    // ── 2. Detect engine + resolve paths ──────────────────────────────────
    let ctx_size = if args.fit { 0 } else { args.ctx_size };

    let (engine, resolved_model_path, resolved_mmproj) =
        match resolve_model_engine(&model_id) {
            Ok((eng, mp, mmp)) => (
                eng,
                args.model_path.unwrap_or_else(|| mp.to_string_lossy().into_owned()),
                args.mmproj.or_else(|| mmp.map(|p| p.to_string_lossy().into_owned())),
            ),
            Err(_) if args.model_path.is_some() => {
                ("llamacpp".to_string(), args.model_path.unwrap(), args.mmproj)
            }
            Err(_) if looks_like_hf_repo(&model_id) => {
                auto_download_hf_model(&model_id, args.select).await;
                match resolve_model_engine(&model_id) {
                    Ok((eng, mp, mmp)) => (
                        eng,
                        mp.to_string_lossy().into_owned(),
                        mmp.map(|p| p.to_string_lossy().into_owned()),
                    ),
                    Err(e) => return Err(e),
                }
            }
            Err(e) => return Err(e),
        };

    let pb = start_progress(args.verbose, format!("Loading {} ({engine})…", model_id));

    // ── 3. Load model ──────────────────────────────────────────────────────
    let (pid, actual_port) = match load_model_inner(
        &engine, &model_id,
        resolved_model_path, resolved_mmproj, args.bin,
        port, &args.api_key, args.n_gpu_layers, ctx_size, args.fit, args.threads, args.timeout, false,
    )
    .await
    {
        Ok(handle) => {
            finish_progress(pb, format!("✓ {model_id} ready · http://127.0.0.1:{}", handle.1));
            handle
        }
        Err(e) => {
            finish_progress(pb, format!("✗ Failed to load {model_id}"));
            return Err(e);
        }
    };

    Ok((format!("http://127.0.0.1:{actual_port}"), model_id, pid))
}

/// Kill the model server process spawned by start_model_for_agent.
fn stop_model(pid: i32) {
    #[cfg(unix)]
    {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;
        let _ = kill(Pid::from_raw(pid), Signal::SIGTERM);
    }
    #[cfg(not(unix))]
    {
        // Windows: terminate process by PID
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .output();
    }
}

async fn handle_agent(cmd: AgentCommands, matches: &clap::ArgMatches) {
    let dim = Style::new().dim();
    let red = Style::new().red();

    match cmd {
        AgentCommands::Chat { serve, message, mount, api_url, agent: agent_impl, robot_url } => {
            // ── Load and merge agent config ──────────────────────────────
            let mut config = AgentConfig::load();
            let mut serve = serve;
            let mut api_url = api_url;
            let mut agent_impl = agent_impl;
            let mut mount = mount;
            let mut robot_url = robot_url;

            let any_cli_override = merge_agent_config(
                matches, &config,
                &mut serve, &mut api_url, &mut agent_impl, &mut mount, &mut robot_url,
            );

            // Write back: always save current merged state so next run picks it up.
            // This also persists any explicit CLI overrides.
            write_back_agent_config(
                &mut config, &serve, &api_url, &agent_impl, &mount, &robot_url,
            );

            if any_cli_override {
                eprintln!("{}", dim.apply_to("  config: CLI overrides saved to agent-config.json"));
            }

            // Enable log capture to parse llama.cpp memory info.
            agent_tui::enable_log_capture();

            // When --api-url is given, skip local model startup entirely.
            let (url, model_id, pid, api_key) = if let Some(ext_url) = api_url {
                let model = serve.model_id.unwrap_or_else(|| "default".to_string());
                let key   = if serve.api_key.is_empty() { None } else { Some(serve.api_key) };
                (ext_url, model, -1i32, key)
            } else {
                match start_model_for_agent(serve).await {
                    Ok((u, m, p)) => (u, m, p, None),
                    Err(e) => { eprintln!("{} {e}", red.apply_to("error:")); std::process::exit(1); }
                }
            };

            // Capture logs from model loading for resource bars
            let captured_logs = agent_tui::take_captured_logs();

            // Capture display info before moving into spawn_blocking.
            let display_url      = url.clone();
            let display_model_id = model_id.clone();
            let robot_url_clone  = robot_url.clone();

            // create_agent scans WASM tools (spawns blocking I/O + reqwest::blocking::Client).
            let agent = match tokio::task::spawn_blocking(move || {
                if let Some(ref rurl) = robot_url_clone {
                    // Vision + robot agent
                    let frame_url = format!("{rurl}/frame");
                    let vision = Box::new(app_lib::core::cli::UrlCapture::start(
                        frame_url, std::time::Duration::from_millis(500),
                    ));
                    app_lib::core::cli::create_vision_agent(
                        url, model_id, mount, api_key, &agent_impl, vision, Some(rurl.clone()),
                    )
                } else {
                    create_agent(url, model_id, mount, api_key, &agent_impl)
                }
            }).await {
                Ok(a) => a,
                Err(e) => { eprintln!("{} spawn: {e}", red.apply_to("error:")); std::process::exit(1); }
            };

            if let Some(prompt) = message {
                // ── one-shot mode (--message) ──────────────────────────────
                eprintln!("{}", dim.apply_to(format!(
                    "Agent running against {display_url} (model: {display_model_id})…"
                )));
                eprintln!();
                let pb     = make_spinner("step 1 · thinking…");
                let result = agent.run(&[], &prompt, &mut make_agent_handler(pb.clone())).await;
                pb.finish_and_clear();
                eprintln!();
                if pid > 0 { stop_model(pid); }

                match result {
                    Ok(resp) => {
                        println!("{}", resp.content);
                        let reason_str = match resp.finish_reason {
                            app_lib::core::cli::FinishReason::Stop => "stop",
                            app_lib::core::cli::FinishReason::MaxSteps => "max_steps",
                            app_lib::core::cli::FinishReason::BudgetExhausted => "budget_exhausted",
                            app_lib::core::cli::FinishReason::Cancelled => "cancelled",
                        };
                        eprintln!("{}", dim.apply_to(format!(
                            "[{} tokens · {} step{} · {}]",
                            resp.tokens_used, resp.steps,
                            if resp.steps == 1 { "" } else { "s" },
                            reason_str
                        )));
                    }
                    Err(e) => {
                        eprintln!("{} {}", red.apply_to("error:"), e);
                        std::process::exit(1);
                    }
                }
            } else {
                // ── interactive TUI mode ───────────────────────────────────
                run_agent_tui(agent, display_model_id, display_url, pid, captured_logs.clone(), robot_url).await;
            }
        }
    }
}

/// Run the full-screen agent TUI (ratatui).
async fn run_agent_tui(
    agent: app_lib::core::cli::AgentLoop,
    model_id: String,
    api_url: String,
    pid: i32,
    log_capture: String,
    robot_url: Option<String>,
) {
    use agent_tui::*;

    let mut terminal = match setup_terminal() {
        Ok(t) => t,
        Err(e) => {
            eprintln!("Failed to initialize TUI: {e}");
            std::process::exit(1);
        }
    };

    let mut state = AgentTuiState::new(model_id, api_url);

    // If robot server is connected, set up frame polling
    if let Some(ref rurl) = robot_url {
        state.robot_server_url = Some(rurl.clone());
        // Start polling camera frames in the background
        let frame_url = format!("{rurl}/frame");
        let frame_data = state.robot_frame.clone();
        let connected  = state.robot_connected.clone();
        tokio::spawn(async move {
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(3))
                .build()
                .unwrap_or_default();
            loop {
                match client.get(&frame_url).send().await {
                    Ok(resp) if resp.status().is_success() => {
                        if let Ok(bytes) = resp.bytes().await {
                            if let Ok(mut guard) = frame_data.lock() {
                                *guard = Some(bytes.to_vec());
                            }
                            connected.store(true, std::sync::atomic::Ordering::Relaxed);
                        }
                    }
                    _ => {
                        connected.store(false, std::sync::atomic::Ordering::Relaxed);
                    }
                }
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        });
    }

    // Parse resource usage from llama.cpp startup logs
    if !log_capture.is_empty() {
        let mem = LlamacppMemInfo::from_logs(&log_capture);
        state.set_resources_from_llamacpp(&mem);
    }

    let mut history: Vec<app_lib::core::cli::ChatMessage> = Vec::new();
    let agent = Arc::new(agent);

    // Active agent task state (None when idle)
    let mut active_event_rx: Option<tokio::sync::mpsc::UnboundedReceiver<AgentEvent>> = None;
    let mut active_handle: Option<tokio::task::JoinHandle<Result<app_lib::core::cli::AgentResponse, String>>> = None;
    let mut active_input: Option<String> = None; // the input that started the current agent run
    let mut active_cancel: Option<app_lib::core::cli::CancellationToken> = None;

    // Initial draw
    let _ = terminal.draw(|f| draw(f, &mut state));

    loop {
        // Choose poll timeout: non-blocking when agent is running, blocking when idle
        let timeout = if active_handle.is_some() {
            std::time::Duration::ZERO
        } else {
            std::time::Duration::from_millis(500)
        };

        let had_input = handle_input(&mut state, timeout);

        if state.should_quit {
            break;
        }

        // ── Handle user submit ───────────────────────────────────────────
        if state.input_ready {
            let input = state.take_input();
            if input == "/quit" || input == "/exit" || input == "exit" {
                break;
            }
            if input == "/clear" {
                history.clear();
                state.messages.clear();
                state.tool_log.clear();
                state.pending_messages.clear();
                state.tokens_used = 0;
                state.steps = 0;
                state.tool_calls_count = 0;
                state.messages_scroll = 0;
                state.tool_log_scroll = 0;
                let _ = terminal.draw(|f| draw(f, &mut state));
                continue;
            }
            if !input.is_empty() {
                if state.is_thinking {
                    // Agent is busy — queue the message
                    state.push_message(ChatItem::Queued(input.clone()));
                    state.pending_messages.push_back(input);
                } else {
                    // Agent is idle — start immediately
                    start_agent_run(
                        &mut state, &mut history, &agent,
                        &mut active_event_rx, &mut active_handle, &mut active_input,
                        &mut active_cancel, input,
                    );
                }
            }
        }

        // ── Handle cancellation (Escape) ─────────────────────────────────
        if state.cancel_requested {
            state.cancel_requested = false;
            if let Some(ref token) = active_cancel {
                token.cancel();
            }
            // Clear pending queue and their chat items
            state.pending_messages.clear();
            state.messages.retain(|m| !matches!(m, ChatItem::Queued(_)));
        }

        // ── Drain agent events ───────────────────────────────────────────
        let mut had_events = false;
        if let Some(ref mut rx) = active_event_rx {
            while let Ok(event) = rx.try_recv() {
                apply_agent_event(&mut state, &event);
                had_events = true;
            }
        }

        // ── Check if agent finished ──────────────────────────────────────
        let agent_just_finished = active_handle.as_ref().map_or(false, |h| h.is_finished());
        if agent_just_finished {
            // Drain any remaining events
            if let Some(ref mut rx) = active_event_rx {
                while let Ok(event) = rx.try_recv() {
                    apply_agent_event(&mut state, &event);
                }
            }

            // Remove thinking indicator
            state.messages.retain(|m| !matches!(m, ChatItem::Thinking { .. }));
            state.is_thinking = false;

            let handle = active_handle.take().unwrap();
            let input = active_input.take().unwrap_or_default();
            active_event_rx = None;
            active_cancel = None;

            // Process the result
            let was_cancelled;
            match handle.await {
                Ok(Ok(resp)) => {
                    state.push_debug(format!(
                        "agent done: finish={:?} steps={} tokens={} content_len={}",
                        resp.finish_reason, resp.steps, resp.tokens_used, resp.content.len()
                    ));
                    if resp.content.is_empty() {
                        state.push_debug("WARNING: agent returned empty content".into());
                    }
                    was_cancelled = matches!(resp.finish_reason, app_lib::core::cli::FinishReason::Cancelled);
                    state.tokens_used = resp.tokens_used;

                    if was_cancelled {
                        state.push_message(ChatItem::Agent("[cancelled]".into()));
                        state.push_tool_log(ToolLogKind::Warn, "agent cancelled by user".into());
                    } else {
                        state.push_message(ChatItem::Agent(resp.content.clone()));

                        history.push(app_lib::core::cli::ChatMessage {
                            role: "user".into(),
                            content: Some(input),
                            tool_calls: None,
                            tool_call_id: None,
                            name: None,
                            vision_content: None,
                        });
                        history.push(app_lib::core::cli::ChatMessage {
                            role: "assistant".into(),
                            content: Some(resp.content),
                            tool_calls: None,
                            tool_call_id: None,
                            name: None,
                            vision_content: None,
                        });
                    }
                }
                Ok(Err(e)) => {
                    was_cancelled = false;
                    state.push_message(ChatItem::Agent(format!("[error] {e}")));
                    state.push_tool_log(ToolLogKind::Error, e.to_string());
                }
                Err(e) => {
                    // JoinError — task was aborted or panicked
                    was_cancelled = e.is_cancelled();
                    if was_cancelled {
                        state.push_message(ChatItem::Agent("[cancelled]".into()));
                        state.push_tool_log(ToolLogKind::Warn, "agent cancelled by user".into());
                    } else {
                        state.push_message(ChatItem::Agent(format!("[error] task panicked: {e}")));
                        state.push_tool_log(ToolLogKind::Error, format!("task panicked: {e}"));
                    }
                }
            }

            // ── Dequeue next message if any (skip if cancelled) ──────────
            if !was_cancelled {
                if let Some(next) = state.pending_messages.pop_front() {
                    // Remove the Queued chat item for this message
                    state.messages.retain(|m| !matches!(m, ChatItem::Queued(t) if t == &next));
                    start_agent_run(
                        &mut state, &mut history, &agent,
                        &mut active_event_rx, &mut active_handle, &mut active_input,
                        &mut active_cancel, next,
                    );
                }
            }
        }

        // ── Redraw ───────────────────────────────────────────────────────
        if had_events || had_input || agent_just_finished {
            let _ = terminal.draw(|f| draw(f, &mut state));
        } else if active_handle.is_none() {
            // Idle — still redraw for resize events
            let _ = terminal.draw(|f| draw(f, &mut state));
        }

        // Yield to tokio when agent is running
        if active_handle.is_some() {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    }

    // Cleanup
    restore_terminal();

    if pid > 0 {
        eprintln!("Session ended — stopping model…");
        stop_model(pid);
    }
}

/// Start a new agent run: push user message, set thinking state, spawn task.
fn start_agent_run(
    state: &mut agent_tui::AgentTuiState,
    history: &mut Vec<app_lib::core::cli::ChatMessage>,
    agent: &Arc<app_lib::core::cli::AgentLoop>,
    event_rx: &mut Option<tokio::sync::mpsc::UnboundedReceiver<AgentEvent>>,
    handle: &mut Option<tokio::task::JoinHandle<Result<app_lib::core::cli::AgentResponse, String>>>,
    active_input: &mut Option<String>,
    active_cancel: &mut Option<app_lib::core::cli::CancellationToken>,
    input: String,
) {
    use agent_tui::ChatItem;

    state.push_message(ChatItem::User(input.clone()));
    state.is_thinking = true;
    state.steps += 1;
    state.push_message(ChatItem::Thinking { step: state.steps });

    let (tx, rx_new) = tokio::sync::mpsc::unbounded_channel::<AgentEvent>();
    let history_snapshot = history.clone();
    let input_clone = input.clone();
    let agent_ref = Arc::clone(agent);
    let cancel_token = app_lib::core::cli::CancellationToken::new();
    let cancel_clone = cancel_token.clone();

    *handle = Some(tokio::spawn(async move {
        let mut handler = move |event: AgentEvent| {
            let _ = tx.send(event);
        };
        agent_ref.run_cancellable(&history_snapshot, &input_clone, &mut handler, cancel_clone).await
    }));
    *event_rx = Some(rx_new);
    *active_input = Some(input);
    *active_cancel = Some(cancel_token);
}

/// Translate an AgentEvent into TUI state updates.
fn apply_agent_event(state: &mut agent_tui::AgentTuiState, event: &AgentEvent) {
    use agent_tui::*;

    state.push_debug(format!("{event:?}"));

    match event {
        AgentEvent::Thinking { step } => {
            state.steps = *step;
            // Update the existing thinking item
            state.messages.retain(|m| !matches!(m, ChatItem::Thinking { .. }));
            state.push_message(ChatItem::Thinking { step: *step });
        }
        AgentEvent::ToolCall { step: _, tool_id, args } => {
            state.tool_calls_count += 1;
            let raw = serde_json::to_string(args).unwrap_or_default();
            let preview = if raw.len() > 80 { format!("{}…", &raw[..80]) } else { raw };
            state.push_message(ChatItem::ToolCall {
                name: tool_id.clone(),
                args_preview: preview.clone(),
            });
            state.push_tool_log(ToolLogKind::Info, tool_id.clone());
            if !preview.is_empty() && preview != "{}" && preview != "null" {
                state.push_tool_log_dim(format!("  {preview}"));
            }
        }
        AgentEvent::ToolResult { tool_id, ok, elapsed_ms, summary, .. } => {
            state.push_message(ChatItem::ToolResult {
                name: tool_id.clone(),
                ok: *ok,
                elapsed_ms: *elapsed_ms,
                summary: summary.clone(),
            });
            let time_str = if *elapsed_ms >= 1000 {
                format!("{:.1}s", *elapsed_ms as f64 / 1000.0)
            } else {
                format!("{elapsed_ms}ms")
            };
            let kind = if *ok { ToolLogKind::Ok } else { ToolLogKind::Error };
            state.push_tool_log(kind, format!("{tool_id} ({time_str})"));
            if !summary.is_empty() {
                state.push_tool_log_dim(format!("  {summary}"));
            }
        }
        AgentEvent::ToolLog { tool_id: _, message, .. } => {
            state.push_tool_log_dim(format!("  {message}"));
        }
        AgentEvent::TokenBudget { used, total } => {
            state.tokens_used = *used;
            state.tokens_total = *total;
        }
        AgentEvent::Retrying { step, attempt, delay_ms } => {
            let delay_sec = *delay_ms as f64 / 1000.0;
            state.push_tool_log(
                ToolLogKind::Warn,
                format!("step {step} retry {attempt}/3 — waiting {delay_sec:.1}s"),
            );
        }
        AgentEvent::ContextCompacted { turns_removed } => {
            state.push_tool_log(
                ToolLogKind::Warn,
                format!("context compacted ({turns_removed} turns removed)"),
            );
        }
    }
}
