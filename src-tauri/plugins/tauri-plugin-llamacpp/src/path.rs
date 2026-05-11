use std::path::PathBuf;

use crate::error::{ErrorCode, LlamacppError, ServerResult};

pub fn validate_binary_path(backend_path: &str) -> ServerResult<PathBuf> {
    let server_path_buf = PathBuf::from(backend_path);
    if !server_path_buf.exists() {
        let err_msg = format!("Binary not found at {:?}", backend_path);
        log::error!(
            "Server binary not found at expected path: {:?}",
            backend_path
        );
        return Err(LlamacppError::new(
            ErrorCode::BinaryNotFound,
            "The llama.cpp server binary could not be found.".into(),
            Some(err_msg),
        )
        .into());
    }
    Ok(server_path_buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    #[test]
    fn test_validate_binary_path_existing() {
        let temp_file = NamedTempFile::new().unwrap();
        let path = temp_file.path().to_str().unwrap();
        let result = validate_binary_path(path);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), PathBuf::from(path));
    }

    #[test]
    fn test_validate_binary_path_nonexistent() {
        let nonexistent_path = "/tmp/definitely_does_not_exist_123456789";
        let result = validate_binary_path(nonexistent_path);
        assert!(result.is_err());
    }
}
