//! Startup update check and self-update for the headless `jan` CLI.
//!
//! Only active when the binary was built by the nightly CI templates, which
//! embed `JAN_CLI_UPDATE_CHANNEL` (e.g. `agent-nightly`) and
//! `JAN_CLI_BUILD_VERSION` (the actual nightly version, since `Cargo.toml`'s
//! `version` stays pinned). A local `cargo build --features cli` has neither,
//! so both the check and `jan update` are no-ops there.

use std::cmp::Ordering;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;
use sha2::{Digest, Sha256};

const CHECK_TIMEOUT: Duration = Duration::from_millis(1500);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(300);
const BINARY_NAME: &str = if cfg!(windows) { "jan.exe" } else { "jan" };

#[derive(Debug, Deserialize)]
struct UpdateManifest {
    version: String,
    #[serde(default)]
    platforms: serde_json::Value,
}

/// A newer build published on the channel this binary was built for.
#[derive(Debug, Clone)]
pub struct AvailableUpdate {
    pub channel: &'static str,
    pub current: String,
    pub latest: String,
    pub url: Option<String>,
    pub sha256: Option<String>,
}

/// What `self_update` actually did.
#[derive(Debug)]
pub enum UpdateOutcome {
    UpToDate {
        version: String,
    },
    Installed {
        from: String,
        to: String,
        path: PathBuf,
    },
}

fn update_channel() -> Option<&'static str> {
    option_env!("JAN_CLI_UPDATE_CHANNEL")
}

/// The version this binary reports: the nightly build version embedded by CI
/// (`JAN_CLI_BUILD_VERSION`) when present, otherwise `Cargo.toml`'s pinned
/// version. Also used for `--version`, since Cargo.toml's version alone
/// can't distinguish nightly builds cut from the same release.
pub fn build_version() -> &'static str {
    option_env!("JAN_CLI_BUILD_VERSION").unwrap_or(env!("CARGO_PKG_VERSION"))
}

/// Platform key used in `manifest.json`, matching the nightly workflow's
/// `platforms` object.
fn platform_key() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("linux", "x86_64") => Some("linux-x86_64"),
        ("macos", _) => Some("darwin-universal"),
        ("windows", "x86_64") => Some("windows-x86_64"),
        _ => None,
    }
}

/// Compare nightly versions like `0.8.4-1723`: split into `.`/`-` separated
/// segments, comparing numerically where both sides are numeric so that
/// build 9 sorts before build 10. A shorter version is the older one
/// (`0.8.4` predates `0.8.4-1`).
fn compare_versions(a: &str, b: &str) -> Ordering {
    let seg = |v: &str| -> Vec<String> {
        v.trim_start_matches('v')
            .split(['.', '-', '+'])
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect()
    };
    let (a, b) = (seg(a), seg(b));
    for i in 0..a.len().max(b.len()) {
        let ord = match (a.get(i), b.get(i)) {
            (Some(x), Some(y)) => match (x.parse::<u64>(), y.parse::<u64>()) {
                (Ok(x), Ok(y)) => x.cmp(&y),
                _ => x.cmp(y),
            },
            (Some(_), None) => Ordering::Greater,
            (None, Some(_)) => Ordering::Less,
            (None, None) => Ordering::Equal,
        };
        if ord != Ordering::Equal {
            return ord;
        }
    }
    Ordering::Equal
}

async fn fetch_manifest(channel: &str, timeout: Duration) -> Result<UpdateManifest, String> {
    let url = format!("https://delta.jan.ai/{channel}/manifest.json");
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| e.to_string())?;
    client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json::<UpdateManifest>()
        .await
        .map_err(|e| e.to_string())
}

fn read_update(manifest: &UpdateManifest, channel: &'static str) -> AvailableUpdate {
    let entry = platform_key().and_then(|key| manifest.platforms.get(key));
    let field = |name: &str| {
        entry
            .and_then(|p| p.get(name))
            .and_then(|v| v.as_str())
            .map(str::to_string)
    };
    AvailableUpdate {
        channel,
        current: build_version().to_string(),
        latest: manifest.version.clone(),
        url: field("url"),
        sha256: field("sha256"),
    }
}

/// Resolve the newest published build, or `None` when this binary has no
/// channel embedded (a local build) or the manifest can't be reached.
pub async fn check_for_update(timeout: Duration) -> Result<AvailableUpdate, String> {
    let channel = update_channel().ok_or_else(|| {
        "this build has no update channel embedded (built from source, not by the nightly CI)"
            .to_string()
    })?;
    let manifest = tokio::time::timeout(timeout, fetch_manifest(channel, timeout))
        .await
        .map_err(|_| format!("timed out contacting https://delta.jan.ai/{channel}"))??;
    Ok(read_update(&manifest, channel))
}

