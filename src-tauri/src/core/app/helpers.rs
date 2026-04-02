use std::{fs, io, path::PathBuf};

/// Recursively copy a directory from src to dst, excluding specified directories
pub fn copy_dir_recursive(
    src: &PathBuf,
    dst: &PathBuf,
    exclude_dirs: &[&str],
) -> Result<(), io::Error> {
    if !dst.exists() {
        fs::create_dir_all(dst)?;
    }

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if let Some(name) = entry.file_name().to_str() {
            if exclude_dirs.contains(&name) {
                continue;
            }
        }

        let is_dir = file_type.is_dir()
            || (file_type.is_symlink() && src_path.is_dir());

        if is_dir {
            copy_dir_recursive(&src_path, &dst_path, exclude_dirs)?;
        } else if file_type.is_file() || file_type.is_symlink() {
            fs::copy(&src_path, &dst_path)?;
        } else {
            log::debug!("Skipping non-regular file: {src_path:?}");
        }
    }

    Ok(())
}
