use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_llamacpp::cleanup_llama_processes;

use crate::core::app::commands::{
    default_data_folder_path, get_configuration_file_path, get_jan_data_folder_path,
    write_app_configuration,
};
use crate::core::app::constants::{
    JAN_DATA_DIRS_COMMON, JAN_DATA_DIRS_CONVERSATIONS, JAN_DATA_DIRS_MODELS,
    JAN_DATA_FILES_CONFIGS, JAN_DATA_FILES_SETTINGS,
};
use crate::core::app::models::AppConfiguration;
use crate::core::mcp::helpers::{stop_mcp_servers_with_context, ShutdownContext};
use crate::core::state::AppState;

fn is_safe_to_delete(path: &std::path::Path) -> bool {
    let count = path.components().count();
    count >= 3
}

/// Name prefix of the folder a reset moves its targets into. The sweep only
/// ever deletes a recorded path whose name carries it.
const RESET_TRASH_PREFIX: &str = ".reset-trash-";

/// Records the trash folder awaiting deletion. Lives in the app config dir,
/// which survives the reset, so a trash folder under a custom data folder is
/// still found after the reset points the config back at the default.
const PENDING_TRASH_FILE: &str = ".pending-reset-trash";

/// Data-folder entries a reset with these choices removes.
fn reset_targets(keep_app_data: bool, keep_models_and_configs: bool) -> Vec<&'static str> {
    // Extensions, logs and caches go on every reset.
    let mut targets = JAN_DATA_DIRS_COMMON.to_vec();
    if !keep_app_data {
        targets.extend(JAN_DATA_DIRS_CONVERSATIONS);
    }
    if !keep_models_and_configs {
        targets.extend(JAN_DATA_DIRS_MODELS);
        targets.extend(JAN_DATA_FILES_CONFIGS);
    }
    // The settings files span every category; only a full wipe drops them.
    if !keep_app_data && !keep_models_and_configs {
        targets.extend(JAN_DATA_FILES_SETTINGS);
    }
    targets
}

/// Move each target out of the data folder into `trash`.
///
/// A rename within one folder is atomic and instant, so the reset is decided
/// in milliseconds and an exit that cannot be refused (a native macOS quit
/// skips `ExitRequested`) leaves the data either untouched or fully staged,
/// never half-deleted. The slow deletion of `trash` happens later.
fn stage_for_deletion(data_folder: &std::path::Path, targets: &[&str], trash: &std::path::Path) {
    for name in targets {
        let path = data_folder.join(name);
        if fs::symlink_metadata(&path).is_err() {
            continue;
        }
        if let Err(e) = fs::create_dir_all(trash) {
            log::warn!("Failed to create {}: {e}", trash.display());
        }
        log::info!("Staging for deletion: {}", path.display());
        let dest = trash.join(name);
        if let Err(e) = rename_with_retry(&path, &dest) {
            log::warn!("Failed to move {}: {e}; staging its contents", path.display());
            let left = stage_contents(&path, &dest);
            if left > 0 {
                log::warn!("{left} locked entries stay in {}", path.display());
            }
        }
    }
}

/// Rename, retrying briefly: a lock held by a process the reset just stopped,
/// an indexer or antivirus is usually released within moments.
fn rename_with_retry(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    const ATTEMPTS: u32 = 3;
    let mut attempt = 1;
    loop {
        match fs::rename(from, to) {
            Err(_) if attempt < ATTEMPTS => {
                std::thread::sleep(std::time::Duration::from_millis(250));
                attempt += 1;
            }
            result => return result,
        }
    }
}

/// Move what can be moved from `from` into `to`, one entry at a time, and
/// return how many entries had to stay. Windows refuses to move a folder with
/// a file open anywhere in it, and deleting it in place stops at the first
/// such file, so this leaves behind only the files that are actually locked.
fn stage_contents(from: &std::path::Path, to: &std::path::Path) -> usize {
    let is_dir = fs::symlink_metadata(from).is_ok_and(|m| m.is_dir());
    if !is_dir {
        if let Err(e) = fs::remove_file(from) {
            log::warn!("Failed to remove {}: {e}", from.display());
            return 1;
        }
        return 0;
    }
    let entries = match fs::create_dir_all(to).and_then(|()| fs::read_dir(from)) {
        Ok(entries) => entries,
        Err(e) => {
            log::warn!("Failed to stage {}: {e}", from.display());
            return 1;
        }
    };
    let mut left = 0;
    for entry in entries.flatten() {
        let src = entry.path();
        let dest = to.join(entry.file_name());
        if fs::rename(&src, &dest).is_err() {
            left += stage_contents(&src, &dest);
        }
    }
    if left == 0 {
        if let Err(e) = fs::remove_dir(from) {
            log::warn!("Failed to remove {}: {e}", from.display());
            left = 1;
        }
    }
    left
}

fn remove_path(path: &std::path::Path) -> std::io::Result<()> {
    let removed = if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    if let Err(e) = &removed {
        log::warn!("Failed to remove {}: {e}", path.display());
    }
    removed
}

fn pending_trash_record<R: Runtime>(app_handle: &tauri::AppHandle<R>) -> Option<PathBuf> {
    get_configuration_file_path(app_handle.clone())
        .parent()
        .map(|dir| dir.join(PENDING_TRASH_FILE))
}

fn record_pending_trash(record: &std::path::Path, trash: &std::path::Path) -> std::io::Result<()> {
    fs::write(record, trash.to_string_lossy().as_bytes())
}

/// Delete the trash folder a factory reset left behind, then forget it.
fn sweep_pending_trash(record: &std::path::Path) {
    let Ok(recorded) = fs::read_to_string(record) else {
        return;
    };
    let trash = PathBuf::from(recorded.trim());
    let is_reset_trash = trash
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with(RESET_TRASH_PREFIX));
    if is_reset_trash && is_safe_to_delete(&trash) {
        if trash.exists() {
            log::info!("Deleting factory reset leftovers: {}", trash.display());
            // A partial failure (a file locked on Windows) keeps the record,
            // so the next start retries instead of losing the folder for good.
            if remove_path(&trash).is_err() && trash.exists() {
                return;
            }
        }
    } else {
        log::warn!("Ignoring unexpected reset trash path: {}", trash.display());
    }
    // A reset during the sweep records its own trash; leave that record.
    if fs::read_to_string(record).ok().as_deref() != Some(recorded.as_str()) {
        return;
    }
    if let Err(e) = fs::remove_file(record) {
        log::warn!("Failed to remove {}: {e}", record.display());
    }
}

/// Finish a factory reset's deletion on the first start after it. Blocking:
/// run it off the main thread.
pub fn sweep_reset_trash<R: Runtime>(app_handle: &tauri::AppHandle<R>) {
    if let Some(record) = pending_trash_record(app_handle) {
        sweep_pending_trash(&record);
    }
}

/// Clear the WebKit/WRY webview profile (localStorage, cookies, IndexedDB,
/// updater state) stored in the bundle-id app-data dir (e.g. `jan.ai.app/`).
/// Distinct from the product-name data folder; only removed on explicit opt-in.
fn clear_webview_profile<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    data_folder: &std::path::Path,
) {
    let webview_dir = match crate::core::app::paths::app_data_dir_for(app_handle) {
        Ok(dir) => dir,
        Err(e) => {
            log::warn!("Cannot resolve webview profile dir: {e}");
            return;
        }
    };

    // Never touch the dir if it is the user's data folder or contains it.
    if webview_dir == data_folder || data_folder.starts_with(&webview_dir) {
        log::warn!(
            "Skipping webview clear: data folder lives inside {}",
            webview_dir.display()
        );
        return;
    }

    if !webview_dir.is_dir() || !is_safe_to_delete(&webview_dir) {
        return;
    }

    log::info!("Clearing webview profile: {}", webview_dir.display());
    if let Err(e) = fs::remove_dir_all(&webview_dir) {
        log::warn!(
            "Failed to clear webview profile {}: {e}",
            webview_dir.display()
        );
    }
}

const WEBDATA_RESET_SENTINEL: &str = ".pending-webdata-reset";

/// Flags describing what a pending reset should prune from webview localStorage.
/// Consumed by the frontend on next startup before stores hydrate.
#[derive(serde::Serialize, serde::Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct WebdataResetFlags {
    pub keep_app_data: bool,
    pub keep_models_and_configs: bool,
    pub clear_web_data: bool,
}

/// Sentinel lives in the app config dir (alongside settings.json), which
/// survives the data-folder wipe.
fn webdata_reset_sentinel_path<R: Runtime>(app_handle: &tauri::AppHandle<R>) -> Option<PathBuf> {
    get_configuration_file_path(app_handle.clone())
        .parent()
        .map(|dir| dir.join(WEBDATA_RESET_SENTINEL))
}

fn write_webdata_reset_sentinel<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    keep_app_data: bool,
    keep_models_and_configs: bool,
    clear_web_data: bool,
) {
    let Some(path) = webdata_reset_sentinel_path(app_handle) else {
        return;
    };
    let flags = WebdataResetFlags {
        keep_app_data,
        keep_models_and_configs,
        clear_web_data,
    };
    match serde_json::to_string(&flags) {
        Ok(json) => {
            if let Err(e) = fs::write(&path, json) {
                log::warn!("Failed to write webdata reset sentinel: {e}");
            }
        }
        Err(e) => log::warn!("Failed to serialize webdata reset flags: {e}"),
    }
}

