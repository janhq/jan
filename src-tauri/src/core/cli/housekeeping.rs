//! Automatic pruning of a project's saved threads.
//!
//! Every agent session writes a thread under `<store>/threads/<id>/` and nothing
//! ever removes one, so a busy project's store grows without bound and every
//! `/resume` picker and `list_threads_in` scan gets slower with it. This drops
//! threads that are both old and beyond the newest few, on the two knobs
//! `agent.toml` exposes (`thread_retention_days`, `max_threads`).
//!
//! Deliberately conservative, because a deleted thread is not recoverable:
//! - nothing runs unless the user turned it on (`prune_threads = true` in
//!   `~/.jan/config.toml`);
//! - a thread is removed only when a limit condemns it, and the newest
//!   [`MIN_KEEP`] are never touched whatever the limits say;
//! - the thread this session is running or resumed is always kept;
//! - a thread that owns a git worktree is kept (its checkout is real work), as
//!   is a thread some kept thread was forked from, so a fork never dangles;
//! - a thread with no `updated`/`created` stamp is kept, since its age is unknown.
//!
//! Subagent transcripts live in the session scratch, which the startup scratch
//! sweep already collects, so they need no handling here.

use std::collections::HashSet;
use std::path::Path;

use serde_json::Value;

/// Default age past which a thread is a candidate for removal, once pruning is
/// switched on (`prune_threads` in `~/.jan/config.toml`; off by default).
pub const DEFAULT_RETENTION_DAYS: u32 = 90;

/// Default cap on how many threads a project keeps.
pub const DEFAULT_MAX_THREADS: u32 = 500;

/// The newest threads that are never pruned, whatever the limits say, so a
/// mistyped `thread_retention_days = 1` cannot empty the store.
pub const MIN_KEEP: usize = 10;

/// Limits resolved from `agent.toml`. A value of 0 disables that limit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Policy {
    pub retention_days: u32,
    pub max_threads: u32,
}

impl Policy {
    pub fn from_config(retention_days: Option<u32>, max_threads: Option<u32>) -> Self {
        Self {
            retention_days: retention_days.unwrap_or(DEFAULT_RETENTION_DAYS),
            max_threads: max_threads.unwrap_or(DEFAULT_MAX_THREADS),
        }
    }
}

fn id_of(thread: &Value) -> Option<&str> {
    thread.get("id").and_then(Value::as_str)
}

