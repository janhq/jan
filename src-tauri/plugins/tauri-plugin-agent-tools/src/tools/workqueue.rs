//! The shared work queue: a file-mediated corkboard under the run's
//! collaboration scratch that lets the main agent and its depth-1 workers
//! load-balance a set of tasks.
//!
//! `post_work` pins a card; a worker `claim_work`s the top ready card (a single
//! [`open_excl`] create is the mutex, so no two workers claim one item),
//! does it, then `complete_work`s the result. Producer/consumer handoff is
//! `deps`: an item is claimable only once every dep completed `ok=true`; a dep
//! that failed makes its item unsatisfiable, which `claim_work` fails
//! transitively rather than leaving to dangle.
//!
//! Every path reuses `spill.rs`: [`validated_subdir`] per directory,
//! [`open_excl`] for every new file, `symlink_metadata` real-file re-checks
//! before a read, and [`compose_subagent_result`] to bound the dep inputs
//! delivered inline to a claiming worker.

use std::io::Write;
use std::path::{Path, PathBuf};

use crate::tools::sandbox::scratch_display_path;
use crate::tools::spill::{compose_subagent_result, open_excl, validated_subdir};

/// Scratch subdirectory holding the whole queue.
pub const WORKQUEUE_DIR: &str = "workqueue";
/// Cap on open (not-yet-done) items, so a runaway poster cannot flood scratch
/// or the display snapshot.
pub const WORKQUEUE_MAX_OPEN: usize = 256;
/// A claim older than this (with no completion) is reclaimable even if the
/// claimer's liveness cannot be read, so a hard-killed worker never wedges an
/// item forever.
pub const CLAIM_LEASE_SECS: u64 = 300;
/// Cap on the id-minting retry loop under concurrent posters.
const POST_ATTEMPTS: u64 = 1024;

/// Display/wire view of one work item. Mirrors `MonitorSnapshot`'s role: the
/// payload of `StreamEvent::WorkQueue`, the `list_work` return, and the Cowork
/// rail row all read this one shape.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemView {
    pub work_id: String,
    pub title: String,
    /// `open` (ready, unclaimed) | `claimed` | `done` | `failed` | `blocked`.
    pub state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claimed_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// The outcome of a `claim_work` call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClaimOutcome {
    /// An item was claimed by the caller; `deps_results` carries each dep's
    /// completed result, inline-bounded via [`compose_subagent_result`].
    Claimed {
        work_id: String,
        task: String,
        deps_results: Vec<(String, String)>,
    },
    /// Nothing is ready and nothing is waiting: the worker should stop.
    Empty,
    /// Every ready-looking item is waiting on an in-progress dep; the worker
    /// should stop and let the main agent re-dispatch when a dep completes.
    Blocked(Vec<String>),
    /// The queue could not be opened.
    Error(String),
}

