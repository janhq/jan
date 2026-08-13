//! jan — headless CLI for Jan.
//!
//! Shares the Tauri-free core logic with the Jan desktop app; talks only to
//! remote providers (no local inference, no GUI dependencies).
//! Build with: cargo build --no-default-features --features cli --bin jan

use clap::{Args, CommandFactory, FromArgMatches, Parser, Subcommand};
use console::Style;

// Import the library crate so we can access core modules.
// The lib target is named "app_lib" (see [lib] section in Cargo.toml).
use app_lib::core::cli::providers::{load_provider_configs, ProviderOverrides};
use app_lib::core::cli::run_report::OutputFormat;
use app_lib::core::cli::{
    cli_agent_config_list, cli_agent_config_path, cli_agent_config_set, cli_agent_config_unset,
    cli_agent_run, cli_agent_status, cli_agent_step, cli_agent_ui, cli_delete_thread,
    cli_get_thread, cli_list_messages, cli_list_threads, ResumeTarget,
};

// ── Top-level CLI ──────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(
    name = "jan",
    about = "Chat with AI models in an interactive agent console",
    long_about = "Running `jan` with no arguments opens the interactive agent console (TUI),\n\
where you chat with a model that can run tools in your project.\n\n\
The `jan cli` subcommand is the non-interactive fallback: run folder-based\n\
agents headlessly and manage threads and providers.\n\n\
Models are served by remote providers configured in ~/.jan/config.toml\n\
(see `jan config set`), a project's agent.toml, or the Jan desktop app.",
    after_help = "Examples:\n  \
  jan                                                    # open the interactive agent console (TUI)\n  \
  jan --safe                                             # TUI that asks before writes and commands\n  \
  jan --task \"fix the failing test\"                      # seed the TUI with a first message\n  \
  jan -c                                                 # resume the most recent session\n  \
  jan --resume 3f7a91c2                                  # resume a session by id (or id prefix)\n  \
  jan cli agent run \"fix the failing test\"               # run the agent non-interactively\n  \
  jan cli models list                                    # show every configured provider model\n  \
  jan cli threads list                                   # list saved conversation threads\n  \
  jan update                                             # install the latest build of this channel"
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
    /// Image file to attach to the first message, repeatable (bare TUI only)
    #[arg(long = "image")]
    images: Vec<String>,
    #[command(flatten)]
    providers: ProviderArgs,
    /// Prompt for approval before writes, shell commands, and MCP tool calls in
    /// the default agent TUI. Ignored when a subcommand is given.
    #[arg(long)]
    safe: bool,
    #[command(flatten)]
    resume: ResumeArgs,
    /// Start the default agent TUI in read-only plan mode (same as /plan).
    /// Ignored when a subcommand is given.
    #[arg(long)]
    plan: bool,
}

/// Session-resume selection, shared by the bare TUI and `jan cli agent run`.
/// Threads are per-project (`<project>/.jan/agent/threads`), so resuming from a
/// different working directory simply finds nothing there.
#[derive(Args)]
struct ResumeArgs {
    /// Resume a saved session: the most recent one, or the thread whose id starts with ID
    #[arg(long, num_args = 0..=1, value_name = "ID")]
    resume: Option<Option<String>>,
    /// Resume the most recent session (alias for a bare --resume)
    #[arg(long = "continue", short = 'c', conflicts_with = "resume")]
    continue_session: bool,
}

impl ResumeArgs {
    fn into_target(self) -> Option<ResumeTarget> {
        ResumeTarget::from_flags(self.resume, self.continue_session)
    }
}

/// Same flags for `jan cli agent run`, which has a required positional TASK: a
/// space-separated `--resume ID` would swallow the task, so the value form must
/// be written `--resume=ID`.
#[derive(Args)]
struct ResumeRunArgs {
    /// Resume a saved session: the most recent one, or (as --resume=ID) the thread whose id starts with ID
    #[arg(long, num_args = 0..=1, require_equals = true, value_name = "ID")]
    resume: Option<Option<String>>,
    /// Resume the most recent session (alias for a bare --resume)
    #[arg(long = "continue", short = 'c', conflicts_with = "resume")]
    continue_session: bool,
}

