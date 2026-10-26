//! Keeps every app webview on the app's own pages.
//!
//! The windows render content the app does not control (model output, tool
//! results, previews), so a link or a script can ask a frame to leave the
//! bundled frontend. Any navigation to a URL that is not one of the app's own
//! origins is cancelled; an `http(s)` one is handed to the system browser
//! instead, which is what a user clicking such a link expects.
//!
//! Installed as a plugin so the hook covers every webview, including the ones
//! the frontend creates at runtime (log viewer, system monitor), not just the
//! main window from the config.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime, Url};
use tauri_plugin_opener::OpenerExt;

/// Hosts the app's own content is served from on Windows and Android, where
/// custom schemes are spelled `http(s)://<scheme>.localhost`.
const APP_HOSTS: &[&str] = &["tauri.localhost", "preview.localhost"];

/// [`APP_HOSTS`] minus `preview.localhost`, for Windows. WebView2's
/// `NavigationStarting`, the only event wry hooks there, fires for main-frame
/// navigations alone (subframes raise `FrameNavigationStarting`), so the preview
/// iframes never reach this guard, and a window's main frame has no reason to
/// show a preview document.
const MAIN_FRAME_ONLY_APP_HOSTS: &[&str] = &["tauri.localhost"];

/// The `*.localhost` hosts this platform serves the app from. Mirrors Tauri's
/// own `tauri_protocol_url`: only Windows and Android use them, and elsewhere
/// they are ordinary network names and not the app.
const LOCALHOST_APP_HOSTS: &[&str] = if cfg!(windows) {
    MAIN_FRAME_ONLY_APP_HOSTS
} else if cfg!(target_os = "android") {
    APP_HOSTS
} else {
    &[]
};

/// Custom schemes the app's frames may load on macOS, Linux and iOS. `asset:`
/// and `ipc:` are deliberately absent: they serve files and IPC responses, and
/// no window or frame is ever meant to *navigate* to them.
const APP_SCHEMES: &[&str] = &["tauri", "preview"];

/// Whether a navigation to `url` stays on the app's own content.
///
/// `dev_url` is the configured `devUrl`, and only passed in dev builds, where
/// the frontend is served from it.
///
/// The webview asks for subframe navigations too on macOS and Linux, so the
/// HTML preview frames (`about:srcdoc`, the `preview:` scheme) must pass.
pub(crate) fn is_app_url(url: &Url, dev_url: Option<&Url>) -> bool {
    is_app_url_on(url, dev_url, LOCALHOST_APP_HOSTS)
}

/// [`is_app_url`] for a platform that serves custom schemes from
/// `localhost_hosts`, so every platform's case can be tested on any host.
fn is_app_url_on(url: &Url, dev_url: Option<&Url>, localhost_hosts: &[&str]) -> bool {
    match url.scheme() {
        s if APP_SCHEMES.contains(&s) => url.host_str() == Some("localhost"),
        "about" => matches!(url.path(), "blank" | "srcdoc"),
        // A blob the app itself minted (e.g. a CSV export) carries the
        // creator's origin inside. One from an opaque-origin frame says `null`,
        // which names no origin at all, so it is refused.
        "blob" => Url::parse(url.path())
            .map(|inner| {
                inner.scheme() != "blob" && is_app_url_on(&inner, dev_url, localhost_hosts)
            })
            .unwrap_or(false),
        "http" | "https" => {
            url.host_str().is_some_and(|h| localhost_hosts.contains(&h))
                || dev_url.is_some_and(|dev| same_origin(url, dev))
        }
        _ => false,
    }
}

fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme()
        && a.host_str() == b.host_str()
        && a.port_or_known_default() == b.port_or_known_default()
}

/// Whether a refused navigation should open in the system browser.
pub(crate) fn opens_externally(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
}

/// At most one hand-off per this window. A refused navigation is normally a
/// click, but a script in a preview frame can retry one in a loop, and each try
/// would otherwise open another browser tab.
const HANDOFF_INTERVAL: Duration = Duration::from_secs(1);