#[derive(serde::Serialize, serde::Deserialize)]
struct OpenSpec {
    work_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    task: String,
    #[serde(default)]
    deps: Vec<String>,
    posted_by: String,
    posted_at: u64,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ClaimMarker {
    work_id: String,
    claimed_by: String,
    claimed_at: u64,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct DoneMarker {
    work_id: String,
    by: String,
    ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    result_file: Option<String>,
    done_at: u64,
}

/// `w-<n>` shape, so a weak model can name it in `deps`.
pub fn is_work_id(id: &str) -> bool {
    id.len() <= 24 && work_id_num(id).is_some()
}

fn work_id_num(id: &str) -> Option<u64> {
    id.strip_prefix("w-").and_then(|n| n.parse::<u64>().ok())
}

fn ensure_dirs(scratch: &Path) -> Option<(PathBuf, PathBuf, PathBuf)> {
    let base = validated_subdir(scratch, WORKQUEUE_DIR)?;
    let open = validated_subdir(&base, "open")?;
    let claimed = validated_subdir(&base, "claimed")?;
    let done = validated_subdir(&base, "done")?;
    Some((open, claimed, done))
}

fn write_new_json<T: serde::Serialize>(path: &Path, value: &T) -> std::io::Result<()> {
    let mut file = open_excl(path)?;
    let bytes = serde_json::to_vec(value)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    file.write_all(&bytes)
}

fn read_real_json<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    match std::fs::symlink_metadata(path) {
        Ok(m) if m.is_file() && !m.file_type().is_symlink() => {
            let raw = std::fs::read_to_string(path).ok()?;
            serde_json::from_str(&raw).ok()
        }
        _ => None,
    }
}

fn is_real_file(path: &Path) -> bool {
    matches!(
        std::fs::symlink_metadata(path),
        Ok(m) if m.is_file() && !m.file_type().is_symlink()
    )
}

fn open_spec(open_dir: &Path, id: &str) -> Option<OpenSpec> {
    read_real_json(&open_dir.join(format!("{id}.json")))
}

fn done_marker(done_dir: &Path, id: &str) -> Option<DoneMarker> {
    read_real_json(&done_dir.join(format!("{id}.done.json")))
}

fn claim_marker(claimed_dir: &Path, id: &str) -> Option<ClaimMarker> {
    read_real_json(&claimed_dir.join(format!("{id}.json")))
}

/// All open-item ids, ascending by numeric suffix.
fn open_ids(open_dir: &Path) -> Vec<(u64, String)> {
    let mut ids = Vec::new();
    if let Ok(rd) = std::fs::read_dir(open_dir) {
        for entry in rd.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if let Some(stem) = name.strip_suffix(".json") {
                    if let Some(n) = work_id_num(stem) {
                        ids.push((n, stem.to_string()));
                    }
                }
            }
        }
    }
    ids.sort_by_key(|(n, _)| *n);
    ids
}

/// Highest numeric id across all three dirs, so the next post is contiguous.
fn max_existing(open: &Path, claimed: &Path, done: &Path) -> u64 {
    let mut max = 0u64;
    for dir in [open, claimed, done] {
        if let Ok(rd) = std::fs::read_dir(dir) {
            for entry in rd.flatten() {
                if let Some(name) = entry.file_name().to_str() {
                    let stem = name.split('.').next().unwrap_or(name);
                    if let Some(n) = work_id_num(stem) {
                        max = max.max(n);
                    }
                }
            }
        }
    }
    max
}

enum DepState {
    Satisfied,
    Failed,
    InProgress,
}

fn dep_state(done_dir: &Path, dep: &str) -> DepState {
    match done_marker(done_dir, dep) {
        Some(m) if m.ok => DepState::Satisfied,
        Some(_) => DepState::Failed,
        None => DepState::InProgress,
    }
}

/// Post a new item. `deps` must each name an already-posted work id (which is
/// what makes cycles impossible: a dep can only point at a lower id that already
/// exists). Returns the minted `w-<n>` id.
pub fn post_work_file(
    scratch: &Path,
    task: &str,
    deps: &[String],
    title: Option<&str>,
    posted_by: &str,
    now: u64,
) -> Result<String, String> {
    let task = task.trim();
    if task.is_empty() {
        return Err("post_work requires a non-empty 'task'".to_string());
    }
    let (open_dir, claimed_dir, done_dir) =
        ensure_dirs(scratch).ok_or("could not open the work queue")?;

    let open_count = open_ids(&open_dir)
        .into_iter()
        .filter(|(_, id)| done_marker(&done_dir, id).is_none())
        .count();
    if open_count >= WORKQUEUE_MAX_OPEN {
        return Err(format!(
            "the work queue is full ({WORKQUEUE_MAX_OPEN} open items); complete or wait for some first"
        ));
    }

    for dep in deps {
        if !is_work_id(dep) || !is_real_file(&open_dir.join(format!("{dep}.json"))) {
            return Err(format!(
                "unknown dep {dep}; deps must reference an already-posted work id"
            ));
        }
    }

    let title = title
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_string);
    let mut n = max_existing(&open_dir, &claimed_dir, &done_dir) + 1;
    for _ in 0..POST_ATTEMPTS {
        let id = format!("w-{n}");
        let spec = OpenSpec {
            work_id: id.clone(),
            title: title.clone(),
            task: task.to_string(),
            deps: deps.to_vec(),
            posted_by: posted_by.to_string(),
            posted_at: now,
        };
        match write_new_json(&open_dir.join(format!("{id}.json")), &spec) {
            Ok(()) => return Ok(id),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                n += 1;
                continue;
            }
            Err(_) => return Err("could not write the work item".to_string()),
        }
    }
    Err("could not allocate a work id".to_string())
}

