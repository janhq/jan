<<<<<<< HEAD
use std::path::PathBuf;

use crate::error::{ErrorCode, LlamacppError, ServerResult};

#[cfg(windows)]
use jan_utils::path::get_short_path;

/// Validate that a binary path exists and is accessible
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

/// Validate model path exists and update args with platform-appropriate path format
pub fn validate_model_path(args: &mut Vec<String>) -> ServerResult<PathBuf> {
    let model_path_index = args.iter().position(|arg| arg == "-m").ok_or_else(|| {
        LlamacppError::new(
            ErrorCode::ModelLoadFailed,
            "Model path argument '-m' is missing.".into(),
            None,
        )
    })?;

    let model_path = args.get(model_path_index + 1).cloned().ok_or_else(|| {
        LlamacppError::new(
            ErrorCode::ModelLoadFailed,
            "Model path was not provided after '-m' flag.".into(),
            None,
        )
    })?;

    let model_path_pb = PathBuf::from(&model_path);
    if !model_path_pb.exists() {
        let err_msg = format!(
            "Invalid or inaccessible model path: {}",
            model_path_pb.display()
        );
        log::error!("{}", &err_msg);
        return Err(LlamacppError::new(
            ErrorCode::ModelFileNotFound,
            "The specified model file does not exist or is not accessible.".into(),
            Some(err_msg),
        )
        .into());
    }

    // Update the path in args with appropriate format for the platform
    #[cfg(windows)]
    {
        // use short path on Windows
        if let Some(short) = get_short_path(&model_path_pb) {
            args[model_path_index + 1] = short;
        } else {
            args[model_path_index + 1] = model_path_pb.display().to_string();
        }
    }
    #[cfg(not(windows))]
    {
        args[model_path_index + 1] = model_path_pb.display().to_string();
    }

    Ok(model_path_pb)
}

