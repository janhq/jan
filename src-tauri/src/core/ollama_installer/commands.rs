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
