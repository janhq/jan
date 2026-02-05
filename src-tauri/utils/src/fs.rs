use std::fs;
use std::io;
use std::path::PathBuf;

/// Recursively copies directories with exclusion support
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

        if file_type.is_dir() {
            // Skip excluded directories
            if let Some(dir_name) = entry.file_name().to_str() {
                if exclude_dirs.contains(&dir_name) {
                    continue;
                }
            }
            copy_dir_recursive(&src_path, &dst_path, exclude_dirs)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }

    Ok(())
}
