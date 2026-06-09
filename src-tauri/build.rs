use std::fs;
use std::path::Path;

/// Compile-time vars read via `option_env!` in `core::telemetry` that we allow a
/// local `src-tauri/.env` to populate for dev builds. CI sets these in the real
/// environment, which always takes precedence over the file (see `load_dotenv`).
const DOTENV_KEYS: &[&str] = &["SENTRY_DSN_DESKTOP", "SENTRY_RELEASE", "SENTRY_ENVIRONMENT"];

/// ATO-113 (dev convenience): let a gitignored `src-tauri/.env` feed the Sentry
/// compile-time vars so devs don't have to `export` them in every shell. Cargo
/// does not read `.env` itself, so we parse it here and emit `cargo:rustc-env`
/// — but only for keys NOT already present in the ambient environment, so a CI
/// `export` (the production path) is never overridden.
fn load_dotenv() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
    let env_path = Path::new(&manifest_dir).join(".env");

    println!("cargo:rerun-if-changed={}", env_path.display());
    for key in DOTENV_KEYS {
        println!("cargo:rerun-if-env-changed={key}");
    }

    let Ok(contents) = fs::read_to_string(&env_path) else {
        return;
    };

    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((raw_key, raw_val)) = line.split_once('=') else {
            continue;
        };
        let key = raw_key.trim();
        if !DOTENV_KEYS.contains(&key) {
            continue;
        }
        // Ambient env (CI export) wins; the file only fills the gap.
        if std::env::var(key).is_ok() {
            continue;
        }
        let val = raw_val
            .trim()
            .trim_matches(|c| c == '"' || c == '\'');
        println!("cargo:rustc-env={key}={val}");
    }
}

fn main() {
    load_dotenv();

    #[cfg(not(feature = "cli"))]
    tauri_build::build()
}
