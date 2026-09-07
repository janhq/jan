//! Terminal sign-in UX for Tokamak: the plain-stdout counterpart to the TUI's
//! `/login` overlay. Both drive [`super::tokamak`]; only presentation differs.
//!
//! `jan login` runs this directly. The TUI no longer forces this flow on a
//! fresh install -- it launches with an empty model and shows a one-line
//! notice, letting the user run `/login` (or `jan login`) when they are ready
//! instead of being dropped into a masked key prompt immediately.

use std::io::IsTerminal;

use super::{secret_input, tokamak};

/// Max key prompts before giving up, so a wrong paste is retryable but a script
/// piping garbage at us can't loop forever.
const MAX_ATTEMPTS: usize = 3;

const KEY_PROMPT: &str = "Paste your Tokamak API key: ";

/// Reject a non-interactive run with nothing configured: there is no terminal
/// to show the sign-in notice in and nobody to act on it. No-op otherwise --
/// an interactive run with no provider proceeds and the TUI shows its own
/// notice instead of forcing a login flow here.
pub fn reject_headless_without_provider(
    project_root: Option<&std::path::Path>,
) -> Result<(), String> {
    if super::providers::has_usable_provider(project_root) {
        return Ok(());
    }
    if !std::io::stdin().is_terminal() {
        return Err(headless_message());
    }
    Ok(())
}

/// Sign in to Tokamak from a plain terminal.
///
/// The default flow is browser-approval: the CLI creates a sign-in session,
/// opens the authorize page (any device can approve), and polls for the minted
/// key. When the server predates the `/auth/cli/sessions` endpoints (404/405 on
/// create), it falls back to the legacy paste-a-key flow automatically; a piped
/// stdin (`echo $KEY | jan login`) and `--paste-token` force the paste flow.
pub async fn run_login(paste_token: bool) -> Result<(), String> {
    if !std::io::stdin().is_terminal() {
        return login_from_stdin().await;
    }
    if paste_token {
        return login_by_paste().await;
    }
    match device_login_interactive().await {
        // A deployment that predates the flow is not an error, but say which
        // flow you ended up in -- otherwise a paste prompt looks like the
        // browser sign-in silently failing.
        Err(DeviceLogin::Unsupported) => {
            println!();
            println!("This Tokamak deployment does not support browser sign-in yet.");
            login_by_paste().await
        }
        Err(DeviceLogin::Failed(e)) => Err(e),
        Ok(()) => Ok(()),
    }
}

/// Why the browser flow did not complete, split so `run_login` can fall back on
/// "this server is too old" without inspecting prose.
enum DeviceLogin {
    Unsupported,
    Failed(String),
}

/// The device (browser-approval) login, interactive.
async fn device_login_interactive() -> Result<(), DeviceLogin> {
    use super::device_auth::{self, BeginError};

    let base = tokamak::base_url();
    let pending = match device_auth::begin(&base).await {
        Ok(pending) => pending,
        Err(BeginError::Unsupported) => return Err(DeviceLogin::Unsupported),
        Err(e) => return Err(DeviceLogin::Failed(e.message(&base))),
    };

    println!();
    println!("Sign in to Tokamak in your browser.");
    let session = pending.session();
    println!("  confirm this code matches: {}", session.user_code);
    println!("  {}", session.authorize_url);
    match super::browser::open(&session.authorize_url) {
        Ok(()) => println!("  (opening that page in your browser)"),
        Err(e) => println!("  (open that URL yourself: {e})"),
    }
    println!("  waiting for approval... (approve from any device, Ctrl-C to cancel)");

    let login = tokamak::device_login(pending)
        .await
        .map_err(DeviceLogin::Failed)?;
    report(&login);
    Ok(())
}

