//! Acceptance tests for `bundle::extract`: one per rejection rule, plus the
//! happy path. Every tarball is built in-test with `tar::Builder`, or by
//! hand-writing headers where `tar::Builder` refuses to produce the attack.

use std::io::{Cursor, Write};
use std::path::Path;

use flate2::write::GzEncoder;
use flate2::Compression;
use tar::{Builder, EntryType, Header};
use tauri_plugin_extensions::bundle::{extract, Limits};
use tauri_plugin_extensions::error::BundleError;

const PACKAGE_JSON: &[u8] = br#"{"name":"x","version":"0.1.0"}"#;

fn gzip(bytes: &[u8]) -> Vec<u8> {
    let mut gz = GzEncoder::new(Vec::new(), Compression::default());
    gz.write_all(bytes).unwrap();
    gz.finish().unwrap()
}

/// A raw ustar header whose name bytes are written verbatim, so paths that
/// `Header::set_path` refuses (`..`, absolute) still reach the extractor.
fn raw_header(name: &[u8], kind: EntryType, size: u64) -> Header {
    let mut header = Header::new_ustar();
    header.set_size(size);
    header.set_mode(0o644);
    header.set_entry_type(kind);
    {
        let bytes = header.as_mut_bytes();
        bytes[..100].fill(0);
        bytes[..name.len()].copy_from_slice(name);
    }
    header.set_cksum();
    header
}

struct Tarball {
    builder: Builder<Vec<u8>>,
}

impl Tarball {
    fn new() -> Self {
        Tarball {
            builder: Builder::new(Vec::new()),
        }
    }

    fn with_package_json() -> Self {
        let mut t = Self::new();
        t.file("package/package.json", PACKAGE_JSON);
        t
    }

    fn file(&mut self, path: &str, data: &[u8]) -> &mut Self {
        self.raw(path.as_bytes(), EntryType::Regular, data)
    }

    /// A regular file through `append_data`, which writes a GNU long-name
    /// entry for paths past the 100-byte ustar field.
    fn long_file(&mut self, path: &str, data: &[u8]) -> &mut Self {
        let mut header = Header::new_gnu();
        header.set_entry_type(EntryType::Regular);
        header.set_size(data.len() as u64);
        header.set_mode(0o644);
        self.builder.append_data(&mut header, path, data).unwrap();
        self
    }

    fn long_dir(&mut self, path: &str) -> &mut Self {
        let mut header = Header::new_gnu();
        header.set_entry_type(EntryType::Directory);
        header.set_size(0);
        header.set_mode(0o755);
        self.builder.append_data(&mut header, path, &[][..]).unwrap();
        self
    }

    fn file_mode(&mut self, path: &str, data: &[u8], mode: u32) -> &mut Self {
        let mut header = raw_header(path.as_bytes(), EntryType::Regular, data.len() as u64);
        header.set_mode(mode);
        header.set_cksum();
        self.builder.append(&header, data).unwrap();
        self
    }

    fn raw(&mut self, name: &[u8], kind: EntryType, data: &[u8]) -> &mut Self {
        let header = raw_header(name, kind, data.len() as u64);
        self.builder.append(&header, data).unwrap();
        self
    }

    fn link(&mut self, path: &str, kind: EntryType, target: &str) -> &mut Self {
        let mut header = raw_header(path.as_bytes(), kind, 0);
        header.set_link_name(target).unwrap();
        header.set_cksum();
        self.builder.append(&header, &[][..]).unwrap();
        self
    }

    fn tar(self) -> Vec<u8> {
        self.builder.into_inner().unwrap()
    }

    fn tgz(self) -> Vec<u8> {
        gzip(&self.tar())
    }
}

fn run(tgz: &[u8], dest: &Path) -> Result<tauri_plugin_extensions::bundle::ExtractedPackage, BundleError> {
    extract(Cursor::new(tgz), dest, Limits::default())
}

fn rejected(tgz: Vec<u8>) -> BundleError {
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("out");
    let err = run(&tgz, &dest).expect_err("must be rejected");
    // A refused archive leaves nothing behind.
    assert!(!dest.exists(), "{err}: destination left behind");
    err
}

fn unsafe_path(name: &[u8]) {
    let mut t = Tarball::with_package_json();
    t.raw(name, EntryType::Regular, b"x");
    let err = rejected(t.tgz());
    assert!(matches!(err, BundleError::UnsafePath { .. }), "{err}");
}