/// Validate mmproj path exists and update args with platform-appropriate path format
pub fn validate_mmproj_path(args: &mut Vec<String>) -> ServerResult<Option<PathBuf>> {
   let mmproj_path_index = match args.iter().position(|arg| arg == "--mmproj") {
       Some(index) => index,
       None => return Ok(None), // mmproj is optional
   };

   let mmproj_path = args.get(mmproj_path_index + 1).cloned().ok_or_else(|| {
       LlamacppError::new(
           ErrorCode::ModelLoadFailed,
           "Mmproj path was not provided after '--mmproj' flag.".into(),
           None,
       )
   })?;

   let mmproj_path_pb = PathBuf::from(&mmproj_path);
   if !mmproj_path_pb.exists() {
       let err_msg = format!(
           "Invalid or inaccessible mmproj path: {}",
           mmproj_path_pb.display()
       );
       log::error!("{}", &err_msg);
       return Err(LlamacppError::new(
           ErrorCode::ModelFileNotFound,
           "The specified mmproj file does not exist or is not accessible.".into(),
           Some(err_msg),
       )
       .into());
   }

   #[cfg(windows)]
   {
       // use short path on Windows
       if let Some(short) = get_short_path(&mmproj_path_pb) {
           args[mmproj_path_index + 1] = short;
       } else {
           args[mmproj_path_index + 1] = mmproj_path_pb.display().to_string();
       }
   }
   #[cfg(not(windows))]
   {
       args[mmproj_path_index + 1] = mmproj_path_pb.display().to_string();
   }

   Ok(Some(mmproj_path_pb))
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

    #[test]
    fn test_validate_model_path_valid() {
        let temp_file = NamedTempFile::new().unwrap();
        let path = temp_file.path().to_str().unwrap();
        
        let mut args = vec!["-m".to_string(), path.to_string(), "--verbose".to_string()];
        let result = validate_model_path(&mut args);
        
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), PathBuf::from(path));
        // Args should be updated with the path
        #[cfg(windows)]
        {
            // On Windows, the path might be converted to short path format
            // Just verify that the path in args[1] points to the same file
            assert!(PathBuf::from(&args[1]).exists());
        }
        #[cfg(not(windows))]
        {
            assert_eq!(args[1], temp_file.path().display().to_string());
        }
    }

    #[test]
    fn test_validate_model_path_missing_flag() {
        let mut args = vec!["--verbose".to_string(), "value".to_string()];
        let result = validate_model_path(&mut args);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_model_path_missing_value() {
        let mut args = vec!["-m".to_string()];
        let result = validate_model_path(&mut args);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_model_path_nonexistent_file() {
        let nonexistent_path = "/tmp/nonexistent_model_123456789.gguf";
        let mut args = vec!["-m".to_string(), nonexistent_path.to_string()];
        let result = validate_model_path(&mut args);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_mmproj_path_valid() {
        let temp_file = NamedTempFile::new().unwrap();
        let path = temp_file.path().to_str().unwrap();
        
        let mut args = vec!["--mmproj".to_string(), path.to_string(), "--verbose".to_string()];
        let result = validate_mmproj_path(&mut args);
        
        assert!(result.is_ok());
        assert!(result.unwrap().is_some());
        // Args should be updated with the path
        #[cfg(windows)]
        {
            // On Windows, the path might be converted to short path format
            // Just verify that the path in args[1] points to the same file
            assert!(PathBuf::from(&args[1]).exists());
        }
        #[cfg(not(windows))]
        {
            assert_eq!(args[1], temp_file.path().display().to_string());
        }
    }

    #[test]
    fn test_validate_mmproj_path_missing() {
        let mut args = vec!["--verbose".to_string(), "value".to_string()];
        let result = validate_mmproj_path(&mut args);
        assert!(result.is_ok());
        assert!(result.unwrap().is_none()); // mmproj is optional
    }

    #[test]
    fn test_validate_mmproj_path_missing_value() {
        let mut args = vec!["--mmproj".to_string()];
        let result = validate_mmproj_path(&mut args);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_mmproj_path_nonexistent_file() {
        let nonexistent_path = "/tmp/nonexistent_mmproj_123456789.gguf";
        let mut args = vec!["--mmproj".to_string(), nonexistent_path.to_string()];
        let result = validate_mmproj_path(&mut args);
        assert!(result.is_err());
    }


    #[test]
    fn test_validate_model_path_multiple_m_flags() {
        let temp_file = NamedTempFile::new().unwrap();
        let path = temp_file.path().to_str().unwrap();
        
        // Multiple -m flags - should use the first one
        let mut args = vec![
            "-m".to_string(), 
            path.to_string(),
            "--verbose".to_string(),
            "-m".to_string(),
            "another_path".to_string()
        ];
        let result = validate_model_path(&mut args);
        
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), PathBuf::from(path));
    }

    #[test]
    fn test_validate_mmproj_path_multiple_flags() {
        let temp_file = NamedTempFile::new().unwrap();
        let path = temp_file.path().to_str().unwrap();
        
        // Multiple --mmproj flags - should use the first one
        let mut args = vec![
            "--mmproj".to_string(), 
            path.to_string(),
            "--verbose".to_string(),
            "--mmproj".to_string(),
            "another_path".to_string()
        ];
        let result = validate_mmproj_path(&mut args);
        
        assert!(result.is_ok());
        let result_path = result.unwrap();
        assert!(result_path.is_some());
        assert_eq!(result_path.unwrap(), PathBuf::from(path));
    }
}
=======
use std::path::PathBuf;

use crate::error::{ErrorCode, LlamacppError, ServerResult};

#[cfg(windows)]
use jan_utils::path::get_short_path;

/// Validate that a binary path exists and is accessible
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

/// Validate model path exists and update args with platform-appropriate path format
pub fn validate_model_path(args: &mut Vec<String>) -> ServerResult<PathBuf> {
    let model_path_index = args.iter().position(|arg| arg == "-m").ok_or_else(|| {
        LlamacppError::new(
            ErrorCode::ModelLoadFailed,
            "Model path argument '-m' is missing.".into(),
            None,
        )
    })?;

    let model_path = args.get(model_path_index + 1).cloned().ok_or_else(|| {
        LlamacppError::new(
            ErrorCode::ModelLoadFailed,
            "Model path was not provided after '-m' flag.".into(),
            None,
        )
    })?;

    let model_path_pb = PathBuf::from(&model_path);
    if !model_path_pb.exists() {
        let err_msg = format!(
            "Invalid or inaccessible model path: {}",
            model_path_pb.display()
        );
        log::error!("{}", &err_msg);
        return Err(LlamacppError::new(
            ErrorCode::ModelFileNotFound,
            "The specified model file does not exist or is not accessible.".into(),
            Some(err_msg),
        )
        .into());
    }

    // Update the path in args with appropriate format for the platform
    #[cfg(windows)]
    {
        // use short path on Windows
        if let Some(short) = get_short_path(&model_path_pb) {
            args[model_path_index + 1] = short;
        } else {
            args[model_path_index + 1] = model_path_pb.display().to_string();
        }
    }
    #[cfg(not(windows))]
    {
        args[model_path_index + 1] = model_path_pb.display().to_string();
    }

    Ok(model_path_pb)
}

/// Validate mmproj path exists and update args with platform-appropriate path format
pub fn validate_mmproj_path(args: &mut Vec<String>) -> ServerResult<Option<PathBuf>> {
   let mmproj_path_index = match args.iter().position(|arg| arg == "--mmproj") {
       Some(index) => index,
       None => return Ok(None), // mmproj is optional
   };

   let mmproj_path = args.get(mmproj_path_index + 1).cloned().ok_or_else(|| {
       LlamacppError::new(
           ErrorCode::ModelLoadFailed,
           "Mmproj path was not provided after '--mmproj' flag.".into(),
           None,
       )
   })?;

   let mmproj_path_pb = PathBuf::from(&mmproj_path);
   if !mmproj_path_pb.exists() {
       let err_msg = format!(
           "Invalid or inaccessible mmproj path: {}",
           mmproj_path_pb.display()
       );
       log::error!("{}", &err_msg);
       return Err(LlamacppError::new(
           ErrorCode::ModelFileNotFound,
           "The specified mmproj file does not exist or is not accessible.".into(),
           Some(err_msg),
       )
       .into());
   }

   #[cfg(windows)]
   {
       // use short path on Windows
       if let Some(short) = get_short_path(&mmproj_path_pb) {
           args[mmproj_path_index + 1] = short;
       } else {
           args[mmproj_path_index + 1] = mmproj_path_pb.display().to_string();
       }
   }
   #[cfg(not(windows))]
   {
       args[mmproj_path_index + 1] = mmproj_path_pb.display().to_string();
   }

   Ok(Some(mmproj_path_pb))
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

    #[test]
    fn test_validate_model_path_valid() {
        let temp_file = NamedTempFile::new().unwrap();
        let path = temp_file.path().to_str().unwrap();
        
        let mut args = vec!["-m".to_string(), path.to_string(), "--verbose".to_string()];
        let result = validate_model_path(&mut args);
        
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), PathBuf::from(path));
        // Args should be updated with the path
        #[cfg(windows)]
        {
            // On Windows, the path might be converted to short path format
            // Just verify that the path in args[1] points to the same file
            assert!(PathBuf::from(&args[1]).exists());
        }
        #[cfg(not(windows))]
        {
            assert_eq!(args[1], temp_file.path().display().to_string());
        }
    }

    #[test]
    fn test_validate_model_path_missing_flag() {
        let mut args = vec!["--verbose".to_string(), "value".to_string()];
        let result = validate_model_path(&mut args);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_model_path_missing_value() {
        let mut args = vec!["-m".to_string()];
        let result = validate_model_path(&mut args);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_model_path_nonexistent_file() {
        let nonexistent_path = "/tmp/nonexistent_model_123456789.gguf";
        let mut args = vec!["-m".to_string(), nonexistent_path.to_string()];
        let result = validate_model_path(&mut args);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_mmproj_path_valid() {
        let temp_file = NamedTempFile::new().unwrap();
        let path = temp_file.path().to_str().unwrap();
        
        let mut args = vec!["--mmproj".to_string(), path.to_string(), "--verbose".to_string()];
        let result = validate_mmproj_path(&mut args);
        
        assert!(result.is_ok());
        assert!(result.unwrap().is_some());
        // Args should be updated with the path
        #[cfg(windows)]
        {
            // On Windows, the path might be converted to short path format
            // Just verify that the path in args[1] points to the same file
            assert!(PathBuf::from(&args[1]).exists());
        }
        #[cfg(not(windows))]
        {
            assert_eq!(args[1], temp_file.path().display().to_string());
        }
    }

    #[test]
    fn test_validate_mmproj_path_missing() {
        let mut args = vec!["--verbose".to_string(), "value".to_string()];
        let result = validate_mmproj_path(&mut args);
        assert!(result.is_ok());
        assert!(result.unwrap().is_none()); // mmproj is optional
    }

    #[test]
    fn test_validate_mmproj_path_missing_value() {
        let mut args = vec!["--mmproj".to_string()];
        let result = validate_mmproj_path(&mut args);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_mmproj_path_nonexistent_file() {
        let nonexistent_path = "/tmp/nonexistent_mmproj_123456789.gguf";
        let mut args = vec!["--mmproj".to_string(), nonexistent_path.to_string()];
        let result = validate_mmproj_path(&mut args);
        assert!(result.is_err());
    }


    #[test]
    fn test_validate_model_path_multiple_m_flags() {
        let temp_file = NamedTempFile::new().unwrap();
        let path = temp_file.path().to_str().unwrap();
        
        // Multiple -m flags - should use the first one
        let mut args = vec![
            "-m".to_string(), 
            path.to_string(),
            "--verbose".to_string(),
            "-m".to_string(),
            "another_path".to_string()
        ];
        let result = validate_model_path(&mut args);
        
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), PathBuf::from(path));
    }

    #[test]
    fn test_validate_mmproj_path_multiple_flags() {
        let temp_file = NamedTempFile::new().unwrap();
        let path = temp_file.path().to_str().unwrap();
        
        // Multiple --mmproj flags - should use the first one
        let mut args = vec![
            "--mmproj".to_string(), 
            path.to_string(),
            "--verbose".to_string(),
            "--mmproj".to_string(),
            "another_path".to_string()
        ];
        let result = validate_mmproj_path(&mut args);
        
        assert!(result.is_ok());
        let result_path = result.unwrap();
        assert!(result_path.is_some());
        assert_eq!(result_path.unwrap(), PathBuf::from(path));
    }
}
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