/// Claim the top ready item for `claimer`. `claimer_alive` reports whether a
/// prior claimer is still running (its status header is present and not
/// terminal), so a stale claim can be reclaimed.
pub fn claim_work_file(
    scratch: &Path,
    claimer: &str,
    now: u64,
    claimer_alive: &dyn Fn(&str) -> bool,
) -> ClaimOutcome {
    let (open_dir, claimed_dir, done_dir) = match ensure_dirs(scratch) {
        Some(d) => d,
        None => return ClaimOutcome::Error("could not open the work queue".to_string()),
    };
    let mut blocked: Vec<String> = Vec::new();
    for (_, id) in open_ids(&open_dir) {
        if done_marker(&done_dir, &id).is_some() {
            continue;
        }
        let Some(spec) = open_spec(&open_dir, &id) else {
            continue;
        };

        let mut failed_dep: Option<String> = None;
        let mut in_progress: Vec<String> = Vec::new();
        for dep in &spec.deps {
            match dep_state(&done_dir, dep) {
                DepState::Satisfied => {}
                DepState::Failed => {
                    failed_dep = Some(dep.clone());
                    break;
                }
                DepState::InProgress => in_progress.push(dep.clone()),
            }
        }
        if let Some(dep) = failed_dep {
            // Unsatisfiable: fail it so its own dependents fail transitively
            // rather than blocking forever. A lost race on the marker is fine.
            let _ = write_done(
                &done_dir,
                &id,
                claimer,
                false,
                Some(&format!("dep {dep} failed")),
                None,
                now,
            );
            continue;
        }

        let claim_path = claimed_dir.join(format!("{id}.json"));
        if let Some(marker) = claim_marker(&claimed_dir, &id) {
            let expired = now.saturating_sub(marker.claimed_at) >= CLAIM_LEASE_SECS;
            let dead = !claimer_alive(&marker.claimed_by);
            if expired || dead {
                let _ = std::fs::remove_file(&claim_path);
            } else {
                continue;
            }
        }

        if !in_progress.is_empty() {
            blocked.extend(in_progress);
            continue;
        }

        let marker = ClaimMarker {
            work_id: id.clone(),
            claimed_by: claimer.to_string(),
            claimed_at: now,
        };
        match write_new_json(&claim_path, &marker) {
            Ok(()) => {
                let deps_results = build_deps_results(scratch, &done_dir, &spec.deps);
                return ClaimOutcome::Claimed {
                    work_id: id,
                    task: spec.task,
                    deps_results,
                };
            }
            Err(_) => continue, // lost the race; try the next item
        }
    }
    if blocked.is_empty() {
        ClaimOutcome::Empty
    } else {
        blocked.sort();
        blocked.dedup();
        ClaimOutcome::Blocked(blocked)
    }
}

fn build_deps_results(scratch: &Path, done_dir: &Path, deps: &[String]) -> Vec<(String, String)> {
    deps.iter()
        .filter_map(|dep| {
            let path = done_dir.join(format!("{dep}.result.md"));
            let body = read_real_string(&path)?;
            let display = scratch_display_path(Some(scratch), &path);
            Some((dep.clone(), compose_subagent_result(&body, Some(&display))))
        })
        .collect()
}

fn read_real_string(path: &Path) -> Option<String> {
    match std::fs::symlink_metadata(path) {
        Ok(m) if m.is_file() && !m.file_type().is_symlink() => std::fs::read_to_string(path).ok(),
        _ => None,
    }
}

