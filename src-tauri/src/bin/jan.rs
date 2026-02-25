//! jan — headless CLI for Jan.
//!
//! Shares all core logic with the Jan desktop app.
//! Build with: cargo build --features cli --bin jan

use std::collections::HashMap;
use std::sync::Arc;

use clap::{Args, CommandFactory, FromArgMatches, Parser, Subcommand};
use console::Style;
use indicatif::{ProgressBar, ProgressStyle};

// Import the library crate so we can access core modules.
// The lib target is named "app_lib" (see [lib] section in Cargo.toml).
use app_lib::core::cli::{
    cli_delete_thread, cli_get_config, cli_get_data_folder, cli_get_thread,
    cli_list_messages, cli_list_threads, discover_llamacpp_binary,
    discover_mlx_binary, download_hf_model, fetch_hf_gguf_files, init_llamacpp_state,
    init_mlx_state, list_models, load_llama_model_impl, load_mlx_model_impl,
    looks_like_hf_repo, resolve_model_by_id, resolve_model_engine, HfFileInfo,
    LlamacppConfig, MlxConfig,
};
use std::path::PathBuf;

// ── Top-level CLI ──────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(
    name = "jan",
    about = "Serve local AI models and wire them to agents — no cloud required",
    long_about = "Jan runs local AI models (LlamaCPP / MLX) and exposes them via an\n\
OpenAI-compatible API, then wires AI coding agents like Claude Code or opencode\n\
directly to your own hardware — no cloud account, no usage fees, full privacy.\n\n\
Models downloaded in the Jan desktop app are automatically available here.",
    after_help = "Examples:\n  \
  jan launch claude                               # pick a model, then run Claude Code against it\n  \
  jan launch claude --model qwen3.5-35b-a3b       # use a specific model\n  \
  jan launch opencode --model qwen3.5-35b-a3b     # wire opencode to a local model\n  \
  jan serve qwen3.5-35b-a3b                       # expose a model at localhost:6767/v1\n  \
  jan serve qwen3.5-35b-a3b --fit                 # auto-fit context to available VRAM\n  \
  jan serve qwen3.5-35b-a3b --detach              # run in the background\n  \
  jan models list                                 # show all installed models",
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
        /// Agent or program to run after the model is ready (e.g. claude, opencode)
        program: String,
        /// Arguments forwarded to the program
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        program_args: Vec<String>,
        /// Model ID to load (omit to pick interactively)
        #[arg(long)]
        model: Option<String>,
        /// Port the model server listens on
        #[arg(long, default_value_t = 6767)]
        port: u16,
        /// API key for the model server (exported as OPENAI_API_KEY and ANTHROPIC_AUTH_TOKEN)
        #[arg(long, default_value = "jan")]
        api_key: String,
        /// GPU layers to offload (-1 = all layers, 0 = CPU only)
        #[arg(long, default_value_t = -1)]
        n_gpu_layers: i32,
        /// Context window size in tokens (0 = model default)
        #[arg(long, default_value_t = 4096)]
        ctx_size: i32,
        /// Auto-fit context to available VRAM (default: on when launching claude)
        #[arg(long)]
        fit: Option<bool>,
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
    /// Show app configuration and data folder location
    #[command(display_order = 12)]
    App {
        #[command(subcommand)]
        cmd: AppCommands,
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
    #[arg(long, default_value_t = 4096)]
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

// ── App subcommands ────────────────────────────────────────────────────────

#[derive(Subcommand)]
enum AppCommands {
    /// Print the Jan data folder path (where models, threads, and config are stored)
    DataFolder,
    /// Print the Jan configuration as JSON
    Config,
}

// ── ASCII logo ─────────────────────────────────────────────────────────────

/// Build a centered, bright-yellow ASCII logo for the help header.
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

    let art_width: usize = 26; // visual columns of the widest line
    let term_cols = console::Term::stdout().size().1 as usize;
    let pad = (term_cols.saturating_sub(art_width)) / 2;
    let indent = " ".repeat(pad);

    let yellow = Style::new().yellow().bold();

    let mut out: Vec<String> = lines
        .iter()
        .map(|l| format!("{}{}", indent, yellow.apply_to(l)))
        .collect();

    // Tagline beneath the wordmark
    let tagline = "Your models · Your hardware · Your rules";
    let tpad = (term_cols.saturating_sub(tagline.len())) / 2;
    out.push(String::new());
    out.push(format!(
        "{}{}",
        " ".repeat(tpad),
        Style::new().dim().apply_to(tagline)
    ));
    out.push(String::new());

    out.join("\n")
}

