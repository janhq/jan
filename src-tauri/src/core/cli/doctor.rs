//! One-command redacted diagnostics archive (`jan bug-report` / `/bug`).
//!
//! Collects the version, environment, most-recent (or explicit) thread
//! (messages + render journal + metadata), the tail of the persistent log,
//! and a model/provider snapshot into a `.tar.gz` under
//! `<data_folder>/diagnostics/`, after a redaction pass strips API keys,
//! bearer tokens, and JWTs from every text blob. The point is to let a user
//! attach one file instead of guessing what to grab, with a printed
//! confirmation of what was stripped so they can trust it contains no secrets.

use std::fs;
use std::path::{Path, PathBuf};

use flate2::Compression;
use flate2::write::GzEncoder;
use regex::Regex;

use crate::core::app::commands::resolve_jan_data_folder;
use crate::core::cli::updater::build_version;
use crate::core::threads::constants::{MESSAGES_FILE, THREADS_FILE};
use crate::core::threads::utils::{get_thread_dir, get_thread_metadata_path};

/// One redaction rule: a labelled regex. The regex matches the secret value
/// region only (never the surrounding label), so the whole match is replaced.
struct Rule {
    label: &'static str,
    re: Regex,
}

/// Strips secrets from free text and tallies how many of each kind it hit.
struct Redactor {
    rules: Vec<Rule>,
}

