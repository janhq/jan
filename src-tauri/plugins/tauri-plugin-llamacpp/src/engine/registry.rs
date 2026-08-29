//! In-process replacement for llama.cpp's router mode.
//!
//! Upstream's router is a process supervisor plus a reverse proxy: it spawns a
//! child `llama-server` per model (`server-models.cpp:1020-1046`). Linking
//! `server_context` directly means there are no children, so what survives is
//! only the bookkeeping -- a model registry with `models_max` and LRU eviction.
//! The two invariants are taken from upstream (`server-models.cpp:92-95` and
//! `:103-210`): never evict a model with requests in flight, and make a caller
//! that arrives while the registry is full wait rather than fail.
//!
//! Capacity is per kind: `models_max` counts chat models only, and embedding
//! models live in a single reserved slot of their own -- loading the embedder
//! never evicts a chat model, and a chat model is never the victim that makes
//! room for another chat model. This is what gives the local API the same
//! "switch" behavior the desktop's own load path enforces.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use super::events::{EventBus, Transition};
use super::{Engine, EngineError};

/// Monotonic tick for LRU ordering. A counter rather than a clock so ordering
/// is exact under rapid use and cannot go backwards on a clock adjustment.
static TICK: AtomicU64 = AtomicU64::new(0);

fn next_tick() -> u64 {
    TICK.fetch_add(1, Ordering::Relaxed)
}

pub struct LoadedModel {
    pub engine: Arc<Engine>,
    /// Requests currently using this model. An evictor must not touch a model
    /// with a non-zero count, or it would cancel a live generation.
    inflight: usize,
    last_used: u64,
    /// Whether the engine was started as an embedding model (`embeddings =
    /// true` in its preset section, `--embeddings` in its arg list). Capacity
    /// and eviction are per kind: chat models fill `models_max`, an embedding
    /// model fills the single reserved slot.
    is_embedding: bool,
}

impl LoadedModel {
    pub fn engine(&self) -> Arc<Engine> {
        Arc::clone(&self.engine)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum RegistryError {
    /// Every slot is taken and every resident model is busy, so nothing can be
    /// evicted to make room.
    Full {
        models_max: usize,
    },
    Engine(EngineError),
}

impl From<EngineError> for RegistryError {
    fn from(e: EngineError) -> Self {
        Self::Engine(e)
    }
}

/// How a model is started, so the registry can reload one it evicted.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LoadSpec {
    /// llama-server's own flag set.
    Args(Vec<String>),
    /// A section of a `router.preset.ini`, the file Jan already generates.
    ///
    /// `body` is the section's settings (plus the shared `[*]` block) and is
    /// compared on reload. It is not passed to the C++ loader, which re-reads
    /// the file itself -- it exists so an unrelated model can stay loaded.
    Preset {
        ini_path: String,
        section: String,
        body: Vec<String>,
    },
}

/// What `GET /models` reports per entry. The names match llama.cpp's router
/// (`server-models.h:29-37`) because the plugin's polling arm
/// (`commands::evaluate_load_poll`) already parses exactly these values, and
/// changing them would silently turn every load into a 600s timeout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelStatus {
    Loaded,
    Unloaded,
}

impl ModelStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Loaded => "loaded",
            Self::Unloaded => "unloaded",
        }
    }
}

/// What a reload did, for the log line. A reload that reports only `kept` is
/// the case the whole mechanism exists for: nothing was disturbed.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct ReloadOutcome {
    pub added: Vec<String>,
    pub changed: Vec<String>,
    pub removed: Vec<String>,
    pub kept: Vec<String>,
}

pub struct Registry {
    loaded: HashMap<String, LoadedModel>,
    specs: HashMap<String, LoadSpec>,
    /// Models whose spec changed (or which were removed) while a request was in
    /// flight. They cannot be dropped there without cancelling a live
    /// generation, so `release` drops them once the last request finishes.
    stale: HashSet<String>,
    /// Why a model's last load attempt failed. Kept so `GET /models` can report
    /// `failed: true`: without it a failed load looks merely "unloaded" and the
    /// caller's poll loop waits out its full timeout instead of erroring.
    failures: HashMap<String, String>,
    /// Models the registry has stopped hosting since the last drain, whatever
    /// dropped them. Their slots died with the engine, so the occupancy map --
    /// which lives a module over and cannot be reached from these `&mut self`
    /// methods -- has to forget them before it hands one of their slot ids to
    /// another thread. `take_dropped` is drained where occupancy is claimed.
    dropped: Vec<String>,
    /// Max concurrently resident CHAT models; 0 means unlimited, matching
    /// llama.cpp's `--models-max`. Embedding models do not count against it:
    /// one embedder may reside in a reserved slot of its own.
    models_max: usize,
    /// Where every transition below is published for `/models/sse`.
    events: EventBus,
}