fn handoff_allowed(last: &Mutex<Option<Instant>>, now: Instant) -> bool {
    let mut last = last.lock().unwrap_or_else(|e| e.into_inner());
    match *last {
        Some(prev) if now.saturating_duration_since(prev) < HANDOFF_INTERVAL => false,
        _ => {
            *last = Some(now);
            true
        }
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    static LAST_HANDOFF: Mutex<Option<Instant>> = Mutex::new(None);

    Builder::new("navigation-guard")
        .on_navigation(|webview, url| {
            let dev_url = if tauri::is_dev() {
                webview.config().build.dev_url.clone()
            } else {
                None
            };
            if is_app_url(url, dev_url.as_ref()) {
                return true;
            }
            log::warn!(
                "Blocked navigation of webview '{}' to {}",
                webview.label(),
                url
            );
            if opens_externally(url) && handoff_allowed(&LAST_HANDOFF, Instant::now()) {
                if let Err(e) = webview.opener().open_url(url.as_str(), None::<&str>) {
                    log::error!("Failed to open {url} in the system browser: {e}");
                }
            }
            false
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn app_origins_are_allowed() {
        for ok in [
            "tauri://localhost/",
            "tauri://localhost/threads/abc?x=1#y",
            "preview://localhost/%2FUsers%2Fme%2Fdeck.html",
            "about:blank",
            "about:srcdoc",
            "blob:tauri://localhost/2b6f0cc9-1f0a-4c55-a0b8-6e4f1a0b5a4e",
        ] {
            assert!(is_app_url(&u(ok), None), "{ok} should be allowed");
        }
    }

    const LOCALHOST_HOST_URLS: &[&str] = &[
        "http://tauri.localhost/",
        "https://tauri.localhost/settings",
        "http://preview.localhost/C%3A%2Fdeck.html",
        "blob:http://tauri.localhost/2b6f0cc9-1f0a-4c55-a0b8-6e4f1a0b5a4e",
    ];

    #[test]
    fn localhost_hosts_are_the_app_only_where_tauri_serves_schemes_there() {
        for url in LOCALHOST_HOST_URLS {
            assert!(is_app_url_on(&u(url), None, APP_HOSTS), "{url} on Android");
            assert!(!is_app_url_on(&u(url), None, &[]), "{url} on macOS/Linux");
        }
        for url in LOCALHOST_HOST_URLS.iter().filter(|u| !u.contains("preview.")) {
            assert!(
                is_app_url_on(&u(url), None, MAIN_FRAME_ONLY_APP_HOSTS),
                "{url} on Windows"
            );
            assert_eq!(
                is_app_url(&u(url), None),
                cfg!(any(windows, target_os = "android")),
                "{url} on this platform"
            );
        }
    }

    /// Only main frames reach the guard on Windows, and none of them may show
    /// a preview document.
    #[test]
    fn a_main_frame_cannot_load_a_preview_on_windows() {
        let url = u("http://preview.localhost/C%3A%2Fdeck.html");
        assert!(!is_app_url_on(&url, None, MAIN_FRAME_ONLY_APP_HOSTS));
        assert_eq!(is_app_url(&url, None), cfg!(target_os = "android"));
    }

    #[test]
    fn opaque_origin_blobs_are_refused() {
        for localhost_hosts in [APP_HOSTS, MAIN_FRAME_ONLY_APP_HOSTS, &[]] {
            for bad in [
                "blob:null/2b6f0cc9-1f0a-4c55-a0b8-6e4f1a0b5a4e",
                "blob:null",
                "blob:",
            ] {
                assert!(
                    !is_app_url_on(&u(bad), None, localhost_hosts),
                    "{bad} should be refused"
                );
            }
        }
    }

    #[test]
    fn everything_else_is_refused() {
        for bad in [
            "http://evil.example/",
            "https://evil.example/",
            "http://localhost:1420/",
            "http://127.0.0.1:1337/",
            "http://tauri.localhost.evil.example/",
            "http://evil.example/?h=tauri.localhost",
            "tauri://evil.example/",
            "preview://evil.example/",
            "asset://localhost/%2Ftmp%2Fx.html",
            "http://asset.localhost/%2Ftmp%2Fx.html",
            "ipc://localhost/plugin%3Aopener%7Copen_url",
            "http://ipc.localhost/",
            "file:///etc/passwd",
            "data:text/html,<script>1</script>",
            "javascript:alert(1)",
            "about:config",
            "blob:https://evil.example/2b6f0cc9",
            "blob:asset://localhost/x",
            "jan://open",
            "mailto:a@b.c",
        ] {
            assert!(!is_app_url(&u(bad), None), "{bad} should be refused");
        }
    }

    #[test]
    fn dev_url_is_allowed_only_when_passed_and_only_its_origin() {
        let dev = u("http://localhost:1420");
        assert!(is_app_url(&u("http://localhost:1420/"), Some(&dev)));
        assert!(is_app_url(
            &u("http://localhost:1420/threads/1"),
            Some(&dev)
        ));
        assert!(is_app_url(&u("blob:http://localhost:1420/abc"), Some(&dev)));
        assert!(!is_app_url(&u("http://localhost:1421/"), Some(&dev)));
        assert!(!is_app_url(&u("https://localhost:1420/"), Some(&dev)));
        assert!(!is_app_url(&u("http://127.0.0.1:1420/"), Some(&dev)));
        assert!(!is_app_url(&u("http://localhost:1420/"), None));
    }

    #[test]
    fn only_web_urls_are_handed_to_the_browser() {
        assert!(opens_externally(&u("https://jan.ai/docs")));
        assert!(opens_externally(&u("http://example.com/")));
        assert!(!opens_externally(&u("file:///etc/passwd")));
        assert!(!opens_externally(&u("asset://localhost/x")));
        assert!(!opens_externally(&u("jan://open")));
        assert!(!opens_externally(&u("javascript:alert(1)")));
    }

    #[test]
    fn handoffs_are_throttled() {
        let last = Mutex::new(None);
        let t0 = Instant::now();
        assert!(handoff_allowed(&last, t0));
        assert!(!handoff_allowed(&last, t0 + Duration::from_millis(200)));
        assert!(handoff_allowed(&last, t0 + HANDOFF_INTERVAL));
    }
}
