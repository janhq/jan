/// OpenClaw package name on npm
pub const OPENCLAW_PACKAGE_NAME: &str = "openclaw";

/// Pinned OpenClaw version (npm semver and Docker image tag)
/// This ensures config compatibility across installs.
pub const OPENCLAW_VERSION: &str = "2026.3.1";

/// Default OpenClaw gateway port
pub const DEFAULT_OPENCLAW_PORT: u16 = 18789;

/// Default Jan API base URL (direct process — same host)
pub const DEFAULT_JAN_BASE_URL: &str = "http://localhost:1337/v1";

/// Jan API base URL for Docker sandbox (container → host networking)
pub const DOCKER_JAN_BASE_URL: &str = "http://host.docker.internal:1337/v1";

/// Gateway bind mode — "lan" for all sandbox types.
pub const GATEWAY_BIND_MODE: &str = "lan";

/// Default API type for Jan
pub const DEFAULT_JAN_API_TYPE: &str = "openai-completions";

/// Default API key placeholder for the Jan provider.
/// Jan's local server doesn't require authentication, but OpenClaw's agent
/// system requires every provider to have a resolvable API key. This
/// placeholder satisfies that requirement for local models.
pub const DEFAULT_JAN_API_KEY: &str = "jan-local";

/// Default model ID for agents
pub const DEFAULT_MODEL_ID: &str = "llama-3.2-3b";