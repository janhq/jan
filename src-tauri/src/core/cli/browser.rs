//! Best-effort browser launch, shared by `/login` (Tokamak sign-in) and the
//! `/mcp` OAuth flow.
//!
//! Every caller prints the URL as well, because a spawned launcher reports
//! nothing about whether a page actually appeared: `Err` here is a reason to
//! *say* "open this yourself", never a reason to abandon the flow.

/// Hand `url` to the platform's opener. `Err` carries a reason worth showing
/// the user, not a failure to recover from.
pub fn open(url: &str) -> Result<(), String> {
    if cfg!(test) {
        // A test run must never take over the developer's browser.
        return Err("browser launch is disabled under test".to_string());
    }
    launch(url)
}

fn launch(url: &str) -> Result<(), String> {
    let mut command = opener_command(url)?;

    #[cfg(all(unix, not(target_os = "macos")))]
    if !has_display() {
        return Err("no graphical session detected".to_string());
    }

    let program = command.get_program().to_owned();
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("could not launch {}: {e}", program.to_string_lossy()))
}

/// The platform's opener for `url`, ready to spawn, or `Err` when `url` is
/// not an http(s) URL. URLs come from remote servers (an MCP server's OAuth
/// authorization URL, sign-in flows), so only web pages are opened, and never
/// through a shell.
pub(crate) fn opener_command(url: &str) -> Result<std::process::Command, String> {
    let url = web_url(url)?;
    #[cfg(target_os = "macos")]
    let opener = Opener::Open;
    #[cfg(target_os = "windows")]
    let opener = Opener::Rundll32;
    #[cfg(all(unix, not(target_os = "macos")))]
    let opener = Opener::XdgOpen;
    let (program, args) = opener_argv(opener, &url);
    let mut command = std::process::Command::new(program);
    command.args(args);
    Ok(command)
}

/// Parse `url` and accept it only as an absolute http(s) URL with a host.
fn web_url(url: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(url.trim()).map_err(|_| "not a valid URL".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none_or(str::is_empty)
    {
        return Err(format!(
            "refusing to open a {}: URL; only http and https pages are opened",
            parsed.scheme()
        ));
    }
    Ok(parsed)
}

#[derive(Clone, Copy, Debug)]
#[cfg_attr(not(test), allow(dead_code))]
enum Opener {
    /// macOS `open`.
    Open,
    /// Windows: `rundll32.exe url.dll,FileProtocolHandler <url>` from
    /// System32, which hands the URL to the default browser without `cmd.exe`
    /// (whose `start` would interpret `&`, `|` and `^` in it).
    Rundll32,
    /// `xdg-open` on Linux and the BSDs.
    XdgOpen,
}

/// Program and arguments for `opener`. The URL is the re-serialized form from
/// the `url` crate, so it carries no spaces or quotes, and it is the last
/// argument on its own.
fn opener_argv(opener: Opener, url: &url::Url) -> (std::path::PathBuf, Vec<String>) {
    let url = url.as_str().to_string();
    match opener {
        Opener::Open => ("/usr/bin/open".into(), vec![url]),
        Opener::Rundll32 => (
            jan_utils::windows_system_tool("rundll32.exe"),
            vec!["url.dll,FileProtocolHandler".to_string(), url],
        ),
        Opener::XdgOpen => ("xdg-open".into(), vec![url]),
    }
}

/// Whether a Linux/BSD session has a display server to open a browser on. Over
/// SSH or in a container `xdg-open` would either fail noisily or block, so the
/// caller falls back to printing the URL.
#[cfg(all(unix, not(target_os = "macos")))]
fn has_display() -> bool {
    ["WAYLAND_DISPLAY", "DISPLAY"]
        .iter()
        .any(|var| std::env::var_os(var).is_some_and(|v| !v.is_empty()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_http_and_https_urls_are_opened() {
        for good in [
            "https://example.com/oauth/authorize?a=1&b=2|3^4",
            "http://127.0.0.1:1455/callback",
            "HTTPS://Example.com",
        ] {
            assert!(web_url(good).is_ok(), "{good}");
            assert!(opener_command(good).is_ok(), "{good}");
        }
        for bad in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "calc.exe",
            "C:\\Windows\\System32\\calc.exe",
            "\\\\server\\share\\x.exe",
            "ms-settings:",
            "smb://host/share",
            "data:text/html,hi",
            "https://",
            "",
            "-a Calculator",
        ] {
            assert!(web_url(bad).is_err(), "{bad}");
            assert!(opener_command(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn opener_argv_passes_the_url_as_one_shell_free_argument() {
        let url = web_url("https://example.com/a b?x=\"1\"&y=2|3^4").unwrap();
        let s = url.as_str();
        assert!(!s.contains([' ', '"']), "{s}");

        let (program, args) = opener_argv(Opener::Rundll32, &url);
        assert!(program.to_string_lossy().ends_with("\\System32\\rundll32.exe"));
        assert_eq!(args, ["url.dll,FileProtocolHandler", s]);
        assert!(!program.to_string_lossy().to_ascii_lowercase().contains("cmd"));

        let (program, args) = opener_argv(Opener::Open, &url);
        assert_eq!(program, std::path::PathBuf::from("/usr/bin/open"));
        assert_eq!(args, [s]);

        let (program, args) = opener_argv(Opener::XdgOpen, &url);
        assert_eq!(program, std::path::PathBuf::from("xdg-open"));
        assert_eq!(args, [s]);
    }
}
