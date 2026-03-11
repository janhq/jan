/// OpenClaw package name on npm
pub const OPENCLAW_PACKAGE_NAME: &str = "openclaw";

/// Pinned OpenClaw version (npm semver and Docker image tag)
/// This ensures config compatibility across installs.
pub const OPENCLAW_VERSION: &str = "2026.3.2";

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

pub const DEFAULT_JAN_API_KEY: &str = "jan-local";

pub const DEFAULT_MODEL_ID: &str = "Jan-v3-4b-base-instruct-Q4_K_XL";