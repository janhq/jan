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
    #[cfg(target_os = "macos")]
    let (program, args): (&str, &[&str]) = ("open", &[]);
    #[cfg(target_os = "windows")]
    let (program, args): (&str, &[&str]) = ("cmd", &["/C", "start", ""]);
    #[cfg(all(unix, not(target_os = "macos")))]
    let (program, args): (&str, &[&str]) = ("xdg-open", &[]);

    #[cfg(all(unix, not(target_os = "macos")))]
    if !has_display() {
        return Err("no graphical session detected".to_string());
    }

    std::process::Command::new(program)
        .args(args)
        .arg(url)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("could not launch {program}: {e}"))
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