/// Read and remove the pending-reset sentinel. Returns the flags if one existed
/// so the frontend can prune the matching localStorage keys before hydration.
#[tauri::command]
pub fn take_pending_webdata_reset<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Option<WebdataResetFlags> {
    let path = webdata_reset_sentinel_path(&app_handle)?;
    if !path.is_file() {
        return None;
    }
    let flags = fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str::<WebdataResetFlags>(&content).ok());
    if let Err(e) = fs::remove_file(&path) {
        log::warn!("Failed to remove webdata reset sentinel: {e}");
    }
    flags
}

/// Detect the user's default shell and return the appropriate env file path.
/// Returns (shell_name, env_file_path).
fn detect_shell_env_file(home_dir: &str, is_macos: bool) -> (&'static str, String) {
    let shell = std::env::var("SHELL").unwrap_or_default();
    if shell.ends_with("/bash") {
        // macOS uses login shells in Terminal, so ~/.bash_profile is sourced.
        // Linux interactive shells source ~/.bashrc.
        let file = if is_macos {
            format!("{}/.bash_profile", home_dir)
        } else {
            format!("{}/.bashrc", home_dir)
        };
        ("bash", file)
    } else {
        // Default to zsh (macOS default since Catalina)
        ("zsh", format!("{}/.zshenv", home_dir))
    }
}

/// Opening line of the block Jan writes into the user's shell profile.
const ENV_BLOCK_BEGIN: &str = "# >>> jan claude-code >>>";
/// Closing line of the block Jan writes into the user's shell profile.
const ENV_BLOCK_END: &str = "# <<< jan claude-code <<<";
/// The exact line older Jan versions wrote before and after the exported
/// variables. Every version that wrote to the profile used this marker pair.
const LEGACY_ENV_MARKER: &str = "# Jan Local API Server - Claude Code Config";
/// Prefix of the variables older Jan versions wrote inside the marker pair.
const LEGACY_ENV_PREFIX: &str = "export ANTHROPIC_";

/// Quote a value for a POSIX shell: wrap it in single quotes and turn every
/// embedded `'` into `'\''`. Nothing inside single quotes is expanded.
fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

/// Largest profile the macOS admin fallback will write. Shell profiles are
/// small.
#[cfg_attr(not(unix), allow(dead_code))]
const MAX_ADMIN_PROFILE_BYTES: usize = 256 * 1024;

/// Shell command the macOS admin fallback runs as root to replace `dst` with
/// the content of `src`, a file the user process staged (see
/// `stage_admin_profile`). Only paths travel in the command, never the content.
///
/// `src` must be a regular file, not a symlink, owned by `uid` with mode 600
/// and at most `MAX_ADMIN_PROFILE_BYTES`; it is checked on the descriptor that
/// is then read, so swapping it after the check does not help. The content is
/// copied into a fresh root-only directory under /private/tmp, given `dst`'s
/// owner and mode, then renamed over `dst`. A rename replaces the directory
/// entry and never writes through a symlink. `dst` must be a regular file that
/// is not a symlink, or not exist yet (then it gets the owner of its directory
/// and mode 600); anything else is refused, with a message saying why (a
/// symlink is named as such). The temp directory must be on the same volume
/// as `dst` so the move is a rename, not a copy; otherwise it fails with a
/// message naming the volume problem, which osascript passes on as the error.
#[cfg_attr(not(unix), allow(dead_code))]
fn admin_write_shell_command(dst: &str, src: &str, uid: u32) -> Result<String, String> {
    let dir = std::path::Path::new(dst)
        .parent()
        .and_then(|d| d.to_str())
        .filter(|d| !d.is_empty())
        .ok_or_else(|| format!("{} has no parent directory", dst))?;
    if !src.starts_with('/') {
        return Err(format!("{} is not an absolute path", src));
    }
    Ok(format!(
        "dst={dst}; dir={dir}; src={src}; \
         if [ -L \"$dst\" ]; then \
         echo \"$dst is a symbolic link (e.g. managed by a dotfile manager); Jan won't replace it. \
         Update the file it points to or make it writable.\" >&2; exit 1; fi; \
         if [ -e \"$dst\" ] && [ ! -f \"$dst\" ]; then \
         echo \"Refusing to replace $dst: not a regular file\" >&2; exit 1; fi; \
         if [ -L \"$src\" ] || [ ! -f \"$src\" ]; then \
         echo \"Refusing to read $src: not a regular file\" >&2; exit 1; fi; \
         exec 3< \"$src\" || exit 1; \
         if [ \"$(/usr/bin/stat -f '%HT:%u:%Lp' <&3)\" != 'Regular File:{uid}:600' ] \
         || [ \"$(/usr/bin/stat -f %z <&3)\" -gt {max} ]; then \
         echo \"Refusing to read $src: unexpected type, owner, mode or size\" >&2; exit 1; fi; \
         t=$(/usr/bin/mktemp -d /private/tmp/jan_env.XXXXXX) || exit 1; f=\"$t/profile\"; \
         if [ -f \"$dst\" ]; then o=$(/usr/bin/stat -f %u:%g \"$dst\") && m=$(/usr/bin/stat -f %Lp \"$dst\"); \
         else o=$(/usr/bin/stat -L -f %u:%g \"$dir\") && m=600; fi \
         && {{ [ \"$(/usr/bin/stat -f %d \"$t\")\" = \"$(/usr/bin/stat -L -f %d \"$dir\")\" ] \
         || {{ echo \"$dst is on a different volume than /private/tmp; \
         Jan can't update it with administrator rights.\" >&2; false; }}; }} \
         && /bin/cat <&3 > \"$f\" \
         && /usr/sbin/chown \"$o\" \"$f\" && /bin/chmod \"$m\" \"$f\" && /bin/mv -f \"$f\" \"$dst\"; \
         r=$?; /bin/rm -rf \"$t\"; exit $r",
        dst = shell_single_quote(dst),
        dir = shell_single_quote(dir),
        src = shell_single_quote(src),
        max = MAX_ADMIN_PROFILE_BYTES,
    ))
}