#[test]
fn rejects_parent_dir() {
    unsafe_path(b"../x");
}

#[test]
fn rejects_absolute_path() {
    unsafe_path(b"/etc/x");
}

#[test]
fn rejects_traversal_after_the_prefix() {
    unsafe_path(b"package/../../x");
}

#[test]
fn rejects_a_dot_component() {
    unsafe_path(b"package/./x");
}

#[test]
fn rejects_windows_drive_paths() {
    unsafe_path(b"C:\\x");
    unsafe_path(b"package/C:\\x");
    unsafe_path(b"package/c:x");
}

#[test]
fn rejects_backslashes() {
    unsafe_path(b"package\\..\\x");
    unsafe_path(b"package/a\\b");
}

#[test]
fn rejects_a_missing_package_prefix() {
    unsafe_path(b"x/package.json");
    unsafe_path(b"packagex/a.js");
    unsafe_path(b"package");
}

#[test]
fn rejects_symlinks() {
    let mut t = Tarball::with_package_json();
    t.link("package/link", EntryType::Symlink, "/etc/passwd");
    assert!(matches!(rejected(t.tgz()), BundleError::UnsupportedEntry { .. }));
}

#[test]
fn rejects_hardlinks() {
    let mut t = Tarball::with_package_json();
    t.link("package/link", EntryType::Link, "package/package.json");
    assert!(matches!(rejected(t.tgz()), BundleError::UnsupportedEntry { .. }));
}

#[test]
fn rejects_char_and_block_devices() {
    for kind in [EntryType::Char, EntryType::Block] {
        let mut t = Tarball::with_package_json();
        t.raw(b"package/dev", kind, b"");
        assert!(matches!(rejected(t.tgz()), BundleError::UnsupportedEntry { .. }));
    }
}

#[test]
fn rejects_fifos() {
    let mut t = Tarball::with_package_json();
    t.raw(b"package/fifo", EntryType::Fifo, b"");
    assert!(matches!(rejected(t.tgz()), BundleError::UnsupportedEntry { .. }));
}

#[test]
fn rejects_sparse_global_and_unknown_types() {
    for kind in [
        EntryType::GNUSparse,
        EntryType::XGlobalHeader,
        EntryType::Continuous,
        EntryType::new(b'Z'),
    ] {
        let mut t = Tarball::with_package_json();
        t.raw(b"package/odd", kind, b"");
        let err = rejected(t.tgz());
        assert!(
            matches!(err, BundleError::UnsupportedEntry { .. } | BundleError::Io(_)),
            "{kind:?}: {err}"
        );
    }
}

#[test]
fn rejects_too_many_entries() {
    let mut t = Tarball::with_package_json();
    for i in 0..Limits::default().max_entries {
        t.file(&format!("package/f{i}.js"), b"");
    }
    assert!(matches!(rejected(t.tgz()), BundleError::TooManyEntries { .. }));
}

#[test]
fn rejects_a_file_over_the_per_file_cap() {
    let limits = Limits {
        max_file_bytes: 1024,
        ..Limits::default()
    };
    let mut t = Tarball::with_package_json();
    t.file("package/big.js", &[b'a'; 2048]);
    let dir = tempfile::tempdir().unwrap();
    let err = extract(Cursor::new(t.tgz()), &dir.path().join("out"), limits).unwrap_err();
    assert!(matches!(err, BundleError::FileTooLarge { .. }), "{err}");
}

#[test]
fn counts_decompressed_bytes_whatever_the_headers_claim() {
    // The header says 10 bytes while 4096 follow: tar reads 10, then treats
    // the rest as headers. The decompressed stream is what is capped, so the
    // padding still counts and the archive fails one way or another without
    // ever writing more than the cap.
    let limits = Limits {
        max_total_bytes: 4096,
        ..Limits::default()
    };
    let mut tar = Tarball::with_package_json().tar();
    let header = raw_header(b"package/lie.js", EntryType::Regular, 10);
    tar.truncate(tar.len() - 1024);
    tar.extend_from_slice(header.as_bytes());
    tar.extend_from_slice(&[b'a'; 8192]);
    tar.extend_from_slice(&[0; 1024]);
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("out");
    let err = extract(Cursor::new(gzip(&tar)), &dest, limits).unwrap_err();
    assert!(matches!(err, BundleError::TooLarge { .. } | BundleError::Io(_)), "{err}");
    assert!(!dest.exists());
}

