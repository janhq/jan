//! The loopback OpenAI-compatible surface in front of the in-process engine.
//!
//! It exists because Jan's local API server is an HTTP reverse proxy
//! (`src-tauri/src/core/server/proxy.rs` forwards to
//! `http://127.0.0.1:<port>/v1<path>`) and the extension's `chat()` fetches the
//! same URL. Keeping a port means neither has to change, and external
//! OpenAI-SDK clients pointed at Jan keep working.
//!
//! The engine's chunk generator is blocking C++, so streaming runs on a
//! blocking task feeding an async channel rather than being polled from the
//! reactor.

use std::convert::Infallible;
use std::net::SocketAddr;
use std::time::Duration;
use std::sync::Arc;

use bytes::Bytes;
use http_body_util::{combinators::BoxBody, BodyExt, Full, StreamBody};
use hyper::body::{Frame, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response as HttpResponse, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex};

use super::registry::{Registry, RegistryError};
use super::Route;

type Body = BoxBody<Bytes, Infallible>;

pub struct EngineServer {
    pub port: u16,
    pub api_key: String,
    registry: Arc<Mutex<Registry>>,
}

/// Chunks the streaming task hands to the response body. Bounded so a slow
/// client applies backpressure instead of letting the generator run ahead into
/// unbounded memory.
const STREAM_BUFFER: usize = 32;

