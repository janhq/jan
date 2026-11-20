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
/// code. Leads with the action, then the versions that explain it. Without a
/// driver read (NVML would not load, or the startup read has not finished) the
/// engine's report is all there is, and the message says only that.
pub fn actionable_message(driver: Option<&NvidiaDriver>, toolkit: Option<CudaVersion>) -> String {
    let update = match toolkit.and_then(minimum_branch) {
        Some(branch) => format!("Update your NVIDIA driver to R{branch} or newer."),
        None => "Update your NVIDIA driver to the latest version.".to_string(),
    };
    let built = toolkit.map_or(String::new(), |v| format!(", built with CUDA {v}"));
    let Some(driver) = driver else {
        return format!("{update} The installed driver is too old for this engine{built}.");
    };
    let cuda = driver
        .cuda
        .map_or(String::new(), |v| format!(" (supports CUDA {v})"));
    format!(
        "{update} The installed driver {}{cuda} is too old for this engine{built}.",
        driver.version
    )
}

/// The `app.log` warning when the driver is older than the engine, naming what
/// fails. Within the engine's CUDA major only GPUs covered by PTX alone stop
/// working; a driver a whole major behind cannot start the CUDA runtime for any.
pub fn startup_warning(driver: &NvidiaDriver, toolkit: Option<CudaVersion>) -> Option<String> {
    if !driver_older_than_engine(driver, toolkit) {
        return None;
    }
    let (supported, built) = (driver.cuda?, toolkit?);
    let effect = if supported.major < built.major {
        "The CUDA runtime will not start on this driver for any GPU."
    } else {
        "GPUs the engine has no native code for will fail to load."
    };
    Some(format!(
        "{} {effect}",
        actionable_message(Some(driver), toolkit)
    ))
}

/// The text the backend-error banner shows for a worker fault line. A CUDA line
/// that says the driver cannot run the engine's code gets the update advice
/// ahead of ggml's own words. Anything else is passed through: a Vulkan driver
/// error, which updating the NVIDIA driver does not fix, and a driver that is
/// known to support the engine's CUDA, where "too old" would contradict the
/// versions printed beside it.
///
/// With either version unknown, or no driver read at all, the engine's own line
/// is the evidence, so the advice still applies.
pub fn fault_payload(
    line: &str,
    driver: Option<&NvidiaDriver>,
    toolkit: Option<CudaVersion>,
) -> String {
    let lower = line.to_lowercase();
    if !(lower.contains("cuda") || lower.contains("ptx"))
        || !crate::error::is_driver_too_old(&lower)
    {
        return line.to_string();
    }
    if matches!(
        (driver.and_then(|d| d.cuda), toolkit),
        (Some(supported), Some(built)) if supported >= built
    ) {
        return line.to_string();
    }
    format!(
        "{} Engine output: {line}",
        actionable_message(driver, toolkit)
    )
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
        let msg = actionable_message(Some(&driver("580.88", Some((13, 0)))), CUDA_13_2);
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
            let msg = actionable_message(Some(&driver("470.1", None)), toolkit);
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
    fn other_faults_pass_through_untouched() {
        let nvidia = driver("580.88", Some((13, 0)));
        let oom = "CUDA error: out of memory";
        assert_eq!(fault_payload(oom, Some(&nvidia), CUDA_13_2), oom);
        assert_eq!(fault_payload(oom, None, CUDA_13_2), oom);
    }

    // The banner prints both versions, so "too old" beside a driver that
    // supports the engine's CUDA would contradict itself.
    #[test]
    fn a_driver_that_supports_the_engines_cuda_is_not_told_to_update() {
        let current = driver("595.97", Some((13, 2)));
        assert_eq!(fault_payload(PTX_LINE, Some(&current), CUDA_13_2), PTX_LINE);
    }

    // The engine's own line is the evidence when a version is unknown.
    #[test]
    fn an_unknown_version_still_gets_the_advice_the_engine_asked_for() {
        let payload = fault_payload(PTX_LINE, Some(&driver("580.88", None)), None);
        assert!(
            payload.starts_with("Update your NVIDIA driver to the latest version."),
            "{payload}"
        );
    }

    // A fault can land before the startup read of the driver finishes, or on a
    // machine where NVML will not load; the engine's own line is still the
    // evidence, and the banner is shown once per fault.
    #[test]
    fn a_fault_with_no_driver_read_yet_still_gets_the_advice() {
        let payload = fault_payload(PTX_LINE, None, CUDA_13_2);
        assert!(
            payload.starts_with("Update your NVIDIA driver to R595 or newer."),
            "{payload}"
        );
        assert!(
            payload.ends_with(&format!("Engine output: {PTX_LINE}")),
            "{payload}"
        );
        assert!(!payload.contains("installed driver 5"), "{payload}");
    }

    // A driver a whole CUDA major behind fails the runtime for any GPU, so
    // the log must not suggest only PTX-only GPUs are affected.
    #[test]
    fn the_startup_warning_says_what_actually_fails() {
        let same_major = startup_warning(&driver("580.88", Some((13, 0))), CUDA_13_2).unwrap();
        assert!(same_major.contains("no native code"), "{same_major}");
        let older_major = startup_warning(&driver("470.1", Some((12, 4))), CUDA_13_2).unwrap();
        assert!(!older_major.contains("no native code"), "{older_major}");
        assert!(older_major.contains("any GPU"), "{older_major}");
        assert_eq!(
            startup_warning(&driver("595.97", Some((13, 2))), CUDA_13_2),
            None
        );
        assert_eq!(startup_warning(&driver("470.1", None), CUDA_13_2), None);
    }

    // A box with an NVIDIA card can still hit a Vulkan driver error on another
    // device; telling that user to update the NVIDIA driver would be wrong.
    #[test]
    fn a_vulkan_driver_error_is_not_blamed_on_the_nvidia_driver() {
        let nvidia = driver("580.88", Some((13, 0)));
        let vulkan = "ggml_vulkan: vkCreateInstance failed: ERROR_INCOMPATIBLE_DRIVER";
        assert_eq!(fault_payload(vulkan, Some(&nvidia), CUDA_13_2), vulkan);
    }
}
