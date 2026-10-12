//! What the NVIDIA driver can run, set against what the engine was built with.
//!
//! The engine's CUDA toolkit decides how new a driver it needs. A GPU with
//! native code in the engine runs on an older driver, but one that is only
//! covered by PTX (sm_80 and sm_90, and any GPU newer than the engine) is
//! compiled by the driver on first use, and a driver older than the toolkit that
//! wrote the PTX refuses it. The worker then aborts with no word on why, so the
//! versions are logged at start and named in the error when it happens (#9185).

use tauri_plugin_hardware::vendor::nvidia::{CudaVersion, NvidiaDriver};

/// The oldest NVIDIA driver release branch that runs a given toolkit's PTX.
/// Only the pairs that have been confirmed are listed; for any other toolkit
/// the advice just says to update.
fn minimum_branch(toolkit: CudaVersion) -> Option<u32> {
    match (toolkit.major, toolkit.minor) {
        (13, 2) => Some(595),
        _ => None,
    }
}

/// The driver is older than the engine's toolkit, so PTX-only GPUs will not run.
pub fn driver_older_than_engine(driver: &NvidiaDriver, toolkit: Option<CudaVersion>) -> bool {
    matches!((driver.cuda, toolkit), (Some(supported), Some(built)) if supported < built)
}

/// One line for `app.log` at engine start, so a later failure can be read
/// against the versions it ran with.
pub fn startup_line(driver: &NvidiaDriver, toolkit: Option<CudaVersion>) -> String {
    format!(
        "NVIDIA driver {} supports CUDA {}; engine built with CUDA {}",
        driver.version,
        driver.cuda.map_or("unknown".into(), |v| v.to_string()),
        toolkit.map_or("unknown".into(), |v| v.to_string()),
    )
}

/// What to tell the user when the engine reports the driver cannot run its
/// code. Leads with the action, then the versions that explain it.
pub fn actionable_message(driver: &NvidiaDriver, toolkit: Option<CudaVersion>) -> String {
    let update = match toolkit.and_then(minimum_branch) {
        Some(branch) => format!("Update your NVIDIA driver to R{branch} or newer."),
        None => "Update your NVIDIA driver to the latest version.".to_string(),
    };
    let cuda = driver
        .cuda
        .map_or(String::new(), |v| format!(" (supports CUDA {v})"));
    let built = toolkit.map_or(String::new(), |v| format!(", built with CUDA {v}"));
    format!(
        "{update} The installed driver {}{cuda} is too old for this engine{built}.",
        driver.version
    )
}

/// The text the backend-error banner shows for a worker fault line. A line that
/// says the driver cannot run the engine's code gets the update advice ahead of
/// ggml's own words; anything else, or no NVIDIA driver to name, is passed through.
pub fn fault_payload(
    line: &str,
    driver: Option<&NvidiaDriver>,
    toolkit: Option<CudaVersion>,
) -> String {
    match driver {
        Some(driver) if crate::error::is_driver_too_old(&line.to_lowercase()) => {
            format!(
                "{} Engine output: {line}",
                actionable_message(driver, toolkit)
            )
        }
        _ => line.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn driver(version: &str, cuda: Option<(u32, u32)>) -> NvidiaDriver {
        NvidiaDriver {
            version: version.into(),
            cuda: cuda.map(|(major, minor)| CudaVersion { major, minor }),
        }
    }

    const CUDA_13_2: Option<CudaVersion> = Some(CudaVersion {
        major: 13,
        minor: 2,
    });

    #[test]
    fn a_driver_supporting_older_cuda_than_the_engine_is_too_old() {
        assert!(driver_older_than_engine(
            &driver("580.88", Some((13, 0))),
            CUDA_13_2
        ));
        assert!(!driver_older_than_engine(
            &driver("595.97", Some((13, 2))),
            CUDA_13_2
        ));
        assert!(!driver_older_than_engine(
            &driver("600.1", Some((13, 3))),
            CUDA_13_2
        ));
    }

    // With either side unknown there is nothing to compare, and guessing would
    // tell a user with a working driver to update it.
    #[test]
    fn an_unknown_version_is_never_called_too_old() {
        assert!(!driver_older_than_engine(
            &driver("580.88", None),
            CUDA_13_2
        ));
        assert!(!driver_older_than_engine(
            &driver("580.88", Some((13, 0))),
            None
        ));
    }

    #[test]
    fn the_startup_line_names_the_driver_and_both_cuda_versions() {
        assert_eq!(
            startup_line(&driver("580.88", Some((13, 0))), CUDA_13_2),
            "NVIDIA driver 580.88 supports CUDA 13.0; engine built with CUDA 13.2"
        );
        assert_eq!(
            startup_line(&driver("580.88", None), None),
            "NVIDIA driver 580.88 supports CUDA unknown; engine built with CUDA unknown"
        );
    }

    #[test]
    fn the_message_asks_for_r595_when_the_engine_is_cuda_13_2() {
        let msg = actionable_message(&driver("580.88", Some((13, 0))), CUDA_13_2);
        assert!(
            msg.starts_with("Update your NVIDIA driver to R595 or newer."),
            "{msg}"
        );
        assert!(msg.contains("580.88"), "{msg}");
        assert!(msg.contains("supports CUDA 13.0"), "{msg}");
        assert!(msg.contains("built with CUDA 13.2"), "{msg}");
    }

    // A threshold is only stated where one is known; inventing one for another
    // toolkit would send users to a driver that may still be too old.
    #[test]
    fn the_message_does_not_invent_a_driver_floor() {
        for toolkit in [
            Some(CudaVersion {
                major: 12,
                minor: 9,
            }),
            None,
        ] {
            let msg = actionable_message(&driver("470.1", None), toolkit);
            assert!(
                msg.starts_with("Update your NVIDIA driver to the latest version."),
                "{msg}"
            );
            assert!(!msg.contains(" R"), "{msg}");
        }
    }

    const PTX_LINE: &str =
        "CUDA error: the provided PTX was compiled with an unsupported toolchain.";

    #[test]
    fn a_ptx_toolchain_fault_gets_the_update_advice_ahead_of_ggmls_words() {
        let payload = fault_payload(PTX_LINE, Some(&driver("580.88", Some((13, 0)))), CUDA_13_2);
        assert!(
            payload.starts_with("Update your NVIDIA driver to R595 or newer."),
            "{payload}"
        );
        assert!(
            payload.ends_with(&format!("Engine output: {PTX_LINE}")),
            "{payload}"
        );
    }

    #[test]
    fn other_faults_and_a_missing_driver_pass_through_untouched() {
        let nvidia = driver("580.88", Some((13, 0)));
        let oom = "CUDA error: out of memory";
        assert_eq!(fault_payload(oom, Some(&nvidia), CUDA_13_2), oom);
        assert_eq!(fault_payload(PTX_LINE, None, CUDA_13_2), PTX_LINE);
    }
}
