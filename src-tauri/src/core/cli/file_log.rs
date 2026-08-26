//! Persistent structured log file beside the stderr logger.
//!
//! `env_logger` is a single-sink, single-level logger, so it cannot write the
//! same records to stderr at one verbosity and to a file at another. This
//! module replaces it with a [`DualLogger`] that keeps `env_logger`'s exact
//! stderr behavior (style, module paths, `RUST_LOG` filtering) and additionally
//! appends every `info`-and-above record to a rotating plain-ASCII file under
//! the Jan data folder. The file default is more verbose than the `warn`
//! stderr default so a froze or misbehaving agent run leaves a trail on disk
//! without the user ever having to pass `-v`.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use log::{LevelFilter, Log, Metadata, Record};

/// What the file always captures, on top of the `warn` stderr default.
const FILE_LEVEL: LevelFilter = LevelFilter::Info;
/// Rotate once the active segment crosses this size.
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
/// Backup segments kept beside the active file (`jan.log.1` .. `jan.log.N`).
const KEEP_SEGMENTS: u32 = 3;
const LOG_FILE: &str = "jan.log";

/// The segment path for a 1-based backup number; `0` means the active file.
fn segment_path(base: &Path, k: u32) -> PathBuf {
    if k == 0 {
        base.to_path_buf()
    } else {
        base.with_file_name(format!("{LOG_FILE}.{k}"))
    }
}

/// Append-only handle to the active log file with size-based rotation.
struct FileLog {
    path: PathBuf,
    file: Mutex<File>,
    len: AtomicU64,
}

impl FileLog {
    /// Open the active file for appending. Returns `None` (degrading to
    /// stderr-only) when the log cannot be opened -- a diagnostics trail is
    /// worth having but never worth aborting the run over.
    fn new(path: PathBuf) -> Option<Self> {
        std::fs::create_dir_all(path.parent()?).ok()?;
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .ok()?;
        let len = file.metadata().map(|m| m.len()).unwrap_or(0);
        Some(FileLog {
            path,
            file: Mutex::new(file),
            len: AtomicU64::new(len),
        })
    }

    fn write(&self, record: &Record) {
        let line = format_line(record);
        let mut f = match self.file.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        if f.write_all(line.as_bytes()).is_err() {
            return;
        }
        let new_len = self.len.fetch_add(line.len() as u64, Ordering::Relaxed)
            + line.len() as u64;
        if new_len >= MAX_LOG_BYTES {
            // Drop the guard (so the handle can be rotated on Windows too)
            // before shifting the segments and reopening a fresh active file.
            drop(f);
            self.rotate();
            if let Ok(nf) = OpenOptions::new().create(true).append(true).open(&self.path) {
                if let Ok(mut g) = self.file.lock() {
                    *g = nf;
                }
            }
        }
    }

    fn rotate(&self) {
        for k in (2..=KEEP_SEGMENTS).rev() {
            let _ = fs::rename(segment_path(&self.path, k - 1), segment_path(&self.path, k));
        }
        let _ = fs::rename(&self.path, segment_path(&self.path, 1));
        self.len.store(0, Ordering::Relaxed);
    }

    fn flush(&self) {
        if let Ok(mut f) = self.file.lock() {
            let _ = f.flush();
        }
    }
}

/// One line per record, plain ASCII, timestamped. Never colored; the file is
/// meant to be read in an editor, piped, or bundled, not rendered live.
fn format_line(record: &Record) -> String {
    let ts = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%.3f");
    format!(
        "{ts} {:<5} [{}] {}\n",
        record.level().as_str(),
        record.target(),
        record.args()
    )
}

/// Routes every record to stderr through `env_logger` (unchanged behavior)
/// and, in parallel, to the rotating ASCII file. `enabled`/`log` consult the
/// per-sink paths so the file sees `info` even when stderr is only `warn`.
struct DualLogger {
    stderr: env_logger::Logger,
    file: Option<FileLog>,
}

