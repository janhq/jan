use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

/// Absolute path of a Windows system tool, `<SystemRoot>\System32\<exe>`.
///
/// `Command::new("tasklist")` on Windows looks in the application's own
/// directory before System32, so system tools are spawned by full path.
/// `exe` includes the extension, e.g. `"taskkill.exe"`.
pub fn windows_system_tool(exe: &str) -> PathBuf {
    system32_path(
        std::env::var_os("SystemRoot").or_else(|| std::env::var_os("windir")),
        exe,
    )
}

/// Pure path building for [`windows_system_tool`]: joins with `\` explicitly
/// so it gives the same result (and can be tested) on every host. An unset or
/// empty root falls back to `C:\Windows`.
fn system32_path(root: Option<OsString>, exe: &str) -> PathBuf {
    let root = root
        .filter(|r| !r.is_empty())
        .unwrap_or_else(|| OsString::from(r"C:\Windows"));
    let mut path = match root.to_str() {
        Some(s) => OsString::from(s.trim_end_matches(['\\', '/'])),
        None => root,
    };
    path.push(OsStr::new(r"\System32\"));
    path.push(exe);
    PathBuf::from(path)
}

/// Program to spawn for `git`.
///
/// On Windows `Command::new("git")` looks in the application's own directory
/// before `PATH`, and Jan installs per-user, so a `git.exe` placed next to
/// Jan's executable would run instead of the user's git. There this finds
/// `git.exe` on `PATH` itself, skipping Jan's own directory and the current
/// directory, and returns its absolute path (looked up once, then cached).
/// With no such git it fails with `NotFound`, as spawning a missing `git`
/// does. Elsewhere it is plain `git`.
pub fn git_program() -> std::io::Result<PathBuf> {
    #[cfg(windows)]
    {
        use std::sync::OnceLock;
        static FOUND: OnceLock<PathBuf> = OnceLock::new();
        if let Some(found) = FOUND.get() {
            return Ok(found.clone());
        }
        let resolve = |p: &Path| std::fs::canonicalize(p).ok();
        let mut excluded = Vec::new();
        if let Some(dir) = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().and_then(|d| resolve(d)))
        {
            excluded.push(dir);
        }
        if let Some(dir) = std::env::current_dir().ok().and_then(|d| resolve(&d)) {
            excluded.push(dir);
        }
        let dirs: Vec<PathBuf> = std::env::var_os("PATH")
            .map(|p| std::env::split_paths(&p).collect())
            .unwrap_or_default();
        match pick_git_exe(&dirs, &excluded, resolve, |p| p.is_file()) {
            Some(found) => Ok(FOUND.get_or_init(|| found).clone()),
            None => Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "git.exe not found on PATH",
            )),
        }
    }
    #[cfg(not(windows))]
    {
        Ok(PathBuf::from("git"))
    }
}

/// Pure selection for [`git_program`] on Windows: the first `git.exe` in an
/// absolute `PATH` entry whose resolved directory is not one of `excluded`
/// (already resolved). Paths compare as Windows does, ignoring case, slash
/// direction and trailing separators, so it can be tested on every host.
#[cfg_attr(not(windows), allow(dead_code))]
fn pick_git_exe(
    path_dirs: &[PathBuf],
    excluded: &[PathBuf],
    resolve: impl Fn(&Path) -> Option<PathBuf>,
    is_file: impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
    fn key(p: &Path) -> String {
        p.to_string_lossy()
            .replace('/', "\\")
            .trim_end_matches('\\')
            .to_lowercase()
    }
    fn is_absolute(p: &Path) -> bool {
        let s = p.to_string_lossy().replace('/', "\\");
        let b = s.as_bytes();
        s.starts_with("\\\\")
            || (b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] == b'\\')
    }
    let excluded: Vec<String> = excluded.iter().map(|p| key(p)).collect();
    path_dirs
        .iter()
        .filter(|dir| is_absolute(dir))
        .filter_map(|dir| resolve(dir))
        .filter(|dir| !excluded.contains(&key(dir)))
        .map(|dir| dir.join("git.exe"))
        .find(|candidate| is_file(candidate))
}

