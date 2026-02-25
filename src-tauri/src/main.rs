// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use app_lib::openclaw_cli::{get_openclaw_cli_args, OpenClawCli, OpenClawCommands};
use std::process::exit;

fn main() {
    let _ = fix_path_env::fix();

    // Check if we're in CLI mode with openclaw subcommand
    if let Some(cli) = get_openclaw_cli_args() {
        // Run CLI command and exit
        run_openclaw_cli(cli);
        exit(0);
    }

    // Normal Tauri app startup
    app_lib::run();
}

/// Execute OpenClaw CLI commands
fn run_openclaw_cli(cli: OpenClawCli) {
    use tokio::runtime::Runtime;

    let rt = Runtime::new().expect("Failed to create runtime");

    match cli.command {
        OpenClawCommands::Status => {
            // Use standalone status check that doesn't require Tauri State
            let status = rt.block_on(async {
                app_lib::core::openclaw::cli::get_status().await
            });

            match status {
                Ok(status) => {
                    println!("OpenClaw Status:");
                    println!("  Installed: {}", if status.installed { "Yes" } else { "No" });
                    println!("  Running: {}", if status.running { "Yes" } else { "No" });
                    println!("  OpenClaw Version: {}", status.openclaw_version.clone().unwrap_or_else(|| "N/A".to_string()));
                    println!("  Node.js Version: {}", status.node_version.clone().unwrap_or_else(|| "N/A".to_string()));
                    println!("  Port (18789): {}", if status.port_available { "Available" } else { "In Use" });

                    if let Some(err) = status.error {
                        println!("  Error: {}", err);
                    }
                }
                Err(e) => {
                    eprintln!("Failed to get status: {}", e);
                    exit(1);
                }
            }
        }

        OpenClawCommands::Start => {
            let result = rt.block_on(async {
                app_lib::core::openclaw::cli::start_gateway().await
            });

            match result {
                Ok(_) => println!("OpenClaw gateway started successfully on port 18789"),
                Err(e) => {
                    eprintln!("Failed to start OpenClaw: {}", e);
                    exit(1);
                }
            }
        }

        OpenClawCommands::Stop => {
            let result = rt.block_on(async {
                app_lib::core::openclaw::cli::stop_gateway().await
            });

            match result {
                Ok(_) => println!("OpenClaw gateway stopped successfully"),
                Err(e) => {
                    eprintln!("Failed to stop OpenClaw: {}", e);
                    exit(1);
                }
            }
        }

        OpenClawCommands::Logs { lines } => {
            // Read logs from the OpenClaw config directory
            if let Ok(config_dir) = app_lib::core::openclaw::get_openclaw_config_dir() {
                let log_path = config_dir.join("logs");
                if log_path.exists() {
                    if let Ok(entries) = std::fs::read_dir(&log_path) {
                        let mut log_files: Vec<_> = entries
                            .filter_map(|e| e.ok())
                            .filter(|e| e.path().extension().map_or(false, |ext| ext == "log"))
                            .collect();

                        // Sort by modified time - get the most recent
                        log_files.sort_by(|a, b| {
                            let a_time = a.metadata().and_then(|m| m.modified()).ok();
                            let b_time = b.metadata().and_then(|m| m.modified()).ok();
                            b_time.cmp(&a_time)
                        });

                        if let Some(latest_log) = log_files.first() {
                            if let Ok(content) = std::fs::read_to_string(latest_log.path()) {
                                let lines_vec: Vec<&str> = content.lines().collect();
                                let start = if lines_vec.len() > lines {
                                    lines_vec.len() - lines
                                } else {
                                    0
                                };
                                for line in &lines_vec[start..] {
                                    println!("{}", line);
                                }
                                return;
                            }
                        }
                    }
                }
                // Also try to find logs in data directory
                let data_log_path = dirs::data_dir()
                    .map(|p| p.join("openclaw").join("logs"))
                    .unwrap_or_default();
                if data_log_path.exists() {
                    if let Ok(entries) = std::fs::read_dir(&data_log_path) {
                        let mut log_files: Vec<_> = entries
                            .filter_map(|e| e.ok())
                            .filter(|e| e.path().extension().map_or(false, |ext| ext == "log"))
                            .collect();

                        log_files.sort_by(|a, b| {
                            let a_time = a.metadata().and_then(|m| m.modified()).ok();
                            let b_time = b.metadata().and_then(|m| m.modified()).ok();
                            b_time.cmp(&a_time)
                        });

                        if let Some(latest_log) = log_files.first() {
                            if let Ok(content) = std::fs::read_to_string(latest_log.path()) {
                                let lines_vec: Vec<&str> = content.lines().collect();
                                let start = if lines_vec.len() > lines {
                                    lines_vec.len() - lines
                                } else {
                                    0
                                };
                                for line in &lines_vec[start..] {
                                    println!("{}", line);
                                }
                                return;
                            }
                        }
                    }
                }
            }
            println!("No logs found. Make sure OpenClaw has been started at least once.");
        }

        OpenClawCommands::Install => {
            println!("Installing OpenClaw...");

            let result = rt.block_on(async {
                app_lib::core::openclaw::commands::openclaw_install().await
            });

            match result {
                Ok(install_result) => {
                    if install_result.success {
                        println!("OpenClaw installed successfully!");
                        if let Some(version) = install_result.version {
                            println!("  Version: {}", version);
                        }
                    } else {
                        eprintln!("Installation failed: {}", install_result.error.unwrap_or_else(|| "Unknown error".to_string()));
                        exit(1);
                    }
                }
                Err(e) => {
                    eprintln!("Installation error: {}", e);
                    exit(1);
                }
            }
        }

        OpenClawCommands::Configure { port, bind, jan_base_url, model_id, system_prompt } => {
            let config_input = app_lib::core::openclaw::models::OpenClawConfigInput {
                port,
                bind,
                jan_base_url,
                model_id,
                system_prompt,
            };

            let result = rt.block_on(async {
                app_lib::core::openclaw::commands::openclaw_configure(Some(config_input)).await
            });

            match result {
                Ok(config) => {
                    println!("OpenClaw configured successfully!");
                    println!("  Gateway Port: {}", config.gateway.port);
                    println!("  Gateway Bind: {}", config.gateway.bind);
                    println!("  Jan Base URL: {}", config.models.providers.jan.base_url);
                    println!("  Model ID: {}", config.agents.defaults.model.primary);
                }
                Err(e) => {
                    eprintln!("Configuration failed: {}", e);
                    exit(1);
                }
            }
        }

        OpenClawCommands::Restart => {
            let result = rt.block_on(async {
                app_lib::core::openclaw::cli::restart_gateway().await
            });

            match result {
                Ok(_) => println!("OpenClaw gateway restarted successfully"),
                Err(e) => {
                    eprintln!("Failed to restart OpenClaw: {}", e);
                    exit(1);
                }
            }
        }
    }
}
