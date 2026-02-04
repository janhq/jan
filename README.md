# Jan - Open-source ChatGPT replacement

<img width="2048" height="280" alt="github jan banner" src="https://github.com/user-attachments/assets/f3f87889-c133-433b-b250-236218150d3f" />

<p align="center">
  <!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
  <img alt="GitHub commit activity" src="https://img.shields.io/github/commit-activity/m/janhq/jan"/>
  <img alt="Github Last Commit" src="https://img.shields.io/github/last-commit/janhq/jan"/>
  <img alt="Github Contributors" src="https://img.shields.io/github/contributors/janhq/jan"/>
  <img alt="GitHub closed issues" src="https://img.shields.io/github/issues-closed/janhq/jan"/>
  <img alt="Discord" src="https://img.shields.io/discord/1107178041848909847?label=discord"/>
</p>

<p align="center">
<<<<<<< HEAD
  <a href="https://www.jan.ai/docs/desktop">Getting Started</a>
=======
  <a href="https://jan.ai/docs/desktop">Getting Started</a>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  - <a href="https://discord.gg/Exe46xPMbK">Community</a>
  - <a href="https://jan.ai/changelog">Changelog</a>
  - <a href="https://github.com/janhq/jan/issues">Bug reports</a>
</p>

Jan is bringing the best of open-source AI in an easy-to-use product. Download and run LLMs with **full control** and **privacy**.

## Installation

<p align="center">
  <table>
    <tr>
      <!-- Microsoft Store Badge -->
      <td align="center" valign="middle">
        <a href="https://apps.microsoft.com/detail/xpdcnfn5cpzlqb">
          <img height="60"
            width="200"
               alt="Get it from Microsoft Store"
               src="https://get.microsoft.com/images/en-us%20dark.svg"/>
        </a>
      </td>
      <!-- Spacer -->
      <td width="20"></td>
      <!-- Flathub Official Badge -->
      <td align="center" valign="middle">
        <a href="https://flathub.org/apps/ai.jan.Jan">
          <img height="60"
            width="200"
               alt="Get it on Flathub"
               src="https://flathub.org/assets/badges/flathub-badge-en.svg"/>
        </a>
      </td>
    </tr>
  </table>
</p>

The easiest way to get started is by downloading one of the following versions for your respective operating system:

<table>
  <tr>
    <td><b>Platform</b></td>
    <td><b>Download</b></td>
  </tr>
  <tr>
    <td><b>Windows</b></td>
    <td><a href='https://app.jan.ai/download/latest/win-x64'>jan.exe</a></td>
  </tr>
  <tr>
    <td><b>macOS</b></td>
    <td><a href='https://app.jan.ai/download/latest/mac-universal'>jan.dmg</a></td>
  </tr>
  <tr>
    <td><b>Linux (deb)</b></td>
    <td><a href='https://app.jan.ai/download/latest/linux-amd64-deb'>jan.deb</a></td>
  </tr>
  <tr>
    <td><b>Linux (AppImage)</b></td>
    <td><a href='https://app.jan.ai/download/latest/linux-amd64-appimage'>jan.AppImage</a></td>
  </tr>
<<<<<<< HEAD
</table>

=======
  <tr>
    <td><b>Linux (Arm64)</b></td>
    <td><a href='https://github.com/janhq/jan/issues/4543#issuecomment-3734911349'>How-to</a></td>
  </tr>
</table>


