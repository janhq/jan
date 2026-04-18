use futures_util::StreamExt;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{Emitter, Runtime};
use tokio::io::AsyncWriteExt;

/// URL for the Ollama Windows installer
const OLLAMA_SETUP_URL: &str = "https://ollama.com/download/OllamaSetup.exe";

/// Progress event name emitted to the frontend
const INSTALL_PROGRESS_EVENT: &str = "ollama-install-progress";

fn err_to_string<E: std::fmt::Display>(e: E) -> String {
    format!("Error: {e}")
}

/// Common Windows installation paths for Ollama, ordered by likelihood.
fn ollama_install_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    // 1. User-level install (most common on modern Windows)
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        candidates.push(PathBuf::from(local_app_data).join("Programs").join("Ollama").join("ollama.exe"));
    }

    // 2. System-level install (64-bit)
    if let Ok(program_files) = std::env::var("PROGRAMFILES") {
        candidates.push(PathBuf::from(program_files).join("Ollama").join("ollama.exe"));
    }

    // 3. System-level install (32-bit)
    if let Ok(program_files_x86) = std::env::var("PROGRAMFILES(x86)") {
        candidates.push(PathBuf::from(program_files_x86).join("Ollama").join("ollama.exe"));
    }

    // 4. Fallback: user's home directory (rare but possible)
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        candidates.push(PathBuf::from(user_profile).join("AppData").join("Local").join("Programs").join("Ollama").join("ollama.exe"));
    }

    candidates
}

/// Checks the Windows Registry (Uninstall keys) for Ollama install location.
#[cfg(target_os = "windows")]
fn find_ollama_via_registry() -> Option<PathBuf> {
    use std::process::Command;

    let registry_keys = [
        r"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\Ollama",
        r"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Ollama",
        r"HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Ollama",
    ];

    for key in &registry_keys {
        let output = Command::new("reg")
            .args(["query", key, "/v", "InstallLocation"])
            .output()
            .ok()?;

        if !output.status.success() {
            continue;
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        // Parse line like:    InstallLocation    REG_SZ    C:\Users\...\Programs\Ollama
        // Note: install path may contain spaces (e.g. "C:\Program Files\Ollama"),
        // so we must NOT use split_whitespace(). Instead we extract everything after REG_SZ.
        for line in stdout.lines() {
            if let Some(reg_sz_pos) = line.find("REG_SZ") {
                let install_dir = line[reg_sz_pos + 6..].trim();
                if install_dir.is_empty() {
                    continue;
                }
                let exe_path = PathBuf::from(install_dir).join("ollama.exe");
                if exe_path.exists() {
                    return Some(exe_path);
                }
            }
        }
    }

    None
}

#[cfg(not(target_os = "windows"))]
fn find_ollama_via_registry() -> Option<PathBuf> {
    None
}

/// Returns the full path to ollama.exe if it exists on this system.
#[tauri::command]
pub fn check_ollama_installed() -> Option<String> {
    // First, check common file paths
    for candidate in ollama_install_candidates() {
        if candidate.exists() {
            log::info!("Found Ollama installed at: {}", candidate.display());
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    // Fall back to registry scan
    if let Some(path) = find_ollama_via_registry() {
        log::info!("Found Ollama via registry at: {}", path.display());
        return Some(path.to_string_lossy().to_string());
    }

    log::info!("Ollama installation not found on this system");
    None
}

/** Response from Ollama /api/version */
#[derive(serde::Serialize)]
pub struct OllamaRunningStatus {
    pub is_running: bool,
    pub version: Option<String>,
    pub models: Vec<serde_json::Value>,
}

/// Checks whether Ollama is running by querying its localhost API.
/// Uses a reqwest client with `no_proxy()` to avoid hanging on Windows
/// when a stale proxy configuration (e.g. 127.0.0.1:7890) is present.
#[tauri::command]
pub async fn check_ollama_running() -> Result<OllamaRunningStatus, String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(err_to_string)?;

    let version_res = match client
        .get("http://127.0.0.1:11434/api/version")
        .send()
        .await
    {
        Ok(res) => res,
        Err(e) => {
            log::debug!("Ollama health check failed: {}", e);
            return Ok(OllamaRunningStatus {
                is_running: false,
                version: None,
                models: vec![],
            });
        }
    };

    if !version_res.status().is_success() {
        return Ok(OllamaRunningStatus {
            is_running: false,
            version: None,
            models: vec![],
        });
    }

    let version = version_res
        .json::<serde_json::Value>()
        .await
        .ok()
        .and_then(|v| v.get("version").and_then(|v| v.as_str()).map(|s| s.to_string()));

    let models = match client
        .get("http://127.0.0.1:11434/api/tags")
        .send()
        .await
    {
        Ok(res) if res.status().is_success() => res
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| v.get("models").cloned())
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default(),
        _ => vec![],
    };

    Ok(OllamaRunningStatus {
        is_running: true,
        version,
        models,
    })
}

/// Starts the Ollama application from the given path.
/// This spawns ollama.exe without waiting for it to complete (daemon mode).
#[tauri::command]
pub async fn start_ollama(ollama_path: String) -> Result<(), String> {
    let path = PathBuf::from(&ollama_path);
    if !path.exists() {
        return Err(format!("Ollama executable not found at: {}", ollama_path));
    }

    log::info!("Starting Ollama from: {}", path.display());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // Spawn ollama.exe without a console window.
        // .spawn() returns immediately; the process runs independently.
        let result = std::process::Command::new(&path)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Failed to start Ollama: {e}"))?;

        log::info!("Ollama started with PID: {}", result.id());
    }

    #[cfg(not(target_os = "windows"))]
    {
        return Err("start_ollama is only supported on Windows".to_string());
    }

    Ok(())
}

