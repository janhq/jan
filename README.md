# Jan - Local AI Assistant

![Jan banner](./JanBanner.png)

<p align="center">
  <!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
  <img alt="GitHub commit activity" src="https://img.shields.io/github/commit-activity/m/menloresearch/jan"/>
  <img alt="Github Last Commit" src="https://img.shields.io/github/last-commit/menloresearch/jan"/>
  <img alt="Github Contributors" src="https://img.shields.io/github/contributors/menloresearch/jan"/>
  <img alt="GitHub closed issues" src="https://img.shields.io/github/issues-closed/menloresearch/jan"/>
  <img alt="Discord" src="https://img.shields.io/discord/1107178041848909847?label=discord"/>
</p>

<p align="center">
  <a href="https://jan.ai/docs/quickstart">Getting Started</a> 
  - <a href="https://jan.ai/docs">Docs</a> 
  - <a href="https://jan.ai/changelog">Changelog</a> 
  - <a href="https://github.com/menloresearch/jan/issues">Bug reports</a> 
  - <a href="https://discord.gg/AsJ8krTT3N">Discord</a>
</p>

Jan is a ChatGPT-alternative that runs 100% offline on your device. Our goal is to make it easy for a layperson to download and run LLMs and use AI with **full control** and **privacy**.

**⚠️ Jan is in active development.**

## Installation

Because clicking a button is still the easiest way to get started:

<table>
  <tr>
    <td><b>Platform</b></td>
    <td><b>Stable</b></td>
    <td><b>Beta</b></td>
    <td><b>Nightly</b></td>
  </tr>
  <tr>
    <td><b>Windows</b></td>
    <td><a href='https://app.jan.ai/download/latest/win-x64'>jan.exe</a></td>
    <td><a href='https://app.jan.ai/download/beta/win-x64'>jan.exe</a></td>
    <td><a href='https://app.jan.ai/download/nightly/win-x64'>jan.exe</a></td>
  </tr>
  <tr>
    <td><b>macOS</b></td>
    <td><a href='https://app.jan.ai/download/latest/mac-universal'>jan.dmg</a></td>
    <td><a href='https://app.jan.ai/download/beta/mac-universal'>jan.dmg</a></td>
    <td><a href='https://app.jan.ai/download/nightly/mac-universal'>jan.dmg</a></td>
  </tr>
  <tr>
    <td><b>Linux (deb)</b></td>
    <td><a href='https://app.jan.ai/download/latest/linux-amd64-deb'>jan.deb</a></td>
    <td><a href='https://app.jan.ai/download/beta/linux-amd64-deb'>jan.deb</a></td>
    <td><a href='https://app.jan.ai/download/nightly/linux-amd64-deb'>jan.deb</a></td>
  </tr>
  <tr>
    <td><b>Linux (AppImage)</b></td>
    <td><a href='https://app.jan.ai/download/latest/linux-amd64-appimage'>jan.AppImage</a></td>
    <td><a href='https://app.jan.ai/download/beta/linux-amd64-appimage'>jan.AppImage</a></td>
    <td><a href='https://app.jan.ai/download/nightly/linux-amd64-appimage'>jan.AppImage</a></td>
  </tr>
</table>

Download from [jan.ai](https://jan.ai/) or [GitHub Releases](https://github.com/menloresearch/jan/releases).

## Demo

<video width="100%" controls>
  <source src="./docs/public/assets/videos/enable-tool-call-for-models.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

## Features

- **Local AI Models**: Download and run LLMs (Llama, Gemma, Qwen, etc.) from HuggingFace
- **Cloud Integration**: Connect to OpenAI, Anthropic, Mistral, Groq, and others
- **Custom Assistants**: Create specialized AI assistants for your tasks
- **OpenAI-Compatible API**: Local server at `localhost:1337` for other applications
- **Model Context Protocol**: MCP integration for enhanced capabilities
- **Privacy First**: Everything runs locally when you want it to

## Build from Source

For those who enjoy the scenic route:

### Prerequisites

- Node.js ≥ 20.0.0
- Yarn ≥ 1.22.0
- Make ≥ 3.81
- Rust (for Tauri)

### Quick Start

```bash
git clone https://github.com/menloresearch/jan
cd jan
make dev
```

This handles everything: installs dependencies, builds core components, and launches the app.

### Alternative Commands

If you prefer the verbose approach:

```bash
# Setup and development
yarn install
yarn build:core
yarn build:extensions
yarn dev

# Production build
yarn build

# Clean slate (when things inevitably break)
make clean
```

### Available Make Targets

- `make dev` - Full development setup and launch (recommended)
- `make dev-tauri` - Tauri development (deprecated, use `make dev`)
- `make build` - Production build
- `make install-and-build` - Install dependencies and build core/extensions
- `make test` - Run tests and linting
- `make lint` - Check your code doesn't offend the linters
- `make clean` - Nuclear option: delete everything and start fresh

## System Requirements

**Minimum specs for a decent experience:**

- **macOS**: 13.6+ (8GB RAM for 3B models, 16GB for 7B, 32GB for 13B)
- **Windows**: 10+ with GPU support for NVIDIA/AMD/Intel Arc
- **Linux**: Most distributions work, GPU acceleration available

For detailed compatibility, check our [installation guides](https://jan.ai/docs/desktop/mac).

## Troubleshooting

When things go sideways (they will):

1. Check our [troubleshooting docs](https://jan.ai/docs/troubleshooting)
2. Copy your error logs and system specs
3. Ask for help in our [Discord](https://discord.gg/FTk2MvZwJH) `#🆘|jan-help` channel

We keep logs for 24 hours, so don't procrastinate on reporting issues.

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full spiel.

## Links

- [Documentation](https://jan.ai/docs) - The manual you should read
- [API Reference](https://jan.ai/api-reference) - For the technically inclined
- [Changelog](https://jan.ai/changelog) - What we broke and fixed
- [Discord](https://discord.gg/FTk2MvZwJH) - Where the community lives

## Contact

- **Bugs**: [GitHub Issues](https://github.com/menloresearch/jan/issues)
- **Business**: hello@jan.ai
- **Jobs**: hr@jan.ai
- **General Discussion**: [Discord](https://discord.gg/FTk2MvZwJH)

## Trust & Safety

**Friendly reminder**: We're not trying to scam you.

- We won't ask for personal information
- Jan is completely free (no premium version exists)
- We don't have a cryptocurrency or ICO
- We're bootstrapped and not seeking your investment (yet)

## License

Apache 2.0 - Because sharing is caring.

## Acknowledgements

Built on the shoulders of giants:

- [Llama.cpp](https://github.com/ggerganov/llama.cpp)
- [Tauri](https://tauri.app/)
- [Scalar](https://github.com/scalar/scalar)
