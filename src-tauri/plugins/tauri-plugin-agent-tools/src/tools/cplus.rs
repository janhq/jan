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
use std::collections::{HashMap, HashSet};
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
    // 崩溃恢复驱动点：本目录首次登记时，先清扫上次崩溃遗留的 .bak。
    // 见 `reconcile_dir` 文档——这是崩溃恢复唯一能自然触发的时机。
    if let Some(dir) = std::path::Path::new(target)
        .parent()
        .and_then(|p| p.to_str())
    {
        reconcile_dir(dir);
    }
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
        let errors = vec![format!("CIRCUIT BREAK: turn {turn_id} has error signals, all staging aborted")];
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
                    // 问题-2 同类：copy 中途失败可能留下半截 bak_i，而它没进
                    // bak_paths（只有 Ok 才 push），clean_bak_list 也就删不到它。
                    // 显式清掉，否则崩溃恢复时会被当成"未完成的 commit"误还原。
                    let _ = std::fs::remove_file(&bak_path);
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
    //
    // 问题-1 修复：committed 事件**不在循环内逐条记**。批内任一条失败即整批回滚，
    // 若成功条已先记了 committed，回滚只还原字节、不抵消账本 → 账本假绿（"已落盘"
    // 而磁盘已退回 turn 起点）。改为 3c 之后统一记账：全成才记，全不成一条都不记。
    for (i, entry) in entries.iter().enumerate() {
        match std::fs::rename(&entry.staging, &entry.target) {
            Ok(()) => {}
            Err(e) => {
                errors.push(format!(
                    "os.replace failed for {} -> {}: {}",
                    entry.staging, entry.target, e
                ));
                // replace 失败 → 立即还原所有已替换的（含本步之前成功的）
                rollback_committed(&entries, &bak_paths, &(0..=i).collect::<Vec<usize>>());
                clean_bak_list(&bak_paths);
                // 问题-2 修复：必须是 entries 全集，不能是 (i + 1)..。
                // 索引 i 自己的 staging 既没被 rename 消耗，也没被 rollback_committed
                // 处理（那里只做 rename(bak→target)），用 (i+1).. 会把它漏成孤儿
                // *.taiji-staging.*；而 entries 已被 map.remove 掏走，无人再回收。
                // 全集里 0..i-1 的 staging 已被 rename 消耗，journal_rollback 对它们
                // 是 best-effort 空转（sidecar 侧 os.remove 失败被吞），无副作用。
                for victim in &entries {
                    journal_rollback(&victim.rid);
                }
                return (0, errors);
            }
        }
    }

    // 3c. 全部成功，清理 .bak
    clean_bak_list(&bak_paths);

    // 3d. 统一记账本 committed（原为 3b 循环内逐条记，见问题-1）。
    //
    // 顺序**必须先 3c 后 3d**：反过来若崩溃卡在两者之间，会出现
    // "账本已记 committed + .bak 仍在盘" → 下次 reconcile 按 .bak 还原，
    // 把已提交的字节退回旧值（真·数据丢失）。先清 .bak 则最坏只是少一条
    // committed 审计事件，属安全侧缺口，不会有字节错。
    //
    // **审计 best-effort（成文口径）**：此处 note_commit 失败只 eprintln，
    // 不回滚、不改变返回值。这是有意为之，不是漏处理——走到 3d 时字节已经
    // 全部落盘且 .bak 已清空，账本记不上只是**缺一条审计事件**，若因它把整批
    // 回退反而会把已成功提交的字节退回旧值（即上一段说的反向事故）。
    // 因此审计口径必须读作："committed 事件缺失 ≠ 本次提交失败"；
    // 判断提交是否成功看磁盘字节与 finalize_turn 的返回值，不看 committed 事件。
    for entry in &entries {
        if let Err(e) = journal_note_commit(&entry.rid) {
            eprintln!("[cplus]   journal_note_commit failed: {e}");
        }
    }

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
        match std::fs::rename(bak, &entries[i].target) {
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
            // rollback_committed 已用 rename(bak→target) 把 bak 消耗掉，此处再删
            // 必然 NotFound——是预期路径而非错误，静默掉，避免日志噪音掩盖真错误。
            if e.kind() != std::io::ErrorKind::NotFound {
                eprintln!("[cplus]   cleanup bak failed {}: {}", bak, e);
            }
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

// ---------- turn 收口守卫 (Blocker-2 / 空洞甲) ----------
//
// `CompositeToolInvoker::invoke`（core::agent::loop）**不是单出口**。除尾部
// `Ok(out)` 外还有两条退出路径：
//   1. `self.mcp.invoke(&mcp_calls).await?`（loop.rs:2402）——发生在所有 builtin
//      tool call 执行完毕、staging 已建且已登记之后。此时提前返回会让
//      finalize_turn 永远不跑：全批 staging 滞留、target 永不落盘、无 commit
//      也无清理。这是"真·数据不落盘"，且 [S] 的 happy-path 冒烟测不到。
//   2. panic unwind。
//
// 守卫把收口挂在 `Drop` 上，三条路径全覆盖：正常返回走 finalize_turn（按各
// 条目 content 判 commit / 熔断），提前 Err 与 panic 走 abort_turn 强回滚。
// 未完成就退出时**不 commit**——宁可全不落盘，也不让一个残缺批次落一半。

/// 强制回滚整批：不走 `finalize_turn` 的 commit 分支，直接对每个已登记 rid
/// 调 `journal_rollback`（os.remove(staging)），然后清空该 turn 的注册表。
/// 返回被回滚的条目数。
pub fn abort_turn(turn_id: &str) -> usize {
    let entries: Vec<TurnEntry> = {
        let mut map = match registry().lock() {
            Ok(m) => m,
            Err(_) => return 0,
        };
        map.remove(turn_id).unwrap_or_default()
    };
    for entry in &entries {
        journal_rollback(&entry.rid);
    }
    entries.len()
}

/// Turn 收口守卫。见本节顶部说明。
///
/// 用法（dispatch 层）：
/// ```ignore
/// let mut guard = TurnGuard::new(&turn_id);
/// // ... 执行整批 tool call ...
/// guard.complete();   // 仅正常路径标记；未标记即视为异常退出
/// Ok(out)             // Drop 在此触发 finalize_turn
/// ```
pub struct TurnGuard {
    turn_id: String,
    completed: bool,
}

impl TurnGuard {
    pub fn new(turn_id: &str) -> Self {
        Self {
            turn_id: turn_id.to_string(),
            completed: false,
        }
    }

    /// 标记本批次正常走完。未调用即离开作用域 → Drop 走 `abort_turn` 强回滚。
    pub fn complete(&mut self) {
        self.completed = true;
    }
}

impl Drop for TurnGuard {
    fn drop(&mut self) {
        // 零回归：非 turn 模式下不会有任何条目登记，守卫空转。
        if !turn_mode() {
            return;
        }
        if self.completed {
            let (n, errs) = finalize_turn(&self.turn_id);
            if !errs.is_empty() {
                eprintln!(
                    "[cplus] turn {} finalized: {} committed, errors: {:?}",
                    self.turn_id, n, errs
                );
            }
        } else {
            let n = abort_turn(&self.turn_id);
            if n > 0 {
                eprintln!(
                    "[cplus] turn {} ABORTED (early return / panic): {} deferred ops rolled back, no bytes committed",
                    self.turn_id, n
                );
            }
        }
    }
}

// ---------- reconcile: .bak 残留恢复 (Rust 生产体) ----------
//
// 边界（与 Python `poc_sidecar.py::_reconcile` L152-168 二选一，写死如下）：
//   **Rust 独占 .bak 恢复，Python 侧 .bak 分支退役。**
//
// 理由：`.bak` 由 `finalize_turn` 3a 的 `fs::copy` 在 **Rust 侧**产生，产生方
// 与恢复方跨语言会让"谁先跑、谁兜底"变成竞态——两边都还原会 double-restore
// （第二次 restore 时 .bak 已不存在，退化为 no-op，但若并发则可能覆盖对方
// 刚写回的真值），两边都不还原则 .bak 永久滞留、target 停在半成品。
//
// 现状 Python `_reconcile` 的 .bak 分支保留但**仅作兜底观察**：它只在 Rust 侧
// 未启用（JAN_CPLUS_ENABLED 未设 / 进程已退出）时才可能先跑。启用 Rust 生产
// 体后，.bak 的权威恢复路径是这里的 `reconcile_bak`。

/// 崩溃恢复：检测到 `<target>.taiji-bak.<rid>` 残留即判定该 turn 的 commit
/// 未完成。
/// - target 存在（可能已被部分 replace）→ `fs::rename(bak, target)` 还原真值；
/// - target 不存在（新文件 write 中途崩溃）→ 删掉孤儿 .bak。
///
/// 与 `poc_sidecar.py::_reconcile` 的 .bak 分支逐行等价。
pub fn reconcile_bak(rid: &str, target: &str) {
    let bak = format!("{target}.taiji-bak.{rid}");
    if std::path::Path::new(&bak).exists() {
        if std::path::Path::new(target).exists() {
            // 原子覆盖；Rust 的 fs::rename 在 Windows 上走
            // MoveFileEx(MOVEFILE_REPLACE_EXISTING)，等价于 Python 的 os.replace。
            if let Err(e) = std::fs::rename(&bak, target) {
                eprintln!("[cplus] reconcile_bak: restore {target} from {bak} failed: {e}");
            }
        } else if let Err(e) = std::fs::remove_file(&bak) {
            eprintln!("[cplus] reconcile_bak: remove orphan bak {bak} failed: {e}");
        }
    }
}

/// `reconcile_bak` 的驱动者：扫描目录内所有 `<base>.taiji-bak.<rid>` 残留并逐条恢复。
///
/// **为什么驱动点在这里**：`.bak` 由 `finalize_turn` 3a 在 Rust 侧 `fs::copy` 产生，
/// 只在 3c（clean_bak_list）之前进程崩溃时才会滞留。崩溃后 `TURN_REGISTRY` 随进程
/// 一起消失，内存里没有任何线索——**唯一还活着的事实源就是磁盘上的 .bak 文件**。
/// 因此恢复只能靠"下次碰到这个目录时顺手扫一遍"，而 `register_defer` 是每个 DEFER
/// 调用的必经点，且其 `target` 的父目录很可能正是崩溃发生的工作目录。
///
/// 进程内每个目录只扫一次（`Once` 去重），之后该目录的登记不再付 read_dir 开销。
/// 返回实际处理（恢复或清孤儿）的条数。
pub fn reconcile_dir(dir: &str) -> usize {
    static SCANNED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    let scanned = SCANNED.get_or_init(|| Mutex::new(HashSet::new()));
    {
        let mut set = match scanned.lock() {
            Ok(s) => s,
            Err(_) => return 0,
        };
        if !set.insert(dir.to_string()) {
            return 0; // 本目录本进程已扫过
        }
    }
    let Ok(rd) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut n = 0;
    for entry in rd.flatten() {
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        // rfind：base 名自身可能含点，取最后一段 marker 才不会切错。
        let Some(pos) = name.rfind(".taiji-bak.") else {
            continue;
        };
        let base = &name[..pos];
        let rid = &name[pos + ".taiji-bak.".len()..];
        if base.is_empty() || rid.is_empty() {
            continue;
        }
        let Some(parent) = entry.path().parent().map(|p| p.to_path_buf()) else {
            continue;
        };
        let Some(target) = parent.join(base).to_str().map(str::to_string) else {
            continue;
        };
        reconcile_bak(rid, &target);
        n += 1;
    }
    n
}

/// 递归版 `reconcile_dir`，供进程启动时的显式清扫使用
/// （env `JAN_CPLUS_RECONCILE_ROOT`）。`depth` 上限 8 防止符号链接成环。
pub fn reconcile_root(root: &str) -> usize {
    fn walk(dir: &std::path::Path, depth: usize, acc: &mut usize) {
        if depth > 8 {
            return;
        }
        if let Some(d) = dir.to_str() {
            *acc += reconcile_dir(d);
        }
        let Ok(rd) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in rd.flatten() {
            let path = entry.path();
            // 不跟随符号链接，避免成环与跨 FS 意外改写。
            if path.is_dir() && !path.is_symlink() {
                walk(&path, depth + 1, acc);
            }
        }
    }
    let mut acc = 0;
    walk(std::path::Path::new(root), 0, &mut acc);
    acc
}
