use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::http::{Request, Response};
use tauri::{Runtime, UriSchemeContext};

fn store() -> &'static Mutex<HashMap<String, String>> {
    static STORE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Register HTML for an artifact id so it can be served via the `artifact://`
/// protocol. The preview iframe loads a blob: URL otherwise, which inherits the
/// main-window CSP and blocks the inline scripts most generated pages rely on.
#[tauri::command]
pub fn set_artifact_html(id: String, html: String) {
    if let Ok(mut map) = store().lock() {
        map.insert(id, html);
    }
}

#[tauri::command]
pub fn clear_artifact_html(id: String) {
    if let Ok(mut map) = store().lock() {
        map.remove(&id);
    }
}

// Permissive on purpose: the preview iframe is sandboxed without
// `allow-same-origin`, so the document runs in an opaque origin with no access
// to IPC, app storage or the file system. Serving it with its own CSP stops it
// inheriting the (intentionally strict) main-window policy.
const ARTIFACT_CSP: &str = "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https: http:; \
img-src * data: blob:; media-src * data: blob:; font-src * data: blob:; \
style-src * 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval' blob: data: https: http:; \
connect-src *;";

/// Serves `artifact://localhost/<id>` (and `http://artifact.localhost/<id>` on
/// Windows) with a permissive, self-contained CSP header.
pub fn handle_artifact_request<R: Runtime>(
    _ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
    let id = request.uri().path().trim_start_matches('/').to_string();
    let html = store().lock().ok().and_then(|map| map.get(&id).cloned());

    match html {
        Some(body) => Response::builder()
            .status(200)
            .header("Content-Type", "text/html; charset=utf-8")
            .header("Content-Security-Policy", ARTIFACT_CSP)
            .header("Cache-Control", "no-store")
            .body(Cow::Owned(body.into_bytes()))
            .unwrap_or_else(|_| Response::new(Cow::Borrowed(b"" as &[u8]))),
        None => Response::builder()
            .status(404)
            .header("Content-Type", "text/plain; charset=utf-8")
            .body(Cow::Borrowed(b"artifact not found" as &[u8]))
            .unwrap_or_else(|_| Response::new(Cow::Borrowed(b"" as &[u8]))),
    }
}