impl EngineServer {
    /// Binds `127.0.0.1:port`. Pass 0 to let the OS choose, then read `port`
    /// back -- unlike the old `49152 + random` guess, this cannot collide.
    pub async fn bind(
        registry: Arc<Mutex<Registry>>,
        port: u16,
        api_key: String,
    ) -> std::io::Result<(Self, TcpListener)> {
        let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port))).await?;
        let port = listener.local_addr()?.port();
        Ok((
            Self {
                port,
                api_key,
                registry,
            },
            listener,
        ))
    }

    /// Serves forever. Callers that need to stop use `serve_until`.
    pub async fn serve(self, listener: TcpListener) {
        self.serve_until(listener, std::future::pending::<()>(), Duration::ZERO)
            .await
    }

    /// Serves until `shutdown` resolves, then stops accepting and waits up to
    /// `drain` for in-flight requests to finish.
    ///
    /// The shutdown trigger is deliberately a parameter rather than an HTTP
    /// route: process lifetime is the caller's concern, not the transport's, and
    /// a request handler that tears down its own server has to be careful about
    /// ordering that simply does not arise this way.
    ///
    /// Draining matters because a connection task holds an `Arc<Engine>` while
    /// it generates. Returning the moment the listener stops would abandon
    /// those tasks and leave the engine referenced, so the teardown that frees
    /// the model could not run.
    pub async fn serve_until(
        self,
        listener: TcpListener,
        shutdown: impl std::future::Future<Output = ()>,
        drain: Duration,
    ) {
        let state = Arc::new(self);
        let mut connections = tokio::task::JoinSet::new();
        let shutdown = std::pin::pin!(shutdown);

        {
            let mut shutdown = shutdown;
            loop {
                tokio::select! {
                    // Biased so a pending shutdown wins over a connection that
                    // arrived in the same poll.
                    biased;
                    _ = &mut shutdown => break,
                    accepted = listener.accept() => {
                        let Ok((stream, _)) = accepted else { continue };
                        let state = Arc::clone(&state);
                        connections.spawn(async move {
                            let io = TokioIo::new(stream);
                            let svc = service_fn(move |req| {
                                let state = Arc::clone(&state);
                                async move { Ok::<_, Infallible>(state.route(req).await) }
                            });
                            // A dropped connection is the normal way a client
                            // cancels, so this is not worth logging loudly.
                            let _ = http1::Builder::new().serve_connection(io, svc).await;
                        });
                    }
                    // Reap finished connections so the set does not grow for the
                    // lifetime of the process.
                    Some(_) = connections.join_next(), if !connections.is_empty() => {}
                }
            }
        }

        if connections.is_empty() {
            return;
        }
        log::info!(
            "draining {} in-flight connection(s) before exit",
            connections.len()
        );
        if tokio::time::timeout(drain, async {
            while connections.join_next().await.is_some() {}
        })
        .await
        .is_err()
        {
            log::warn!(
                "{} connection(s) still open after {}s; abandoning them",
                connections.len(),
                drain.as_secs()
            );
        }
    }

    async fn route(&self, req: Request<Incoming>) -> HttpResponse<Body> {
        let path = req.uri().path().to_string();
        let method = req.method().clone();

        if !authorized(&self.api_key, req.headers()) {
            return json_error(StatusCode::UNAUTHORIZED, "invalid api key");
        }

        // Listing is registry-wide: a model that is registered but not resident
        // must still appear, or the UI would lose it after an eviction.
        if method == Method::GET && matches!(path.as_str(), "/v1/models" | "/models") {
            return self.list_models().await;
        }

        // Applying a regenerated preset. The router spelled this
        // `GET /models?reload=1`; a POST is used here because it mutates, and
        // because it carries the resized `models_max` the router could not
        // change without a restart.
        if method == Method::POST && path == "/models/reload" {
            let body = match req.into_body().collect().await {
                Ok(b) => b.to_bytes(),
                Err(_) => return json_error(StatusCode::BAD_REQUEST, "could not read the body"),
            };
            return self.reload_models(&String::from_utf8_lossy(&body)).await;
        }

        // Explicit lifecycle, replacing the router endpoints of the same name.
        // The plugin's command layer already speaks these, so keeping the paths
        // means `load_llama_model` / `unload_llama_model` need no rewrite.
        if method == Method::POST && matches!(path.as_str(), "/models/load" | "/models/unload") {
            let load = path.ends_with("/load");
            let body = match req.into_body().collect().await {
                Ok(b) => b.to_bytes(),
                Err(_) => return json_error(StatusCode::BAD_REQUEST, "could not read the body"),
            };
            let body = String::from_utf8_lossy(&body).into_owned();
            let Some(model) = extract_model(&body) else {
                return json_error(StatusCode::BAD_REQUEST, "model is required");
            };
            return if load {
                self.load_model(&model).await
            } else {
                self.unload_model(&model).await
            };
        }

        let Some(route) = Route::from_http_path(&path) else {
            return json_error(StatusCode::NOT_FOUND, &format!("no such route: {path}"));
        };

        let body = match req.into_body().collect().await {
            Ok(b) => b.to_bytes(),
            Err(_) => return json_error(StatusCode::BAD_REQUEST, "could not read the body"),
        };
        let body = String::from_utf8_lossy(&body).into_owned();

        // Routes that do not name a model are answered by any resident engine;
        // health has to work even when nothing is loaded.
        let model = extract_model(&body);
        self.dispatch(route, model, body).await
    }

    /// Re-reads the preset named in the request and diffs it against the
    /// running set. `models_max` is optional; omitting it keeps the current
    /// value.
    async fn reload_models(&self, body: &str) -> HttpResponse<Body> {
        let parsed: serde_json::Value = match serde_json::from_str(body) {
            Ok(v) => v,
            Err(e) => return json_error(StatusCode::BAD_REQUEST, &format!("bad json: {e}")),
        };
        let Some(preset_path) = parsed.get("preset_path").and_then(|v| v.as_str()) else {
            return json_error(StatusCode::BAD_REQUEST, "preset_path is required");
        };
        let ini = match std::fs::read_to_string(preset_path) {
            Ok(s) => s,
            Err(e) => {
                return json_error(
                    StatusCode::BAD_REQUEST,
                    &format!("could not read {preset_path}: {e}"),
                )
            }
        };

        let specs = super::preset::specs(preset_path, &ini);
        let mut reg = self.registry.lock().await;
        let models_max = parsed
            .get("models_max")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
            .unwrap_or_else(|| reg.models_max());
        let outcome = reg.reload(specs, models_max);
        json_ok(&serde_json::json!({
            "added": outcome.added,
            "changed": outcome.changed,
            "removed": outcome.removed,
            "kept": outcome.kept,
            "models_max": models_max,
        }))
    }

    async fn list_models(&self) -> HttpResponse<Body> {
        let reg = self.registry.lock().await;
        let busy = reg.busy_models();
        let data: Vec<serde_json::Value> = reg
            .known_models()
            .into_iter()
            .map(|id| {
                let failure = reg.failure_of(&id);
                serde_json::json!({
                    "id": id,
                    "object": "model",
                    "owned_by": "llamacpp",
                    // `status` mirrors llama.cpp's router shape because
                    // commands::evaluate_load_poll parses exactly these keys.
                    "status": {
                        "value": reg.status_of(&id).as_str(),
                        "failed": failure.is_some(),
                        "error": failure,
                    },
                    // Not part of the router's shape; the shutdown gate reads
                    // it to tell a generating model from a merely resident one.
                    "busy": busy.contains(&id),
                })
            })
            .collect();
        json_ok(&serde_json::json!({ "object": "list", "data": data }))
    }

    /// Loads a model and leaves it resident. Synchronous, unlike the router's
    /// fire-and-forget endpoint, so a failure is reported on this response
    /// instead of only showing up in a later poll.
    async fn load_model(&self, model: &str) -> HttpResponse<Body> {
        {
            let reg = self.registry.lock().await;
            if reg.is_loaded(model) {
                return json_ok(&serde_json::json!({
                    "status": "already loaded", "model": model
                }));
            }
        }
        // Serializing loads behind the lock is deliberate -- two concurrent
        // loads would race on models_max -- but starting a llama_context is
        // blocking, so it needs block_in_place to move other tasks off this
        // worker instead of stalling the reactor. `block_on` inside
        // `spawn_blocking` would risk deadlocking the runtime.
        let mut reg = self.registry.lock().await;
        let outcome = tokio::task::block_in_place(|| {
            let r = reg.acquire(model).map(|_| ());
            if r.is_ok() {
                // Resident but idle, so it stays evictable under models_max.
                reg.release(model);
            }
            r
        });
        drop(reg);

        match outcome {
            Ok(()) => json_ok(&serde_json::json!({ "status": "loaded", "model": model })),
            Err(RegistryError::Full { models_max }) => json_error(
                StatusCode::SERVICE_UNAVAILABLE,
                &format!("all {models_max} model slots are busy; retry shortly"),
            ),
            Err(RegistryError::Engine(e)) => json_error(StatusCode::BAD_REQUEST, &e.to_string()),
        }
    }

    /// Refuses while requests are in flight rather than cancelling them, which
    /// is what upstream's router does.
    async fn unload_model(&self, model: &str) -> HttpResponse<Body> {
        let mut reg = self.registry.lock().await;
        if !reg.is_loaded(model) {
            return json_ok(&serde_json::json!({
                "status": "already unloaded", "model": model
            }));
        }
        if reg.unload(model) {
            json_ok(&serde_json::json!({ "status": "unloaded", "model": model }))
        } else {
            json_error(
                StatusCode::CONFLICT,
                "the model has requests in flight; retry once they finish",
            )
        }
    }

    async fn dispatch(
        &self,
        route: Route,
        model: Option<String>,
        body: String,
    ) -> HttpResponse<Body> {
        // No model named: fall back to whatever is resident, which is what
        // single-model callers (and /health) expect.
        let Some(model) = model else {
            return self.dispatch_any(route, body).await;
        };

        let engine = {
            let mut reg = self.registry.lock().await;
            // acquire may start an engine, which blocks; see load_model.
            match tokio::task::block_in_place(|| reg.acquire(&model)) {
                Ok(e) => e,
                Err(RegistryError::Full { models_max }) => {
                    return json_error(
                        StatusCode::SERVICE_UNAVAILABLE,
                        &format!(
                            "all {models_max} model slots are busy; retry shortly"
                        ),
                    )
                }
                Err(RegistryError::Engine(e)) => {
                    return json_error(StatusCode::BAD_REQUEST, &e.to_string())
                }
            }
        };

        let out = run(engine, route, body, STREAM_BUFFER).await;
        self.registry.lock().await.release(&model);
        out
    }

    /// For routes with no model in the body: use the first resident engine.
    async fn dispatch_any(&self, route: Route, body: String) -> HttpResponse<Body> {
        let engine = {
            let mut reg = self.registry.lock().await;
            let Some(first) = reg.loaded_models().into_iter().next() else {
                return json_error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "no model is loaded",
                );
            };
            match tokio::task::block_in_place(|| reg.acquire(&first)) {
                Ok(e) => (e, first),
                Err(e) => {
                    return json_error(
                        StatusCode::SERVICE_UNAVAILABLE,
                        &format!("{e:?}"),
                    )
                }
            }
        };
        let (eng, id) = engine;
        let out = run(eng, route, body, STREAM_BUFFER).await;
        self.registry.lock().await.release(&id);
        out
    }
}

