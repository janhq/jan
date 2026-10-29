use super::commands::*;
use super::grants::ReadGrants;
use super::helpers::resolve_path_within_jan_data_folder;
use crate::core::app::commands::get_jan_data_folder_path;
use jan_utils::normalize_path;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::test::mock_app;
use tauri::Manager;

#[test]
fn test_rm() {
    let app = mock_app();
    let path = "test_rm_dir";
    fs::create_dir_all(get_jan_data_folder_path(app.handle().clone()).join(path)).unwrap();
    let args = vec![format!("file://{path}").to_string()];
    let result = rm(app.handle().clone(), args);
    assert!(result.is_ok());
    assert!(!get_jan_data_folder_path(app.handle().clone())
        .join(path)
        .exists());
}

#[test]
fn test_mkdir() {
    let app = mock_app();
    let path = "test_mkdir_dir";
    let args = vec![format!("file://{path}").to_string()];
    let result = mkdir(app.handle().clone(), args);
    assert!(result.is_ok());
    assert!(get_jan_data_folder_path(app.handle().clone())
        .join(path)
        .exists());
    let _ = fs::remove_dir_all(get_jan_data_folder_path(app.handle().clone()).join(path));
}

#[test]
fn test_mkdir_rejects_path_outside_jan_data_folder() {
    let app = mock_app();
    let outside = unique_test_dir("mkdir-outside");
    let args = vec![outside.to_string_lossy().to_string()];
    let result = mkdir(app.handle().clone(), args);
    assert!(result.is_err());
    assert!(!outside.exists());
}

#[test]
fn test_mv_rejects_source_outside_jan_data_folder() {
    let app = mock_app();
    let outside_dir = unique_test_dir("mv-outside-src");
    fs::create_dir_all(&outside_dir).unwrap();
    let outside_file = outside_dir.join("source.txt");
    File::create(&outside_file).unwrap();

    let destination = get_jan_data_folder_path(app.handle().clone()).join("moved.txt");
    let args = vec![
        outside_file.to_string_lossy().to_string(),
        destination.to_string_lossy().to_string(),
    ];
    let result = mv(app.handle().clone(), args);
    assert!(result.is_err());
    assert!(outside_file.exists());
    assert!(!destination.exists());

    let _ = fs::remove_dir_all(&outside_dir);
}

#[test]
fn test_mv_rejects_destination_outside_jan_data_folder() {
    let app = mock_app();
    let source = get_jan_data_folder_path(app.handle().clone()).join("mv_src.txt");
    fs::create_dir_all(source.parent().unwrap()).unwrap();
    File::create(&source).unwrap();

    let outside_dir = unique_test_dir("mv-outside-dest");
    fs::create_dir_all(&outside_dir).unwrap();
    let outside_dest = outside_dir.join("moved.txt");

    let args = vec![
        source.to_string_lossy().to_string(),
        outside_dest.to_string_lossy().to_string(),
    ];
    let result = mv(app.handle().clone(), args);
    assert!(result.is_err());
    assert!(source.exists());
    assert!(!outside_dest.exists());

    let _ = fs::remove_file(&source);
    let _ = fs::remove_dir_all(&outside_dir);
}

#[test]
fn test_write_file_sync_rejects_path_outside_jan_data_folder() {
    let app = mock_app();
    let outside = unique_test_dir("write-outside");
    fs::create_dir_all(&outside).unwrap();
    let outside_file = outside.join("forbidden.txt");

    let args = vec![
        outside_file.to_string_lossy().to_string(),
        "malicious content".to_string(),
    ];
    let result = write_file_sync(app.handle().clone(), args);
    assert!(result.is_err());
    assert!(!outside_file.exists());

    let _ = fs::remove_dir_all(&outside);
}

#[test]
fn test_join_path() {
    let app = mock_app();
    let path = "file://test_dir";
    let args = vec![path.to_string(), "test_file".to_string()];
    let result = join_path(app.handle().clone(), args).unwrap();
    assert_eq!(
        result,
        get_jan_data_folder_path(app.handle().clone())
            .join(format!("test_dir{}test_file", std::path::MAIN_SEPARATOR))
            .to_string_lossy()
            .to_string()
    );
}

#[test]
fn test_exists_sync() {
    let app = mock_app();
    let path = "file://test_exists_sync_file";
    let dir_path = get_jan_data_folder_path(app.handle().clone());
    fs::create_dir_all(&dir_path).unwrap();
    let file_path = dir_path.join("test_exists_sync_file");
    File::create(&file_path).unwrap();
    let args: Vec<String> = vec![path.to_string()];
    let result = exists_sync(app.handle().clone(), args).unwrap();
    assert!(result);
    fs::remove_file(file_path).unwrap();
}

#[test]
fn test_read_file_sync() {
    let app = mock_app();
    let path = "file://test_read_file_sync_file";
    let dir_path = get_jan_data_folder_path(app.handle().clone());
    fs::create_dir_all(&dir_path).unwrap();
    let file_path = dir_path.join("test_read_file_sync_file");
    let mut file = File::create(&file_path).unwrap();
    file.write_all(b"test content").unwrap();
    let args = vec![path.to_string()];
    let result = read_file_sync(app.handle().clone(), args).unwrap();
    assert_eq!(result, "test content".to_string());
    fs::remove_file(file_path).unwrap();
}

