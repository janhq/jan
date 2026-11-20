use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, OwnedRwLockReadGuard, OwnedRwLockWriteGuard, RwLock};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub pid: i32,
    pub port: i32,
    pub model_id: String,
    pub is_embedding: bool,
    pub api_key: String,
}

pub struct LlamacppState {
    /// The supervised engine worker, when one is running.
    pub engine: Mutex<Option<crate::engine::worker::WorkerHandle>>,
    /// Persistent `/models/sse` subscriber, alive for the worker's lifetime.
    /// It is what turns an eviction Jan did not initiate into a frontend
    /// event, so it is aborted whenever the worker stops.
    pub unload_watcher: Mutex<Option<tokio::task::JoinHandle<()>>>,
    /// Requests hold the read side from before they resolve the worker's
    /// address until they are done with it; a device-change restart takes the
    /// write side. Reading `engine` and sending are two steps, so without this
    /// a restart could land between them and the request would hit a stopped
    /// worker.
    lifecycle: Arc<RwLock<()>>,
    /// The write side of `lifecycle` while a device-change restart is running.
    /// A restart spans two frontend calls (stop, then start), so it is kept
    /// here between them.
    restart: Mutex<Option<RestartGuard>>,
    /// Identifies the current restart, so the watchdog that frees an abandoned
    /// one never frees a later one.
    restart_epoch: AtomicU64,
}

/// A restart the frontend began and never finished (the page reloaded
/// mid-restart) would otherwise hold every request back for good.
const RESTART_MAX: Duration = Duration::from_secs(120);

/// Held by a request that resolved the engine worker's address, so the worker
/// is not restarted while the request still depends on it. Dropping it, which
/// includes the end of a streamed response, releases it.
#[must_use = "the lease only protects the worker while it is held"]
pub struct EngineLease(#[allow(dead_code)] OwnedRwLockReadGuard<()>);

impl EngineLease {
    /// Ties the lease to a response body, so it lasts until the body has been
    /// read to its end or dropped. A streamed response is read long after the
    /// handler that built it has returned, and a restart landing in between
    /// would cut the client off.
    pub fn guard<B: hyper::body::Body + Unpin>(self, body: B) -> LeasedBody<B> {
        LeasedBody { inner: body, _lease: self }
    }
}

/// A body that keeps an [`EngineLease`] alive for as long as it exists.
pub struct LeasedBody<B> {
    inner: B,
    _lease: EngineLease,
}

impl<B: hyper::body::Body + Unpin> hyper::body::Body for LeasedBody<B> {
    type Data = B::Data;
    type Error = B::Error;

    fn poll_frame(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Result<hyper::body::Frame<Self::Data>, Self::Error>>> {
        std::pin::Pin::new(&mut self.inner).poll_frame(cx)
    }

    fn is_end_stream(&self) -> bool {
        self.inner.is_end_stream()
    }

    fn size_hint(&self) -> hyper::body::SizeHint {
        self.inner.size_hint()
    }
}

/// Proof that no request holds a lease, and none can take one until it drops.
pub(crate) struct RestartGuard(#[allow(dead_code)] OwnedRwLockWriteGuard<()>);

impl Default for LlamacppState {
    fn default() -> Self {
        Self {
            engine: Mutex::new(None),
            unload_watcher: Mutex::new(None),
            lifecycle: Arc::new(RwLock::new(())),
            restart: Mutex::new(None),
            restart_epoch: AtomicU64::new(0),
        }
    }
}

impl LlamacppState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Take this before reading `engine` and keep it until the request that
    /// read it is finished. It waits while a restart is in progress, so a
    /// request that arrives mid-restart is served by the new worker instead of
    /// failing because there is none.
    pub async fn lease(&self) -> EngineLease {
        EngineLease(self.lifecycle.clone().read_owned().await)
    }

    /// `None` while any request holds a lease. Never waits: a restart that
    /// cannot start now is a restart that would interrupt work, and the caller
    /// reports that as busy rather than queueing behind it (which would also
    /// make every later request queue behind the queued restart).
    pub(crate) fn try_restart_guard(&self) -> Option<RestartGuard> {
        self.lifecycle
            .clone()
            .try_write_owned()
            .ok()
            .map(RestartGuard)
    }

    /// Starts a restart if no request is using the worker. Until
    /// `end_restart` (or `RESTART_MAX`), new leases wait.
    pub(crate) async fn begin_restart(self: &Arc<Self>) -> bool {
        let Some(guard) = self.try_restart_guard() else {
            return false;
        };
        let epoch = self.restart_epoch.fetch_add(1, Ordering::SeqCst) + 1;
        *self.restart.lock().await = Some(guard);
        let state = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(RESTART_MAX).await;
            if state.restart_epoch.load(Ordering::SeqCst) == epoch {
                log::warn!("a device-change restart was never finished; releasing it");
                state.restart.lock().await.take();
            }
        });
        true
    }

    pub(crate) async fn end_restart(&self) {
        self.restart_epoch.fetch_add(1, Ordering::SeqCst);
        self.restart.lock().await.take();
    }
}