/// Environment variable Jan sets on every `mlx-server` it starts. The startup
/// sweep stops an orphaned `mlx-server` only when it carries this, because the
/// server's name, path and flags can all belong to one someone runs themselves.
pub const MLX_OWNER_ENV: &str = "JAN_MLX_OWNER";

/// Returns true when the current process is running inside a Flatpak sandbox
pub fn is_flatpak() -> bool {
    Path::new("/.flatpak-info").exists()
}

/// Checks if npx can be overridden with bun binary
pub fn can_override_npx(bun_path: String) -> bool {
    // We need to check the CPU for the AVX2 instruction support if we are running under MacOS
    // with Intel CPU. We can override `npx` command with `bun` only if CPU is
    // supporting AVX2, otherwise we need to use default `npx` binary
    #[cfg(all(target_os = "macos", any(target_arch = "x86", target_arch = "x86_64")))]
    {
        if !is_x86_feature_detected!("avx2") {
            #[cfg(feature = "logging")]
            log::warn!(
                "Your CPU doesn't support AVX2 instruction, default npx binary will be used"
            );
            return false; // we cannot override npx with bun binary
        }
    }
    // Check if bun_path exists
    if !std::path::Path::new(bun_path.as_str()).exists() {
        #[cfg(feature = "logging")]
        log::warn!(
            "bun binary not found at '{}', default npx binary will be used",
            bun_path
        );
        return false;
    }
    true // by default, we can override npx with bun binary
}

/// Checks if uv_path exists and determines if uvx can be overridden with the uv binary
pub fn can_override_uvx(uv_path: String) -> bool {
    if !std::path::Path::new(uv_path.as_str()).exists() {
        #[cfg(feature = "logging")]
        log::warn!(
            "uv binary not found at '{}', default uvx binary will be used",
            uv_path
        );
        return false;
    }
    true // by default, we can override uvx with uv binary
}

#[derive(Default)]
pub struct CudaPaths {
    pub lib_paths: Vec<String>,
    pub bin_paths: Vec<String>,
}

impl CudaPaths {
    /// Folds another set of GPU runtime paths in, de-duplicating. Used to merge
    /// CUDA + ROCm discovery into one `setup_library_path` call.
    pub fn merged(mut self, other: CudaPaths) -> CudaPaths {
        for p in other.lib_paths {
            if !self.lib_paths.contains(&p) {
                self.lib_paths.push(p);
            }
        }
        for p in other.bin_paths {
            if !self.bin_paths.contains(&p) {
                self.bin_paths.push(p);
            }
        }
        self
    }
}

/// Environment a child needs to resolve the backend's libraries. Returned
/// rather than applied so callers holding either a `tokio` or a `std` Command
/// share one implementation.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct LibraryEnv {
    pub vars: Vec<(String, String)>,
    pub current_dir: Option<std::path::PathBuf>,
}

// Mirrors the Command setter names so the path-building logic below reads the
// same whether it targets a Command or this struct.
impl LibraryEnv {
    fn env(&mut self, key: &str, value: impl AsRef<str>) {
        self.vars
            .push((key.to_string(), value.as_ref().to_string()));
    }

    fn current_dir(&mut self, dir: impl AsRef<Path>) {
        self.current_dir = Some(dir.as_ref().to_path_buf());
    }
}

/// Merges binary lib dir + CUDA paths into a single `command.env()` call per variable.
pub fn setup_library_path(
    library_path: Option<&Path>,
    cuda: &CudaPaths,
    command: &mut tokio::process::Command,
) {
    let env = library_path_env(library_path, cuda);
    for (key, value) in &env.vars {
        command.env(key, value);
    }
    if let Some(dir) = &env.current_dir {
        command.current_dir(dir);
    }
}