/// Complete an item `completer` holds a claim on, writing its result body and a
/// success marker. Refused unless the caller owns the claim and the item is not
/// already done.
pub fn complete_work_file(
    scratch: &Path,
    work_id: &str,
    completer: &str,
    result: &str,
    now: u64,
) -> Result<(), String> {
    if !is_work_id(work_id) {
        return Err(format!("invalid work id {work_id}"));
    }
    let (_open_dir, claimed_dir, done_dir) =
        ensure_dirs(scratch).ok_or("could not open the work queue")?;
    let Some(marker) = claim_marker(&claimed_dir, work_id) else {
        return Err(format!("{work_id} is not claimed by you; claim it first"));
    };
    if marker.claimed_by != completer {
        return Err(format!(
            "{work_id} is claimed by {}, not you",
            marker.claimed_by
        ));
    }
    if done_marker(&done_dir, work_id).is_some() {
        return Err(format!("{work_id} is already completed"));
    }
    let result_name = format!("{work_id}.result.md");
    let result_path = done_dir.join(&result_name);
    match open_excl(&result_path) {
        Ok(mut f) => {
            if f.write_all(result.as_bytes()).is_err() {
                return Err("could not write the result body".to_string());
            }
        }
        Err(_) => return Err("could not write the result body".to_string()),
    }
    write_done(
        &done_dir,
        work_id,
        completer,
        true,
        None,
        Some(&result_name),
        now,
    )
    .map_err(|_| "could not write the completion marker".to_string())
}

#[allow(clippy::too_many_arguments)]
fn write_done(
    done_dir: &Path,
    work_id: &str,
    by: &str,
    ok: bool,
    reason: Option<&str>,
    result_file: Option<&str>,
    now: u64,
) -> std::io::Result<()> {
    let marker = DoneMarker {
        work_id: work_id.to_string(),
        by: by.to_string(),
        ok,
        reason: reason.map(str::to_string),
        result_file: result_file.map(str::to_string),
        done_at: now,
    };
    write_new_json(&done_dir.join(format!("{work_id}.done.json")), &marker)
}

/// Terminal-path sweep: fail every item `run_id` still holds an uncompleted
/// claim on, so a worker that ended without `complete_work` does not wedge its
/// dependents. Returns the number failed.
pub fn fail_owned_claims(scratch: &Path, run_id: &str, now: u64) -> usize {
    let Some((_open, claimed_dir, done_dir)) = ensure_dirs(scratch) else {
        return 0;
    };
    let mut failed = 0;
    if let Ok(rd) = std::fs::read_dir(&claimed_dir) {
        for entry in rd.flatten() {
            let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            let Some(id) = name.strip_suffix(".json") else {
                continue;
            };
            let Some(marker) = claim_marker(&claimed_dir, id) else {
                continue;
            };
            if marker.claimed_by != run_id || done_marker(&done_dir, id).is_some() {
                continue;
            }
            if write_done(
                &done_dir,
                id,
                run_id,
                false,
                Some("worker ended without completing"),
                None,
                now,
            )
            .is_ok()
            {
                failed += 1;
            }
        }
    }
    failed
}

/// Every item's current view, ascending by id. Cheap: three small-dir reads, no
/// transcript I/O.
pub fn list_work_dir(scratch: &Path) -> Vec<WorkItemView> {
    let Some((open_dir, claimed_dir, done_dir)) = ensure_dirs(scratch) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (_, id) in open_ids(&open_dir) {
        let Some(spec) = open_spec(&open_dir, &id) else {
            continue;
        };
        let title = spec
            .title
            .clone()
            .unwrap_or_else(|| truncate_title(&spec.task));
        let (state, claimed_by, reason) = classify(&claimed_dir, &done_dir, &id, &spec.deps);
        out.push(WorkItemView {
            work_id: id,
            title,
            state,
            claimed_by,
            reason,
        });
    }
    out
}