impl AvailableUpdate {
    pub fn is_newer(&self) -> bool {
        compare_versions(&self.latest, &self.current) == Ordering::Greater
    }

    /// One-line "what is newer", shared by the stderr notice, the TUI note and
    /// `jan update --check`.
    pub fn summary(&self) -> String {
        format!(
            "A new {} build is available: {} -> {}",
            self.channel, self.current, self.latest
        )
    }
}

/// A published build strictly newer than this one, or `None` when the check is
/// opted out of, this is a local build, the manifest is unreachable, or we are
/// already current. Best-effort by design: every failure is a silent `None` so
/// the check never blocks or breaks startup.
pub async fn available_update() -> Option<AvailableUpdate> {
    if std::env::var_os("JAN_CLI_NO_UPDATE_CHECK").is_some() {
        return None;
    }
    let update = check_for_update(CHECK_TIMEOUT).await.ok()?;
    update.is_newer().then_some(update)
}

/// Print the startup update notice to stderr. Used by the non-interactive
/// commands; the TUI notes it in the transcript instead (`tui::note_update`),
/// since anything written here is lost to the alternate screen.
pub async fn print_update_notice_if_available() {
    if let Some(update) = available_update().await {
        eprintln!("{}. Run `jan update` to install it.", update.summary());
    }
}

// ── Self-update ────────────────────────────────────────────────────────────

/// Path of the binary to replace, with symlinks resolved so that updating a
/// `~/.local/bin/jan` symlink rewrites the real file rather than clobbering
/// the link.
fn target_binary_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("cannot locate this binary: {e}"))?;
    Ok(fs::canonicalize(&exe).unwrap_or(exe))
}

/// Fail early (before downloading tens of megabytes) when the install location
/// is not writable, e.g. a `/usr/local/bin` install owned by root.
fn ensure_writable(exe: &Path) -> Result<(), String> {
    let dir = exe
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", exe.display()))?;
    let probe = dir.join(format!(".jan-update-probe-{}", std::process::id()));
    let writable = File::create(&probe).is_ok();
    let _ = fs::remove_file(&probe);
    if !writable {
        return Err(format!(
            "{} is not writable; re-run with the permissions that own the install (or reinstall manually)",
            dir.display()
        ));
    }
    if fs::metadata(exe)
        .map(|m| m.permissions().readonly())
        .unwrap_or(false)
    {
        return Err(format!("{} is read-only", exe.display()));
    }
    Ok(())
}

async fn download_to(url: &str, dest: &Path) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err(format!("refusing to download over a non-HTTPS URL: {url}"));
    }
    let client = reqwest::Client::builder()
        .timeout(DOWNLOAD_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("download failed: {e}"))?;

    let mut file = File::create(dest).map_err(|e| format!("{}: {e}", dest.display()))?;
    let mut hasher = Sha256::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("download failed: {e}"))?
    {
        hasher.update(&chunk);
        file.write_all(&chunk)
            .map_err(|e| format!("{}: {e}", dest.display()))?;
    }
    file.flush().map_err(|e| e.to_string())?;
    Ok(hex::encode(hasher.finalize()))
}

/// Extract the `jan` binary out of a release archive. Today every platform's
/// archive stores it at the root, but the packaging step differs per platform
/// (tar vs 7z), so match on the file name rather than the full path.
fn extract_binary(archive: &Path, dest: &Path) -> Result<(), String> {
    let name = archive.file_name().unwrap_or_default().to_string_lossy();
    let mut out = File::create(dest).map_err(|e| format!("{}: {e}", dest.display()))?;
    let found = if name.ends_with(".zip") {
        extract_from_zip(archive, &mut out)?
    } else {
        extract_from_tar_gz(archive, &mut out)?
    };
    if !found {
        return Err(format!(
            "no `{BINARY_NAME}` entry inside the release archive"
        ));
    }
    out.flush().map_err(|e| e.to_string())?;
    Ok(())
}

fn is_binary_entry(path: &Path) -> bool {
    path.file_name().map(|n| n == BINARY_NAME).unwrap_or(false)
}