/// AppleScript for the macOS admin fallback: run `admin_write_shell_command`
/// with administrator privileges. The shell command is escaped for the
/// AppleScript string literal it is embedded in (`\` and `"`).
#[cfg_attr(not(unix), allow(dead_code))]
fn admin_write_applescript(dst: &str, src: &str, uid: u32) -> Result<String, String> {
    let shell = admin_write_shell_command(dst, src, uid)?;
    let escaped = shell.replace('\\', r"\\").replace('"', r#"\""#);
    Ok(format!(
        r#"do shell script "{escaped}" with administrator privileges"#
    ))
}

/// A private directory holding the profile content for the admin fallback,
/// removed (with its content) when dropped.
#[cfg(unix)]
struct StagedProfile {
    dir: PathBuf,
    file: PathBuf,
}

#[cfg(unix)]
impl Drop for StagedProfile {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// Write `content` to a new mode-600 file in a fresh mode-700 directory under
/// the user's temp dir (`$TMPDIR`, per-user on macOS), both created by this
/// process and neither pre-existing.
#[cfg(unix)]
fn stage_admin_profile(content: &str) -> Result<StagedProfile, String> {
    use std::io::Write as _;
    use std::os::unix::fs::{DirBuilderExt as _, OpenOptionsExt as _, PermissionsExt as _};
    let base = std::env::temp_dir();
    let mut last_err = None;
    for _ in 0..8 {
        let dir = base.join(format!("jan_env.{}", uuid::Uuid::new_v4().simple()));
        match std::fs::DirBuilder::new().mode(0o700).create(&dir) {
            Ok(()) => {
                let staged = StagedProfile {
                    file: dir.join("profile"),
                    dir,
                };
                let mut f = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .mode(0o600)
                    .open(&staged.file)
                    .map_err(|e| e.to_string())?;
                f.set_permissions(std::fs::Permissions::from_mode(0o600))
                    .and_then(|()| f.write_all(content.as_bytes()))
                    .and_then(|()| f.sync_all())
                    .map_err(|e| e.to_string())?;
                return Ok(staged);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => last_err = Some(e),
            Err(e) => return Err(e.to_string()),
        }
    }
    Err(last_err.map_or_else(String::new, |e| e.to_string()))
}

fn is_valid_env_key(key: &str) -> bool {
    let mut chars = key.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Variables that change where programs are found, or where Windows resolves
/// its system binaries. Custom variables are typed by the user, so only keys
/// that change how Jan or the OS locate programs are refused.
const RESERVED_ENV_KEYS: &[&str] = &[
    "PATH",
    "PATHEXT",
    "COMSPEC",
    "SYSTEMROOT",
    "WINDIR",
    "SYSTEMDRIVE",
    // Where Jan looks for installed programs and GPU runtimes on Windows.
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMW6432",
    "CUDA_PATH",
    "CUDA_HOME",
    "HIP_PATH",
    "ROCM_PATH",
    "ROCM_HOME",
];

/// Prefixes of reserved variable names: the dynamic loader's settings, Jan's
/// own configuration, the versioned CUDA install paths Jan scans, and the
/// WebView2 runtime's settings.
const RESERVED_ENV_PREFIXES: &[&str] = &["LD_", "DYLD_", "JAN_", "CUDA_PATH_V", "WEBVIEW2_"];

/// Whether `key` is one Jan refuses to set. Compared case-insensitively:
/// Windows variable names are case-insensitive, and zsh ties lowercase
/// `path` to `PATH`.
fn is_reserved_env_key(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    RESERVED_ENV_KEYS.contains(&upper.as_str())
        || RESERVED_ENV_PREFIXES.iter().any(|p| upper.starts_with(p))
}

/// Reject names and values that cannot be written as a single `export` line.
fn validate_env_vars(env_vars: &[(String, String)]) -> Result<(), String> {
    for (key, value) in env_vars {
        if !is_valid_env_key(key) {
            return Err(format!(
                "Invalid environment variable name {:?}: use only letters, digits and \
                 underscores, and do not start with a digit.",
                key
            ));
        }
        if is_reserved_env_key(key) {
            return Err(format!(
                "Jan does not set {}: it changes how Jan or the system finds programs. \
                 Remove it from the custom environment variables.",
                key
            ));
        }
        if value.contains(['\n', '\r', '\0']) {
            return Err(format!(
                "The value for {} contains a line break or NUL character, which cannot be \
                 written to a shell profile.",
                key
            ));
        }
    }
    Ok(())
}

/// Render the marked block of `export` lines Jan owns in the shell profile.
fn render_env_block(env_vars: &[(String, String)]) -> Result<String, String> {
    validate_env_vars(env_vars)?;
    let mut block = String::new();
    block.push_str(ENV_BLOCK_BEGIN);
    block.push('\n');
    for (key, value) in env_vars {
        block.push_str(&format!("export {}={}\n", key, shell_single_quote(value)));
    }
    block.push_str(ENV_BLOCK_END);
    block.push('\n');
    Ok(block)
}

/// Index of the first line after `start` that satisfies `is_end`.
fn find_closing_line(lines: &[&str], start: usize, is_end: impl Fn(&str) -> bool) -> Option<usize> {
    lines
        .iter()
        .enumerate()
        .skip(start + 1)
        .find(|(_, l)| is_end(l))
        .map(|(i, _)| i)
}

/// Remove everything Jan wrote to a shell profile and keep the user's own
/// lines. Removes the marked block as a whole and legacy blocks between a pair
/// of `LEGACY_ENV_MARKER` lines as a whole. Lines outside those blocks are the
/// user's, including their own `export ANTHROPIC_` lines. Returns "" or content
/// ending in one newline.
fn strip_jan_env_lines(content: &str) -> String {
    let lines: Vec<&str> = content.split('\n').collect();
    let mut kept: Vec<&str> = Vec::with_capacity(lines.len());
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim_end();
        if trimmed == ENV_BLOCK_BEGIN {
            match find_closing_line(&lines, i, |l| l.trim_end() == ENV_BLOCK_END) {
                Some(end) => i = end + 1,
                None => i += 1,
            }
            continue;
        }
        if trimmed == ENV_BLOCK_END {
            i += 1;
            continue;
        }
        // The legacy marker opens a block only as a whole line, or in the one
        // shape an older writer left behind: it appended the opening marker
        // without first ending the file's last line, so the marker trails one
        // of the user's lines, and it always wrote its exports on the next
        // line. A user line that merely ends with the marker text is kept.
        let legacy_open = trimmed.strip_suffix(LEGACY_ENV_MARKER).filter(|prefix| {
            prefix.trim().is_empty()
                || lines
                    .get(i + 1)
                    .is_some_and(|next| next.starts_with(LEGACY_ENV_PREFIX))
        });
        if let Some(prefix) = legacy_open {
            if !prefix.trim().is_empty() {
                kept.push(prefix);
            }
            match find_closing_line(&lines, i, |l| l.trim_end() == LEGACY_ENV_MARKER) {
                Some(end) => i = end + 1,
                None => {
                    // No closing line: drop only the exports Jan wrote right
                    // after the marker, and a closing marker that later text
                    // was appended to (the admin path wrote it without a
                    // trailing newline).
                    i += 1;
                    while i < lines.len() && lines[i].starts_with(LEGACY_ENV_PREFIX) {
                        i += 1;
                    }
                    if let Some(rest) = lines.get(i).and_then(|l| l.strip_prefix(LEGACY_ENV_MARKER))
                    {
                        if !rest.trim().is_empty() {
                            kept.push(rest);
                        }
                        i += 1;
                    }
                }
            }
            continue;
        }
        kept.push(line);
        i += 1;
    }
    let joined = kept.join("\n");
    let trimmed = joined.trim_end();
    if trimmed.is_empty() {
        String::new()
    } else {
        format!("{}\n", trimmed)
    }
}

/// Full new profile content: the user's lines plus Jan's block at the end.
fn build_env_file_content(existing: &str, env_vars: &[(String, String)]) -> Result<String, String> {
    let block = render_env_block(env_vars)?;
    let base = strip_jan_env_lines(existing);
    if base.is_empty() {
        Ok(block)
    } else {
        Ok(format!("{}\n{}", base, block))
    }
}

/// Current content of a shell profile, or "" when it does not exist yet. Any
/// other read error is returned: rewriting a profile Jan could not read would
/// replace the user's lines with Jan's block alone.
fn read_shell_profile(env_file_path: &str) -> Result<String, String> {
    match std::fs::read_to_string(env_file_path) {
        Ok(content) => Ok(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("Could not read {}: {}", env_file_path, e)),
    }
}

/// macOS fallback for a profile Jan cannot write directly: replace
/// `env_file_path` with `content` with administrator privileges (see
/// `admin_write_shell_command`). The content goes through a private temp file
/// and the script through osascript's stdin, so neither shows in any process's
/// arguments. A cancelled password prompt is returned as an error.
#[cfg(unix)]
fn admin_write_shell_profile(env_file_path: &str, content: &str) -> Result<(), String> {
    use std::io::Write as _;
    if content.len() > MAX_ADMIN_PROFILE_BYTES {
        return Err(format!(
            "{} would be larger than {} KB; not writing it with administrator privileges.",
            env_file_path,
            MAX_ADMIN_PROFILE_BYTES / 1024
        ));
    }
    let staged = stage_admin_profile(content)?;
    let src = staged
        .file
        .to_str()
        .ok_or_else(|| format!("{} is not valid UTF-8", staged.file.display()))?;
    // SAFETY: getuid has no preconditions and cannot fail.
    let uid = unsafe { libc::getuid() };
    let script = admin_write_applescript(env_file_path, src, uid)?;
    let mut child = std::process::Command::new("/usr/bin/osascript")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let written = child
        .stdin
        .take()
        .ok_or_else(|| "osascript has no stdin".to_string())
        .and_then(|mut stdin| stdin.write_all(script.as_bytes()).map_err(|e| e.to_string()));
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    written?;
    drop(staged);
    check_admin_copy(&output, env_file_path)
}

#[cfg(not(unix))]
fn admin_write_shell_profile(env_file_path: &str, _content: &str) -> Result<(), String> {
    Err(format!("Could not update {}", env_file_path))
}

/// Turn the osascript result of the admin copy into an error when it failed,
/// e.g. because the user cancelled the password prompt.
fn check_admin_copy(output: &std::process::Output, env_file_path: &str) -> Result<(), String> {
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Could not update {} with administrator privileges: {}",
            env_file_path,
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

// Helper function to write env vars to a shell config file
fn write_env_to_shell(env_file_path: &str, env_vars: &[(String, String)]) -> Result<(), String> {
    let existing_content = read_shell_profile(env_file_path)?;
    let final_content = build_env_file_content(&existing_content, env_vars)?;
    std::fs::write(env_file_path, &final_content).map_err(|e| e.to_string())?;
    Ok(())
}

/// Set by the first `factory_reset` and never cleared: the reset ends in a
/// restart, so a second call (double click, retry from the hidden webview)
/// must not start another teardown that interleaves with it.
static FACTORY_RESET_STARTED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Whether a factory reset is wiping data. The event loop stays live during
/// the wipe, so the app lifecycle handlers use this to keep the hidden
/// windows hidden and the process alive until the reset restarts it.
pub fn factory_reset_in_progress() -> bool {
    FACTORY_RESET_STARTED.load(std::sync::atomic::Ordering::SeqCst)
}

/// Bring the main window back, unless a factory reset hid it to wipe data.
/// Every user-facing "show Jan" path (tray click, tray menu, macOS dock
/// reopen) goes through here so none of them hands back a live webview over a
/// half-deleted data folder.
pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if factory_reset_in_progress() {
        log::info!("Not showing the window while a factory reset is running");
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Whether an exit request must be refused because a reset is running, so a
/// quit during the teardown cannot cut the reset short. The reset's own
/// `restart()` arrives as `RESTART_EXIT_CODE` and must go through. Not every
/// exit reaches this check (a native macOS quit does not); the staged
/// deletion is what keeps those from leaving a half-wiped folder.
pub fn exit_blocked_by_reset(reset_in_progress: bool, code: Option<i32>) -> bool {
    reset_in_progress && code != Some(tauri::RESTART_EXIT_CODE)
}

/// Wipe the selected data categories and restart the app.
///
/// Async so it runs on the async runtime: as a sync command it ran on the main
/// thread, and the teardown below (MCP servers, engine worker, `remove_dir_all`
/// of the models folder) froze the event loop for up to ~30s with the window
/// stuck on screen.
#[tauri::command]
pub async fn factory_reset<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    keep_app_data: Option<bool>,
    keep_models_and_configs: Option<bool>,
    clear_web_data: Option<bool>,
) -> Result<(), String> {
    let keep_app_data = keep_app_data.unwrap_or(false);
    let keep_models_and_configs = keep_models_and_configs.unwrap_or(false);
    let clear_web_data = clear_web_data.unwrap_or(false);

    // Refuse before touching anything, so a refused reset leaves the app
    // running and visible and the frontend sees the error.
    let data_folder = get_jan_data_folder_path(app_handle.clone());
    if data_folder.exists() && !is_safe_to_delete(&data_folder) {
        log::error!(
            "Refusing factory reset: path is too close to filesystem root: {}",
            data_folder.display()
        );
        return Err(format!(
            "Refusing to reset {}: too close to the filesystem root",
            data_folder.display()
        ));
    }
    if FACTORY_RESET_STARTED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        log::warn!("Factory reset already in progress; ignoring repeat request");
        return Ok(());
    }

    // Hide rather than close: now that the event loop keeps running, closing
    // the last window would start a normal app exit in the middle of the wipe.
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        let windows = app_handle.webview_windows();
        for (label, window) in windows.iter() {
            window.hide().unwrap_or_else(|_| {
                log::warn!("Failed to hide window: {label:?}");
            });
        }
    }
    log::info!(
        "Factory reset (keep_app_data={}, keep_models_and_configs={}, clear_web_data={}), data folder: {:?}",
        keep_app_data,
        keep_models_and_configs,
        clear_web_data,
        data_folder
    );

    let _ = stop_mcp_servers_with_context(&app_handle, &state, ShutdownContext::FactoryReset).await;

    {
        let mut active_servers = state.mcp_active_servers.lock().await;
        active_servers.clear();
    }

    use crate::core::mcp::lockfile::cleanup_own_locks;
    if let Err(e) = cleanup_own_locks(&app_handle) {
        log::warn!("Failed to cleanup lock files: {}", e);
    }
    let _ = cleanup_llama_processes(app_handle.clone()).await;

    let full_wipe = !keep_app_data && !keep_models_and_configs;
    if data_folder.exists() {
        // Discard before moving: the in-memory copy would otherwise be
        // flushed back by a pending debounced write or the exit-time flush.
        if full_wipe {
            crate::core::app::settings_store::discard_settings();
        }
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let trash = data_folder.join(format!("{RESET_TRASH_PREFIX}{stamp}"));
        // Record first, so a trash folder is never left that no sweep knows of.
        let recorded = pending_trash_record(&app_handle)
            .map(|record| record_pending_trash(&record, &trash))
            .transpose();
        let targets = reset_targets(keep_app_data, keep_models_and_configs);
        let folder = data_folder.clone();
        let staged = tauri::async_runtime::spawn_blocking(move || {
            stage_for_deletion(&folder, &targets, &trash);
            // Without a record the next start cannot find the trash, so it
            // has to go now, slow as that is.
            if !matches!(recorded, Ok(Some(()))) {
                log::warn!("Could not record reset trash; deleting it now");
                if trash.exists() {
                    let _ = remove_path(&trash);
                }
            }
        })
        .await;
        if let Err(e) = staged {
            log::error!("Factory reset data deletion failed: {e}");
        }
    }

    // Reset app configuration to defaults unless user chose to keep configs
    if !keep_models_and_configs {
        let default_config = AppConfiguration {
            data_folder: default_data_folder_path(app_handle.clone()),
        };
        let _ = write_app_configuration(app_handle.clone(), default_config);
    }

    // Persisted UI state (model-provider, setup flag) lives in webview
    // localStorage, not the data folder. Renderer-side removal races the
    // restart flush, and the on-disk localStorage location is
    // platform-specific (esp. macOS WKWebView), so instead drop a sentinel
    // that the frontend consumes on next startup to clear localStorage via
    // the webview API before stores hydrate. File-level profile deletion
    // (Linux cookies/cache) stays as a best-effort supplement.
    if !keep_app_data || !keep_models_and_configs || clear_web_data {
        write_webdata_reset_sentinel(
            &app_handle,
            keep_app_data,
            keep_models_and_configs,
            clear_web_data,
        );
    }
    if clear_web_data || full_wipe {
        clear_webview_profile(&app_handle, &data_folder);
    }

    // The staged data is deleted by the next start (`sweep_reset_trash`).
    // Not `restart()`: off the main thread it parks this runtime worker
    // forever while the exit handler blocks on the same runtime for cleanup.
    app_handle.request_restart();
    Ok(())
}

#[tauri::command]
pub fn relaunch<R: Runtime>(app: AppHandle<R>) {
    app.restart()
}

#[tauri::command]
pub async fn read_logs<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let log_path = get_jan_data_folder_path(app).join("logs").join("app.log");
    if log_path.exists() {
        let content = fs::read_to_string(log_path).map_err(|e| e.to_string())?;
        Ok(content)
    } else {
        Err("Log file not found".to_string())
    }
}

// check if a system library is available
#[tauri::command]
pub fn is_library_available(library: &str) -> bool {
    match unsafe { libloading::Library::new(library) } {
        Ok(_) => true,
        Err(e) => {
            log::info!("Library {library} is not available: {e}");
            false
        }
    }
}

#[tauri::command]
pub fn launch_claude_code_with_config(
    api_url: String,
    api_key: Option<String>,
    big_model: Option<String>,
    medium_model: Option<String>,
    small_model: Option<String>,
    custom_env_vars: Vec<serde_json::Value>,
) -> Result<(), String> {
    let env_vars = build_claude_code_env_vars(
        api_url,
        api_key,
        big_model,
        medium_model,
        small_model,
        custom_env_vars,
    )?;

    // Claude Code talks to Jan's local API server, which authenticates inbound
    // requests against its own key (the proxy_api_key). ANTHROPIC_AUTH_TOKEN
    // MUST therefore be the local server key, and there is no valid placeholder:
    // anything else reaches the proxy, passes its key check, and then gets
    // rejected by the remote provider as a bogus credential (an opaque 403).
    // Refuse to launch with a clear message rather than ship a fake key.
    write_claude_code_env_vars(&env_vars)
}

/// Build the environment variable map for the Claude Code integration.
/// Returns an error if no local API key is set, since the proxy will not
/// authenticate the session otherwise.
fn build_claude_code_env_vars(
    api_url: String,
    api_key: Option<String>,
    big_model: Option<String>,
    medium_model: Option<String>,
    small_model: Option<String>,
    custom_env_vars: Vec<serde_json::Value>,
) -> Result<Vec<(String, String)>, String> {
    let token = api_key
        .filter(|k| !k.trim().is_empty())
        .ok_or_else(|| {
            "No local API key is set. Open Settings > Local API Server, set an API key, \
             and try again: Claude Code needs a real key to authenticate with the local \
             server and reach remote models."
                .to_string()
        })?;

    let mut env_vars: Vec<(String, String)> = Vec::with_capacity(8);
    env_vars.push(("ANTHROPIC_BASE_URL".to_string(), api_url));
    env_vars.push(("ANTHROPIC_AUTH_TOKEN".to_string(), token));

    if let Some(model) = big_model {
        env_vars.push(("ANTHROPIC_DEFAULT_OPUS_MODEL".to_string(), model));
    }

    if let Some(model) = medium_model {
        env_vars.push(("ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(), model));
    }

    if let Some(model) = small_model {
        env_vars.push(("ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(), model));
    }

    // Add custom env vars from the custom CLI section
    for env in &custom_env_vars {
        if let (Some(key), Some(value)) = (
            env.get("key").and_then(|v| v.as_str()),
            env.get("value").and_then(|v| v.as_str()),
        ) {
            // An unfilled row in the custom env list; nothing to export.
            if key.is_empty() {
                continue;
            }
            env_vars.push((key.to_string(), value.to_string()));
        }
    }

    Ok(env_vars)
}

/// Persist the Claude Code environment variables to the user's shell config
/// (macOS/Linux) or the Windows registry, then return the result.
fn write_claude_code_env_vars(env_vars: &[(String, String)]) -> Result<(), String> {
    // The shell profile and the Windows registry both take the values
    // verbatim, so refuse names and values that cannot be stored safely.
    validate_env_vars(env_vars)?;

    if cfg!(target_os = "macos") {
        let home_dir = std::env::var("HOME").map_err(|e| e.to_string())?;
        let (shell_name, env_file_path) = detect_shell_env_file(&home_dir, true);
        log::info!(
            "Detected shell: {}, writing env to: {}",
            shell_name,
            env_file_path
        );

        // Try direct write first
        match std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
            .open(&env_file_path)
        {
            Ok(_) => {
                write_env_to_shell(&env_file_path, env_vars)?;
                Ok(())
            }
            Err(_) => {
                // Use admin privileges to write
                let existing_content = read_shell_profile(&env_file_path)?;
                let final_content = build_env_file_content(&existing_content, env_vars)?;
                admin_write_shell_profile(&env_file_path, &final_content)?;

                log::info!(
                    "Env vars written to {} with admin privileges",
                    env_file_path
                );
                Ok(())
            }
        }
    } else if cfg!(target_os = "linux") {
        let home_dir = std::env::var("HOME").map_err(|e| e.to_string())?;
        let (shell_name, env_file_path) = detect_shell_env_file(&home_dir, false);
        log::info!(
            "Detected shell: {}, writing env to: {}",
            shell_name,
            env_file_path
        );

        match std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
            .open(&env_file_path)
        {
            Ok(_) => {
                write_env_to_shell(&env_file_path, env_vars)?;
                Ok(())
            }
            Err(_) => {
                let jan_config_dir = format!("{}/.config/jan", home_dir);
                let ext = if shell_name == "bash" { "bash" } else { "zsh" };
                let env_file = format!("{}/claude-code-env.{}", jan_config_dir, ext);
                Err(format!("NEED_PERMISSION:{}", env_file))
            }
        }
    } else {
        // On Windows, set persistent user environment variables using setx
        for (key, value) in env_vars {
            let output = std::process::Command::new(jan_utils::windows_system_tool("setx.exe"))
                .arg(key)
                .arg(value)
                .output()
                .map_err(|e| e.to_string())?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Failed to set env var {}: {}", key, stderr));
            }
        }

        log::info!("Environment variables set permanently in Windows registry.");
        Ok(())
    }
}

/// Build the cleaned shell-file content with all Jan CC env vars stripped out.
fn build_cleaned_env_content(env_file_path: &str) -> Result<String, String> {
    let existing_content = read_shell_profile(env_file_path)?;
    Ok(strip_jan_env_lines(&existing_content))
}

/// Clear all Jan-written Claude Code environment variables from the shell config.
/// Uses the same write-probe + osascript-fallback logic as `launch_claude_code_with_config`.
#[tauri::command]
pub fn clear_claude_code_env() -> Result<(), String> {
    if cfg!(target_os = "macos") {
        let home_dir = std::env::var("HOME").map_err(|e| e.to_string())?;
        let (shell_name, env_file_path) = detect_shell_env_file(&home_dir, true);
        log::info!(
            "Clearing CC env from shell: {}, file: {}",
            shell_name,
            env_file_path
        );

        let cleaned = build_cleaned_env_content(&env_file_path)?;

        match std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
            .open(&env_file_path)
        {
            Ok(_) => {
                std::fs::write(&env_file_path, &cleaned).map_err(|e| e.to_string())?;
                Ok(())
            }
            Err(_) => {
                admin_write_shell_profile(&env_file_path, &cleaned)?;

                log::info!(
                    "CC env cleared from {} with admin privileges",
                    env_file_path
                );
                Ok(())
            }
        }
    } else if cfg!(target_os = "linux") {
        let home_dir = std::env::var("HOME").map_err(|e| e.to_string())?;
        let (shell_name, env_file_path) = detect_shell_env_file(&home_dir, false);
        log::info!(
            "Clearing CC env from shell: {}, file: {}",
            shell_name,
            env_file_path
        );

        let cleaned = build_cleaned_env_content(&env_file_path)?;

        match std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
            .open(&env_file_path)
        {
            Ok(_) => {
                std::fs::write(&env_file_path, &cleaned).map_err(|e| e.to_string())?;
                Ok(())
            }
            Err(_) => Err(format!("NEED_PERMISSION:{}", env_file_path)),
        }
    } else {
        // Windows: delete the persistent user env vars from the registry
        let keys = [
            "ANTHROPIC_BASE_URL",
            "ANTHROPIC_AUTH_TOKEN",
            "ANTHROPIC_DEFAULT_OPUS_MODEL",
            "ANTHROPIC_DEFAULT_SONNET_MODEL",
            "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        ];
        for key in &keys {
            let _ = std::process::Command::new(jan_utils::windows_system_tool("reg.exe"))
                .args(["delete", "HKCU\\Environment", "/v", key, "/f"])
                .output();
        }
        log::info!("CC env vars removed from Windows registry.");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::app::constants::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn a_running_reset_blocks_exits_but_not_its_own_restart() {
        assert!(exit_blocked_by_reset(true, Some(0)));
        assert!(exit_blocked_by_reset(true, None));
        assert!(!exit_blocked_by_reset(true, Some(tauri::RESTART_EXIT_CODE)));
        assert!(!exit_blocked_by_reset(false, Some(0)));
        assert!(!exit_blocked_by_reset(false, None));
    }

    fn create_all_data(dir: &std::path::Path) {
        for subdir in JAN_DATA_SUBDIRS {
            fs::create_dir_all(dir.join(subdir)).unwrap();
            fs::write(dir.join(subdir).join("dummy.txt"), "data").unwrap();
        }
        for file in JAN_DATA_FILES {
            fs::write(dir.join(file), "data").unwrap();
        }
    }

    fn exists_any(dir: &std::path::Path, names: &[&str]) -> bool {
        names.iter().any(|n| dir.join(n).exists())
    }

    fn exists_all(dir: &std::path::Path, names: &[&str]) -> bool {
        names.iter().all(|n| dir.join(n).exists())
    }

    /// Stage a reset with these choices into a trash folder under `d`.
    fn stage(d: &std::path::Path, keep_app_data: bool, keep_models: bool) -> PathBuf {
        let trash = d.join(format!("{RESET_TRASH_PREFIX}test"));
        stage_for_deletion(d, &reset_targets(keep_app_data, keep_models), &trash);
        trash
    }

    #[test]
    fn keeping_both_categories_stages_only_common_data() {
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        create_all_data(d);

        let trash = stage(d, true, true);

        assert!(!exists_any(d, JAN_DATA_DIRS_COMMON));
        assert!(exists_all(&trash, JAN_DATA_DIRS_COMMON));
        assert!(exists_all(d, JAN_DATA_DIRS_CONVERSATIONS));
        assert!(exists_all(d, JAN_DATA_DIRS_MODELS));
        assert!(exists_all(d, JAN_DATA_FILES));
    }

    #[test]
    fn keeping_models_stages_conversations_but_not_settings() {
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        create_all_data(d);

        stage(d, false, true);

        assert!(!exists_any(d, JAN_DATA_DIRS_CONVERSATIONS));
        assert!(exists_all(d, JAN_DATA_DIRS_MODELS));
        assert!(exists_all(d, JAN_DATA_FILES_CONFIGS));
        assert!(exists_all(d, JAN_DATA_FILES_SETTINGS));
    }

    #[test]
    fn keeping_app_data_stages_models_and_configs_but_not_settings() {
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        create_all_data(d);

        stage(d, true, false);

        assert!(!exists_any(d, JAN_DATA_DIRS_MODELS));
        assert!(!exists_any(d, JAN_DATA_FILES_CONFIGS));
        assert!(exists_all(d, JAN_DATA_DIRS_CONVERSATIONS));
        assert!(exists_all(d, JAN_DATA_FILES_SETTINGS));
    }

    #[test]
    fn full_wipe_stages_every_known_entry() {
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        create_all_data(d);

        let trash = stage(d, false, false);

        assert!(!exists_any(d, JAN_DATA_SUBDIRS));
        assert!(!exists_any(d, JAN_DATA_FILES));
        assert!(exists_all(&trash, JAN_DATA_SUBDIRS));
        assert!(exists_all(&trash, JAN_DATA_FILES));
    }

    #[test]
    fn staging_with_nothing_to_move_creates_no_trash() {
        let tmp = tempdir().unwrap();
        let trash = stage(tmp.path(), false, false);
        assert!(!trash.exists());
    }

    #[test]
    fn sweep_deletes_recorded_trash_and_clears_the_record() {
        let tmp = tempdir().unwrap();
        let d = tmp.path().join("data");
        fs::create_dir_all(&d).unwrap();
        create_all_data(&d);
        let record = tmp.path().join(PENDING_TRASH_FILE);
        let trash = d.join(format!("{RESET_TRASH_PREFIX}1"));
        record_pending_trash(&record, &trash).unwrap();
        stage_for_deletion(&d, &reset_targets(false, false), &trash);

        sweep_pending_trash(&record);

        assert!(!trash.exists());
        assert!(!record.exists());
    }

    /// A read-only directory holding one file: its entries can be neither moved
    /// nor removed, which stands in for a file held open on Windows. `None`
    /// when permissions are not enforced (running as root).
    #[cfg(unix)]
    fn locked_dir(parent: &std::path::Path) -> Option<PathBuf> {
        use std::os::unix::fs::PermissionsExt;
        let locked = parent.join("locked");
        fs::create_dir_all(&locked).unwrap();
        fs::write(locked.join("held.bin"), "data").unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o555)).unwrap();
        if fs::write(locked.join("probe"), "").is_ok() {
            unlock(&locked);
            return None;
        }
        Some(locked)
    }

    #[cfg(unix)]
    fn unlock(dir: &std::path::Path) {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn staging_contents_leaves_only_the_locked_entries() {
        let tmp = tempdir().unwrap();
        let models = tmp.path().join("llamacpp");
        fs::create_dir_all(models.join("free")).unwrap();
        fs::write(models.join("free").join("a.gguf"), "data").unwrap();
        fs::write(models.join("b.gguf"), "data").unwrap();
        let Some(locked) = locked_dir(&models) else {
            return;
        };
        let dest = tmp.path().join("trash").join("llamacpp");

        let left = stage_contents(&models, &dest);
        unlock(&locked);

        assert_eq!(left, 1);
        assert!(dest.join("free").join("a.gguf").exists());
        assert!(dest.join("b.gguf").exists());
        assert!(!models.join("free").exists());
        assert!(!models.join("b.gguf").exists());
        assert!(locked.join("held.bin").exists());
    }

    #[test]
    fn staging_contents_removes_the_emptied_folder() {
        let tmp = tempdir().unwrap();
        let models = tmp.path().join("llamacpp");
        fs::create_dir_all(models.join("free")).unwrap();
        fs::write(models.join("free").join("a.gguf"), "data").unwrap();
        let dest = tmp.path().join("trash").join("llamacpp");

        assert_eq!(stage_contents(&models, &dest), 0);
        assert!(!models.exists());
        assert!(dest.join("free").join("a.gguf").exists());
    }

    #[cfg(unix)]
    #[test]
    fn sweep_keeps_the_record_until_the_trash_is_gone() {
        let tmp = tempdir().unwrap();
        let record = tmp.path().join(PENDING_TRASH_FILE);
        let trash = tmp.path().join("data").join(format!("{RESET_TRASH_PREFIX}1"));
        fs::create_dir_all(&trash).unwrap();
        let Some(locked) = locked_dir(&trash) else {
            return;
        };
        record_pending_trash(&record, &trash).unwrap();

        sweep_pending_trash(&record);
        assert!(trash.exists());
        assert!(record.exists());

        unlock(&locked);
        sweep_pending_trash(&record);
        assert!(!trash.exists());
        assert!(!record.exists());
    }

    #[test]
    fn sweep_never_deletes_a_path_that_is_not_reset_trash() {
        let tmp = tempdir().unwrap();
        let keep = tmp.path().join("data").join("threads");
        fs::create_dir_all(&keep).unwrap();
        let record = tmp.path().join(PENDING_TRASH_FILE);
        record_pending_trash(&record, &keep).unwrap();

        sweep_pending_trash(&record);

        assert!(keep.exists());
        assert!(!record.exists());
    }

    #[test]
    fn sweep_without_a_record_is_a_no_op() {
        let tmp = tempdir().unwrap();
        sweep_pending_trash(&tmp.path().join(PENDING_TRASH_FILE));
    }

    #[test]
    fn test_is_safe_to_delete() {
        assert!(!is_safe_to_delete(std::path::Path::new("/")));
        assert!(!is_safe_to_delete(std::path::Path::new("/home")));
        assert!(is_safe_to_delete(std::path::Path::new("/home/user/jan")));
        assert!(is_safe_to_delete(std::path::Path::new(
            "/home/user/.local/share/jan"
        )));
    }
    #[test]
    fn claude_code_env_uses_real_token_when_set() {
        let env = build_claude_code_env_vars(
            "http://127.0.0.1:1337".to_string(),
            Some("sk-real-secret".to_string()),
            None,
            None,
            None,
            vec![],
        )
        .unwrap();
        let token = env
            .iter()
            .find(|(k, _)| k == "ANTHROPIC_AUTH_TOKEN")
            .map(|(_, v)| v.as_str())
            .unwrap();
        assert_eq!(token, "sk-real-secret");
        assert!(env
            .iter()
            .all(|(_, v)| v != "jan"),
            "placeholder must never be shipped as a token");
    }

    #[test]
    fn claude_code_env_rejects_missing_key() {
        let err = build_claude_code_env_vars(
            "http://127.0.0.1:1337".to_string(),
            None,
            None,
            None,
            None,
            vec![],
        )
        .unwrap_err();
        assert!(
            err.contains("API key"),
            "should tell the user a local API key is required: {err}"
        );
    }

    #[test]
    fn claude_code_env_rejects_blank_key() {
        let err = build_claude_code_env_vars(
            "http://127.0.0.1:1337".to_string(),
            Some("   ".to_string()),
            None,
            None,
            None,
            vec![],
        )
        .unwrap_err();
        assert!(
            err.contains("API key"),
            "a whitespace-only key is not a real credential: {err}"
        );
    }

    fn kv(k: &str, v: &str) -> (String, String) {
        (k.to_string(), v.to_string())
    }

    #[test]
    fn shell_quote_escapes_single_quotes() {
        assert_eq!(shell_single_quote("plain"), "'plain'");
        assert_eq!(shell_single_quote("a'b"), r"'a'\''b'");
        assert_eq!(shell_single_quote(""), "''");
    }

    #[test]
    fn admin_write_applescript_escapes_for_applescript() {
        let script =
            admin_write_applescript(r#"/Users/o'b"c\d/.zshenv"#, "/var/t/jan_env.x/profile", 501)
                .unwrap();
        assert!(script.starts_with(r#"do shell script "dst='/Users/o'\\''b\"c\\d/.zshenv'; dir='/Users/o'\\''b\"c\\d'; src='/var/t/jan_env.x/profile'; "#));
        assert!(script.ends_with(r#"exit $r" with administrator privileges"#));
        // Only the escaped quotes remain inside the AppleScript string.
        let inner = &script["do shell script \"".len()..script.len() - "\" with administrator privileges".len()];
        assert!(!inner.replace(r#"\\"#, "").replace(r#"\""#, "").contains('"'));
    }

    #[test]
    fn admin_write_command_carries_paths_not_content() {
        let cmd = admin_write_shell_command("/Users/a/.zshenv", "/var/t/jan_env.x/profile", 501)
            .unwrap();
        assert!(cmd.contains("src='/var/t/jan_env.x/profile';"));
        assert!(cmd.contains("'Regular File:501:600'"));
        assert!(cmd.contains(&format!("-gt {MAX_ADMIN_PROFILE_BYTES}")));
        assert!(!cmd.contains("base64"));
        // Staging stays root-only, under /private/tmp.
        assert!(cmd.contains("/usr/bin/mktemp -d /private/tmp/"));
        assert!(admin_write_shell_command(".zshenv", "/t/p", 501).is_err());
        assert!(admin_write_shell_command("/Users/a/.zshenv", "t/p", 501).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn admin_write_refuses_oversized_content() {
        let big = "#".repeat(MAX_ADMIN_PROFILE_BYTES + 1);
        let err = admin_write_shell_profile("/Users/a/.zshenv", &big).unwrap_err();
        assert!(err.contains("larger than"), "{err}");
    }

    #[cfg(unix)]
    #[test]
    fn staged_profile_is_private_and_removed_on_drop() {
        use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};
        let staged = stage_admin_profile("export A=1\n").unwrap();
        let dir = staged.dir.clone();
        assert!(dir.starts_with(std::env::temp_dir()));
        assert_eq!(fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700);
        let meta = fs::symlink_metadata(&staged.file).unwrap();
        assert!(meta.file_type().is_file());
        assert_eq!(meta.permissions().mode() & 0o777, 0o600);
        assert_eq!(meta.uid(), unsafe { libc::getuid() });
        assert_eq!(fs::read_to_string(&staged.file).unwrap(), "export A=1\n");
        drop(staged);
        assert!(!dir.exists());
    }

    /// Writes `content` to a mode-600 source file in `dir`.
    #[cfg(target_os = "macos")]
    fn admin_source(dir: &std::path::Path, content: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let src = dir.join("staged-profile");
        fs::write(&src, content).unwrap();
        fs::set_permissions(&src, fs::Permissions::from_mode(0o600)).unwrap();
        src
    }

    /// Runs the privileged command as the current user against temp files.
    #[cfg(target_os = "macos")]
    fn run_admin_write(dst: &std::path::Path, src: &std::path::Path) -> std::process::Output {
        let uid = unsafe { libc::getuid() };
        let cmd = admin_write_shell_command(dst.to_str().unwrap(), src.to_str().unwrap(), uid)
            .unwrap();
        std::process::Command::new("/bin/sh")
            .arg("-c")
            .arg(cmd)
            .output()
            .unwrap()
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn admin_write_command_replaces_regular_file_keeping_mode() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let dst = dir.path().join(".zshenv");
        fs::write(&dst, "old\n").unwrap();
        fs::set_permissions(&dst, fs::Permissions::from_mode(0o640)).unwrap();
        let content = "export A='it'\\''s'\n$(touch /tmp/never)\n";
        let out = run_admin_write(&dst, &admin_source(dir.path(), content));
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(fs::read_to_string(&dst).unwrap(), content);
        assert_eq!(fs::metadata(&dst).unwrap().permissions().mode() & 0o777, 0o640);

        // A profile that does not exist yet is created, private.
        let new = dir.path().join(".bash_profile");
        let out = run_admin_write(&new, &admin_source(dir.path(), "export B=1\n"));
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(fs::read_to_string(&new).unwrap(), "export B=1\n");
        assert_eq!(fs::metadata(&new).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn admin_write_command_refuses_symlinks_and_non_files() {
        let dir = tempdir().unwrap();
        let src = admin_source(dir.path(), "export EVIL=1\n");
        let target = dir.path().join("system-file");
        fs::write(&target, "original\n").unwrap();
        let link = dir.path().join(".zshenv");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let out = run_admin_write(&link, &src);
        assert!(!out.status.success());
        let err = String::from_utf8_lossy(&out.stderr);
        assert!(err.contains("is a symbolic link"), "{err}");
        assert!(err.contains("Jan won't replace it"), "{err}");
        assert_eq!(fs::read_to_string(&target).unwrap(), "original\n");
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());

        // Dangling symlink: refused too, nothing created at its target.
        let dangling = dir.path().join(".bashrc");
        let missing = dir.path().join("missing");
        std::os::unix::fs::symlink(&missing, &dangling).unwrap();
        assert!(!run_admin_write(&dangling, &src).status.success());
        assert!(!missing.exists());

        let sub = dir.path().join("adir");
        fs::create_dir(&sub).unwrap();
        let out = run_admin_write(&sub, &src);
        assert!(!out.status.success());
        assert!(String::from_utf8_lossy(&out.stderr).contains("not a regular file"));
        assert_eq!(fs::read_dir(&sub).unwrap().count(), 0);
    }

    /// `/dev` is its own file system, so a profile there is on a different
    /// volume than /private/tmp. Nothing can be written there by this user;
    /// the volume check fails first and says so.
    #[cfg(target_os = "macos")]
    #[test]
    fn admin_write_command_explains_a_different_volume() {
        let dir = tempdir().unwrap();
        let src = admin_source(dir.path(), "export A=1\n");
        let dst = std::path::Path::new("/dev/jan-test-profile-that-does-not-exist");
        let out = run_admin_write(dst, &src);
        assert!(!out.status.success());
        let err = String::from_utf8_lossy(&out.stderr);
        assert!(err.contains("is on a different volume"), "{err}");
        assert!(err.contains("Jan can't update it with administrator rights"), "{err}");
        assert!(!dst.exists());

        // osascript hands the script's stderr back; it reaches the error text.
        let err = check_admin_copy(&out, dst.to_str().unwrap()).unwrap_err();
        assert!(err.contains("is on a different volume"), "{err}");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn admin_write_command_refuses_a_symlinked_or_loose_source() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let dst = dir.path().join(".zshenv");
        fs::write(&dst, "old\n").unwrap();

        // A symlink to an otherwise acceptable file is refused.
        let real = admin_source(dir.path(), "export A=1\n");
        let link = dir.path().join("linked-profile");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let out = run_admin_write(&dst, &link);
        assert!(!out.status.success());
        assert!(String::from_utf8_lossy(&out.stderr).contains("Refusing to read"));
        assert_eq!(fs::read_to_string(&dst).unwrap(), "old\n");

        // Readable by others: refused.
        fs::set_permissions(&real, fs::Permissions::from_mode(0o644)).unwrap();
        let out = run_admin_write(&dst, &real);
        assert!(!out.status.success());
        assert!(String::from_utf8_lossy(&out.stderr).contains("unexpected"));
        assert_eq!(fs::read_to_string(&dst).unwrap(), "old\n");

        // A directory, and a file that is not there: refused.
        assert!(!run_admin_write(&dst, dir.path()).status.success());
        assert!(!run_admin_write(&dst, &dir.path().join("gone")).status.success());
        assert_eq!(fs::read_to_string(&dst).unwrap(), "old\n");

        // Owned by someone else: refused (the command expects another uid).
        fs::set_permissions(&real, fs::Permissions::from_mode(0o600)).unwrap();
        let other = unsafe { libc::getuid() } + 1;
        let cmd = admin_write_shell_command(dst.to_str().unwrap(), real.to_str().unwrap(), other)
            .unwrap();
        let out = std::process::Command::new("/bin/sh").arg("-c").arg(cmd).output().unwrap();
        assert!(!out.status.success());
        assert!(String::from_utf8_lossy(&out.stderr).contains("unexpected"));
        assert_eq!(fs::read_to_string(&dst).unwrap(), "old\n");
    }

    #[test]
    fn env_block_quotes_a_value_that_closes_the_quote() {
        let block =
            render_env_block(&[kv("ANTHROPIC_DEFAULT_OPUS_MODEL", "x'; touch /tmp/x; #")]).unwrap();
        assert!(block.contains(r"export ANTHROPIC_DEFAULT_OPUS_MODEL='x'\''; touch /tmp/x; #'"));
        assert!(block.starts_with(ENV_BLOCK_BEGIN));
        assert!(block.trim_end().ends_with(ENV_BLOCK_END));
    }

    #[test]
    fn env_rejects_line_breaks_and_nul_in_values() {
        for bad in ["a\nexport X=1", "a\rb", "a\0b"] {
            let err = render_env_block(&[kv("ANTHROPIC_DEFAULT_OPUS_MODEL", bad)]).unwrap_err();
            assert!(err.contains("ANTHROPIC_DEFAULT_OPUS_MODEL"), "{err}");
            assert!(validate_env_vars(&[kv("K", bad)]).is_err());
        }
    }

    #[test]
    fn env_rejects_bad_keys() {
        for bad in [
            "",
            "1ABC",
            "A-B",
            "A B",
            "A;touch x",
            "A=B",
            "A\nB",
            "\u{c9}",
        ] {
            assert!(
                validate_env_vars(&[kv(bad, "v")]).is_err(),
                "{bad:?} accepted"
            );
        }
        for good in ["A", "_A", "a_b9", "ANTHROPIC_BASE_URL"] {
            assert!(
                validate_env_vars(&[kv(good, "v")]).is_ok(),
                "{good:?} rejected"
            );
        }
    }

    #[test]
    fn env_rejects_reserved_keys() {
        for bad in [
            "PATH",
            "path",
            "PathExt",
            "ComSpec",
            "SystemRoot",
            "windir",
            "SystemDrive",
            "LD_PRELOAD",
            "LD_LIBRARY_PATH",
            "LD_AUDIT",
            "DYLD_INSERT_LIBRARIES",
            "dyld_library_path",
            "JAN_DATA_FOLDER",
            "jan_anything",
            "ProgramFiles",
            "PROGRAMW6432",
            "cuda_path",
            "CUDA_HOME",
            "CUDA_PATH_V12_4",
            "HIP_PATH",
            "ROCM_PATH",
            "rocm_home",
            "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER",
            "webview2_additional_browser_arguments",
        ] {
            let err = validate_env_vars(&[kv(bad, "v")]).unwrap_err();
            assert!(err.contains(bad), "{bad}: {err}");
        }
        // Not a valid name to write either, but reserved in its own right.
        assert!(is_reserved_env_key("ProgramFiles(x86)"));
        for good in [
            "PATHS",
            "MY_PATH",
            "ENVIRONMENT",
            "OLD_LD_PRELOAD",
            "JANET",
            "ANTHROPIC_AUTH_TOKEN",
            "ANTHROPIC_BASE_URL",
            "LD",
            "CUDA_VISIBLE_DEVICES",
            "HIP_VISIBLE_DEVICES",
            "WEBVIEW2",
            // Typed by the user on purpose (e.g. a Claude Code tweak), so allowed.
            "NODE_OPTIONS",
            "node_options",
            "BASH_ENV",
            "ENV",
            "ZDOTDIR",
            "PROMPT_COMMAND",
            "SHELLOPTS",
            "BASHOPTS",
            "IFS",
            "PS4",
            "PYTHONSTARTUP",
            "PERL5OPT",
        ] {
            assert!(
                validate_env_vars(&[kv(good, "v")]).is_ok(),
                "{good:?} rejected"
            );
        }
        let dir = tempdir().unwrap();
        let path = dir.path().join(".zshenv");
        assert!(write_env_to_shell(path.to_str().unwrap(), &[kv("LD_PRELOAD", "/tmp/x")]).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn env_write_with_invalid_input_leaves_file_untouched() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".zshenv");
        fs::write(&path, "export PATH=\"$HOME/bin:$PATH\"\n").unwrap();
        let p = path.to_str().unwrap();
        assert!(write_env_to_shell(p, &[kv("BAD KEY", "v")]).is_err());
        assert!(write_env_to_shell(p, &[kv("K", "a\nb")]).is_err());
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "export PATH=\"$HOME/bin:$PATH\"\n"
        );
    }

    #[test]
    fn claude_code_env_skips_blank_custom_rows() {
        let env = build_claude_code_env_vars(
            "http://127.0.0.1:1337".to_string(),
            Some("k".to_string()),
            None,
            None,
            None,
            vec![
                serde_json::json!({"key": "", "value": ""}),
                serde_json::json!({"key": "MY_VAR", "value": "1"}),
            ],
        )
        .unwrap();
        assert!(env.iter().all(|(k, _)| !k.is_empty()));
        assert!(env.iter().any(|(k, v)| k == "MY_VAR" && v == "1"));
    }

    #[test]
    fn env_write_then_reset_preserves_user_lines_and_removes_jan_lines() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".zshenv");
        let user = "# my settings\nexport PATH=\"$HOME/bin:$PATH\"\nalias ll='ls -l'\n";
        fs::write(&path, user).unwrap();
        let p = path.to_str().unwrap();

        let vars = vec![
            kv("ANTHROPIC_BASE_URL", "http://127.0.0.1:1337"),
            kv("ANTHROPIC_AUTH_TOKEN", "sk-'quoted'"),
            kv("MY_CUSTOM_VAR", "x'; echo hi; #"),
        ];
        write_env_to_shell(p, &vars).unwrap();
        // Writing twice replaces the block instead of stacking it.
        write_env_to_shell(p, &vars).unwrap();
        let written = fs::read_to_string(&path).unwrap();
        assert!(written.starts_with(user));
        assert_eq!(written.matches(ENV_BLOCK_BEGIN).count(), 1);
        assert_eq!(written.matches(ENV_BLOCK_END).count(), 1);
        assert_eq!(written.matches("MY_CUSTOM_VAR").count(), 1);

        fs::write(&path, build_cleaned_env_content(p).unwrap()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), user);
    }

    #[test]
    fn env_reset_on_file_with_only_jan_block_leaves_it_empty() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".bashrc");
        let p = path.to_str().unwrap();
        write_env_to_shell(p, &[kv("ANTHROPIC_BASE_URL", "u")]).unwrap();
        assert_eq!(build_cleaned_env_content(p).unwrap(), "");
    }

    #[test]
    fn env_cleanup_removes_legacy_format_including_stray_lines() {
        // What older Jan versions wrote: a marker pair around unescaped
        // exports, where a newline in a value left an extra line behind and a
        // custom variable did not carry the ANTHROPIC_ prefix.
        let legacy = "export EDITOR=vim\n\
            # Jan Local API Server - Claude Code Config\n\
            export ANTHROPIC_BASE_URL='http://127.0.0.1:1337'\n\
            export ANTHROPIC_DEFAULT_OPUS_MODEL='m\n\
            touch /tmp/leftover'\n\
            export MY_CUSTOM_VAR='1'\n\
            \n\
            # Jan Local API Server - Claude Code Config\n\
            export AFTER=1\n";
        let cleaned = strip_jan_env_lines(legacy);
        assert_eq!(cleaned, "export EDITOR=vim\nexport AFTER=1\n");

        // Upgrading writes the new block and drops the legacy one.
        let upgraded =
            build_env_file_content(legacy, &[kv("ANTHROPIC_BASE_URL", "http://h")]).unwrap();
        assert!(!upgraded.contains(LEGACY_ENV_MARKER));
        assert!(!upgraded.contains("leftover"));
        assert!(!upgraded.contains("MY_CUSTOM_VAR"));
        assert!(upgraded.starts_with("export EDITOR=vim\nexport AFTER=1\n"));
        assert_eq!(upgraded.matches("ANTHROPIC_BASE_URL").count(), 1);
    }

    #[test]
    fn env_cleanup_handles_unpaired_markers_without_eating_user_lines() {
        let content = "export A=1\n# Jan Local API Server - Claude Code Config\n\
            export ANTHROPIC_BASE_URL='x'\nexport B=2\n# >>> jan claude-code >>>\nexport C=3\n";
        assert_eq!(
            strip_jan_env_lines(content),
            "export A=1\nexport B=2\nexport C=3\n"
        );
    }

    #[test]
    fn env_cleanup_keeps_user_comment_that_shares_the_legacy_prefix() {
        let content = "# Jan Local API Server notes: port 1337\n\
            export KEEP_ME=1\n\
            # Jan Local API Server - Claude Code Config\n\
            export ANTHROPIC_BASE_URL='http://127.0.0.1:1337'\n\
            # Jan Local API Server - Claude Code Config\n\
            export AFTER=1\n";
        assert_eq!(
            strip_jan_env_lines(content),
            "# Jan Local API Server notes: port 1337\nexport KEEP_ME=1\nexport AFTER=1\n"
        );
    }

    #[test]
    fn env_write_and_reset_keep_the_users_own_anthropic_exports() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".zshenv");
        let user = "export ANTHROPIC_API_KEY='mine'\nexport ANTHROPIC_MODEL=x\n";
        fs::write(&path, user).unwrap();
        let p = path.to_str().unwrap();

        write_env_to_shell(p, &[kv("ANTHROPIC_BASE_URL", "http://h")]).unwrap();
        assert!(fs::read_to_string(&path).unwrap().starts_with(user));

        fs::write(&path, build_cleaned_env_content(p).unwrap()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), user);
    }

    #[test]
    fn env_cleanup_removes_each_historical_legacy_format() {
        let m = LEGACY_ENV_MARKER;
        // First release: the exports were joined without newlines.
        let joined = format!(
            "export A=1\n{m}\nexport ANTHROPIC_BASE_URL='u'export ANTHROPIC_API_KEY='k'\n{m}\n"
        );
        assert_eq!(strip_jan_env_lines(&joined), "export A=1\n");
        // Admin fallback: closing marker written without a trailing newline.
        let admin = format!("export A=1\n\n{m}\nexport ANTHROPIC_BASE_URL='u'\n{m}");
        assert_eq!(strip_jan_env_lines(&admin), "export A=1\n");
        // Profile that did not end in a newline: the opening marker trails the
        // user's last line.
        let glued_open = format!("export A=1{m}\nexport ANTHROPIC_BASE_URL='u'\n{m}\n");
        assert_eq!(strip_jan_env_lines(&glued_open), "export A=1\n");
        // Text appended after an admin-written block lands on the closing line.
        let glued_close =
            format!("{m}\nexport ANTHROPIC_AUTH_TOKEN='t'\n{m}export B=2\nexport C=3\n");
        assert_eq!(
            strip_jan_env_lines(&glued_close),
            "export B=2\nexport C=3\n"
        );
    }

    #[test]
    fn env_cleanup_keeps_user_line_that_only_ends_with_the_legacy_marker() {
        let m = LEGACY_ENV_MARKER;
        let content = format!(
            "alias x='y' {m}\nexport KEEP=1\nexport ALSO=2\n{m}\nexport AFTER=1\n"
        );
        // The trailing line is not Jan's opening marker, so the lines up to
        // the next marker stay; only the whole-line marker is removed.
        assert_eq!(
            strip_jan_env_lines(&content),
            format!("alias x='y' {m}\nexport KEEP=1\nexport ALSO=2\nexport AFTER=1\n")
        );
        // Last line of the file: nothing to start, nothing removed.
        let last = format!("export A=1\necho done {m}\n");
        assert_eq!(strip_jan_env_lines(&last), last);
        // Indented whole-line marker still counts as the marker.
        let indented = format!("export A=1\n  {m}\nexport ANTHROPIC_BASE_URL='u'\n{m}\n");
        assert_eq!(strip_jan_env_lines(&indented), "export A=1\n");
    }

    #[test]
    fn env_profile_read_errors_are_returned_except_not_found() {
        let dir = tempdir().unwrap();
        let missing = dir.path().join(".zshenv");
        assert_eq!(read_shell_profile(missing.to_str().unwrap()).unwrap(), "");

        // Not valid UTF-8: refuse instead of replacing it with Jan's block.
        let binary = dir.path().join(".bashrc");
        fs::write(&binary, b"export A=1 # caf\xe9\n").unwrap();
        let p = binary.to_str().unwrap();
        assert!(write_env_to_shell(p, &[kv("ANTHROPIC_BASE_URL", "u")]).is_err());
        assert!(build_cleaned_env_content(p).is_err());
        assert_eq!(fs::read(&binary).unwrap(), b"export A=1 # caf\xe9\n");
    }

    #[cfg(unix)]
    #[test]
    fn env_admin_copy_failure_is_an_error() {
        let run = |script: &str| {
            std::process::Command::new("sh")
                .arg("-c")
                .arg(script)
                .output()
                .unwrap()
        };
        assert!(check_admin_copy(&run("exit 0"), "/p").is_ok());
        let err =
            check_admin_copy(&run("echo 'User canceled. (-128)' >&2; exit 1"), "/p").unwrap_err();
        assert!(err.contains("User canceled"), "{err}");
    }

    #[cfg(unix)]
    #[test]
    fn env_file_sources_to_the_literal_values() {
        let dir = tempdir().unwrap();
        let home = dir.path();
        let path = home.join(".zshenv");
        let canary = home.join("canary");
        let hostile = [
            format!("x'; touch '{}'; #", canary.display()),
            format!("$(touch {})", canary.display()),
            format!("`touch {}`", canary.display()),
            "a\\b \"c\" $HOME ''' end".to_string(),
            String::new(),
        ];
        for value in &hostile {
            write_env_to_shell(path.to_str().unwrap(), &[kv("CC_TEST_VAR", value)]).unwrap();
            let out = std::process::Command::new("sh")
                .arg("-c")
                .arg(". \"$1\" && printf '%s' \"$CC_TEST_VAR\"")
                .arg("sh")
                .arg(&path)
                .env_clear()
                .env("HOME", home)
                .env("PATH", "/usr/bin:/bin")
                .output()
                .unwrap();
            assert!(
                out.status.success(),
                "{}",
                String::from_utf8_lossy(&out.stderr)
            );
            assert_eq!(String::from_utf8(out.stdout).unwrap(), *value);
            assert!(!canary.exists(), "value {value:?} ran a command");
        }
    }
}
