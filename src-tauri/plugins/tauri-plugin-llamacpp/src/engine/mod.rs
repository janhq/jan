//! Safe wrapper over llama.cpp's `server-context`, reached through the C shim
//! in `shim/jan_llama_shim.cpp`.
//!
//! The engine runs *in this process*: no `llama-server` child, no downloaded
//! binary. Everything OpenAI-shaped -- chat templating, tool-call parsing,
//! reasoning extraction, sampling, slots, prompt cache, multimodal -- stays
//! inside llama.cpp's own `server_routes`, which the shim drives directly.
//! Requests and responses cross the boundary as JSON, so this file never has to
//! mirror `server_task`'s type model.
//!
//! This module is the project's single sanctioned `unsafe` carve-out; every
//! block carries a `SAFETY:` note and the module denies implicit unsafe.
#![deny(unsafe_op_in_unsafe_fn)]

use std::fmt;

pub mod commands;
pub mod http;
pub mod preset;
pub mod registry;
pub mod worker;
mod sys;

/// The llama.cpp this crate is pinned to, from `build.rs`.
pub const PINNED_TAG: &str = env!("JAN_LLAMA_CPP_TAG");
pub const PINNED_BUILD_NUMBER: &str = env!("JAN_LLAMA_CPP_BUILD_NUMBER");
pub const PINNED_COMMIT: &str = env!("JAN_LLAMA_CPP_COMMIT");
pub const PINNED_VERSION: &str = env!("JAN_LLAMA_CPP_VERSION");

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EngineError {
    /// Built without the `engine` feature, so there is nothing to talk to.
    Unavailable,
    /// The shim refused to start the engine; carries its message.
    Start(String),
    /// The linked llama.cpp is not the pinned one.
    VersionMismatch { expected: String, actual: String },
    /// A route name the shim does not know.
    UnknownRoute(String),
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unavailable => write!(
                f,
                "the llama.cpp engine was not compiled in (build with --features engine)"
            ),
            Self::Start(msg) => write!(f, "could not start the llama.cpp engine: {msg}"),
            Self::VersionMismatch { expected, actual } => write!(
                f,
                "linked llama.cpp is {actual}, but this crate is pinned to {expected}"
            ),
            Self::UnknownRoute(r) => write!(f, "unknown engine route: {r}"),
        }
    }
}

impl std::error::Error for EngineError {}

/// The `server_routes` members the shim can dispatch to. Naming follows
/// llama.cpp's own handler names so the mapping stays checkable by eye.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    Health,
    Props,
    Models,
    Slots,
    Completions,
    CompletionsOai,
    ChatCompletions,
    Embeddings,
    EmbeddingsOai,
    Rerank,
    Tokenize,
    Detokenize,
    ApplyTemplate,
}

impl Route {
    pub const fn as_shim_name(self) -> &'static str {
        match self {
            Self::Health => "get_health",
            Self::Props => "get_props",
            Self::Models => "get_models",
            Self::Slots => "get_slots",
            Self::Completions => "post_completions",
            Self::CompletionsOai => "post_completions_oai",
            Self::ChatCompletions => "post_chat_completions",
            Self::Embeddings => "post_embeddings",
            Self::EmbeddingsOai => "post_embeddings_oai",
            Self::Rerank => "post_rerank",
            Self::Tokenize => "post_tokenize",
            Self::Detokenize => "post_detokenize",
            Self::ApplyTemplate => "post_apply_template",
        }
    }

    /// Maps an HTTP path as the local API server sees it, so `proxy.rs` can
    /// forward without knowing shim names.
    pub fn from_http_path(path: &str) -> Option<Self> {
        match path.trim_end_matches('/') {
            "/health" => Some(Self::Health),
            "/props" => Some(Self::Props),
            "/v1/models" | "/models" => Some(Self::Models),
            "/slots" => Some(Self::Slots),
            "/completion" | "/completions" => Some(Self::Completions),
            "/v1/completions" => Some(Self::CompletionsOai),
            "/v1/chat/completions" | "/chat/completions" => Some(Self::ChatCompletions),
            "/embedding" | "/embeddings" => Some(Self::Embeddings),
            "/v1/embeddings" => Some(Self::EmbeddingsOai),
            "/rerank" | "/v1/rerank" => Some(Self::Rerank),
            "/tokenize" => Some(Self::Tokenize),
            "/detokenize" => Some(Self::Detokenize),
            "/apply-template" => Some(Self::ApplyTemplate),
            _ => None,
        }
    }
}

