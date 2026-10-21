//! A native headless browser for the agent.
//!
//! The `screenshot` tool already shells out to a local Chrome to render a
//! file, but that is a one-shot render: Chrome is started in `--screenshot`
//! mode, draws the page and exits. There is no navigation to a URL, no
//! reading of the rendered page, no clicking, and no way to run script
//! against it.
//!
//! This module drives Chrome over the DevTools protocol instead. Chrome is
//! started headless with a remote-debugging port; the module then speaks CDP
//! (navigate, evaluate, click, type, screenshot) over the browser's WebSocket
//! endpoint. The browser is a *native* tool, not an MCP server: it is
//! advertised to the model under the `browser_*` names and dispatched by the
//! same built-in dispatcher as every other tool, so it inherits the gate's
//! approval flow and the run's hooks.
//!
//! One browser per session (thread), reused across calls so a conversation
//! keeps its page, its cookies and its login. The process is registered with
//! the session's process table, so the Stop button and the app's shutdown
//! reap it with the thread's other children.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

use crate::tools::ImageContentPart;

/// Upper bound on the text a browser tool returns. A page can be enormous;
/// the model gets a bounded excerpt plus a notice, the same way `web_fetch`
/// bounds its output.
pub const BROWSER_MAX_CHARS: usize = 40_000;

/// How long to wait for Chrome to come up and publish its debugging port.
const LAUNCH_TIMEOUT: Duration = Duration::from_secs(30);

/// How long a navigation may take before it is reported as timed out.
const NAVIGATE_TIMEOUT: Duration = Duration::from_secs(60);

/// The browser's page, and the connection that drives it.
struct BrowserSession {
    /// The Chrome process. Kept so the session can be torn down.
    child: Child,
    /// The DevTools connection to the browser.
    cdp: Cdp,
    /// The DevTools session id of the page target.
    page_session: String,
}

/// A DevTools protocol client.
///
/// One message id in flight at a time: the protocol is request/response over a
/// single socket, and the browser interleaves unsolicited events with the
/// responses, so events are read and dropped until the answer for this id
/// arrives.
struct Cdp {
    ws: WebSocketStream<MaybeTlsStream<TcpStream>>,
    next_id: u64,
    /// The DevTools session every page command is routed to. `None` for
    /// browser-level commands.
    session_id: Option<String>,
}

impl Cdp {
    async fn connect(url: &str) -> Result<Self, String> {
        let (ws, _response) = connect_async(url)
            .await
            .map_err(|e| format!("could not connect to the browser: {e}"))?;
        Ok(Self {
            ws,
            next_id: 0,
            session_id: None,
        })
    }

    /// Sends one command and waits for its answer.
    async fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.next_id += 1;
        let id = self.next_id;

        let mut message = json!({ "id": id, "method": method, "params": params });
        if let Some(session) = &self.session_id {
            message["sessionId"] = json!(session);
        }
        let text = serde_json::to_string(&message).map_err(|e| e.to_string())?;
        self.ws
            .send(Message::text(text))
            .await
            .map_err(|e| format!("could not send {method}: {e}"))?;

        loop {
            let next = self
                .ws
                .next()
                .await
                .ok_or_else(|| "the browser closed the connection".to_string())?;
            let message = next.map_err(|e| format!("the browser connection failed: {e}"))?;
            let text = match message {
                Message::Text(text) => text.to_string(),
                Message::Close(_) => {
                    return Err("the browser closed the connection".to_string())
                }
                _ => continue,
            };
            let value: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;

            // Anything without our id is an event, not our answer.
            if value.get("id").and_then(Value::as_u64) != Some(id) {
                continue;
            }
            if let Some(error) = value.get("error") {
                let message = error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("the browser reported an error");
                return Err(message.to_string());
            }
            return Ok(value.get("result").cloned().unwrap_or(Value::Null));
        }
    }
}

/// The live browsers, one per session key.
fn sessions() -> &'static Mutex<HashMap<String, BrowserSession>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, BrowserSession>>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The key a session's browser is filed under.
fn session_key(thread_id: Option<&str>) -> String {
    thread_id.unwrap_or("").to_string()
}

