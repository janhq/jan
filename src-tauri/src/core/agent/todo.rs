//! Canonical session todo list: phased tasks the agent declares and updates
//! through the `todo` tool, projected into a compact TUI widget. Core owns
//! mutations, the single-active-task invariant, and persistence; the TUI owns
//! rendering and user-initiated mutations (which flow back through the same
//! `TodoList` API).

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TodoStatus {
    Pending,
    InProgress,
    Completed,
    Abandoned,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TodoItem {
    pub content: String,
    pub status: TodoStatus,
}

impl TodoItem {
    fn pending(content: String) -> Self {
        Self {
            content,
            status: TodoStatus::Pending,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TodoPhase {
    pub name: String,
    pub tasks: Vec<TodoItem>,
}

/// Shared session todo state. Cloned into `OrchestrationArgs`; child/subagent
/// runs never receive it (see `subagent::run_subagent`), so subagents cannot
/// read or mutate the parent's list.
pub type TodoRegistry = Arc<Mutex<TodoList>>;

pub fn new_registry() -> TodoRegistry {
    Arc::new(Mutex::new(TodoList::default()))
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TodoList {
    pub phases: Vec<TodoPhase>,
}

/// Target selector for `done`/`drop`/`rm`: a single task by content, every
/// task in a named phase, or every task in the list.
pub enum Target<'a> {
    Task(&'a str),
    Phase(&'a str),
    All,
}

impl TodoList {
    /// True once any task exists (used to gate reminders/widget display).
    pub fn is_empty(&self) -> bool {
        self.phases.iter().all(|p| p.tasks.is_empty())
    }

    /// True while any task is still pending or in progress.
    ///
    /// Distinct from `is_empty`, which only asks whether tasks exist at all: a
    /// fully completed list is non-empty but has no open work left.
    pub fn has_open(&self) -> bool {
        self.phases
            .iter()
            .flat_map(|p| &p.tasks)
            .any(|t| matches!(t.status, TodoStatus::Pending | TodoStatus::InProgress))
    }

    pub fn done_total(&self) -> (usize, usize) {
        let mut done = 0;
        let mut total = 0;
        for phase in &self.phases {
            for task in &phase.tasks {
                total += 1;
                if matches!(task.status, TodoStatus::Completed | TodoStatus::Abandoned) {
                    done += 1;
                }
            }
        }
        (done, total)
    }

    /// The single in-progress task, if any, as `(phase, task)`.
    pub fn active(&self) -> Option<(&TodoPhase, &TodoItem)> {
        self.phases.iter().find_map(|phase| {
            phase
                .tasks
                .iter()
                .find(|t| t.status == TodoStatus::InProgress)
                .map(|t| (phase, t))
        })
    }

    /// Up to `n` pending tasks in phase/task order, skipping the active one.
    pub fn next_pending(&self, n: usize) -> Vec<(&str, &str)> {
        self.phases
            .iter()
            .flat_map(|phase| {
                phase
                    .tasks
                    .iter()
                    .filter(|t| t.status == TodoStatus::Pending)
                    .map(move |t| (phase.name.as_str(), t.content.as_str()))
            })
            .take(n)
            .collect()
    }

    /// Human-readable summary of open (pending/in-progress) work, one line per
    /// task, or `None` when nothing is open. Used verbatim as the hidden
    /// reminder body and as the reminder dedup key.
    pub fn open_summary(&self) -> Option<String> {
        let mut lines = Vec::new();
        for phase in &self.phases {
            for task in &phase.tasks {
                let marker = match task.status {
                    TodoStatus::InProgress => "→",
                    TodoStatus::Pending => "•",
                    _ => continue,
                };
                if phase.name.is_empty() {
                    lines.push(format!("{marker} {}", task.content));
                } else {
                    lines.push(format!("{marker} [{}] {}", phase.name, task.content));
                }
            }
        }
        (!lines.is_empty()).then(|| lines.join("\n"))
    }

    fn find_task_mut(&mut self, content: &str) -> Option<(&mut TodoPhase, usize)> {
        for phase in &mut self.phases {
            if let Some(idx) = phase.tasks.iter().position(|t| t.content == content) {
                return Some((phase, idx));
            }
        }
        None
    }

    fn task_exists(&self, content: &str) -> bool {
        self.phases
            .iter()
            .any(|p| p.tasks.iter().any(|t| t.content == content))
    }

    fn phase_exists(&self, name: &str) -> bool {
        self.phases.iter().any(|p| p.name == name)
    }

    /// After a mutation leaves no task `InProgress`, promote the earliest
    /// `Pending` task (phase order, then task order) to `InProgress`.
    fn promote_next(&mut self) {
        if self.active().is_some() {
            return;
        }
        for phase in &mut self.phases {
            if let Some(task) = phase
                .tasks
                .iter_mut()
                .find(|t| t.status == TodoStatus::Pending)
            {
                task.status = TodoStatus::InProgress;
                return;
            }
        }
    }

    /// Replace the whole list. `list` is `[{phase, items}]`; a flat `items`
    /// array is wrapped into a single unnamed phase (`""`).
    pub fn init(&mut self, phases: Vec<TodoPhase>) -> Result<(), String> {
        let mut names = std::collections::HashSet::new();
        for phase in &phases {
            if !names.insert(phase.name.as_str()) {
                return Err(format!("duplicate phase name '{}'", phase.name));
            }
            let mut tasks = std::collections::HashSet::new();
            for task in &phase.tasks {
                if task.content.trim().is_empty() {
                    return Err("task content must not be empty".to_string());
                }
                if !tasks.insert(task.content.as_str()) {
                    return Err(format!("duplicate task '{}'", task.content));
                }
            }
        }
        // Cross-phase duplicates are also rejected (content is a stable id).
        let mut all_tasks = std::collections::HashSet::new();
        for phase in &phases {
            for task in &phase.tasks {
                if !all_tasks.insert(task.content.as_str()) {
                    return Err(format!("duplicate task '{}' across phases", task.content));
                }
            }
        }
        self.phases = phases;
        self.promote_next();
        Ok(())
    }

    /// Confirm the current task is `InProgress`. Tasks advance in phase and task
    /// order, so an agent cannot jump ahead of open work.
    pub fn start(&mut self, content: &str) -> Result<(), String> {
        let (target_phase, target_task) = self
            .phases
            .iter()
            .enumerate()
            .find_map(|(phase_index, phase)| {
                phase
                    .tasks
                    .iter()
                    .position(|task| task.content == content)
                    .map(|task_index| (phase_index, task_index))
            })
            .ok_or_else(|| format!("unknown task '{content}'"))?;

        if self.phases[target_phase].tasks[target_task].status == TodoStatus::InProgress {
            return Ok(());
        }
        if self.phases[target_phase].tasks[target_task].status != TodoStatus::Pending {
            return Err(format!("task '{content}' is not pending"));
        }

        'phases: for (phase_index, phase) in self.phases.iter().enumerate() {
            for (task_index, task) in phase.tasks.iter().enumerate() {
                if (phase_index, task_index) == (target_phase, target_task) {
                    break 'phases;
                }
                if !matches!(task.status, TodoStatus::Completed | TodoStatus::Abandoned) {
                    return Err(format!(
                        "cannot start '{content}' before completing or abandoning '{}'",
                        task.content
                    ));
                }
            }
        }

        for phase in &mut self.phases {
            for task in &mut phase.tasks {
                if task.status == TodoStatus::InProgress {
                    task.status = TodoStatus::Pending;
                }
            }
        }
        self.phases[target_phase].tasks[target_task].status = TodoStatus::InProgress;
        Ok(())
    }

    fn set_status(&mut self, target: Target, status: TodoStatus) -> Result<(), String> {
        match target {
            Target::Task(content) => {
                if !self.task_exists(content) {
                    return Err(format!("unknown task '{content}'"));
                }
                let (phase, idx) = self.find_task_mut(content).expect("checked above");
                phase.tasks[idx].status = status;
            }
            Target::Phase(name) => {
                if !self.phase_exists(name) {
                    return Err(format!("unknown phase '{name}'"));
                }
                for phase in self.phases.iter_mut().filter(|p| p.name == name) {
                    for task in &mut phase.tasks {
                        if matches!(task.status, TodoStatus::Pending | TodoStatus::InProgress) {
                            task.status = status;
                        }
                    }
                }
            }
            Target::All => {
                for phase in &mut self.phases {
                    for task in &mut phase.tasks {
                        if matches!(task.status, TodoStatus::Pending | TodoStatus::InProgress) {
                            task.status = status;
                        }
                    }
                }
            }
        }
        self.promote_next();
        Ok(())
    }

    /// Complete targets. Pending/in-progress only; already-terminal tasks are
    /// left untouched (no-op, not an error) when targeting a phase/all.
    pub fn done(&mut self, target: Target) -> Result<(), String> {
        self.set_status(target, TodoStatus::Completed)
    }

    /// Abandon (cancel) targets, distinct from `rm` (delete). Preserved in
    /// the list as a record of intentional cancellation.
    pub fn drop_target(&mut self, target: Target) -> Result<(), String> {
        self.set_status(target, TodoStatus::Abandoned)
    }

    /// Remove targets outright.
    pub fn rm(&mut self, target: Target) -> Result<(), String> {
        match target {
            Target::Task(content) => {
                if !self.task_exists(content) {
                    return Err(format!("unknown task '{content}'"));
                }
                for phase in &mut self.phases {
                    phase.tasks.retain(|t| t.content != content);
                }
            }
            Target::Phase(name) => {
                if !self.phase_exists(name) {
                    return Err(format!("unknown phase '{name}'"));
                }
                self.phases.retain(|p| p.name != name);
            }
            Target::All => self.phases.clear(),
        }
        self.phases
            .retain(|p| !p.tasks.is_empty() || !p.name.is_empty());
        self.promote_next();
        Ok(())
    }

    /// Append pending tasks to `phase`, creating it if absent.
    pub fn append(&mut self, phase: &str, items: Vec<String>) -> Result<(), String> {
        for content in &items {
            if content.trim().is_empty() {
                return Err("task content must not be empty".to_string());
            }
            if self.task_exists(content) {
                return Err(format!("duplicate task '{content}'"));
            }
        }
        let mut seen = std::collections::HashSet::new();
        for content in &items {
            if !seen.insert(content.as_str()) {
                return Err(format!("duplicate task '{content}' in append"));
            }
        }
        let target = if let Some(phase) = self.phases.iter_mut().find(|p| p.name == phase) {
            phase
        } else {
            self.phases.push(TodoPhase {
                name: phase.to_string(),
                tasks: Vec::new(),
            });
            self.phases.last_mut().expect("just pushed")
        };
        target
            .tasks
            .extend(items.into_iter().map(TodoItem::pending));
        self.promote_next();
        Ok(())
    }
}

/// Parse a `target(...)` tool argument shaped `{"task": "..."}`,
/// `{"phase": "..."}`, or `{"all": true}` into a `Target`.
pub fn parse_target(args: &serde_json::Value) -> Result<Target<'_>, String> {
    if let Some(task) = args.get("task").and_then(|v| v.as_str()) {
        return Ok(Target::Task(task));
    }
    if let Some(phase) = args.get("phase").and_then(|v| v.as_str()) {
        return Ok(Target::Phase(phase));
    }
    if args.get("all").and_then(|v| v.as_bool()) == Some(true) {
        return Ok(Target::All);
    }
    Err("target requires exactly one of: task, phase, all".to_string())
}

pub fn todo_tool_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "function",
        "function": {
            "name": "todo",
            "description": "Manage the canonical session todo list: init/start/done/drop/rm/append/view. One call applies one operation. Tasks advance automatically in phase and task order after done or drop; start only confirms the current task. init takes `list` or `items`, never `phase`/`task` directly -- e.g. {\"op\":\"init\",\"list\":[{\"phase\":\"Setup\",\"items\":[\"do X\",\"do Y\"]}]} or the flat form {\"op\":\"init\",\"items\":[\"do X\",\"do Y\"]}.",
            "parameters": {
                "type": "object",
                "properties": {
                    "op": {
                        "type": "string",
                        "enum": ["init", "start", "done", "drop", "rm", "append", "view"]
                    },
                    "list": {
                        "type": "array",
                        "description": "For init: [{phase, items}]",
                        "items": {
                            "type": "object",
                            "properties": {
                                "phase": { "type": "string" },
                                "items": { "type": "array", "items": { "type": "string" } }
                            },
                            "required": ["phase", "items"]
                        }
                    },
                    "items": {
                        "type": "array",
                        "description": "For init (flat, single unnamed phase) or append.",
                        "items": { "type": "string" }
                    },
                    "task": { "type": "string", "description": "Target task content, for start/done/drop/rm/append(phase)." },
                    "phase": { "type": "string", "description": "Target phase name, for done/drop/rm/append." },
                    "all": { "type": "boolean", "description": "Target every task, for done/drop/rm." }
                },
                "required": ["op"]
            }
        }
    })
}

/// Render the tool result: on success, the full resulting snapshot so
/// session history can reconstruct state on resume/branch.
pub fn render_result(list: &TodoList) -> String {
    serde_json::to_string(list).unwrap_or_else(|e| format!("ERROR: could not encode todos: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn phase(name: &str, items: &[&str]) -> TodoPhase {
        TodoPhase {
            name: name.to_string(),
            tasks: items
                .iter()
                .map(|s| TodoItem::pending(s.to_string()))
                .collect(),
        }
    }

    #[test]
    fn init_promotes_the_first_task() {
        let mut list = TodoList::default();
        list.init(vec![phase("Setup", &["a", "b"])]).unwrap();
        assert_eq!(list.active().unwrap().1.content, "a");
        assert_eq!(list.done_total(), (0, 2));
    }

    #[test]
    fn init_rejects_duplicate_phase_and_task_names() {
        let mut list = TodoList::default();
        assert!(list
            .init(vec![phase("A", &["x"]), phase("A", &["y"])])
            .is_err());
        assert!(list.init(vec![phase("A", &["x", "x"])]).is_err());
        assert!(list
            .init(vec![phase("A", &["x"]), phase("B", &["x"])])
            .is_err());
        // A rejected init leaves prior state untouched (atomicity).
        assert!(list.is_empty());
    }

    #[test]
    fn start_accepts_only_the_current_task() {
        let mut list = TodoList::default();
        list.init(vec![phase("A", &["a", "b"])]).unwrap();

        list.start("a").unwrap();
        assert_eq!(list.active().unwrap().1.content, "a");
        assert!(list.start("b").is_err());
        assert!(list.start("missing").is_err());
    }

    #[test]
    fn start_rejects_a_task_after_an_open_earlier_phase() {
        let mut list = TodoList::default();
        list.init(vec![
            phase("Phase 1", &["one"]),
            phase("Phase 2", &["two"]),
            phase("Phase 5", &["five"]),
        ])
        .unwrap();
        list.done(Target::Phase("Phase 1")).unwrap();

        assert!(list.start("five").is_err());
        assert_eq!(list.active().unwrap().1.content, "two");
    }

    #[test]
    fn completing_active_task_promotes_the_next_pending() {
        let mut list = TodoList::default();
        list.init(vec![phase("A", &["a", "b"])]).unwrap();
        list.done(Target::Task("a")).unwrap();
        assert_eq!(list.active().unwrap().1.content, "b");
        assert_eq!(list.done_total(), (1, 2));
    }

    #[test]
    fn abandoning_active_task_promotes_the_next_pending() {
        let mut list = TodoList::default();
        list.init(vec![phase("A", &["a", "b"])]).unwrap();
        list.drop_target(Target::Task("a")).unwrap();
        assert_eq!(list.phases[0].tasks[0].status, TodoStatus::Abandoned);
        assert_eq!(list.active().unwrap().1.content, "b");
    }

    #[test]
    fn done_phase_completes_open_tasks_only() {
        let mut list = TodoList::default();
        list.init(vec![phase("A", &["a", "b", "c"])]).unwrap();
        list.drop_target(Target::Task("b")).unwrap();
        list.done(Target::Phase("A")).unwrap();
        assert_eq!(list.phases[0].tasks[0].status, TodoStatus::Completed);
        assert_eq!(
            list.phases[0].tasks[1].status,
            TodoStatus::Abandoned,
            "already-abandoned stays abandoned"
        );
        assert_eq!(list.phases[0].tasks[2].status, TodoStatus::Completed);
    }

    #[test]
    fn rm_deletes_and_drop_preserves_record() {
        let mut list = TodoList::default();
        list.init(vec![phase("A", &["a", "b"])]).unwrap();
        list.drop_target(Target::Task("a")).unwrap();
        assert!(
            list.task_exists("a"),
            "drop preserves the task as abandoned"
        );
        list.rm(Target::Task("a")).unwrap();
        assert!(!list.task_exists("a"), "rm deletes outright");
    }

    #[test]
    fn rm_missing_target_is_atomic_error() {
        let mut list = TodoList::default();
        list.init(vec![phase("A", &["a"])]).unwrap();
        let before = list.clone();
        assert!(list.rm(Target::Task("missing")).is_err());
        assert!(list.rm(Target::Phase("missing")).is_err());
        assert_eq!(list, before, "failed rm must not mutate state");
    }

    #[test]
    fn append_creates_phase_and_rejects_duplicates() {
        let mut list = TodoList::default();
        list.init(vec![phase("A", &["a"])]).unwrap();
        list.append("B", vec!["b".into(), "c".into()]).unwrap();
        assert_eq!(list.phases[1].name, "B");
        assert!(
            list.append("B", vec!["a".into()]).is_err(),
            "cross-phase duplicate rejected"
        );
        assert!(list.append("B", vec!["d".into(), "d".into()]).is_err());
    }

    #[test]
    fn todo_schema_explains_ordered_progression() {
        let schema = todo_tool_schema();
        let description = schema["function"]["description"].as_str().unwrap();
        assert!(description.contains("start only confirms the current task"));
    }

    #[test]
    fn next_pending_skips_the_active_task() {
        let mut list = TodoList::default();
        list.init(vec![phase("A", &["a", "b", "c", "d"])]).unwrap();
        let preview = list.next_pending(3);
        assert_eq!(preview.len(), 3);
        assert!(
            preview.iter().all(|(_, t)| *t != "a"),
            "active task excluded"
        );
    }

    #[test]
    fn round_trips_through_serde_for_persistence() {
        let mut list = TodoList::default();
        list.init(vec![phase("A", &["a", "b"])]).unwrap();
        list.drop_target(Target::Task("b")).unwrap();
        let json = serde_json::to_string(&list).unwrap();
        let restored: TodoList = serde_json::from_str(&json).unwrap();
        assert_eq!(
            restored, list,
            "resume/branch reconstruction round-trips exactly"
        );
    }

    #[test]
    fn open_summary_lists_open_work_and_is_none_when_done() {
        let mut list = TodoList::default();
        assert_eq!(list.open_summary(), None, "empty list has no open work");
        list.init(vec![phase("Build", &["a", "b"])]).unwrap();
        // 'a' is promoted to in-progress, 'b' stays pending.
        assert_eq!(list.open_summary().unwrap(), "→ [Build] a\n• [Build] b");
        list.done(Target::All).unwrap();
        assert_eq!(
            list.open_summary(),
            None,
            "completed/abandoned work is not open"
        );
    }

    #[test]
    fn parse_target_reads_task_phase_and_all() {
        assert!(matches!(
            parse_target(&serde_json::json!({"task": "x"})),
            Ok(Target::Task("x"))
        ));
        assert!(matches!(
            parse_target(&serde_json::json!({"phase": "P"})),
            Ok(Target::Phase("P"))
        ));
        assert!(matches!(
            parse_target(&serde_json::json!({"all": true})),
            Ok(Target::All)
        ));
        assert!(parse_target(&serde_json::json!({})).is_err());
    }
}