impl Log for DualLogger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        // Either sink wants the record: stderr's own module/level filter (which
        // may reach debug/trace via RUST_LOG), or the file when the record is
        // at or under the file ceiling. Nothing above both probes is wanted.
        self.stderr.enabled(metadata)
            || (self.file.is_some() && metadata.level() <= FILE_LEVEL)
    }

    fn log(&self, record: &Record) {
        // The file only captures records at or under FILE_LEVEL (info), even
        // when stderr goes deeper via RUST_LOG=debug/trace.
        if self.file.is_some() && record.level() <= FILE_LEVEL {
            if let Some(f) = &self.file {
                f.write(record);
            }
        }
        // stderr keeps env_logger's exact behavior, including debug/trace when
        // RUST_LOG asks for them (env_logger filters internally).
        self.stderr.log(record);
    }

    fn flush(&self) {
        self.stderr.flush();
        if let Some(f) = &self.file {
            f.flush();
        }
    }
}
/// Install the dual logger as the process-wide `log` backend. `verbose`
/// mirrors the old `-v/--verbose` flag: it raises the stderr threshold to
/// `info`; the file always captures `info` regardless. `data_folder` is where
/// `logs/jan.log` lives (resolved via `JAN_DATA_FOLDER` for testability).
pub fn init(data_folder: PathBuf, verbose: bool) {
    let default = if verbose { "info" } else { "warn" };
    let stderr = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or(default))
        .build();
    let file = FileLog::new(data_folder.join("logs").join(LOG_FILE));

    // The global gate must admit everything the deepest sink may want: stderr
    // can go to debug/trace via RUST_LOG, while the file self-limits to info.
    // Each sink filters independently, so there is no single Info ceiling.
    let _ = log::set_boxed_logger(Box::new(DualLogger { stderr, file }));
    log::set_max_level(LevelFilter::Trace);
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_log_writes_info_records_with_timestamp() {
        let dir = std::env::temp_dir().join(format!("jan_file_log_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("logs")).unwrap();
        let log = FileLog::new(dir.join("logs").join(LOG_FILE)).expect("opens log");
        let record = Record::builder()
            .args(format_args!("hello {} {}", 1, 2))
            .level(log::Level::Info)
            .target(module_path!())
            .build();
        log.write(&record);
        log.flush();

        let content = fs::read_to_string(dir.join("logs").join(LOG_FILE)).unwrap();
        assert!(content.contains("hello 1 2"), "content: {content}");
        assert!(content.contains("INFO"), "level label: {content}");
        assert!(content.starts_with("20"), "timestamp leads: {content}");

        let _ = fs::remove_dir_all(&dir);
    }

    fn metadata(level: log::Level) -> log::Metadata<'static> {
        log::Metadata::builder().level(level).target(module_path!()).build()
    }

    #[test]
    fn dual_logger_delegates_stderr_verbosity_but_caps_file_at_info() {
        let dir = std::env::temp_dir().join(format!("jan_dual_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("logs")).unwrap();

        // stderr at trace (the deepest RUST_LOG can ask for) must still report
        // debug/trace as enabled: there is no global info ceiling anymore.
        let deep_stderr = env_logger::Builder::new()
            .filter_level(LevelFilter::Trace)
            .build();
        let dual = DualLogger {
            stderr: deep_stderr,
            file: Some(FileLog::new(dir.join("logs").join(LOG_FILE)).expect("opens log")),
        };
        assert!(
            dual.enabled(&metadata(log::Level::Debug)),
            "debug must reach stderr even though the file caps at info"
        );
        assert!(
            dual.enabled(&metadata(log::Level::Trace)),
            "trace must reach stderr even though the file caps at info"
        );

        // Info reaches the file; debug/trace must never be written to it.
        // (literal format_args! produce 'static records we can borrow freely)
        let info = log::Record::builder()
            .args(format_args!("info line"))
            .level(log::Level::Info)
            .target(module_path!())
            .build();
        let debug = log::Record::builder()
            .args(format_args!("debug line"))
            .level(log::Level::Debug)
            .target(module_path!())
            .build();
        let trace = log::Record::builder()
            .args(format_args!("trace line"))
            .level(log::Level::Trace)
            .target(module_path!())
            .build();
        dual.log(&info);
        dual.log(&debug);
        dual.log(&trace);
        dual.flush();

        let content = fs::read_to_string(dir.join("logs").join(LOG_FILE)).unwrap();
        assert!(content.contains("info line"), "info written to file: {content}");
        assert!(!content.contains("debug line"), "debug leaked to file: {content}");
        assert!(!content.contains("trace line"), "trace leaked to file: {content}");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn dual_logger_file_does_not_broaden_a_warn_stderr() {
        let dir = std::env::temp_dir().join(format!("jan_dual_warn_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("logs")).unwrap();

        // stderr at warn (the default). The file still wants info, but a debug
        // record must NOT be reported enabled just because a file exists.
        let warn_stderr = env_logger::Builder::new()
            .filter_level(LevelFilter::Warn)
            .build();
        let dual = DualLogger {
            stderr: warn_stderr,
            file: Some(FileLog::new(dir.join("logs").join(LOG_FILE)).expect("opens log")),
        };
        assert!(
            dual.enabled(&metadata(log::Level::Info)),
            "info enabled for the file even when stderr is warn"
        );
        assert!(
            !dual.enabled(&metadata(log::Level::Debug)),
            "debug must not be enabled when stderr is warn and file caps at info"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn init_raises_global_gate_to_trace_not_info() {
        let dir = std::env::temp_dir().join(format!("jan_init_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("logs")).unwrap();
        init(dir.clone(), false);
        // The global gate must admit debug/trace so RUST_LOG still works over
        // stderr; the file ceiling is enforced by DualLogger, not globally.
        assert!(
            log::max_level() >= LevelFilter::Debug,
            "global max_level must not cap at info, got {:?}",
            log::max_level()
        );
        let _ = fs::remove_dir_all(&dir);
    }
}

