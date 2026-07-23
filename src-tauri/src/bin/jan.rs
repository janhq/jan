//! jan — headless CLI for Jan.
//!
//! Shares all core logic with the Jan desktop app.
//! Build with: cargo build --features cli --bin jan

use clap::{Args, CommandFactory, FromArgMatches, Parser, Subcommand};
use console::Style;

// Import the library crate so we can access core modules.
// The lib target is named "app_lib" (see [lib] section in Cargo.toml).
use app_lib::core::cli::providers::ProviderOverrides;
use app_lib::core::cli::{
    cli_agent_config_list, cli_agent_config_path, cli_agent_config_set, cli_agent_config_unset,
    cli_agent_run, cli_agent_status, cli_agent_step, cli_agent_ui, cli_delete_thread,
    cli_get_thread, cli_list_messages, cli_list_threads, list_models,
};

// ── Top-level CLI ──────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(
    name = "jan",
    about = "Chat with local AI models in an interactive agent console — no cloud required",
    long_about = "Running `jan` with no arguments opens the interactive agent console (TUI),\n\
where you chat with a local or cloud model that can run tools in your project.\n\n\
The `jan cli` subcommand is the non-interactive fallback: run folder-based\n\
agents headlessly and manage threads and installed models.\n\n\
Models downloaded in the Jan desktop app are available in both.",
    after_help = "Examples:\n  \
  jan                                                    # open the interactive agent console (TUI)\n  \
  jan --yolo                                             # TUI with every tool call auto-approved\n  \
  jan --task \"fix the failing test\"                      # seed the TUI with a first message\n  \
  jan cli agent run \"fix the failing test\"               # run the agent non-interactively\n  \
  jan cli models list                                    # show all installed models\n  \
  jan cli threads list                                   # list saved conversation threads",
    version
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
    /// Project root containing .jan/agent/agent.toml (bare TUI only)
    #[arg(long, default_value = ".")]
    project: String,
    /// Optional first message to seed the chat with (bare TUI only)
    #[arg(long)]
    task: Option<String>,
    /// Model ID overriding [agent].model in agent.toml (bare TUI only)
    #[arg(long)]
    model: Option<String>,
    /// Max turns per message, clamped 1..=400 (bare TUI only)
    #[arg(long)]
    max_turns: Option<u32>,
    /// Image file to attach to the first message, repeatable (bare TUI only)
    #[arg(long = "image")]
    images: Vec<String>,
    #[command(flatten)]
    providers: ProviderArgs,
    /// Disable the sandbox and auto-approve every tool call in the default agent
    /// TUI (no prompts). Ignored when a subcommand is given.
    #[arg(long)]
    yolo: bool,
}

/// Top-level commands. Bare `jan` opens the interactive TUI; everything else
/// lives under the non-interactive `cli` fallback.
#[derive(Subcommand)]
enum Commands {
    /// Non-interactive CLI: launch agents, run headless agent tasks, manage models and threads
    #[command(display_order = 1)]
    Cli {
        #[command(subcommand)]
        cmd: CliCommands,
    },
    /// Manage provider credentials in ~/.jan/config.toml (used by the TUI and CLI)
    #[command(display_order = 2)]
    Config {
        #[command(subcommand)]
        cmd: AgentConfigCommands,
    },
}

/// The non-interactive command surface, reached via `jan cli <command>`.
#[derive(Subcommand)]
enum CliCommands {
    /// List and inspect conversation threads saved by the Jan app
    #[command(display_order = 10)]
    Threads {
        #[command(subcommand)]
        cmd: ThreadsCommands,
    },
    /// List models installed in the Jan data folder
    #[command(display_order = 11)]
    Models {
        #[command(subcommand)]
        cmd: ModelsCommands,
    },
    /// Run folder-based agents against local or cloud models
    #[command(display_order = 12)]
    Agent {
        #[command(subcommand)]
        cmd: AgentCommands,
    },
}

// ── Agent subcommands ──────────────────────────────────────────────────────

/// Cloud/local credential source shared by `agent run/step/status`. Overrides
/// the persisted desktop provider store; env vars fill any remaining gaps.
#[derive(Args)]
struct ProviderArgs {
    /// Target a single provider (e.g. anthropic); required to synthesize creds from flags alone
    #[arg(long)]
    provider: Option<String>,
    /// API key for the target provider (else JAN_API_KEY / <PROVIDER>_API_KEY)
    #[arg(long)]
    api_key: Option<String>,
}

impl ProviderArgs {
    fn into_overrides(self) -> ProviderOverrides {
        // Default the target provider to the desktop app's current selection so
        // env-key fallback (<PROVIDER>_API_KEY) works without an explicit flag.
        let provider = self
            .provider
            .or_else(|| app_lib::core::cli::providers::desktop_selection().provider);
        ProviderOverrides {
            provider,
            api_key: self.api_key,
        }
        .with_env()
    }
}