pub use sys::{Engine, Response};

/// Where the build put the runtime-loaded ggml backend modules.
///
/// ggml resolves them against the executable's own directory
/// (`ggml-backend-reg.cpp:492`), which is what a packaged build relies on. A
/// `cargo run`/`cargo test` binary sits in `target/<profile>/` with no such
/// neighbours, so `ensure_backend_path` points ggml at the build tree instead.
#[cfg(feature = "engine")]
pub const BUILD_BACKEND_DIR: &str = env!("JAN_GGML_BACKEND_DIR");

/// Registers the ggml compute backends, once, before any other ggml call.
///
/// A packaged install has the modules beside the executable, which is where
/// ggml looks by default, so it takes the `None` path. A `cargo run`/`cargo
/// test` binary does not, so it is pointed at the build tree instead.
///
/// The distinction matters because ggml's loader has no already-loaded guard
/// (`ggml-backend-reg.cpp` `load_backend`): pre-loading a directory *and*
/// letting `llama_backend_init` run its own search would register the same
/// backend twice. Pre-loading only when the default search will find nothing
/// keeps the two mutually exclusive.
#[cfg(feature = "engine")]
pub fn load_backend_modules() {
    use std::sync::Once;
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let beside_exe = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(std::path::Path::to_path_buf))
            .map(|dir| has_backend_module(&dir))
            .unwrap_or(false);
        if beside_exe || !std::path::Path::new(BUILD_BACKEND_DIR).is_dir() {
            Engine::load_backends(None);
        } else {
            log::debug!("loading ggml backends from the build tree: {BUILD_BACKEND_DIR}");
            Engine::load_backends(Some(BUILD_BACKEND_DIR));
        }
    });
}

/// A `ggml-*` shared object, by the naming ggml itself looks for.
#[cfg(feature = "engine")]
fn has_backend_module(dir: &std::path::Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    entries.filter_map(Result::ok).any(|e| {
        let name = e.file_name();
        let name = name.to_string_lossy();
        name.contains("ggml-")
            && (name.ends_with(".so") || name.ends_with(".dylib") || name.ends_with(".dll"))
    })
}

