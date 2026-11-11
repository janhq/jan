//! The consent store for tool calls the desktop app executes outside the CLI
//! loop: chat's MCP and extension tools, and the built-in tools that change a
//! folder attached to a chat.
//!
//! The webview shows the prompt; this store decides whether one is needed,
//! records the answer and holds the one-use authorization the executor takes
//! before it runs the call. An executor that finds no authorization refuses the
//! call, so a call the user was never asked about, or one asked for under
//! another tool, server or thread, cannot run.
//!
//! Grant scopes:
//! - once: the authorization itself, used up by the one call it was given for;
//! - thread: in memory, dropped on restart, never covering another thread;
//! - configuration: saved through the installed [`GrantsPersistence`], listed
//!   by [`saved`] and removed by [`revoke`]. Only an explicit "Allow always"
//!   creates one; nothing else is saved between launches.
//!
//! A `strict` request (a turn an extension's model serves, or a built-in call
//! that changes the attached folder) is asked every time and saves nothing,
//! whatever "allow all MCP" or a saved grant says.

use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use serde::{Deserialize, Serialize};

/// Server-name prefix of the tools an extension contributes. An MCP server the
/// user named this way is never trusted whole: that trust would also cover the
/// real extension's tools.
pub const EXTENSION_SERVER_PREFIX: &str = "ext:";

/// Who serves a tool, as the caller resolved it when the call arrived.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolOrigin {
    Mcp,
    Extension,
    /// A built-in agent tool (`write`, `edit`, `shell`, ...).
    Builtin,
}

/// One tool call a consent decision is asked for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsentRequest {
    pub thread_id: String,
    pub call_id: String,
    pub tool: String,
    #[serde(default)]
    pub server: Option<String>,
    pub origin: ToolOrigin,
    /// Ask whatever a grant says, and save nothing from the answer.
    #[serde(default)]
    pub strict: bool,
}

/// What the store decided for a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    /// Covered by a grant: authorized for this one call.
    Allowed,
    /// The user must answer ([`answer`]) before the call may run.
    Ask,
}

/// The user's answer to a prompt. Same wire values as the web app's
/// `ApprovalDecision`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConsentAnswer {
    AllowOnce,
    AllowThread,
    AllowAlways,
    Deny,
}

/// Configuration-level grants: the only ones saved between launches.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedGrants {
    /// Every MCP call runs unasked (never an extension's, never a strict one).
    #[serde(default)]
    pub allow_all_mcp: bool,
    /// MCP servers trusted whole, tools included.
    #[serde(default)]
    pub servers: BTreeSet<String>,
    /// Tools trusted on their own, by grant key (see [`grant_key`]).
    #[serde(default)]
    pub tools: BTreeSet<String>,
}

/// Which saved grant [`revoke`] removes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GrantKind {
    Server,
    Tool,
}

/// Where configuration-level grants are kept. The app installs one backed by
/// its settings store; without one (tests, the CLI) grants live in memory.
pub trait GrantsPersistence: Send + Sync {
    fn load(&self) -> SavedGrants;
    fn save(&self, grants: &SavedGrants);
}

#[derive(Default)]
struct Inner {
    loaded: bool,
    saved: SavedGrants,
    thread: HashMap<String, BTreeSet<String>>,
    /// Asked and not answered yet, by call id.
    asked: HashMap<String, ConsentRequest>,
    /// Allowed and not executed yet, by call id.
    authorized: HashMap<String, ConsentRequest>,
}

#[derive(Default)]
pub struct ConsentStore {
    inner: Mutex<Inner>,
    persistence: OnceLock<Arc<dyn GrantsPersistence>>,
}

/// The name a grant is recorded under. A tool with a server is keyed by it as
/// well, so a grant never covers a same-named tool of another server; MCP keys
/// carry an `mcp:` namespace so no extension can spell one.
pub fn grant_key(tool: &str, server: Option<&str>, origin: ToolOrigin) -> String {
    match (server, origin) {
        (None, _) => tool.to_string(),
        (Some(server), ToolOrigin::Extension) => format!("{server}/{tool}"),
        (Some(server), _) => format!("mcp:{server}/{tool}"),
    }
}

