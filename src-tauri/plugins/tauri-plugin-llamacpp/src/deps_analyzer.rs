//! Out-of-process shared-library dependency analyzer. `lddtree`/`goblin` can
//! panic or segfault on malformed binaries; running it in a subprocess keeps
//! a crash from taking down the app. On macOS the analyzer runs `otool -L`
//! directly (see below), since lddtree's Mach-O handling is unreliable.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
#[cfg(not(target_os = "macos"))]
use std::process::{Command, Stdio};
#[cfg(target_os = "macos")]
use std::process::Command;

pub const ANALYZE_FLAG: &str = "--internal-analyze-deps";

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct AnalyzeOutput {
    pub missing: Vec<String>,
    pub resolved: Vec<String>,
}

// On macOS we analyze dependencies in-process (the target list is trivially
// small, so there is no crash-isolation need), so we never re-exec the
// analyzer subprocess and this entry point is a no-op.
#[cfg(target_os = "macos")]
pub fn run_deps_analyzer_if_requested() {}

#[cfg(not(target_os = "macos"))]
pub fn run_deps_analyzer_if_requested() {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some(ANALYZE_FLAG) {
        return;
    }

    // First arg is the platform-joined list of library search dirs (the
    // backend's own dir plus any GPU runtime dirs, e.g. ROCm under /opt).
    let lib_dirs: Vec<PathBuf> = match args.next() {
        Some(d) => std::env::split_paths(&d).collect(),
        None => {
            eprintln!("{}: missing <lib_dirs> argument", ANALYZE_FLAG);
            std::process::exit(2);
        }
    };
    let targets: Vec<PathBuf> = args.map(PathBuf::from).collect();

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        analyze(&lib_dirs, &targets)
    }));

    match result {
        Ok(out) => match serde_json::to_string(&out) {
            Ok(s) => {
                println!("{}", s);
                std::process::exit(0);
            }
            Err(e) => {
                eprintln!("serialize failed: {}", e);
                std::process::exit(3);
            }
        },
        Err(e) => {
            let msg = e
                .downcast_ref::<&str>()
                .copied()
                .or_else(|| e.downcast_ref::<String>().map(|s| s.as_str()))
                .unwrap_or("unknown panic");
            eprintln!("lddtree panic: {}", msg);
            std::process::exit(4);
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn analyze(lib_dirs: &[PathBuf], targets: &[PathBuf]) -> AnalyzeOutput {
    let mut analyzer = lddtree::DependencyAnalyzer::default();
    for dir in lib_dirs {
        analyzer = analyzer.add_library_path(dir.to_path_buf());
    }

    let mut missing: HashSet<String> = HashSet::new();
    let mut resolved: HashSet<String> = HashSet::new();

    for path in targets {
        let tree = match analyzer.clone().analyze(path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        for (name, lib) in &tree.libraries {
            if lib.found() {
                resolved.insert(name.clone());
            } else if !is_virtual_windows_dll(name) {
                missing.insert(name.clone());
            }
        }
    }

    let mut missing: Vec<String> = missing.into_iter().collect();
    let mut resolved: Vec<String> = resolved.into_iter().collect();
    missing.sort();
    resolved.sort();
    AnalyzeOutput { missing, resolved }
}

// api-ms-win-*/ext-ms-win-* are virtual DLLs resolved by the Windows kernel
// and never exist on disk — lddtree flags them as missing but they aren't.
pub(crate) fn is_virtual_windows_dll(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.starts_with("api-ms-win-") || lower.starts_with("ext-ms-win-")
}

// macOS resolves dynamic libraries via dyld at load time. lddtree's Mach-O
// handling is unreliable and has crashed in the field, so instead of re-using
// the Linux analyzer we run `otool -L` on each target dylib and resolve the
// dependencies against the backend's own dir plus any GPU runtime dirs. A
// dylib that dyld cannot load in the shipped app (e.g. a Homebrew openssl that
// is neither bundled nor on a system path) shows up here as missing.

/// True when `path` lives in a system location that every app can rely on at
/// runtime (and is never bundled with the backend).
#[cfg(target_os = "macos")]
fn is_system_resolvable(path: &Path) -> bool {
    let s = path.to_string_lossy();
    s.starts_with("/usr/lib/")
        || s.starts_with("/System/")
        || s.starts_with("/usr/libexec/")
        || (s.starts_with("/Applications/Xcode")
            && (s.contains(".framework/") || s.contains("/usr/lib/")))
}

/// True when `path` is bundled inside one of the library search dirs.
#[cfg(target_os = "macos")]
fn is_bundled(path: &Path, lib_dirs: &[PathBuf]) -> bool {
    lib_dirs.iter().any(|dir| {
        dir.canonicalize()
            .map(|d| path.canonicalize().map(|p| p.starts_with(&d)).unwrap_or(false))
            .unwrap_or(false)
    })
}

/// Strips a leading dyld substitution token (`@rpath/`, `@loader_path/`,
/// `@executable_path/`) leaving only the relative path that follows the `@`.
/// These tokens can be nested, so strip every leading `@`-prefixed segment.
#[cfg(target_os = "macos")]
fn strip_at_prefix(name: &str) -> &str {
    let mut rest = name;
    loop {
        let Some(tail) = rest.strip_prefix('@') else {
            return rest;
        };
        match tail.find('/') {
            Some(idx) => rest = &tail[idx + 1..],
            None => return "", // only "@token" with no path component
        }
    }
}

/// Resolves one install-name against the library search dirs, recursing into
/// any dylib it resolves so the transitive closure is fully verified.
#[cfg(target_os = "macos")]
fn resolve_macos_dependency(
    name: &str,
    lib_dirs: &[PathBuf],
    resolved: &mut HashSet<String>,
    missing: &mut HashSet<String>,
    seen: &mut HashSet<String>,
) {
    if !seen.insert(name.to_string()) {
        return;
    }

    // Absolute install names are loaded by dyld directly. In the shipped app
    // only system paths and paths bundled inside the backend dir resolve: a
    // Homebrew path such as /usr/local/opt/openssl@3/lib/libssl.3.dylib is
    // neither. Homebrew copies are also rejected by dyld under the hardened
    // runtime (code-signature Team ID mismatch), so they are unresolvable even
    // the dylib exists on this build host. Flag them missing.
    if name.starts_with('/') {
        let p = Path::new(name);
        if is_system_resolvable(p) {
            // Always present at runtime; nothing to scan. (analyze_macos_binary
            // also skips /usr and /System paths, so no recursion here.)
            resolved.insert(name.to_string());
            return;
        }
        if is_bundled(p, lib_dirs) {
            // A bundled dylib referenced by absolute path: record it resolved
            // AND recurse into its own load commands, so an unbundled
            // transitive dependency (e.g. the Homebrew openssl) is caught.
            resolved.insert(name.to_string());
            analyze_macos_binary(p, lib_dirs, resolved, missing, seen);
            return;
        }
        // Homebrew / other absolute paths are neither bundled nor system;
        // flag them missing (dyld also rejects them by code signature).
        missing.insert(name.to_string());
        return;
    }

    // @rpath/..., @loader_path/... and @executable_path/... resolve to a
    // directory dyld picks at load time. In the shipped backend these resolve
    // into the backend dir (or GPU runtime dirs), so probe only the bare
    // relative path that follows the @ token.
    let bare = strip_at_prefix(name);
    let mut found: Option<PathBuf> = None;
    for dir in lib_dirs {
        let candidate = dir.join(bare);
        if candidate.exists() {
            found = Some(candidate);
            break;
        }
    }

    match found {
        Some(candidate) => {
            resolved.insert(name.to_string());
            // Recursively check the resolved dylib's own transitive deps.
            analyze_macos_binary(&candidate, lib_dirs, resolved, missing, seen);
        }
        None => {
            missing.insert(name.to_string());
        }
    }
}

/// Runs `otool -L` on a Mach-O binary/dylib and resolves each dependency
/// listed in its load commands.
#[cfg(target_os = "macos")]
fn analyze_macos_binary(
    path: &Path,
    lib_dirs: &[PathBuf],
    resolved: &mut HashSet<String>,
    missing: &mut HashSet<String>,
    seen: &mut HashSet<String>,
) {
    // Skip system-loadable targets outright; they are always present.
    if path.starts_with("/usr/") || path.starts_with("/System/") {
        return;
    }

    let output = match Command::new("otool").arg("-L").arg(path).output() {
        Ok(o) => o,
        Err(e) => {
            log::warn!("deps_analyzer: otool -L {} failed: {}", path.display(), e);
            return;
        }
    };
    if !output.status.success() {
        return;
    }
    let text = String::from_utf8_lossy(&output.stdout);

    for line in text.lines() {
        // Real dependency lines from `otool -L` look like:
        //   /usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current ...)
        // The first line of output echoes the file itself (no
        // "(compatibility"), and invalid files print "<path>: is not an
        // object file". Filtering on "(compatibility" drops both so an echoed
        // path is never mistaken for a dependency.
        if !line.contains("(compatibility") {
            continue;
        }
        let trimmed = line.trim();
        let dep = match trimmed.split_whitespace().next() {
            Some(d) => d,
            None => continue,
        };
        resolve_macos_dependency(dep, lib_dirs, resolved, missing, seen);
    }
}

#[cfg(target_os = "macos")]
pub fn analyze_out_of_process(lib_dirs: &[PathBuf], targets: &[PathBuf]) -> AnalyzeOutput {
    let mut missing: HashSet<String> = HashSet::new();
    let mut resolved: HashSet<String> = HashSet::new();
    let mut seen: HashSet<String> = HashSet::new();

    for target in targets {
        analyze_macos_binary(target, lib_dirs, &mut resolved, &mut missing, &mut seen);
    }

    let mut missing: Vec<String> = missing.into_iter().collect();
    let mut resolved: Vec<String> = resolved.into_iter().collect();
    missing.sort();
    resolved.sort();
    AnalyzeOutput { missing, resolved }
}

#[cfg(not(target_os = "macos"))]
pub fn analyze_out_of_process(lib_dirs: &[PathBuf], targets: &[PathBuf]) -> AnalyzeOutput {
    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            log::warn!("deps_analyzer: current_exe failed: {}", e);
            return AnalyzeOutput::default();
        }
    };

    let joined = match std::env::join_paths(lib_dirs) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("deps_analyzer: failed to join lib dirs: {}", e);
            return AnalyzeOutput::default();
        }
    };

    let mut cmd = Command::new(&exe);
    cmd.arg(ANALYZE_FLAG).arg(joined);
    for t in targets {
        cmd.arg(t);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = match cmd.output() {
        Ok(o) => o,
        Err(e) => {
            log::warn!("deps_analyzer: failed to spawn subprocess: {}", e);
            return AnalyzeOutput::default();
        }
    };

    if !output.status.success() {
        log::warn!(
            "deps_analyzer: subprocess exited with {:?}; stderr: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim(),
        );
        return AnalyzeOutput::default();
    }

    match serde_json::from_slice::<AnalyzeOutput>(&output.stdout) {
        Ok(o) => o,
        Err(e) => {
            log::warn!(
                "deps_analyzer: malformed subprocess output: {} (stdout: {})",
                e,
                String::from_utf8_lossy(&output.stdout).trim(),
            );
            AnalyzeOutput::default()
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::collections::HashSet;

    /// Regression test for #8476: a backend that links an unbundled Homebrew
    /// dylib at an absolute path must be flagged missing even when that dylib
    /// exists on the build host, because the signed app rejects it at runtime.
    #[test]
    fn flags_unbundled_homebrew_dylib_as_missing() {
        let temp_dir = tempfile::tempdir().unwrap();
        let lib_dirs = vec![temp_dir.path().to_path_buf()];
        let homebrew = "/usr/local/opt/openssl@3/lib/libssl.3.dylib";
        let mut resolved = HashSet::new();
        let mut missing = HashSet::new();
        let mut seen = HashSet::new();

        resolve_macos_dependency(
            homebrew,
            &lib_dirs,
            &mut resolved,
            &mut missing,
            &mut seen,
        );

        assert!(missing.contains(homebrew));
        assert!(!resolved.contains(homebrew));
    }

    /// A system-resolvable dylib (e.g. /usr/lib/libSystem.B.dylib) is not
    /// flagged missing; it is always present in the shipped app.
    #[test]
    fn accepts_system_resolvable_absolute_path() {
        let lib_dirs = vec![PathBuf::from("/tmp/backend")];
        let mut resolved = HashSet::new();
        let mut missing = HashSet::new();
        let mut seen = HashSet::new();

        resolve_macos_dependency(
            "/usr/lib/libSystem.B.dylib",
            &lib_dirs,
            &mut resolved,
            &mut missing,
            &mut seen,
        );

        assert!(resolved.contains("/usr/lib/libSystem.B.dylib"));
        assert!(missing.is_empty());
    }

    /// A bare dylib name found inside the backend dir is resolved (bundled).
    #[test]
    fn resolves_bare_name_bundled_in_backend_dir() {
        let temp_dir = tempfile::tempdir().unwrap();
        let backend_dir = temp_dir.path().to_path_buf();
        let lib_dirs = vec![backend_dir.clone()];

        // A stub file so the candidate "exists"; otool fails harmlessly on a
        // non-Mach-O file and the name is still recorded as resolved/bundled.
        std::fs::write(backend_dir.join("libllama.dylib"), b"stub").unwrap();

        let mut resolved = HashSet::new();
        let mut missing = HashSet::new();
        let mut seen = HashSet::new();

        resolve_macos_dependency(
            "libllama.dylib",
            &lib_dirs,
            &mut resolved,
            &mut missing,
            &mut seen,
        );

        assert!(resolved.contains("libllama.dylib"));
        assert!(missing.is_empty());
    }

    /// A bare dylib name absent from every lib dir is missing.
    #[test]
    fn flags_unresolvable_bare_name_as_missing() {
        let temp_dir = tempfile::tempdir().unwrap();
        let lib_dirs = vec![temp_dir.path().to_path_buf()];
        let mut resolved = HashSet::new();
        let mut missing = HashSet::new();
        let mut seen = HashSet::new();

        resolve_macos_dependency(
            "libmissing.dylib",
            &lib_dirs,
            &mut resolved,
            &mut missing,
            &mut seen,
        );

        assert!(missing.contains("libmissing.dylib"));
        assert!(resolved.is_empty());
    }

    /// An @rpath / @loader_path install name points at a dylib bundled inside
    /// the backend dir; the @ token must be stripped and only the relative
    /// path probed, otherwise a healthy @rpath-linked backend is false-flagged
    /// as missing.
    #[test]
    fn resolves_rpath_install_name_bundled_in_backend_dir() {
        let temp_dir = tempfile::tempdir().unwrap();
        let backend_dir = temp_dir.path().to_path_buf();
        let lib_dirs = vec![backend_dir.clone()];

        std::fs::write(backend_dir.join("libllama.dylib"), b"stub").unwrap();

        let mut resolved = HashSet::new();
        let mut missing = HashSet::new();
        let mut seen = HashSet::new();

        resolve_macos_dependency(
            "@rpath/libllama.dylib",
            &lib_dirs,
            &mut resolved,
            &mut missing,
            &mut seen,
        );

        assert!(resolved.contains("@rpath/libllama.dylib"));
        assert!(missing.is_empty(), "missing: {missing:?}");
    }

    /// An @loader_path-relative install name resolves the same way.
    #[test]
    fn strip_at_prefix_handles_nested_tokens() {
        assert_eq!(strip_at_prefix("@rpath/libggml.dylib"), "libggml.dylib");
        assert_eq!(strip_at_prefix("@loader_path/../lib/libfoo.dylib"), "../lib/libfoo.dylib");
        assert_eq!(strip_at_prefix("@executable_path/libbar.dylib"), "libbar.dylib");
        assert_eq!(strip_at_prefix("libplain.dylib"), "libplain.dylib");
        assert_eq!(strip_at_prefix("/usr/lib/libSystem.B.dylib"), "/usr/lib/libSystem.B.dylib");
    }

    /// Integration test for the #8476 transitive shape: a bundled dylib that
    /// is itself linked by an absolute install name must still have its OWN
    /// dependencies recursed into, so an unbundled Homebrew dylib one level
    /// down is caught instead of silently reported verified. Builds a real
    /// Mach-O chain (exe -> bundled dylib -> Homebrew-path dylib) with clang.
    #[test]
    fn absolute_path_bundled_dylib_recurses_into_transitive_deps() {
        use std::process::Command;

        // Requires clang + otool (present with Xcode CLT on macOS).
        let clang = match Command::new("clang").arg("--version").output() {
            Ok(o) if o.status.success() => "clang",
            _ => return, // skip when toolchain unavailable
        };

        let temp_dir = tempfile::tempdir().unwrap();
        let bin = temp_dir.path().join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let homebrew = "/usr/local/opt/openssl@3/lib/libcrypto.3.dylib";

        // 1) A stub dylib whose install name is the Homebrew openssl path.
        let src1 = bin.join("openssl_stub.c");
        std::fs::write(&src1, "int openssl_sym(void){return 0;}\n").unwrap();
        let stub = bin.join("libcrypto.3.dylib");
        let compile_stub = Command::new(clang)
            .args(["-dynamiclib", "-o"])
            .arg(&stub)
            .arg(&src1)
            .output()
            .unwrap();
        assert!(compile_stub.status.success(), "stub compile failed");
        let set_name = Command::new("install_name_tool")
            .args(["-id", homebrew])
            .arg(&stub)
            .output()
            .unwrap();
        assert!(set_name.status.success());

        // 2) A bundled wrapper dylib (absolute install name inside bin/) that
        //    links the Homebrew stub so it appears as a transitive dep.
        let src2 = bin.join("backend_stub.c");
        std::fs::write(&src2, "int backend_sym(void){return 1;}\n").unwrap();
        let wrapper = bin.join("libbackend.dylib");
        let wrapper_install = wrapper.to_string_lossy();
        let compile_wrapper = Command::new(clang)
            .args(["-dynamiclib", "-o"])
            .arg(&wrapper)
            .arg(&src2)
            .arg(&stub)
            .arg(format!("-Wl,-dylib_install_name,{wrapper_install}"))
            .output()
            .unwrap();
        assert!(compile_wrapper.status.success(), "wrapper compile failed");

        // 3) A fake llama-server executable linking the wrapper by its
        //    absolute install name (scan targets = [exe]).
        let src3 = bin.join("main.c");
        std::fs::write(&src3, "int main(void){return 0;}\n").unwrap();
        let exe = bin.join("llama-server");
        let compile_exe = Command::new(clang)
            .arg(&src3)
            .arg(&wrapper)
            .args(["-Wl,-rpath", bin.to_str().unwrap()])
            .arg("-o")
            .arg(&exe)
            .output()
            .unwrap();
        assert!(compile_exe.status.success(), "exe compile failed");

        let out = analyze_out_of_process(&[bin.clone()], &[exe]);

        // The Homebrew-path dylib must be reported missing even though it is
        // only reachable through the absolute-path bundled wrapper.
        assert!(
            out.missing.iter().any(|m| m == homebrew),
            "expected {homebrew} in missing, got missing={:?} resolved={:?}",
            out.missing,
            out.resolved
        );
    }
}