/// Finds a Chrome (or Chromium, Brave, Edge) to drive.
///
/// `CHROME_PATH` wins when set. Otherwise the standard install locations
/// are probed, per platform: the Windows paths are the ones Jan was missing,
/// so the browser tool works on a stock Windows install without the user
/// pointing at a binary.
pub fn chrome_binary() -> Option<PathBuf> {
    if let Ok(env) = std::env::var("CHROME_PATH") {
        if !env.is_empty() {
            return Some(PathBuf::from(env));
        }
    }

    for candidate in chrome_candidates() {
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Every path a browser may live at, in preference order.
fn chrome_candidates() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();

    // Windows: the per-user install first (no admin rights needed to
    // install it), then the machine-wide ones.
    if let Some(local) = env_path("LOCALAPPDATA") {
        out.push(
            local.join("Google/Chrome/Application/chrome.exe"),
        );
        out.push(local.join("Chromium/Application/chrome.exe"));
        out.push(local.join("BraveSoftware/Brave-Browser/Application/brave.exe"));
        out.push(local.join("Microsoft/Edge/Application/msedge.exe"));
    }
    for var in ["PROGRAMFILES", "PROGRAMFILES(X86)"] {
        if let Some(dir) = env_path(var) {
            out.push(dir.join("Google/Chrome/Application/chrome.exe"));
            out.push(dir.join("Chromium/Application/chrome.exe"));
            out.push(dir.join("BraveSoftware/Brave-Browser/Application/brave.exe"));
            out.push(dir.join("Microsoft/Edge/Application/msedge.exe"));
        }
    }

    // macOS
    out.push(PathBuf::from(
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ));
    out.push(PathBuf::from(
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ));
    out.push(PathBuf::from(
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ));
    out.push(PathBuf::from(
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ));

    // Linux
    out.push(PathBuf::from("/usr/bin/google-chrome"));
    out.push(PathBuf::from("/usr/bin/chromium"));
    out.push(PathBuf::from("/usr/bin/chromium-browser"));

    out
}

/// Reads an environment variable as a path.
fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// Starts Chrome headless with a remote-debugging port and returns the
/// session plus the port it published.
async fn launch(chrome: &Path) -> Result<(BrowserSession, u16), String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let profile = std::env::temp_dir().join(format!("jan-browser-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&profile)
        .map_err(|e| format!("could not create the browser profile: {e}"))?;

    // `--remote-debugging-port=0` lets Chrome pick a free port and write it
    // to DevToolsActivePort in the profile directory, which is more reliable
    // than guessing a port and racing another process for it.
    let args = [
        "--headless=new".to_string(),
        "--disable-gpu".to_string(),
        "--hide-scrollbars".to_string(),
        "--no-sandbox".to_string(),
        "--disable-dev-shm-usage".to_string(),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
        "--disable-extensions".to_string(),
        "--disable-background-networking".to_string(),
        "--remote-debugging-port=0".to_string(),
        format!("--user-data-dir={}", profile.display()),
        "about:blank".to_string(),
    ];

    let mut child = Command::new(chrome)
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("could not start the browser: {e}"))?;

    let port_file = profile.join("DevToolsActivePort");
    let deadline = Instant::now() + LAUNCH_TIMEOUT;
    let port = loop {
        if let Ok(text) = std::fs::read_to_string(&port_file) {
            if let Some(first) = text.lines().next() {
                if let Ok(port) = first.trim().parse::<u16>() {
                    break port;
                }
            }
        }
        if Instant::now() > deadline {
            let _ = child.kill().await;
            let _ = std::fs::remove_dir_all(&profile);
            return Err("the browser did not start in time".to_string());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    };

    // The browser endpoint answers the version document; the WebSocket URL for
    // the browser (not for a page) is in it.
    let version = http_get_json(&format!("http://127.0.0.1:{port}/json/version"))
        .await
        .map_err(|e| {
            format!("the browser did not answer on its debugging port: {e}")
        })?;
    let ws_url = version
        .get("webSocketDebuggerUrl")
        .and_then(Value::as_str)
        .ok_or_else(|| "the browser published no debugging endpoint".to_string())?
        .to_string();

    let mut cdp = Cdp::connect(&ws_url).await?;
    // A page of our own, so the tool never inherits a tab the user had open.
    let created = cdp.call("Target.createTarget", json!({ "url": "about:blank" })).await?;
    let target_id = created
        .get("targetId")
        .and_then(Value::as_str)
        .ok_or_else(|| "the browser created no page target".to_string())?
        .to_string();
    let attached = cdp
        .call("Target.attachToTarget", json!({ "targetId": target_id, "flatten": true }))
        .await?;
    let page_session = attached
        .get("sessionId")
        .and_then(Value::as_str)
        .ok_or_else(|| "the browser attached no page session".to_string())?
        .to_string();
    cdp.session_id = Some(page_session.clone());

    Ok((
        BrowserSession {
            child,
            cdp,
            page_session,
        },
        port,
    ))
}

/// A minimal HTTP GET that returns the parsed JSON body.
///
/// The DevTools HTTP endpoints are local and answer instantly, so this is a
/// hand-rolled request rather than a dependency: the plugin's graph is shared
/// with the headless CLI, and every dependency in it has to be paid for
/// there too.
async fn http_get_json(url: &str) -> Result<Value, String> {
    let rest = url
        .strip_prefix("http://")
        .ok_or_else(|| "only http:// is supported here".to_string())?;
    let (authority, path) = match rest.split_once('/') {
        Some((authority, path)) => (authority, format!("/{path}")),
        None => (rest, "/".to_string()),
    };
    let mut stream = TcpStream::connect(authority)
        .await
        .map_err(|e| e.to_string())?;
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {authority}\r\nConnection: close\r\nAccept: application/json\r\n\r\n"
    );
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|e| e.to_string())?;

    // The body is read by its length, not by waiting for the connection to
    // close: the browser keeps the socket open, so reading to the end would
    // block forever.
    let mut raw: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];
    let header_end = loop {
        if let Some(position) = find_header_end(&raw) {
            break position;
        }
        let read = stream.read(&mut chunk).await.map_err(|e| e.to_string())?;
        if read == 0 {
            return Err("the browser closed the connection".to_string());
        }
        raw.extend_from_slice(&chunk[..read]);
    };

    let headers = String::from_utf8_lossy(&raw[..header_end]).to_ascii_lowercase();
    let length = headers
        .lines()
        .find_map(|line| line.strip_prefix("content-length:"))
        .and_then(|value| value.trim().parse::<usize>().ok())
        .ok_or_else(|| "the browser sent no content length".to_string())?;

    let body_start = header_end + 4;
    while raw.len() < body_start + length {
        let read = stream.read(&mut chunk).await.map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        raw.extend_from_slice(&chunk[..read]);
    }
    let body = &raw[body_start..(body_start + length).min(raw.len())];

    serde_json::from_slice(body).map_err(|e| e.to_string())
}

