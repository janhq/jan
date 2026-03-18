# Contributing to Jan

First off, thank you for considering contributing to Jan. It's people like you that make Jan such an amazing project.

Jan is an AI assistant that can run 100% offline on your device. Think ChatGPT, but private, local, and under your complete control. If you're thinking about contributing, you're already awesome - let's make AI accessible to everyone, one commit at a time.

## Quick Links to Component Guides

- **[Web App](./web-app/CONTRIBUTING.md)** - React UI and logic
- **[Core SDK](./core/CONTRIBUTING.md)** - TypeScript SDK and extension system
- **[Extensions](./extensions/CONTRIBUTING.md)** - Supportive modules for the frontend
- **[Tauri Backend](./src-tauri/CONTRIBUTING.md)** - Rust native integration
- **[Tauri Plugins](./src-tauri/plugins/CONTRIBUTING.md)** - Hardware and system plugins

## How Jan Actually Works

Jan is a desktop app that runs local AI models. Here's how the components actually connect:

```
┌──────────────────────────────────────────────────────────┐
│                   Web App (Frontend)                     │
│                      (web-app/)                          │
│  • React UI                                              │
│  • Chat Interface                                        │
│  • Settings Pages                                        │
│  • Model Hub                                             │
└────────────┬─────────────────────────────┬───────────────┘
             │                             │
             │ imports                     │ imports
             ▼                             ▼
  ┌──────────────────────┐      ┌──────────────────────┐
  │     Core SDK         │      │     Extensions       │
  │      (core/)         │      │   (extensions/)      │
  │                      │      │                      │
  │ • TypeScript APIs    │◄─────│ • Assistant Mgmt     │
  │ • Extension System   │ uses │ • Conversations      │
  │ • Event Bus          │      │ • Downloads          │
  │ • Type Definitions   │      │ • LlamaCPP           │
  └──────────┬───────────┘      └───────────┬──────────┘
             │                              │
             │   ┌──────────────────────┐   │
             │   │       Web App        │   │
             │   └──────────┬───────────┘   │
             │              │               │
             └──────────────┼───────────────┘
                            │
                            ▼
                        Tauri IPC
                    (invoke commands)
                            │
                            ▼
┌───────────────────────────────────────────────────────────┐
│                   Tauri Backend (Rust)                    │
│                      (src-tauri/)                         │
│                                                           │
│  • Window Management        • File System Access          │
│  • Process Control          • System Integration          │
│  • IPC Command Handler      • Security & Permissions      │
└───────────────────────────┬───────────────────────────────┘
                            │
                            │
                            ▼
┌───────────────────────────────────────────────────────────┐
│                   Tauri Plugins (Rust)                    │
│                   (src-tauri/plugins/)                    │
│                                                           │
│     ┌──────────────────┐        ┌──────────────────┐      │
│     │  Hardware Plugin │        │  LlamaCPP Plugin │      │
│     │                  │        │                  │      │
│     │ • CPU/GPU Info   │        │ • Process Mgmt   │      │
│     │ • Memory Stats   │        │ • Model Loading  │      │
│     │ • System Info    │        │ • Inference      │      │
│     └──────────────────┘        └──────────────────┘      │
└───────────────────────────────────────────────────────────┘
```

### The Communication Flow

1. **JavaScript Layer Relationships**:
   - Web App imports Core SDK and Extensions as JavaScript modules
   - Extensions use Core SDK for shared functionality
   - All run in the browser/webview context

2. **All Three → Backend**: Through Tauri IPC
   - **Web App** → Backend: `await invoke('app_command', data)`
   - **Core SDK** → Backend: `await invoke('core_command', data)`
   - **Extensions** → Backend: `await invoke('ext_command', data)`
   - Each component can independently call backend commands

3. **Backend → Plugins**: Native Rust integration
   - Backend loads plugins as Rust libraries
   - Direct function calls, no IPC overhead

4. **Response Flow**:
   - Plugin → Backend → IPC → Requester (Web App/Core/Extension) → UI updates

### Real-World Example: Loading a Model

Here's what actually happens when you click "Download Llama 3":

1. **Web App** (`web-app/`) - User clicks download button
2. **Extension** (`extensions/download-extension`) - Handles the download logic
3. **Tauri Backend** (`src-tauri/`) - Actually downloads the file to disk
4. **Extension** (`extensions/llamacpp-extension`) - Prepares model for loading
5. **Tauri Plugin** (`src-tauri/plugins/llamacpp`) - Starts llama.cpp process
6. **Hardware Plugin** (`src-tauri/plugins/hardware`) - Detects GPU, optimizes settings
7. **Model ready!** - User can start chatting

