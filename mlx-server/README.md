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
- Xcode 15+ for building
- At least 8GB of unified memory

## Installation

### Building from Source

```bash
# Clone the repository
cd mlx-server

# Build in release mode
xcodebuild -scheme mlx-server -configuration Release

# The binary and metallib will be in the Xcode derived data build products
```

## Quick Start

```bash
# Run with a local MLX model
./.build/arm64-apple-macosx/release/mlx-server \
  --model "/path/to/your/model" \
  --port 8080
```

## Command-Line Options

| Option | Default | Description |
|--------|---------|-------------|
| `-m, --model` | Required | Path to model directory or HuggingFace model ID |
| `--port` | 8080 | HTTP server port |
| `--ctx-size` | 4096 | Context window size |
| `--api-key` | `""` | API key for authentication (optional) |

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