>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
Download from [jan.ai](https://jan.ai/) or [GitHub Releases](https://github.com/janhq/jan/releases).

## Features

- **Local AI Models**: Download and run LLMs (Llama, Gemma, Qwen, GPT-oss etc.) from HuggingFace
- **Cloud Integration**: Connect to GPT models via OpenAI, Claude models via Anthropic, Mistral, Groq, and others
- **Custom Assistants**: Create specialized AI assistants for your tasks
- **OpenAI-Compatible API**: Local server at `localhost:1337` for other applications
- **Model Context Protocol**: MCP integration for agentic capabilities
- **Privacy First**: Everything runs locally when you want it to

## Build from Source

For those who enjoy the scenic route:

### Prerequisites

<<<<<<< HEAD
- **Node.js** ≥ 20.0.0
- **Yarn** ≥ 1.22.0 (run `corepack enable` if not installed)
- **Make** ≥ 3.81
- **Rust** ≥ 1.77.2 (for Tauri - [install here](https://rustup.rs/))

**Platform-specific:**

- **Windows**: Visual Studio Build Tools with C++ workload
- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Linux**: `build-essential libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`

### Quick Start
=======
- Node.js ≥ 20.0.0
- Yarn ≥ 1.22.0
- Make ≥ 3.81
- Rust (for Tauri)

### Run with Make
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

```bash
git clone https://github.com/janhq/jan
cd jan
<<<<<<< HEAD
make install-and-build
make dev
```

**Important:** The build process downloads platform-specific binaries automatically. First build takes 5-10 minutes.

### Build Steps Explained

The build process follows this order:

1. **Download Binaries** (automatic on build)

   ```bash
   yarn download:bin  # Downloads llama.cpp and other native libs
   ```

2. **Install Dependencies**

   ```bash
   yarn install
   yarn config-yarn   # Configures yarn 4.5.3
   ```

3. **Build Workspace Packages**

   ```bash
   yarn build:tauri:plugin:api  # Tauri plugins
   yarn build:core              # Core library
   yarn build:extensions        # Native extensions
   yarn build:extensions-web    # Web extensions
   ```

4. **Run Development Server**
   ```bash
   yarn dev  # Launches Tauri app with hot reload
   ```

### Available Make Targets

- `make install-and-build` - Complete setup from scratch
- `make dev` - Launch development app (run install-and-build first)
- `make build` - Production build for your platform
- `make test` - Run tests and linting
- `make clean` - Delete build artifacts and start fresh

### Manual Build Commands

If Make isn't available or you need more control:

```bash
# One-time setup
corepack enable
yarn install
yarn download:bin

# Build workspace packages (required before first run)
yarn build:tauri:plugin:api
yarn build:core
yarn build:extensions
yarn build:extensions-web

# Development
yarn dev

# Production build
yarn build:tauri:win32   # Windows
yarn build:tauri:linux   # Linux
yarn build:tauri:darwin  # macOS (universal binary)
```

### Troubleshooting Build Issues

**"Cannot find module '@jan/extensions-web'"**

```bash
cd extensions-web && yarn build
```

**"Failed to resolve entry"** or missing bins

```bash
yarn download:bin
```

**Rust compilation errors**

```bash
rustup update
cargo clean
```

**"EACCES: permission denied"** (Linux/macOS)

```bash
chmod +x src-tauri/build-utils/*
=======
make dev
```

This handles everything: installs dependencies, builds core components, and launches the app.

**Available make targets:**
- `make dev` - Full development setup and launch
- `make build` - Production build
- `make test` - Run tests and linting
- `make clean` - Delete everything and start fresh

### Manual Commands

```bash
yarn install
yarn build:tauri:plugin:api
yarn build:core
yarn build:extensions
yarn dev
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
```

## System Requirements

**Minimum specs for a decent experience:**

- **macOS**: 13.6+ (8GB RAM for 3B models, 16GB for 7B, 32GB for 13B)
- **Windows**: 10+ with GPU support for NVIDIA/AMD/Intel Arc
- **Linux**: Most distributions work, GPU acceleration available

For detailed compatibility, check our [installation guides](https://jan.ai/docs/desktop/mac).

## Troubleshooting

If things go sideways:

<<<<<<< HEAD
1. Check our [troubleshooting docs](https://jan.ai/docs/troubleshooting)
2. Copy your error logs and system specs
3. Ask for help in our [Discord](https://discord.gg/FTk2MvZwJH) `#🆘|jan-help` channel

=======
1. Check our [troubleshooting docs](https://jan.ai/docs/desktop/troubleshooting)
2. Copy your error logs and system specs
3. Ask for help in our [Discord](https://discord.gg/FTk2MvZwJH) `#🆘|jan-help` channel


>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full spiel.

## Links

- [Documentation](https://jan.ai/docs) - The manual you should read
- [API Reference](https://jan.ai/api-reference) - For the technically inclined
- [Changelog](https://jan.ai/changelog) - What we broke and fixed
- [Discord](https://discord.gg/FTk2MvZwJH) - Where the community lives

## Contact

- **Bugs**: [GitHub Issues](https://github.com/janhq/jan/issues)
- **Business**: hello@jan.ai
- **Jobs**: hr@jan.ai
- **General Discussion**: [Discord](https://discord.gg/FTk2MvZwJH)

## License

Apache 2.0 - Because sharing is caring.

## Acknowledgements

Built on the shoulders of giants:

- [Llama.cpp](https://github.com/ggerganov/llama.cpp)
- [Tauri](https://tauri.app/)
- [Scalar](https://github.com/scalar/scalar)
