fn main() {
    configure_jan_signing_key();

    #[cfg(not(feature = "cli"))]
    {
        tauri_build::build();
    }

    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");

        if let Ok(output) = std::process::Command::new("xcrun")
            .args(["--toolchain", "default", "--find", "swift"])
            .output()
        {
            let swift_path = String::from_utf8_lossy(&output.stdout)
                .trim()
                .to_string();
            if let Some(toolchain) = std::path::Path::new(&swift_path)
                .parent()
                .and_then(|p| p.parent())
            {
                let lib_path = toolchain.join("lib/swift/macosx");
                if lib_path.exists() {
                    println!(
                        "cargo:rustc-link-arg=-Wl,-rpath,{}",
                        lib_path.display()
                    );
                }
            }
        }
    }
}

/// Exposes `JAN_SIGNING_KEY` to the crate via `env!` (`cargo:rustc-env`). Cargo does not pass
/// arbitrary host env vars through to `rustc`, so `option_env!` alone cannot read CI secrets.
fn configure_jan_signing_key() {
    println!("cargo:rerun-if-env-changed=JAN_SIGNING_KEY");

    let profile = std::env::var("PROFILE").unwrap_or_default();
    let signing_key = std::env::var("JAN_SIGNING_KEY")
        .ok()
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
        .unwrap_or_else(|| {
            if profile == "release" {
                panic!("JAN_SIGNING_KEY must be set to a non-empty value for release builds");
            }
            "local-dev-test-key-not-for-production".to_string()
        });

    println!("cargo:rustc-env=JAN_SIGNING_KEY={signing_key}");
}
