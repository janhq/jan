use std::path::PathBuf;

use crate::error::{ErrorCode, LlamacppError, ServerResult};

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

#[cfg(windows)]
use std::ffi::OsStr;

#[cfg(windows)]
use windows_sys::Win32::Storage::FileSystem::GetShortPathNameW;

/// Get Windows short path to avoid issues with spaces and special characters
#[cfg(windows)]
pub fn get_short_path<P: AsRef<std::path::Path>>(path: P) -> Option<String> {
    let wide: Vec<u16> = OsStr::new(path.as_ref())
        .encode_wide()
        .chain(Some(0))
        .collect();

    let mut buffer = vec![0u16; 260];
    let len = unsafe { GetShortPathNameW(wide.as_ptr(), buffer.as_mut_ptr(), buffer.len() as u32) };

    if len > 0 {
        Some(String::from_utf16_lossy(&buffer[..len as usize]))
    } else {
        None
    }
}

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