/// Computes the same overrides `setup_library_path` applies.
pub fn library_path_env(library_path: Option<&Path>, cuda: &CudaPaths) -> LibraryEnv {
    let mut env = LibraryEnv::default();
    let command = &mut env;

    if cfg!(target_os = "linux") {
        let mut all_lib_dirs: Vec<String> = Vec::new();
        if let Some(lib_path) = library_path {
            all_lib_dirs.push(lib_path.to_string_lossy().to_string());
        }
        all_lib_dirs.extend(cuda.lib_paths.iter().cloned());

        if !all_lib_dirs.is_empty() {
            let current = std::env::var("LD_LIBRARY_PATH").unwrap_or_default();
            let current = current.trim_end_matches(':');
            let new_val = if current.is_empty() {
                all_lib_dirs.join(":")
            } else {
                format!("{}:{}", all_lib_dirs.join(":"), current)
            };
            command.env("LD_LIBRARY_PATH", &new_val);

            #[cfg(feature = "logging")]
            log::info!("LD_LIBRARY_PATH set to: {}", new_val);
        }

        if !cuda.bin_paths.is_empty() {
            let current = std::env::var("PATH").unwrap_or_default();
            let current = current.trim_end_matches(':');
            let new_val = if current.is_empty() {
                cuda.bin_paths.join(":")
            } else {
                format!("{}:{}", cuda.bin_paths.join(":"), current)
            };
            command.env("PATH", &new_val);

            #[cfg(feature = "logging")]
            log::info!("PATH set to: {}", new_val);
        }
    } else if cfg!(target_os = "windows") {
        let mut all_dirs: Vec<String> = Vec::new();
        if let Some(lib_path) = library_path {
            let lib_str = lib_path.to_string_lossy();
            let normalized = if let Some(stripped) = lib_str.strip_prefix(r"\\?\") {
                stripped.to_string()
            } else {
                lib_str.to_string()
            };
            all_dirs.push(normalized);
        }
        all_dirs.extend(cuda.lib_paths.iter().cloned());
        all_dirs.extend(cuda.bin_paths.iter().cloned());

        if !all_dirs.is_empty() {
            let current = std::env::var("PATH").unwrap_or_default();
            let current = current.trim_end_matches(';');
            let new_val = format!("{};{}", all_dirs.join(";"), current);
            command.env("PATH", &new_val);

            #[cfg(feature = "logging")]
            log::info!("PATH set to: {}", new_val);
        }

        if let Some(lib_path) = library_path {
            command.current_dir(lib_path);
        }
    } else if cfg!(target_os = "macos") {
        if let Some(lib_path) = library_path {
            let lib_str = lib_path.to_string_lossy();
            let new_lib_path = match std::env::var("DYLD_LIBRARY_PATH") {
                Ok(path) => format!("{}:{}", lib_str, path),
                Err(_) => lib_str.to_string(),
            };
            command.env("DYLD_LIBRARY_PATH", new_lib_path);

            #[cfg(feature = "logging")]
            log::info!("Added to DYLD_LIBRARY_PATH: {}", lib_str);
        }
    } else {
        #[cfg(feature = "logging")]
        log::warn!("Library path setup not supported on this OS");
    }

    env
}

pub fn binary_requires_cuda(_bin_path: &Path) -> bool {
    #[cfg(target_os = "windows")]
    return binary_requires_cuda_windows(_bin_path);

    #[cfg(target_os = "linux")]
    return binary_requires_cuda_linux(_bin_path);

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    false
}

#[cfg(target_os = "windows")]
fn binary_requires_cuda_windows(bin_path: &Path) -> bool {
    if let Ok(contents) = std::fs::read(bin_path) {
        let contents_str = String::from_utf8_lossy(&contents);
        return contents_str.contains("cudart")
            || contents_str.contains("cublas")
            || contents_str.contains("cufft")
            || contents_str.contains("curand")
            || contents_str.contains("cusparse")
            || contents_str.contains("cusolver")
            || contents_str.contains("cudnn");
    }
    false
}

