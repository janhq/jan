//! Completion doorbell for backgrounded `bash` commands.
//!
//! A `bash` call that outruns its timeout keeps running and publishes its output
//! to a file, but nothing used to tell the model when that happened: the model
//! had to guess when to read the path back, and a run with nothing else to do
//! would end while the command was still going. This registry closes that gap
//! the way [`crate::core::agent::subagent::BackgroundSubagents`] and
//! `MonitorSet` do -- queue the ping, wake anyone parked, and hold the run open
//! while a command is still owed -- so a finished shell reaches the model as a
//! `<SYSTEM>` reminder at the top of the next turn.
//!
//! Unlike a monitor, a backgrounded command carries no deadline of its own:
//! `npm run dev`, `tail -f` and a hung build never end. So the *park* is what
//! is bounded here (see [`tauri_plugin_agent_tools::tools::shell_park_budget_secs`]):
//! once a command outlives its budget the registry silently stops waiting on
//! it. No notice is queued for that: the model already knows the command is
//! running (the `bash` result said so) and gains nothing actionable from being
//! told again, while the late completion still pings when it eventually lands.
//! The run loop re-checks `background_pending` after the park, so a park that
//! ends with nothing queued ends the run rather than spinning an empty turn.

use std::sync::Mutex;

use tauri_plugin_agent_tools::tools::{shell_park_budget_secs, ShellBackgrounded, ShellDone};

/// One finished background command, ready for delivery.
pub(crate) struct ShellNotice {
    /// Shown to the user at delivery, since nothing else reports the fact.
    pub headline: String,
    /// What reaches the model.
    pub text: String,
}

/// A command that was backgrounded and has not reported back yet.
struct Pending {
    id: u64,
    /// When the run stops holding itself open for this command.
    deadline: tokio::time::Instant,
}

/// Everything one run is still owed from background shells: the commands not
/// yet reported, and the pings for those that have. Both live under one lock on
/// purpose -- the count and the queue are read together by
/// [`BackgroundShells::has_pending_work`], so a command cannot be observed as
/// "no longer running" in the window before its ping is queued, and a parked
/// run cannot see "nothing running, nothing queued" and end under an answer
/// about to land.
#[derive(Default)]
struct State {
    pending: Vec<Pending>,
    notices: Vec<ShellNotice>,
}

/// The background commands one run is still owed a result from, plus the pings
/// for those that have finished.
#[derive(Default)]
pub(crate) struct BackgroundShells {
    state: Mutex<State>,
    wake: tokio::sync::Notify,
}

impl BackgroundShells {
    /// A command has been backgrounded and its completion is now owed to the
    /// model -- until it finishes, or until its park budget runs out.
    pub(crate) fn start(&self, handoff: ShellBackgrounded) {
        let deadline = tokio::time::Instant::now()
            + std::time::Duration::from_secs(shell_park_budget_secs(handoff.timeout_secs));
        self.state.lock().unwrap().pending.push(Pending {
            id: handoff.id,
            deadline,
        });
    }

    /// A backgrounded command ended: queue its ping and release the run.
    pub(crate) fn finish(&self, done: ShellDone) {
        let mut state = self.state.lock().unwrap();
        // Removed by id rather than by count: a command whose budget already
        // expired was dropped from `pending` when it was abandoned, and
        // decrementing a count here would underflow and park the run forever.
        // Its late ping is still queued -- it is real news, and it is queued at
        // most once per command.
        state.pending.retain(|p| p.id != done.id);
        state.notices.push(ShellNotice {
            headline: headline(&done),
            text: text(&done),
        });
        drop(state);
        self.wake.notify_waiters();
    }

    /// Take every queued ping, oldest first.
    pub(crate) fn take_notices(&self) -> Vec<ShellNotice> {
        std::mem::take(&mut self.state.lock().unwrap().notices)
    }

    /// Whether anything is still owed: a command running within its budget, or
    /// a ping queued and not yet delivered. Safe to park on -- every pending
    /// command either ends or is abandoned at its deadline.
    pub(crate) fn has_pending_work(&self) -> bool {
        let state = self.state.lock().unwrap();
        !state.notices.is_empty() || !state.pending.is_empty()
    }

    /// Whether a ping is queued and not yet taken. Unlike
    /// [`Self::has_pending_work`] this says nothing about commands still
    /// running: a set that outlives its run consults it to decide whether the
    /// model has something to react to *now*, since a command finishing later
    /// starts a turn of its own rather than holding this one open.
    pub(crate) fn has_queued_notices(&self) -> bool {
        !self.state.lock().unwrap().notices.is_empty()
    }

    /// Park until a ping is queued or nothing is left to wait for (every
    /// remaining command finished or outlived its budget). The waiter registers before the state re-read, so a
    /// command finishing in between wakes this call rather than being missed.
    pub(crate) async fn wait_for_notice(&self) {
        loop {
            let waiter = self.wake.notified();
            tokio::pin!(waiter);
            waiter.as_mut().enable();
            // Discharged before the state is read, so a park whose last
            // command has expired returns instead of sleeping on it again.
            self.abandon_expired();
            let next = {
                let state = self.state.lock().unwrap();
                if !state.notices.is_empty() || state.pending.is_empty() {
                    return;
                }
                state.pending.iter().map(|p| p.deadline).min()
            };
            match next {
                Some(deadline) => {
                    tokio::select! {
                        _ = waiter => {}
                        _ = tokio::time::sleep_until(deadline) => {}
                    }
                }
                None => waiter.await,
            }
        }
    }