fn classify(
    claimed_dir: &Path,
    done_dir: &Path,
    id: &str,
    deps: &[String],
) -> (String, Option<String>, Option<String>) {
    if let Some(m) = done_marker(done_dir, id) {
        if m.ok {
            return ("done".to_string(), None, None);
        }
        return ("failed".to_string(), None, m.reason);
    }
    // Deps drive readiness even for a claimed item's display reason.
    let mut failed_dep = None;
    let mut waiting = Vec::new();
    for dep in deps {
        match dep_state(done_dir, dep) {
            DepState::Satisfied => {}
            DepState::Failed => {
                failed_dep = Some(dep.clone());
                break;
            }
            DepState::InProgress => waiting.push(dep.clone()),
        }
    }
    if let Some(dep) = failed_dep {
        return (
            "failed".to_string(),
            None,
            Some(format!("dep {dep} failed")),
        );
    }
    if let Some(marker) = claim_marker(claimed_dir, id) {
        return ("claimed".to_string(), Some(marker.claimed_by), None);
    }
    if !waiting.is_empty() {
        return (
            "blocked".to_string(),
            None,
            Some(format!("waiting on {}", waiting.join(", "))),
        );
    }
    ("open".to_string(), None, None)
}

fn truncate_title(task: &str) -> String {
    let flat: String = task.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= 60 {
        return flat;
    }
    let head: String = flat.chars().take(57).collect();
    format!("{head}...")
}

/// The four loop-dispatched work-queue tool names (not built-ins).
pub const POST_WORK_TOOL: &str = "post_work";
pub const CLAIM_WORK_TOOL: &str = "claim_work";
pub const COMPLETE_WORK_TOOL: &str = "complete_work";
pub const LIST_WORK_TOOL: &str = "list_work";

/// Whether `name` is one of the four work-queue tools.
pub fn is_work_tool(name: &str) -> bool {
    matches!(
        name,
        POST_WORK_TOOL | CLAIM_WORK_TOOL | COMPLETE_WORK_TOOL | LIST_WORK_TOOL
    )
}

/// Whether `name` mutates the queue (`post`/`claim`/`complete`), so Plan mode
/// must deny it. `list_work` is read-only and stays allowed.
pub fn is_work_mutation(name: &str) -> bool {
    matches!(name, POST_WORK_TOOL | CLAIM_WORK_TOOL | COMPLETE_WORK_TOOL)
}

/// OpenAI tool schemas for the four work-queue tools. Deliberately tiny arg
/// surfaces (weak local models choke on rich schemas, the monitor lesson).
pub fn work_tool_schemas() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "type": "function",
            "function": {
                "name": POST_WORK_TOOL,
                "description": "Post a task to the shared work queue for a worker to pick up. Fan out independent work by posting several, then dispatching generic workers that each claim and complete one. deps names work ids whose results this task needs (each must already be posted); the task is claimable only once they finish, and their results are handed to whoever claims it. Returns the new work id.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "task": { "type": "string", "description": "What the worker should do, self-contained." },
                        "deps": { "type": "array", "items": {"type": "string"}, "description": "Work ids (e.g. [\"w-1\"]) this task depends on; each must already be posted. Optional." },
                        "title": { "type": "string", "description": "Optional short label shown on the queue (defaults to the task)." }
                    },
                    "required": ["task"]
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": CLAIM_WORK_TOOL,
                "description": "Claim the next ready task from the shared work queue and receive its instructions and any dependency results. Call this as a worker: claim, do the work, then complete_work. If it reports nothing is ready, stop -- you will be pinged when new work appears; do not loop on it.",
                "parameters": { "type": "object", "properties": {} }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": COMPLETE_WORK_TOOL,
                "description": "Report the result of a work item you claimed. Its result is saved and delivered to anything that depends on it. You must have claimed the item first.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "work_id": { "type": "string", "description": "The id you claimed (from claim_work)." },
                        "result": { "type": "string", "description": "The finished result for this item." }
                    },
                    "required": ["work_id", "result"]
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": LIST_WORK_TOOL,
                "description": "List every item on the shared work queue with its state (open, claimed, done, failed, blocked), so you can see what is ready to dispatch and what is still in flight.",
                "parameters": { "type": "object", "properties": {} }
            }
        }),
    ]
}