fn extract_from_tar_gz(archive: &Path, out: &mut impl Write) -> Result<bool, String> {
    let file = File::open(archive).map_err(|e| format!("{}: {e}", archive.display()))?;
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(file));
    for entry in tar.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?.into_owned();
        if is_binary_entry(&path) {
            io::copy(&mut entry, out).map_err(|e| e.to_string())?;
            return Ok(true);
        }
    }
    Ok(false)
}

fn extract_from_zip(archive: &Path, out: &mut impl Write) -> Result<bool, String> {
    let file = File::open(archive).map_err(|e| format!("{}: {e}", archive.display()))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let matches = entry.enclosed_name().map(is_binary_entry).unwrap_or(false);
        if matches {
            io::copy(&mut entry, out).map_err(|e| e.to_string())?;
            return Ok(true);
        }
    }
    Ok(false)
}

/// Sanity-check the extracted file before it replaces a working binary: a
/// truncated download or an HTML error page must not be installed.
fn verify_executable(path: &Path) -> Result<(), String> {
    let mut magic = [0u8; 4];
    let read = File::open(path)
        .and_then(|mut f| f.read(&mut magic))
        .map_err(|e| format!("{}: {e}", path.display()))?;
    let looks_native = read == 4
        && (magic == [0x7f, b'E', b'L', b'F']            // ELF
            || magic[..2] == *b"MZ"                       // PE
            || magic == [0xcf, 0xfa, 0xed, 0xfe]          // Mach-O 64
            || magic == [0xca, 0xfe, 0xba, 0xbe]); // Mach-O universal
    if !looks_native {
        return Err("the downloaded file is not an executable".to_string());
    }
    Ok(())
}

fn make_executable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("{}: {e}", path.display()))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

/// Swap the staged binary in. Both files live in the install directory so the
/// rename is atomic; on Windows the running image cannot be overwritten, so
/// move it aside first and let a later run delete it.
fn replace_binary(staged: &Path, exe: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        let backup = exe.with_extension("old");
        let _ = fs::remove_file(&backup);
        fs::rename(exe, &backup).map_err(|e| format!("{}: {e}", exe.display()))?;
        if let Err(e) = fs::rename(staged, exe) {
            let _ = fs::rename(&backup, exe);
            return Err(format!("{}: {e}", exe.display()));
        }
        return Ok(());
    }
    #[cfg(not(windows))]
    fs::rename(staged, exe).map_err(|e| format!("{}: {e}", exe.display()))
}

/// Staging-file prefix; the pid suffix keeps two concurrent installs apart.
const STAGING_PREFIX: &str = ".jan-update-";