#[cfg(test)]
mod lifecycle_tests {
    use super::LlamacppState;
    use std::time::Duration;

    #[tokio::test]
    async fn a_held_lease_refuses_a_restart() {
        let state = LlamacppState::new();
        let lease = state.lease().await;
        assert!(state.try_restart_guard().is_none());
        drop(lease);
        assert!(state.try_restart_guard().is_some());
    }

    #[tokio::test]
    async fn any_one_of_several_leases_is_enough_to_refuse() {
        let state = LlamacppState::new();
        let first = state.lease().await;
        let second = state.lease().await;
        drop(first);
        assert!(state.try_restart_guard().is_none());
        drop(second);
        assert!(state.try_restart_guard().is_some());
    }

    #[tokio::test]
    async fn a_request_arriving_mid_restart_waits_for_it_then_proceeds() {
        let state = std::sync::Arc::new(LlamacppState::new());
        let restart = state.try_restart_guard().expect("idle, so the restart starts");

        let waiter = {
            let state = state.clone();
            tokio::spawn(async move { state.lease().await })
        };
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(!waiter.is_finished(), "a lease must not be granted mid-restart");

        drop(restart);
        let lease = tokio::time::timeout(Duration::from_secs(2), waiter)
            .await
            .expect("the request proceeds once the restart is over")
            .unwrap();
        drop(lease);
    }

    /// A body fed by hand, standing in for a streamed engine response.
    struct ChannelBody(tokio::sync::mpsc::Receiver<bytes::Bytes>);

    impl hyper::body::Body for ChannelBody {
        type Data = bytes::Bytes;
        type Error = std::convert::Infallible;

        fn poll_frame(
            mut self: std::pin::Pin<&mut Self>,
            cx: &mut std::task::Context<'_>,
        ) -> std::task::Poll<Option<Result<hyper::body::Frame<bytes::Bytes>, Self::Error>>> {
            self.0.poll_recv(cx).map(|c| c.map(|b| Ok(hyper::body::Frame::data(b))))
        }
    }

    fn channel_body() -> (tokio::sync::mpsc::Sender<bytes::Bytes>, ChannelBody) {
        let (tx, rx) = tokio::sync::mpsc::channel(4);
        (tx, ChannelBody(rx))
    }

    // The lease has to outlive the handler: the response is streamed after it
    // returns, and a restart that lands mid-stream would cut the client off.
    #[tokio::test]
    async fn a_streamed_response_keeps_its_lease_until_it_is_read_to_the_end() {
        use http_body_util::BodyExt;
        let state = LlamacppState::new();
        let (tx, body) = channel_body();
        let mut body = state.lease().await.guard(body);

        tx.send(bytes::Bytes::from_static(b"chunk")).await.unwrap();
        let frame = body.frame().await.unwrap().unwrap();
        assert_eq!(frame.into_data().unwrap(), "chunk");
        assert!(
            state.try_restart_guard().is_none(),
            "still streaming: the lease must still be held"
        );

        drop(tx);
        assert!(body.frame().await.is_none());
        drop(body);
        assert!(state.try_restart_guard().is_some());
    }

    #[tokio::test]
    async fn a_response_dropped_unread_releases_its_lease() {
        let state = LlamacppState::new();
        let body = state
            .lease()
            .await
            .guard(http_body_util::Full::new(bytes::Bytes::from_static(b"whole body")));
        assert!(state.try_restart_guard().is_none());
        // The client went away without reading anything.
        drop(body);
        assert!(state.try_restart_guard().is_some());
    }

    #[tokio::test]
    async fn a_refused_restart_does_not_block_later_requests() {
        let state = LlamacppState::new();
        let lease = state.lease().await;
        assert!(state.try_restart_guard().is_none());
        // A queued writer would make this wait behind it; a refused one must not.
        let another = tokio::time::timeout(Duration::from_secs(1), state.lease())
            .await
            .expect("the refused restart left no writer queued");
        drop((lease, another));
    }
}
