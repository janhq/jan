//! C+ sidecar gate (taiji-permission-v1).
//!
//! A total overlay on top of Jan's own gate: when enabled, every built-in tool
//! passes through the external Python sidecar, the single human-written
//! authority for `risk`/`requires_commit` (see `contracts/permission-schema.json`).
//!
//! Verdicts (the sidecar's `status` field):
//!   "ALLOW" -> let the tool run
//!   "DEFER" -> side effect that is journaled-then-committed; the 1.0 gate
//!              logs+journals it and lets it through (the two-phase commit step
//!              wires in here)
//!   "DENY"  -> block
//!
//! Fail-closed: any IPC failure, unparseable output, unexpected status, or an
//! unlisted/unknown tool_name resolves to DENY. The sidecar itself denies
//! unlisted tools ("unknown = deny by default"), so the gate never silently
//! passes a tool the contract does not name.
//!
//! Two-phase journal: DEFER tools emit `open` before execution and
//! `commit`/`rollback` after, keyed by a request_id, so a crash between exec and
//! commit leaves a reconcilable orphan (see `poc_sidecar.py::_reconcile`).
//! Mode is per-request, decided by the sidecar at `open`:
//!   - "write"  -> S staging (3.1): the tool writes `<target>.taiji-staging.<rid>`,
//!                 `commit` does an atomic `os.replace` onto the target,
//!                 `rollback` deletes the staging file (target bytes untouched).
//!   - others   -> J ledger: `rollback` reverts ONLY the ledger / in-memory
//!                 snapshot, NOT bytes already on disk (honest: edit writes
//!                 the real target directly, so a crash can't be undone).
//!
//! Protocol: Stdio IPC. The sidecar runs as `python poc_sidecar.py --daemon`,
//! reads one JSON request per line from stdin
//! (`{"tool_name", "params", "request_id"}`) and writes one JSON response per
//! line to stdout (`{"status": "ALLOW" | "DENY" | "DEFER", "message", "request_id"}`).
//! Journal calls add a `"kind"` field ("open" | "commit" | "rollback").
//!
//! This implementation spawns the daemon per call (simple, PoC-grade). The
//! production upgrade is a persistent daemon behind a long-lived handle / request
//! channel, removing the spawn cost and keeping the gate off the inference path.
//!
//! Opt-in via `JAN_CPLUS_ENABLED`. Configure:
//!   JAN_CPLUS_SIDECAR  path to poc_sidecar.py
//!   JAN_CPLUS_PYTHON   python executable (default "python")

use serde_json::Value;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Whether the C+ overlay is active. Off unless `JAN_CPLUS_ENABLED` is set, so
/// existing behaviour (and the gate test suite) is untouched.
pub fn enabled() -> bool {
    std::env::var_os("JAN_CPLUS_ENABLED").is_some()
}

/// The C+ verdict for a tool call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Allow,
    Deny,
    /// Reserved for the two-phase commit: side effects that should be
    /// journaled, then committed. The 1.0 gate journals and lets them through.
    Defer,
}

/// Ask the sidecar for a verdict. `Err` means the sidecar could not be consulted
/// at all (missing, crashed, unparseable, or an unexpected status) -- the caller
/// treats `Err` as a denial (fail-closed).
pub fn verdict(tool: &str, args: &Value) -> Result<Verdict, String> {
    let script = match std::env::var("JAN_CPLUS_SIDECAR") {
        Ok(p) => p,
        Err(_) => return Err("JAN_CPLUS_SIDECAR not set".into()),
    };
    let python = std::env::var("JAN_CPLUS_PYTHON").unwrap_or_else(|_| "python".into());

    let request = serde_json::json!({
        "tool_name": tool,
        "params": args,
        "request_id": "cplus",
    });
    let request_line = format!("{request}\n");

    let mut child = Command::new(python)
        .arg(&script)
        .arg("--daemon")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| format!("sidecar spawn failed: {e}"))?;

    // Feed one request, then drop stdin so the daemon exits after replying.
    {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "sidecar stdin unavailable".to_string())?;
        stdin
            .write_all(request_line.as_bytes())
            .map_err(|e| format!("sidecar write failed: {e}"))?;
        // `stdin` is dropped here, closing the pipe.
    }

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "sidecar stdout unavailable".to_string())?;
    let mut buf = String::new();
    stdout
        .read_to_string(&mut buf)
        .map_err(|e| format!("sidecar read failed: {e}"))?;
    let _ = child.wait();

    let line = buf
        .lines()
        .find(|l| !l.trim().is_empty())
        .ok_or_else(|| "sidecar returned no response".to_string())?;
    let parsed: Value = serde_json::from_str(line.trim())
        .map_err(|e| format!("sidecar returned unparseable output: {e}"))?;

    match parsed.get("status").and_then(Value::as_str) {
        Some("ALLOW") => Ok(Verdict::Allow),
        Some("DENY") => Ok(Verdict::Deny),
        Some("DEFER") => Ok(Verdict::Defer),
        other => Err(format!("sidecar returned unexpected status: {other:?}")),
    }
}

