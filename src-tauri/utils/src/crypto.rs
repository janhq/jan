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

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_util::sync::CancellationToken;

    #[test]
    fn test_generate_app_token() {
        let token1 = generate_app_token();
        let token2 = generate_app_token();
        
        // Should be 32 characters long
        assert_eq!(token1.len(), 32);
        assert_eq!(token2.len(), 32);
        
        // Should be different each time
        assert_ne!(token1, token2);
        
        // Should only contain alphanumeric characters
        assert!(token1.chars().all(|c| c.is_alphanumeric()));
        assert!(token2.chars().all(|c| c.is_alphanumeric()));
    }

    #[test]
    fn test_generate_api_key() {
        let model_id = "test-model".to_string();
        let api_secret = "test-secret".to_string();
        
        let key1 = generate_api_key(model_id.clone(), api_secret.clone()).unwrap();
        let key2 = generate_api_key(model_id.clone(), api_secret.clone()).unwrap();
        
        // Should generate same key for same inputs
        assert_eq!(key1, key2);
        
        // Should be base64 encoded (and thus contain base64 characters)
        assert!(key1.chars().all(|c| c.is_alphanumeric() || c == '+' || c == '/' || c == '='));
        
        // Different model_id should produce different key
        let different_key = generate_api_key("different-model".to_string(), api_secret).unwrap();
        assert_ne!(key1, different_key);
    }

    #[test]
    fn test_generate_api_key_empty_inputs() {
        let result = generate_api_key("".to_string(), "secret".to_string());
        assert!(result.is_ok()); // Should still work with empty model_id
        
        let result = generate_api_key("model".to_string(), "".to_string());
        assert!(result.is_ok()); // Should still work with empty secret
    }

    #[tokio::test]
    async fn test_compute_file_sha256_with_cancellation() {
        use std::io::Write;
        use tempfile::NamedTempFile;
        
        // Create a temporary file with known content
        let mut temp_file = NamedTempFile::new().unwrap();
        let test_content = b"Hello, World!";
        temp_file.write_all(test_content).unwrap();
        temp_file.flush().unwrap();
        
        let token = CancellationToken::new();
        
        // Compute hash of the file
        let hash = compute_file_sha256_with_cancellation(temp_file.path(), &token).await.unwrap();
        
        // Verify it's a valid hex string
        assert_eq!(hash.len(), 64); // SHA256 is 256 bits = 64 hex chars
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
        
        // Verify it matches expected SHA256 of "Hello, World!"
        let expected = "dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f";
        assert_eq!(hash, expected);
    }

    #[tokio::test] 
    async fn test_compute_file_sha256_cancellation() {
        use std::io::Write;
        use tempfile::NamedTempFile;
        
        // Create a temporary file
        let mut temp_file = NamedTempFile::new().unwrap();
        temp_file.write_all(b"test content").unwrap();
        temp_file.flush().unwrap();
        
        let token = CancellationToken::new();
        token.cancel(); // Cancel immediately
        
        // Should return cancellation error
        let result = compute_file_sha256_with_cancellation(temp_file.path(), &token).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("cancelled"));
    }

    #[tokio::test]
    async fn test_compute_file_sha256_nonexistent_file() {
        let token = CancellationToken::new();
        let nonexistent_path = Path::new("/nonexistent/file.txt");
        
        let result = compute_file_sha256_with_cancellation(nonexistent_path, &token).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to open file for hashing"));
    }
}