impl Registry {
    pub fn new(models_max: usize) -> Self {
        Self {
            loaded: HashMap::new(),
            specs: HashMap::new(),
            stale: HashSet::new(),
            failures: HashMap::new(),
            dropped: Vec::new(),
            models_max,
            events: EventBus::new(),
        }
    }

    /// The lifecycle feed, for the HTTP layer to subscribe to.
    pub fn events(&self) -> EventBus {
        self.events.clone()
    }

    pub fn models_max(&self) -> usize {
        self.models_max
    }

    /// Records how a model is started without loading it, so `/v1/models` can
    /// list it and a later request can load it on demand.
    pub fn register(&mut self, model_id: impl Into<String>, spec: LoadSpec) {
        self.specs.insert(model_id.into(), spec);
    }

    pub fn known_models(&self) -> Vec<String> {
        let mut v: Vec<String> = self.specs.keys().cloned().collect();
        v.sort();
        v
    }

    pub fn loaded_models(&self) -> Vec<String> {
        let mut v: Vec<String> = self.loaded.keys().cloned().collect();
        v.sort();
        v
    }

    /// Models with at least one request in flight.
    ///
    /// The router could only report "loaded", which conflated a model that is
    /// generating with one merely resident -- so its shutdown gate refused to
    /// exit while any model was in memory. Requests in flight is the question
    /// the gate is actually asking.
    pub fn busy_models(&self) -> Vec<String> {
        let mut v: Vec<String> = self
            .loaded
            .iter()
            .filter(|(_, m)| m.inflight > 0)
            .map(|(id, _)| id.clone())
            .collect();
        v.sort();
        v
    }

    /// The identity a saved KV state is checked against: the model's preset
    /// section plus the gguf it names.
    ///
    /// Read from the registry rather than reconstructed, so the comparison is
    /// against what the model was actually loaded with. `None` means the model
    /// is not registered at all, which is not something to guess at.
    pub fn state_identity(&self, model_id: &str) -> Option<super::slots::Identity> {
        let spec = self.specs.get(model_id)?;
        let body = match spec {
            LoadSpec::Preset { body, .. } => body.clone(),
            LoadSpec::Args(args) => args.clone(),
        };
        let path = spec_model_path(&body).map(std::path::PathBuf::from);
        Some(super::slots::Identity::new(
            model_id,
            &body,
            path.as_deref(),
        ))
    }

    pub fn is_loaded(&self, model_id: &str) -> bool {
        self.loaded.contains_key(model_id)
    }

    pub fn status_of(&self, model_id: &str) -> ModelStatus {
        if self.loaded.contains_key(model_id) {
            ModelStatus::Loaded
        } else {
            ModelStatus::Unloaded
        }
    }

    /// The last load failure for a model, if the most recent attempt failed.
    pub fn failure_of(&self, model_id: &str) -> Option<&str> {
        self.failures.get(model_id).map(String::as_str)
    }

    /// True when the incoming model's kind is at capacity and nothing of that
    /// kind is evictable, i.e. a caller must wait. Split out so the HTTP layer
    /// can queue instead of holding the registry lock across a load.
    pub fn is_saturated(&self, model_id: &str) -> bool {
        if self.models_max == 0 {
            return false;
        }
        let embedding = self.specs.get(model_id).is_some_and(spec_is_embedding);
        self.kind_count(embedding) >= self.kind_capacity(embedding)
            && self.lru_idle_of_kind(embedding).is_none()
    }

