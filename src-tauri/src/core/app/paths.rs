//! Where Jan's app-data root lives, and the one place that decision is made.
//!
//! `dirs::data_dir()`, `app.path().data_dir()` and `app.path().app_data_dir()`
//! all bottom out in the same per-OS lookup -- Tauri's resolvers are thin
//! wrappers over `dirs` (`tauri::path::desktop`). On Windows that lookup is
//! `SHGetKnownFolderPath(FOLDERID_RoamingAppData, 0, NULL, ..)`, which reads the
//! registry and ignores `%APPDATA%` entirely. With flags `0` and a null token,
//! the only input that can move the result is running as a different Windows
//! user.
//!
//! Every other desktop platform has a lever -- `HOME` on macOS, `HOME` plus
//! `XDG_DATA_HOME` on Linux -- so a test harness can confine a run to a
//! throwaway profile there, and on Windows it cannot. `JAN_DATA_ROOT` is that
//! lever.
//!
//! It is Jan's own variable rather than `%APPDATA%`, which would also have
//! worked -- Electron, Chromium and Python's `platformdirs` all read it, and
//! `dirs` declining to is a `dirs` design choice rather than a Windows
//! convention. The cost is the part that matters: `%APPDATA%` is set by Windows
//! for every interactive session and inherited by whatever a process was
//! launched from, so honouring it moves the data root of every existing install
//! onto a value Jan does not control. The blast radius is not read-only either
//! -- the legacy-config migration in `core/app/commands.rs` does `fs::copy`
//! followed by `fs::remove_file`. A dedicated name is unset in every real
//! install, so these helpers resolve byte-identically to `dirs` on all three
//! platforms unless someone deliberately points them elsewhere.
//!
//! Honoured on every platform, not just Windows: a variable that silently does
//! nothing on two of three platforms is a trap for whoever sets it there
//! expecting isolation.
//!
//! Read by the shipping binary and deliberately not gated behind the `e2e`
//! feature. The resolution these tests exist to cover has to be the resolution
//! that ships; compiling a different lookup into the test binary is the flaw
//! that ruled out `CI=e2e`, which short-circuits `get_app_configurations()` to a
//! hardcoded `"./data"` and so skips that resolution entirely.
//!
//! Distinct from `JAN_DATA_FOLDER`, which is older, read by
//! `resolve_jan_data_folder()`, and names the *data folder itself*
//! (`<root>/Jan/data` by default). `JAN_DATA_ROOT` names the OS-level root that
//! folder is resolved under.

use std::ffi::OsString;
use std::path::PathBuf;

#[cfg(not(feature = "cli"))]
use tauri::{AppHandle, Manager, Runtime};

/// Jan's override for the OS app-data root. See the module docs for why this is
/// not `%APPDATA%`.
const DATA_ROOT_ENV: &str = "JAN_DATA_ROOT";

/// The rules for reading [`DATA_ROOT_ENV`], split out from the lookup so the
/// validation is testable without touching the process environment.
///
/// An empty value means "unset", not "the current directory" -- joining onto
/// `PathBuf::from("")` would silently produce a relative data folder. A
/// non-absolute value is rejected for the same reason: the point of the
/// override is to make the data root *addressable*, and a relative one would
/// instead follow the working directory, landing a different run in a different
/// folder. Falling back to the OS default is the safer reading of a malformed
/// value than rooting the profile wherever the process happened to start.
fn absolute_override(raw: Option<OsString>) -> Option<PathBuf> {
    raw.map(PathBuf::from).filter(|value| value.is_absolute())
}

/// The override, or `None` when it is unset or malformed.
fn env_data_dir() -> Option<PathBuf> {
    absolute_override(std::env::var_os(DATA_ROOT_ENV))
}

/// The OS app-data root: `$JAN_DATA_ROOT` when set, else `dirs::data_dir()`.
///
/// Use in place of `dirs::data_dir()`.
pub fn data_dir() -> Option<PathBuf> {
    env_data_dir().or_else(dirs::data_dir)
}

/// Same as [`data_dir`], for code that already holds an `AppHandle`.
///
/// Use in place of `app.path().data_dir()`. Falls through to Tauri's resolver
/// when there is no override, so the error type and the `UnknownPath` case are
/// unchanged.
#[cfg(not(feature = "cli"))]
pub fn data_dir_for<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<PathBuf> {
    match env_data_dir() {
        Some(dir) => Ok(dir),
        None => app.path().data_dir(),
    }
}

