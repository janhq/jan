/// PicoClaw GitHub repository owner
pub const PICOCLAW_REPO_OWNER: &str = "pico-ai";

/// PicoClaw GitHub repository name
pub const PICOCLAW_REPO_NAME: &str = "picoclaw";

/// Default PicoClaw gateway port
pub const DEFAULT_PICOCLAW_PORT: u16 = 8080;

/// Default Jan API base URL (same as OpenClaw)
pub const DEFAULT_JAN_BASE_URL: &str = "http://localhost:1337/v1";

/// Default model ID for agents
pub const DEFAULT_MODEL_ID: &str = "llama-3.2-3b";

/// Default system prompt for agents
pub const DEFAULT_SYSTEM_PROMPT: &str = "You are a helpful AI assistant running via Jan.";

/// PicoClaw binary name for different platforms
#[cfg(target_os = "macos")]
pub const PICOCLAW_BINARY_NAME: &str = "picoclaw";

#[cfg(target_os = "windows")]
pub const PICOCLAW_BINARY_NAME: &str = "picoclaw.exe";

#[cfg(target_os = "linux")]
pub const PICOCLAW_BINARY_NAME: &str = "picoclaw";

/// Get the platform-specific binary download name
pub fn get_binary_download_name() -> String {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    let os_name = match os {
        "macos" => "darwin",
        "windows" => "windows",
        "linux" => "linux",
        _ => "linux",
    };

    let arch_name = match arch {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        "arm" => "arm",
        _ => "amd64",
    };

    if os == "windows" {
        format!("picoclaw-{}-{}.exe", os_name, arch_name)
    } else {
        format!("picoclaw-{}-{}", os_name, arch_name)
    }
}

/// Get the GitHub releases URL for PicoClaw
pub fn get_releases_url() -> String {
    format!(
        "https://github.com/{}/{}/releases/latest/download/{}",
        PICOCLAW_REPO_OWNER,
        PICOCLAW_REPO_NAME,
        get_binary_download_name()
    )
}
