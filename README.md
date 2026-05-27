<img src="https://github.com/AtomicBot-ai/Atomic-Chat/raw/main/assets/logo.png" width="80" alt="Atomic Chat" />

# Atomic Chat

Open-source ChatGPT alternative. Run local LLMs or connect cloud models — with full control and privacy.

<a href="https://github.com/AtomicBot-ai/Atomic-Chat/stargazers"><img src="https://img.shields.io/github/stars/AtomicBot-ai/Atomic-Chat?style=flat&logo=github&label=Stars&color=f5c542" alt="Stars" /></a>&nbsp;
<a href="https://github.com/AtomicBot-ai/Atomic-Chat/network/members"><img src="https://img.shields.io/github/forks/AtomicBot-ai/Atomic-Chat?style=flat&logo=github&label=Forks&color=4ac1f2" alt="Forks" /></a>&nbsp;
<a href="https://github.com/AtomicBot-ai/Atomic-Chat/graphs/contributors"><img src="https://img.shields.io/badge/Contributors-10-ff69b4?style=flat&logo=github" alt="Contributors" /></a>&nbsp;
<a href="https://github.com/AtomicBot-ai/Atomic-Chat/commits/main"><img src="https://img.shields.io/github/last-commit/AtomicBot-ai/Atomic-Chat?style=flat&label=Last%20Commit&color=blueviolet" alt="Last Commit" /></a>&nbsp;
<img src="https://img.shields.io/badge/Built_with-Tauri-FFC131?style=flat&logo=tauri&logoColor=white" alt="Tauri" />&nbsp;
<img src="https://img.shields.io/badge/Runtime-Node.js_≥20-339933?style=flat&logo=nodedotjs&logoColor=white" alt="Node.js" />