impl ResumeRunArgs {
    fn into_target(self) -> Option<ResumeTarget> {
        ResumeTarget::from_flags(self.resume, self.continue_session)
    }
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
    /// Sign in to Tokamak and save the API key to ~/.jan/config.toml
    #[command(display_order = 2)]
    Login,
    /// Manage provider credentials in ~/.jan/config.toml (used by the TUI and CLI)
    #[command(display_order = 3)]
    Config {
        #[command(subcommand)]
        cmd: AgentConfigCommands,
    },
    /// Update this binary to the latest build of the channel it was built for
    #[command(display_order = 4)]
    Update {
        /// Report whether an update exists without installing it
        #[arg(long)]
        check: bool,
        /// Reinstall even when already on the latest version
        #[arg(long, conflicts_with = "check")]
        force: bool,
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
    /// List the models exposed by the configured providers
    #[command(display_order = 11)]
    Models {
        #[command(subcommand)]
        cmd: ModelsCommands,
    },
    /// Run folder-based agents against a configured provider's models
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
    /// Run the agent loop to completion or the session token budget
    Run {
        /// Project root containing .jan/agent/agent.toml
        #[arg(long, default_value = ".")]
        project: String,
        /// The task/prompt for the agent
        task: String,
        /// Model ID (overrides [agent].model in agent.toml)
        #[arg(long)]
        model: Option<String>,
        /// Prompt for approval before writes, shell commands, and MCP tool calls
        #[arg(long)]
        safe: bool,
        #[command(flatten)]
        providers: ProviderArgs,
        #[command(flatten)]
        resume: ResumeRunArgs,
        /// `text` streams the answer as it arrives; `json` prints one result
        /// object on stdout when the run finishes
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        output_format: OutputFormat,
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
        /// Prompt for approval before writes, shell commands, and MCP tool calls
        #[arg(long)]
        safe: bool,
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
    /// Print every configured provider's models as JSON (API keys redacted)
    List {
        /// Only show models from this provider (e.g. anthropic)
        #[arg(long)]
        provider: Option<String>,
        /// Project root whose agent.toml [provider] override is applied
        #[arg(long, default_value = ".")]
        project: String,
    },
}

// ── ASCII logo ─────────────────────────────────────────────────────────────

/// Build a left-aligned, bright-yellow ASCII logo for the help header.
fn make_logo() -> String {
    let yellow = Style::new().yellow().bold();
    let mut out = vec![String::new(), String::new()];
    for l in app_lib::core::cli::brand::LOGO {
        out.push(format!("  {}", yellow.apply_to(l)));
    }
    out.join("\n")
}

// ── Entry point ────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    // Exits early if invoked as the Windows sandbox helper for a `bash` tool
    // call: the helper's only job is to spawn the confined shell and wait, so it
    // must run before anything else -- starting the app first would run a second
    // copy per shell command.
    tauri_plugin_agent_tools::run_sandbox_helper_if_requested();

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
        .version(app_lib::core::cli::updater::build_version())
        .before_help(logo.clone())
        .before_long_help(logo)
        .get_matches();
    let cli = Cli::from_arg_matches(&matches).unwrap_or_else(|e| e.exit());

    let Some(command) = cli.command else {
        // No stderr notice on this path: the TUI's alternate screen would wipe
        // it, and blocking on the check here would delay the first frame. The
        // TUI runs the same check itself and notes it in the transcript.
        let overrides = cli.providers.into_overrides();
        if let Err(e) = cli_agent_ui(
            &cli.project,
            cli.task,
            cli.model,
            cli.images,
            overrides,
            !cli.safe,
            cli.plan,
            cli.resume.into_target(),
        )
        .await
        {
            eprintln!("Error: {e}");
            std::process::exit(1);
        }
        return;
    };

    // `jan update` reports the same thing itself, in more detail.
    if !matches!(command, Commands::Update { .. }) {
        app_lib::core::cli::updater::print_update_notice_if_available().await;
    }

    match command {
        Commands::Cli { cmd } => handle_cli(cmd).await,
        Commands::Login => {
            if let Err(e) = app_lib::core::cli::login::run_login().await {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
        }
        Commands::Config { cmd } => {
            if let Err(e) = handle_agent_config(cmd) {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
        }
        Commands::Update { check, force } => handle_update(check, force).await,
    }
}

// ── Update handler ─────────────────────────────────────────────────────────

async fn handle_update(check: bool, force: bool) {
    use app_lib::core::cli::updater::{self, UpdateOutcome};

    let result = if check {
        updater::check_for_update(std::time::Duration::from_secs(10))
            .await
            .map(|u| {
                if u.is_newer() {
                    println!("{}", u.summary());
                } else {
                    println!("Already on the latest {} build ({})", u.channel, u.current);
                }
            })
    } else {
        updater::self_update(force)
            .await
            .map(|outcome| match outcome {
                UpdateOutcome::UpToDate { version } => {
                    println!("Already up to date ({version})");
                }
                UpdateOutcome::Installed { from, to, path } => {
                    println!("Updated {} from {from} to {to}", path.display());
                }
            })
    };
    if let Err(e) = result {
        eprintln!("Error: {e}");
        std::process::exit(1);
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
            safe,
            providers,
            resume,
            output_format,
        } => {
            cli_agent_run(
                &project,
                &task,
                model,
                providers.into_overrides(),
                !safe,
                resume.into_target(),
                output_format,
            )
            .await
        }
        AgentCommands::Step {
            project,
            task,
            model,
            safe,
            providers,
        } => cli_agent_step(&project, &task, model, providers.into_overrides(), !safe).await,
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
        ModelsCommands::List { provider, project } => {
            let configs = match load_provider_configs(
                Some(std::path::Path::new(&project)),
                &ProviderOverrides::default().with_env(),
            ) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Error: {e}");
                    std::process::exit(1);
                }
            };
            let mut output: Vec<serde_json::Value> = configs
                .values()
                .filter(|c| app_lib::core::cli::providers::is_cli_reachable(c))
                .filter(|c| provider.as_ref().is_none_or(|p| &c.provider == p))
                .flat_map(|c| {
                    c.models.iter().map(move |m| {
                        serde_json::json!({
                            "id": m,
                            "provider": c.provider,
                            "base_url": c.base_url,
                            "api_type": c.api_type,
                            "has_api_key": !c.bearer_key_chain().is_empty(),
                        })
                    })
                })
                .collect();
            output.sort_by(|a, b| {
                (a["provider"].as_str(), a["id"].as_str())
                    .cmp(&(b["provider"].as_str(), b["id"].as_str()))
            });
            println!("{}", serde_json::to_string_pretty(&output).unwrap());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // `--plan` is a per-invocation startup toggle mirroring `--safe`; it must
    // parse on the top-level `jan` command and default off.
    #[test]
    fn top_level_plan_flag_parses() {
        let cli = Cli::parse_from(["jan", "--plan"]);
        assert!(cli.plan);
        assert!(!cli.safe);
        assert!(cli.command.is_none());

        let cli = Cli::parse_from(["jan"]);
        assert!(!cli.plan);
    }

    // Permission prompts are opt-in: auto-approval inside the OS sandbox is the
    // default, and `--safe` is what turns the gate back on.
    #[test]
    fn safe_flag_parses_and_defaults_off() {
        assert!(!Cli::parse_from(["jan"]).safe);
        assert!(Cli::parse_from(["jan", "--safe"]).safe);
    }

    /// Parse `jan cli agent run <task> <extra...>` and pull out its output format.
    fn parsed_output_format(extra: &[&str]) -> OutputFormat {
        let mut argv = vec!["jan", "cli", "agent", "run", "task"];
        argv.extend_from_slice(extra);
        match Cli::parse_from(argv).command {
            Some(Commands::Cli {
                cmd:
                    CliCommands::Agent {
                        cmd: AgentCommands::Run { output_format, .. },
                    },
            }) => output_format,
            _ => panic!("expected `cli agent run`"),
        }
    }

    #[test]
    fn output_format_parses_and_defaults_to_text() {
        assert_eq!(parsed_output_format(&[]), OutputFormat::Text);
        assert_eq!(
            parsed_output_format(&["--output-format", "json"]),
            OutputFormat::Json
        );
        assert_eq!(
            parsed_output_format(&["--output-format=text"]),
            OutputFormat::Text
        );
        assert!(Cli::try_parse_from([
            "jan",
            "cli",
            "agent",
            "run",
            "task",
            "--output-format",
            "yaml"
        ])
        .is_err());
    }

    #[test]
    fn update_command_parses() {
        let cli = Cli::parse_from(["jan", "update"]);
        assert!(matches!(
            cli.command,
            Some(Commands::Update {
                check: false,
                force: false
            })
        ));
        let cli = Cli::parse_from(["jan", "update", "--check"]);
        assert!(matches!(
            cli.command,
            Some(Commands::Update { check: true, .. })
        ));
        assert!(Cli::try_parse_from(["jan", "update", "--check", "--force"]).is_err());
    }

    #[test]
    fn login_command_parses_and_takes_no_args() {
        let cli = Cli::parse_from(["jan", "login"]);
        assert!(matches!(cli.command, Some(Commands::Login)));
        assert!(Cli::try_parse_from(["jan", "login", "sk-key"]).is_err());
    }
}
