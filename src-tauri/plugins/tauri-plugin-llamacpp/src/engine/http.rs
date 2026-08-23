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
use tokio::sync::{broadcast, mpsc, Mutex};

use super::registry::{Registry, RegistryError};
use super::slots::{Claim, Identity, SlotOccupancy, StateStore, MIN_TOKENS_TO_SAVE};
use super::Route;

type Body = BoxBody<Bytes, Infallible>;

pub struct EngineServer {
    pub port: u16,
    pub api_key: String,
    registry: Arc<Mutex<Registry>>,
    /// Cross-session KV persistence, `None` when the feature is off. Absent
    /// rather than a flag so every call site has to acknowledge that the
    /// engine may have been started without a `slot-save-path`, in which case
    /// llama.cpp answers the slot routes with 501 anyway.
    slots: Option<SlotState>,
}

/// The saved-state directory plus who is sitting in which slot.
struct SlotState {
    store: StateStore,
    occupancy: Mutex<SlotOccupancy>,
}

/// A chat request that names the thread it belongs to, so its KV cache can be
/// parked and picked back up. Absent on requests that do not (embeddings, or
/// any caller that has not opted in), which then behave exactly as before.
#[derive(Debug, Clone, PartialEq, Eq)]
struct SlotHint {
    thread: String,
    slot: i32,
}

/// The request field naming the thread. Already part of Jan's own
/// `chatCompletionRequest` (`core/src/browser/extensions/engines/AIEngine.ts`),
/// which the llamacpp extension forwards verbatim -- so this reads a field that
/// is already on the wire rather than adding a second spelling for it. It is
/// not llama.cpp's, so it is stripped before the body is forwarded.
const THREAD_FIELD: &str = "thread_id";

impl SlotHint {
    /// llama.cpp's own `id_slot` doubles as the slot to persist: the frontend
    /// already pins chat to slot 0 so a thread reuses its cached prefix across
    /// turns, which is the same slot whose contents are worth keeping.
    /// Without it there is no way to know which slot ran the request, so the
    /// hint is dropped rather than guessed at.
    fn from_body(body: &str) -> Option<Self> {
        let v: serde_json::Value = serde_json::from_str(body).ok()?;
        let thread = v.get(THREAD_FIELD)?.as_str()?.trim().to_string();
        if thread.is_empty() {
            return None;
        }
        let slot = v.get("id_slot")?.as_i64()?;
        if slot < 0 {
            return None;
        }
        Some(Self {
            thread,
            slot: slot as i32,
        })
    }
}