    /// Acquires the engine for a model, loading (and evicting) as needed, and
    /// marks it busy. The caller must pair this with `release`.
    pub fn acquire(&mut self, model_id: &str) -> Result<Arc<Engine>, RegistryError> {
        // A model awaiting retirement keeps serving until its in-flight
        // requests drain. Loading the new spec alongside it would put two
        // engines under one id and split the inflight count, so a late request
        // on the old spec is the lesser evil -- and is what the router does,
        // which also cannot unload a busy model.
        if let Some(m) = self.loaded.get_mut(model_id) {
            m.inflight += 1;
            m.last_used = next_tick();
            return Ok(m.engine());
        }

        let spec = self
            .specs
            .get(model_id)
            .cloned()
            .ok_or(RegistryError::Engine(EngineError::UnknownRoute(
                model_id.to_string(),
            )))?;

        self.make_room(model_id)?;

        self.events.emit(model_id, Transition::Loading);
        // Real load progress, straight from server_context. Only the `loading`
        // state carries a fraction; `ready` and `sleeping` arrive here too and
        // are already covered by the lifecycle transitions around this call.
        let progress = {
            let bus = self.events.clone();
            let model = model_id.to_string();
            std::sync::Arc::new(move |state: &str, payload: &str| {
                if state != "loading" {
                    return;
                }
                match serde_json::from_str::<serde_json::Value>(payload) {
                    Ok(v) if v.get("value").is_some() => {
                        bus.emit(&model, Transition::LoadProgress(v));
                    }
                    _ => {}
                }
            }) as crate::engine::sys::StateCallback
        };
        let started = match &spec {
            LoadSpec::Args(args) => Engine::start(args, Some(progress)),
            LoadSpec::Preset {
                ini_path, section, ..
            } => Engine::start_from_preset(ini_path, section, Some(progress)),
        };
        let engine = match started {
            Ok(e) => {
                self.failures.remove(model_id);
                e
            }
            Err(e) => {
                // Recorded so the poll arm sees `failed: true` rather than
                // waiting out its timeout on a bare "unloaded".
                self.failures.insert(model_id.to_string(), e.to_string());
                // Nonzero: this is the transition the desktop treats as a
                // definitive load failure.
                self.events
                    .emit(model_id, Transition::Unloaded { exit_code: 1 });
                return Err(e.into());
            }
        };
        let engine = Arc::new(engine);
        let is_embedding = spec_is_embedding(&spec);
        self.loaded.insert(
            model_id.to_string(),
            LoadedModel {
                engine: Arc::clone(&engine),
                inflight: 1,
                last_used: next_tick(),
                is_embedding,
            },
        );
        self.events.emit(model_id, Transition::Loaded);
        Ok(engine)
    }

    /// Marks a request finished. Only then does the model become evictable.
    ///
    /// A model a reload superseded is dropped here rather than at reload time,
    /// which is the only point where doing so cannot cancel a generation.
    pub fn release(&mut self, model_id: &str) {
        let Some(m) = self.loaded.get_mut(model_id) else {
            return;
        };
        m.inflight = m.inflight.saturating_sub(1);
        m.last_used = next_tick();
        if m.inflight == 0 && self.stale.remove(model_id) {
            self.loaded.remove(model_id);
            self.events
                .emit(model_id, Transition::Unloaded { exit_code: 0 });
        }
    }

    /// Applies a regenerated preset without restarting the process.
    ///
    /// A model whose spec is byte-identical stays resident; one whose settings
    /// moved is dropped so the next request reloads it. This is the reason the
    /// engine does not have to be restarted when a model is imported or a
    /// per-model setting is written -- a restart would evict the chat model the
    /// user is talking to.
    pub fn reload(&mut self, specs: HashMap<String, LoadSpec>, models_max: usize) -> ReloadOutcome {
        self.models_max = models_max;
        let mut outcome = ReloadOutcome::default();

        for id in self.specs.keys().cloned().collect::<Vec<_>>() {
            if !specs.contains_key(&id) {
                self.specs.remove(&id);
                self.failures.remove(&id);
                self.retire(&id);
                outcome.removed.push(id);
            }
        }

        for (id, spec) in specs {
            match self.specs.get(&id) {
                Some(existing) if *existing == spec => {
                    if self.loaded.contains_key(&id) {
                        outcome.kept.push(id);
                    }
                }
                existing => {
                    let known = existing.is_some();
                    self.specs.insert(id.clone(), spec);
                    self.failures.remove(&id);
                    self.retire(&id);
                    if known {
                        outcome.changed.push(id);
                    } else {
                        outcome.added.push(id);
                    }
                }
            }
        }

        outcome.added.sort();
        outcome.changed.sort();
        outcome.removed.sort();
        outcome.kept.sort();
        outcome
    }