#[cfg(target_os = "linux")]
fn binary_requires_cuda_linux(bin_path: &Path) -> bool {
    if let Ok(output) = std::process::Command::new("ldd").arg(bin_path).output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            return stdout.contains("libcudart")
                || stdout.contains("libcublas")
                || stdout.contains("libcufft")
                || stdout.contains("libcurand")
                || stdout.contains("libcusparse")
                || stdout.contains("libcusolver")
                || stdout.contains("libcudnn");
        }
    }

    // Fallback: string search if ldd fails
    if let Ok(contents) = std::fs::read(bin_path) {
        let contents_str = String::from_utf8_lossy(&contents);
        return contents_str.contains("libcudart")
            || contents_str.contains("libcublas")
            || contents_str.contains("libcufft");
    }

    false
}

pub fn find_cuda_paths() -> CudaPaths {
    #[cfg(target_os = "windows")]
    return find_cuda_paths_windows();

    #[cfg(target_os = "linux")]
    return find_cuda_paths_linux();

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        #[cfg(feature = "logging")]
        log::debug!("CUDA path detection not implemented for this OS");
        CudaPaths::default()
    }
}

/// Locates ROCm/HIP runtime directories. Mirrors `find_cuda_paths`: ROCm ships
/// in versioned roots (e.g. `/opt/rocm-7.2.0/lib`) that aren't on the default
/// loader path, so they must be discovered and added explicitly.
pub fn find_rocm_paths() -> CudaPaths {
    #[cfg(target_os = "linux")]
    return find_rocm_paths_linux();

    #[cfg(target_os = "windows")]
    return find_rocm_paths_windows();

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    CudaPaths::default()
}

#[cfg(target_os = "linux")]
fn add_rocm_root(
    root: &std::path::Path,
    lib_paths: &mut std::collections::HashSet<String>,
    bin_paths: &mut std::collections::HashSet<String>,
) {
    for sub in ["lib", "lib64"] {
        let p = root.join(sub);
        if p.exists() {
            lib_paths.insert(p.to_string_lossy().to_string());
        }
    }
    let bin = root.join("bin");
    if bin.exists() {
        bin_paths.insert(bin.to_string_lossy().to_string());
    }
}

#[cfg(target_os = "linux")]
fn find_rocm_paths_linux() -> CudaPaths {
    use std::collections::HashSet;
    use std::path::Path;

    let mut lib_paths: HashSet<String> = HashSet::new();
    let mut bin_paths: HashSet<String> = HashSet::new();

    for var in ["ROCM_PATH", "ROCM_HOME", "HIP_PATH"] {
        if let Ok(root) = std::env::var(var) {
            add_rocm_root(Path::new(&root), &mut lib_paths, &mut bin_paths);
        }
    }

    // Canonical unversioned symlink.
    add_rocm_root(Path::new("/opt/rocm"), &mut lib_paths, &mut bin_paths);

    // Versioned installs: /opt/rocm-7.2.0, /opt/rocm-6.4.1, ...
    if let Ok(entries) = std::fs::read_dir("/opt") {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.starts_with("rocm-") {
                    add_rocm_root(&entry.path(), &mut lib_paths, &mut bin_paths);
                }
            }
        }
    }

    let mut libs: Vec<_> = lib_paths.into_iter().collect();
    libs.sort();
    let mut bins: Vec<_> = bin_paths.into_iter().collect();
    bins.sort();

    #[cfg(feature = "logging")]
    if libs.is_empty() && bins.is_empty() {
        log::debug!("ROCm not found on Linux system");
    } else if !libs.is_empty() {
        log::info!("Found ROCm lib paths: {}", libs.join(", "));
    }

    CudaPaths {
        lib_paths: libs,
        bin_paths: bins,
    }
}

#[cfg(target_os = "windows")]
fn find_rocm_paths_windows() -> CudaPaths {
    use std::collections::HashSet;
    use std::path::Path;

    let mut bin_paths = HashSet::new();

    if let Ok(hip_path) = std::env::var("HIP_PATH").or_else(|_| std::env::var("ROCM_PATH")) {
        let bin = format!(r"{}\bin", hip_path);
        if Path::new(&bin).exists() {
            bin_paths.insert(bin);
        }
    }

    let program_files =
        std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".to_string());
    let rocm_base = format!(r"{}\AMD\ROCm", program_files);
    if let Ok(entries) = std::fs::read_dir(&rocm_base) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let bin = entry.path().join("bin");
                if bin.exists() {
                    bin_paths.insert(bin.to_string_lossy().to_string());
                }
            }
        }
    }

    let mut bins: Vec<_> = bin_paths.into_iter().collect();
    bins.sort();
    CudaPaths {
        lib_paths: Vec::new(),
        bin_paths: bins,
    }
}