#[test]
fn test_readdir_sync() {
    let app = mock_app();
    let dir_path = get_jan_data_folder_path(app.handle().clone()).join("test_readdir_sync_dir");
    fs::create_dir_all(&dir_path).unwrap();
    File::create(dir_path.join("file1.txt")).unwrap();
    File::create(dir_path.join("file2.txt")).unwrap();

    let args = vec![dir_path.to_string_lossy().to_string()];
    let result = readdir_sync(app.handle().clone(), args).unwrap();
    assert_eq!(result.len(), 2);

    let _ = fs::remove_dir_all(dir_path);
}

#[cfg(unix)]
#[test]
fn test_resolve_jan_scoped_path_allows_canonicalized_home_symlink_target() {
    use std::os::unix::fs::symlink;
    use std::time::{SystemTime, UNIX_EPOCH};

    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let base_dir = std::env::temp_dir().join(format!("jan-path-scope-{unique}"));
    let configured_root = base_dir.join("home").join("user").join("jan-data");
    let canonical_root = base_dir
        .join("var")
        .join("home")
        .join("user")
        .join("jan-data");
    fs::create_dir_all(&canonical_root).unwrap();
    fs::create_dir_all(configured_root.parent().unwrap()).unwrap();
    symlink(&canonical_root, &configured_root).unwrap();

    let candidate = canonical_root.join("llamacpp/backends/v1/backend.tar.gz");
    let (_, resolved_path) =
        resolve_path_within_jan_data_folder(&configured_root, candidate.to_string_lossy().as_ref())
            .unwrap();

    let expected_path = canonical_root
        .canonicalize()
        .unwrap()
        .join("llamacpp/backends/v1/backend.tar.gz");
    assert_eq!(resolved_path, expected_path);

    let _ = fs::remove_dir_all(&base_dir);
}

#[test]
fn test_resolve_jan_scoped_path_accepts_relative_path_inside_root() {
    let jan_data_folder = unique_test_dir("relative");
    fs::create_dir_all(&jan_data_folder).unwrap();

    let (resolved_root, resolved_path) = resolve_path_within_jan_data_folder(
        &jan_data_folder,
        "llamacpp/backends/v1/backend.tar.gz",
    )
    .unwrap();

    assert!(resolved_path.starts_with(&resolved_root));
    assert_eq!(
        normalize_test_path(&resolved_root),
        normalize_test_path(&jan_data_folder.canonicalize().unwrap())
    );
    assert_eq!(
        resolved_path.file_name().and_then(|name| name.to_str()),
        Some("backend.tar.gz")
    );

    let _ = fs::remove_dir_all(&jan_data_folder);
}

#[test]
fn test_resolve_jan_scoped_path_rejects_escape_outside_data_folder() {
    let jan_data_folder = unique_test_dir("escape");
    fs::create_dir_all(&jan_data_folder).unwrap();

    let result = resolve_path_within_jan_data_folder(&jan_data_folder, "../outside.txt");
    assert!(result.is_err());

    let _ = fs::remove_dir_all(&jan_data_folder);
}

#[test]
fn test_resolve_jan_scoped_path_rejects_absolute_path_outside_root() {
    let jan_data_folder = unique_test_dir("absolute-inside");
    let outside_path = unique_test_dir("absolute-outside").join("file.txt");
    fs::create_dir_all(&jan_data_folder).unwrap();
    fs::create_dir_all(outside_path.parent().unwrap()).unwrap();

    let result = resolve_path_within_jan_data_folder(
        &jan_data_folder,
        outside_path.to_string_lossy().as_ref(),
    );
    assert!(result.is_err());

    let _ = fs::remove_dir_all(&jan_data_folder);
    let _ = fs::remove_dir_all(outside_path.parent().unwrap());
}

#[test]
fn test_unpack_archive_tar_gz() {
    let dir = unique_test_dir("unpack");
    let nested = dir.join("build/bin");
    fs::create_dir_all(&nested).unwrap();
    File::create(nested.join("llama-server"))
        .unwrap()
        .write_all(b"binary")
        .unwrap();

    let archive_path = dir.join("backend.tar.gz");
    {
        let gz = flate2::write::GzEncoder::new(
            File::create(&archive_path).unwrap(),
            flate2::Compression::fast(),
        );
        let mut builder = tar::Builder::new(gz);
        builder.append_dir_all("build", dir.join("build")).unwrap();
        builder.into_inner().unwrap().finish().unwrap();
    }

    let out = dir.join("out");
    unpack_archive(&archive_path, &out).unwrap();
    assert_eq!(
        fs::read_to_string(out.join("build/bin/llama-server")).unwrap(),
        "binary"
    );

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_unpack_archive_rejects_unknown_extension() {
    let dir = unique_test_dir("unpack-bad");
    fs::create_dir_all(&dir).unwrap();
    let archive_path = dir.join("backend.rar");
    File::create(&archive_path)
        .unwrap()
        .write_all(b"x")
        .unwrap();

    assert!(unpack_archive(&archive_path, &dir.join("out")).is_err());

    let _ = fs::remove_dir_all(&dir);
}

fn unique_test_dir(label: &str) -> PathBuf {
    use std::time::{SystemTime, UNIX_EPOCH};

    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("jan-filesystem-{label}-{unique}"))
}

