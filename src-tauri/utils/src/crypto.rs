use base64::{engine::general_purpose, Engine as _};
use hmac::{Hmac, Mac};
use rand::{distributions::Alphanumeric, Rng};
use sha2::{Digest, Sha256};
use std::path::Path;
use tokio::fs::File;
use tokio::io::AsyncReadExt;
use tokio_util::sync::CancellationToken;

type HmacSha256 = Hmac<Sha256>;

/// Generates random app token
pub fn generate_app_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

/// Generate API key using HMAC-SHA256
pub fn generate_api_key(model_id: String, api_secret: String) -> Result<String, String> {
    let mut mac = HmacSha256::new_from_slice(api_secret.as_bytes())
        .map_err(|e| format!("Invalid key length: {}", e))?;
    mac.update(model_id.as_bytes());
    let result = mac.finalize();
    let code_bytes = result.into_bytes();
    let hash = general_purpose::STANDARD.encode(code_bytes);
    Ok(hash)
}

/// Compute SHA256 hash of a file with cancellation support by chunking the file
pub async fn compute_file_sha256_with_cancellation(
    file_path: &Path,
    cancel_token: &CancellationToken,
) -> Result<String, String> {
    // Check for cancellation before starting
    if cancel_token.is_cancelled() {
        return Err("Hash computation cancelled".to_string());
    }

    let mut file = File::open(file_path)
        .await
        .map_err(|e| format!("Failed to open file for hashing: {}", e))?;

    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024]; // 64KB chunks
    let mut total_read = 0u64;

    loop {
        // Check for cancellation every chunk (every 64KB)
        if cancel_token.is_cancelled() {
            return Err("Hash computation cancelled".to_string());
        }

        let bytes_read = file
            .read(&mut buffer)
            .await
            .map_err(|e| format!("Failed to read file for hashing: {}", e))?;

        if bytes_read == 0 {
            break; // EOF
        }

        hasher.update(&buffer[..bytes_read]);
        total_read += bytes_read as u64;

        // Log progress for very large files (every 100MB)
        if total_read % (100 * 1024 * 1024) == 0 {
            #[cfg(feature = "logging")]
            log::debug!("Hash progress: {} MB processed", total_read / (1024 * 1024));
        }
    }

    // Final cancellation check
    if cancel_token.is_cancelled() {
        return Err("Hash computation cancelled".to_string());
    }

    let hash_bytes = hasher.finalize();
    let hash_hex = format!("{:x}", hash_bytes);

    #[cfg(feature = "logging")]
    log::debug!("Hash computation completed for {} bytes", total_read);
    Ok(hash_hex)
}