/// Removes Jan's own field so llama.cpp only ever sees its own schema.
fn strip_thread_field(body: &str) -> String {
    let Ok(mut v) = serde_json::from_str::<serde_json::Value>(body) else {
        return body.to_string();
    };
    let Some(o) = v.as_object_mut() else {
        return body.to_string();
    };
    if o.remove(THREAD_FIELD).is_none() {
        // Re-serializing a body that did not carry the field would reorder its
        // keys for nothing.
        return body.to_string();
    }
    v.to_string()
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
                slots: None,
            },
            listener,
        ))
    }

    /// Serves forever. Callers that need to stop use `serve_until`.
    pub async fn serve(self, listener: TcpListener) {
        Arc::new(self)
            .serve_until(listener, std::future::pending::<()>(), Duration::ZERO)
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
    /// Takes `Arc<Self>` rather than `self` so the caller keeps a handle: the
    /// worker has to call `save_resident_slots` once draining is done, and that
    /// needs the server after it has stopped serving.
    pub async fn serve_until(
        self: Arc<Self>,
        listener: TcpListener,
        shutdown: impl std::future::Future<Output = ()>,
        drain: Duration,
    ) {
        let state = self;
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

    /// Turns on cross-session KV persistence. Separate from `bind` because the
    /// directory comes from the preset, which the caller has already read, and
    /// because every existing caller (including the tests) wants it off.
    pub fn with_slot_state(mut self, store: StateStore) -> Self {
        self.slots = Some(SlotState {
            store,
            occupancy: Mutex::new(SlotOccupancy::default()),
        });
        self
    }

    /// Parks the thread that was in this slot and picks up the incoming one.
    ///
    /// Ordering is load-bearing: the outgoing state has to reach disk before
    /// the restore overwrites the slot, and both have to finish before the
    /// completion task is posted. llama.cpp defers a slot action while that
    /// slot is generating, so each of these calls also serves as the barrier
    /// that keeps them from interleaving with a request already in flight.
    async fn hand_over_slot(
        &self,
        engine: &Arc<super::Engine>,
        model: &str,
        hint: &SlotHint,
    ) {
        let Some(state) = &self.slots else { return };
        let Some(identity) = self.registry.lock().await.state_identity(model) else {
            return;
        };

        let claim = state
            .occupancy
            .lock()
            .await
            .claim(model, hint.slot, &hint.thread);

        match claim {
            // Turn 2 and later of the same thread. The slot already holds this
            // conversation's cache, and it is newer than the file on disk --
            // restoring here would discard the previous turn's prefill.
            Claim::Unchanged => return,
            Claim::Evicted(prev) => {
                state.save(engine, model, hint.slot, &prev, &identity).await;
            }
            Claim::Empty => {}
        }
        state
            .restore(engine, model, hint.slot, &hint.thread, &identity)
            .await;
    }

    /// Writes every resident slot to disk. The shutdown counterpart of
    /// `hand_over_slot`: without it, closing Jan while a thread is loaded
    /// discards exactly the cache the feature exists to keep, since nothing
    /// else evicts that slot.
    pub async fn save_resident_slots(&self) {
        let Some(state) = &self.slots else { return };
        let resident = state.occupancy.lock().await.all();
        for (model, slot, thread) in resident {
            // One lock for the residency check, the identity and the acquire:
            // taking three would let the model be evicted between them, and
            // `acquire` on an evicted model *loads* it -- a cold model load on
            // the shutdown path, to save a cache that no longer exists.
            let acquired = {
                let mut reg = self.registry.lock().await;
                if !reg.is_loaded(&model) {
                    continue;
                }
                let identity = reg.state_identity(&model);
                let engine = tokio::task::block_in_place(|| reg.acquire(&model));
                match (engine, identity) {
                    (Ok(e), Some(i)) => Some((e, i)),
                    (Ok(_), None) => {
                        reg.release(&model);
                        None
                    }
                    (Err(_), _) => None,
                }
            };
            let Some((engine, identity)) = acquired else {
                continue;
            };
            state.save(&engine, &model, slot, &thread, &identity).await;
            self.registry.lock().await.release(&model);
        }
    }

    /// Drops saved state for one thread, or for every thread of a model.
    async fn erase_slot_state(&self, body: &str) -> HttpResponse<Body> {
        let Some(state) = &self.slots else {
            return json_error(
                StatusCode::NOT_IMPLEMENTED,
                "this engine was started without a slot save path",
            );
        };
        let parsed: serde_json::Value = match serde_json::from_str(body) {
            Ok(v) => v,
            Err(e) => return json_error(StatusCode::BAD_REQUEST, &format!("bad json: {e}")),
        };
        // Either identifies what to drop. A deleted thread is the common case
        // and the UI knows only its id, so `thread` alone has to work; `model`
        // alone is for a model whose settings changed under it.
        let model = parsed.get("model").and_then(|v| v.as_str());
        let thread = parsed.get("thread").and_then(|v| v.as_str());
        let erased = match (model, thread) {
            (_, Some(thread)) => {
                let n = state.store.forget_thread(thread);
                state.occupancy.lock().await.release_thread(thread);
                n
            }
            (Some(model), None) => {
                let n = state.store.forget_model(model);
                state.occupancy.lock().await.release_model(model);
                n
            }
            (None, None) => {
                return json_error(
                    StatusCode::BAD_REQUEST,
                    "one of model or thread is required",
                )
            }
        };
        json_ok(&serde_json::json!({ "erased": erased }))
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

        // The lifecycle feed. Subscribed for the length of a load, so a failed
        // one is reported the moment it happens instead of waiting out the
        // caller's poll timeout.
        if method == Method::GET && path == "/models/sse" {
            return self.models_sse().await;
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

        // Dropping a thread's saved KV cache, for a thread the user deleted.
        if method == Method::POST && path == "/slots/state/erase" {
            let body = match req.into_body().collect().await {
                Ok(b) => b.to_bytes(),
                Err(_) => return json_error(StatusCode::BAD_REQUEST, "could not read the body"),
            };
            return self.erase_slot_state(&String::from_utf8_lossy(&body)).await;
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
        drop(reg);

        // Applied here too, for the same reason models_max is: the value comes
        // from a setting the user can change while the worker runs, and the
        // alternative is a limit that does nothing until the app is restarted.
        let mut pruned = Vec::new();
        if let (Some(state), Some(mib)) = (
            &self.slots,
            parsed.get("slot_cache_mib").and_then(|v| v.as_u64()),
        ) {
            pruned = state.store.set_budget_mib(mib);
        }
        json_ok(&serde_json::json!({
            "added": outcome.added,
            "changed": outcome.changed,
            "removed": outcome.removed,
            "kept": outcome.kept,
            "models_max": models_max,
            "cache_pruned": pruned.len(),
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

    /// Streams model lifecycle transitions until the client goes away.
    ///
    /// Subscribing before the response is returned is what makes this usable
    /// as a load watcher: a caller that opens the stream and only then posts
    /// `/models/load` cannot miss the `loading` event.
    ///
    /// No keepalive comments: the connection is loopback and short-lived, so
    /// there is no proxy idle timeout to defeat.
    async fn models_sse(&self) -> HttpResponse<Body> {
        let mut rx = self.registry.lock().await.events().subscribe();
        let (tx, out) = mpsc::channel::<Result<Frame<Bytes>, Infallible>>(STREAM_BUFFER);

        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(event) => {
                        let frame = Bytes::from(event.to_sse_frame());
                        if tx.send(Ok(Frame::data(frame))).await.is_err() {
                            return; // client gone
                        }
                    }
                    // A subscriber too slow for CHANNEL_CAPACITY has missed
                    // events it cannot recover, and inventing them would be
                    // worse than the gap: keep streaming from here.
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        log::warn!("a /models/sse subscriber lagged and missed {n} event(s)");
                    }
                    Err(broadcast::error::RecvError::Closed) => return,
                }
            }
        });

        HttpResponse::builder()
            .status(StatusCode::OK)
            .header(hyper::header::CONTENT_TYPE, "text/event-stream")
            .header(hyper::header::CACHE_CONTROL, "no-cache")
            .body(StreamBody::new(tokio_stream_wrapper(out)).boxed())
            .unwrap_or_else(|_| json_error(StatusCode::INTERNAL_SERVER_ERROR, "bad response"))
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

        // Only a generating route has a KV cache worth keeping; an embedding or
        // a tokenize call leaves nothing behind.
        let body = if route.caches_prompt() {
            if let Some(hint) = SlotHint::from_body(&body) {
                self.hand_over_slot(&engine, &model, &hint).await;
            }
            strip_thread_field(&body)
        } else {
            body
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

impl SlotState {
    /// Saves a slot under `thread`'s key, if there is enough in it to be worth
    /// the write.
    ///
    /// The token count is read from `/slots` *first* rather than from the save
    /// response, because a state file is hundreds of MiB for a long
    /// conversation and writing one only to delete it again is the expensive
    /// way to learn it was too short.
    async fn save(
        &self,
        engine: &Arc<super::Engine>,
        model: &str,
        slot: i32,
        thread: &str,
        identity: &Identity,
    ) {
        let n_tokens = slot_tokens(engine, slot).await;
        if n_tokens < MIN_TOKENS_TO_SAVE {
            return;
        }
        let key = super::slots::state_key(model, thread);
        let file = StateStore::state_file_name(&key);
        let body = serde_json::json!({ "filename": file }).to_string();
        let query = format!("id_slot={slot}&action=save");

        let engine = Arc::clone(engine);
        let res = tokio::task::block_in_place(move || {
            let r = engine.request_with_query(Route::SlotsAction.as_shim_name(), &query, &body);
            (r.status(), r.body())
        });
        if res.0 >= 400 {
            log::warn!(
                "could not save the KV cache of {model} slot {slot}: {}",
                res.1
            );
            // A half-written file with no sidecar would be refused later
            // anyway; dropping it now keeps the directory honest.
            self.store.forget(&key);
            return;
        }
        if let Err(e) = self.store.commit(&key, identity.clone(), thread, n_tokens) {
            log::warn!("saved the KV cache of {model} but could not record it: {e}");
            self.store.forget(&key);
            return;
        }
        log::info!("parked {n_tokens} cached tokens for thread {thread} ({model})");
    }

    /// Restores `thread`'s state into the slot, if one was saved by the same
    /// model and the same llama.cpp.
    async fn restore(
        &self,
        engine: &Arc<super::Engine>,
        model: &str,
        slot: i32,
        thread: &str,
        identity: &Identity,
    ) {
        let key = super::slots::state_key(model, thread);
        let meta = match self.store.check(&key, identity) {
            Ok(m) => m,
            Err(super::slots::Reject::Absent) => return,
            Err(reason) => {
                log::info!("not restoring the KV cache of thread {thread}: {reason}");
                return;
            }
        };

        let file = StateStore::state_file_name(&key);
        let body = serde_json::json!({ "filename": file }).to_string();
        let query = format!("id_slot={slot}&action=restore");
        let engine = Arc::clone(engine);
        let res = tokio::task::block_in_place(move || {
            let r = engine.request_with_query(Route::SlotsAction.as_shim_name(), &query, &body);
            (r.status(), r.body())
        });
        if res.0 >= 400 {
            // llama.cpp rejects a state it cannot use (no room in the KV cache,
            // tokens outside the vocab). The guard passed, so this is not a
            // mismatch we can describe -- but the file is still unusable.
            log::warn!(
                "could not restore the KV cache of thread {thread}: {}",
                res.1
            );
            self.store.forget(&key);
            return;
        }
        log::info!(
            "restored {} cached tokens for thread {thread} ({model})",
            meta.n_tokens
        );
    }
}

/// Tokens currently cached in a slot, from `GET /slots`.
///
/// 0 when the slot has never run a task (upstream omits the count entirely in
/// that case) or when the listing cannot be read, both of which mean "nothing
/// worth saving".
async fn slot_tokens(engine: &Arc<super::Engine>, slot: i32) -> u64 {
    let engine = Arc::clone(engine);
    let body = tokio::task::block_in_place(move || {
        engine.request(Route::Slots.as_shim_name(), "").body()
    });
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) else {
        return 0;
    };
    v.as_array()
        .into_iter()
        .flatten()
        .find(|e| e.get("id").and_then(|i| i.as_i64()) == Some(slot as i64))
        .and_then(|e| e.get("n_prompt_tokens"))
        .and_then(|n| n.as_u64())
        .unwrap_or(0)
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
    fn a_thread_hint_needs_both_the_thread_and_the_slot() {
        let both = r#"{"model":"m","thread_id":"t1","id_slot":0}"#;
        assert_eq!(
            SlotHint::from_body(both),
            Some(SlotHint {
                thread: "t1".into(),
                slot: 0
            })
        );
        // Without id_slot there is no way to know which slot ran the request.
        assert_eq!(SlotHint::from_body(r#"{"thread_id":"t1"}"#), None);
        assert_eq!(SlotHint::from_body(r#"{"id_slot":0}"#), None);
        assert_eq!(SlotHint::from_body("{}"), None);
        assert_eq!(SlotHint::from_body("not json"), None);
    }

    // A blank thread id would key every unlabelled request to one state file.
    #[test]
    fn a_blank_or_negative_hint_is_ignored() {
        assert_eq!(
            SlotHint::from_body(r#"{"thread_id":"  ","id_slot":0}"#),
            None
        );
        assert_eq!(
            SlotHint::from_body(r#"{"thread_id":"t","id_slot":-1}"#),
            None
        );
    }

    #[test]
    fn the_thread_field_is_stripped_before_the_body_is_forwarded() {
        let out = strip_thread_field(r#"{"model":"m","thread_id":"t1","id_slot":0}"#);
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert!(v.get("thread_id").is_none(), "llama.cpp must not see it");
        assert_eq!(v["model"], "m");
        assert_eq!(v["id_slot"], 0);
    }

    #[test]
    fn a_body_without_the_field_is_forwarded_byte_for_byte() {
        let body = r#"{"model":"m","id_slot":0}"#;
        assert_eq!(strip_thread_field(body), body);
        assert_eq!(strip_thread_field("not json"), "not json");
        assert_eq!(strip_thread_field("[1,2]"), "[1,2]");
    }

    #[test]
    fn only_generating_routes_carry_a_cache_worth_saving() {
        assert!(Route::ChatCompletions.caches_prompt());
        assert!(Route::Completions.caches_prompt());
        assert!(!Route::Embeddings.caches_prompt());
        assert!(!Route::Tokenize.caches_prompt());
        assert!(!Route::Slots.caches_prompt());
    }

    #[tokio::test]
    async fn erasing_state_without_a_store_is_reported_not_silently_ignored() {
        let (server, _l) =
            EngineServer::bind(Arc::new(Mutex::new(Registry::new(1))), 0, String::new())
                .await
                .unwrap();
        let res = server.erase_slot_state(r#"{"model":"m"}"#).await;
        assert_eq!(res.status(), StatusCode::NOT_IMPLEMENTED);
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