#[derive(Subcommand)]
enum AgentCommands {
    /// Run the agent loop to completion or the turn/token budget
    Run {
        /// Project root containing .jan/agent/agent.toml
        #[arg(long, default_value = ".")]
        project: String,
        /// The task/prompt for the agent
        task: String,
        /// Model ID (overrides [agent].model in agent.toml)
        #[arg(long)]
        model: Option<String>,
        /// Max turns (overrides [agent].max_turns; clamped 1..=400)
        #[arg(long)]
        max_turns: Option<u32>,
        /// Disable the sandbox and auto-approve every tool call (no prompts)
        #[arg(long)]
        yolo: bool,
        #[command(flatten)]
        providers: ProviderArgs,
    },
    /// Run a single turn (debugging)
    Step {
        /// Project root containing .jan/agent/agent.toml
        #[arg(long, default_value = ".")]
        project: String,
        /// The task/prompt for the agent
        task: String,
        /// Model ID (overrides [agent].model in agent.toml)
        #[arg(long)]
        model: Option<String>,
        /// Disable the sandbox and auto-approve every tool call (no prompts)
        #[arg(long)]
        yolo: bool,
        #[command(flatten)]
        providers: ProviderArgs,
    },
    /// Print resolved project config and available providers as JSON
    Status {
        /// Project root containing .jan/agent/agent.toml
        #[arg(long, default_value = ".")]
        project: String,
        #[command(flatten)]
        providers: ProviderArgs,
    },
}

/// Read/write the user-wide `~/.jan/config.toml` provider store. This is the
/// self-sufficient config surface for a standalone Jan Agent: every command is
/// headless and persists across runs.
#[derive(Subcommand)]
enum AgentConfigCommands {
    /// Set or update a provider's API key, base URL, models, or API type
    Set {
        /// Provider id (e.g. openai, anthropic, groq)
        #[arg(long)]
        provider: String,
        /// API key for the provider
        #[arg(long)]
        api_key: Option<String>,
        /// Base URL (e.g. https://api.openai.com/v1)
        #[arg(long)]
        base_url: Option<String>,
        /// Model id to expose (repeatable; replaces any existing list)
        #[arg(long = "model")]
        models: Vec<String>,
        /// Wire API type (e.g. openai, anthropic); defaults to OpenAI-compatible
        #[arg(long)]
        api_type: Option<String>,
    },
    /// Remove a provider entry
    Unset {
        /// Provider id to remove
        #[arg(long)]
        provider: String,
    },
    /// List configured providers as JSON (API keys redacted)
    List,
    /// Print the config file path (scaffolding a template if absent)
    Path,
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

// ── Models subcommands ─────────────────────────────────────────────────────

#[derive(Subcommand)]
enum ModelsCommands {
    /// Print all installed models as JSON (from the Jan data folder)
    List {
        /// Filter by engine: llamacpp, mlx, or all
        #[arg(long, default_value = "all")]
        engine: String,
    },
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
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or(if verbose {
        "info"
    } else {
        "warn"
    }))
    .init();

    // Inject the logo at runtime so we can use ANSI styling.
    let logo = make_logo();
    let matches = Cli::command()
        .before_help(logo.clone())
        .before_long_help(logo)
        .get_matches();
    let cli = Cli::from_arg_matches(&matches).unwrap_or_else(|e| e.exit());

    let Some(command) = cli.command else {
        let overrides = cli.providers.into_overrides();
        if let Err(e) = cli_agent_ui(
            &cli.project,
            cli.task,
            cli.model,
            cli.max_turns,
            cli.images,
            overrides,
            cli.yolo,
        )
        .await
        {
            eprintln!("Error: {e}");
            std::process::exit(1);
        }
        return;
    };

    match command {
        Commands::Cli { cmd } => handle_cli(cmd).await,
        Commands::Config { cmd } => {
            if let Err(e) = handle_agent_config(cmd) {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
        }
    }
}

// ── CLI dispatch ─────────────────────────────────────────────────────────

async fn handle_cli(cmd: CliCommands) {
    match cmd {
        CliCommands::Threads { cmd } => handle_threads(cmd).await,
        CliCommands::Models { cmd } => handle_models(cmd).await,
        CliCommands::Agent { cmd } => handle_agent(cmd).await,
    }
}

// ── Agent handlers ───────────────────────────────────────────────────────

async fn handle_agent(cmd: AgentCommands) {
    let result = match cmd {
        AgentCommands::Run {
            project,
            task,
            model,
            max_turns,
            yolo,
            providers,
        } => {
            cli_agent_run(
                &project,
                &task,
                model,
                max_turns,
                providers.into_overrides(),
                yolo,
            )
            .await
        }
        AgentCommands::Step {
            project,
            task,
            model,
            yolo,
            providers,
        } => cli_agent_step(&project, &task, model, providers.into_overrides(), yolo).await,
        AgentCommands::Status { project, providers } => {
            match cli_agent_status(&project, &providers.into_overrides()) {
                Ok(status) => {
                    println!("{}", serde_json::to_string_pretty(&status).unwrap());
                    Ok(())
                }
                Err(e) => Err(e),
            }
        }
    };
    if let Err(e) = result {
        eprintln!("Error: {e}");
        std::process::exit(1);
    }
}

fn handle_agent_config(cmd: AgentConfigCommands) -> Result<(), String> {
    match cmd {
        AgentConfigCommands::Set {
            provider,
            api_key,
            base_url,
            models,
            api_type,
        } => {
            let models = (!models.is_empty()).then_some(models);
            let path = cli_agent_config_set(&provider, api_key, base_url, models, api_type)?;
            println!("Updated provider '{provider}' in {}", path.display());
            Ok(())
        }
        AgentConfigCommands::Unset { provider } => {
            if cli_agent_config_unset(&provider)? {
                println!("Removed provider '{provider}'");
            } else {
                println!("Provider '{provider}' was not configured");
            }
            Ok(())
        }
        AgentConfigCommands::List => {
            let list = cli_agent_config_list()?;
            println!("{}", serde_json::to_string_pretty(&list).unwrap());
            Ok(())
        }
        AgentConfigCommands::Path => {
            let path = cli_agent_config_path()?;
            println!("{}", path.display());
            Ok(())
        }
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
    }
}

