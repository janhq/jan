import { join } from 'node:path'

/**
 * Environment that confines the app's on-disk state to `home`.
 *
 * Its own module, with no side effects, so specs can assert on it without
 * re-evaluating wdio.conf.ts (which creates the temp profile at import time).
 * Callers must create the directories these variables name -- nothing here does,
 * and on Windows one of them not existing is fatal (see below).
 *
 * On Linux every XDG base directory is pinned, not just the ones Jan is known to
 * read today. Each outranks its `$HOME`-relative default, so any single one
 * inherited from the outer environment silently defeats the HOME override -- and
 * "the ones that matter" is a list that rots as the app changes.
 *
 * `XDG_CONFIG_HOME` is why this is belt-and-braces rather than minimal, and the
 * stakes are destructive rather than untidy. `dirs::config_dir()` feeds the
 * legacy-config migration in core/app/commands.rs, which runs on every fresh
 * profile and does `fs::copy` followed by `fs::remove_file`. With that variable
 * inherited, a run DELETES the developer's real ~/.config/Jan/settings.json.
 * Confirmed against a decoy: the file did not survive one run.
 *
 * The scratch directory is pinned on every platform, not just Linux.
 * `std::env::temp_dir()` reads TMPDIR on Unix and TMP/TEMP on Windows, and
 * tauri-plugin-agent-tools puts agent scratch at `temp_dir()/jan-agent-<session>`
 * -- then sweep_stale_scratch_dirs() (workspace.rs) DELETES every `jan-agent-*`
 * older than 24h it finds there. The current smoke suite never reaches that
 * sweep (it is gated on an existing thread, and a fresh profile has none), so
 * this is pre-emptive rather than a live bug. It stops being pre-emptive the
 * moment a spec creates a thread.
 *
 * On Windows the lever is `JAN_DATA_ROOT`, which is Jan's own rather than
 * something `dirs` provides: `dirs` asks the known-folder API for
 * FOLDERID_RoamingAppData and offers no override at all, so core/app/paths.rs
 * prefers the variable and falls back to `dirs`. It is honoured on every
 * platform but only needed here -- macOS and Linux keep resolving through HOME
 * and XDG_DATA_HOME, so those two go on exercising the same `dirs` lookup a real
 * user gets rather than the override branch.
 *
 * That closes the destructive legacy-config migration too, though not via
 * `dirs::config_dir()`: that call sits behind `#[cfg(target_os = "linux")]` in
 * legacy_app_config_candidate_paths(), so the only Windows candidate comes from
 * resolve_bundle_app_data_dir() -- `paths::data_dir()` joined with the bundle
 * identifier. One variable moves both because both go through paths.rs, not
 * because one known folder serves both.
 *
 * `APPDATA` is set alongside it for agreement, not because paths.rs reads it any
 * more: the shipping binary would otherwise answer one question two ways, and
 * anything else in the process tree that reads the variable directly would see
 * the real profile.
 *
 * `USERPROFILE` moves the known folders too, but only indirectly and only where
 * the target already exists, which is why it is not the lever. SHGetKnownFolderPath
 * resolves them through HKCU\...\Explorer\User Shell Folders, where the stock
 * values are REG_EXPAND_SZ `%USERPROFILE%\AppData\{Roaming,Local}`; it expands
 * those against the *process* environment, and then -- absent
 * KF_FLAG_DONT_VERIFY, which `dirs` does not pass -- fails outright if the
 * directory is not there. Two consequences:
 *
 * - The directories must exist before the app starts. Redirect USERPROFILE
 *   without creating `AppData\Local` under it and `dirs::cache_dir()` returns
 *   None, which is not a soft failure: tauri-plugin-http's cookie jar calls
 *   `app_cache_dir()?` from its setup hook (that is
 *   `dirs::cache_dir().ok_or(Error::UnknownPath)`), so the Tauri builder dies
 *   with PluginInitialization("http", "unknown path") before a window exists.
 *   wdio.conf.ts creates them; the comment there says why.
 * - Those registry values are the default, not a guarantee. Folder redirection
 *   or policy can make them literal paths that ignore USERPROFILE entirely, so
 *   isolation still rests on JAN_DATA_ROOT and paths.rs rather than on this.
 *
 * `LOCALAPPDATA` is set for agreement, not because `dirs` reads it -- it does
 * not. With the known folder already resolving inside the profile, leaving the
 * variable pointed at the real one would hand the app two different answers to
 * the same question. Together they also take the WebView2 user-data folder with
 * them, which matters more than it looks: Tauri puts it at
 * `%LOCALAPPDATA%\<identifier>\EBWebView`, keyed on the bundle identifier
 * (`jan.ai.app`) and not on the executable name, so an unconfined test run and
 * an installed Jan share one browser profile.
 *
 * Deliberately absent:
 * - XDG_DATA_DIRS / XDG_CONFIG_DIRS: read-only system paths; overriding them
 *   breaks GTK schema and theme lookup.
 * - XDG_RUNTIME_DIR: the app needs the real one for D-Bus. It cannot be
 *   isolated, which is an accepted gap rather than an oversight.
 * - A Windows override for `dirs::home_dir()`: there isn't one. It resolves
 *   FOLDERID_Profile (dirs-6.0.0 src/win.rs -> dirs_sys::known_folder_profile),
 *   which comes from the user's token rather than from a `%USERPROFILE%`
 *   template, so USERPROFILE does not move it the way it moves the AppData
 *   pair. The two readers under `~/.jan` -- `config.toml`
 *   (core/agent/global_config.rs) and `agent/subagents/`
 *   (core/agent/subagent.rs user_subagents_dir) -- therefore read the real user
 *   profile on Windows where HOME redirects them on macOS and Linux. Both are
 *   reads: the write at global_config.rs:469 is an explicit save no spec
 *   triggers, and user_subagents_dir's is gated behind prompt_subagent_create,
 *   which no spec reaches. So this is a read leak, not a destructive one.
 *   Strictly weaker than the other two platforms, and an accepted gap rather
 *   than an oversight.
 *
 * One Windows write still lands outside `home` and no variable here can move it.
 * It is residue rather than damage, and it is listed so the next person does not
 * have to rediscover it: `updater.json`, via tauri-plugin-store. The frontend's
 * update check (web-app/src/services/updater/tauri.ts) stores a nonce seed
 * through the plugin, which resolves BaseDirectory::AppData with Tauri's own
 * resolver -- `dirs::data_dir()`, not core/app/paths.rs -- so it lands in the
 * real `%APPDATA%\jan.ai.app\`. It is created only when absent and never
 * overwrites an existing seed, so the worst case is planting a file the real app
 * would have written itself.
 *
 * The one Windows escape that *was* destructive is gone rather than documented:
 * deep-link registration writes HKCU Software\Classes\jan, outside anything an
 * environment variable can reach, so it is compiled out under the `e2e` feature
 * (src-tauri/src/lib.rs) alongside single-instance.
 *
 * HOME is set on Windows as well. It moves nothing in `dirs`; it is there for
 * tooling that reads it directly, and setting it costs nothing.
 */
export function isolationEnv(home: string): Record<string, string> {
  // Callers must ensure the scratch directory exists: temp_dir() does not
  // create it.
  const tmp = join(home, 'tmp')
  if (process.platform === 'win32') {
    return {
      JAN_DATA_ROOT: join(home, 'AppData', 'Roaming'),
      APPDATA: join(home, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(home, 'AppData', 'Local'),
      USERPROFILE: home,
      HOME: home,
      TEMP: tmp,
      TMP: tmp,
    }
  }
  if (process.platform !== 'linux') return { HOME: home, TMPDIR: tmp }
  return {
    HOME: home,
    TMPDIR: tmp,
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_STATE_HOME: join(home, '.local', 'state'),
    XDG_CACHE_HOME: join(home, '.cache'),
  }
}