/// The bundle-identifier subdirectory of [`data_dir_for`], e.g.
/// `<root>/jan.ai.app`.
///
/// Use in place of `app.path().app_data_dir()`. Mirrors Tauri's own definition
/// (`data_dir()` joined with `config.identifier`) rather than the
/// `TAURI_BUNDLE_IDENTIFIER` constant, because
/// `.github/scripts/rename-tauri-app.sh` rewrites the identifier per release
/// channel (`jan-nightly.ai.app`, ...) and a nightly build has to keep
/// resolving to its own directory.
#[cfg(not(feature = "cli"))]
pub fn app_data_dir_for<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<PathBuf> {
    match env_data_dir() {
        Some(dir) => Ok(dir.join(&app.config().identifier)),
        None => app.path().app_data_dir(),
    }
}

/// The vector-db plugin's collection root, under [`data_dir`].
///
/// The plugin is a separate workspace crate and cannot call into this module,
/// so the app resolves the root and hands it over -- at `init()` for the Tauri
/// command surface, and per call for the agent memory store.
pub fn vector_db_dir() -> PathBuf {
    let root = data_dir().unwrap_or_else(|| PathBuf::from("."));
    tauri_plugin_vector_db::db::base_dir_in(&root)
}

#[cfg(test)]
mod tests {
    use super::*;

    // An absolute path spelled the way the host spells them, so the rule under
    // test is exercised on every platform rather than only on one.
    #[cfg(target_os = "windows")]
    const ABSOLUTE: &str = r"C:\throwaway\Roaming";
    #[cfg(not(target_os = "windows"))]
    const ABSOLUTE: &str = "/throwaway/Roaming";

    #[test]
    fn only_an_absolute_override_counts_as_set() {
        assert_eq!(absolute_override(None), None);
        assert_eq!(absolute_override(Some(OsString::from(""))), None);
        // Relative: would otherwise resolve against the working directory.
        assert_eq!(absolute_override(Some(OsString::from("Roaming"))), None);
        assert_eq!(
            absolute_override(Some(OsString::from(ABSOLUTE))),
            Some(PathBuf::from(ABSOLUTE))
        );
    }

    // Mutates the process environment, so it takes SECRET_STORE_TEST_LOCK --
    // the lock every env-mutating test in this crate shares, for the reason
    // `with_temp_data_folder` spells out (core/app/commands.rs): the
    // environment is process-wide, so a lock private to this test would
    // exclude only the other tests that take *it*.
    //
    // That is necessary and not sufficient. Readers of `data_dir()` take no
    // lock and cannot be made to -- they are production code -- so nothing
    // stops a test on another thread from observing the override while it is
    // set. The guarantee is the shared lock plus `--test-threads=1`, which
    // `make test-rust` passes and every CI job reaches through `make test-ci`.
    // A bare `cargo test` without it can flake here, which is a property of
    // every env-mutating test in this crate rather than of this one.
    //
    // Unlike the `%APPDATA%` lookup this replaced, the override is honoured on
    // every platform, so this runs in `rust-check.yml` (ubuntu-only) as well as
    // on `test-on-windows-pr` rather than only the latter.
    #[test]
    fn the_override_outranks_the_os_default() {
        let _guard = crate::core::server::provider_secrets::SECRET_STORE_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        let previous = std::env::var_os(DATA_ROOT_ENV);

        std::env::set_var(DATA_ROOT_ENV, ABSOLUTE);
        assert_eq!(data_dir(), Some(PathBuf::from(ABSOLUTE)));

        // Malformed values fall back rather than rooting the profile relative
        // to the working directory.
        std::env::set_var(DATA_ROOT_ENV, "");
        assert_eq!(data_dir(), dirs::data_dir());

        std::env::set_var(DATA_ROOT_ENV, "Roaming");
        assert_eq!(data_dir(), dirs::data_dir());

        // Unset -- the state every real install is in -- resolves exactly where
        // it did before this module existed.
        std::env::remove_var(DATA_ROOT_ENV);
        assert!(env_data_dir().is_none());
        assert_eq!(data_dir(), dirs::data_dir());

        match previous {
            Some(value) => std::env::set_var(DATA_ROOT_ENV, value),
            None => std::env::remove_var(DATA_ROOT_ENV),
        }
    }
}
