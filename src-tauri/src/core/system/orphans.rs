//! Startup sweep for engines that an older Jan left running across an update.
//!
//! Up to 0.8.4 the engine was a `llama-server` router child of the desktop app.
//! The in-app updater leaves the old app without running its exit cleanup (see
//! `shutdown`), and 0.8.4 has shipped, so that version cannot be fixed. Every
//! user who updates from it ends up with its router still running, holding RAM
//! and VRAM and, on Linux, pinning the old AppImage mount. On Windows it also
//! survives uninstalling Jan, because the binary lives in the data folder.
//! The only place left to clean it up is the new version's startup.
//!
//! A process is swept only when all of these hold:
//! - it is `llama-server`,
//! - it was started with `--models-preset <data folder>/llamacpp/router.preset.ini`,
//!   the preset file Jan writes, so it belongs to this data folder,
//! - its parent is gone, is not a Jan process, or cannot be the process that
//!   started it (see below), so a Jan that is still running (another instance,
//!   or this one) keeps its engine. That includes a detached `jan serve` from
//!   0.8.4, which keeps its router as a live child.
//!
//! Its descendants, the per-model children the router spawns, go with it.
//!
//! Windows never reparents and reuses pids, so a pid in a parent link can name
//! a different, later process. Start times settle it: a process counts as a
//! descendant only if it started no earlier than the parent it names, and a
//! parent that started after its child is not its owner. When a start time is
//! unknown the order cannot be told: a router keeps its Jan, and a process is
//! never swept as a child on that evidence.
//!
//! `mlx-server` (macOS) is swept too, with a stricter rule. It is a direct
//! child of the app and does not watch its parent, so an app that dies without
//! running its exit cleanup (a crash, `kill -9`) leaves it holding the model in
//! unified memory. Its name, path and flags can all belong to a server someone
//! runs themselves, so it is only taken when it carries the environment marker
//! Jan sets when it starts one, and nothing is left above it (macOS reparents
//! it to launchd). A server started by a version before the marker existed
//! cannot be told apart and is left alone.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use jan_utils::MLX_OWNER_ENV;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

const ROUTER_BINARY: &str = "llama-server";
const ROUTER_PRESET_FILE: &str = "router.preset.ini";
const PRESET_FLAG: &str = "--models-preset";
const MLX_BINARY: &str = "mlx-server";

/// The slice of a process the matcher needs, so it can be tested without
/// spawning anything.
#[derive(Debug)]
pub struct ProcInfo {
    pub pid: u32,
    pub parent: Option<u32>,
    pub name: String,
    pub cmd: Vec<String>,
    /// Seconds since the epoch; 0 when the OS would not say.
    pub start_time: u64,
    /// Carries the environment marker Jan sets on the `mlx-server` it starts.
    /// Only read for `mlx-server` processes; false for everything else.
    pub jan_launched: bool,
}

fn normalize(path: &str) -> String {
    let path = path.replace('\\', "/").to_ascii_lowercase();
    // `\\?\C:\...` and `\\?\UNC\server\share\...` name the same file as their plain
    // form. 0.8.4 passes its preset path in the verbatim form, so without this
    // the sweep never recognises the engine it exists to reap.
    if let Some(rest) = path.strip_prefix("//?/unc/") {
        format!("//{rest}")
    } else if let Some(rest) = path.strip_prefix("//?/") {
        rest.to_string()
    } else {
        path
    }
}

fn is_router_binary(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    let stem = name.strip_suffix(".exe").unwrap_or(&name);
    stem == ROUTER_BINARY
}

/// The value of `--models-preset`, in either `--flag value` or `--flag=value`
/// form.
fn preset_arg(cmd: &[String]) -> Option<&str> {
    let mut args = cmd.iter();
    while let Some(arg) = args.next() {
        if arg == PRESET_FLAG {
            return args.next().map(String::as_str);
        }
        if let Some(value) = arg
            .strip_prefix(PRESET_FLAG)
            .and_then(|r| r.strip_prefix('='))
        {
            return Some(value);
        }
    }
    None
}

/// Whether `proc` is a router started from Jan's preset under `llamacpp_dir`.
fn is_jan_router(proc: &ProcInfo, llamacpp_dir: &str) -> bool {
    if !is_router_binary(&proc.name) {
        return false;
    }
    let Some(preset) = preset_arg(&proc.cmd) else {
        return false;
    };
    let preset = normalize(preset);
    preset.rsplit('/').next() == Some(ROUTER_PRESET_FILE)
        && preset.starts_with(&format!("{llamacpp_dir}/"))
}