## Project Structure

```
jan/
├── web-app/              # React frontend (what users see)
├── src-tauri/            # Rust backend (system integration)
│   ├── src/core/         # Core Tauri commands
│   └── plugins/          # Tauri plugins (hardware, llamacpp)
├── core/                 # TypeScript SDK (API layer)
├── extensions/           # JavaScript extensions
│   ├── assistant-extension/
│   ├── conversational-extension/
│   ├── download-extension/
│   └── llamacpp-extension/
├── docs/                 # Documentation website
├── website/              # Marketing website
├── autoqa/               # Automated testing
├── scripts/              # Build utilities
│
├── package.json          # Root workspace configuration
├── Makefile              # Build automation commands
├── LICENSE               # Apache 2.0 license
└── README.md             # Project overview
```

## Development Setup

### The Scenic Route (Build from Source)

**Prerequisites:**
- Node.js ≥ 20.0.0
- Yarn ≥ 4.5.3
- Make ≥ 3.81
- Rust (for Tauri)
- (macOS Apple Silicon only) MetalToolchain `xcodebuild -downloadComponent MetalToolchain`

**Option 1: The Easy Way (Make)**
```bash
git clone https://github.com/janhq/jan
cd jan
make dev
```

## How Can I Contribute?

### Reporting Bugs

- **Ensure the bug was not already reported** by searching on GitHub under [Issues](https://github.com/janhq/jan/issues)
- If you're unable to find an open issue addressing the problem, [open a new one](https://github.com/janhq/jan/issues/new)
- Include your system specs and error logs - it helps a ton

### Suggesting Enhancements

- Open a new issue with a clear title and description
- Explain why this enhancement would be useful
- Include mockups or examples if you can

### Your First Code Contribution

**Choose Your Adventure:**
- **Frontend UI and logic** → `web-app/`
- **Shared API declarations** → `core/`
- **Backend system integration** → `src-tauri/`
- **Business logic features** → `extensions/`
- **Dedicated backend handler** → `src-tauri/plugins/`

**The Process:**
1. Fork the repo
2. Create a new branch (`git checkout -b feature-name`)
3. Make your changes (and write tests!)
4. Commit your changes (`git commit -am 'Add some feature'`)
5. Push to the branch (`git push origin feature-name`)
6. Open a new Pull Request against `main` branch

## Testing

```bash
yarn test                    # All tests
cd src-tauri && cargo test  # Rust tests
cd autoqa && python main.py # End-to-end tests
```

## Code Standards

### TypeScript/JavaScript
- TypeScript required (we're not animals)
- ESLint + Prettier
- Functional React components
- Proper typing (no `any` - seriously!)

### Rust
- `cargo fmt` + `cargo clippy`
- `Result<T, E>` for error handling
- Document public APIs

## Git Conventions

### Branches
- `main` - main branch with latest & completed commits (target this branch for PRs)
- `release/*` - stable releases or upcoming release candidate
- `feature/*` - new features
- `fix/*` - bug fixes

### Commit Messages
- Use the present tense ("Add feature" not "Added feature")
- Be descriptive but concise
- Reference issues when applicable

Examples:
```
feat: add support for Qwen models
fix: resolve memory leak in model loading
docs: update installation instructions
```

## Troubleshooting

If things go sideways:

1. **Check our [troubleshooting docs](https://jan.ai/docs/desktop/troubleshooting)**
2. **Clear everything and start fresh:** `make clean` then `make dev`
3. **Copy your error logs and system specs**
4. **Ask for help in our [Discord](https://discord.gg/FTk2MvZwJH)** `#🆘|jan-help` channel

Common issues:
- **Build failures**: Check Node.js and Rust versions
- **Extension not loading**: Verify it's properly registered
- **Model not working**: Check hardware requirements and GPU drivers

## Getting Help

- [Documentation](https://jan.ai/docs) - The manual you should read
- [Discord Community](https://discord.gg/FTk2MvZwJH) - Where the community lives
- [GitHub Issues](https://github.com/janhq/jan/issues) - Report bugs here
- [GitHub Discussions](https://github.com/janhq/jan/discussions) - Ask questions

## License

Apache 2.0 - Because sharing is caring. See [LICENSE](./LICENSE) for the legal stuff.

## Additional Notes

We're building something pretty cool here - an AI assistant that respects your privacy and runs entirely on your machine. Every contribution, no matter how small, helps make AI more accessible to everyone.

Thanks for being part of the journey. Let's build the future of local AI together! 🚀