// ── Entry point ────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    // Default to warn so verbose plugin logs don't clutter the spinner output.
    // Override with RUST_LOG=debug for troubleshooting.
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("warn"),
    )
    .init();

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
        Commands::App { cmd } => handle_app(cmd),
        Commands::Serve { args } => handle_serve(args).await,
        Commands::Launch { program, program_args, model, port, api_key, n_gpu_layers, ctx_size, fit } =>
            handle_launch(program, program_args, model, port, api_key, n_gpu_layers, ctx_size, fit).await,
    }
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
            let mut envs = HashMap::new();
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

// ── Spinner helper ─────────────────────────────────────────────────────────

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
async fn auto_download_hf_model(repo_id: &str) -> String {
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

    // Let the user pick which quantization to download
    let chosen = pick_hf_file(&files);
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

// ── Interactive model picker ────────────────────────────────────────────────

fn select_model_interactively() -> String {
    let mut all: Vec<(String, String)> = Vec::new(); // (id, engine)
    for engine in &["llamacpp", "mlx"] {
        for (id, _) in list_models(engine) {
            all.push((id, engine.to_string()));
        }
    }

    if all.is_empty() {
        eprintln!("No models found. Download a model from the Jan app first.");
        std::process::exit(1);
    }

    let labels: Vec<String> = all
        .iter()
        .map(|(id, engine)| format!("{} ({})", id, engine))
        .collect();

    let selection = dialoguer::Select::new()
        .with_prompt("Select a model")
        .items(&labels)
        .default(0)
        .interact()
        .unwrap_or_else(|_| std::process::exit(1));

    all.remove(selection).0
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
    // Resolve model_id first — may trigger interactive picker before we potentially detach.
    let model_id = args.model_id.clone().unwrap_or_else(select_model_interactively);

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
                auto_download_hf_model(&model_id).await;
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

    let pb = make_spinner(format!("Loading {} ({engine})…", model_id));

    if engine == "mlx" {
        use std::path::Path;

        let bin_path = match bin {
            Some(b) => b,
            None => match discover_mlx_binary() {
                Some(p) => p.to_string_lossy().into_owned(),
                None => {
                    pb.finish_with_message("✗ mlx-server binary not found".to_string());
                    eprintln!("Install Jan from https://jan.ai or pass --bin <path>.");
                    std::process::exit(1);
                }
            },
        };

        let mlx_state = Arc::new(init_mlx_state());
        let mut envs = HashMap::new();
        if !api_key.is_empty() {
            envs.insert("MLX_API_KEY".to_string(), api_key);
        }

        match load_mlx_model_impl(
            mlx_state.mlx_server_process.clone(),
            Path::new(&bin_path),
            model_id.clone(),
            resolved_model_path,
            port,
            MlxConfig { ctx_size },
            envs,
            embedding,
            timeout,
        )
        .await
        {
            Ok(info) => {
                let url = format!("http://127.0.0.1:{}", info.port);
                pb.finish_with_message(format!("✓ {model_id} ready · {url}"));
                eprintln!();
                eprintln!("  Endpoint  {url}/v1");
                eprintln!();
                eprintln!("  Press Ctrl+C to stop.");
                wait_for_shutdown(info.pid).await;
            }
            Err(e) => {
                pb.finish_with_message(format!("✗ Failed to load {model_id}"));
                eprintln!(
                    "\n{}",
                    serde_json::to_string_pretty(&e).unwrap_or_else(|_| format!("{e:?}"))
                );
                std::process::exit(1);
            }
        }
    } else {
        // LlamaCPP path
        let bin_path = match bin {
            Some(b) => b,
            None => match discover_llamacpp_binary() {
                Some(p) => p.to_string_lossy().into_owned(),
                None => {
                    pb.finish_with_message("✗ llama-server binary not found".to_string());
                    eprintln!("Install a backend from Jan's settings or pass --bin <path>.");
                    std::process::exit(1);
                }
            },
        };

        let llama_state = Arc::new(init_llamacpp_state());
        let mut envs = HashMap::new();
        if !api_key.is_empty() {
            envs.insert("LLAMA_API_KEY".to_string(), api_key);
        }

        let config = LlamacppConfig {
            version_backend: "cli/llama-server".to_string(),
            auto_update_engine: false,
            auto_unload: false,
            timeout: timeout as i32,
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
            cache_type_k: String::new(),
            cache_type_v: String::new(),
            defrag_thold: -1.0,
            rope_scaling: String::new(),
            rope_scale: 0.0,
            rope_freq_base: 0.0,
            rope_freq_scale: 0.0,
            ctx_shift: false,
        };

        match load_llama_model_impl(
            llama_state.llama_server_process.clone(),
            &bin_path,
            model_id.clone(),
            resolved_model_path,
            port,
            config,
            envs,
            resolved_mmproj,
            embedding,
            timeout,
        )
        .await
        {
            Ok(info) => {
                let url = format!("http://127.0.0.1:{}", info.port);
                pb.finish_with_message(format!("✓ {model_id} ready · {url}"));
                eprintln!();
                eprintln!("  Endpoint  {url}/v1");
                eprintln!();
                eprintln!("  Press Ctrl+C to stop.");
                wait_for_shutdown(info.pid).await;
            }
            Err(e) => {
                pb.finish_with_message(format!("✗ Failed to load {model_id}"));
                eprintln!(
                    "\n{}",
                    serde_json::to_string_pretty(&e).unwrap_or_else(|_| format!("{e:?}"))
                );
                std::process::exit(1);
            }
        }
    }
}

/// Block until Ctrl+C, then terminate the child process.
async fn wait_for_shutdown(pid: i32) {
    tokio::signal::ctrl_c().await.ok();
    eprintln!("\nShutting down (pid {pid})...");
    #[cfg(unix)]
    {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;
        let _ = kill(Pid::from_raw(pid), Signal::SIGTERM);
    }
}

// ── Launch handler ─────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
async fn handle_launch(
    program: String,
    program_args: Vec<String>,
    model: Option<String>,
    port: u16,
    api_key: String,
    n_gpu_layers: i32,
    ctx_size: i32,
    fit: Option<bool>,
) {
    let model_id = model.unwrap_or_else(select_model_interactively);

    // Detect claude early so we can set fit default before starting the server.
    let prog_name = std::path::Path::new(&program)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&program);
    let is_claude = prog_name.contains("claude");

    // --fit defaults to true when launching claude (maximises context window).
    let effective_fit = fit.unwrap_or(is_claude);

    // Start the model server inline (same process, no detach).
    let (pid, actual_port) = start_model_server(&model_id, port, api_key.clone(), n_gpu_layers, ctx_size, effective_fit).await;

    let base_url = format!("http://127.0.0.1:{actual_port}");
    let v1_url   = format!("{base_url}/v1");

    let anthropic_key_var = if is_claude { "ANTHROPIC_AUTH_TOKEN" } else { "ANTHROPIC_API_KEY" };

    eprintln!();
    eprintln!("  OPENAI_BASE_URL={v1_url}");
    eprintln!("  OPENAI_API_KEY={api_key}");
    eprintln!("  ANTHROPIC_BASE_URL={base_url}");
    eprintln!("  {anthropic_key_var}={api_key}");
    eprintln!("  ANTHROPIC_DEFAULT_OPUS_MODEL={model_id}");
    eprintln!("  ANTHROPIC_DEFAULT_SONNET_MODEL={model_id}");
    eprintln!("  ANTHROPIC_DEFAULT_HAIKU_MODEL={model_id}");
    eprintln!();
    eprintln!("  → Launching: {program}");
    eprintln!();

    let mut cmd = std::process::Command::new(&program);
    cmd.args(&program_args)
        .env("OPENAI_BASE_URL",    &v1_url)
        .env("OPENAI_API_KEY",     &api_key)
        .env("ANTHROPIC_BASE_URL", &base_url)
        .env(anthropic_key_var,    &api_key)
        .env("ANTHROPIC_DEFAULT_OPUS_MODEL",   &model_id)
        .env("ANTHROPIC_DEFAULT_SONNET_MODEL", &model_id)
        .env("ANTHROPIC_DEFAULT_HAIKU_MODEL",  &model_id);
    let status = cmd.status();

    // Kill the model server when the program exits.
    #[cfg(unix)]
    {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;
        let _ = kill(Pid::from_raw(pid), Signal::SIGTERM);
    }

    match status {
        Ok(s) => std::process::exit(s.code().unwrap_or(0)),
        Err(e) => {
            eprintln!("Error launching '{program}': {e}");
            std::process::exit(1);
        }
    }
}