/// Issues one request and adapts the engine's response to an HTTP body.
async fn run(
    engine: Arc<super::Engine>,
    route: Route,
    body: String,
    buffer: usize,
) -> HttpResponse<Body> {
    let name = route.as_shim_name();

    // The engine call itself blocks: it takes the server queue and may wait on
    // a slot, so it must not run on the reactor.
    let engine2 = Arc::clone(&engine);
    let head = tokio::task::spawn_blocking(move || {
        let res = engine2.request(name, &body);
        (res.status(), res.content_type(), res.body(), res.is_stream(), res)
    })
    .await;

    let Ok((status, content_type, first, is_stream, mut res)) = head else {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "engine task panicked");
    };

    let status = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);

    if !is_stream {
        return HttpResponse::builder()
            .status(status)
            .header(hyper::header::CONTENT_TYPE, content_type)
            .body(Full::new(Bytes::from(first)).boxed())
            .unwrap_or_else(|_| json_error(StatusCode::INTERNAL_SERVER_ERROR, "bad response"));
    }

    // Streaming: drain the blocking generator on its own thread into a bounded
    // channel. Dropping the receiver (client gone) makes the send fail, which
    // cancels generation instead of running it to completion for nobody.
    let (tx, rx) = mpsc::channel::<Result<Frame<Bytes>, Infallible>>(buffer);
    if !first.is_empty() {
        let _ = tx.send(Ok(Frame::data(Bytes::from(first)))).await;
    }
    tokio::task::spawn_blocking(move || {
        loop {
            match res.next_chunk() {
                Ok(Some(chunk)) => {
                    if chunk.is_empty() {
                        continue;
                    }
                    if tx
                        .blocking_send(Ok(Frame::data(Bytes::from(chunk))))
                        .is_err()
                    {
                        res.cancel();
                        break;
                    }
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
    });

    HttpResponse::builder()
        .status(status)
        .header(hyper::header::CONTENT_TYPE, content_type)
        .header(hyper::header::CACHE_CONTROL, "no-cache")
        .body(StreamBody::new(tokio_stream_wrapper(rx)).boxed())
        .unwrap_or_else(|_| json_error(StatusCode::INTERNAL_SERVER_ERROR, "bad response"))
}

fn tokio_stream_wrapper(
    rx: mpsc::Receiver<Result<Frame<Bytes>, Infallible>>,
) -> impl futures_util::Stream<Item = Result<Frame<Bytes>, Infallible>> {
    futures_util::stream::unfold(rx, |mut rx| async move {
        rx.recv().await.map(|item| (item, rx))
    })
}

/// An empty configured key means auth is off, which is how a caller that owns
/// the loopback port entirely (tests, a single-user desktop) opts out.
fn authorized(api_key: &str, headers: &hyper::HeaderMap) -> bool {
    if api_key.is_empty() {
        return true;
    }
    headers
        .get(hyper::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .is_some_and(|k| k == api_key)
}

/// The `model` field OpenAI requests carry, used to pick the engine. Absent for
/// `/health`, `/props` and single-model callers.
fn extract_model(body: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()?
        .get("model")?
        .as_str()
        .map(str::to_string)
        .filter(|s| !s.is_empty())
}

fn json_ok(v: &serde_json::Value) -> HttpResponse<Body> {
    HttpResponse::builder()
        .status(StatusCode::OK)
        .header(hyper::header::CONTENT_TYPE, "application/json; charset=utf-8")
        .body(Full::new(Bytes::from(v.to_string())).boxed())
        .expect("a literal json response is always buildable")
}

fn json_error(status: StatusCode, message: &str) -> HttpResponse<Body> {
    let v = serde_json::json!({ "error": { "message": message, "code": status.as_u16() } });
    HttpResponse::builder()
        .status(status)
        .header(hyper::header::CONTENT_TYPE, "application/json; charset=utf-8")
        .body(Full::new(Bytes::from(v.to_string())).boxed())
        .expect("a literal json response is always buildable")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_model_reads_the_openai_field() {
        assert_eq!(
            extract_model(r#"{"model":"qwen","messages":[]}"#).as_deref(),
            Some("qwen")
        );
    }

    #[test]
    fn extract_model_tolerates_absent_empty_and_non_json_bodies() {
        assert_eq!(extract_model(r#"{"messages":[]}"#), None);
        assert_eq!(extract_model(r#"{"model":""}"#), None);
        assert_eq!(extract_model(r#"{"model":123}"#), None);
        assert_eq!(extract_model("not json at all"), None);
        assert_eq!(extract_model(""), None);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn bind_with_port_zero_reports_the_port_the_os_chose() {
        let reg = Arc::new(Mutex::new(Registry::new(1)));
        let (server, listener) = EngineServer::bind(reg, 0, "k".into())
            .await
            .expect("loopback bind should succeed");
        assert_ne!(server.port, 0, "the OS-assigned port must be reported back");
        assert_eq!(listener.local_addr().unwrap().port(), server.port);
    }

    fn headers(auth: Option<&str>) -> hyper::HeaderMap {
        let mut h = hyper::HeaderMap::new();
        if let Some(a) = auth {
            h.insert(hyper::header::AUTHORIZATION, a.parse().unwrap());
        }
        h
    }

    #[test]
    fn an_empty_api_key_disables_auth() {
        assert!(authorized("", &headers(None)));
        assert!(authorized("", &headers(Some("Bearer anything"))));
    }

    #[test]
    fn a_set_api_key_is_enforced_and_the_scheme_must_match() {
        assert!(authorized("secret", &headers(Some("Bearer secret"))));
        assert!(!authorized("secret", &headers(None)));
        assert!(!authorized("secret", &headers(Some("Bearer wrong"))));
        // A bare token with no scheme must not pass.
        assert!(!authorized("secret", &headers(Some("secret"))));
        // Scheme comparison is case-sensitive, matching what the extension sends.
        assert!(!authorized("secret", &headers(Some("bearer secret"))));
    }
}
