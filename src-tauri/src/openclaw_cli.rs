use clap::{Parser, Subcommand};
use std::process::exit;

/// OpenClaw CLI commands
#[derive(Parser)]
#[command(name = "openclaw")]
#[command(about = "Manage OpenClaw gateway", long_about = None)]
pub struct OpenClawCli {
    #[command(subcommand)]
    pub command: OpenClawCommands,
}

#[derive(Subcommand)]
pub enum OpenClawCommands {
    /// Show OpenClaw status (running/stopped, version, port)
    Status,
    /// Start the OpenClaw gateway
    Start,
    /// Stop the OpenClaw gateway
    Stop,
    /// View recent logs from OpenClaw
    Logs {
        /// Number of lines to show (default: 50)
        #[arg(short, long, default_value = "50")]
        lines: usize,
    },
    /// Install OpenClaw (if not installed)
    Install,
    /// Configure OpenClaw settings
    Configure {
        /// Port number for the gateway
        #[arg(long)]
        port: Option<u16>,
        /// Bind address
        #[arg(long)]
        bind: Option<String>,
        /// Jan base URL
        #[arg(long)]
        jan_base_url: Option<String>,
        /// Model ID to use
        #[arg(long)]
        model_id: Option<String>,
        /// System prompt for agents
        #[arg(long)]
        system_prompt: Option<String>,
    },
    /// Restart the OpenClaw gateway
    Restart,
}

/// Check if we're in CLI mode with openclaw subcommand
pub fn get_openclaw_cli_args() -> Option<OpenClawCli> {
    let args: Vec<String> = std::env::args().collect();

    // Check if we have at least 2 arguments and second is "openclaw"
    if args.len() >= 2 && args[1] == "openclaw" {
        // Parse just the openclaw subcommand
        match OpenClawCli::try_parse_from(&args[1..]) {
            Ok(cli) => Some(cli),
            Err(e) => {
                eprintln!("Error parsing CLI arguments: {}", e);
                exit(1);
            }
        }
    } else {
        None
    }
}