/// Start the model server and return `(pid, actual_port)`.
/// Resolves the engine automatically (LlamaCPP or MLX).
async fn start_model_server(
    model_id: &str,
    port: u16,
    api_key: String,
    n_gpu_layers: i32,
    ctx_size: i32,
    fit: bool,
) -> (i32, u16) {
    // Auto-download from HuggingFace if the model isn't installed locally.
    if resolve_model_engine(model_id).is_err() && looks_like_hf_repo(model_id) {
        auto_download_hf_model(model_id).await;
    }

    let (engine, model_path, mmproj) = match resolve_model_engine(model_id) {
        Ok(r) => r,
        Err(e) => { eprintln!("Error: {e}"); std::process::exit(1); }
    };
    let model_path = model_path.to_string_lossy().into_owned();

    let pb = make_spinner(format!("Loading {} ({engine})…", model_id));

    if engine == "mlx" {
        use std::path::Path;
        let bin_path = discover_mlx_binary().unwrap_or_else(|| {
            pb.finish_with_message("✗ mlx-server binary not found".to_string());
            std::process::exit(1);
        });
        let mlx_state = Arc::new(init_mlx_state());
        let mut envs = HashMap::new();
        if !api_key.is_empty() { envs.insert("MLX_API_KEY".into(), api_key.clone()); }
        let info = load_mlx_model_impl(
            mlx_state.mlx_server_process.clone(),
            Path::new(&bin_path),
            model_id.to_string(),
            model_path,
            port,
            MlxConfig { ctx_size },
            envs,
            false,
            120,
        ).await.unwrap_or_else(|e| {
            pb.finish_with_message(format!("✗ Failed to load {model_id}"));
            eprintln!("{}", serde_json::to_string_pretty(&e).unwrap_or_else(|_| format!("{e:?}")));
            std::process::exit(1);
        });
        let url = format!("http://127.0.0.1:{}", info.port);
        pb.finish_with_message(format!("✓ {model_id} ready · {url}"));
        (info.pid, info.port as u16)
    } else {
        let bin_path = discover_llamacpp_binary()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| {
                pb.finish_with_message("✗ llama-server binary not found".to_string());
                std::process::exit(1);
            });
        let llama_state = Arc::new(init_llamacpp_state());
        let mut envs = HashMap::new();
        if !api_key.is_empty() { envs.insert("LLAMA_API_KEY".into(), api_key.clone()); }
        // When fit is on, let llama.cpp decide the context size automatically.
        let effective_ctx_size = if fit { 0 } else { ctx_size };
        let config = LlamacppConfig {
            version_backend: "cli/llama-server".to_string(),
            auto_update_engine: false, auto_unload: false,
            timeout: 120, llamacpp_env: String::new(),
            fit, fit_target: String::new(), fit_ctx: String::new(),
            chat_template: String::new(), n_gpu_layers, offload_mmproj: true,
            cpu_moe: false, n_cpu_moe: 0, override_tensor_buffer_t: String::new(),
            ctx_size: effective_ctx_size, threads: 0, threads_batch: 0, n_predict: -1,
            batch_size: 512, ubatch_size: 512, device: String::new(),
            split_mode: String::new(), main_gpu: 0, flash_attn: "auto".into(),
            cont_batching: true, no_mmap: false, mlock: false, no_kv_offload: false,
            cache_type_k: String::new(), cache_type_v: String::new(),
            defrag_thold: -1.0, rope_scaling: String::new(),
            rope_scale: 0.0, rope_freq_base: 0.0, rope_freq_scale: 0.0, ctx_shift: false,
        };
        let info = load_llama_model_impl(
            llama_state.llama_server_process.clone(),
            &bin_path,
            model_id.to_string(),
            model_path,
            port,
            config,
            envs,
            mmproj.map(|p| p.to_string_lossy().into_owned()),
            false,
            120,
        ).await.unwrap_or_else(|e| {
            pb.finish_with_message(format!("✗ Failed to load {model_id}"));
            eprintln!("{}", serde_json::to_string_pretty(&e).unwrap_or_else(|_| format!("{e:?}")));
            std::process::exit(1);
        });
        let url = format!("http://127.0.0.1:{}", info.port);
        pb.finish_with_message(format!("✓ {model_id} ready · {url}"));
        (info.pid, info.port as u16)
    }
}

// ── App handlers ───────────────────────────────────────────────────────────

fn handle_app(cmd: AppCommands) {
    match cmd {
        AppCommands::DataFolder => {
            let folder = cli_get_data_folder();
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({ "data_folder": folder }))
                    .unwrap()
            );
        }

        AppCommands::Config => match cli_get_config() {
            Ok(config) => println!("{}", serde_json::to_string_pretty(&config).unwrap()),
            Err(e) => {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
        },
    }
}