/// The legacy paste-a-key login, interactive.
async fn login_by_paste() -> Result<(), String> {
    println!();
    println!("Sign in to Tokamak and create an API key:");
    println!("  {}", tokamak::API_KEYS_URL);
    match tokamak::open_api_keys_page() {
        Ok(()) => println!("  (opening that page in your browser)"),
        Err(e) => println!("  (open that URL yourself: {e})"),
    }
    println!();
    println!("The key is masked as you type or paste. Enter verifies, Esc cancels.");

    let mut last_error = None;
    for attempt in 1..=MAX_ATTEMPTS {
        let entered = match prompt_for_key().await? {
            Some(key) => key,
            // Ctrl-C / Ctrl-D at the prompt: the user chose not to sign in.
            None => return Err(cancelled_message()),
        };
        // Validate before announcing a request, so an empty line (Ctrl-D) or a
        // mis-paste doesn't read as a rejection by Tokamak.
        let result = match tokamak::sanitize_key(&entered) {
            Ok(key) => {
                println!("Verifying...");
                tokamak::login(&key).await
            }
            Err(e) => Err(e),
        };
        match result {
            Ok(login) => {
                report(&login);
                return Ok(());
            }
            Err(e) => {
                if attempt < MAX_ATTEMPTS {
                    eprintln!("{e}");
                    println!();
                }
                last_error = Some(e);
            }
        }
    }
    Err(last_error.unwrap_or_else(|| "sign-in failed".to_string()))
}

/// Verify a key piped in on stdin. Reports to stdout exactly like the
/// interactive path so a script's log shows what changed.
async fn login_from_stdin() -> Result<(), String> {
    let mut piped = String::new();
    std::io::Read::read_to_string(&mut std::io::stdin(), &mut piped)
        .map_err(|e| format!("could not read the API key from stdin: {e}"))?;
    if piped.trim().is_empty() {
        return Err(piped_empty_message());
    }
    let login = tokamak::login(&piped).await?;
    report(&login);
    Ok(())
}

/// Read the key, echoing a mask so the user can see a paste land. `None` means
/// the user abandoned the prompt. Runs on a blocking thread: the prompt owns the
/// terminal while it waits, which must not stall the async runtime.
async fn prompt_for_key() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(|| secret_input::read_masked_line(KEY_PROMPT))
        .await
        .map_err(|e| format!("key prompt failed: {e}"))?
}

/// Why we stopped when there is nobody at the keyboard to paste a key.
fn headless_message() -> String {
    "no AI provider is configured. Run `jan login` to sign in to Tokamak, or set one manually:\n  \
     jan config set --provider <id> --api-key <key> --base-url <url>\nA key can also be passed \
     per run with --api-key or $JAN_API_KEY."
        .to_string()
}

/// `jan login` with nothing on a piped stdin: say how to feed it one, rather
/// than repeating "run `jan login`" at someone who just did.
fn piped_empty_message() -> String {
    format!(
        "no API key on stdin. Either run `jan login` from a terminal, pipe the key in:\n  echo \
         $TOKAMAK_API_KEY | jan login\nor set it directly:\n  jan config set --provider {} \
         --api-key <key> --base-url {}",
        tokamak::PROVIDER,
        tokamak::base_url()
    )
}

fn cancelled_message() -> String {
    "sign-in cancelled. Run `jan login` when you have a key, or configure a provider manually \
     with `jan config set`.\nAlready running a model locally? Point Jan at the desktop app's API \
     server:\n  jan config set --provider jan --base-url http://localhost:1337/v1 --model <model>"
        .to_string()
}

fn report(login: &tokamak::Login) {
    println!();
    match login.models.len() {
        0 => println!(
            "Signed in to Tokamak, but the account exposes no models yet. Pick one with /model \
             once it does."
        ),
        1 => println!("Signed in to Tokamak - 1 model available."),
        n => println!("Signed in to Tokamak - {n} models available."),
    }
    if let Some(account) = &login.account {
        println!("  account: {account}");
    }
    println!("  key saved to {}", login.config_path.display());
    if let Some(model) = &login.default_model {
        println!("  default model: {model}");
    }
    println!();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_dead_end_points_at_a_way_forward() {
        for message in [
            cancelled_message(),
            headless_message(),
            piped_empty_message(),
        ] {
            assert!(message.contains("jan login"), "{message}");
            assert!(message.contains("jan config set"), "{message}");
        }
        // The piped variant must not tell the user to re-run what just failed as
        // if nothing else were possible.
        assert!(piped_empty_message().contains("| jan login"));
    }

    #[test]
    fn report_survives_every_model_count() {
        for models in [
            Vec::new(),
            vec!["m".to_string()],
            vec!["a".into(), "b".into()],
        ] {
            for account in [None, Some("a@b.c".to_string())] {
                report(&tokamak::Login {
                    models: models.clone(),
                    config_path: std::path::PathBuf::from("/tmp/config.toml"),
                    default_model: Some("a".to_string()),
                    account,
                });
            }
        }
    }
}