    /// Drops a resident model, or defers the drop to `release` when it is busy.
    fn retire(&mut self, model_id: &str) {
        match self.loaded.get(model_id) {
            Some(m) if m.inflight == 0 => {
                self.loaded.remove(model_id);
                self.dropped.push(model_id.to_string());
                self.events
                    .emit(model_id, Transition::Unloaded { exit_code: 0 });
            }
            Some(_) => {
                self.stale.insert(model_id.to_string());
            }
            None => {}
        }
    }

    /// Unloads a model. Refuses while requests are in flight rather than
    /// cancelling them, which is what upstream does.
    pub fn unload(&mut self, model_id: &str) -> bool {
        match self.loaded.get(model_id) {
            Some(m) if m.inflight == 0 => {
                self.loaded.remove(model_id);
                self.stale.remove(model_id);
                self.dropped.push(model_id.to_string());
                self.events
                    .emit(model_id, Transition::Unloaded { exit_code: 0 });
                true
            }
            _ => false,
        }
    }

    /// Ids dropped since the last call, for the caller that owns the slot
    /// occupancy map. Draining is the caller's job precisely because the fix
    /// belongs on the other side of an async lock this struct cannot take.
    pub fn take_dropped(&mut self) -> Vec<String> {
        std::mem::take(&mut self.dropped)
    }

    /// Drops every resident model, ignoring in-flight requests.
    ///
    /// Unconditional where `unload` refuses a busy model: this runs only once
    /// the listener has stopped, and the point is to reach each `Engine`'s Drop
    /// -- and so `jan_llama_engine_stop` -- before the process exits. Returns
    /// the ids it released, for the log.
    pub fn shutdown(&mut self) -> Vec<String> {
        let mut ids: Vec<String> = self.loaded.keys().cloned().collect();
        ids.sort();
        self.loaded.clear();
        self.stale.clear();
        self.dropped.extend(ids.iter().cloned());
        ids
    }

    /// Evicts same-kind LRU-idle models until one more of the incoming model's
    /// kind fits.
    ///
    /// Capacities are per kind: chat models fill `models_max`; embedding
    /// models own a single reserved slot. A chat arrival therefore never
    /// evicts -- nor waits behind -- the embedder, and loading the embedder
    /// never disturbs a chat model. The chat-vs-embedder split is what makes
    /// switching models through the local API unload the outgoing chat model
    /// instead of letting both pile up until VRAM runs out.
    ///
    /// Deliberately does *not* persist the victim's KV cache: `save_model_slots`
    /// is called only from `unload_model`, which is the path the desktop's own
    /// load path takes (its extension pre-evicts through `/models/unload`).
    /// The victim's slot occupancy is still released here via `dropped`, so
    /// the residual is a lost cache and a re-prefill, not a cross-thread
    /// overwrite. Saving here needs the same await-and-persist that
    /// `unload_model` does, which the registry cannot do while holding its own
    /// lock -- so it belongs with the caller, as a follow-up. `retire` has the
    /// same omission.
    fn make_room(&mut self, incoming: &str) -> Result<(), RegistryError> {
        if self.models_max == 0 {
            return Ok(());
        }
        let incoming_embedding = self.specs.get(incoming).is_some_and(spec_is_embedding);
        while self.kind_count(incoming_embedding) >= self.kind_capacity(incoming_embedding) {
            let Some(victim) = self.lru_idle_of_kind(incoming_embedding) else {
                return Err(RegistryError::Full {
                    models_max: self.models_max,
                });
            };
            self.loaded.remove(&victim);
            self.dropped.push(victim.clone());
            eprintln!(
                "jan-llama-worker: evicted {} model {victim} (LRU idle) to make room for {incoming}",
                if incoming_embedding { "embedding" } else { "chat" },
            );
            self.events
                .emit(&victim, Transition::Unloaded { exit_code: 0 });
        }
        Ok(())
    }

    /// Resident models of one kind. A loaded model whose spec has since
    /// disappeared defaults to chat, the dominant kind.
    fn kind_count(&self, embedding: bool) -> usize {
        self.loaded
            .values()
            .filter(|m| m.is_embedding == embedding)
            .count()
    }

    /// Chat models fill `models_max`; the embedding kind owns one reserved
    /// slot, so at most one embedder is resident regardless of `models_max`.
    fn kind_capacity(&self, embedding: bool) -> usize {
        if embedding {
            1
        } else {
            self.models_max
        }
    }