#[test]
fn rejects_a_gzip_bomb() {
    // 60 MiB of zeros in one entry gzips to about 60 KiB; extraction must stop
    // at the 50 MiB decompressed cap rather than at the 20 MiB file cap,
    // because the header is lowered to claim a small file.
    let mut gz = GzEncoder::new(Vec::new(), Compression::best());
    let mut tar = Tarball::with_package_json().tar();
    tar.truncate(tar.len() - 1024);
    let header = raw_header(b"package/bomb.js", EntryType::Regular, 1);
    tar.extend_from_slice(header.as_bytes());
    gz.write_all(&tar).unwrap();
    let zeros = vec![0u8; 1024 * 1024];
    for _ in 0..60 {
        gz.write_all(&zeros).unwrap();
    }
    let tgz = gz.finish().unwrap();
    assert!(tgz.len() < 1024 * 1024);
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("out");
    let err = run(&tgz, &dest).unwrap_err();
    assert!(matches!(err, BundleError::TooLarge { .. }), "{err}");
    assert!(!dest.exists());
}

#[test]
fn rejects_case_insensitive_duplicates() {
    let mut t = Tarball::with_package_json();
    t.file("package/Readme.md", b"a").file("package/README.md", b"b");
    assert!(matches!(rejected(t.tgz()), BundleError::Duplicate { .. }));
}

#[test]
fn rejects_exact_duplicates() {
    let mut t = Tarball::with_package_json();
    t.file("package/a.js", b"a").file("package/a.js", b"b");
    assert!(matches!(rejected(t.tgz()), BundleError::Duplicate { .. }));
}

#[test]
fn rejects_a_file_under_a_file() {
    let mut t = Tarball::with_package_json();
    t.file("package/a", b"a").file("package/a/b.js", b"b");
    let err = rejected(t.tgz());
    assert!(matches!(err, BundleError::Duplicate { .. } | BundleError::Io(_)), "{err}");
}

#[test]
fn requires_package_json() {
    let mut t = Tarball::new();
    t.file("package/index.js", b"x");
    assert!(matches!(rejected(t.tgz()), BundleError::MissingPackageJson));
}

#[test]
fn rejects_an_invalid_package_json() {
    let mut t = Tarball::new();
    t.file("package/package.json", b"[1,");
    assert!(matches!(rejected(t.tgz()), BundleError::BadPackageJson(_)));
}

#[test]
fn rejects_a_non_gzip_stream() {
    let t = Tarball::with_package_json();
    assert!(matches!(rejected(t.tar()), BundleError::Io(_)));
}

#[test]
fn refuses_an_existing_destination() {
    let dir = tempfile::tempdir().unwrap();
    let err = run(&Tarball::with_package_json().tgz(), dir.path()).unwrap_err();
    assert!(matches!(err, BundleError::DestinationExists(_)));
}

#[test]
fn extracts_the_package_layout_without_exec_bits() {
    let mut t = Tarball::with_package_json();
    t.raw(b"package/dist/", EntryType::Directory, b"");
    t.file_mode("package/dist/index.js", b"var JanExtension = {}", 0o755);
    t.file("package/deep/a/b/c.txt", b"c");
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("out");
    let extracted = run(&t.tgz(), &dest).unwrap();

    assert_eq!(extracted.root, dest);
    assert_eq!(extracted.package_json["name"], "x");
    let mut files = extracted.files.clone();
    files.sort();
    assert_eq!(
        files,
        vec!["deep/a/b/c.txt", "dist/index.js", "package.json"]
    );
    assert_eq!(
        std::fs::read_to_string(dest.join("dist/index.js")).unwrap(),
        "var JanExtension = {}"
    );
    assert_eq!(std::fs::read(dest.join("deep/a/b/c.txt")).unwrap(), b"c");

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = |p: &str| std::fs::metadata(dest.join(p)).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode("dist/index.js"), 0o644);
        assert_eq!(mode("package.json"), 0o644);
        assert_eq!(mode("dist"), 0o755);
    }
}

