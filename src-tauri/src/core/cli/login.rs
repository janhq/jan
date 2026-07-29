//! Terminal sign-in UX for Tokamak: the plain-stdout counterpart to the TUI's
//! `/login` overlay. Both drive [`super::tokamak`]; only presentation differs.
//!
//! This runs *before* the TUI starts, which is what makes a fresh install work
//! at all: with no provider configured, session setup fails on "no model
//! specified" before a single frame is drawn, so the key has to be collected
//! here.

use std::io::IsTerminal;

use super::tokamak;

/// Max key prompts before giving up, so a wrong paste is retryable but a script
/// piping garbage at us can't loop forever.
const MAX_ATTEMPTS: usize = 3;

/// Guarantee a runnable provider before the agent starts, signing the user in if
/// there is none. No-op when anything usable is already configured, so the
/// startup cost on an existing install is one config read.
///
/// Non-interactive (piped stdin) fails with instructions instead of prompting:
/// there is no one there to paste a key.
pub async fn ensure_provider_configured(
    project_root: Option<&std::path::Path>,
) -> Result<(), String> {
    if super::providers::has_usable_provider(project_root) {
        return Ok(());
    }
    if !std::io::stdin().is_terminal() {
        return Err(headless_message());
    }
    println!("No AI provider is configured yet.");
    run_login().await
}

/// Sign in to Tokamak from a plain terminal: point the user at the API-keys
/// page, read the key they paste (hidden), verify it, and persist it.
///
/// A piped stdin (`echo $KEY | jan login`) is verified directly instead: there
/// is no browser to open and no prompt to answer, so scripting it is the only
/// sensible reading.
pub async fn run_login() -> Result<(), String> {
    if !std::io::stdin().is_terminal() {
        return login_from_stdin().await;
    }
    println!();
    println!("Sign in to Tokamak and create an API key:");
    println!("  {}", tokamak::API_KEYS_URL);
    match tokamak::open_api_keys_page() {
        Ok(()) => println!("  (opening that page in your browser)"),
        Err(e) => println!("  (open that URL yourself: {e})"),
    }
    println!();

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

/// Read the key with echo disabled. `None` means the user interrupted the
/// prompt. Runs on a blocking thread: `dialoguer` owns the terminal while it
/// waits, which must not stall the async runtime.
async fn prompt_for_key() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(|| {
        match dialoguer::Password::new()
            .with_prompt("Paste your Tokamak API key")
            .allow_empty_password(true)
            .interact()
        {
            Ok(key) => Ok(Some(key)),
            Err(e) if is_interrupted(&e) => Ok(None),
            Err(e) => Err(format!("could not read the API key: {e}")),
        }
    })
    .await
    .map_err(|e| format!("key prompt failed: {e}"))?
}

fn is_interrupted(e: &dialoguer::Error) -> bool {
    let dialoguer::Error::IO(io) = e;
    io.kind() == std::io::ErrorKind::Interrupted
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
        tokamak::BASE_URL
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
        for models in [Vec::new(), vec!["m".to_string()], vec!["a".into(), "b".into()]] {
            report(&tokamak::Login {
                models,
                config_path: std::path::PathBuf::from("/tmp/config.toml"),
                default_model: Some("a".to_string()),
            });
        }
    }
}