/// True when the binary links the HIP/ROCm runtime (libamdhip64 / rocblas /
/// hipblas). Used to warn when a HIP backend is run without ROCm present.
pub fn binary_requires_rocm(_bin_path: &Path) -> bool {
    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = std::process::Command::new("ldd").arg(_bin_path).output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                return stdout.contains("libamdhip64")
                    || stdout.contains("librocblas")
                    || stdout.contains("libhipblas");
            }
        }
        false
    }
    #[cfg(not(target_os = "linux"))]
    false
}

/// Backward-compat wrapper. Prefer `find_cuda_paths()` + `setup_library_path()`.
pub fn add_cuda_paths(command: &mut tokio::process::Command) -> bool {
    let cuda = find_cuda_paths();
    let found = !cuda.lib_paths.is_empty() || !cuda.bin_paths.is_empty();
    setup_library_path(None, &cuda, command);
    found
}

#[cfg(target_os = "windows")]
fn find_cuda_paths_windows() -> CudaPaths {
    use std::collections::HashSet;
    use std::path::Path;

    let mut cuda_bin_paths = HashSet::new();

    if let Ok(cuda_path) = std::env::var("CUDA_PATH") {
        let bin_path = format!(r"{}\bin", cuda_path);
        if Path::new(&bin_path).exists() {
            cuda_bin_paths.insert(bin_path);
        }
    }

    for (key, value) in std::env::vars() {
        if key.starts_with("CUDA_PATH_V") {
            let bin_path = format!(r"{}\bin", value);
            if Path::new(&bin_path).exists() {
                cuda_bin_paths.insert(bin_path);
            }
        }
    }

    let program_files =
        std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".to_string());
    let cuda_toolkit_base = format!(r"{}\NVIDIA GPU Computing Toolkit\CUDA", program_files);

    if let Ok(entries) = std::fs::read_dir(&cuda_toolkit_base) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let bin_path = entry.path().join("bin");
                if bin_path.exists() {
                    cuda_bin_paths.insert(bin_path.to_string_lossy().to_string());
                }
            }
        }
    }

    if cuda_bin_paths.is_empty() {
        #[cfg(feature = "logging")]
        log::debug!("CUDA not found on Windows system");
        return CudaPaths::default();
    }

    let mut bins: Vec<_> = cuda_bin_paths.into_iter().collect();
    bins.sort();

    #[cfg(feature = "logging")]
    log::info!("Found CUDA bin paths: {}", bins.join(", "));

    CudaPaths {
        lib_paths: Vec::new(),
        bin_paths: bins,
    }
}

