//! jan — headless CLI for Jan.
//!
//! Shares the Tauri-free core logic with the Jan desktop app; talks only to
//! remote providers (no local inference, no GUI dependencies).
//! Build with: cd src-tauri/jan-cli && cargo build --no-default-features --features cli

use clap::{Args, CommandFactory, FromArgMatches, Parser, Subcommand};
use console::Style;

// Import the library crate so we can access core modules.
// The lib target is named "app_lib" (see [lib] section in Cargo.toml).
use app_lib::core::agent::plugins::InstalledPlugin;
use app_lib::core::cli::mcp::{self, split_kv, McpServerEntry};
use app_lib::core::cli::mcp_serve::{cli_mcp_serve, ServeFlags, ServeTransport};
use app_lib::core::cli::providers::{load_provider_configs, ProviderOverrides};
use app_lib::core::cli::run_report::OutputFormat;
use app_lib::core::cli::stream_input::InputFormat;
use app_lib::core::cli::{
    cli_agent_config_list, cli_agent_config_path, cli_agent_config_set, cli_agent_config_unset,
    cli_agent_run, cli_agent_status, cli_agent_step, cli_agent_ui, cli_delete_thread,
    cli_get_thread, cli_list_messages, cli_list_threads, cli_plugin_install, cli_plugin_list,
    cli_plugin_remove, cli_plugin_search, ResumeRequest, SessionFlags,
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
  jan -c --fork-session                                  # branch the most recent session into a new one\n  \
  jan --worktree                                         # work in a dedicated git worktree, not your checkout\n  \
  jan cli agent run \"fix the failing test\"               # run the agent non-interactively\n  \
  jan cli models list                                    # show every configured provider model\n  \
  jan cli models refresh                                 # re-read every provider's model list\n  \
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
    #[command(flatten)]
    worktree: WorktreeArgs,
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

/// Whether this invocation works in its own git worktree.
///
/// Two flags for the same reason `SandboxArgs` has two: the setting is also
/// persistent (`[agent].worktree` in agent.toml, `worktree` in
/// `~/.jan/config.toml`), so there has to be a way out of it for one run.
#[derive(Args, Clone, Copy)]
struct WorktreeArgs {
    /// Work in a dedicated git worktree instead of the project directory
    #[arg(long)]
    worktree: bool,
    /// Work in the project directory, overriding a persistent worktree setting
    #[arg(long, conflicts_with = "worktree")]
    no_worktree: bool,
}

impl WorktreeArgs {
    /// `None` when neither flag was passed, so the config files decide.
    fn into_flag(self) -> Option<bool> {
        match (self.worktree, self.no_worktree) {
            (true, _) => Some(true),
            (_, true) => Some(false),
            _ => None,
        }
    }
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
    /// Open the resumed session as a new thread, leaving the original resumable
    #[arg(long)]
    fork_session: bool,
}

impl ResumeArgs {
    fn into_request(self) -> Option<ResumeRequest> {
        ResumeRequest::from_flags(self.resume, self.continue_session, self.fork_session)
    }
}

/// Per-invocation cost limits for `jan cli agent run`. All three mirror the
/// engine's own semantics: an unpassed flag leaves the config files (or, for
/// turns, nothing at all) in charge.
///
/// Two of them stop a run and one does not. `--max-turns` bounds how many turns
/// it may take, `--max-budget-usd` bounds what it may spend; the token ceiling
/// is advisory, compacting the conversation and recording a note before the run
/// continues. A money ceiling is the one a user reaching for a limit usually
/// means: turns and tokens are both proxies for the number they actually care
/// about.
#[derive(Args, Clone, Copy)]
struct BudgetArgs {
    /// Fail the run after at most N agentic turns; bounds this run only, not
    /// its subagents (0 = unbounded, the default)
    #[arg(long, value_name = "N")]
    max_turns: Option<u64>,
    /// Advisory token ceiling overriding [budget].max_tokens: triggers
    /// compaction and a note, but does not stop the run (0 = no ceiling)
    #[arg(long, value_name = "N")]
    max_session_tokens: Option<u64>,
    /// Stop the run once it has spent this much in USD, overriding
    /// [budget].max_usd. Priced from the provider's published rates, so a
    /// model with no published price is refused rather than run uncapped
    #[arg(long, value_name = "USD")]
    max_budget_usd: Option<f64>,
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
    /// Open the resumed session as a new thread, leaving the original resumable
    #[arg(long)]
    fork_session: bool,
}

impl ResumeRunArgs {
    fn into_request(self) -> Option<ResumeRequest> {
        ResumeRequest::from_flags(self.resume, self.continue_session, self.fork_session)
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
    Login {
        /// Skip the browser approval and paste an API key instead (the legacy flow)
        #[arg(long)]
        paste_token: bool,
    },
    /// Show or manage the Tokamak sign-in
    #[command(display_order = 3)]
    Auth {
        #[command(subcommand)]
        cmd: AuthCommands,
    },
    /// Read recorded usage and spend from the provider's usage API
    #[command(display_order = 4)]
    Usage {
        // Optional so bare `jan usage` answers "what have I spent" with the
        // account summary. Unlike the TUI's bare `/usage` there is no session
        // to estimate here -- a one-shot command has run no requests -- so the
        // overview's local half does not exist and the account total is the
        // whole answer.
        #[command(subcommand)]
        cmd: Option<UsageCommands>,
        /// Print the provider's response body verbatim instead of a table.
        /// Reshaping it would mean re-serializing money fields, which is how a
        /// figure loses digits, so this forwards the bytes as received.
        #[arg(long, global = true)]
        json: bool,
    },
    /// Manage provider credentials in ~/.jan/config.toml (used by the TUI and CLI)
    #[command(display_order = 5)]
    Config {
        #[command(subcommand)]
        cmd: AgentConfigCommands,
    },
    /// Manage project-local plugins and their skills
    #[command(display_order = 6)]
    Plugin {
        #[command(subcommand)]
        cmd: PluginCommands,
    },
    /// Serve Jan's built-in tools to another agent over MCP
    #[command(display_order = 7)]
    Mcp {
        #[command(subcommand)]
        cmd: McpServeCommands,
    },
    /// Update this binary to the latest build of the channel it was built for
    #[command(display_order = 8)]
    Update {
        /// Report whether an update exists without installing it
        #[arg(long)]
        check: bool,
        /// Reinstall even when already on the latest version
        #[arg(long, conflicts_with = "check")]
        force: bool,
    },
}

/// The server direction of MCP: Jan offered as a tool provider. The client
/// direction (managing the servers Jan *connects to*) stays under
/// `jan cli mcp`.
#[derive(Subcommand)]
enum McpServeCommands {
    /// Run an MCP server exposing Jan's built-in tools for one project
    Serve {
        /// Project root the served tools are confined to
        #[arg(long, default_value = ".")]
        project: String,
        /// Transport: stdio for a spawned child process, http for loopback Streamable HTTP
        #[arg(long, value_enum, default_value_t = ServeTransport::Stdio)]
        transport: ServeTransport,
        /// Also serve the mutating filesystem tools (write, edit), confined to the project root
        #[arg(long)]
        allow_write: bool,
        /// Also serve bash (runs under the same OS sandbox the agent's shell does)
        #[arg(long)]
        allow_exec: bool,
        /// Serve only these tools, repeatable; never widens what the allow flags permit
        #[arg(long = "tool")]
        tools: Vec<String>,
        /// Port for --transport http; 0 picks a free one
        #[arg(long, default_value_t = 0)]
        port: u16,
        /// Bearer token for --transport http; a random one is generated and printed if omitted
        #[arg(long)]
        token: Option<String>,
    },
}

/// Reads against the provider's usage API.
///
/// Deliberately a sibling of `jan auth` rather than a mode of the agent: these
/// are account-level questions about money, answered by the server, and none of
/// them runs a model or touches a project. Every one of them reports figures
/// the provider recorded -- not the local per-session estimate the TUI's bare
/// `/usage` prints, which is an estimate and says so.
#[derive(Subcommand)]
enum UsageCommands {
    /// Usage across this account's credentials, not only the key in use
    Account,
    /// Daily usage totals
    Daily,
    /// Recently recorded requests
    Requests,
    /// Current usage-limit status (separate from wallet credit)
    Limits,
    /// Inspect one execution by its X-Tokamak-Execution-Id
    Generation {
        /// The execution id, from the response header of an inference request
        id: String,
    },
    /// Find every execution tagged with an X-Client-Request-Id
    Correlate {
        /// The correlation id sent on the original request
        client_request_id: String,
    },
}

/// Tokamak sign-in inspection and control.
#[derive(Subcommand)]
enum AuthCommands {
    /// Show the current sign-in: account, endpoint, key id and expiry, plus a
    /// live validity check against the upstream
    Status,
    /// Sign out: revoke the stored key server-side and clear the local entry.
    Logout,
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
    /// Run the agent loop to completion, or to a --max-turns cap
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
        worktree: WorktreeArgs,
        #[command(flatten)]
        resume: ResumeRunArgs,
        #[command(flatten)]
        budget: BudgetArgs,
        /// `text` streams the answer as it arrives; `json` prints one result
        /// object on stdout when the run finishes; `stream-json` prints one
        /// JSON event per line as the run proceeds, ending with that object
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        output_format: OutputFormat,
        /// `stream-json` reads newline-delimited `user`, `permission`,
        /// `abort` and `tool_result` messages on stdin while the run is in
        /// flight, and requires `--output-format stream-json`; `text` (the
        /// default) does not read stdin at all
        #[arg(long, value_enum, default_value_t = InputFormat::Text)]
        input_format: InputFormat,
        /// JSON file declaring tools this host executes: a list of
        /// `{"name", "description", "parameters"}`. The model calls them as
        /// `host__<name>`; each call arrives as a `tool_request` on stdout and
        /// must be answered with a `tool_result` on stdin, so this requires
        /// `--input-format stream-json`
        #[arg(long, value_name = "FILE")]
        host_tools: Option<String>,
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
    /// Print the protocol's JSON Schema, generated from the types that define
    /// the channel (see `protocol/schema.json`)
    Schema {
        /// Write to this file instead of stdout
        #[arg(long)]
        out: Option<std::path::PathBuf>,
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
    /// Re-read every provider's /models endpoint, replacing the stored list
    Refresh {
        /// Only refresh this provider (e.g. tokamak)
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
                worktree: cli.worktree.into_flag(),
                ..Default::default()
            },
            cli.resume.into_request(),
        )
        .await
        {
            eprintln!("Error: {e}");
            std::process::exit(1);
        }
        return;
    };

    // `jan update` reports the same thing itself, in more detail. The check
    // doubles as the usage record (see `updater::fetch_manifest`), so there is
    // no separate ping to fire here; `JAN_CLI_NO_UPDATE_CHECK` opts out of both.
    // `jan mcp serve` is driven by another program, not a person: nobody reads
    // the notice, and an update fetch on every spawn is a cost the peer pays.
    if !matches!(command, Commands::Update { .. } | Commands::Mcp { .. }) {
        app_lib::core::cli::updater::print_update_notice_if_available().await;
    }

    match command {
        Commands::Cli { cmd } => handle_cli(cmd).await,
        Commands::Login { paste_token } => {
            if let Err(e) = app_lib::core::cli::login::run_login(paste_token).await {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
        }
        Commands::Auth { cmd } => {
            if let Err(e) = handle_auth(cmd).await {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
        }
        Commands::Usage { cmd, json } => {
            if let Err(e) = handle_usage(cmd, json).await {
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
        Commands::Mcp { cmd } => handle_mcp_serve(cmd).await,
        Commands::Update { check, force } => handle_update(check, force).await,
    }
}

// ── MCP server handler ─────────────────────────────────────────────────────

async fn handle_mcp_serve(cmd: McpServeCommands) {
    let McpServeCommands::Serve {
        project,
        transport,
        allow_write,
        allow_exec,
        tools,
        port,
        token,
    } = cmd;
    let flags = ServeFlags {
        allow_write,
        allow_exec,
        only: tools,
        port,
        token,
    };
    if let Err(e) = cli_mcp_serve(&project, transport, flags).await {
        eprintln!("Error: {e}");
        std::process::exit(1);
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
    let result =
        match cmd {
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
                .map(|plugins| match plugins.as_slice() {
                    // A single install keeps the original JSON-object output so
                    // existing scripts parsing it are unaffected; a batch install
                    // (plugin collection) prints the JSON array.
                    [plugin] => println!("{}", serde_json::to_string_pretty(plugin).unwrap()),
                    many => println!("{}", serde_json::to_string_pretty(many).unwrap()),
                }),
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
    let tools_width = plugins
        .iter()
        .map(|plugin| plugin.tools.to_string().len())
        .max()
        .unwrap_or(0)
        .max("TOOLS".len());
    let hooks_width = plugins
        .iter()
        .map(|plugin| plugin.hooks.to_string().len())
        .max()
        .unwrap_or(0)
        .max("HOOKS".len());

    let mut output = String::new();
    writeln!(
        output,
        "{:<name_width$}  {:<version_width$}  {:>skills_width$}  {:>commands_width$}  {:>agents_width$}  {:>tools_width$}  {:>hooks_width$}",
        "PLUGIN", "VERSION", "SKILLS", "COMMANDS", "AGENTS", "TOOLS", "HOOKS"
    )
    .unwrap();
    for plugin in plugins {
        writeln!(
            output,
            "{:<name_width$}  {:<version_width$}  {:>skills_width$}  {:>commands_width$}  {:>agents_width$}  {:>tools_width$}  {:>hooks_width$}",
            plugin.name,
            plugin.version,
            plugin.skills,
            plugin.commands,
            plugin.agents,
            plugin.tools,
            plugin.hooks
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
            worktree,
            resume,
            budget,
            output_format,
            input_format,
            host_tools,
        } => {
            cli_agent_run(
                &project,
                &task,
                model,
                providers.into_overrides(),
                SessionFlags {
                    auto_approve: !safe,
                    sandbox: sandbox.into_flag(),
                    worktree: worktree.into_flag(),
                    max_turns: budget.max_turns,
                    max_session_tokens: budget.max_session_tokens,
                    max_budget_usd: budget.max_budget_usd,
                    ..Default::default()
                },
                resume.into_request(),
                output_format,
                input_format,
                host_tools.as_deref(),
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
        // No project and no provider: the schema comes from the types alone, so
        // it is the same document on any machine and in any directory.
        AgentCommands::Schema { out } => app_lib::core::cli::protocol_schema::run(out.as_deref()),
    };
    if let Err(e) = result {
        eprintln!("Error: {e}");
        std::process::exit(1);
    }
}

/// `jan usage` handler: read recorded spend from the provider's usage API.
///
/// Every view goes through one fetch so failures, timeouts and the not-signed-in
/// case are reported identically regardless of which endpoint was asked for. A
/// generation lookup is then rendered field by field, because its schema is
/// documented; the rest are printed as flattened `path  value` pairs, so a
/// field the server added since this build still shows up instead of being
/// silently dropped by a struct that does not know about it.
async fn handle_usage(cmd: Option<UsageCommands>, json: bool) -> Result<(), String> {
    use app_lib::core::cli::tokamak::usage::{self, Query, UsageError};

    let query = match &cmd {
        None | Some(UsageCommands::Account) => Query::Summary,
        Some(UsageCommands::Daily) => Query::Daily,
        Some(UsageCommands::Requests) => Query::Requests,
        Some(UsageCommands::Limits) => Query::Limits,
        Some(UsageCommands::Generation { id }) => Query::Generation(id.clone()),
        Some(UsageCommands::Correlate { client_request_id }) => {
            Query::Correlated(client_request_id.clone())
        }
    };

    let payload = match usage::fetch(&query).await {
        Ok(payload) => payload,
        // A not-found is a real answer to "what did this execution cost", not a
        // crash, but it is still a failed lookup: exit non-zero so a script
        // cannot read it as a zero charge.
        Err(e @ UsageError::NotFound) => return Err(e.to_string()),
        Err(e) => return Err(e.to_string()),
    };

    if json {
        println!("{}", payload.as_str());
        return Ok(());
    }

    // The same renderer the TUI readout draws, so the two surfaces cannot
    // drift: one place decides how a reported charge is displayed. `Fixed`
    // because nothing is folded here -- a fold is an interactive affordance,
    // and a piped view that silently dropped rows would be wrong for the
    // scripts reading it -- and because there is no `m` to press in a pipe, so
    // the keybinding hint must not print either.
    for line in app_lib::core::cli::usage_view::reported_usage_lines(
        &query,
        &payload,
        app_lib::core::cli::usage_view::Fold::Fixed,
    ) {
        println!("{line}");
    }
    Ok(())
}

/// `jan auth` handler: report sign-in state or sign out.
async fn handle_auth(cmd: AuthCommands) -> Result<(), String> {
    use app_lib::core::cli::tokamak;
    match cmd {
        AuthCommands::Status => {
            let status = tokamak::auth_status();
            if !status.signed_in {
                println!("Not signed in to Tokamak. Run `jan login`.");
                return Ok(());
            }
            println!("Signed in to Tokamak");
            match &status.account {
                Some(account) => println!("  account:      {account}"),
                // A legacy paste login never learns the account; that is not the
                // same as failing to look one up.
                None => println!("  account:      not recorded"),
            }
            println!("  endpoint:     {}", status.endpoint);
            if let Some(key_id) = &status.key_id {
                println!("  key id:       {key_id}");
            }
            match status.key_expires_at {
                Some(ts) if ts != 0 => println!("  key expires:  {}", format_ts(ts)),
                // A legacy paste login records no expiry; that is not the same
                // as a key that never expires, so don't claim it does.
                _ => println!("  key expires:  not recorded"),
            }
            match tokamak::live_valid().await {
                Some(true) => println!("  valid:        yes"),
                Some(false) => println!("  valid:        no (re-run `jan login`)"),
                None => println!("  valid:        could not reach upstream"),
            }
            if let Some(warning) = tokamak::expiry_warning() {
                println!();
                println!("Warning: {warning}");
            }
            Ok(())
        }
        AuthCommands::Logout => {
            match tokamak::logout().await? {
                tokamak::Logout::ClearedAndRevoked => {
                    println!("Signed out of Tokamak (key revoked).")
                }
                tokamak::Logout::ClearedOnly => println!(
                    "Signed out of Tokamak locally. The key could not be revoked upstream - \
                     remove it at {}",
                    tokamak::API_KEYS_URL
                ),
                tokamak::Logout::NothingToDo => println!("Not signed in to Tokamak."),
            }
            Ok(())
        }
    }
}

/// Render a unix timestamp as a UTC date/time for `auth status`.
fn format_ts(ts: u64) -> String {
    let secs = i64::try_from(ts).unwrap_or(0);
    match chrono::DateTime::from_timestamp(secs, 0) {
        Some(dt) => dt.format("%Y-%m-%d %H:%M UTC").to_string(),
        None => format!("unix {ts}"),
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
            let catalog = app_lib::core::cli::model_catalog::load();
            let mut output: Vec<serde_json::Value> = configs
                .values()
                .filter(|c| app_lib::core::cli::providers::is_cli_reachable(c))
                .filter(|c| provider.as_ref().is_none_or(|p| &c.provider == p))
                .flat_map(|c| {
                    let catalog = &catalog;
                    c.models.iter().map(move |m| {
                        let mut entry = serde_json::json!({
                            "id": m,
                            "provider": c.provider,
                            "base_url": c.base_url,
                            "api_type": c.api_type,
                            "has_api_key": app_lib::core::cli::providers::has_credential(c),
                        });
                        // Whatever the provider's own listing reported, when a
                        // refresh (or a sign-in) has cached it. Absent for a
                        // plain endpoint that lists ids and nothing else.
                        if let Some(info) = catalog.get(Some(&c.provider), m) {
                            entry["info"] = serde_json::to_value(info).unwrap_or_default();
                        }
                        entry
                    })
                })
                .collect();
            output.sort_by(|a, b| {
                (a["provider"].as_str(), a["id"].as_str())
                    .cmp(&(b["provider"].as_str(), b["id"].as_str()))
            });
            println!("{}", serde_json::to_string_pretty(&output).unwrap());
        }
        ModelsCommands::Refresh { provider, project } => {
            match app_lib::core::cli::providers::refresh_models(
                Some(std::path::Path::new(&project)),
                provider.as_deref(),
            )
            .await
            {
                Ok(refreshed) => {
                    println!("{}", refreshed.summary());
                    // A provider that could not be listed leaves its stored list
                    // in place, so the exit code has to say the refresh was
                    // partial or a script would read it as complete.
                    if !refreshed.failed.is_empty() {
                        std::process::exit(1);
                    }
                }
                Err(e) => {
                    eprintln!("Error: {e}");
                    std::process::exit(1);
                }
            }
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
                let out: serde_json::Map<String, serde_json::Value> =
                    map.iter().map(|(k, v)| (k.clone(), redact(v))).collect();
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

    /// Parse `jan cli agent run <task> <extra...>` and pull out its budget args.
    fn parsed_budget(extra: &[&str]) -> BudgetArgs {
        let mut argv = vec!["jan", "cli", "agent", "run", "task"];
        argv.extend_from_slice(extra);
        match Cli::parse_from(argv).command {
            Some(Commands::Cli {
                cmd:
                    CliCommands::Agent {
                        cmd: AgentCommands::Run { budget, .. },
                    },
            }) => budget,
            _ => panic!("expected `cli agent run`"),
        }
    }

    /// An unpassed limit is `None` so the config files (or nothing, for turns)
    /// decide; `0` must survive parsing as the engine's unbounded marker rather
    /// than collapsing into the same `None`.
    #[test]
    fn run_limits_parse_and_default_to_unset() {
        let none = parsed_budget(&[]);
        assert_eq!(none.max_turns, None);
        assert_eq!(none.max_session_tokens, None);

        let set = parsed_budget(&["--max-turns", "5", "--max-session-tokens", "20000"]);
        assert_eq!(set.max_turns, Some(5));
        assert_eq!(set.max_session_tokens, Some(20_000));

        let zero = parsed_budget(&["--max-turns", "0", "--max-session-tokens", "0"]);
        assert_eq!(zero.max_turns, Some(0));
        assert_eq!(zero.max_session_tokens, Some(0));

        // The money ceiling parses as a decimal amount, not a token count: a
        // budget users write as "$2.50" must not be truncated to 2 on the way
        // in, which is the failure an integer type here would produce.
        assert_eq!(parsed_budget(&[]).max_budget_usd, None);
        assert_eq!(
            parsed_budget(&["--max-budget-usd", "2.50"]).max_budget_usd,
            Some(2.50)
        );
        // `0` is a real ceiling (stop at the first billed request), so it must
        // survive as `Some(0.0)` rather than collapsing into "unset".
        assert_eq!(
            parsed_budget(&["--max-budget-usd", "0"]).max_budget_usd,
            Some(0.0)
        );
    }

    /// Parse `jan cli agent run <task> <extra...>` and pull out its input format.
    fn parsed_input_format(extra: &[&str]) -> InputFormat {
        let mut argv = vec!["jan", "cli", "agent", "run", "task"];
        argv.extend_from_slice(extra);
        match Cli::parse_from(argv).command {
            Some(Commands::Cli {
                cmd:
                    CliCommands::Agent {
                        cmd: AgentCommands::Run { input_format, .. },
                    },
            }) => input_format,
            _ => panic!("expected `cli agent run`"),
        }
    }

    /// Reading stdin is opt-in: a run with no `--input-format` must not consume
    /// a pipe the caller is using for something else.
    #[test]
    fn input_format_parses_and_defaults_to_text() {
        assert_eq!(parsed_input_format(&[]), InputFormat::Text);
        assert_eq!(
            parsed_input_format(&["--input-format", "stream-json"]),
            InputFormat::StreamJson
        );
        assert!(Cli::try_parse_from([
            "jan",
            "cli",
            "agent",
            "run",
            "task",
            "--input-format",
            "yaml"
        ])
        .is_err());
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
            parsed_output_format(&["--output-format", "stream-json"]),
            OutputFormat::StreamJson
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

    /// `schema` is the one `cli agent` subcommand with no project and no
    /// provider: it prints a document derived from the types alone.
    #[test]
    fn schema_parses_with_and_without_an_output_path() {
        let cli = Cli::parse_from(["jan", "cli", "agent", "schema"]);
        let Some(Commands::Cli {
            cmd:
                CliCommands::Agent {
                    cmd: AgentCommands::Schema { out },
                },
        }) = cli.command
        else {
            panic!("expected `cli agent schema`");
        };
        assert_eq!(out, None);

        let cli = Cli::parse_from(["jan", "cli", "agent", "schema", "--out", "protocol/schema.json"]);
        let Some(Commands::Cli {
            cmd:
                CliCommands::Agent {
                    cmd: AgentCommands::Schema { out },
                },
        }) = cli.command
        else {
            panic!("expected `cli agent schema --out`");
        };
        assert_eq!(out.as_deref(), Some(std::path::Path::new("protocol/schema.json")));
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
    fn mcp_serve_parses_and_defaults_to_read_only_stdio() {
        let cli = Cli::parse_from(["jan", "mcp", "serve"]);
        let Some(Commands::Mcp {
            cmd: McpServeCommands::Serve {
                project,
                transport,
                allow_write,
                allow_exec,
                tools,
                port,
                token,
            },
        }) = cli.command
        else {
            panic!("expected mcp serve");
        };
        assert_eq!(project, ".");
        assert_eq!(transport, ServeTransport::Stdio);
        assert!(!allow_write);
        assert!(!allow_exec);
        assert!(tools.is_empty());
        assert_eq!(port, 0);
        assert!(token.is_none());
    }

    #[test]
    fn mcp_serve_http_flags_parse() {
        let cli = Cli::parse_from([
            "jan",
            "mcp",
            "serve",
            "--transport",
            "http",
            "--port",
            "7331",
            "--token",
            "abc",
            "--allow-write",
            "--allow-exec",
            "--tool",
            "read",
            "--tool",
            "grep",
        ]);
        let Some(Commands::Mcp {
            cmd: McpServeCommands::Serve {
                transport,
                allow_write,
                allow_exec,
                tools,
                port,
                token,
                ..
            },
        }) = cli.command
        else {
            panic!("expected mcp serve");
        };
        assert_eq!(transport, ServeTransport::Http);
        assert!(allow_write);
        assert!(allow_exec);
        assert_eq!(tools, vec!["read".to_string(), "grep".to_string()]);
        assert_eq!(port, 7331);
        assert_eq!(token.as_deref(), Some("abc"));
    }

    /// The client direction keeps its own place; `jan mcp` must not shadow it.
    #[test]
    fn mcp_client_subcommand_still_lives_under_cli() {
        let cli = Cli::parse_from(["jan", "cli", "mcp", "list"]);
        assert!(matches!(
            cli.command,
            Some(Commands::Cli {
                cmd: CliCommands::Mcp {
                    cmd: McpCommands::List { .. }
                }
            })
        ));
    }

    #[test]
    fn login_command_parses_and_takes_no_args() {
        let cli = Cli::parse_from(["jan", "login"]);
        assert!(matches!(
            cli.command,
            Some(Commands::Login { paste_token: false })
        ));
        assert!(Cli::try_parse_from(["jan", "login", "sk-key"]).is_err());
    }

    #[test]
    fn login_command_accepts_paste_token_flag() {
        let cli = Cli::parse_from(["jan", "login", "--paste-token"]);
        assert!(matches!(
            cli.command,
            Some(Commands::Login { paste_token: true })
        ));
    }

    #[test]
    fn auth_subcommands_parse() {
        let cli = Cli::parse_from(["jan", "auth", "status"]);
        assert!(matches!(
            cli.command,
            Some(Commands::Auth {
                cmd: AuthCommands::Status
            })
        ));
        let cli = Cli::parse_from(["jan", "auth", "logout"]);
        assert!(matches!(
            cli.command,
            Some(Commands::Auth {
                cmd: AuthCommands::Logout
            })
        ));
    }

    #[test]
    fn usage_subcommands_parse() {
        let view = |argv: &[&str]| {
            let mut full = vec!["jan", "usage"];
            full.extend_from_slice(argv);
            match Cli::parse_from(full).command {
                Some(Commands::Usage { cmd, .. }) => cmd,
                other => panic!("expected a usage command, got {:?}", other.is_some()),
            }
        };
        assert!(matches!(view(&["account"]), Some(UsageCommands::Account)));
        assert!(matches!(view(&["daily"]), Some(UsageCommands::Daily)));
        assert!(matches!(view(&["requests"]), Some(UsageCommands::Requests)));
        assert!(matches!(view(&["limits"]), Some(UsageCommands::Limits)));
        match view(&["generation", "exec-1"]) {
            Some(UsageCommands::Generation { id }) => assert_eq!(id, "exec-1"),
            _ => panic!("expected a generation lookup"),
        }
        match view(&["correlate", "my-app-request-001"]) {
            Some(UsageCommands::Correlate { client_request_id }) => {
                assert_eq!(client_request_id, "my-app-request-001");
            }
            _ => panic!("expected a correlation lookup"),
        }
        // Bare `jan usage` is the account summary: with no session to
        // estimate, the recorded total is the only answer there is.
        assert!(view(&[]).is_none(), "the subcommand is optional");
    }

    /// An id is required, not optional: a bare `jan usage generation` would
    /// otherwise have to invent one.
    #[test]
    fn a_generation_lookup_requires_an_id() {
        assert!(Cli::try_parse_from(["jan", "usage", "generation"]).is_err());
        assert!(Cli::try_parse_from(["jan", "usage", "correlate"]).is_err());
    }

    #[test]
    fn usage_json_flag_parses_after_the_subcommand() {
        let cli = Cli::parse_from(["jan", "usage", "account", "--json"]);
        assert!(matches!(
            cli.command,
            Some(Commands::Usage {
                cmd: Some(UsageCommands::Account),
                json: true
            })
        ));
        let cli = Cli::parse_from(["jan", "usage", "account"]);
        assert!(matches!(
            cli.command,
            Some(Commands::Usage {
                cmd: Some(UsageCommands::Account),
                json: false
            })
        ));
    }

    /// Parse a `jan cli mcp <cmd> <extra...>` argv and pull out the subcommand.
    fn parsed_mcp(extra: &[&str]) -> McpCommands {
        let mut argv = vec!["jan", "cli", "mcp"];
        argv.extend_from_slice(extra);
        match Cli::parse_from(argv).command {
            Some(Commands::Cli {
                cmd: CliCommands::Mcp { cmd },
            }) => cmd,
            _ => panic!("expected `cli mcp`"),
        }
    }

    #[test]
    fn mcp_list_parses_and_redacts_by_default() {
        let cmd = parsed_mcp(&["list"]);
        assert!(matches!(
            cmd,
            McpCommands::List {
                show_secrets: false
            }
        ));
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
        assert_eq!(
            split_kv("K=V", "env").unwrap(),
            ("K".to_string(), "V".to_string())
        );
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
                tools: 4,
                hooks: 5,
            },
            InstalledPlugin {
                name: "beta".into(),
                description: "Another description".into(),
                version: "0.0.0".into(),
                repo: String::new(),
                skills: 0,
                commands: 0,
                agents: 0,
                tools: 0,
                hooks: 0,
            },
        ];

        let output = format_plugin_list(&plugins);
        assert_eq!(output.lines().count(), 3);
        assert!(output.lines().next().unwrap().contains("PLUGIN"));
        assert!(output.lines().next().unwrap().contains("COMMANDS"));
        assert!(output.lines().next().unwrap().contains("AGENTS"));
        assert!(output.lines().next().unwrap().contains("TOOLS"));
        assert!(output.lines().next().unwrap().contains("HOOKS"));
        assert!(output.contains("alpha"));
        assert!(output.contains("1.2.3"));
        // Every count alpha declares, in column order.
        let alpha = output.lines().nth(1).unwrap();
        assert_eq!(
            alpha.split_whitespace().collect::<Vec<_>>(),
            ["alpha", "1.2.3", "2", "1", "3", "4", "5"]
        );
        assert!(!output.contains("long description"));
        assert!(!output.contains("example.com"));
    }
}