/// Drop leftovers from an earlier update: the Windows backup (unlocked once the
/// old process has exited) and any staging files from a run that was killed
/// mid-download. `/update` makes that reachable -- quitting the TUI cancels the
/// task between `download_to`'s awaits, so nothing gets to clean up after it.
fn clean_stale_files(exe: &Path) {
    if cfg!(windows) {
        let _ = fs::remove_file(exe.with_extension("old"));
    }
    let Some(dir) = exe.parent() else {
        return;
    };
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with(STAGING_PREFIX)
            && is_stale(&entry)
        {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// True when a staging file is too old to belong to a download still running in
/// another process: any live one is younger than `DOWNLOAD_TIMEOUT`, since that
/// is when the request itself gives up. Unreadable timestamps count as fresh so
/// the sweep never removes a file it can't reason about.
fn is_stale(entry: &fs::DirEntry) -> bool {
    entry
        .metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .is_some_and(|age| age > DOWNLOAD_TIMEOUT)
}

/// Download the newest build for this channel and replace the running binary
/// in place. `force` reinstalls even when the versions already match.
pub async fn self_update(force: bool) -> Result<UpdateOutcome, String> {
    let update = check_for_update(CHECK_TIMEOUT).await?;
    if !update.is_newer() && !force {
        return Ok(UpdateOutcome::UpToDate {
            version: update.current,
        });
    }
    let url = update.url.clone().ok_or_else(|| {
        format!(
            "no {} build published for {}-{}",
            update.channel,
            std::env::consts::OS,
            std::env::consts::ARCH
        )
    })?;

    let exe = target_binary_path()?;
    clean_stale_files(&exe);
    ensure_writable(&exe)?;
    let dir = exe.parent().unwrap_or(Path::new("."));

    let pid = std::process::id();
    let archive = dir.join(format!("{STAGING_PREFIX}{pid}{}", archive_suffix(&url)));
    let staged = dir.join(format!("{STAGING_PREFIX}{pid}.bin"));
    let result = install(&url, update.sha256.as_deref(), &archive, &staged, &exe).await;
    let _ = fs::remove_file(&archive);
    let _ = fs::remove_file(&staged);
    result?;
    Ok(UpdateOutcome::Installed {
        from: update.current,
        to: update.latest,
        path: exe,
    })
}

/// Download, verify and swap in the new binary. Staging files are cleaned up
/// by the caller on both the success and failure paths.
async fn install(
    url: &str,
    sha256: Option<&str>,
    archive: &Path,
    staged: &Path,
    exe: &Path,
) -> Result<(), String> {
    let digest = download_to(url, archive).await?;
    if let Some(expected) = sha256 {
        if !expected.eq_ignore_ascii_case(&digest) {
            return Err(format!(
                "checksum mismatch for {url}: expected {expected}, got {digest}"
            ));
        }
    }
    extract_binary(archive, staged)?;
    verify_executable(staged)?;
    make_executable(staged)?;
    replace_binary(staged, exe)
}

fn archive_suffix(url: &str) -> &'static str {
    if url.ends_with(".zip") {
        ".zip"
    } else {
        ".tar.gz"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn nightly_build_numbers_compare_numerically() {
        assert_eq!(compare_versions("0.8.4-10", "0.8.4-9"), Ordering::Greater);
        assert_eq!(compare_versions("0.8.4-9", "0.8.4-10"), Ordering::Less);
        assert_eq!(compare_versions("0.8.4-9", "0.8.4-9"), Ordering::Equal);
        assert_eq!(compare_versions("0.9.0-1", "0.8.4-999"), Ordering::Greater);
        assert_eq!(compare_versions("v0.8.4", "0.8.4"), Ordering::Equal);
        // A plain release is older than any nightly cut from it.
        assert_eq!(compare_versions("0.8.4-1", "0.8.4"), Ordering::Greater);
    }

    fn update_with(latest: &str, current: &str) -> AvailableUpdate {
        AvailableUpdate {
            channel: "agent-nightly",
            current: current.to_string(),
            latest: latest.to_string(),
            url: None,
            sha256: None,
        }
    }

    #[test]
    fn only_strictly_newer_versions_trigger_an_update() {
        assert!(update_with("0.8.4-11", "0.8.4-10").is_newer());
        assert!(!update_with("0.8.4-10", "0.8.4-10").is_newer());
        // A rolled-back manifest must not offer a "new" older build.
        assert!(!update_with("0.8.4-9", "0.8.4-10").is_newer());
    }

    #[test]
    fn manifest_fields_are_read_per_platform() {
        let manifest: UpdateManifest = serde_json::from_value(serde_json::json!({
            "version": "0.8.4-12",
            "platforms": {
                platform_key().unwrap_or("linux-x86_64"): {
                    "url": "https://delta.jan.ai/agent-nightly/jan.tar.gz",
                    "sha256": "abc123"
                }
            }
        }))
        .unwrap();
        let update = read_update(&manifest, "agent-nightly");
        assert_eq!(update.latest, "0.8.4-12");
        if platform_key().is_some() {
            assert_eq!(
                update.url.as_deref(),
                Some("https://delta.jan.ai/agent-nightly/jan.tar.gz")
            );
            assert_eq!(update.sha256.as_deref(), Some("abc123"));
        }
    }

    #[test]
    fn missing_platform_entry_yields_no_url() {
        let manifest: UpdateManifest = serde_json::from_value(serde_json::json!({
            "version": "0.8.4-12",
            "platforms": { "solaris-sparc": { "url": "https://example.com/x" } }
        }))
        .unwrap();
        assert!(read_update(&manifest, "agent-nightly").url.is_none());
    }

    fn tar_gz_with(entry: &str, body: &[u8]) -> Vec<u8> {
        let mut header = tar::Header::new_gnu();
        header.set_size(body.len() as u64);
        header.set_mode(0o755);
        header.set_cksum();
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
            Vec::new(),
            flate2::Compression::fast(),
        ));
        builder.append_data(&mut header, entry, body).unwrap();
        builder.into_inner().unwrap().finish().unwrap()
    }

    #[test]
    fn extracts_the_binary_from_a_tarball() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("jan-agent-linux-x86_64-0.8.4-1.tar.gz");
        fs::write(&archive, tar_gz_with(BINARY_NAME, b"\x7fELF-payload")).unwrap();
        let dest = dir.path().join("out");
        extract_binary(&archive, &dest).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"\x7fELF-payload");
    }

    #[test]
    fn rejects_an_archive_without_the_binary() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("bad.tar.gz");
        fs::write(&archive, tar_gz_with("README.md", b"nope")).unwrap();
        let err = extract_binary(&archive, &dir.path().join("out")).unwrap_err();
        assert!(err.contains(BINARY_NAME), "{err}");
    }

    /// Published zips keep the binary at the root; tolerate a path prefix too,
    /// so a change to the packaging step can't silently break the updater.
    #[test]
    fn extracts_the_binary_from_a_zip_with_a_path_prefix() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("jan-agent-windows-x86_64-0.8.4-1.zip");
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file(
            format!("src-tauri/target/release/{BINARY_NAME}"),
            zip::write::FileOptions::default(),
        )
        .unwrap();
        zip.write_all(b"MZ-payload").unwrap();
        fs::write(&archive, zip.finish().unwrap().into_inner()).unwrap();
        let dest = dir.path().join("out");
        extract_binary(&archive, &dest).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"MZ-payload");
    }

    #[test]
    fn html_error_pages_are_not_installed() {
        let dir = tempfile::tempdir().unwrap();
        let bogus = dir.path().join("out");
        fs::write(&bogus, b"<!DOCTYPE html><html>404</html>").unwrap();
        assert!(verify_executable(&bogus).is_err());

        let truncated = dir.path().join("truncated");
        fs::write(&truncated, b"\x7f").unwrap();
        assert!(verify_executable(&truncated).is_err());
    }

    /// Leading bytes taken from the published 0.8.4-6 artifacts for each
    /// platform, so a header the real builds use can't be rejected.
    #[test]
    fn published_binaries_pass_the_magic_check() {
        let dir = tempfile::tempdir().unwrap();
        for (name, magic) in [
            ("linux", [0x7f, 0x45, 0x4c, 0x46]),   // ELF
            ("windows", [0x4d, 0x5a, 0x90, 0x00]), // PE
            ("macos", [0xca, 0xfe, 0xba, 0xbe]),   // Mach-O universal
            ("macos-thin", [0xcf, 0xfa, 0xed, 0xfe]),
        ] {
            let path = dir.path().join(name);
            fs::write(&path, magic).unwrap();
            verify_executable(&path).unwrap_or_else(|e| panic!("{name}: {e}"));
        }
    }

    #[test]
    fn replace_binary_swaps_the_file_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join(BINARY_NAME);
        let staged = dir.path().join(".staged");
        fs::write(&exe, b"old").unwrap();
        fs::write(&staged, b"new").unwrap();
        replace_binary(&staged, &exe).unwrap();
        assert_eq!(fs::read(&exe).unwrap(), b"new");
        assert!(!staged.exists());
    }

    /// Quitting the TUI mid-download cancels the install task, leaving staging
    /// files nothing cleans up; the next install sweeps them. A fresh one may
    /// belong to a download still running in another process, so it stays.
    #[test]
    fn stale_staging_files_are_swept_but_live_ones_are_kept() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join(BINARY_NAME);
        fs::write(&exe, b"old").unwrap();
        let stale = dir.path().join(format!("{STAGING_PREFIX}999.tar.gz"));
        let live = dir.path().join(format!("{STAGING_PREFIX}1000.tar.gz"));
        let unrelated = dir.path().join("keep-me.tar.gz");
        for path in [&stale, &live, &unrelated] {
            fs::write(path, b"x").unwrap();
        }
        let old = std::time::SystemTime::now() - (DOWNLOAD_TIMEOUT + Duration::from_secs(60));
        File::options()
            .write(true)
            .open(&stale)
            .unwrap()
            .set_modified(old)
            .unwrap();

        clean_stale_files(&exe);

        assert!(!stale.exists(), "an abandoned download must be removed");
        assert!(
            live.exists(),
            "a download still in flight must be left alone"
        );
        assert!(unrelated.exists());
        assert!(exe.exists(), "the binary itself is never swept");
    }

    #[test]
    fn unwritable_install_dir_is_rejected_before_downloading() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join(BINARY_NAME);
        fs::write(&exe, b"old").unwrap();
        ensure_writable(&exe).unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            // Running as root ignores the mode bits, so the check can't be tested there.
            if unsafe { libc::geteuid() } != 0 {
                fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o500)).unwrap();
                let err = ensure_writable(&exe).unwrap_err();
                fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
                assert!(err.contains("not writable"), "{err}");
            }
        }
    }
}