impl ConsentStore {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if !inner.loaded {
            inner.loaded = true;
            if let Some(p) = self.persistence.get() {
                inner.saved = p.load();
            }
        }
        inner
    }

    fn persist(&self, saved: &SavedGrants) {
        if let Some(p) = self.persistence.get() {
            p.save(saved);
        }
    }

    /// Install where saved grants live. Once per process; a later call is
    /// ignored and returns `false`.
    pub fn set_persistence(&self, persistence: Arc<dyn GrantsPersistence>) -> bool {
        self.persistence.set(persistence).is_ok()
    }

    pub fn request(&self, req: ConsentRequest) -> Verdict {
        let mut inner = self.lock();
        // A call id already decided keeps its first answer: asking again under
        // other parameters must not swap what the user saw.
        inner.asked.remove(&req.call_id);
        inner.authorized.remove(&req.call_id);
        if covered(&inner, &req) {
            inner.authorized.insert(req.call_id.clone(), req);
            Verdict::Allowed
        } else {
            inner.asked.insert(req.call_id.clone(), req);
            Verdict::Ask
        }
    }

    /// Record the user's answer to an asked call. Returns whether the call may
    /// run. An id that was not asked (or was cancelled meanwhile) is denied.
    pub fn answer(&self, call_id: &str, answer: ConsentAnswer) -> bool {
        let mut inner = self.lock();
        let Some(req) = inner.asked.remove(call_id) else {
            return false;
        };
        if answer == ConsentAnswer::Deny {
            return false;
        }
        let key = grant_key(&req.tool, req.server.as_deref(), req.origin);
        let mut changed = false;
        if !req.strict {
            match answer {
                ConsentAnswer::AllowThread => {
                    inner.thread.entry(req.thread_id.clone()).or_default().insert(key);
                }
                ConsentAnswer::AllowAlways => {
                    // An MCP server is trusted whole. An extension is not: an
                    // update can add tools, and those must ask before they run.
                    changed = match req.server.as_deref() {
                        Some(server)
                            if req.origin == ToolOrigin::Mcp
                                && !server.starts_with(EXTENSION_SERVER_PREFIX) =>
                        {
                            inner.saved.servers.insert(server.to_string())
                        }
                        _ => inner.saved.tools.insert(key),
                    };
                }
                ConsentAnswer::AllowOnce | ConsentAnswer::Deny => {}
            }
        }
        inner.authorized.insert(call_id.to_string(), req);
        let saved = changed.then(|| inner.saved.clone());
        drop(inner);
        if let Some(saved) = saved {
            self.persist(&saved);
        }
        true
    }

    /// Take the authorization for one call. Fails unless the call was allowed
    /// for exactly this thread, tool, server and origin; either way the call id
    /// is used up.
    pub fn consume(
        &self,
        thread_id: &str,
        call_id: &str,
        tool: &str,
        server: Option<&str>,
        origin: ToolOrigin,
    ) -> Result<(), String> {
        let granted = self.lock().authorized.remove(call_id);
        match granted {
            Some(req)
                if req.thread_id == thread_id
                    && req.tool == tool
                    && req.server.as_deref() == server
                    && req.origin == origin =>
            {
                Ok(())
            }
            Some(_) => Err(format!(
                "tool '{tool}' was not run: it was approved as a different tool call"
            )),
            None => Err(format!("tool '{tool}' was not run: it has not been approved")),
        }
    }

    /// End every pending ask and unused authorization of a thread (Stop, the
    /// thread deleted). Its thread grants stay unless `forget_grants`.
    pub fn cancel_thread(&self, thread_id: &str, forget_grants: bool) {
        let mut inner = self.lock();
        inner.asked.retain(|_, r| r.thread_id != thread_id);
        inner.authorized.retain(|_, r| r.thread_id != thread_id);
        if forget_grants {
            inner.thread.remove(thread_id);
        }
    }

    pub fn saved(&self) -> SavedGrants {
        self.lock().saved.clone()
    }

    pub fn revoke(&self, kind: GrantKind, name: &str) -> bool {
        let mut inner = self.lock();
        let removed = match kind {
            GrantKind::Server => inner.saved.servers.remove(name),
            GrantKind::Tool => inner.saved.tools.remove(name),
        };
        let saved = removed.then(|| inner.saved.clone());
        drop(inner);
        if let Some(saved) = saved {
            self.persist(&saved);
        }
        removed
    }

    pub fn set_allow_all_mcp(&self, allow: bool) {
        let mut inner = self.lock();
        if inner.saved.allow_all_mcp == allow {
            return;
        }
        inner.saved.allow_all_mcp = allow;
        let saved = inner.saved.clone();
        drop(inner);
        self.persist(&saved);
    }
}

