# RongxinAI - Local AI Inference Desktop App

<p align="center">
  <a href="README.md">中文</a> ·
  <strong>English</strong>
</p>

<p align="center">
  <img alt="GitHub commit activity" src="https://img.shields.io/github/commit-activity/m/rongxinzy/jan"/>
  <img alt="Github Last Commit" src="https://img.shields.io/github/last-commit/rongxinzy/jan"/>
  <img alt="GitHub closed issues" src="https://img.shields.io/github/issues-closed/rongxinzy/jan"/>
</p>

RongxinAI (RongxinAI) is an open-source AI desktop application deeply customized based on [Jan](https://github.com/janhq/jan), focused on providing Chinese users with a **localized, private, zero-config** large language model inference experience.

> All data runs locally, never uploaded to the cloud. Your privacy is fully protected.

## Quick Start

Download the installer from [GitHub Releases](https://github.com/rongxinzy/jan/releases).

## Key Features

- **Ollama Integration**: Default Ollama local inference engine, zero configuration
- **ModelScope Marketplace**: Built-in ModelScope model discovery, no HuggingFace access issues
- **Multi-Engine**: Ollama (default), llama.cpp, MLX support
- **Cloud APIs**: OpenAI, Anthropic, Mistral and more
- **Privacy First**: All inference happens locally
- **Chinese Optimized**: Default Simplified Chinese UI, optimized for Qwen series models
- **OpenAI-Compatible API**: Local server at `localhost:1337`

## Build from Source

```bash
git clone https://github.com/rongxinzy/jan.git
cd jan
yarn install
yarn tauri build
```

## License

Apache 2.0

---

<p align="center">
  <i>RongxinAI - AI inference at your fingertips</i>
</p>