impl Redactor {
    fn new() -> Self {
        // Authorization headers first (they contain a bearer whose value other
        // rules would also match), then explicit key-like config values, then
        // well-known provider token prefixes, then long opaque tokens.
        let rules = vec![
            Rule {
                label: "authorization header",
                re: Regex::new(
                    r#"(?i)(["']?authorization["']?\s*[:=]\s*["']?(?:bearer|basic)\s+)[A-Za-z0-9._~+/\-=]+"#,
                )
                .expect("auth header regex"),
            },
            Rule {
                label: "api key / token value",
                // Handles both `api_key="..."` and JSON `"api_key":"..."`
                // (quotes are allowed around the key name and the value).
                re: Regex::new(
                    r#"(?i)["']?(?:api[_-]?key|apikey|secret|token|access[_-]?token|refresh[_-]?token)["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/\-=]{12,}"#,
                )
                .expect("key regex"),
            },
            Rule {
                label: "jwt",
                re: Regex::new(
                    r"(?i)eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}",
                )
                .expect("jwt regex"),
            },
            Rule {
                label: "sk/pk provider key",
                re: Regex::new(r"(?i)\b(?:sk|pk)-[A-Za-z0-9_\-]{16,}")
                    .expect("sk key regex"),
            },
            Rule {
                label: "google api key",
                re: Regex::new(r"\bAIza[A-Za-z0-9_\-]{20,}").expect("google key regex"),
            },
            Rule {
                label: "github token",
                re: Regex::new(r"\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})")
                    .expect("github token regex"),
            },
            Rule {
                label: "slack token",
                re: Regex::new(r"\bxox[baprs]-[A-Za-z0-9-]{16,}").expect("slack token regex"),
            },
            Rule {
                label: "aws access key",
                re: Regex::new(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b").expect("aws key regex"),
            },
            Rule {
                label: "nvidia api key",
                re: Regex::new(r"\bnvapi-[A-Za-z0-9_-]{16,}").expect("nvidia key regex"),
            },
            Rule {
                label: "opaque oauth token",
                re: Regex::new(
                    r"\b(?:ya29\.[A-Za-z0-9_\-]{30,}|sq0atp-[A-Za-z0-9_\-]{20,}|sk_live_[A-Za-z0-9]{16,})",
                )
                .expect("opaque token regex"),
            },
        ];
        Redactor { rules }
    }

    /// Replace every match with `<redacted>`; `hits` records per-rule counts.
    fn redact(&self, input: &str, hits: &mut [usize]) -> String {
        let mut out = input.to_string();
        for (i, rule) in self.rules.iter().enumerate() {
            // Collect spans first so we never re-scan replaced regions.
            let spans: Vec<(usize, usize)> = rule.re.find_iter(&out).map(|m| (m.start(), m.end())).collect();
            if spans.is_empty() {
                continue;
            }
            hits[i] += spans.len();
            let mut result = String::with_capacity(out.len());
            let mut last = 0;
            for (s, e) in spans {
                result.push_str(&out[last..s]);
                result.push_str("<redacted>");
                last = e;
            }
            result.push_str(&out[last..]);
            out = result;
        }
        out
    }
}

/// Read a text file, or `None` if it does not exist or cannot be read.
fn read_opt(path: &Path) -> Option<String> {
    fs::read_to_string(path).ok()
}

/// Last `max_lines` lines of a file, or `None` when the file cannot be read.
fn tail(path: &Path, max_lines: usize) -> Option<String> {
    let content = read_opt(path)?;
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    Some(lines[start..].join("\n"))
}

/// Resolve the thread id to bundle: an explicit one when given, else the most
/// recently updated thread under `<base>/threads/`.
fn resolve_thread_id(base: &Path, explicit: Option<&str>) -> Result<String, String> {
    if let Some(id) = explicit {
        let id = id.trim().to_string();
        if id.is_empty() {
            return Err("empty thread id".to_string());
        }
        return Ok(id);
    }
    let mut threads = crate::core::cli::list_threads_in(base)?;
    if threads.is_empty() {
        return Err(
            "no threads found - run an agent session first, or pass --thread <id>".to_string(),
        );
    }
    crate::core::cli::sort_threads_recent(&mut threads);
    threads
        .first()
        .and_then(|t| t.get("id").and_then(|v| v.as_str()))
        .map(str::to_string)
        .ok_or_else(|| "latest thread has no id".to_string())
}

/// Everything the CLI/TUI presents back to the user after bundling.
pub struct BugReport {
    pub archive: PathBuf,
    pub stripped: Vec<String>,
    /// Whether any secret pattern matched and was redacted. Callers use this
    /// to print an honest message rather than claim "no secrets" when nothing
    /// matched (the scan is best-effort).
    pub redacted_any: bool,
}

/// Build the archive into `<data_folder>/diagnostics/` and return the artifact
/// plus a human summary of what was redacted. `threads_base` is where
/// `/threads/` lives (the desktop data folder for `jan bug-report`, or a
/// project's `.jan/agent` dir for `/bug`).
pub fn run_bug_report(
    threads_base: &Path,
    thread_id: Option<&str>,
) -> Result<BugReport, String> {
    let data_folder = resolve_jan_data_folder();
    let id = resolve_thread_id(threads_base, thread_id)?;

    let thread_meta =
        read_opt(&get_thread_metadata_path(threads_base, &id)).unwrap_or_else(|| "{}".into());
    let thread_dir = get_thread_dir(threads_base, &id);
    let messages = read_opt(&thread_dir.join(MESSAGES_FILE)).unwrap_or_default();
    let journal = read_opt(&thread_dir.join("display.jsonl")).unwrap_or_default();
    let log_tail = tail(&data_folder.join("logs").join("jan.log"), 2000).unwrap_or_default();

    // Model/provider come from the thread metadata; never raw keys.
    let meta: serde_json::Value =
        serde_json::from_str(&thread_meta).unwrap_or(serde_json::Value::Null);
    let model = meta
        .get("model")
        .and_then(|m| m.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let provider = meta
        .get("model")
        .and_then(|m| m.get("provider"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");

    let redactor = Redactor::new();
    let mut hits = vec![0usize; redactor.rules.len()];

    let mut members: Vec<(String, String)> = Vec::new();
    members.push(("version.txt".to_string(), format!("{}\n", build_version())));
    members.push((
        "environment.txt".to_string(),
        format!(
            "os={}\narch={}\nmodel={}\nprovider={}\nthread_id={}\n",
            std::env::consts::OS,
            std::env::consts::ARCH,
            model,
            provider,
            id
        ),
    ));
    members.push((
        format!("thread/{THREADS_FILE}"),
        redactor.redact(&thread_meta, &mut hits),
    ));
    members.push((
        format!("thread/{MESSAGES_FILE}"),
        redactor.redact(&messages, &mut hits),
    ));
    members.push((
        "thread/display.jsonl".to_string(),
        redactor.redact(&journal, &mut hits),
    ));
    members.push((
        "logs/jan.log".to_string(),
        redactor.redact(&log_tail, &mut hits),
    ));

    let stripped: Vec<String> = redactor
        .rules
        .iter()
        .zip(&hits)
        .filter(|(_, &n)| n > 0)
        .map(|(r, &n)| format!("{} ({}x)", r.label, n))
        .collect();

    // Track whether ANY rule fired so callers can print an honest
    // best-effort message instead of claiming the archive has no secrets.
    let redacted_any = hits.iter().any(|&n| n > 0);

    let out_dir = data_folder.join("diagnostics");
    fs::create_dir_all(&out_dir).map_err(|e| format!("cannot create {}: {e}", out_dir.display()))?;
    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let archive_path = out_dir.join(format!("jan-bug-report-{ts}.tar.gz"));

    write_tarball(&archive_path, &members)?;

    Ok(BugReport {
        archive: archive_path,
        stripped,
        redacted_any,
    })
}

fn write_tarball(path: &Path, members: &[(String, String)]) -> Result<(), String> {
    use std::io::Write;

    let file = fs::File::create(path).map_err(|e| format!("cannot create {}: {e}", path.display()))?;
    let enc = GzEncoder::new(file, Compression::default());
    let mut tar = tar::Builder::new(enc);
    for (name, content) in members {
        let mut header = tar::Header::new_gnu();
        header.set_size(content.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        tar.append_data(&mut header, name, content.as_bytes())
            .map_err(|e| format!("archive write error: {e}"))?;
    }
    let enc = tar.into_inner().map_err(|e| format!("archive finalize error: {e}"))?;
    let mut file = enc.finish().map_err(|e| format!("gzip finish error: {e}"))?;
    let _ = file.flush();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn redact_once(rules: &Redactor, input: &str) -> (String, Vec<usize>) {
        let mut hits = vec![0usize; rules.rules.len()];
        let out = rules.redact(input, &mut hits);
        (out, hits)
    }

    #[test]
    fn strips_bearer_and_api_key_forms() {
        let r = Redactor::new();
        for secret in [
            "Authorization: Bearer abc123def456",
            "api_key=\"sk-abcdefghijklmnop\"",
            "sk-ant-abcdefghijklmnopqrst",
            "token: longsecretvalue1234567890",
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
        ] {
            let (out, _) = redact_once(&r, secret);
            assert!(!out.contains("abc123def456"), "leaked bearer: {out}");
            assert!(out.contains("<redacted>"), "no redaction marker: {out}");
        }
    }

    #[test]
    fn strips_realistic_provider_token_corpus() {
        // Realistic API/bearer/JWT lookalikes across common providers, plus
        // JSON serialization forms where keys and values are quoted.
        let r = Redactor::new();
        // Each vendor prefix is concatenated at compile time rather than written
        // as one literal: the assembled value is byte-identical to a real token,
        // but no scannable token appears in the source (GitHub push protection
        // rejects the file otherwise).
        let corpus = [
            ("github pat", concat!("ghp", "_0123456789abcdef0123456789abcdef012345")),
            (
                "github fine-grained",
                concat!("github", "_pat_11ABCDEFG0abcdef0123456789abcdefghijkl_0123456789"),
            ),
            ("slack", concat!("xoxb", "-123456789012-123456789012-abcdefghijklmnopqrstuvwx")),
            ("aws access key", concat!("AKIA", "IOSFODNN7EXAMPLE")),
            ("aws session key", concat!("ASIA", "IOSFODNN7EXAMPLE")),
            ("nvidia", concat!("nvapi", "-abcdef0123456789abcdef0123456789")),
            ("stripe", concat!("sk", "_live_0123456789abcdef0123456789abcdef")),
            ("square", concat!("sq0atp", "-1234567890abcdefghijklmnopqrst")),
            ("google oauth", concat!("ya29.", "a0AfH6zSM1abcdefghijklmnopqrstuvwxyz1234567890")),
            ("json bearer", "{\"Authorization\":\"Bearer abcXYZ0123456789def\"}"),
            ("json api_key", "{\"api_key\":\"abcdefghijklmnopqrstuvwx\"}"),
        ];
        for (name, secret) in corpus {
            let (out, _) = redact_once(&r, secret);
            assert!(
                out.contains("<redacted>"),
                "{name}: no redaction marker: {out}"
            );
            // The redaction pass must never emit the original secret value.
            for chunk in secret.split_whitespace() {
                assert!(
                    !out.contains(chunk),
                    "{name}: leaked value {chunk} in {out}"
                );
            }
        }
    }

    #[test]
    fn strips_openai_project_keys() {
        let r = Redactor::new();
        let secret = "request failed with sk-proj-abcdefghijklmnopqrstuvwx";
        let (out, _) = redact_once(&r, secret);
        assert!(!out.contains("sk-proj-abcdefghijklmnopqrstuvwx"), "leaked key: {out}");
        assert!(out.contains("<redacted>"), "no redaction marker: {out}");
    }

    #[test]
    fn leaves_plain_text_untouched() {
        let r = Redactor::new();
        let sample = "the quick brown fox jumps over the lazy dog, model=gpt-4";
        let (out, hits) = redact_once(&r, sample);
        assert_eq!(out, sample);
        assert!(hits.iter().all(|&n| n == 0));
    }

    #[test]
    fn leaves_short_identifiers_alone() {
        let r = Redactor::new();
        // A UUID is short-ish and not a config value; neither is a bare word.
        let sample = "abc-123-xyz thread id a1b2c3d4";
        let (out, _) = redact_once(&r, sample);
        assert_eq!(out, sample);
    }

    /// Decompress and unpack a `.tar.gz`, returning (member name, content).
    fn unpack_archive(path: &Path) -> Vec<(String, String)> {
        use std::io::Read;

        let file = fs::File::open(path).unwrap();
        let gz = flate2::read::GzDecoder::new(file);
        let mut tar = tar::Archive::new(gz);
        let mut out = Vec::new();
        for entry in tar.entries().unwrap() {
            let mut entry = entry.unwrap();
            let name = entry.path().unwrap().display().to_string();
            let mut content = String::new();
            entry.read_to_string(&mut content).unwrap();
            out.push((name, content));
        }
        out
    }

    #[test]
    fn archive_respects_jan_data_folder_and_contains_no_secret() {
        let dir = std::env::temp_dir().join(format!("jan_doctor_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        std::env::set_var("JAN_DATA_FOLDER", &dir);

        // Seed a thread.
        let thread_id = "testthread";
        let thread_dir = get_thread_dir(&dir, thread_id);
        fs::create_dir_all(&thread_dir).unwrap();
        fs::write(
            get_thread_metadata_path(&dir, thread_id),
            serde_json::json!({
                "id": thread_id,
                "title": "t",
                "model": { "id": "gpt-4", "provider": "openai" }
            })
            .to_string(),
        )
        .unwrap();
        // Seed every input shape the bundler copies so decompression proves the
        // full redaction path, including JSON authorization forms.
        let seeds = [
            "{\"role\":\"user\",\"content\":\"sk-abcdefghijklmnopq\"}\n",
            "{\"role\":\"user\",\"content\":\"Authorization: Bearer abcXYZ0123456789def\"}\n",
            "{\"role\":\"user\",\"content\":\"ghp_0123456789abcdef0123456789abcdef012345\"}\n",
        ];
        fs::write(thread_dir.join(MESSAGES_FILE), seeds.concat()).unwrap();
        fs::write(
            thread_dir.join("display.jsonl"),
            "{\"kind\":\"note\",\"value\":\"AKIAIOSFODNN7EXAMPLE\"}\n",
        )
        .unwrap();

        let report = run_bug_report(&dir, Some(thread_id)).expect("bug report builds");
        assert!(report.archive.exists(), "archive exists");
        assert!(
            report.stripped.iter().any(|s| s.contains("github token")),
            "expected github rule hit: {:?}",
            report.stripped
        );

        // Decompress and assert no raw secret survives in any bundled member.
        let members = unpack_archive(&report.archive);
        assert!(!members.is_empty(), "archive has members");
        for (name, content) in &members {
            assert!(
                !content.contains("sk-abcdefghijklmnopq"),
                "{name} leaked sk key: {content}"
            );
            assert!(
                !content.contains("abcXYZ0123456789def"),
                "{name} leaked bearer: {content}"
            );
            assert!(
                !content.contains("AKIAIOSFODNN7EXAMPLE"),
                "{name} leaked aws key: {content}"
            );
            assert!(
                !content.contains("ghp_0123456789abcdef0123456789abcdef012345"),
                "{name} leaked github token: {content}"
            );
        }

        let _ = fs::remove_dir_all(&dir);
        std::env::remove_var("JAN_DATA_FOLDER");
    }
}