fn is_mlx_binary(name: &str) -> bool {
    name.eq_ignore_ascii_case(MLX_BINARY)
}

/// Whether `proc` is an MLX server that a Jan started. There is no preset file
/// tying it to a data folder, and its name, path and flags are all things
/// someone running their own `mlx-server` can have, so the only proof is the
/// marker Jan puts in the server's environment when it starts one.
fn is_jan_mlx_server(proc: &ProcInfo) -> bool {
    is_mlx_binary(&proc.name) && proc.jan_launched
}

/// A Jan process, judged by name: `Jan`, `jan`, `Jan.exe`, `Jan-Desktop.exe`.
fn is_jan(name: &str) -> bool {
    name.to_ascii_lowercase().contains("jan")
}

/// Whether `parent` could really be the parent of `child`: a parent cannot have
/// started after its child. Windows never reparents and reuses pids, so the
/// pid an old Jan had can be handed to a process started later, such as the
/// freshly launched new Jan. When either start time is unknown (0) the order
/// cannot be told and the parent is given the benefit of the doubt.
fn could_be_parent(parent: &ProcInfo, child: &ProcInfo) -> bool {
    parent.start_time == 0 || child.start_time == 0 || parent.start_time <= child.start_time
}

/// Whether `child` is provably a child of `parent`: it started no earlier than
/// the parent it names. An unknown start time (0) on either side proves
/// nothing, so the process is not treated as a child and is never killed on
/// that evidence.
fn is_child_of(child: &ProcInfo, parent: &ProcInfo) -> bool {
    child.start_time != 0 && parent.start_time != 0 && child.start_time >= parent.start_time
}

/// Orphaned when the parent no longer exists, was adopted by init (pid 1), is
/// something other than Jan, or cannot be the process that started it. The
/// third case covers a systemd user session adopting the process on Linux,
/// where the new parent is not pid 1.
fn is_orphaned(proc: &ProcInfo, by_pid: &HashMap<u32, &ProcInfo>) -> bool {
    match proc.parent {
        None | Some(1) => true,
        Some(parent) => by_pid
            .get(&parent)
            .is_none_or(|p| !is_jan(&p.name) || !could_be_parent(p, proc)),
    }
}

/// Whether nothing is left above `proc`: no parent, init, or a parent pid that
/// is not running. macOS hands the child of a dead process to launchd (pid 1)
/// at once, so this is exactly a server whose app died.
fn has_no_live_parent(proc: &ProcInfo, by_pid: &HashMap<u32, &ProcInfo>) -> bool {
    match proc.parent {
        None | Some(1) => true,
        Some(parent) => !by_pid.contains_key(&parent),
    }
}

/// `root` and everything below it, each process listed before its children.
///
/// Each pid is listed once. Windows never reparents and reuses pids, so a dead
/// parent's pid can be taken by one of its own later children, which makes the
/// parent links a cycle.
fn with_descendants(root: u32, children: &HashMap<u32, Vec<u32>>) -> Vec<u32> {
    let mut order = vec![root];
    let mut next = 0;
    while let Some(&pid) = order.get(next) {
        for &child in children.get(&pid).into_iter().flatten() {
            if !order.contains(&child) {
                order.push(child);
            }
        }
        next += 1;
    }
    order
}

/// Pids to kill, children before their router.
pub fn orphaned_engine_pids(procs: &[ProcInfo], data_folder: &Path) -> Vec<u32> {
    let llamacpp_dir = normalize(&data_folder.join("llamacpp").to_string_lossy());
    let llamacpp_dir = llamacpp_dir.trim_end_matches('/');
    let by_pid: HashMap<u32, &ProcInfo> = procs.iter().map(|p| (p.pid, p)).collect();

    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for p in procs {
        let Some(parent_pid) = p.parent else {
            continue;
        };
        // Windows never reparents and reuses pids, so a live process can name a
        // long-dead parent whose pid a router has since taken; without this
        // check it would be swept as that router's child.
        let is_child = by_pid
            .get(&parent_pid)
            .is_some_and(|parent| is_child_of(p, parent));
        if is_child {
            children.entry(parent_pid).or_default().push(p.pid);
        }
    }

    let mut victims = Vec::new();
    let mut seen = HashSet::new();
    for router in procs
        .iter()
        .filter(|p| is_jan_router(p, llamacpp_dir) && is_orphaned(p, &by_pid))
    {
        // Reversed, so killing the router never leaves a child to be adopted.
        for pid in with_descendants(router.pid, &children).into_iter().rev() {
            if seen.insert(pid) {
                victims.push(pid);
            }
        }
    }
    // `mlx-server` has no router above it and no children, so it goes alone.
    // Unlike a router it is only taken when nothing is left above it: a live
    // parent of any kind, a shell included, means someone started it on purpose.
    for server in procs
        .iter()
        .filter(|p| is_jan_mlx_server(p) && has_no_live_parent(p, &by_pid))
    {
        if seen.insert(server.pid) {
            victims.push(server.pid);
        }
    }
    victims
}