#[cfg(target_os = "linux")]
fn find_cuda_paths_linux() -> CudaPaths {
    use std::collections::HashSet;
    use std::path::Path;

    let mut cuda_lib_paths = HashSet::new();
    let mut cuda_bin_paths = HashSet::new();

    if let Ok(cuda_path) = std::env::var("CUDA_HOME").or_else(|_| std::env::var("CUDA_PATH")) {
        let lib64_path = format!("{}/lib64", cuda_path);
        let lib_path = format!("{}/lib", cuda_path);
        let bin_path = format!("{}/bin", cuda_path);

        if Path::new(&lib64_path).exists() {
            cuda_lib_paths.insert(lib64_path);
        }
        if Path::new(&lib_path).exists() {
            cuda_lib_paths.insert(lib_path);
        }
        if Path::new(&bin_path).exists() {
            cuda_bin_paths.insert(bin_path);
        }
    }

    let common_paths = [
        "/usr/local/cuda/lib64",
        "/usr/local/cuda/lib",
        "/usr/lib/cuda/lib64",
        "/usr/lib/cuda/lib",
        "/opt/cuda/lib64",
        "/opt/cuda/lib",
        "/usr/lib/x86_64-linux-gnu",
        "/usr/lib/x86_64-linux-gnu/nvidia",
    ];

    for path in &common_paths {
        if Path::new(path).exists() {
            cuda_lib_paths.insert(path.to_string());
        }
    }

    if is_flatpak() {
        collect_flatpak_gl_paths(&mut cuda_lib_paths);
    }

    if let Ok(entries) = std::fs::read_dir("/usr/local") {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.starts_with("cuda-") {
                    let base = entry.path();
                    for sub in ["lib64", "lib", "bin"] {
                        let sub_path = base.join(sub);
                        if sub_path.exists() {
                            let s = sub_path.to_string_lossy().to_string();
                            if sub == "bin" {
                                cuda_bin_paths.insert(s);
                            } else {
                                cuda_lib_paths.insert(s);
                            }
                        }
                    }
                }
            }
        }
    }

    let mut libs: Vec<_> = cuda_lib_paths.into_iter().collect();
    libs.sort();
    let mut bins: Vec<_> = cuda_bin_paths.into_iter().collect();
    bins.sort();

    if libs.is_empty() && bins.is_empty() {
        #[cfg(feature = "logging")]
        log::debug!("CUDA not found on Linux system");
    } else {
        #[cfg(feature = "logging")]
        {
            if !libs.is_empty() {
                log::info!("Found CUDA lib paths: {}", libs.join(", "));
            }
            if !bins.is_empty() {
                log::info!("Found CUDA bin paths: {}", bins.join(", "));
            }
        }
    }

    CudaPaths {
        lib_paths: libs,
        bin_paths: bins,
    }
}

#[cfg(target_os = "linux")]
fn collect_flatpak_gl_paths(cuda_lib_paths: &mut std::collections::HashSet<String>) {
    let flatpak_gl_paths = [
        "/usr/lib/extensions/vulkan/nvidia/lib",
        "/usr/lib/extensions/cuda/lib",
        "/usr/lib/GL/lib",
        "/usr/lib/GL",
        "/app/lib/GL",
    ];

    for path in &flatpak_gl_paths {
        if Path::new(path).exists() {
            cuda_lib_paths.insert(path.to_string());
        }
    }

    for base_dir in ["/usr/lib/extensions", "/usr/lib/GL/lib"] {
        if let Ok(entries) = std::fs::read_dir(base_dir) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                if !entry_path.is_dir() {
                    continue;
                }

                let lib_sub = entry_path.join("lib");
                if lib_sub.exists() {
                    cuda_lib_paths.insert(lib_sub.to_string_lossy().to_string());
                } else {
                    cuda_lib_paths.insert(entry_path.to_string_lossy().to_string());
                }
            }
        }
    }

    #[cfg(feature = "logging")]
    log::info!("Searched Flatpak GL extension paths for NVIDIA libraries");
}