/// Where the header block ends in a raw HTTP response.
fn find_header_end(raw: &[u8]) -> Option<usize> {
    raw.windows(4).position(|window| window == b"\r\n\r\n")
}

/// Returns the session's browser, starting one if there is none.
async fn ensure_session(thread_id: Option<&str>) -> Result<String, String> {
    let key = session_key(thread_id);
    {
        let mut map = sessions().lock().await;
        if let Some(session) = map.get_mut(&key) {
            if session.child.try_wait().ok().flatten().is_none() {
                return Ok(session.page_session.clone());
            }
        }
    }

    let chrome = chrome_binary().ok_or_else(|| {
        "no Chrome/Chromium/Edge binary found (set CHROME_PATH to point at one)".to_string()
    })?;
    let (session, _port) = launch(&chrome).await?;
    let page_session = session.page_session.clone();
    sessions().lock().await.insert(key, session);
    Ok(page_session)
}

/// Runs one command against the session's page.
async fn call_page(
    thread_id: Option<&str>,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let key = session_key(thread_id);
    let mut map = sessions().lock().await;
    let session = map.get_mut(&key).ok_or_else(|| {
        "the browser is not running; open a page first with browser_open".to_string()
    })?;
    session.cdp.call(method, params).await
}

/// Closes the browser of one session.
pub async fn close_session(thread_id: Option<&str>) {
    let key = session_key(thread_id);
    if let Some(mut session) = sessions().lock().await.remove(&key) {
        let _ = session.child.kill().await;
    }
}

