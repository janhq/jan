//! `jan mcp serve`: run Jan's built-in toolset as an MCP server so another
//! agent can call it.
//!
//! The protocol work lives in `core::mcp::server`; this is only the CLI's entry
//! point -- resolving the project root and its `agent.toml` settings, choosing a
//! transport, and keeping stdout clean on the stdio one.

use std::path::PathBuf;

use crate::core::mcp::server::{http, stdio, ServeOptions, ServedTools};

/// Which transport `jan mcp serve` should use.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, clap::ValueEnum)]
#[clap(rename_all = "kebab-case")]
pub enum ServeTransport {
    /// JSON-RPC over stdin/stdout: what another agent spawns as a child process.
    #[default]
    Stdio,
    /// Streamable HTTP on loopback, behind a bearer token.
    Http,
}

/// Flags that shape the served surface, mapped onto [`ServedTools`].
#[derive(Clone, Debug, Default)]
pub struct ServeFlags {
    pub allow_write: bool,
    pub allow_exec: bool,
    pub only: Vec<String>,
    pub port: u16,
    pub token: Option<String>,
}

/// Resolve the project root and its settings into [`ServeOptions`].
///
/// `[tools].allow_network` and `[tools].sandbox` are honored exactly as the
/// agent loop honors them, so a project that has configured its toolset gets the
/// same behavior whether the caller is Jan's own agent or someone else's.
fn options_for(project: &str, flags: &ServeFlags) -> Result<ServeOptions, String> {
    let root = PathBuf::from(project)
        .canonicalize()
        .map_err(|e| format!("Cannot resolve project '{project}': {e}"))?;
    let settings = crate::core::agent::project::run_settings(&root);
    let mut opts = ServeOptions::new(root);
    opts.enabled_skills = settings.enabled_skills;
    opts.allow_network = settings.allow_network.unwrap_or(false);
    opts.sandbox = settings.sandbox.unwrap_or(true);
    opts.served = ServedTools {
        allow_write: flags.allow_write,
        allow_exec: flags.allow_exec,
        only: flags.only.clone(),
    };
    Ok(opts)
}

/// The `--tool` names that are not built-ins. `lookup()` is the authority on
/// what a built-in is, so this cannot drift from what is actually servable.
fn unknown_tool_names(only: &[String]) -> Vec<String> {
    only.iter()
        .filter(|n| tauri_plugin_agent_tools::tools::lookup(n).is_none())
        .cloned()
        .collect()
}

/// Run the server until the peer disconnects (stdio) or the process is stopped
/// (http).
pub async fn cli_mcp_serve(
    project: &str,
    transport: ServeTransport,
    flags: ServeFlags,
) -> Result<(), String> {
    let opts = options_for(project, &flags)?;
    // Always to stderr: on stdio, stdout is the JSON-RPC stream.
    let unknown = unknown_tool_names(&flags.only);
    if !unknown.is_empty() {
        eprintln!(
            "jan mcp serve: warning: unknown --tool name(s): {}. Nothing is served for them.",
            unknown.join(", ")
        );
    }
    match transport {
        ServeTransport::Stdio => {
            // stdout is the JSON-RPC stream from here on; the startup notice
            // goes to stderr like every other log this binary writes.
            eprintln!(
                "jan mcp serve: stdio, project {}",
                opts.project_root.display()
            );
            stdio::serve(opts).await
        }
        ServeTransport::Http => {
            let (bound, serve) = http::bind(opts, flags.port, flags.token.clone()).await?;
            println!("url: {}", bound.url());
            println!("token: {}", bound.token);
            serve.await;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_follow_the_flags_and_default_to_read_only() {
        let dir = tempfile::tempdir().expect("tempdir");
        let project = dir.path().to_string_lossy().to_string();

        let opts = options_for(&project, &ServeFlags::default()).expect("options");
        assert_eq!(opts.served, ServedTools::default());
        assert!(opts.sandbox, "sandbox stays on unless agent.toml says otherwise");
        assert!(!opts.allow_network);
        assert_eq!(opts.store_root, opts.project_root.join(".jan").join("agent"));

        let opts = options_for(
            &project,
            &ServeFlags {
                allow_write: true,
                allow_exec: true,
                only: vec!["read".into()],
                ..Default::default()
            },
        )
        .expect("options");
        assert!(opts.served.allow_write);
        assert!(opts.served.allow_exec);
        assert_eq!(opts.served.only, vec!["read".to_string()]);
    }

    #[test]
    fn agent_toml_tool_settings_are_honored() {
        let dir = tempfile::tempdir().expect("tempdir");
        let agent_dir = dir.path().join(".jan").join("agent");
        std::fs::create_dir_all(&agent_dir).expect("mkdir");
        std::fs::write(
            agent_dir.join("agent.toml"),
            "[tools]\nsandbox = false\nallow_network = true\n\n[skills]\nenabled = [\"jan\"]\n",
        )
        .expect("write agent.toml");

        let opts = options_for(&dir.path().to_string_lossy(), &ServeFlags::default())
            .expect("options");
        assert!(!opts.sandbox);
        assert!(opts.allow_network);
        assert_eq!(opts.enabled_skills, vec!["jan".to_string()]);
    }

    /// A mistyped `--tool` serves an empty set and exits 0, which looks like a
    /// working server that offers nothing. Name the unknown ones so the typo is
    /// fixable.
    #[test]
    fn unknown_tool_names_are_reported() {
        assert_eq!(unknown_tool_names(&[]), Vec::<String>::new());
        assert_eq!(
            unknown_tool_names(&["read".into(), "grep".into()]),
            Vec::<String>::new()
        );
        assert_eq!(
            unknown_tool_names(&["read".into(), "nope".into(), "alsonope".into()]),
            vec!["nope".to_string(), "alsonope".to_string()]
        );
    }

    #[test]
    fn a_missing_project_is_an_error_not_a_panic() {
        let err = options_for("/definitely/not/here", &ServeFlags::default())
            .expect_err("missing project");
        assert!(err.contains("Cannot resolve project"), "{err}");
    }
}
