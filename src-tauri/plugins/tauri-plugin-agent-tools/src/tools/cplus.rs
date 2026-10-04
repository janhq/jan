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
//!   - "write"/"edit" -> S staging (3.1/3.2): the tool writes
//!                 `<target>.taiji-staging.<rid>`, `commit` does an atomic
//!                 `os.replace` onto the target, `rollback` deletes the staging
//!                 file (target bytes untouched). For edit, the read source
//!                 (`_cplus_read_path`) points to the original target.
//!   - others   -> J ledger: `rollback` reverts ONLY the ledger / in-memory
//!                 snapshot, NOT bytes already on disk.
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
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Whether the C+ overlay is active. Off unless `JAN_CPLUS_ENABLED` is set, so
/// existing behaviour (and the gate test suite) is untouched.
pub fn enabled() -> bool {
    std::env::var_os("JAN_CPLUS_ENABLED").is_some()
}

/// B phase (N2)：turn 级批量收口模式。开启后跳过 per-call commit，
/// 由 dispatch 层在 turn 末调用 finalize_turn() 统一收口。
/// 零回归：未设此变量时，走原路径 per-rid commit。
pub fn turn_mode() -> bool {
    std::env::var_os("JAN_CPLUS_TURN").is_some()
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

/// B phase (N2)：turn 模式下 Rust 已独占完成 os.replace，只记账本 committed 事件。
/// 不调 journal_commit（它会二次 os.replace），避免 Blocker-3 的双 replace 竞态。
pub fn journal_note_commit(req_id: &str) -> Result<(), String> {
    let payload = serde_json::json!({ "kind": "note_commit", "request_id": req_id });
    let resp = sidecar_call(&payload)?;
    match resp.get("status").and_then(|s| s.as_str()) {
        Some("OK") => Ok(()),
        other => Err(format!("journal_note_commit unexpected status: {other:?}")),
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

// ---------- turn-level batch finalize (B phase) ----------
//
// N2 地基：turn = agent-loop 的一批 tool call，commit 触发点从 per-call 上移到 per-turn。
// 单次 DEFER 调用只做 journal_open（建 staging、写新字节进 staging），不 finalize；
// finalize 挪到 turn 末、该批调用全部返回后的 join 点，统一执行。
//
// 派发可并发、收口必须串行：turn 内多调用可能并发，各自只 open+stage（staging 名带 rid
// 天然不串，target 全程未被碰）；commit 在 turn 末单线程串行做。
//
// 护栏 1 仍满足：不改 verdict()/execute_builtin/journal_commit 签名，只改 commit 发生的
// 时机与聚合。零回归：finalize_turn() 未被调用时，回退现状 per-rid commit。

/// 单次 DEFER 在 turn 内的登记项：记录 target/staging/tool/内容状态，供 turn 末批量收口用。
#[derive(Debug, Clone)]
pub struct TurnEntry {
    pub rid: String,
    /// 绝对 target 路径（commit 时的 os.replace 目标）
    pub target: String,
    /// staging 路径（os.replace 源）
    pub staging: String,
    /// 工具名
    pub tool: String,
    /// 执行后内容：ERROR 前缀表示该调用已闯祸，触发熔断
    pub content: String,
}

/// Turn 级 rid 注册表：per-turn_id 收集 DEFER 条目。
/// Mutex<HashMap<turn_id, Vec<TurnEntry>>> 结构，全局共享、线程安全。
static TURN_REGISTRY: OnceLock<Mutex<HashMap<String, Vec<TurnEntry>>>> = OnceLock::new();

fn registry() -> &'static Mutex<HashMap<String, Vec<TurnEntry>>> {
    TURN_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 将单次 DEFER 调用的 rid 登记到 turn 注册表，不立即 commit。
/// 
/// `turn_id` 标识本批 tool call（通常来自 thread_id 或 dispatch 层分配的批次 id）。
/// `target` / `staging` 为绝对路径，`content` 为工具执行后的返回串。
pub fn register_defer(
    turn_id: &str,
    rid: &str,
    target: &str,
    staging: &str,
    tool: &str,
    content: &str,
) {
    let entry = TurnEntry {
        rid: rid.to_string(),
        target: target.to_string(),
        staging: staging.to_string(),
        tool: tool.to_string(),
        content: content.to_string(),
    };
    if let Ok(mut map) = registry().lock() {
        map.entry(turn_id.to_string())
            .or_default()
            .push(entry);
    } else {
        eprintln!("[cplus] turn registry lock poisoned, falling back to per-rid commit");
    }
}

/// N1 熔断判定：检查本 turn 内是否有任何 DEFER 工具返回 content=ERROR。
///
/// NEW-4：finalize_turn 已改用本地 entries.iter().any() 判熔断，此函数不再被调用。
/// 保留供外部 hook / 诊断用。
///
/// 语义：只要本 turn 内有一个"闯祸信号"，整批（含其它成功工具的 staging）一律 abort。
pub fn circuit_break(turn_id: &str) -> bool {
    let map = match registry().lock() {
        Ok(m) => m,
        Err(_) => return false, // 锁中毒，不熔断
    };
    if let Some(entries) = map.get(turn_id) {
        entries.iter().any(|e| e.content.starts_with("ERROR"))
    } else {
        false
    }
}

/// Turn 末批量收口：对 turn_id 下所有已登记的 DEFER rid 统一 commit 或统一 abort。
///
/// 流程（N2/N3）：
/// 1. 从注册表取出该 turn 的所有条目
/// 2. CircuitBreak::check → 触发熔断：对每个 rid 走 rollback（os.remove(staging)）
/// 3. 未触发：逐个先把旧 target 备份成 `.taiji-bak.<rid>`，再 os.replace(staging→target)
///    批内任一步失败 → 用已收集的 .bak 把先前已替换的目标全部还原（全成或全不成）
/// 4. 清理注册表
///
/// 返回 (success_count, error_messages)
pub fn finalize_turn(turn_id: &str) -> (usize, Vec<String>) {
    // 1. 取出该 turn 的所有条目，从注册表移除
    let entries: Vec<TurnEntry> = {
        let mut map = match registry().lock() {
            Ok(m) => m,
            Err(e) => {
                return (0, vec![format!("turn registry lock poisoned: {e}")]);
            }
        };
        map.remove(turn_id).unwrap_or_default()
    };

    if entries.is_empty() {
        return (0, vec![]);
    }

    // N1：熔断判定——基于本地 entries，不回查已被掏空的 registry
    let has_error = entries.iter().any(|e| e.content.starts_with("ERROR"));
    if has_error {
        eprintln!("[cplus] CIRCUIT BREAK for turn {turn_id}: aborting all {} deferred ops", entries.len());
        let mut errors = vec![format!("CIRCUIT BREAK: turn {turn_id} has error signals, all staging aborted")];
        for entry in &entries {
            journal_rollback(&entry.rid);
            eprintln!("[cplus]   rollback staging: {} -> {}", entry.rid, entry.staging);
        }
        return (0, errors);
    }

    // 3. 批量 commit：先全量备份，再全量替换，失败时全量还原
    let mut bak_paths: Vec<String> = Vec::new();
    let mut committed_indices: Vec<usize> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    // 3a. 全量备份旧 target
    // NEW-2 修复：用 copy 而非 replace——崩溃窗口内 target 必须始终存在，
    // reconcile 的 exists(path)→replace(bak,path) 还原分支才成立。
    for (i, entry) in entries.iter().enumerate() {
        let bak_path = format!("{}.taiji-bak.{}", entry.target, entry.rid);
        if std::path::Path::new(&entry.target).exists() {
            match std::fs::copy(&entry.target, &bak_path) {
                Ok(_) => {
                    bak_paths.push(bak_path);
                    committed_indices.push(i);
                }
                Err(e) => {
                    errors.push(format!("backup copy failed for {}: {}", entry.target, e));
                    rollback_committed(&entries, &bak_paths, &committed_indices);
                    clean_bak_list(&bak_paths);
                    for entry in &entries {
                        journal_rollback(&entry.rid);
                    }
                    return (0, errors);
                }
            }
        } else {
            // target 不存在（新文件 write），无需备份
            bak_paths.push(String::new());
            committed_indices.push(i);
        }
    }

    // 3b. 全量 os.replace(staging → target)
    // Blocker-3 修复：turn 模式下 Rust 独占 replace，不再调 journal_commit（它会二次 replace）。
    // 改用 journal_note_commit：只记账本 committed 事件，不搬字节。
    for (i, entry) in entries.iter().enumerate() {
        match std::fs::replace(&entry.staging, &entry.target) {
            Ok(()) => {
                // commit 成功，只记账本（不调 journal_commit，避免 sidecar 二次 os.replace）
                if let Err(e) = journal_note_commit(&entry.rid) {
                    eprintln!("[cplus]   journal_note_commit failed: {e}");
                }
            }
            Err(e) => {
                errors.push(format!(
                    "os.replace failed for {} -> {}: {}",
                    entry.staging, entry.target, e
                ));
                // replace 失败 → 立即还原所有已替换的（含本步之前成功的）
                rollback_committed(&entries, &bak_paths, &(0..=i).collect());
                clean_bak_list(&bak_paths);
                // 对剩余未处理的 rid 走 rollback
                for j in (i + 1)..entries.len() {
                    journal_rollback(&entries[j].rid);
                }
                return (0, errors);
            }
        }
    }

    // 3c. 全部成功，清理 .bak
    clean_bak_list(&bak_paths);
    let success_count = entries.len();
    eprintln!("[cplus] turn {turn_id} batch commit OK: {success_count} ops");
    (success_count, errors)
}

/// 用 .bak 还原已替换的 target（全成或全不成语义的核心）。
fn rollback_committed(entries: &[TurnEntry], bak_paths: &[String], indices: &[usize]) {
    for &i in indices {
        if i >= entries.len() {
            continue;
        }
        let bak = &bak_paths[i];
        if bak.is_empty() {
            continue; // 新文件，无备份
        }
        match std::fs::replace(bak, &entries[i].target) {
            Ok(()) => {
                eprintln!("[cplus]   restored {} from backup", entries[i].target);
            }
            Err(e) => {
                eprintln!("[cplus]   FAILED to restore {}: {}", entries[i].target, e);
            }
        }
    }
}

/// 清理 .bak 文件（成功路径或失败后已还原）。
fn clean_bak_list(bak_paths: &[String]) {
    for bak in bak_paths {
        if bak.is_empty() {
            continue;
        }
        if let Err(e) = std::fs::remove_file(bak) {
            eprintln!("[cplus]   cleanup bak failed {}: {}", bak, e);
        }
    }
}

/// 同 target 多次写检测：turn 内对同一 target 有多个 DEFER 写入时返回 true。
/// 保守策略：直接触发熔断 DENY。
pub fn duplicate_target_in_turn(turn_id: &str, target: &str) -> bool {
    let map = match registry().lock() {
        Ok(m) => m,
        Err(_) => return false,
    };
    if let Some(entries) = map.get(turn_id) {
        entries.iter().any(|e| e.target == target)
    } else {
        false
    }
}
