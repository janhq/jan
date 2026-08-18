//! jan — headless CLI for Jan.
//!
//! Shares the Tauri-free core logic with the Jan desktop app; talks only to
//! remote providers (no local inference, no GUI dependencies).
//! Build with: cargo build --no-default-features --features cli --bin jan

use clap::{Args, CommandFactory, FromArgMatches, Parser, Subcommand};
use console::Style;

// Import the library crate so we can access core modules.
// The lib target is named "app_lib" (see [lib] section in Cargo.toml).
use app_lib::core::agent::plugins::InstalledPlugin;
use app_lib::core::cli::providers::{load_provider_configs, ProviderOverrides};
use app_lib::core::cli::mcp::{self, split_kv, McpServerEntry};
use app_lib::core::cli::run_report::OutputFormat;
use app_lib::core::cli::{
    cli_agent_config_list, cli_agent_config_path, cli_agent_config_set, cli_agent_config_unset,
    cli_agent_run, cli_agent_status, cli_agent_step, cli_agent_ui, cli_delete_thread,
    cli_get_thread, cli_list_messages, cli_list_threads, cli_plugin_install, cli_plugin_list,
    cli_plugin_remove, cli_plugin_search, ResumeTarget, SessionFlags,
};
use std::fmt::Write as _;

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
(see `jan config set`), a project's agent.toml, or the Jan desktop app.\n\n\
Once every 24h this sends an anonymous usage ping (version, OS/arch, a random\n\
install id) to the same endpoint as the update check. Set JAN_CLI_NO_UPDATE_CHECK\n\
to opt out of both.",
    after_help = "Examples:\n  \
  jan                                                    # open the interactive agent console (TUI)\n  \
  jan --safe                                             # TUI that asks before writes and commands\n  \
  jan --task \"fix the failing test\"                      # seed the TUI with a first message\n  \
  jan -c                                                 # resume the most recent session\n  \
  jan --resume 3f7a91c2                                  # resume a session by id (or id prefix)\n  \
  jan cli agent run \"fix the failing test\"               # run the agent non-interactively\n  \
  jan cli models list                                    # show every configured provider model\n  \
  jan cli threads list                                   # list saved conversation threads\n  \
  jan cli mcp list                                      # list configured MCP servers\n  \
  jan cli mcp add my-server --command npx --arg -y --arg my-mcp \n  \
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
    #[command(flatten)]
    sandbox: SandboxArgs,
}

/// Whether this invocation confines the shell, shared by every surface that
/// starts an agent.
///
/// Two flags rather than one because the setting is also persistent
/// (`sandbox` in `~/.jan/config.toml`, `[tools].sandbox` in agent.toml): with
/// only `--sandbox` there would be no way to run unconfined once, and a user who
/// turned it on permanently would have to edit a file to get out of it.
#[derive(Args, Clone, Copy)]
struct SandboxArgs {
    /// Run shell commands under OS confinement (bubblewrap, Seatbelt, AppContainer)
    #[arg(long)]
    sandbox: bool,
    /// Run shell commands unconfined, overriding a persistent sandbox setting
    #[arg(long, conflicts_with = "sandbox")]
    no_sandbox: bool,
}

impl SandboxArgs {
    /// `None` when neither flag was passed, so the config files decide.
    fn into_flag(self) -> Option<bool> {
        match (self.sandbox, self.no_sandbox) {
            (true, _) => Some(true),
            (_, true) => Some(false),
            _ => None,
        }
    }
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
    /// Manage project-local plugins and their skills
    #[command(display_order = 4)]
    Plugin {
        #[command(subcommand)]
        cmd: PluginCommands,
    },
    /// Update this binary to the latest build of the channel it was built for
    #[command(display_order = 5)]
    Update {
        /// Report whether an update exists without installing it
        #[arg(long)]
        check: bool,
        /// Reinstall even when already on the latest version
        #[arg(long, conflicts_with = "check")]
        force: bool,
    },
}