/// Fails when the linked llama.cpp drifts from the pin. Cheap, and worth doing
/// at startup: `common_params` and `llama_context_params` are passed by value
/// and their field order has changed repeatedly upstream, so a mismatched
/// library is memory corruption rather than a link error.
pub fn assert_pinned_version() -> Result<(), EngineError> {
    let actual_build = Engine::linked_build_number()?;
    let expected: i32 = PINNED_BUILD_NUMBER.parse().unwrap_or(-1);
    if actual_build != expected {
        return Err(EngineError::VersionMismatch {
            expected: format!("b{PINNED_BUILD_NUMBER} ({PINNED_VERSION})"),
            actual: format!("b{actual_build} ({})", Engine::linked_version()?),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin_constants_are_populated_from_build_rs() {
        assert_eq!(PINNED_TAG, "b10582");
        assert_eq!(PINNED_BUILD_NUMBER, "10582");
        assert_eq!(PINNED_VERSION, "0.2.0");
        assert_eq!(PINNED_COMMIT.len(), 40, "commit should be a full sha");
    }

    /// build.rs is the single source of the pin: `make engine-source` greps TAG
    /// and COMMIT out of it, clones the tag, and refuses to build if HEAD is not
    /// COMMIT. So the constants compiled in here must match the ones that file
    /// declares, or the Makefile would fetch one llama.cpp and we would claim
    /// another.
    #[test]
    fn the_pin_matches_what_the_makefile_will_fetch() {
        let build_rs = include_str!("../../build.rs");
        for (name, value) in [
            ("LLAMA_CPP_TAG", PINNED_TAG),
            ("LLAMA_CPP_COMMIT", PINNED_COMMIT),
            ("LLAMA_CPP_VERSION", PINNED_VERSION),
        ] {
            assert!(
                build_rs.contains(&format!("{name}: &str = \"{value}\"")),
                "{name} drifted from the compiled-in value {value}"
            );
        }

        // The Makefile's sed patterns only match at line start with this exact
        // shape; a reformat that still compiles would silently break the fetch.
        let makefile = include_str!("../../../../../Makefile");
        for name in ["LLAMA_CPP_TAG", "LLAMA_CPP_COMMIT"] {
            let pattern = format!("s/^pub const {name}: &str = ");
            assert!(
                makefile.contains(&pattern),
                "Makefile no longer greps {name} out of build.rs"
            );
            assert!(
                build_rs.contains(&format!("pub const {name}: &str = ")),
                "build.rs no longer declares {name} in the shape the Makefile greps"
            );
        }
    }

    /// The crate, the JS package and the llama.cpp semantic version are one
    /// number. Nothing here is published (`private: true`, `link:`/path deps),
    /// so they can track the engine rather than a release history of their own
    /// -- but only if all three move together.
    #[test]
    fn the_crate_and_js_package_versions_track_the_pinned_llama_cpp() {
        let cargo_toml = include_str!("../../Cargo.toml");
        assert!(
            cargo_toml.contains(&format!("\nversion = \"{PINNED_VERSION}\"")),
            "Cargo.toml version drifted from the pinned llama.cpp {PINNED_VERSION}"
        );
        let package_json = include_str!("../../package.json");
        assert!(
            package_json.contains(&format!("\"version\": \"{PINNED_VERSION}\"")),
            "package.json version drifted from the pinned llama.cpp {PINNED_VERSION}"
        );
    }

    #[test]
    fn every_route_round_trips_through_its_http_path() {
        // Guards against a route that is reachable by name but unreachable
        // from the proxy, which is how a command silently stops working.
        let all = [
            Route::Health,
            Route::Props,
            Route::Models,
            Route::Slots,
            Route::Completions,
            Route::CompletionsOai,
            Route::ChatCompletions,
            Route::Embeddings,
            Route::EmbeddingsOai,
            Route::Rerank,
            Route::Tokenize,
            Route::Detokenize,
            Route::ApplyTemplate,
        ];
        for r in all {
            assert!(
                !r.as_shim_name().is_empty(),
                "{r:?} has no shim name"
            );
        }
        assert_eq!(
            Route::from_http_path("/v1/chat/completions"),
            Some(Route::ChatCompletions)
        );
        assert_eq!(Route::from_http_path("/v1/models/"), Some(Route::Models));
        assert_eq!(Route::from_http_path("/nope"), None);
    }

    #[cfg(not(feature = "engine"))]
    #[test]
    fn without_the_feature_the_engine_reports_unavailable() {
        assert_eq!(Engine::linked_version(), Err(EngineError::Unavailable));
    }

    /// The whole point of the pin: prove the llama.cpp we linked is the one
    /// build.rs claims. A drift here means `common_params` may have a different
    /// layout than the shim was compiled against.
    #[cfg(feature = "engine")]
    #[test]
    fn the_linked_library_is_the_pinned_one() {
        assert_eq!(Engine::linked_version().unwrap(), PINNED_VERSION);
        assert_eq!(
            Engine::linked_build_number().unwrap().to_string(),
            PINNED_BUILD_NUMBER
        );
        assert!(
            PINNED_COMMIT.starts_with(&Engine::linked_commit().unwrap()),
            "linked commit {} is not a prefix of the pinned {PINNED_COMMIT}",
            Engine::linked_commit().unwrap()
        );
        assert_eq!(assert_pinned_version(), Ok(()));
    }
}