    /// Stop waiting on every command past its budget. Silent on purpose: the
    /// model was told the command runs in the background when `bash` returned,
    /// and its completion still pings if it ever lands.
    fn abandon_expired(&self) {
        let now = tokio::time::Instant::now();
        self.state.lock().unwrap().pending.retain(|p| p.deadline > now);
    }
}

/// The command line, flattened and capped, for a one-line ping.
fn short_command(command: &str) -> String {
    const MAX: usize = 60;
    let flat = command.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= MAX {
        return flat;
    }
    let head: String = flat.chars().take(MAX - 3).collect();
    format!("{head}...")
}

/// Opening words of a failed command's headline. The TUI styles a headline by
/// how it opens, so these are shared with it rather than repeated as literals.
pub(crate) const FAILED_PREFIX: &str = "Background command failed after ";

/// Opening words of a finished command's headline (see [`FAILED_PREFIX`]).
pub(crate) const FINISHED_PREFIX: &str = "Background command finished after ";

pub(crate) fn headline(done: &ShellDone) -> String {
    let prefix = if done.failed {
        FAILED_PREFIX
    } else {
        FINISHED_PREFIX
    };
    format!(
        "{prefix}{}s: {}",
        done.elapsed_secs,
        short_command(&done.command)
    )
}

fn text(done: &ShellDone) -> String {
    let verb = if done.failed {
        "finished with a nonzero exit"
    } else {
        "finished"
    };
    match &done.output_path {
        // Hedged the way the `bash` result itself is: the published file holds
        // the already-capped output, so past the cap it is a tail plus a
        // pointer to the full log, not the whole thing. A `<SYSTEM>` notice
        // reads as authoritative, so it must not overclaim.
        Some(path) => format!(
            "Background command `{}` {verb} after {}s. Its output is in {path} -- read \
             that file when you need it (if the output was large that file keeps a tail \
             and points to the full log).",
            short_command(&done.command),
            done.elapsed_secs
        ),
        None => format!(
            "Background command `{}` {verb} after {}s. Its output was not captured, \
             so there is nothing to read back.",
            short_command(&done.command),
            done.elapsed_secs
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn handoff(id: u64, timeout_secs: u64) -> ShellBackgrounded {
        ShellBackgrounded { id, timeout_secs }
    }

    fn done(failed: bool, path: Option<&str>) -> ShellDone {
        ShellDone {
            id: 1,
            command: "cargo build --release".to_string(),
            elapsed_secs: 42,
            output_path: path.map(str::to_string),
            failed,
        }
    }

    #[test]
    fn a_finished_command_queues_one_ping_naming_its_output_file() {
        let shells = BackgroundShells::default();
        shells.start(handoff(1, 30));
        assert!(shells.has_pending_work(), "a running command is owed");
        shells.finish(done(false, Some("/tmp/jan-bash/out.txt")));
        let notices = shells.take_notices();
        assert_eq!(notices.len(), 1);
        assert!(
            notices[0].text.contains("/tmp/jan-bash/out.txt"),
            "must point at the output: {}",
            notices[0].text
        );
        assert!(
            notices[0].text.contains("cargo build --release"),
            "must name the command: {}",
            notices[0].text
        );
        assert!(
            notices[0].headline.contains("finished"),
            "user-facing line: {}",
            notices[0].headline
        );
        // Drained: nothing is owed any more.
        assert!(!shells.has_pending_work());
    }

    /// The published file holds the already-capped result, so the ping must
    /// hedge exactly as the `bash` call's own wording does rather than promise
    /// the complete output.
    #[test]
    fn the_ping_does_not_promise_more_than_the_file_holds() {
        let shells = BackgroundShells::default();
        shells.start(handoff(1, 30));
        shells.finish(done(false, Some("/tmp/jan-bash/out.txt")));
        let notices = shells.take_notices();
        assert!(
            !notices[0].text.contains("full output is in"),
            "must not claim completeness: {}",
            notices[0].text
        );
        assert!(
            notices[0].text.contains("keeps a tail"),
            "must carry the same hedge the tool result does: {}",
            notices[0].text
        );
    }

    #[test]
    fn a_failing_command_says_so_in_both_registers() {
        let shells = BackgroundShells::default();
        shells.start(handoff(1, 30));
        shells.finish(done(true, Some("/tmp/jan-bash/out.txt")));
        let notices = shells.take_notices();
        assert!(notices[0].headline.contains("failed"));
        assert!(notices[0].text.contains("nonzero exit"));
    }

    #[test]
    fn a_command_with_no_output_file_still_reports_that_it_ended() {
        let shells = BackgroundShells::default();
        shells.start(handoff(1, 30));
        shells.finish(done(false, None));
        let notices = shells.take_notices();
        assert!(
            notices[0].text.contains("not captured"),
            "unexpected: {}",
            notices[0].text
        );
    }

    /// The ping must be queued before the command stops counting as owed, or a
    /// parked run could observe "nothing running, nothing queued" and end under
    /// a command whose answer was about to land. One lock over both makes the
    /// window impossible.
    #[test]
    fn a_queued_ping_keeps_the_run_owed_even_after_the_command_ended() {
        let shells = BackgroundShells::default();
        shells.start(handoff(1, 30));
        shells.finish(done(false, Some("/tmp/x")));
        assert!(
            shells.has_pending_work(),
            "an undelivered ping is still owed"
        );
        let _ = shells.take_notices();
        assert!(!shells.has_pending_work());
    }

    /// A `Finished` for a command that is not pending (a duplicate, or one
    /// already abandoned at its deadline) must not corrupt the count: with a
    /// bare decrement it would wrap and park the run forever.
    #[test]
    fn an_unpaired_completion_cannot_wedge_the_registry() {
        let shells = BackgroundShells::default();
        shells.finish(done(false, Some("/tmp/x")));
        shells.finish(done(false, Some("/tmp/x")));
        assert_eq!(shells.take_notices().len(), 2);
        assert!(
            !shells.has_pending_work(),
            "nothing is owed once the pings are delivered"
        );
    }

    #[tokio::test]
    async fn parking_wakes_when_a_command_finishes() {
        let shells = std::sync::Arc::new(BackgroundShells::default());
        shells.start(handoff(1, 30));
        let waiter = shells.clone();
        let parked = tokio::spawn(async move { waiter.wait_for_notice().await });
        tokio::task::yield_now().await;
        shells.finish(done(false, Some("/tmp/x")));
        tokio::time::timeout(std::time::Duration::from_secs(5), parked)
            .await
            .expect("park must wake on a completion")
            .unwrap();
        assert_eq!(shells.take_notices().len(), 1);
    }

    /// The park also returns when nothing is left to wait for, so a run whose
    /// shells were all reaped cannot hang.
    #[tokio::test]
    async fn parking_returns_immediately_when_nothing_is_owed() {
        let shells = BackgroundShells::default();
        tokio::time::timeout(std::time::Duration::from_secs(5), shells.wait_for_notice())
            .await
            .expect("must not park with nothing in flight");
    }

    /// The bound: a command that never ends (`npm run dev`, `tail -f`) must not
    /// park the run for its whole life. The park ends at the budget with
    /// nothing queued -- the model was already told the command runs in the
    /// background, so a "still running" reminder would only cost it a turn --
    /// and nothing is owed afterwards, so the turn can finish.
    #[tokio::test(start_paused = true)]
    async fn a_command_that_never_ends_stops_holding_the_run_open_silently() {
        let shells = BackgroundShells::default();
        shells.start(handoff(1, 30));
        // Never signalled: the park can only end on the budget.
        shells.wait_for_notice().await;
        assert!(
            shells.take_notices().is_empty(),
            "expiry must not ping the model about a command it knows is running"
        );
        assert!(
            !shells.has_pending_work(),
            "the obligation is discharged, so the run is free to end"
        );
    }

    /// The park is sized per command: a short-timeout command must not be
    /// abandoned while a long-running sibling still has budget left, and
    /// abandoning the short one must not wake the park with nothing to say.
    #[tokio::test(start_paused = true)]
    async fn each_command_is_abandoned_at_its_own_deadline() {
        let shells = BackgroundShells::default();
        shells.start(handoff(1, 0)); // clamped to the 60s floor
        shells.start(handoff(2, 600)); // clamped to the 1800s ceiling
        let parked = tokio::time::timeout(
            std::time::Duration::from_secs(120),
            shells.wait_for_notice(),
        )
        .await;
        assert!(parked.is_err(), "the long one keeps the park open");
        assert!(shells.take_notices().is_empty());
        assert!(shells.has_pending_work(), "the long one is still owed");
        shells.wait_for_notice().await;
        assert!(shells.take_notices().is_empty());
        assert!(!shells.has_pending_work());
    }

    /// A command that comes back after it was abandoned still reports: it is
    /// real news, delivered once, and the stale entry must not double-count.
    #[tokio::test(start_paused = true)]
    async fn a_late_completion_after_abandonment_still_pings_exactly_once() {
        let shells = BackgroundShells::default();
        shells.start(handoff(7, 0));
        shells.wait_for_notice().await;
        assert!(shells.take_notices().is_empty(), "abandoning is silent");
        shells.finish(ShellDone {
            id: 7,
            ..done(false, Some("/tmp/x"))
        });
        let notices = shells.take_notices();
        assert_eq!(notices.len(), 1);
        assert!(notices[0].headline.contains("finished"));
        assert!(!shells.has_pending_work());
    }

    #[test]
    fn a_long_command_line_is_flattened_and_capped() {
        let short = short_command("  echo   hello \n world ");
        assert_eq!(short, "echo hello world");
        let long = short_command(&"x".repeat(200));
        assert_eq!(long.chars().count(), 60);
        assert!(long.ends_with("..."));
    }
}