    /// The least-recently-used model of one kind with nothing in flight.
    fn lru_idle_of_kind(&self, embedding: bool) -> Option<String> {
        pick_lru_idle(
            self.loaded
                .iter()
                .filter(|(_, m)| m.is_embedding == embedding)
                .map(|(id, m)| (id.as_str(), m.inflight, m.last_used)),
        )
    }
}

/// The eviction policy, over plain data so it can be tested without starting an
/// engine. Busy models are never candidates; among idle ones the oldest tick
/// wins.
fn pick_lru_idle<'a>(entries: impl Iterator<Item = (&'a str, usize, u64)>) -> Option<String> {
    entries
        .filter(|(_, inflight, _)| *inflight == 0)
        .min_by_key(|(_, _, last_used)| *last_used)
        .map(|(id, _, _)| id.to_string())
}

/// Whether a spec starts llama-server as an embedding model.
///
/// Preset sections carry `embeddings = true` (written by Jan's preset
/// generator); arg specs carry the `--embeddings`/`--embedding` flag. The
/// answer decides which capacity a model fills: `models_max` for chat, the
/// single reserved slot for embeddings.
fn spec_is_embedding(spec: &LoadSpec) -> bool {
    match spec {
        LoadSpec::Args(args) => args
            .iter()
            .any(|a| a == "--embeddings" || a == "--embedding"),
        LoadSpec::Preset { body, .. } => body.iter().any(|line| match line.split_once('=') {
            Some((k, v)) => k.trim() == "embeddings" && v.trim().eq_ignore_ascii_case("true"),
            None => false,
        }),
    }
}

