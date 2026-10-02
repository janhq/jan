# MLX Server

A high-performance inference server for MLX models, providing an OpenAI-compatible API for running large language models on Apple Silicon.

## Features

- **OpenAI-Compatible API** - Drop-in replacement for OpenAI API calls
- **Streaming Support** - Server-Sent Events for real-time token streaming
- **Tool Calling** - Support for function calls (OpenAI-compatible format)
- **Multi-Model Support** - LLM and VLM model support

## Requirements

- macOS 14.0+ (Sonoma or later)
- Apple Silicon (M1, M2, M3, M4)
- Xcode 26.2 or later (what CI selects; `Package.swift` declares `swift-tools-version: 5.12`)
- At least 8GB of unified memory

## Installation

### Building from Source

From the repo root:

```bash
# Builds with xcodebuild, then stages the binary and its Metal bundle into
# src-tauri/resources/bin/ - the same path the app and `make dev` use
make build-mlx-server
```

Or build it directly:

```bash
cd mlx-server
xcodebuild build -scheme mlx-server -destination 'platform=OS X' -configuration Release
```

Build products land in the `mlx-server-*/Build/Products/Release` directory under Xcode's
DerivedData. Use `xcodebuild`, not `swift build`: mlx-swift's Metal shaders are compiled
by its `PrepareMetalShaders` plugin, which only runs under Xcode, so a `swift build`
binary has no `default.metallib` and fails at inference time.

## Quick Start

```bash
# Run the staged build against a local MLX model directory
./src-tauri/resources/bin/mlx-server \
  --model "/path/to/your/model" \
  --port 8080
```

`--model` takes a local path. A directory is used directly when it has a `config.json`,
otherwise its parent directory is tried; no model is downloaded from Hugging Face.

## Command-Line Options

| Option | Default | Description |
|--------|---------|-------------|
| `-m, --model` | Required | Path to a local model directory, or to a file inside it |
| `--port` | 8080 | HTTP server port |
| `--ctx-size` | 4096 | Context window size |
| `--api-key` | `""` | API key for authentication (optional) |
| `--model-id` | `""` | Model ID reported by the API; empty derives it from the model path |

## API Endpoints

### Chat Completions

```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "model",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello, how are you?"}
    ],
    "temperature": 0.7,
    "max_tokens": 100
  }'
```

### Streaming Response

```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "model",
    "messages": [{"role": "user", "content": "Tell me a story."}],
    "stream": true
  }'
```

### Cancel Active Generation

```bash
curl -X POST http://localhost:8080/v1/cancel
```

### List Models

```bash
curl http://localhost:8080/v1/models
```

### Health Check

```bash
curl http://localhost:8080/health
```

## Project Structure

```
mlx-server/
├── Sources/
│   └── MLXServer/
│       ├── MLXServerCommand.swift    # CLI entry point
│       ├── ModelRunner.swift          # Core inference engine
│       ├── Server.swift               # HTTP server & API handlers
│       ├── OpenAITypes.swift          # API type definitions
│       ├── AnthropicTypes.swift       # Anthropic-compatible request/response types
│       ├── ReasoningSplitter.swift    # Splits reasoning_content from content on think markers
│       ├── TokenizerAdapter.swift     # Adapts swift-transformers to MLXLMCommon's TokenizerLoader
│       └── Logger.swift               # Logging utilities
├── Package.swift                      # Swift package manifest
└── README.md                          # This file
```

## Architecture

### Core Components

1. **ModelRunner** - Manages model loading and inference (streaming and non-streaming)
2. **MLXHTTPServer** - HTTP server with OpenAI-compatible endpoints
3. **ActiveGenerations** - Tracks and manages cancellable generation tasks

### Notes

- The server binds to `127.0.0.1` (localhost only) for security
- Client disconnects automatically cancel the active generation
- VLM (vision-language models) are supported via image/video URL inputs

## Troubleshooting

### Model Loading Fails

Ensure the model directory contains:
- `config.json` - Model configuration
- `tokenizer.json` - Tokenizer vocabulary
- `model.safetensors` or `model.safetensors.index.json` - Model weights
- Optional: `generation_config.json`, `chat_template.jinja`

### Port Already in Use

Change the port:
```bash
--port 8081
```

## Benchmarking

Use the [mlx-lm server benchmark script](https://github.com/ml-explore/mlx-lm/blob/main/benchmarks/server_benchmark.py) to measure throughput and latency:

```bash
python server_benchmark.py --url http://localhost:8080/v1/chat/completions --model model
```

## License

This project is part of Jan - an open-source desktop AI application.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Resources

- [MLX Swift](https://github.com/ml-explore/mlx-swift)
- [MLX Swift LM](https://github.com/ml-explore/mlx-swift-lm)
- [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat)
