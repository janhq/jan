//! Which connection an MCP server name refers to, so a tool call reaches the
//! server that advertised the tool and nothing else.
//!
//! A server name is not an identity: a server that disconnects and reconnects,
//! or is edited and restarted, comes back under the same name with a new
//! process, possibly a different tool set. Each connection therefore gets a
//! generation when it is put in the servers map, and a tool is advertised
//! together with the generation it was listed from. A call whose generation is
//! no longer the server's current one is refused rather than run on whatever
//! now answers to that name.
//!
//! A tool name offered by two servers is ambiguous: the model calls tools by
//! bare name, so no call to it can be attributed to one of them. Such names,
//! and empty ones, are left out of every listing rather than routed to a
//! guess.
//!
//! Generations come from one process-wide counter and are never reused, so a
//! server removed and added back cannot match a call made to its predecessor.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};

/// The generation of a server name no connection was registered for. Never
/// handed out by [`insert_server`].
const UNREGISTERED: u64 = 0;

/// Where a call to an advertised tool must go.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolRoute {
    pub server: String,
    pub generation: u64,
}

/// Advertised tool name -> the connection that offered it.
pub type ToolRoutes = HashMap<String, ToolRoute>;

static NEXT_GENERATION: AtomicU64 = AtomicU64::new(UNREGISTERED + 1);
static GENERATIONS: LazyLock<Mutex<HashMap<String, u64>>> = LazyLock::new(Default::default);

fn generations() -> &'static Mutex<HashMap<String, u64>> {
    &GENERATIONS
}

/// Puts a freshly connected service in the servers map under a new
/// generation. Every insertion into a servers map goes through here, with the
/// map's lock held by the caller, so a call that validates its generation under
/// the same lock cannot interleave with a replacement.
pub fn insert_server<V>(servers: &mut HashMap<String, V>, name: &str, service: V) -> u64 {
    let generation = NEXT_GENERATION.fetch_add(1, Ordering::Relaxed);
    generations()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(name.to_string(), generation);
    servers.insert(name.to_string(), service);
    generation
}

/// The generation of the connection currently registered under `name`.
pub fn current_generation(name: &str) -> u64 {
    generations()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(name)
        .copied()
        .unwrap_or(UNREGISTERED)
}

/// Refuses a call made to a connection that has since been replaced.
pub fn check_generation(server: &str, generation: u64) -> Result<(), String> {
    if current_generation(server) == generation {
        Ok(())
    } else {
        Err(format!(
            "MCP server '{server}' restarted since this tool was offered; the call was not run. Retry to use the server's current tools."
        ))
    }
}

/// Tool names that cannot be routed: empty, or offered by more than one
/// server. `tools` yields `(server, tool name)` pairs.
pub fn unroutable_tool_names<'a>(
    tools: impl IntoIterator<Item = (&'a str, &'a str)>,
) -> HashSet<String> {
    let mut owner: HashMap<&str, &str> = HashMap::new();
    let mut unroutable = HashSet::new();
    for (server, tool) in tools {
        if tool.is_empty() {
            unroutable.insert(String::new());
            continue;
        }
        match owner.insert(tool, server) {
            Some(previous) if previous != server => {
                unroutable.insert(tool.to_string());
            }
            _ => {}
        }
    }
    for name in &unroutable {
        if !name.is_empty() {
            log::warn!(
                "MCP tool '{name}' is offered by more than one server; it is not offered to the model until only one server provides it"
            );
        }
    }
    unroutable
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reconnect_invalidates_the_generation_a_tool_was_listed_from() {
        let mut servers: HashMap<String, ()> = HashMap::new();
        let first = insert_server(&mut servers, "identity-test-reconnect", ());
        assert!(check_generation("identity-test-reconnect", first).is_ok());

        let second = insert_server(&mut servers, "identity-test-reconnect", ());
        assert_ne!(first, second);
        assert!(check_generation("identity-test-reconnect", first).is_err());
        assert!(check_generation("identity-test-reconnect", second).is_ok());
    }

    #[test]
    fn generations_are_never_reused_across_names() {
        let mut servers: HashMap<String, ()> = HashMap::new();
        let a = insert_server(&mut servers, "identity-test-a", ());
        let b = insert_server(&mut servers, "identity-test-b", ());
        assert_ne!(a, b);
        assert_ne!(a, UNREGISTERED);
        assert!(check_generation("identity-test-b", a).is_err());
    }

    #[test]
    fn a_name_offered_by_two_servers_or_left_empty_is_unroutable() {
        let names = unroutable_tool_names([
            ("fs", "search"),
            ("web", "search"),
            ("fs", "read"),
            ("fs", "read"),
            ("git", ""),
        ]);
        assert!(names.contains("search"));
        assert!(names.contains(""));
        // One server listing a name twice is not a collision between servers.
        assert!(!names.contains("read"));
    }
}
