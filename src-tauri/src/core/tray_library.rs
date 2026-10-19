use libloading::Library;
use std::io;

// Match libappindicator-sys 0.9's loader order, including its backcompat
// names used by bundled AppImages. Keep the handle until tray construction
// finishes, when libappindicator-sys owns its own reference to the library.
const APPINDICATOR_LIBRARIES: &[&str] = &[
    "libayatana-appindicator3.so.1",
    "libappindicator3.so.1",
    "libayatana-appindicator3.so",
    "libappindicator3.so",
];

pub(super) fn load_appindicator() -> io::Result<Library> {
    load_library(APPINDICATOR_LIBRARIES)
}

fn load_library(candidates: &[&str]) -> io::Result<Library> {
    let mut errors = Vec::new();
    for name in candidates {
        // SAFETY: these are the same platform libraries loaded by the tray
        // backend. No symbols are called here; the handle stays alive during
        // construction so the backend can acquire its own reference.
        match unsafe { Library::new(name) } {
            Ok(library) => return Ok(library),
            Err(error) => errors.push(format!("{name}: {error}")),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::NotFound,
        format!(
            "System tray unavailable: could not load an AppIndicator library; continuing without a tray icon. {}",
            errors.join("; ")
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "windows")]
    const SYSTEM_LIBRARY: &str = "kernel32.dll";
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    const SYSTEM_LIBRARY: &str = "libc.so.6";
    #[cfg(target_os = "macos")]
    const SYSTEM_LIBRARY: &str = "/usr/lib/libSystem.B.dylib";

    const MISSING: &str = "jan-test-missing-appindicator-library-9286";

    #[cfg(target_os = "windows")]
    #[test]
    fn linux_appindicator_names_are_fallible_when_unavailable() {
        let error = load_appindicator().unwrap_err();
        for name in APPINDICATOR_LIBRARIES {
            assert!(error.to_string().contains(name));
        }
    }

    #[test]
    fn missing_library_returns_an_error_instead_of_panicking() {
        let error = load_library(&[MISSING]).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::NotFound);
        assert!(error.to_string().contains(MISSING));
        assert!(error.to_string().contains("continuing without a tray icon"));
    }

    #[test]
    fn absent_candidates_all_appear_in_the_diagnostic() {
        let error = load_library(&[MISSING, "jan-second-missing-library-9286"]).unwrap_err();
        assert!(error.to_string().contains(MISSING));
        assert!(error
            .to_string()
            .contains("jan-second-missing-library-9286"));
    }

    #[test]
    #[cfg(any(
        target_os = "windows",
        target_os = "macos",
        all(target_os = "linux", target_env = "gnu")
    ))]
    fn falls_back_to_a_loadable_library() {
        assert!(load_library(&[MISSING, SYSTEM_LIBRARY]).is_ok());
    }

    #[test]
    #[cfg(any(
        target_os = "windows",
        target_os = "macos",
        all(target_os = "linux", target_env = "gnu")
    ))]
    fn stops_after_the_first_loadable_library() {
        assert!(load_library(&[SYSTEM_LIBRARY, MISSING]).is_ok());
    }
}