fn normalize_test_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let path_str = path.to_string_lossy();
        if let Some(stripped) = path_str.strip_prefix(r"\\?\") {
            return normalize_path(Path::new(stripped));
        }
    }

    normalize_path(path)
}

#[test]
fn test_mutating_commands_refuse_paths_outside_data_folder() {
    let app = mock_app();
    fs::create_dir_all(get_jan_data_folder_path(app.handle().clone())).unwrap();
    let outside = tempfile::tempdir().unwrap();
    let source = outside.path().join("source.txt");
    fs::write(&source, "keep").unwrap();
    let target = outside.path().join("written.txt");
    let target_dir = outside.path().join("made");

    let abs = |p: &Path| p.to_string_lossy().to_string();
    assert!(write_file_sync(app.handle().clone(), vec![abs(&target), "x".into()]).is_err());
    assert!(mkdir(app.handle().clone(), vec![abs(&target_dir)]).is_err());
    assert!(mv(
        app.handle().clone(),
        vec![abs(&source), "file://moved.txt".into()]
    )
    .is_err());
    assert!(mv(
        app.handle().clone(),
        vec!["file://does-not-matter".into(), abs(&target)]
    )
    .is_err());
    for escape in ["file:/../../escaped.txt", "file://../escaped.txt", "../escaped.txt"] {
        assert!(
            write_file_sync(app.handle().clone(), vec![escape.into(), "x".into()]).is_err(),
            "{escape} should be refused"
        );
        assert!(mkdir(app.handle().clone(), vec![escape.into()]).is_err());
    }

    assert!(!target.exists());
    assert!(!target_dir.exists());
    assert_eq!(fs::read_to_string(&source).unwrap(), "keep");
}

#[test]
fn test_write_file_sync_and_mv_inside_data_folder() {
    let app = mock_app();
    let data = get_jan_data_folder_path(app.handle().clone());
    fs::create_dir_all(&data).unwrap();
    let tmp = data.join("test_write_mv.tmp");
    let out = data.join("test_write_mv.json");

    write_file_sync(
        app.handle().clone(),
        vec![tmp.to_string_lossy().to_string(), "{}".into()],
    )
    .unwrap();
    mv(
        app.handle().clone(),
        vec![
            tmp.to_string_lossy().to_string(),
            "file://test_write_mv.json".into(),
        ],
    )
    .unwrap();
    assert_eq!(fs::read_to_string(&out).unwrap(), "{}");
    fs::remove_file(out).unwrap();
}

#[test]
fn test_read_commands_scope() {
    let app = mock_app();
    app.manage(ReadGrants::default());
    fs::create_dir_all(get_jan_data_folder_path(app.handle().clone())).unwrap();

    // file: URIs and relative paths may not leave the data folder.
    for escape in ["file:/../..", "file://../outside", "../outside"] {
        assert!(exists_sync(app.handle().clone(), vec![escape.into()]).is_err());
        assert!(file_stat(app.handle().clone(), escape.into()).is_err());
        assert!(read_file_sync(app.handle().clone(), vec![escape.into()]).is_err());
        assert!(readdir_sync(app.handle().clone(), vec![escape.into()]).is_err());
    }

    // An absolute path outside the data folder is readable only once the user
    // has picked it (a model folder, an attachment). Until then reads fail and
    // `exists_sync` reports `false`, the same as for a missing path.
    let model = tempfile::tempdir().unwrap();
    fs::write(model.path().join("config.json"), "{\"a\":1}").unwrap();
    let dir = model.path().to_string_lossy().to_string();
    let config = model
        .path()
        .join("config.json")
        .to_string_lossy()
        .to_string();
    assert!(!exists_sync(app.handle().clone(), vec![config.clone()]).unwrap());
    for err in [
        file_stat(app.handle().clone(), dir.clone()).err().unwrap(),
        read_file_sync(app.handle().clone(), vec![config.clone()])
            .err()
            .unwrap(),
        readdir_sync(app.handle().clone(), vec![dir.clone()])
            .err()
            .unwrap(),
    ] {
        assert!(err.starts_with(super::grants::DENIED_PREFIX), "{err}");
    }

    app.state::<ReadGrants>().record_pick(model.path());
    assert!(exists_sync(app.handle().clone(), vec![config.clone()]).unwrap());
    assert!(file_stat(app.handle().clone(), dir.clone()).unwrap().is_directory);
    assert_eq!(
        read_file_sync(app.handle().clone(), vec![config]).unwrap(),
        "{\"a\":1}"
    );
    assert_eq!(readdir_sync(app.handle().clone(), vec![dir]).unwrap().len(), 1);
}