// ---------- two-phase journal signaling (J scheme) ----------

static REQ_SEQ: AtomicU64 = AtomicU64::new(0);

/// Process-unique request id: nanosecond timestamp + atomic counter. No `uuid`
/// crate needed. Correlates the `open` / `commit` / `rollback` events of one
/// DEFER tool call across the per-spawn sidecar processes.
pub fn new_request_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = REQ_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("taiji-{nanos}-{seq}")
}

fn sidecar_path() -> Result<String, String> {
    std::env::var("JAN_CPLUS_SIDECAR").map_err(|_| "JAN_CPLUS_SIDECAR not set".into())
}

fn sidecar_python() -> String {
    std::env::var("JAN_CPLUS_PYTHON").unwrap_or_else(|_| "python".into())
}

/// Generic one-shot IPC: spawn `--daemon`, feed one JSON line, close stdin so
/// the daemon exits, read the single response line back.
fn sidecar_call(payload: &Value) -> Result<Value, String> {
    let input = serde_json::to_string(payload).map_err(|e| e.to_string())?;

    let mut child = Command::new(sidecar_python())
        .arg(sidecar_path()?)
        .arg("--daemon")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| format!("sidecar spawn failed: {e}"))?;

    // Write the request, then drop stdin so the daemon EOFs its stdin loop and exits.
    {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "sidecar stdin unavailable".to_string())?;
        stdin
            .write_all(input.as_bytes())
            .map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
        // `stdin` dropped here -> pipe closed.
    }

    let mut line = String::new();
    {
        let stdout = child
            .stdout
            .as_mut()
            .ok_or_else(|| "sidecar stdout unavailable".to_string())?;
        BufReader::new(stdout)
            .read_line(&mut line)
            .map_err(|e| e.to_string())?;
    }
    let _ = child.wait();

    serde_json::from_str(&line).map_err(|e| format!("bad sidecar json: {e}"))
}

/// DEFER tool "before" execution: journal `open`. Write failure returns `Err`
/// so the caller downgrades to DENY (fail-closed extension: journal failure =
/// gate failure).
///
/// Accepts both `DEFER` (J ledger mode) and `STAGING_READY` (S staging mode)
/// as success. S mode means the sidecar has recorded the absolute target path
/// and the Rust caller has redirected the tool's `path` arg to
/// `<target>.taiji-staging.<rid>`; the sidecar atomically `os.replace`es the staging
/// file onto the target on `commit`. Keeping this signature self-contained
/// (it builds the payload internally) avoids touching the call sites.
pub fn journal_open(req_id: &str, tool: &str, args: &Value) -> Result<(), String> {
    let payload = serde_json::json!({
        "kind": "open",
        "request_id": req_id,
        "tool_name": tool,
        "params": args,
    });
    let resp = sidecar_call(&payload)?;
    match resp.get("status").and_then(|s| s.as_str()) {
        Some("DEFER") | Some("STAGING_READY") => Ok(()),
        _ => Err(format!("journal_open rejected: {resp}")),
    }
}

/// DEFER tool "after" success: journal `commit`. Returns `Err` when the sidecar
/// reports `COMMIT_FAILED` (the staging `os.replace` failed, so bytes were NOT
/// written) or on any IPC failure. The caller downgrades the tool's success
/// content to `ERROR` so the model never sees a silent data loss (洞 A).
pub fn journal_commit(req_id: &str) -> Result<(), String> {
    let payload = serde_json::json!({ "kind": "commit", "request_id": req_id });
    let resp = sidecar_call(&payload)?;
    match resp.get("status").and_then(|s| s.as_str()) {
        Some("OK") => Ok(()),
        Some("COMMIT_FAILED") => Err(
            "sidecar reported COMMIT_FAILED (staging os.replace failed, bytes not written)".into(),
        ),
        other => Err(format!("journal_commit unexpected status: {other:?}")),
    }
}

/// DEFER tool "after" error: journal `rollback`. Best-effort; in J this only
/// marks the ledger, it does NOT revert bytes already on disk (see module docs).
pub fn journal_rollback(req_id: &str) {
    let payload = serde_json::json!({ "kind": "rollback", "request_id": req_id });
    if let Err(e) = sidecar_call(&payload) {
        eprintln!("[cplus] journal_rollback failed: {e} (req {req_id})");
    }
}