/// Downloads the Ollama installer to the system temp directory and runs it silently.
/// If the installer already exists locally, skips the download and proceeds directly to installation.
#[tauri::command]
pub async fn install_ollama<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    // Determine temp directory
    let temp_dir = std::env::temp_dir();
    let installer_path = temp_dir.join("OllamaSetup.exe");

    // Check if the installer already exists locally
    let existing_size = match tokio::fs::metadata(&installer_path).await {
        Ok(metadata) => metadata.len(),
        Err(_) => 0,
    };

    let needs_download = existing_size == 0;

    if needs_download {
        log::info!(
            "Ollama installer not found locally, downloading to {}",
            installer_path.display()
        );

        // Emit initial progress (0%)
        app.emit(
            INSTALL_PROGRESS_EVENT,
            serde_json::json!({
                "status": "downloading",
                "progress": 0.0,
                "message": "正在下载 Ollama 安装程序..."
            }),
        )
        .ok();

        // Create HTTP client
        let client = reqwest::Client::builder()
            .no_proxy()
            .connect_timeout(Duration::from_secs(30))
            .timeout(Duration::from_secs(600))
            .build()
            .map_err(err_to_string)?;

        // Send GET request
        let resp = client
            .get(OLLAMA_SETUP_URL)
            .send()
            .await
            .map_err(err_to_string)?;

        if !resp.status().is_success() {
            return Err(format!(
                "Failed to download Ollama installer: HTTP {}",
                resp.status()
            ));
        }

        // Try to get total size from Content-Length header
        let total_size = resp.content_length().unwrap_or(0);
        log::info!("Ollama installer total size: {} bytes", total_size);

        // Open file for writing
        let mut file = tokio::fs::File::create(&installer_path)
            .await
            .map_err(err_to_string)?;

        let mut stream = resp.bytes_stream();
        let mut downloaded: u64 = 0;
        let mut last_emitted_progress: u64 = 0;

        // Stream chunks to file
        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result.map_err(err_to_string)?;
            file.write_all(&chunk).await.map_err(err_to_string)?;
            downloaded += chunk.len() as u64;

            // Emit progress every 1 MB or when complete
            let emit_threshold = 1024 * 1024; // 1 MB
            if downloaded.saturating_sub(last_emitted_progress) >= emit_threshold
                || (total_size > 0 && downloaded >= total_size)
            {
                let progress = if total_size > 0 {
                    (downloaded as f64 / total_size as f64) * 100.0
                } else {
                    0.0
                };

                app.emit(
                    INSTALL_PROGRESS_EVENT,
                    serde_json::json!({
                        "status": "downloading",
                        "progress": progress,
                        "downloaded": downloaded,
                        "total": total_size,
                        "message": format!("正在下载 Ollama... {:.1}%", progress)
                    }),
                )
                .ok();

                last_emitted_progress = downloaded;
            }
        }

        // Flush and close file
        file.flush().await.map_err(err_to_string)?;
        drop(file);

        log::info!(
            "Ollama installer downloaded to {}, size: {} bytes",
            installer_path.display(),
            downloaded
        );
    } else {
        log::info!(
            "Found existing Ollama installer at {}, size: {} bytes. Skipping download.",
            installer_path.display(),
            existing_size
        );

        app.emit(
            INSTALL_PROGRESS_EVENT,
            serde_json::json!({
                "status": "downloading",
                "progress": 100.0,
                "message": "发现本地安装包，跳过下载..."
            }),
        )
        .ok();
    }

    // Emit installing status
    app.emit(
        INSTALL_PROGRESS_EVENT,
        serde_json::json!({
            "status": "installing",
            "progress": 100.0,
            "message": "正在安装 Ollama，请稍候..."
        }),
    )
    .ok();

    // Run installer silently
    // OllamaSetup.exe is an NSIS installer that supports /S for silent mode
    let install_result = run_ollama_installer(&installer_path).await;

    // Clean up installer file regardless of success/failure
    let _ = tokio::fs::remove_file(&installer_path).await;

    match install_result {
        Ok(_) => {
            log::info!("Ollama installed successfully");
            app.emit(
                INSTALL_PROGRESS_EVENT,
                serde_json::json!({
                    "status": "completed",
                    "progress": 100.0,
                    "message": "Ollama 安装成功！"
                }),
            )
            .ok();
            Ok(())
        }
        Err(e) => {
            log::error!("Ollama installation failed: {}", e);
            app.emit(
                INSTALL_PROGRESS_EVENT,
                serde_json::json!({
                    "status": "error",
                    "progress": 0.0,
                    "message": format!("安装失败: {}", e)
                }),
            )
            .ok();
            Err(e)
        }
    }
}

/// Executes the Ollama installer with silent flag.
#[cfg(target_os = "windows")]
async fn run_ollama_installer(installer_path: &PathBuf) -> Result<(), String> {
    log::info!(
        "Running Ollama installer silently: {}",
        installer_path.display()
    );

    let output = tokio::process::Command::new(installer_path)
        .arg("/S")
        .creation_flags(0x08000000) // CREATE_NO_WINDOW - prevents console window popup on Windows
        .output()
        .await
        .map_err(|e| format!("Failed to run installer: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Installer exited with code {:?}. stderr: {}",
            output.status.code(),
            stderr
        ));
    }

    log::info!("Ollama installer finished successfully");
    Ok(())
}

#[cfg(not(target_os = "windows"))]
async fn run_ollama_installer(_installer_path: &PathBuf) -> Result<(), String> {
    Err("Ollama installer is only supported on Windows".to_string())
}