#[derive(Subcommand)]
enum PluginCommands {
    /// List plugins installed in a project
    List {
        #[arg(long, default_value = ".")]
        project: String,
        /// Print complete plugin metadata as JSON
        #[arg(long)]
        json: bool,
    },
    /// Install a git URL or marketplace plugin
    Install {
        spec: String,
        #[arg(long, default_value = ".")]
        project: String,
    },
    /// Remove an installed plugin by name
    Remove {
        name: String,
        #[arg(long, default_value = ".")]
        project: String,
    },
    /// Search the configured plugin marketplace
    Search {
        query: Option<String>,
        #[arg(long, default_value = ".")]
        project: String,
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
    /// List and manage MCP servers in mcp_config.json
    #[command(display_order = 13)]
    Mcp {
        #[command(subcommand)]
        cmd: McpCommands,
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
        sandbox: SandboxArgs,
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
        #[command(flatten)]
        sandbox: SandboxArgs,
    },
    /// Print resolved project config and available providers as JSON
    Status {
        /// Project root containing .jan/agent/agent.toml
        #[arg(long, default_value = ".")]
        project: String,
        #[command(flatten)]
        providers: ProviderArgs,
    },
    /// Manage standalone provider credentials in ~/.jan/config.toml (no Desktop needed)
    Config {
        #[command(subcommand)]
        cmd: AgentConfigCommands,
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

// ── MCP subcommands ────────────────────────────────────────────────────────

/// Manage MCP servers in the shared <jan_data>/mcp_config.json, the same store
/// the desktop app and the TUI `/mcp` picker read. Every command is headless
/// and persists across runs.
#[derive(Subcommand)]
enum McpCommands {
    /// List every configured server as JSON, excluding the desktop-only browser bridge
    List {
        /// Show env/header values (they may contain secrets); redacted by default
        #[arg(long)]
        show_secrets: bool,
    },
    /// Print a single server's full config as JSON
    Get {
        /// Server name
        name: String,
    },
    /// Add a server, or replace an existing one with the same name (edit)
    Add {
        /// Server name (the key in mcpServers)
        name: String,
        /// Command for a stdio server (e.g. npx, uvx)
        #[arg(long)]
        command: Option<String>,
        /// Argument for the command, repeatable
        #[arg(long = "arg", allow_hyphen_values = true)]
        args: Vec<String>,
        /// Environment variable KEY=VALUE for a stdio server, repeatable
        #[arg(long = "env")]
        env: Vec<String>,
        /// Transport type: stdio (default), http, or sse
        #[arg(long, default_value = "stdio")]
        r#type: String,
        /// URL for an http/sse server (required unless stdio)
        #[arg(long)]
        url: Option<String>,
        /// Header KEY=VALUE for an http/sse server, repeatable
        #[arg(long = "header")]
        header: Vec<String>,
        /// Mark the server active immediately; defaults to inactive
        #[arg(long)]
        active: bool,
    },
    /// Remove a server entry from mcp_config.json
    Remove {
        /// Server name
        name: String,
    },
    /// Mark a server active (so the next session connects it)
    Enable {
        /// Server name
        name: String,
    },
    /// Mark a server inactive
    Disable {
        /// Server name
        name: String,
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

    app_lib::core::cli::updater::print_update_notice_if_available().await;

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
        // The usage ping is likewise deferred to the TUI's own background task.
        let overrides = cli.providers.into_overrides();
        if let Err(e) = cli_agent_ui(
            &cli.project,
            cli.task,
            cli.model,
            cli.images,
            overrides,
            SessionFlags {
                auto_approve: !cli.safe,
                plan: cli.plan,
                sandbox: cli.sandbox.into_flag(),
                ..Default::default()
            },
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
    // Awaited (not spawned): a short-lived `jan cli ...` invocation can exit
    // before a detached background task gets to run. See `telemetry::ping_if_due`
    // for what this sends and `JAN_CLI_NO_UPDATE_CHECK` to opt out.
    app_lib::core::cli::telemetry::ping_if_due().await;

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
        Commands::Plugin { cmd } => handle_plugin(cmd).await,
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

async fn handle_plugin(cmd: PluginCommands) {
    let result = match cmd {
        PluginCommands::List { project, json } => {
            let plugins = cli_plugin_list(&project);
            if json {
                println!("{}", serde_json::to_string_pretty(&plugins).unwrap());
            } else {
                print!("{}", format_plugin_list(&plugins));
            }
            Ok(())
        }
        PluginCommands::Install { spec, project } => cli_plugin_install(&project, &spec)
            .await
            .map(|plugin| println!("{}", serde_json::to_string_pretty(&plugin).unwrap())),
        PluginCommands::Remove { name, project } => {
            cli_plugin_remove(&project, &name).map(|()| println!("Removed plugin '{name}'"))
        }
        PluginCommands::Search { query, project } => {
            cli_plugin_search(&project, query.as_deref().unwrap_or(""))
                .await
                .map(|entries| println!("{}", serde_json::to_string_pretty(&entries).unwrap()))
        }
    };
    if let Err(e) = result {
        eprintln!("Error: {e}");
        std::process::exit(1);
    }
}

fn format_plugin_list(plugins: &[InstalledPlugin]) -> String {
    if plugins.is_empty() {
        return "No plugins installed.\n".into();
    }

    let name_width = plugins
        .iter()
        .map(|plugin| plugin.name.len())
        .max()
        .unwrap_or(0)
        .max("PLUGIN".len());
    let version_width = plugins
        .iter()
        .map(|plugin| plugin.version.len())
        .max()
        .unwrap_or(0)
        .max("VERSION".len());
    let skills_width = plugins
        .iter()
        .map(|plugin| plugin.skills.to_string().len())
        .max()
        .unwrap_or(0)
        .max("SKILLS".len());
    let commands_width = plugins
        .iter()
        .map(|plugin| plugin.commands.to_string().len())
        .max()
        .unwrap_or(0)
        .max("COMMANDS".len());
    let agents_width = plugins
        .iter()
        .map(|plugin| plugin.agents.to_string().len())
        .max()
        .unwrap_or(0)
        .max("AGENTS".len());

    let mut output = String::new();
    writeln!(
        output,
        "{:<name_width$}  {:<version_width$}  {:>skills_width$}  {:>commands_width$}  {:>agents_width$}",
        "PLUGIN", "VERSION", "SKILLS", "COMMANDS", "AGENTS"
    )
    .unwrap();
    for plugin in plugins {
        writeln!(
            output,
            "{:<name_width$}  {:<version_width$}  {:>skills_width$}  {:>commands_width$}  {:>agents_width$}",
            plugin.name, plugin.version, plugin.skills, plugin.commands, plugin.agents
        )
        .unwrap();
    }
    output
}

// ── CLI dispatch ─────────────────────────────────────────────────────────

async fn handle_cli(cmd: CliCommands) {
    match cmd {
        CliCommands::Threads { cmd } => handle_threads(cmd).await,
        CliCommands::Models { cmd } => handle_models(cmd).await,
        CliCommands::Agent { cmd } => handle_agent(cmd).await,
        CliCommands::Mcp { cmd } => {
            if let Err(e) = handle_mcp(cmd) {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
        }
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
            sandbox,
            resume,
            output_format,
        } => {
            cli_agent_run(
                &project,
                &task,
                model,
                providers.into_overrides(),
                SessionFlags {
                    auto_approve: !safe,
                    sandbox: sandbox.into_flag(),
                    ..Default::default()
                },
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
            sandbox,
        } => {
            cli_agent_step(
                &project,
                &task,
                model,
                providers.into_overrides(),
                SessionFlags {
                    auto_approve: !safe,
                    sandbox: sandbox.into_flag(),
                    ..Default::default()
                },
            )
            .await
        }
        AgentCommands::Status { project, providers } => {
            match cli_agent_status(&project, &providers.into_overrides()) {
                Ok(status) => {
                    println!("{}", serde_json::to_string_pretty(&status).unwrap());
                    Ok(())
                }
                Err(e) => Err(e),
            }
        }
        AgentCommands::Config { cmd } => handle_agent_config(cmd),
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

/// Render one server entry for `list`: transport summary plus (redacted by
/// default) env/header keys. Secret values are masked unless `--show-secrets`.
fn mcp_list_entry(entry: &McpServerEntry, show_secrets: bool) -> serde_json::Value {
    let cfg = &entry.config;
    let transport_type = cfg.get("type").and_then(serde_json::Value::as_str);
    let redact = |v: &serde_json::Value| -> serde_json::Value {
        if show_secrets {
            v.clone()
        } else {
            serde_json::Value::String("<redacted>".to_string())
        }
    };
    let redact_map = |m: Option<&serde_json::Map<String, serde_json::Value>>| -> serde_json::Value {
        match m {
            Some(map) => {
                let out: serde_json::Map<String, serde_json::Value> = map
                    .iter()
                    .map(|(k, v)| (k.clone(), redact(v)))
                    .collect();
                serde_json::Value::Object(out)
            }
            None => serde_json::json!({}),
        }
    };
    serde_json::json!({
        "name": entry.name,
        "active": entry.active,
        "type": transport_type.unwrap_or("stdio"),
        "command": cfg.get("command").and_then(serde_json::Value::as_str).unwrap_or(""),
        "args": cfg.get("args").cloned().unwrap_or_else(|| serde_json::json!([])),
        "url": cfg.get("url").cloned().unwrap_or(serde_json::Value::Null),
        "env": redact_map(cfg.get("env").and_then(serde_json::Value::as_object)),
        "headers": redact_map(cfg.get("headers").and_then(serde_json::Value::as_object)),
    })
}

/// Manage MCP servers in mcp_config.json.
fn handle_mcp(cmd: McpCommands) -> Result<(), String> {
    match cmd {
        McpCommands::List { show_secrets } => {
            let servers = mcp::list_servers();
            let out: Vec<serde_json::Value> = servers
                .iter()
                .map(|s| mcp_list_entry(s, show_secrets))
                .collect();
            println!("{}", serde_json::to_string_pretty(&out).unwrap());
            Ok(())
        }
        McpCommands::Get { name } => match mcp::get_server(&name) {
            Some(entry) => {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&mcp_list_entry(&entry, true)).unwrap()
                );
                Ok(())
            }
            None => Err(format!("server '{name}' not found")),
        },
        McpCommands::Add {
            name,
            command,
            args,
            env,
            r#type,
            url,
            header,
            active,
        } => {
            let config = build_mcp_config(command, args, env, &r#type, url, header, active)?;
            mcp::upsert_server(&name, &config)?;
            println!("saved server '{name}' to mcp_config.json");
            Ok(())
        }
        McpCommands::Remove { name } => {
            mcp::remove_server(&name)?;
            println!("removed server '{name}' from mcp_config.json");
            Ok(())
        }
        McpCommands::Enable { name } => {
            mcp::set_active(&name, true)?;
            println!("enabled server '{name}'");
            Ok(())
        }
        McpCommands::Disable { name } => {
            mcp::set_active(&name, false)?;
            println!("disabled server '{name}'");
            Ok(())
        }
    }
}

/// Build the server config object for `mcp add` from the CLI flags. Funnels
/// through the shared `core::cli::mcp::build_server_config` so the TUI form and
/// the headless flags can never diverge on the config shape or validation.
fn build_mcp_config(
    command: Option<String>,
    args: Vec<String>,
    env: Vec<String>,
    r#type: &str,
    url: Option<String>,
    header: Vec<String>,
    active: bool,
) -> Result<serde_json::Value, String> {
    let mut env_map = serde_json::Map::new();
    for kv in &env {
        let (k, v) = split_kv(kv, "env")?;
        env_map.insert(k, serde_json::json!(v));
    }
    let mut header_map = serde_json::Map::new();
    for kv in &header {
        let (k, v) = split_kv(kv, "header")?;
        header_map.insert(k, serde_json::json!(v));
    }
    mcp::build_server_config(
        r#type,
        command.as_deref(),
        args,
        env_map,
        url.as_deref(),
        header_map,
        active,
    )
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

    /// Parse a `jan cli mcp <cmd> <extra...>` argv and pull out the subcommand.
    fn parsed_mcp(extra: &[&str]) -> McpCommands {
        let mut argv = vec!["jan", "cli", "mcp"];
        argv.extend_from_slice(extra);
        match Cli::parse_from(argv).command {
            Some(Commands::Cli { cmd: CliCommands::Mcp { cmd } }) => cmd,
            _ => panic!("expected `cli mcp`"),
        }
    }

    #[test]
    fn mcp_list_parses_and_redacts_by_default() {
        let cmd = parsed_mcp(&["list"]);
        assert!(matches!(cmd, McpCommands::List { show_secrets: false }));
        let cmd = parsed_mcp(&["list", "--show-secrets"]);
        assert!(matches!(cmd, McpCommands::List { show_secrets: true }));
    }

    #[test]
    fn mcp_add_parses_stdio_fields() {
        let cmd = parsed_mcp(&[
            "add",
            "files",
            "--command",
            "npx",
            "--arg",
            "-y",
            "--arg",
            "my-mcp",
            "--env",
            "K=V",
            "--active",
        ]);
        match cmd {
            McpCommands::Add {
                name,
                command,
                args,
                env,
                r#type,
                url,
                header,
                active,
            } => {
                assert_eq!(name, "files");
                assert_eq!(command.as_deref(), Some("npx"));
                assert_eq!(args, vec!["-y", "my-mcp"]);
                assert_eq!(env, vec!["K=V"]);
                assert_eq!(r#type, "stdio");
                assert!(url.is_none());
                assert!(header.is_empty());
                assert!(active);
            }
            _ => panic!("expected add"),
        }
    }

    #[test]
    fn mcp_build_rejects_http_without_url() {
        let err = build_mcp_config(None, vec![], vec![], "http", None, vec![], false).unwrap_err();
        assert!(err.contains("url"), "{err}");
        let err = build_mcp_config(None, vec![], vec![], "sse", None, vec![], false).unwrap_err();
        assert!(err.contains("url"), "{err}");
        assert!(build_mcp_config(None, vec![], vec![], "bogus", None, vec![], false).is_err());
        // stdio needs a command.
        assert!(build_mcp_config(None, vec![], vec![], "stdio", None, vec![], false).is_err());
    }

    #[test]
    fn mcp_remove_enable_disable_take_one_name() {
        assert!(matches!(
            parsed_mcp(&["remove", "files"]),
            McpCommands::Remove { name } if name == "files"
        ));
        assert!(matches!(
            parsed_mcp(&["enable", "files"]),
            McpCommands::Enable { name } if name == "files"
        ));
        assert!(matches!(
            parsed_mcp(&["disable", "files"]),
            McpCommands::Disable { name } if name == "files"
        ));
    }
    #[test]
    fn plugin_list_defaults_to_compact_output_and_supports_json() {
        let cli = Cli::try_parse_from(["jan", "plugin", "list"]).unwrap();
        assert!(matches!(
            cli.command,
            Some(Commands::Plugin {
                cmd: PluginCommands::List { project, json }
            }) if project == "." && !json
        ));

        let cli = Cli::try_parse_from(["jan", "plugin", "list", "--json"]).unwrap();
        assert!(matches!(
            cli.command,
            Some(Commands::Plugin {
                cmd: PluginCommands::List { json, .. }
            }) if json
        ));
}

    #[test]
    fn split_kv_rejects_without_separator() {
        assert_eq!(split_kv("K=V", "env").unwrap(), ("K".to_string(), "V".to_string()));
        assert!(split_kv("novalue", "env").is_err());
        assert!(split_kv("=V", "header").is_err());
    }

    #[test]
    fn compact_plugin_list_omits_long_metadata() {
        let plugins = vec![
            InstalledPlugin {
                name: "alpha".into(),
                description: "A long description that should not appear".into(),
                version: "1.2.3".into(),
                repo: "https://example.com/alpha".into(),
                skills: 2,
                commands: 1,
                agents: 3,
            },
            InstalledPlugin {
                name: "beta".into(),
                description: "Another description".into(),
                version: "0.0.0".into(),
                repo: String::new(),
                skills: 0,
                commands: 0,
                agents: 0,
            },
        ];

        let output = format_plugin_list(&plugins);
        assert_eq!(output.lines().count(), 3);
        assert!(output.lines().next().unwrap().contains("PLUGIN"));
        assert!(output.lines().next().unwrap().contains("COMMANDS"));
        assert!(output.lines().next().unwrap().contains("AGENTS"));
        assert!(output.contains("alpha"));
        assert!(output.contains("1.2.3"));
        assert!(output.contains("2"));
        assert!(output.contains("1"));
        assert!(output.contains("3"));
        assert!(!output.contains("long description"));
        assert!(!output.contains("example.com"));
    }
}