pub fn setup_windows_process_flags(command: &mut tokio::process::Command) {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }
    #[cfg(not(windows))]
    {
        let _ = command; // Silence unused parameter warning on non-Windows platforms
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Spawns a child to read env vars since Command doesn't expose a getter.
    async fn read_env_from_child(command: &mut tokio::process::Command, var: &str) -> String {
        use std::process::Stdio;
        #[cfg(target_os = "linux")]
        command.args(["-c", &format!("printenv {} || true", var)]);
        #[cfg(target_os = "windows")]
        command.args(["/C", &format!("echo %{}%", var)]);

        let output = command
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .await
            .expect("failed to spawn helper process");
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn new_shell_command() -> tokio::process::Command {
        #[cfg(target_os = "linux")]
        return tokio::process::Command::new("sh");
        #[cfg(target_os = "windows")]
        return tokio::process::Command::new("cmd");
        #[cfg(not(any(target_os = "linux", target_os = "windows")))]
        return tokio::process::Command::new("sh");
    }

    #[test]
    fn system32_path_uses_root() {
        assert_eq!(
            system32_path(Some(OsString::from(r"D:\Win")), "tasklist.exe"),
            PathBuf::from(r"D:\Win\System32\tasklist.exe")
        );
        assert_eq!(
            system32_path(Some(OsString::from(r"D:\Win\")), "cmd.exe"),
            PathBuf::from(r"D:\Win\System32\cmd.exe")
        );
        assert_eq!(
            system32_path(Some(OsString::from(r"D:\Win")), r"wbem\wmic.exe"),
            PathBuf::from(r"D:\Win\System32\wbem\wmic.exe")
        );
    }

    #[test]
    fn system32_path_falls_back_when_root_missing() {
        let expected = PathBuf::from(r"C:\Windows\System32\reg.exe");
        assert_eq!(system32_path(None, "reg.exe"), expected);
        assert_eq!(system32_path(Some(OsString::new()), "reg.exe"), expected);
    }

    fn pick(dirs: &[&str], excluded: &[&str], present: &[&str]) -> Option<PathBuf> {
        let dirs: Vec<PathBuf> = dirs.iter().map(PathBuf::from).collect();
        let excluded: Vec<PathBuf> = excluded.iter().map(PathBuf::from).collect();
        let present: Vec<PathBuf> = present
            .iter()
            .map(|d| PathBuf::from(d).join("git.exe"))
            .collect();
        pick_git_exe(
            &dirs,
            &excluded,
            |p| Some(p.to_path_buf()),
            |p| present.iter().any(|q| q == p),
        )
    }

    #[test]
    fn git_exe_is_the_first_on_path() {
        assert_eq!(
            pick(
                &[r"C:\Tools", r"C:\Program Files\Git\cmd", r"D:\Other"],
                &[],
                &[r"C:\Program Files\Git\cmd", r"D:\Other"],
            ),
            Some(PathBuf::from(r"C:\Program Files\Git\cmd").join("git.exe"))
        );
        assert_eq!(pick(&[r"C:\Tools"], &[], &[]), None);
    }

    #[test]
    fn git_exe_skips_the_app_and_current_directories() {
        let app = r"C:\Users\u\AppData\Local\Jan";
        let cwd = r"C:\Users\u\project";
        let git = r"C:\Program Files\Git\cmd";
        // Matched regardless of case, slash direction and trailing separator.
        let path = [
            r"c:\users\U\appdata\local\jan\",
            "C:/Users/u/project",
            git,
        ];
        assert_eq!(
            pick(&path, &[app, cwd], &[path[0], path[1], git]),
            Some(PathBuf::from(git).join("git.exe"))
        );
        assert_eq!(pick(&path[..2], &[app, cwd], &path[..2]), None);
    }

    #[test]
    fn git_exe_ignores_relative_path_entries() {
        assert_eq!(pick(&[".", r"bin", r"\bin"], &[], &[".", "bin", r"\bin"]), None);
        assert_eq!(
            pick(&[r"\\server\share\git"], &[], &[r"\\server\share\git"]),
            Some(PathBuf::from(r"\\server\share\git").join("git.exe"))
        );
    }

    #[test]
    fn cuda_paths_default_is_empty() {
        let cp = CudaPaths::default();
        assert!(cp.lib_paths.is_empty());
        assert!(cp.bin_paths.is_empty());
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn setup_library_path_merges_binary_dir_and_cuda_libs() {
        let cuda = CudaPaths {
            lib_paths: vec!["/fake/cuda/lib64".into()],
            bin_paths: vec!["/fake/cuda/bin".into()],
        };
        let bin_dir = Path::new("/fake/bin_dir");

        let mut cmd = new_shell_command();
        setup_library_path(Some(bin_dir), &cuda, &mut cmd);

        let ld = read_env_from_child(&mut cmd, "LD_LIBRARY_PATH").await;
        assert!(
            ld.contains("/fake/bin_dir"),
            "LD_LIBRARY_PATH should contain binary dir, got: {}",
            ld
        );
        assert!(
            ld.contains("/fake/cuda/lib64"),
            "LD_LIBRARY_PATH should contain CUDA lib dir, got: {}",
            ld
        );

        let mut cmd2 = new_shell_command();
        setup_library_path(Some(bin_dir), &cuda, &mut cmd2);
        let path = read_env_from_child(&mut cmd2, "PATH").await;
        assert!(
            path.contains("/fake/cuda/bin"),
            "PATH should contain CUDA bin dir, got: {}",
            path
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn setup_library_path_no_cuda_still_sets_binary_dir() {
        let cuda = CudaPaths::default();
        let bin_dir = Path::new("/fake/bin_dir");

        let mut cmd = new_shell_command();
        setup_library_path(Some(bin_dir), &cuda, &mut cmd);

        let ld = read_env_from_child(&mut cmd, "LD_LIBRARY_PATH").await;
        assert!(
            ld.contains("/fake/bin_dir"),
            "LD_LIBRARY_PATH should contain binary dir even without CUDA, got: {}",
            ld
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn setup_library_path_no_binary_dir_still_sets_cuda() {
        let cuda = CudaPaths {
            lib_paths: vec!["/fake/cuda/lib64".into()],
            bin_paths: vec![],
        };

        let mut cmd = new_shell_command();
        setup_library_path(None, &cuda, &mut cmd);

        let ld = read_env_from_child(&mut cmd, "LD_LIBRARY_PATH").await;
        assert!(
            ld.contains("/fake/cuda/lib64"),
            "LD_LIBRARY_PATH should contain CUDA lib dir, got: {}",
            ld
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn setup_library_path_empty_inputs_does_not_set_env() {
        let cuda = CudaPaths::default();
        let mut cmd = new_shell_command();

        cmd.env_remove("LD_LIBRARY_PATH");
        setup_library_path(None, &cuda, &mut cmd);

        let ld = read_env_from_child(&mut cmd, "LD_LIBRARY_PATH").await;
        assert!(
            ld.is_empty(),
            "LD_LIBRARY_PATH should not be set when both inputs are empty, got: {}",
            ld
        );
    }

    #[test]
    fn binary_requires_cuda_returns_false_for_nonexistent_file() {
        assert!(!binary_requires_cuda(Path::new("/nonexistent/binary")));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn binary_requires_cuda_returns_false_for_non_cuda_binary() {
        assert!(!binary_requires_cuda(Path::new("/bin/sh")));
    }

    #[test]
    fn find_cuda_paths_returns_valid_struct() {
        let cp = find_cuda_paths();
        for p in &cp.lib_paths {
            assert!(
                Path::new(p).exists(),
                "Returned lib path should exist: {}",
                p
            );
        }
        for p in &cp.bin_paths {
            assert!(
                Path::new(p).exists(),
                "Returned bin path should exist: {}",
                p
            );
        }
    }

    #[test]
    fn find_rocm_paths_returns_existing_dirs() {
        let rp = find_rocm_paths();
        for p in rp.lib_paths.iter().chain(rp.bin_paths.iter()) {
            assert!(Path::new(p).exists(), "Returned ROCm path should exist: {}", p);
        }
    }

    #[test]
    fn binary_requires_rocm_returns_false_for_nonexistent_file() {
        assert!(!binary_requires_rocm(Path::new("/nonexistent/binary")));
    }

    #[test]
    fn merged_dedups_and_unions_paths() {
        let a = CudaPaths {
            lib_paths: vec!["/x".into(), "/y".into()],
            bin_paths: vec!["/b".into()],
        };
        let b = CudaPaths {
            lib_paths: vec!["/y".into(), "/z".into()],
            bin_paths: vec!["/b".into(), "/c".into()],
        };
        let m = a.merged(b);
        assert_eq!(m.lib_paths, vec!["/x", "/y", "/z"]);
        assert_eq!(m.bin_paths, vec!["/b", "/c"]);
    }

    #[tokio::test]
    async fn add_cuda_paths_compat_wrapper_does_not_panic() {
        let mut cmd = new_shell_command();
        let _found = add_cuda_paths(&mut cmd);
    }

    #[test]
    fn is_flatpak_returns_bool() {
        let result = is_flatpak();
        if Path::new("/.flatpak-info").exists() {
            assert!(result);
        } else {
            assert!(!result);
        }
    }
}