#[test]
fn ignores_pax_metadata_but_honours_a_pax_path() {
    // npm writes pax headers for long names; the path they carry is the one
    // checked, so a pax path cannot smuggle `..` past the prefix check.
    let mut builder = Builder::new(Vec::new());
    builder
        .append_pax_extensions([("path", &b"package/../../evil.js"[..])])
        .unwrap();
    let header = raw_header(b"package/fine.js", EntryType::Regular, 1);
    builder.append(&header, &b"x"[..]).unwrap();
    let header = raw_header(b"package/package.json", EntryType::Regular, PACKAGE_JSON.len() as u64);
    builder.append(&header, PACKAGE_JSON).unwrap();
    let err = rejected(gzip(&builder.into_inner().unwrap()));
    assert!(matches!(err, BundleError::UnsafePath { .. }), "{err}");
}

#[test]
fn rejects_the_deep_path_stall_quickly() {
    // The review PoC: about 2000 tiny files 200 directories deep. Without a
    // depth cap every file re-creates every ancestor, which ran for 34 s.
    let mut t = Tarball::with_package_json();
    for i in 0..1999 {
        t.long_file(&format!("package/d{i}/{}x.js", "a/".repeat(200)), b"");
    }
    let tgz = t.tgz();
    let started = std::time::Instant::now();
    let err = rejected(tgz);
    assert!(matches!(err, BundleError::PathTooLong { .. }), "{err}");
    assert!(started.elapsed() < std::time::Duration::from_secs(2), "{:?}", started.elapsed());
}

#[test]
fn caps_nesting_depth() {
    let limits = Limits::default();
    let ok = format!("package/{}x.js", "a/".repeat(limits.max_depth - 1));
    let mut t = Tarball::with_package_json();
    t.long_file(&ok, b"x");
    let dir = tempfile::tempdir().unwrap();
    run(&t.tgz(), &dir.path().join("out")).unwrap();

    let deep = format!("package/{}x.js", "a/".repeat(limits.max_depth));
    let mut t = Tarball::with_package_json();
    t.long_file(&deep, b"x");
    assert!(matches!(rejected(t.tgz()), BundleError::PathTooLong { .. }));
}

#[test]
fn caps_the_relative_path_length() {
    let limits = Limits::default();
    let name = |len: usize| format!("package/d/{}.js", "n".repeat(len - "d/".len() - ".js".len()));
    let mut t = Tarball::with_package_json();
    t.long_file(&name(limits.max_path_bytes), b"x");
    let dir = tempfile::tempdir().unwrap();
    run(&t.tgz(), &dir.path().join("out")).unwrap();

    let mut t = Tarball::with_package_json();
    t.long_file(&name(limits.max_path_bytes + 1), b"x");
    assert!(matches!(rejected(t.tgz()), BundleError::PathTooLong { .. }));
    let mut t = Tarball::with_package_json();
    t.long_dir(&format!("package/{}", "n".repeat(limits.max_path_bytes + 1)));
    assert!(matches!(rejected(t.tgz()), BundleError::PathTooLong { .. }));
}

#[test]
fn shares_ancestors_between_files() {
    // Many files under one deep directory: each ancestor is created once and
    // the files all land.
    let mut t = Tarball::with_package_json();
    let dir_path = "a/".repeat(20);
    for i in 0..200 {
        t.file(&format!("package/{dir_path}f{i}.js"), b"x");
    }
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("out");
    let extracted = run(&t.tgz(), &dest).unwrap();
    assert_eq!(extracted.files.len(), 201);
    assert!(dest.join(&dir_path).join("f199.js").is_file());
}

#[test]
fn caps_implied_directories_just_under_the_path_caps() {
    // Within the depth and length caps, distinct deep paths still imply tens
    // of thousands of directories; the directory cap bounds that work.
    let limits = Limits::default();
    let mut t = Tarball::with_package_json();
    for i in 0..1999 {
        t.long_file(&format!("package/d{i}/{}x.js", "a/".repeat(limits.max_depth - 2)), b"");
    }
    let tgz = t.tgz();
    let started = std::time::Instant::now();
    let err = rejected(tgz);
    assert!(matches!(err, BundleError::TooManyDirectories { .. }), "{err}");
    assert!(started.elapsed() < std::time::Duration::from_secs(2), "{:?}", started.elapsed());
}