[Getting Started](https://atomic.chat/) · [Discord](https://discord.com/invite/8wGSsvmg4V) · [X / Twitter](https://x.com/atomic_chat_hq) · [Bug Reports](https://github.com/AtomicBot-ai/Atomic-Chat/issues)

<p align="center">
  <img src="https://github.com/AtomicBot-ai/Atomic-Chat/raw/main/assets/preview.png" width="100%" alt="Atomic Chat Interface" />
</p>

---

### Download

|                       |                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **macOS (Universal)** | [Atomic.Chat_1.1.83_universal.dmg](https://github.com/AtomicBot-ai/Atomic-Chat/releases/download/v1.1.83/Atomic.Chat_1.1.83_universal.dmg) |
| **Windows (x64)**     | [Atomic.Chat_1.1.83_x64-setup.exe](https://github.com/AtomicBot-ai/Atomic-Chat/releases/download/v1.1.83/Atomic.Chat_1.1.83_x64-setup.exe) |
| **iOS**               | [App Store](https://apps.apple.com/us/app/atomic-chat-private-local-ai/id6761720226)                                           |

Download from [atomic.chat](https://atomic.chat/) or [GitHub Releases](https://github.com/AtomicBot-ai/Atomic-Chat/releases) — latest: [v1.1.83](https://github.com/AtomicBot-ai/Atomic-Chat/releases/tag/v1.1.83).

---

### Contributors

Atomic Chat is built by a small team and a handful of community contributors. Pull requests welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for how to get started.

<a href="https://github.com/Vect0rM"><img src="https://images.weserv.nl/?url=https://github.com/Vect0rM.png&w=120&h=120&fit=cover&mask=circle" width="60" height="60" alt="Vect0rM" /></a>
<a href="https://github.com/dtorey-d"><img src="https://images.weserv.nl/?url=https://github.com/dtorey-d.png&w=120&h=120&fit=cover&mask=circle" width="60" height="60" alt="dtorey-d" /></a>
<a href="https://github.com/MaxKoshJob"><img src="https://images.weserv.nl/?url=https://github.com/MaxKoshJob.png&w=120&h=120&fit=cover&mask=circle" width="60" height="60" alt="MaxKoshJob" /></a>
<a href="https://github.com/Albert-Atomic"><img src="https://images.weserv.nl/?url=https://github.com/Albert-Atomic.png&w=120&h=120&fit=cover&mask=circle" width="60" height="60" alt="Albert-Atomic" /></a>
<a href="https://github.com/yanalialiuk"><img src="https://images.weserv.nl/?url=https://github.com/yanalialiuk.png&w=120&h=120&fit=cover&mask=circle" width="60" height="60" alt="yanalialiuk" /></a>
<a href="https://github.com/corevibe555"><img src="https://images.weserv.nl/?url=https://github.com/corevibe555.png&w=120&h=120&fit=cover&mask=circle" width="60" height="60" alt="corevibe555" /></a>
<a href="https://github.com/claytonlin1110"><img src="https://images.weserv.nl/?url=https://github.com/claytonlin1110.png&w=120&h=120&fit=cover&mask=circle" width="60" height="60" alt="claytonlin1110" /></a>
<a href="https://github.com/Fieldnote-Echo"><img src="https://images.weserv.nl/?url=https://github.com/Fieldnote-Echo.png&w=120&h=120&fit=cover&mask=circle" width="60" height="60" alt="Fieldnote-Echo" /></a>
<a href="https://github.com/Angelopgit"><img src="https://images.weserv.nl/?url=https://github.com/Angelopgit.png&w=120&h=120&fit=cover&mask=circle" width="60" height="60" alt="Angelopgit" /></a>

---

### Features

**Local models**

- Run open-weight LLMs locally from HuggingFace — Llama, Gemma, Qwen, Mistral, Phi, and others
- Multi-Token Prediction (MTP) speculative decoding — 30–70% throughput boost on supported models, up to 3× on Gemma 4
- DFlash block-diffusion decoding — up to 6× faster on Qwen 3.6, Gemma 4, Kimi K2.5
- Flash Attention toggle (`on` / `off` / `auto`)
- Automatic reasoning-context tracking for chain-of-thought models
- Auto context-window expansion with overflow notifications

**Cloud models**

- Built-in providers: OpenAI, Anthropic, Mistral, Groq, MiniMax, Qwen, Moonshot
- Bring your own key, switch model per chat, mix local and cloud freely

**Tools & integrations**

- Connect multiple [MCP](https://modelcontextprotocol.io/) servers — bring your own tools, file access, web search
- In-app log viewer for MCP tool calls
- Custom assistants with per-assistant system prompts
- Projects with conversation tree view in the sidebar

**Local API**

- OpenAI-compatible server at `http://localhost:1337/v1` — drop-in replacement for the OpenAI SDK
- Works with any agent, CLI, or IDE plugin that speaks the OpenAI API
- Bound to `127.0.0.1` by default; set `host: 0.0.0.0` to expose on LAN

**Privacy**

- Everything runs locally when you want it to — local server is loopback-only by default
- Your conversations and keys stay on your machine

---

### Inference Engines

Three engines under the hood, all exposed through one OpenAI-compatible API at `http://localhost:1337/v1`:

- **[atomic-llama-cpp-turboquant](https://github.com/AtomicBot-ai/atomic-llama-cpp-turboquant)** — our `llama.cpp` fork with TurboQuant optimizations for faster quantized inference. Cross-platform (macOS, Windows, Linux), CPU and GPU.
- **Upstream [llama.cpp](https://github.com/ggml-org/llama.cpp)** — official `ggml-org` build, used on Windows by default for the widest hardware coverage and MTP support.
- **[MLX-VLM](https://github.com/Blaizzy/mlx-vlm)** — Apple Silicon-native engine for vision-language models, running on the Neural Engine and unified memory. Faster than llama.cpp on M-series chips for supported models.

Speculative-decoding features available across backends:

- **MTP (Multi-Token Prediction)** — a draft model predicts ahead, the full model verifies in one pass. Available on macOS and Windows.
- **DFlash** — block-diffusion speculative decoding for Qwen 3.6, Gemma 4, Kimi K2.5 and others. Apple Silicon only; can't be enabled together with MTP.
- **Flash Attention** — Settings → `on` / `off` / `auto`.

Tools talking to `http://localhost:1337/v1` don't need to know which backend is running underneath — switch engines without reconfiguring clients.

---

### Launch With

Atomic Chat runs an OpenAI-compatible server at `http://localhost:1337/v1`, so **any agent, CLI, IDE plugin, or app that speaks the OpenAI API can run on top of your local models** — no extra glue needed. Just point its base URL at Atomic Chat and you're done.

A few projects already ship first-class support with their own setup docs:

| Tool | What it is | Setup |
| --- | --- | --- |
| **[OpenCode](https://opencode.ai/)** | Open-source TUI coding agent. Add Atomic Chat as a local provider in `opencode.json`. | [Setup&nbsp;guide&nbsp;→](https://opencode.ai/docs/providers/#atomic-chat) |
| **[OpenClaude](https://github.com/Gitlawb/openclaude)** | Open-source coding-agent CLI for cloud and local models. Lists Atomic Chat as a supported provider. | [Providers&nbsp;list&nbsp;→](https://github.com/Gitlawb/openclaude#supported-providers) |
| **[Goose](https://github.com/block/goose)** | Open-source extensible AI agent (CLI, desktop, API). | [Setup&nbsp;guide&nbsp;→](https://goose-docs.ai/docs/getting-started/providers/#local-llms) |
| **[Hermes Workspace](https://github.com/outsourc-e/hermes-workspace)** | Local-first agent workspace built on Nous Research's Hermes. Uses Atomic Chat as its inference backend. | [Repo&nbsp;→](https://github.com/outsourc-e/hermes-workspace) |
| **[nanobot](https://github.com/HKUDS/nanobot)** | Ultra-lightweight personal AI agent with chat channels, MCP, and WebUI. | [Repo&nbsp;→](https://github.com/HKUDS/nanobot) |
| **[nanoclaw](https://github.com/qwibitai/nanoclaw)** | Containerized agent runtime that calls Atomic Chat as an MCP tool. | [Skill&nbsp;guide&nbsp;→](https://github.com/qwibitai/nanoclaw/blob/main/.claude/skills/add-atomic-chat-tool/SKILL.md) |

> Built something that runs on Atomic Chat? [Open a PR](https://github.com/AtomicBot-ai/Atomic-Chat/pulls) and we'll add it here.

---

### Build from Source

#### Prerequisites

- Node.js ≥ 20.0.0
- Yarn ≥ 4.5.3
- Make ≥ 3.81
- Rust (for Tauri)
- (Apple Silicon) MetalToolchain `xcodebuild -downloadComponent MetalToolchain`

#### Run with Make

```bash
git clone https://github.com/AtomicBot-ai/Atomic-Chat
cd Atomic-Chat
make dev
```

This handles everything: installs dependencies, builds core components, and launches the app.

**Available make targets:**

- `make dev` — full development setup and launch
- `make build` — production build
- `make test` — run tests and linting
- `make clean` — delete everything and start fresh

#### Manual Commands

```bash
yarn install
yarn build:tauri:plugin:api
yarn build:core
yarn build:extensions
yarn dev
```

---

### System Requirements

- **macOS**: 13.6+ (8GB RAM for 3B models, 16GB for 7B, 32GB for 13B)
- **Windows**: 10/11 x64 (same RAM recommendations as macOS)
- **iOS**: 17+ (download from App Store)

---

### Troubleshooting

If something isn't working:

1. Copy your error logs and system specs
2. Open an issue on [GitHub](https://github.com/AtomicBot-ai/Atomic-Chat/issues)
3. Or ask for help in our [Discord](https://discord.com/invite/8wGSsvmg4V)

---

### Star History

<a href="https://star-history.com/#AtomicBot-ai/Atomic-Chat&Date">
  <img src="https://api.star-history.com/svg?repos=AtomicBot-ai/Atomic-Chat&type=Date" width="100%" alt="Star History" />
</a>

---

### License

Apache 2.0 — see [LICENSE](LICENSE) for details.

### Acknowledgements

Built on the shoulders of giants:

- [llama.cpp](https://github.com/ggml-org/llama.cpp)
- [MLX-VLM](https://github.com/Blaizzy/mlx-vlm)
- [Tauri](https://tauri.app/)
- [Scalar](https://github.com/scalar/scalar)

---

<p align="center">
  <sub>© 2026 Atomic Chat · Built with ❤️ · <a href="https://atomic.chat">atomic.chat</a></sub>
</p>