/// The gguf a spec names, so its size and mtime can join the state guard. The
/// key is `model` in a preset section and `-m`/`--model` in an arg list; a spec
/// with neither (a remote or auto-resolved model) simply has no file to stamp.
fn spec_model_path(body: &[String]) -> Option<String> {
    let mut it = body.iter();
    while let Some(line) = it.next() {
        if line == "-m" || line == "--model" {
            return it.next().cloned();
        }
        if let Some((k, v)) = line.split_once('=') {
            if k.trim() == "model" {
                return Some(v.trim().to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(n: &str) -> LoadSpec {
        LoadSpec::Args(vec!["llama-server".into(), "-m".into(), n.into()])
    }

    /// An embedding-model spec in the shape the worker actually sees: a preset
    /// section body (shared block merged in, sorted) with `embeddings = true`.
    fn embed_spec(n: &str) -> LoadSpec {
        LoadSpec::Preset {
            ini_path: "/p.ini".into(),
            section: n.into(),
            body: vec!["embeddings = true".into(), format!("model = {n}.gguf")],
        }
    }

    /// Without the `engine` feature every load fails, which still exercises
    /// the bookkeeping: registration, capacity and eviction order are decided
    /// before an engine is ever started.
    fn reg(max: usize, models: &[&str]) -> Registry {
        let mut r = Registry::new(max);
        for m in models {
            r.register(*m, spec(m));
        }
        r
    }

    /// Puts a model in `loaded` without a load, which the default feature
    /// config cannot do: `acquire` always fails there.
    #[cfg(not(feature = "engine"))]
    fn resident(r: &mut Registry, models: &[&str]) {
        resident_as(r, &models.iter().map(|m| (*m, false)).collect::<Vec<_>>());
    }

    /// Same, with a per-model kind: `true` registers and loads the model as an
    /// embedding model (its spec carries `embeddings = true`).
    #[cfg(not(feature = "engine"))]
    fn resident_as(r: &mut Registry, models: &[(&str, bool)]) {
        for (m, embedding) in models {
            let sp = if *embedding { embed_spec(m) } else { spec(m) };
            r.register((*m).to_string(), sp);
            r.loaded.insert(
                (*m).to_string(),
                LoadedModel {
                    engine: Arc::new(Engine::stub()),
                    inflight: 0,
                    last_used: next_tick(),
                    is_embedding: *embedding,
                },
            );
        }
    }

    /// Every path that stops hosting a model has to say so: the slot occupancy
    /// map lives behind an async lock this struct cannot take, and a model
    /// missing from this list keeps its stale claim on a slot id that another
    /// thread will later be handed.
    #[cfg(not(feature = "engine"))]
    #[test]
    fn each_drop_path_records_the_model_it_dropped() {
        let mut r = Registry::new(2);
        resident(&mut r, &["a"]);
        assert!(r.unload("a"));
        assert_eq!(r.take_dropped(), vec!["a".to_string()]);
        assert!(r.take_dropped().is_empty(), "draining is not repeatable");

        resident(&mut r, &["b"]);
        r.retire("b");
        assert_eq!(r.take_dropped(), vec!["b".to_string()]);

        // Eviction under models_max: the victim is dropped by make_room rather
        // than by a caller, which is the path with no async context at all.
        let mut r = Registry::new(1);
        resident(&mut r, &["c"]);
        assert!(r.make_room("d").is_ok());
        assert_eq!(r.take_dropped(), vec!["c".to_string()]);

        let mut r = Registry::new(2);
        resident(&mut r, &["d", "e"]);
        let mut ids = r.shutdown();
        ids.sort();
        assert_eq!(ids, vec!["d".to_string(), "e".to_string()]);
        let mut dropped = r.take_dropped();
        dropped.sort();
        assert_eq!(dropped, vec!["d".to_string(), "e".to_string()]);
    }

    /// A busy model is not dropped, so it must not be recorded as dropped
    /// either -- releasing its occupancy would discard a live slot's claim.
    #[cfg(not(feature = "engine"))]
    #[test]
    fn a_busy_model_is_neither_dropped_nor_recorded() {
        let mut r = Registry::new(2);
        resident(&mut r, &["a"]);
        r.loaded.get_mut("a").unwrap().inflight = 1;
        assert!(!r.unload("a"), "unload must refuse a busy model");
        r.retire("a");
        assert!(r.take_dropped().is_empty());
    }

    #[test]
    fn registration_does_not_load() {
        let r = reg(2, &["a", "b"]);
        assert_eq!(r.known_models(), vec!["a", "b"]);
        assert!(r.loaded_models().is_empty());
        assert!(!r.is_loaded("a"));
    }

    #[test]
    fn an_unregistered_model_is_rejected_before_any_load() {
        let mut r = reg(2, &["a"]);
        let err = r.acquire("nope").unwrap_err();
        assert!(matches!(err, RegistryError::Engine(_)));
    }

    #[test]
    fn models_max_zero_means_unlimited() {
        let r = reg(0, &["a"]);
        assert_eq!(r.models_max(), 0);
        assert!(!r.is_saturated("a"), "unlimited must never saturate");
    }

    #[test]
    fn release_is_saturating_and_never_underflows() {
        let mut r = reg(1, &["a"]);
        // release on a model that was never loaded must be a no-op, not a panic
        r.release("a");
        r.release("a");
        assert!(!r.is_loaded("a"));
    }

    /// Capacity is per kind: a chat arrival evicts the LRU-idle CHAT model,
    /// never the embedder -- even when the embedder is the older resident.
    /// This is the local-API "switch" semantics at models_max = 1.
    #[cfg(not(feature = "engine"))]
    #[test]
    fn a_chat_arrival_evicts_a_chat_model_never_the_embedder() {
        let mut r = Registry::new(1);
        resident_as(&mut r, &[("chat-a", false), ("embed", true)]);
        r.loaded.get_mut("chat-a").unwrap().last_used = 1;
        r.loaded.get_mut("embed").unwrap().last_used = 0; // older than chat-a
        r.register("chat-b", spec("chat-b"));
        assert!(r.make_room("chat-b").is_ok());
        assert_eq!(r.take_dropped(), vec!["chat-a".to_string()]);
        assert!(r.is_loaded("embed"), "the embedder must not be evicted");
    }

    /// The same policy from the other side: loading the embedder leaves the
    /// chat model alone, so a RAG call cannot evict the model being talked to.
    #[cfg(not(feature = "engine"))]
    #[test]
    fn an_embedding_arrival_never_evicts_a_chat_model() {
        let mut r = Registry::new(1);
        resident_as(&mut r, &[("chat-a", false)]);
        r.register("embed", embed_spec("embed"));
        assert!(r.make_room("embed").is_ok());
        assert!(r.take_dropped().is_empty());
        assert!(r.is_loaded("chat-a"));
    }

    /// At most one embedder is resident: a second embedder replaces the first
    /// (the reserved slot is 1, independent of `models_max`).
    #[cfg(not(feature = "engine"))]
    #[test]
    fn an_embedding_arrival_replaces_a_resident_idle_embedder() {
        let mut r = Registry::new(1);
        resident_as(&mut r, &[("embed-1", true), ("chat-a", false)]);
        r.register("embed-2", embed_spec("embed-2"));
        assert!(r.make_room("embed-2").is_ok());
        assert_eq!(r.take_dropped(), vec!["embed-1".to_string()]);
        assert!(r.is_loaded("chat-a"));
    }

    /// A busy chat model cannot be evicted, so a second chat model gets Full
    /// and waits rather than cancelling a live generation.
    #[cfg(not(feature = "engine"))]
    #[test]
    fn a_busy_chat_model_blocks_a_chat_arrival() {
        let mut r = Registry::new(1);
        resident_as(&mut r, &[("chat-a", false)]);
        r.loaded.get_mut("chat-a").unwrap().inflight = 1;
        r.register("chat-b", spec("chat-b"));
        assert!(matches!(
            r.make_room("chat-b"),
            Err(RegistryError::Full { models_max: 1 })
        ));
    }

    /// Saturation is per kind too: a busy chat model does not saturate the
    /// registry for an embedding arrival, and vice versa.
    #[cfg(not(feature = "engine"))]
    #[test]
    fn saturation_is_judged_per_kind() {
        let mut r = Registry::new(1);
        resident_as(&mut r, &[("chat-a", false), ("embed", true)]);
        r.loaded.get_mut("chat-a").unwrap().inflight = 1;
        assert!(r.is_saturated("chat-b"), "chat is full and busy");
        assert!(!r.is_saturated("embed"), "the embedder slot is free");
    }

    /// Unlimited keeps its meaning for chat; nothing is evicted at all, as
    /// before.
    #[cfg(not(feature = "engine"))]
    #[test]
    fn unlimited_evicts_nothing() {
        let mut r = Registry::new(0);
        resident_as(&mut r, &[("chat-a", false), ("embed", true)]);
        assert!(r.make_room("chat-b").is_ok());
        assert!(r.make_room("embed-2").is_ok());
        assert!(r.take_dropped().is_empty());
    }

    #[test]
    fn a_preset_body_with_embeddings_true_marks_an_embedding_model() {
        let embed = LoadSpec::Preset {
            ini_path: "/p.ini".into(),
            section: "st".into(),
            body: vec!["embeddings = true".into(), "model = /m/st.gguf".into()],
        };
        assert!(spec_is_embedding(&embed));
        // Shared-block merges and sorting must not hide the flag...
        let merged = LoadSpec::Preset {
            ini_path: "/p.ini".into(),
            section: "st".into(),
            body: vec![
                "ctx-size = 4096".into(),
                "embeddings = true".into(),
                "model = /m/st.gguf".into(),
            ],
        };
        assert!(spec_is_embedding(&merged));
        // ...and `embeddings = false` (or its absence) stays a chat model.
        let chat = LoadSpec::Preset {
            ini_path: "/p.ini".into(),
            section: "q".into(),
            body: vec!["embeddings = false".into(), "model = /m/q.gguf".into()],
        };
        assert!(!spec_is_embedding(&chat));
        assert!(!spec_is_embedding(&spec("q")));
    }

    #[test]
    fn an_args_spec_with_the_embeddings_flag_marks_an_embedding_model() {
        let args = LoadSpec::Args(vec![
            "llama-server".into(),
            "-m".into(),
            "/m/q.gguf".into(),
            "--embeddings".into(),
        ]);
        assert!(spec_is_embedding(&args));
        let embedding_alias = LoadSpec::Args(vec!["llama-server".into(), "--embedding".into()]);
        assert!(spec_is_embedding(&embedding_alias));
    }

    fn specs(pairs: &[(&str, &str)]) -> HashMap<String, LoadSpec> {
        pairs
            .iter()
            .map(|(id, path)| ((*id).to_string(), spec(path)))
            .collect()
    }

    #[test]
    fn reload_registers_new_models_and_drops_removed_ones() {
        let mut r = reg(2, &["a", "b"]);
        let outcome = r.reload(specs(&[("b", "b"), ("c", "c")]), 2);
        assert_eq!(outcome.added, vec!["c"]);
        assert_eq!(outcome.removed, vec!["a"]);
        assert!(outcome.changed.is_empty());
        assert_eq!(r.known_models(), vec!["b", "c"]);
    }

    /// The point of reloading rather than restarting: a model whose settings
    /// did not move is left alone.
    #[test]
    fn reload_reports_an_unchanged_spec_as_neither_added_nor_changed() {
        let mut r = reg(2, &["a"]);
        let outcome = r.reload(specs(&[("a", "a")]), 2);
        assert!(outcome.added.is_empty());
        assert!(outcome.changed.is_empty());
        assert!(outcome.removed.is_empty());
    }

    #[test]
    fn reload_reports_a_moved_spec_as_changed() {
        let mut r = reg(2, &["a"]);
        let outcome = r.reload(specs(&[("a", "a-different-gguf")]), 2);
        assert_eq!(outcome.changed, vec!["a"]);
        assert!(outcome.added.is_empty());
    }

    /// The router fixed models_max at spawn, so Jan had to cold-restart the
    /// whole process just to add the embedding slot.
    #[test]
    fn reload_resizes_models_max() {
        let mut r = reg(1, &["a"]);
        r.reload(specs(&[("a", "a")]), 2);
        assert_eq!(r.models_max(), 2);
    }

    #[test]
    fn reload_clears_a_recorded_failure_so_a_fixed_model_is_retried() {
        let mut r = reg(1, &["a"]);
        // A failed load is what populates `failures`; without the engine
        // feature every acquire fails, which is exactly the state needed here.
        let _ = r.acquire("a");
        assert!(r.failure_of("a").is_some());
        r.reload(specs(&[("a", "a-fixed")]), 1);
        assert!(
            r.failure_of("a").is_none(),
            "a changed spec must not inherit the old failure"
        );
    }

    #[test]
    fn unload_refuses_a_model_that_is_not_loaded() {
        let mut r = reg(1, &["a"]);
        assert!(!r.unload("a"));
    }

    #[test]
    fn lru_picks_the_least_recently_used_idle_model() {
        let entries = [("old", 0usize, 1u64), ("new", 0, 2)];
        assert_eq!(
            pick_lru_idle(entries.iter().copied()).as_deref(),
            Some("old")
        );
    }

    #[test]
    fn a_busy_model_is_never_evicted_even_if_it_is_oldest() {
        // Upstream's rule (server-models.cpp:92-95): evicting a model with a
        // request in flight would cancel a live generation.
        let entries = [("old-but-busy", 3usize, 1u64), ("idle", 0, 9)];
        assert_eq!(
            pick_lru_idle(entries.iter().copied()).as_deref(),
            Some("idle")
        );
    }

    #[test]
    fn nothing_is_evictable_when_every_model_is_busy() {
        let entries = [("a", 1usize, 1u64), ("b", 2, 2)];
        assert_eq!(pick_lru_idle(entries.iter().copied()), None);
    }

    #[test]
    fn a_specs_model_path_is_found_in_either_spelling() {
        assert_eq!(
            spec_model_path(&["ctx-size = 4096".into(), "model = /m/a.gguf".into()]),
            Some("/m/a.gguf".to_string())
        );
        assert_eq!(
            spec_model_path(&["-m".into(), "/m/b.gguf".into()]),
            Some("/m/b.gguf".to_string())
        );
        assert_eq!(spec_model_path(&["ctx-size = 4096".into()]), None);
    }

    // `mmproj` and `model-draft` also end in a path; matching them would stamp
    // the state guard against the wrong file.
    #[test]
    fn a_key_merely_ending_in_model_is_not_the_model_path() {
        assert_eq!(spec_model_path(&["mmproj = /m/mm.gguf".into()]), None);
        assert_eq!(spec_model_path(&["model-draft = /m/d.gguf".into()]), None);
    }

    #[test]
    fn state_identity_follows_the_registered_spec() {
        let mut r = reg(1, &[]);
        r.register("m", spec("/m/a.gguf"));
        let id = r.state_identity("m").expect("registered");
        assert_eq!(id.model, "m");
        r.register("m", spec("/m/b.gguf"));
        assert_ne!(
            r.state_identity("m").unwrap().spec,
            id.spec,
            "a spec change must invalidate saved state"
        );
        assert!(r.state_identity("absent").is_none());
    }

    #[test]
    fn ticks_are_monotonic_so_lru_order_cannot_invert() {
        let a = next_tick();
        let b = next_tick();
        assert!(b > a, "tick went backwards: {a} then {b}");
    }
}