/// What a work-tool call did, so the caller can ring the doorbell, refresh the
/// queue snapshot, and update its own status header.
pub struct WorkToolResult {
    /// The model-facing tool-result string.
    pub message: String,
    /// A `post_work` succeeded, so a parked main should be woken.
    pub posted: bool,
    /// The work id a `claim_work` just handed the caller, for its status header.
    pub claimed: Option<String>,
}

fn parse_string_array(v: Option<&serde_json::Value>) -> Vec<String> {
    v.and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// Run one work-queue tool call and format its model-facing result. `agent_id`
/// is the caller's run id (`"main"` or a `sub-...` id): the poster, claimer, and
/// completer of record. `now` is epoch seconds. Shared by the CLI loop and the
/// desktop/Cowork command layer so both surfaces format identically.
pub fn run_work_tool(
    scratch: &Path,
    name: &str,
    args: &serde_json::Value,
    agent_id: &str,
    now: u64,
) -> WorkToolResult {
    let bare = |message: String| WorkToolResult {
        message,
        posted: false,
        claimed: None,
    };
    match name {
        POST_WORK_TOOL => {
            let task = args.get("task").and_then(|v| v.as_str()).unwrap_or("");
            let deps = parse_string_array(args.get("deps"));
            let title = args.get("title").and_then(|v| v.as_str());
            match post_work_file(scratch, task, &deps, title, agent_id, now) {
                Ok(id) => WorkToolResult {
                    message: format!(
                        "Posted {id} to the work queue. Dispatch a worker to claim it (or an idle \
                         worker will pick it up)."
                    ),
                    posted: true,
                    claimed: None,
                },
                Err(e) => bare(format!("ERROR: {e}")),
            }
        }
        CLAIM_WORK_TOOL => {
            let alive = |id: &str| {
                crate::tools::observ::read_status(scratch, id)
                    .map(|s| {
                        s.state != crate::tools::observ::STATE_DONE
                            && s.state != crate::tools::observ::STATE_FAILED
                    })
                    .unwrap_or(false)
            };
            match claim_work_file(scratch, agent_id, now, &alive) {
                ClaimOutcome::Claimed {
                    work_id,
                    task,
                    deps_results,
                } => {
                    let mut message = format!("You claimed {work_id}.\n\nTask:\n{task}");
                    for (dep, body) in deps_results {
                        message.push_str(&format!("\n\n--- result of {dep} ---\n{body}"));
                    }
                    message.push_str(
                        "\n\nDo the work, then call complete_work with this work_id and your result.",
                    );
                    WorkToolResult {
                        message,
                        posted: false,
                        claimed: Some(work_id),
                    }
                }
                ClaimOutcome::Empty => bare(
                    "No work is ready right now. Stop and wait -- you will be pinged when new work \
                     is ready. Do not call claim_work again in a loop."
                        .to_string(),
                ),
                ClaimOutcome::Blocked(deps) => bare(format!(
                    "The remaining work is waiting on unfinished dependencies ({}). Stop; the main \
                     agent re-dispatches when they complete.",
                    deps.join(", ")
                )),
                ClaimOutcome::Error(e) => bare(format!("ERROR: {e}")),
            }
        }
        COMPLETE_WORK_TOOL => {
            let work_id = args.get("work_id").and_then(|v| v.as_str()).unwrap_or("");
            let result = args.get("result").and_then(|v| v.as_str()).unwrap_or("");
            match complete_work_file(scratch, work_id, agent_id, result, now) {
                Ok(()) => bare(format!(
                    "Completed {work_id}. Its result is now available to any dependent work."
                )),
                Err(e) => bare(format!("ERROR: {e}")),
            }
        }
        LIST_WORK_TOOL => bare(format_work_list(&list_work_dir(scratch))),
        _ => bare("ERROR: unknown work tool".to_string()),
    }
}

fn format_work_list(items: &[WorkItemView]) -> String {
    if items.is_empty() {
        return "The work queue is empty.".to_string();
    }
    let mut out = String::from("Work queue:");
    for it in items {
        out.push_str(&format!("\n- {} [{}] {}", it.work_id, it.state, it.title));
        if let Some(who) = &it.claimed_by {
            out.push_str(&format!(" (claimed by {who})"));
        }
        if let Some(reason) = &it.reason {
            out.push_str(&format!(" ({reason})"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn tmp(tag: &str) -> PathBuf {
        static N: AtomicUsize = AtomicUsize::new(0);
        let n = N.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("jan-workq-{tag}-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn alive_always(_: &str) -> bool {
        true
    }

    fn state_of(scratch: &Path, id: &str) -> String {
        list_work_dir(scratch)
            .into_iter()
            .find(|v| v.work_id == id)
            .map(|v| v.state)
            .unwrap_or_default()
    }

    #[test]
    fn ids_are_contiguous_and_validated() {
        assert!(is_work_id("w-1"));
        assert!(is_work_id("w-42"));
        assert!(!is_work_id("w-"));
        assert!(!is_work_id("x-1"));
        assert!(!is_work_id("w-1a"));
        let scratch = tmp("ids");
        let a = post_work_file(&scratch, "first", &[], None, "main", 1).unwrap();
        let b = post_work_file(&scratch, "second", &[], None, "main", 1).unwrap();
        assert_eq!(a, "w-1");
        assert_eq!(b, "w-2");
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn a_claimed_item_cannot_be_double_claimed() {
        let scratch = tmp("double");
        post_work_file(&scratch, "solo", &[], None, "main", 1).unwrap();
        let first = claim_work_file(&scratch, "sub-a-1", 1, &alive_always);
        assert!(matches!(first, ClaimOutcome::Claimed { .. }));
        let second = claim_work_file(&scratch, "sub-b-1", 1, &alive_always);
        assert_eq!(second, ClaimOutcome::Empty, "a live claim is not re-handed");
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn producer_consumer_handoff_via_deps() {
        let scratch = tmp("deps");
        let producer = post_work_file(&scratch, "gather data", &[], None, "main", 1).unwrap();
        let consumer = post_work_file(
            &scratch,
            "summarize the data",
            &[producer.clone()],
            None,
            "main",
            1,
        )
        .unwrap();
        // The consumer is blocked until the producer completes.
        let blocked = claim_work_file(&scratch, "sub-b-1", 1, &alive_always);
        // sub-a can take the producer; then the outcome is either the producer
        // itself (claimed) or, if producer already claimed, blocked. Here fresh:
        match blocked {
            ClaimOutcome::Claimed { work_id, .. } => assert_eq!(work_id, producer),
            other => panic!("expected the producer to be claimable, got {other:?}"),
        }
        // Consumer still blocked on the in-progress producer.
        let still = claim_work_file(&scratch, "sub-c-1", 1, &alive_always);
        assert_eq!(still, ClaimOutcome::Blocked(vec![producer.clone()]));
        // Producer completes; now the consumer is claimable with the dep result.
        complete_work_file(&scratch, &producer, "sub-b-1", "the gathered data", 2).unwrap();
        let claimed = claim_work_file(&scratch, "sub-c-1", 2, &alive_always);
        match claimed {
            ClaimOutcome::Claimed {
                work_id,
                deps_results,
                ..
            } => {
                assert_eq!(work_id, consumer);
                assert_eq!(deps_results.len(), 1);
                assert_eq!(deps_results[0].0, producer);
                assert!(deps_results[0].1.contains("the gathered data"));
            }
            other => panic!("expected the consumer, got {other:?}"),
        }
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn unknown_dep_is_rejected_synchronously() {
        let scratch = tmp("baddep");
        let err = post_work_file(&scratch, "x", &["w-9".to_string()], None, "main", 1).unwrap_err();
        assert!(err.contains("unknown dep w-9"), "{err}");
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn a_failed_dep_fails_its_dependent_transitively() {
        let scratch = tmp("transfail");
        let a = post_work_file(&scratch, "risky", &[], None, "main", 1).unwrap();
        let b = post_work_file(&scratch, "needs a", &[a.clone()], None, "main", 1).unwrap();
        let _c = post_work_file(&scratch, "needs b", &[b.clone()], None, "main", 1).unwrap();
        // a is claimed then its worker dies without completing.
        let claimed = claim_work_file(&scratch, "sub-a-1", 1, &alive_always);
        assert!(matches!(claimed, ClaimOutcome::Claimed { .. }));
        assert_eq!(fail_owned_claims(&scratch, "sub-a-1", 2), 1);
        assert_eq!(state_of(&scratch, &a), "failed");
        // Claiming now fails b (its dep a failed), and c fails after b.
        let outcome = claim_work_file(&scratch, "sub-b-1", 3, &alive_always);
        assert_eq!(
            outcome,
            ClaimOutcome::Empty,
            "nothing claimable, all failed"
        );
        assert_eq!(state_of(&scratch, &b), "failed");
        assert_eq!(state_of(&scratch, &_c), "failed");
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn a_stale_claim_is_reclaimed() {
        let scratch = tmp("lease");
        let a = post_work_file(&scratch, "solo", &[], None, "main", 1).unwrap();
        let first = claim_work_file(&scratch, "sub-a-1", 1, &alive_always);
        assert!(matches!(first, ClaimOutcome::Claimed { .. }));
        // Same instant, claimer reported dead: reclaimable.
        let dead = |_: &str| false;
        let second = claim_work_file(&scratch, "sub-b-1", 1, &dead);
        match second {
            ClaimOutcome::Claimed { work_id, .. } => assert_eq!(work_id, a),
            other => panic!("expected reclaim, got {other:?}"),
        }
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn an_expired_lease_is_reclaimed_even_if_alive() {
        let scratch = tmp("expire");
        post_work_file(&scratch, "solo", &[], None, "main", 100).unwrap();
        let first = claim_work_file(&scratch, "sub-a-1", 100, &alive_always);
        assert!(matches!(first, ClaimOutcome::Claimed { .. }));
        let later = 100 + CLAIM_LEASE_SECS + 1;
        let second = claim_work_file(&scratch, "sub-b-1", later, &alive_always);
        assert!(matches!(second, ClaimOutcome::Claimed { .. }), "{second:?}");
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_redirected_workqueue_dir() {
        let scratch = tmp("redirect");
        let target = tmp("redirect-target");
        std::os::unix::fs::symlink(&target, scratch.join(WORKQUEUE_DIR)).unwrap();
        assert!(post_work_file(&scratch, "x", &[], None, "main", 1).is_err());
        let _ = std::fs::remove_dir_all(&scratch);
        let _ = std::fs::remove_dir_all(&target);
    }

    #[test]
    fn complete_is_refused_for_a_non_owner() {
        let scratch = tmp("owner");
        let a = post_work_file(&scratch, "solo", &[], None, "main", 1).unwrap();
        claim_work_file(&scratch, "sub-a-1", 1, &alive_always);
        let err = complete_work_file(&scratch, &a, "sub-b-1", "sneaky", 2).unwrap_err();
        assert!(err.contains("claimed by sub-a-1"), "{err}");
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn list_reports_states() {
        let scratch = tmp("list");
        let a = post_work_file(&scratch, "one", &[], Some("first"), "main", 1).unwrap();
        let b = post_work_file(&scratch, "two", &[a.clone()], None, "main", 1).unwrap();
        // a open (ready), b blocked (dep a in progress).
        assert_eq!(state_of(&scratch, &a), "open");
        assert_eq!(state_of(&scratch, &b), "blocked");
        claim_work_file(&scratch, "sub-a-1", 1, &alive_always);
        assert_eq!(state_of(&scratch, &a), "claimed");
        complete_work_file(&scratch, &a, "sub-a-1", "result", 2).unwrap();
        assert_eq!(state_of(&scratch, &a), "done");
        assert_eq!(state_of(&scratch, &b), "open", "b ready once a is done");
        let view = list_work_dir(&scratch)
            .into_iter()
            .find(|v| v.work_id == a)
            .unwrap();
        assert_eq!(view.title, "first");
        let _ = std::fs::remove_dir_all(&scratch);
    }
}
