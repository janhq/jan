use std::future::Future;
use std::time::{Duration, Instant};

use crate::core::ollama_control_plane::commands::stop_ollama;
use crate::core::ollama_installer::commands::{
    check_ollama_installed, check_ollama_running, start_ollama,
};

const RECONCILIATION_TIMEOUT: Duration = Duration::from_secs(20);
const RECONCILIATION_INTERVAL: Duration = Duration::from_millis(500);

fn build_reconciliation_timeout_error(desired_running: bool) -> String {
    if desired_running {
        "Timed out waiting for Ollama to reach running state".to_string()
    } else {
        "Timed out waiting for Ollama to reach stopped state".to_string()
    }
}

async fn poll_until_goal<F, Fut>(
    timeout: Duration,
    interval: Duration,
    mut probe: F,
) -> Result<(), String>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<bool, String>>,
{
    let deadline = Instant::now() + timeout;

    loop {
        if probe().await? {
            return Ok(());
        }

        if Instant::now() >= deadline {
            return Err("poll timeout".to_string());
        }

        tokio::time::sleep(interval).await;
    }
}

#[tauri::command]
pub async fn ensure_ollama_running() -> Result<(), String> {
    log::info!("Entering ensure_ollama_running");

    let install_path =
        check_ollama_installed().ok_or_else(|| "Ollama is not installed".to_string())?;
    let initial = check_ollama_running().await?;
    log::info!(
        "ensure_ollama_running initial status: running={} version={:?}",
        initial.is_running,
        initial.version
    );

    if initial.is_running {
        log::info!("Ollama already running before reconciliation");
        return Ok(());
    }

    log::info!(
        "ensure_ollama_running issuing raw start_ollama using {}",
        install_path
    );
    start_ollama(install_path).await?;

    match poll_until_goal(RECONCILIATION_TIMEOUT, RECONCILIATION_INTERVAL, || async {
        let status = check_ollama_running().await?;
        log::debug!(
            "ensure_ollama_running probe: running={} version={:?}",
            status.is_running,
            status.version
        );
        Ok(status.is_running)
    })
    .await
    {
        Ok(()) => {
            log::info!("ensure_ollama_running converged successfully");
            Ok(())
        }
        Err(_) => {
            let error = build_reconciliation_timeout_error(true);
            log::error!("ensure_ollama_running failed to converge: {}", error);
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn ensure_ollama_stopped() -> Result<(), String> {
    log::info!("Entering ensure_ollama_stopped");

    let initial = check_ollama_running().await?;
    log::info!(
        "ensure_ollama_stopped initial status: running={} version={:?}",
        initial.is_running,
        initial.version
    );

    if !initial.is_running {
        log::info!("Ollama already stopped before reconciliation");
        return Ok(());
    }

    log::info!("ensure_ollama_stopped issuing raw stop_ollama");
    stop_ollama().await?;

    match poll_until_goal(RECONCILIATION_TIMEOUT, RECONCILIATION_INTERVAL, || async {
        let status = check_ollama_running().await?;
        log::debug!(
            "ensure_ollama_stopped probe: running={} version={:?}",
            status.is_running,
            status.version
        );
        Ok(!status.is_running)
    })
    .await
    {
        Ok(()) => {
            log::info!("ensure_ollama_stopped converged successfully");
            Ok(())
        }
        Err(_) => {
            let error = build_reconciliation_timeout_error(false);
            log::error!("ensure_ollama_stopped failed to converge: {}", error);
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{build_reconciliation_timeout_error, poll_until_goal};
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    use std::time::Duration;

    #[tokio::test]
    async fn poll_until_goal_returns_immediately_when_initial_probe_matches() {
        let polls = Arc::new(AtomicUsize::new(0));
        let polls_clone = polls.clone();

        let result = poll_until_goal(
            Duration::from_millis(30),
            Duration::from_millis(1),
            move || {
                let polls = polls_clone.clone();
                async move {
                    polls.fetch_add(1, Ordering::SeqCst);
                    Ok(true)
                }
            },
        )
        .await;

        assert!(result.is_ok());
        assert_eq!(polls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn poll_until_goal_times_out_when_probe_never_matches() {
        let result = poll_until_goal(
            Duration::from_millis(25),
            Duration::from_millis(5),
            || async { Ok(false) },
        )
        .await;

        assert!(result.is_err());
    }

    #[test]
    fn timeout_error_is_desired_state_specific() {
        assert_eq!(
            build_reconciliation_timeout_error(true),
            "Timed out waiting for Ollama to reach running state"
        );
        assert_eq!(
            build_reconciliation_timeout_error(false),
            "Timed out waiting for Ollama to reach stopped state"
        );
    }
}