/// Kills every engine an older Jan left behind. Returns how many processes were
/// killed. Blocking: run it off the async runtime.
pub fn sweep_orphaned_engines(data_folder: &Path) -> usize {
    // A fresh install, or a user who never ran the llama.cpp engine, has
    // nothing to sweep and should not pay for a process-table scan. macOS
    // always scans: an MLX model can be the only engine ever used there.
    if !cfg!(target_os = "macos") && !data_folder.join("llamacpp").is_dir() {
        return 0;
    }

    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always),
    );
    // Only an `mlx-server` can carry Jan's marker, and reading a process's
    // environment costs a call each, so ask for those alone.
    let mlx_pids: Vec<Pid> = system
        .processes()
        .iter()
        .filter(|(_, p)| is_mlx_binary(&p.name().to_string_lossy()))
        .map(|(pid, _)| *pid)
        .collect();
    if !mlx_pids.is_empty() {
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&mlx_pids),
            true,
            ProcessRefreshKind::nothing().with_environ(UpdateKind::Always),
        );
    }
    let marker = format!("{MLX_OWNER_ENV}=");
    let procs: Vec<ProcInfo> = system
        .processes()
        .values()
        .map(|p| ProcInfo {
            pid: p.pid().as_u32(),
            parent: p.parent().map(Pid::as_u32),
            name: p.name().to_string_lossy().into_owned(),
            start_time: p.start_time(),
            jan_launched: p
                .environ()
                .iter()
                .any(|kv| kv.to_string_lossy().starts_with(&marker)),
            cmd: p
                .cmd()
                .iter()
                .map(|a| a.to_string_lossy().into_owned())
                .collect(),
        })
        .collect();

    let victims = orphaned_engine_pids(&procs, data_folder);
    let mut killed = 0;
    for pid in victims {
        let Some(process) = system.process(Pid::from_u32(pid)) else {
            continue;
        };
        let name = process.name().to_string_lossy();
        log::warn!(
            "Killing {name} left running by a previous Jan: pid {pid}, parent {:?}",
            process.parent()
        );
        if process.kill() {
            killed += 1;
        } else {
            log::warn!("Could not kill orphaned {name} pid {pid}");
        }
    }
    killed
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const DATA: &str = "/home/u/.local/share/Jan/data";
    const PRESET: &str = "/home/u/.local/share/Jan/data/llamacpp/router.preset.ini";

    fn proc(pid: u32, parent: Option<u32>, name: &str, cmd: &[&str]) -> ProcInfo {
        ProcInfo {
            pid,
            parent,
            name: name.to_string(),
            start_time: 0,
            jan_launched: false,
            cmd: cmd.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn router(pid: u32, parent: Option<u32>) -> ProcInfo {
        proc(
            pid,
            parent,
            "llama-server",
            &[
                "/opt/llama-server",
                "--models-preset",
                PRESET,
                "--port",
                "1337",
            ],
        )
    }

    fn sweep(procs: &[ProcInfo]) -> Vec<u32> {
        orphaned_engine_pids(procs, &PathBuf::from(DATA))
    }

    fn started_at(mut p: ProcInfo, start_time: u64) -> ProcInfo {
        p.start_time = start_time;
        p
    }

    #[test]
    fn a_router_adopted_by_init_is_swept_with_its_children_first() {
        let procs = [
            started_at(router(200, Some(1)), 100),
            started_at(
                proc(
                    201,
                    Some(200),
                    "llama-server",
                    &["llama-server", "-m", "a.gguf"],
                ),
                200,
            ),
            started_at(
                proc(
                    202,
                    Some(200),
                    "llama-server",
                    &["llama-server", "-m", "b.gguf"],
                ),
                200,
            ),
        ];
        let victims = sweep(&procs);
        assert_eq!(victims.last(), Some(&200), "router goes last: {victims:?}");
        assert_eq!(victims.len(), 3);
    }

    #[test]
    fn a_router_whose_jan_is_still_running_is_left_alone() {
        // `jan-cli` is the 0.8.4 CLI: `jan serve --detach` keeps its router as
        // a live child, so a detached server is not an orphan.
        for jan in ["Jan", "jan", "Jan.exe", "Jan-Desktop.exe", "jan-cli"] {
            let procs = [proc(50, Some(1), jan, &[jan]), router(200, Some(50))];
            assert!(sweep(&procs).is_empty(), "{jan} still owns its engine");
        }
    }

    #[test]
    fn a_router_adopted_by_a_systemd_user_session_is_swept() {
        let procs = [
            proc(900, Some(1), "systemd", &["systemd", "--user"]),
            router(200, Some(900)),
        ];
        assert_eq!(sweep(&procs), vec![200]);
    }

    #[test]
    fn a_router_whose_parent_exited_is_swept() {
        // Windows does not reparent: the parent pid just stops existing.
        assert_eq!(sweep(&[router(200, Some(4242))]), vec![200]);
        assert_eq!(sweep(&[router(200, None)]), vec![200]);
    }

    #[test]
    fn a_router_of_another_data_folder_is_left_alone() {
        let other = proc(
            200,
            Some(1),
            "llama-server",
            &[
                "llama-server",
                "--models-preset",
                "/srv/other/llamacpp/router.preset.ini",
            ],
        );
        assert!(sweep(&[other]).is_empty());
    }

    #[test]
    fn a_llama_server_that_is_not_a_jan_router_is_left_alone() {
        // The user's own llama-server, with or without a preset of their own.
        let plain = proc(
            200,
            Some(1),
            "llama-server",
            &["llama-server", "-m", "a.gguf"],
        );
        let own_preset = proc(
            201,
            Some(1),
            "llama-server",
            &[
                "llama-server",
                "--models-preset",
                "/home/u/presets/mine.ini",
            ],
        );
        // A preset with the right name but outside the data folder's llamacpp dir.
        let lookalike = proc(
            202,
            Some(1),
            "llama-server",
            &[
                "llama-server",
                "--models-preset",
                "/home/u/.local/share/Jan/data/llamacpp-other/router.preset.ini",
            ],
        );
        assert!(sweep(&[plain, own_preset, lookalike]).is_empty());
    }

    #[test]
    fn the_equals_form_and_windows_paths_match() {
        let eq = proc(
            200,
            Some(4242),
            "llama-server.exe",
            &[
                "C:\\Users\\u\\AppData\\Roaming\\Jan\\data\\llamacpp\\backends\\b1\\llama-server.exe",
                "--models-preset=C:\\Users\\u\\AppData\\Roaming\\Jan\\data\\llamacpp\\router.preset.ini",
            ],
        );
        let victims = orphaned_engine_pids(
            &[eq],
            &PathBuf::from("C:\\Users\\u\\AppData\\Roaming\\Jan\\data"),
        );
        assert_eq!(victims, vec![200]);
    }

    #[test]
    fn verbatim_prefixed_preset_paths_match() {
        // 0.8.4 starts its router with `\\?\C:\...`, the form the sweep exists
        // to reap; `\\?\UNC\` is the same rule for a data folder on a share.
        for (pid, preset, data) in [
            (
                200,
                "\\\\?\\C:\\Users\\u\\AppData\\Roaming\\Jan\\data\\llamacpp\\router.preset.ini",
                "C:\\Users\\u\\AppData\\Roaming\\Jan\\data",
            ),
            (
                201,
                "\\\\?\\UNC\\srv\\share\\Jan\\data\\llamacpp\\router.preset.ini",
                "\\\\srv\\share\\Jan\\data",
            ),
        ] {
            let router = proc(
                pid,
                Some(4242),
                "llama-server.exe",
                &["llama-server.exe", "--models-preset", preset],
            );
            assert_eq!(
                orphaned_engine_pids(&[router], &PathBuf::from(data)),
                vec![pid],
                "{preset}"
            );
        }
    }

    #[test]
    fn a_parent_cycle_from_pid_reuse_terminates() {
        // Windows never reparents and reuses pids: the router's dead parent's
        // pid was taken by one of the router's own later children.
        let procs = [
            started_at(router(200, Some(201)), 100),
            started_at(
                proc(
                    201,
                    Some(200),
                    "llama-server",
                    &["llama-server", "-m", "a.gguf"],
                ),
                200,
            ),
        ];
        let mut victims = sweep(&procs);
        victims.sort_unstable();
        assert_eq!(victims, vec![200, 201]);
    }

    #[test]
    fn a_live_process_naming_a_reused_parent_pid_is_not_a_child() {
        // Windows never reparents: explorer.exe still names the pid of a
        // process that died long ago, and an orphaned router has since been
        // given that pid. Explorer started before the router, so it is not
        // the router's child and must not be swept.
        let procs = [
            started_at(router(200, Some(1)), 500),
            started_at(proc(300, Some(200), "explorer.exe", &["explorer.exe"]), 100),
            started_at(
                proc(
                    301,
                    Some(200),
                    "llama-server",
                    &["llama-server", "-m", "a.gguf"],
                ),
                600,
            ),
        ];
        let mut victims = sweep(&procs);
        victims.sort_unstable();
        assert_eq!(victims, vec![200, 301]);
    }

    #[test]
    fn a_jan_that_started_after_the_router_is_not_its_owner() {
        // Windows handed the old Jan's pid to the freshly launched new Jan.exe,
        // which started after the router and so cannot be its parent.
        let procs = [
            started_at(proc(50, Some(1), "Jan.exe", &["Jan.exe"]), 900),
            started_at(router(200, Some(50)), 500),
        ];
        assert_eq!(sweep(&procs), vec![200]);
    }

    #[test]
    fn a_jan_that_started_before_the_router_still_owns_it() {
        let procs = [
            started_at(proc(50, Some(1), "Jan.exe", &["Jan.exe"]), 100),
            started_at(router(200, Some(50)), 500),
        ];
        assert!(sweep(&procs).is_empty());
    }

    #[test]
    fn a_router_with_an_unknown_start_time_takes_no_live_process_with_it() {
        // With the router's own start time unknown, every process naming its
        // pid would otherwise count as started after it.
        let procs = [
            router(200, Some(1)),
            started_at(proc(300, Some(200), "explorer.exe", &["explorer.exe"]), 100),
            started_at(
                proc(
                    301,
                    Some(200),
                    "llama-server",
                    &["llama-server", "-m", "a.gguf"],
                ),
                600,
            ),
        ];
        assert_eq!(sweep(&procs), vec![200]);
    }

    #[test]
    fn a_process_with_an_unknown_start_time_is_not_taken_as_a_child() {
        let procs = [
            started_at(router(200, Some(1)), 500),
            proc(
                301,
                Some(200),
                "llama-server",
                &["llama-server", "-m", "a.gguf"],
            ),
        ];
        assert_eq!(sweep(&procs), vec![200]);
    }

    /// An `mlx-server` carrying the marker Jan sets when it starts one.
    fn mlx_server(pid: u32, parent: Option<u32>) -> ProcInfo {
        let mut server = proc(
            pid,
            parent,
            "mlx-server",
            &[
                "/Applications/Jan.app/Contents/Resources/resources/bin/mlx-server",
                "--model",
                "/Users/u/models/qwen",
                "--port",
                "52113",
                "--model-id",
                "qwen",
            ],
        );
        server.jan_launched = true;
        server
    }

    #[test]
    fn an_mlx_server_adopted_by_init_is_swept() {
        assert_eq!(sweep(&[mlx_server(200, Some(1))]), vec![200]);
    }

    #[test]
    fn an_mlx_server_whose_parent_is_gone_is_swept() {
        assert_eq!(sweep(&[mlx_server(200, Some(999))]), vec![200]);
    }

    #[test]
    fn an_mlx_server_whose_jan_is_still_running_is_left_alone() {
        let procs = [
            proc(100, Some(1), "Jan-Desktop", &["Jan"]),
            mlx_server(200, Some(100)),
        ];
        assert!(sweep(&procs).is_empty());
    }

    #[test]
    fn an_mlx_server_under_a_live_shell_is_left_alone() {
        // Run by hand from a terminal: its parent is alive and is not a Jan.
        for shell in ["zsh", "bash", "tmux: server"] {
            let procs = [
                proc(100, Some(1), shell, &[shell]),
                mlx_server(200, Some(100)),
            ];
            assert!(sweep(&procs).is_empty(), "{shell}");
        }
    }

    #[test]
    fn a_lookalike_mlx_server_without_jans_marker_is_left_alone_even_when_orphaned() {
        // Run by hand, e.g. `/Users/u/tools/resources/bin/mlx-server ...`, whose
        // shell has exited so launchd owns it. Path, flags and parent all fit;
        // only the marker Jan sets when it starts the server is missing.
        let theirs = proc(
            200,
            Some(1),
            "mlx-server",
            &[
                "/Users/u/tools/resources/bin/mlx-server",
                "--model",
                "/path/to/model",
                "--port",
                "8080",
                "--model-id",
                "custom",
            ],
        );
        assert!(sweep(&[theirs]).is_empty());
    }

    #[test]
    fn a_process_with_jans_marker_but_another_name_is_left_alone() {
        let mut other = mlx_server(200, Some(1));
        other.name = "python3".to_string();
        assert!(sweep(&[other]).is_empty());
    }
}