fn covered(inner: &Inner, req: &ConsentRequest) -> bool {
    if req.strict || req.origin == ToolOrigin::Builtin {
        return false;
    }
    if req.origin == ToolOrigin::Mcp && inner.saved.allow_all_mcp {
        return true;
    }
    let key = grant_key(&req.tool, req.server.as_deref(), req.origin);
    if inner.saved.tools.contains(&key) {
        return true;
    }
    if req.origin == ToolOrigin::Mcp
        && req
            .server
            .as_deref()
            .is_some_and(|s| !s.starts_with(EXTENSION_SERVER_PREFIX) && inner.saved.servers.contains(s))
    {
        return true;
    }
    inner.thread.get(&req.thread_id).is_some_and(|keys| keys.contains(&key))
}

/// The process-wide store every executor checks.
pub fn store() -> &'static ConsentStore {
    static STORE: OnceLock<ConsentStore> = OnceLock::new();
    STORE.get_or_init(ConsentStore::default)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(thread: &str, call: &str, tool: &str, server: Option<&str>, origin: ToolOrigin) -> ConsentRequest {
        ConsentRequest {
            thread_id: thread.into(),
            call_id: call.into(),
            tool: tool.into(),
            server: server.map(Into::into),
            origin,
            strict: false,
        }
    }

    struct Memory(Mutex<Option<SavedGrants>>);
    impl GrantsPersistence for Memory {
        fn load(&self) -> SavedGrants {
            self.0.lock().unwrap().clone().unwrap_or_default()
        }
        fn save(&self, grants: &SavedGrants) {
            *self.0.lock().unwrap() = Some(grants.clone());
        }
    }

    #[test]
    fn an_approval_runs_its_one_call_only() {
        let s = ConsentStore::default();
        let r = req("t1", "c1", "search", Some("web"), ToolOrigin::Mcp);
        assert_eq!(s.request(r.clone()), Verdict::Ask);
        assert!(s.consume("t1", "c1", "search", Some("web"), ToolOrigin::Mcp).is_err());
        assert!(s.answer("c1", ConsentAnswer::AllowOnce));
        assert!(s.consume("t1", "c1", "search", Some("web"), ToolOrigin::Mcp).is_ok());
        assert!(s.consume("t1", "c1", "search", Some("web"), ToolOrigin::Mcp).is_err());
        // Once saves nothing: the next call asks again.
        assert_eq!(s.request(req("t1", "c2", "search", Some("web"), ToolOrigin::Mcp)), Verdict::Ask);
    }

    #[test]
    fn an_authorization_does_not_cover_another_tool_server_thread_or_origin() {
        let s = ConsentStore::default();
        for (thread, tool, server, origin) in [
            ("t2", "search", Some("web"), ToolOrigin::Mcp),
            ("t1", "fetch", Some("web"), ToolOrigin::Mcp),
            ("t1", "search", Some("other"), ToolOrigin::Mcp),
            ("t1", "search", Some("web"), ToolOrigin::Extension),
        ] {
            s.request(req("t1", "c", "search", Some("web"), ToolOrigin::Mcp));
            assert!(s.answer("c", ConsentAnswer::AllowOnce));
            assert!(s.consume(thread, "c", tool, server, origin).is_err());
            // Used up by the mismatched attempt.
            assert!(s.consume("t1", "c", "search", Some("web"), ToolOrigin::Mcp).is_err());
        }
    }

    #[test]
    fn a_thread_grant_stays_in_its_thread_and_is_never_saved() {
        let s = ConsentStore::default();
        let p = Arc::new(Memory(Mutex::new(None)));
        s.set_persistence(p.clone());
        s.request(req("t1", "c1", "search", Some("web"), ToolOrigin::Mcp));
        assert!(s.answer("c1", ConsentAnswer::AllowThread));
        assert_eq!(s.request(req("t1", "c2", "search", Some("web"), ToolOrigin::Mcp)), Verdict::Allowed);
        assert_eq!(s.request(req("t2", "c3", "search", Some("web"), ToolOrigin::Mcp)), Verdict::Ask);
        assert!(p.0.lock().unwrap().is_none(), "a thread grant is not persisted");
        s.cancel_thread("t1", true);
        assert_eq!(s.request(req("t1", "c4", "search", Some("web"), ToolOrigin::Mcp)), Verdict::Ask);
    }

    #[test]
    fn allow_always_trusts_an_mcp_server_but_only_the_tool_of_an_extension() {
        let s = ConsentStore::default();
        let p = Arc::new(Memory(Mutex::new(None)));
        s.set_persistence(p.clone());
        s.request(req("t1", "c1", "search", Some("web"), ToolOrigin::Mcp));
        assert!(s.answer("c1", ConsentAnswer::AllowAlways));
        assert_eq!(s.request(req("t9", "c2", "fetch", Some("web"), ToolOrigin::Mcp)), Verdict::Allowed);

        s.request(req("t1", "c3", "notes", Some("ext:acme"), ToolOrigin::Extension));
        assert!(s.answer("c3", ConsentAnswer::AllowAlways));
        assert_eq!(s.request(req("t1", "c4", "notes", Some("ext:acme"), ToolOrigin::Extension)), Verdict::Allowed);
        assert_eq!(s.request(req("t1", "c5", "other", Some("ext:acme"), ToolOrigin::Extension)), Verdict::Ask);
        // An MCP server named like an extension is not trusted whole either.
        s.request(req("t1", "c6", "x", Some("ext:acme"), ToolOrigin::Mcp));
        assert!(s.answer("c6", ConsentAnswer::AllowAlways));
        assert_eq!(s.request(req("t1", "c7", "notes", Some("ext:acme"), ToolOrigin::Extension)), Verdict::Allowed);
        assert_eq!(s.request(req("t1", "c8", "y", Some("ext:acme"), ToolOrigin::Mcp)), Verdict::Ask);

        let saved = p.0.lock().unwrap().clone().unwrap();
        assert!(saved.servers.contains("web"));
        assert!(saved.tools.contains("ext:acme/notes"));
        assert!(saved.tools.contains("mcp:ext:acme/x"));
        assert!(s.revoke(GrantKind::Server, "web"));
        assert_eq!(s.request(req("t1", "c9", "fetch", Some("web"), ToolOrigin::Mcp)), Verdict::Ask);
        assert!(!p.0.lock().unwrap().clone().unwrap().servers.contains("web"));
    }

    #[test]
    fn strict_and_builtin_requests_always_ask_and_save_nothing() {
        let s = ConsentStore::default();
        s.set_allow_all_mcp(true);
        let mut strict = req("t1", "c1", "search", Some("web"), ToolOrigin::Mcp);
        strict.strict = true;
        assert_eq!(s.request(strict.clone()), Verdict::Ask);
        assert!(s.answer("c1", ConsentAnswer::AllowAlways));
        assert!(s.saved().servers.is_empty());
        assert_eq!(s.request(req("t1", "c2", "search", Some("web"), ToolOrigin::Mcp)), Verdict::Allowed);

        let write = req("t1", "c3", "write", None, ToolOrigin::Builtin);
        assert_eq!(s.request(write.clone()), Verdict::Ask);
        assert!(s.answer("c3", ConsentAnswer::AllowThread));
        assert_eq!(s.request(req("t1", "c4", "write", None, ToolOrigin::Builtin)), Verdict::Ask);
        // "Allow all MCP" never covers an extension's tool.
        assert_eq!(s.request(req("t1", "c5", "n", Some("ext:a"), ToolOrigin::Extension)), Verdict::Ask);
    }

    #[test]
    fn deny_cancel_and_unknown_ids_never_authorize() {
        let s = ConsentStore::default();
        s.request(req("t1", "c1", "search", Some("web"), ToolOrigin::Mcp));
        assert!(!s.answer("c1", ConsentAnswer::Deny));
        assert!(s.consume("t1", "c1", "search", Some("web"), ToolOrigin::Mcp).is_err());
        assert!(!s.answer("never-asked", ConsentAnswer::AllowOnce));

        s.request(req("t1", "c2", "search", Some("web"), ToolOrigin::Mcp));
        s.cancel_thread("t1", false);
        assert!(!s.answer("c2", ConsentAnswer::AllowOnce), "a cancelled ask is denied");

        s.set_allow_all_mcp(true);
        assert_eq!(s.request(req("t1", "c3", "search", Some("web"), ToolOrigin::Mcp)), Verdict::Allowed);
        s.cancel_thread("t1", false);
        assert!(s.consume("t1", "c3", "search", Some("web"), ToolOrigin::Mcp).is_err());
    }

    #[test]
    fn saved_grants_load_lazily_from_persistence() {
        let s = ConsentStore::default();
        let mut saved = SavedGrants::default();
        saved.servers.insert("web".into());
        s.set_persistence(Arc::new(Memory(Mutex::new(Some(saved)))));
        assert_eq!(s.request(req("t1", "c1", "search", Some("web"), ToolOrigin::Mcp)), Verdict::Allowed);
    }
}