/// Which thread ids `policy` condemns. Pure: same threads and clock, same answer.
///
/// `protect` holds the ids that must survive regardless (the live session).
/// `now_secs` is the clock in the same unit as a thread's `updated` field.
pub fn plan(
    threads: &[Value],
    now_secs: f64,
    policy: Policy,
    protect: &HashSet<String>,
) -> Vec<String> {
    let mut order: Vec<&Value> = threads.iter().filter(|t| id_of(t).is_some()).collect();
    order.sort_by(|a, b| {
        super::thread_recency(b)
            .partial_cmp(&super::thread_recency(a))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let cutoff = (policy.retention_days > 0)
        .then(|| now_secs - f64::from(policy.retention_days) * 86_400.0);
    let mut condemned: HashSet<&str> = HashSet::new();
    for (rank, thread) in order.iter().enumerate() {
        let Some(id) = id_of(thread) else { continue };
        if rank < MIN_KEEP || protect.contains(id) || has_worktree(thread) || !is_stamped(thread) {
            continue;
        }
        let too_old = cutoff.is_some_and(|c| super::thread_recency(thread) < c);
        let over_cap = policy.max_threads > 0 && rank >= policy.max_threads as usize;
        if too_old || over_cap {
            condemned.insert(id);
        }
    }

    // A kept fork must not lose the thread it branched from. Deleting through a
    // chain can expose a new parent, so repeat until nothing more is spared.
    loop {
        let spared: Vec<&str> = order
            .iter()
            .filter(|t| id_of(t).is_some_and(|id| !condemned.contains(id)))
            .filter_map(|t| super::forked_parent(t))
            .filter(|parent| condemned.contains(parent))
            .collect();
        if spared.is_empty() {
            break;
        }
        for parent in spared {
            condemned.remove(parent);
        }
    }

    order
        .iter()
        .filter_map(|t| id_of(t))
        .filter(|id| condemned.contains(id))
        .map(str::to_string)
        .collect()
}

/// Whether `thread` says when it was last touched. One that does not has an
/// unknown age, and sorting would rank it as ancient; a deletion must not rest
/// on a guess, so it is kept.
fn is_stamped(thread: &Value) -> bool {
    ["updated", "created"]
        .iter()
        .any(|key| thread.get(key).and_then(Value::as_f64).is_some())
}

fn has_worktree(thread: &Value) -> bool {
    thread
        .get("metadata")
        .and_then(|m| m.get(super::worktree::WORKTREE_KEY))
        .is_some_and(|w| !w.is_null())
}

/// Prune `base`'s threads under `policy`, returning how many were removed.
/// Failures are per-thread and silent: housekeeping is best-effort and must
/// never stop a session from starting.
pub fn run(base: &Path, policy: Policy, protect: &HashSet<String>) -> usize {
    let Ok(threads) = super::list_threads_in(base) else {
        return 0;
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64();
    let mut removed = 0;
    for id in plan(&threads, now, policy, protect) {
        let dir = crate::core::threads::utils::get_thread_dir(base, &id);
        if std::fs::remove_dir_all(&dir).is_ok() {
            crate::core::agent::git::cleanup_snapshot_index(&id);
            removed += 1;
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const DAY: f64 = 86_400.0;
    const NOW: f64 = 1_000.0 * DAY;

    fn t(id: &str, age_days: f64) -> Value {
        json!({ "id": id, "updated": NOW - age_days * DAY, "metadata": {} })
    }

    fn none() -> HashSet<String> {
        HashSet::new()
    }

    fn policy(days: u32, max: u32) -> Policy {
        Policy {
            retention_days: days,
            max_threads: max,
        }
    }

    /// `n` fresh threads, so the age/cap conditions under test have a
    /// [`MIN_KEEP`] floor already satisfied above them.
    fn floor() -> Vec<Value> {
        (0..MIN_KEEP).map(|i| t(&format!("new{i}"), 0.0)).collect()
    }

    #[test]
    fn old_threads_beyond_the_floor_go() {
        let mut threads = floor();
        threads.push(t("old", 200.0));
        threads.push(t("recent", 5.0));
        assert_eq!(plan(&threads, NOW, policy(90, 0), &none()), vec!["old"]);
    }

    #[test]
    fn the_newest_are_never_pruned_even_when_all_are_old() {
        let threads: Vec<Value> = (0..MIN_KEEP)
            .map(|i| t(&format!("t{i}"), 500.0 + i as f64))
            .collect();
        assert!(plan(&threads, NOW, policy(1, 0), &none()).is_empty());
    }

    #[test]
    fn the_cap_drops_the_oldest_past_it() {
        let mut threads = floor();
        threads.push(t("a", 1.0));
        threads.push(t("b", 2.0));
        threads.push(t("c", 3.0));
        // Cap of 11 keeps the floor plus the single newest extra.
        assert_eq!(plan(&threads, NOW, policy(0, 11), &none()), vec!["b", "c"]);
    }

    #[test]
    fn zero_disables_a_limit() {
        let mut threads = floor();
        threads.push(t("ancient", 9_000.0));
        assert!(plan(&threads, NOW, policy(0, 0), &none()).is_empty());
    }

    #[test]
    fn a_protected_thread_survives_its_age() {
        let mut threads = floor();
        threads.push(t("resumed", 400.0));
        let protect: HashSet<String> = ["resumed".to_string()].into();
        assert!(plan(&threads, NOW, policy(90, 0), &protect).is_empty());
    }

    #[test]
    fn a_thread_with_a_worktree_is_kept() {
        let mut threads = floor();
        let mut wt = t("wt", 400.0);
        wt["metadata"] = json!({ super::super::worktree::WORKTREE_KEY: { "path": "/x" } });
        threads.push(wt);
        assert!(plan(&threads, NOW, policy(90, 0), &none()).is_empty());
    }

    #[test]
    fn a_kept_fork_spares_the_thread_it_came_from() {
        let mut threads = floor();
        threads.push(t("parent", 400.0));
        let mut fork = t("fork", 1.0);
        fork["metadata"] = json!({
            super::super::FORKED_FROM_KEY: { "thread_id": "parent" }
        });
        threads.push(fork);
        assert!(plan(&threads, NOW, policy(90, 0), &none()).is_empty());
    }

    #[test]
    fn the_policy_defaults_apply_when_the_config_is_silent() {
        let p = Policy::from_config(None, None);
        assert_eq!(p.retention_days, DEFAULT_RETENTION_DAYS);
        assert_eq!(p.max_threads, DEFAULT_MAX_THREADS);
        let p = Policy::from_config(Some(7), Some(0));
        assert_eq!((p.retention_days, p.max_threads), (7, 0));
    }

    /// A chain of forks: keeping the newest keeps its parent, which in turn
    /// keeps the grandparent, however old they are.
    #[test]
    fn a_kept_fork_chain_spares_every_ancestor() {
        let mut threads = floor();
        let fork_of = |id: &str, age: f64, parent: &str| {
            let mut f = t(id, age);
            f["metadata"] = json!({ super::super::FORKED_FROM_KEY: { "thread_id": parent } });
            f
        };
        threads.push(t("root", 500.0));
        threads.push(fork_of("mid", 400.0, "root"));
        threads.push(fork_of("leaf", 1.0, "mid"));
        assert!(plan(&threads, NOW, policy(90, 0), &none()).is_empty());
    }

    /// An old fork nobody keeps does not hold its parent alive either.
    #[test]
    fn an_old_fork_and_its_old_parent_both_go() {
        let mut threads = floor();
        threads.push(t("parent", 500.0));
        let mut fork = t("fork", 400.0);
        fork["metadata"] = json!({ super::super::FORKED_FROM_KEY: { "thread_id": "parent" } });
        threads.push(fork);
        let mut gone = plan(&threads, NOW, policy(90, 0), &none());
        gone.sort();
        assert_eq!(gone, vec!["fork", "parent"]);
    }

    #[test]
    fn age_and_cap_combine_and_a_protected_thread_beats_both() {
        let mut threads = floor();
        threads.push(t("fresh-extra", 1.0));
        threads.push(t("old-protected", 300.0));
        threads.push(t("old", 200.0));
        let protect: HashSet<String> = ["old-protected".to_string()].into();
        // Cap of 11 would drop everything past the floor plus one; age would drop
        // both old ones. Only the protected one is spared.
        assert_eq!(plan(&threads, NOW, policy(90, 11), &protect), vec!["old"]);
    }

    #[test]
    fn a_thread_without_an_id_is_never_planned_for_removal() {
        let mut threads = floor();
        threads.push(json!({ "updated": NOW - 900.0 * DAY }));
        assert!(plan(&threads, NOW, policy(1, 1), &none()).is_empty());
    }

    /// A thread with neither `updated` nor `created` has an unknown age. It
    /// sorts as the oldest, but neither the age limit nor the cap removes it.
    /// `created` alone is enough to date a thread.
    #[test]
    fn a_stampless_thread_is_kept() {
        let mut threads = floor();
        threads.push(json!({ "id": "stampless", "metadata": {} }));
        threads.push(json!({ "id": "created-only", "created": NOW - 400.0 * DAY }));
        assert_eq!(plan(&threads, NOW, policy(90, 0), &none()), vec!["created-only"]);
        assert_eq!(plan(&threads, NOW, policy(0, 1), &none()), vec!["created-only"]);
    }

    #[test]
    fn a_missing_store_prunes_nothing() {
        let base = std::env::temp_dir().join("jan-housekeeping-no-such-store");
        assert_eq!(run(&base, policy(1, 1), &none()), 0);
    }

    #[test]
    fn an_unreadable_thread_metadata_file_is_left_alone() {
        let base = std::env::temp_dir().join(format!(
            "jan-housekeeping-corrupt-{}",
            std::process::id()
        ));
        let dir = crate::core::threads::utils::get_thread_dir(&base, "broken");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(crate::core::threads::constants::THREADS_FILE),
            "{ not json",
        )
        .unwrap();
        assert_eq!(run(&base, policy(1, 1), &none()), 0);
        assert!(dir.exists(), "a corrupt thread is not ours to guess about");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn run_removes_only_what_the_plan_names() {
        let base = std::env::temp_dir().join(format!(
            "jan-housekeeping-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();
        let mut ids = Vec::new();
        for i in 0..MIN_KEEP {
            ids.push(format!("keep{i}"));
        }
        ids.push("stale".to_string());
        for id in &ids {
            let dir = crate::core::threads::utils::get_thread_dir(&base, id);
            std::fs::create_dir_all(&dir).unwrap();
            let updated = if id == "stale" { now - 400.0 * DAY } else { now };
            std::fs::write(
                dir.join(crate::core::threads::constants::THREADS_FILE),
                json!({ "id": id, "updated": updated }).to_string(),
            )
            .unwrap();
        }
        assert_eq!(run(&base, policy(90, 0), &none()), 1);
        assert!(!crate::core::threads::utils::get_thread_dir(&base, "stale").exists());
        assert!(crate::core::threads::utils::get_thread_dir(&base, "keep0").exists());
        let _ = std::fs::remove_dir_all(&base);
    }
}