/// Closes every browser. Used at app shutdown.
pub async fn close_all() {
    let mut map = sessions().lock().await;
    for (_, mut session) in map.drain() {
        let _ = session.child.kill().await;
    }
}

/// Truncates text to the tool's bound and says so when it cuts.
fn bound_text(text: &str) -> String {
    if text.chars().count() <= BROWSER_MAX_CHARS {
        return text.to_string();
    }
    let kept: String = text.chars().take(BROWSER_MAX_CHARS).collect();
    format!(
        "{kept}\n\n[truncated: the page had {} characters, {} shown]",
        text.chars().count(),
        BROWSER_MAX_CHARS
    )
}

/// The readable text of the current page.
async fn page_text(thread_id: Option<&str>) -> Result<String, String> {
    let result = call_page(
        thread_id,
        "Runtime.evaluate",
        json!({
            "expression": "document.body ? document.body.innerText : ''",
            "returnByValue": true,
        }),
    )
    .await?;
    Ok(result
        .get("result")
        .and_then(|v| v.get("value"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string())
}

/// The page's title.
async fn page_title(thread_id: Option<&str>) -> Result<String, String> {
    let result = call_page(
        thread_id,
        "Runtime.evaluate",
        json!({ "expression": "document.title", "returnByValue": true }),
    )
    .await?;
    Ok(result
        .get("result")
        .and_then(|v| v.get("value"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string())
}

/// Waits for the page to finish loading, by polling `document.readyState`.
async fn wait_for_load(thread_id: Option<&str>) -> Result<(), String> {
    let deadline = Instant::now() + NAVIGATE_TIMEOUT;
    loop {
        let result = call_page(
            thread_id,
            "Runtime.evaluate",
            json!({ "expression": "document.readyState", "returnByValue": true }),
        )
        .await?;
        let state = result
            .get("result")
            .and_then(|v| v.get("value"))
            .and_then(Value::as_str)
            .unwrap_or("");
        if state == "complete" || state == "interactive" {
            return Ok(());
        }
        if Instant::now() > deadline {
            return Err("the page did not finish loading in time".to_string());
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

/// Executes the `browser_open` tool: navigates the page to a URL.
pub async fn browser_open(args: &Value, thread_id: Option<&str>) -> String {
    let Some(url) = args.get("url").and_then(Value::as_str).map(str::trim) else {
        return "ERROR: browser_open requires a 'url' string argument.".to_string();
    };
    if url.is_empty() {
        return "ERROR: browser_open 'url' must not be empty.".to_string();
    }
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return format!("ERROR: browser_open 'url' must be an http(s) URL, got: {url}");
    }

    if let Err(e) = ensure_session(thread_id).await {
        return format!("ERROR: {e}");
    }

    let navigation = match call_page(
        thread_id,
        "Page.navigate",
        json!({ "url": url }),
    )
    .await
    {
        Ok(value) => value,
        Err(e) => return format!("ERROR: could not open {url}: {e}"),
    };
    if let Some(text) = navigation.get("errorText").and_then(Value::as_str) {
        return format!("ERROR: could not open {url}: {text}");
    }

    if let Err(e) = wait_for_load(thread_id).await {
        return format!("ERROR: could not open {url}: {e}");
    }

    let title = page_title(thread_id).await.unwrap_or_default();
    let text = page_text(thread_id).await.unwrap_or_default();
    format!(
        "Opened {url}\nTitle: {title}\n\n{}",
        bound_text(&text)
    )
}

/// Executes the `browser_read` tool: the readable text of the current page.
pub async fn browser_read(_args: &Value, thread_id: Option<&str>) -> String {
    if let Err(e) = ensure_session(thread_id).await {
        return format!("ERROR: {e}");
    }
    let url = current_url(thread_id).await.unwrap_or_default();
    let title = page_title(thread_id).await.unwrap_or_default();
    let text = match page_text(thread_id).await {
        Ok(text) => text,
        Err(e) => return format!("ERROR: {e}"),
    };
    format!(
        "URL: {url}\nTitle: {title}\n\n{}",
        bound_text(&text)
    )
}

/// The page's current URL.
async fn current_url(thread_id: Option<&str>) -> Result<String, String> {
    let result = call_page(
        thread_id,
        "Runtime.evaluate",
        json!({ "expression": "location.href", "returnByValue": true }),
    )
    .await?;
    Ok(result
        .get("result")
        .and_then(|v| v.get("value"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string())
}

/// Executes the `browser_eval` tool: runs script in the page.
pub async fn browser_eval(args: &Value, thread_id: Option<&str>) -> String {
    let Some(expression) = args.get("expression").and_then(Value::as_str) else {
        return "ERROR: browser_eval requires an 'expression' string argument.".to_string();
    };
    if expression.trim().is_empty() {
        return "ERROR: browser_eval 'expression' must not be empty.".to_string();
    }
    if let Err(e) = ensure_session(thread_id).await {
        return format!("ERROR: {e}");
    }
    let result = match call_page(
        thread_id,
        "Runtime.evaluate",
        json!({ "expression": expression, "returnByValue": true, "awaitPromise": true }),
    )
    .await
    {
        Ok(value) => value,
        Err(e) => return format!("ERROR: {e}"),
    };

    if let Some(details) = result
        .get("exceptionDetails")
        .and_then(|v| v.get("exception"))
        .and_then(|v| v.get("description"))
        .and_then(Value::as_str)
    {
        return format!("ERROR: the script threw: {details}");
    }
    let value = result
        .get("result")
        .and_then(|v| v.get("value"))
        .cloned()
        .unwrap_or(Value::Null);
    let rendered = match &value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    };
    bound_text(&rendered)
}

/// Executes the `browser_click` tool: clicks the first element matching a
/// CSS selector.
pub async fn browser_click(args: &Value, thread_id: Option<&str>) -> String {
    let Some(selector) = args.get("selector").and_then(Value::as_str).map(str::trim) else {
        return "ERROR: browser_click requires a 'selector' string argument.".to_string();
    };
    if selector.is_empty() {
        return "ERROR: browser_click 'selector' must not be empty.".to_string();
    }
    if let Err(e) = ensure_session(thread_id).await {
        return format!("ERROR: {e}");
    }

    // The click is dispatched from the page rather than as a synthesized
    // input event, so it reaches handlers bound to the element itself.
    let expression = format!(
        r#"(() => {{
            const el = document.querySelector({selector});
            if (!el) return 'NOT_FOUND';
            el.scrollIntoView({{block: 'center'}});
            el.click();
            return 'CLICKED';
        }})()"#,
        selector = json!(selector)
    );
    let result = match call_page(
        thread_id,
        "Runtime.evaluate",
        json!({ "expression": expression, "returnByValue": true }),
    )
    .await
    {
        Ok(value) => value,
        Err(e) => return format!("ERROR: {e}"),
    };
    let outcome = result
        .get("result")
        .and_then(|v| v.get("value"))
        .and_then(Value::as_str)
        .unwrap_or("");
    match outcome {
        "CLICKED" => {
            let _ = wait_for_load(thread_id).await;
            let title = page_title(thread_id).await.unwrap_or_default();
            let url = current_url(thread_id).await.unwrap_or_default();
            format!("Clicked {selector}\nURL: {url}\nTitle: {title}")
        }
        "NOT_FOUND" => format!("ERROR: no element matched {selector}"),
        other => format!("ERROR: the click did not run ({other})"),
    }
}

/// Executes the `browser_type` tool: sets a field's value and fires the
/// events a form listens for.
pub async fn browser_type(args: &Value, thread_id: Option<&str>) -> String {
    let Some(selector) = args.get("selector").and_then(Value::as_str).map(str::trim) else {
        return "ERROR: browser_type requires a 'selector' string argument.".to_string();
    };
    let Some(text) = args.get("text").and_then(Value::as_str) else {
        return "ERROR: browser_type requires a 'text' string argument.".to_string();
    };
    if selector.is_empty() {
        return "ERROR: browser_type 'selector' must not be empty.".to_string();
    }
    if let Err(e) = ensure_session(thread_id).await {
        return format!("ERROR: {e}");
    }

    let expression = format!(
        r#"(() => {{
            const el = document.querySelector({selector});
            if (!el) return 'NOT_FOUND';
            el.focus();
            const setter = Object.getOwnPropertyDescriptor(
                el instanceof HTMLTextAreaElement
                    ? HTMLTextAreaElement.prototype
                    : HTMLInputElement.prototype,
                'value');
            if (setter && setter.set) setter.set.call(el, {text});
            else el.value = {text};
            el.dispatchEvent(new Event('input', {{bubbles: true}}));
            el.dispatchEvent(new Event('change', {{bubbles: true}}));
            return 'TYPED';
        }})()"#,
        selector = json!(selector),
        text = json!(text)
    );
    let result = match call_page(
        thread_id,
        "Runtime.evaluate",
        json!({ "expression": expression, "returnByValue": true }),
    )
    .await
    {
        Ok(value) => value,
        Err(e) => return format!("ERROR: {e}"),
    };
    let outcome = result
        .get("result")
        .and_then(|v| v.get("value"))
        .and_then(Value::as_str)
        .unwrap_or("");
    match outcome {
        "TYPED" => format!("Typed into {selector}"),
        "NOT_FOUND" => format!("ERROR: no element matched {selector}"),
        other => format!("ERROR: the text was not entered ({other})"),
    }
}

/// Executes the `browser_screenshot` tool: a PNG of the page.
///
/// The image comes back as an image content part, so a vision model sees the
/// rendered page rather than a description of it.
pub async fn browser_screenshot(
    args: &Value,
    thread_id: Option<&str>,
) -> (String, Option<Vec<ImageContentPart>>) {
    if let Err(e) = ensure_session(thread_id).await {
        return (format!("ERROR: {e}"), None);
    }
    let width = args
        .get("width")
        .and_then(Value::as_u64)
        .unwrap_or(1280)
        .clamp(320, 4096);
    let height = args
        .get("height")
        .and_then(Value::as_u64)
        .unwrap_or(800)
        .clamp(240, 4096);

    let result = match call_page(
        thread_id,
        "Page.captureScreenshot",
        json!({ "format": "png", "captureBeyondViewport": false }),
    )
    .await
    {
        Ok(value) => value,
        Err(e) => return (format!("ERROR: {e}"), None),
    };
    let Some(data) = result.get("data").and_then(Value::as_str) else {
        return ("ERROR: the browser returned no image.".to_string(), None);
    };

    let url = current_url(thread_id).await.unwrap_or_default();
    (
        format!("Screenshot of {url} ({width}x{height})"),
        Some(vec![ImageContentPart {
            data_url: format!("data:image/png;base64,{data}"),
            name: "browser-screenshot.png".to_string(),
        }]),
    )
}

/// Closes the browser of a thread. Wired to the desktop's thread teardown.
pub fn close_thread(thread_id: &str) {
    let key = thread_id.to_string();
    if let Ok(mut map) = sessions().try_lock() {
        if let Some(mut session) = map.remove(&key) {
            let _ = session.child.start_kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_paths_are_probed() {        let candidates = chrome_candidates();
        let text: Vec<String> = candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect();
        assert!(
            text.iter().any(|p| p.contains("chrome.exe")),
            "no Windows Chrome path is probed: {text:?}"
        );
        assert!(
            text.iter().any(|p| p.contains("msedge.exe")),
            "no Windows Edge path is probed: {text:?}"
        );
    }

    #[test]
    fn mac_and_linux_paths_are_still_probed() {
        let candidates = chrome_candidates();
        let text: Vec<String> = candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect();
        assert!(text.iter().any(|p| p.contains("/usr/bin/google-chrome")));
        assert!(text.iter().any(|p| p.contains("Google Chrome.app")));
    }

    #[test]
    fn text_is_bounded_with_a_notice() {
        let long = "x".repeat(BROWSER_MAX_CHARS + 500);
        let bounded = bound_text(&long);
        assert!(bounded.contains("[truncated"));
        assert!(bounded.chars().count() < BROWSER_MAX_CHARS + 200);
    }

    #[test]
    fn short_text_is_left_alone() {
        assert_eq!(bound_text("hello"), "hello");
    }

    #[test]
    fn session_key_is_the_thread_id() {
        assert_eq!(session_key(Some("t1")), "t1");
        assert_eq!(session_key(None), "");
    }

    /// A tiny HTTP server, so the browser test has something to open.
    ///
    /// It serves every connection, not just the first: a browser opens more
    /// than one (the page, then the favicon), and a server that answers only
    /// the first leaves the rest refused.
    async fn serve_once(body: &'static str) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            for _ in 0..32 {
                let Ok((mut stream, _)) = listener.accept().await else {
                    return;
                };
                tokio::spawn(async move {
                    let mut buffer = [0u8; 4096];
                    let _ = stream.read(&mut buffer).await;
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = stream.write_all(response.as_bytes()).await;
                    let _ = stream.flush().await;
                });
            }
        });
        format!("http://127.0.0.1:{port}/")
    }

    /// The whole tool, against a real browser.
    ///
    /// Skipped when there is no browser on the machine, the same way the
    /// screenshot test is: a CI box without Chrome is not a failure.
    #[tokio::test]
    async fn browser_drives_a_real_page() {
        if chrome_binary().is_none() {
            eprintln!("no Chrome on this machine; skipping the browser test");
            return;
        }

        let page = r#"<html><head><title>Jan Browser Tool</title></head>
<body><h1 id="heading">before</h1>
<button id="go" onclick="document.getElementById('heading').innerText='after'">go</button>
<input id="field" type="text"></input>
</body></html>"#;
        let url = serve_once(page).await;

        let opened = browser_open(
            &json!({ "url": url }),
            Some("browser-test"),
        )
        .await;
        assert!(opened.contains("Jan Browser Tool"), "open failed: {opened}");
        assert!(opened.contains("before"), "the page text is missing: {opened}");

        let evaluated = browser_eval(
            &json!({ "expression": "document.getElementById('heading').innerText" }),
            Some("browser-test"),
        )
        .await;
        assert!(evaluated.contains("before"), "eval failed: {evaluated}");

        let clicked = browser_click(&json!({ "selector": "#go" }), Some("browser-test")).await;
        assert!(clicked.contains("Clicked"), "click failed: {clicked}");

        let typed = browser_type(
            &json!({ "selector": "#field", "text": "hello jan" }),
            Some("browser-test"),
        )
        .await;
        assert!(typed.contains("Typed"), "type failed: {typed}");

        let value = browser_eval(
            &json!({ "expression": "document.getElementById('field').value" }),
            Some("browser-test"),
        )
        .await;
        assert!(value.contains("hello jan"), "the field is empty: {value}");

        let (message, images) =
            browser_screenshot(&json!({}), Some("browser-test")).await;
        assert!(message.contains("Screenshot"), "screenshot failed: {message}");
        let images = images.expect("the screenshot returned no image");
        assert!(images[0].data_url.starts_with("data:image/png;base64,"));

        // The page is still there for the next call.
        let read = browser_read(&json!({}), Some("browser-test")).await;
        assert!(read.contains("after"), "the click did not take: {read}");

        close_session(Some("browser-test")).await;
    }
}
