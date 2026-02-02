# MLX Server

A high-performance inference server for MLX models, providing an OpenAI-compatible API for running large language models on Apple Silicon.

## Features

- **OpenAI-Compatible API** - Drop-in replacement for OpenAI API calls
- **Streaming Support** - Server-Sent Events for real-time token streaming
- **Batching** - Configurable batch processing for improved throughput
- **Prefix Caching** - KV cache optimization for repeated prompts
- **Tool Calling** - Support for function calls (OpenAI-compatible format)
- **Multi-Model Support** - LLM and VLM model support

## Requirements

- macOS 14.0+ ( Sonoma or later)
- Apple Silicon (M1, M2, M3, M4)
- Xcode 15+ for building
- At least 8GB of unified memory

## Installation

### Building from Source

```bash
# Clone the repository
cd mlx-server

# Build in release mode
swift build -c release

# The binary will be at:
# .build/arm64-apple-macosx/release/mlx-server
```

### Metallib Setup

MLX requires a compiled metallib for GPU operations. The metallib is automatically built when using Xcode. For Swift Package Manager builds, copy the metallib:

```bash
# Find the metallib from Xcode build products
METALLIB_PATH=$(find ~/Library/Developer/Xcode/DerivedData -name "default.metallib" | head -1)

# Copy to the release build directory
cp "$METALLIB_PATH" .build/arm64-apple-macosx/release/
```

## Quick Start

### Basic Usage

```bash
# Run with a local MLX model
./.build/arm64-apple-macosx/release/mlx-server \
  --model "/path/to/your/model" \
  --port 8080

# Or with a HuggingFace model ID
./.build/arm64-apple-macosx/release/mlx-server \
  --model "mlx-community/Qwen3-0.6B-4bit" \
  --port 8080
```

### With Performance Optimizations

```bash
# Enable continuous batching for better throughput
./.build/arm64-apple-macosx/release/mlx-server \
  --model "/path/to/model" \
  --port 8080 \
  --max-batch-size 8 \
  --enable-continuous-batching
```

## Command-Line Options

| Option | Default | Description |
|--------|---------|-------------|
| `-m, --model` | Required | Path to model directory or HuggingFace model ID |
| `--port` | 8080 | HTTP server port |
| `--ctx-size` | 4096 | Context window size |
| `--api-key` | "" | API key for authentication |
| `--max-batch-size` | 0 | Maximum batch size (0 = disabled) |
| `--batch-timeout-ms` | 100 | Batch timeout in milliseconds |
| `--enable-continuous-batching` | false | Enable continuous batching |
| `--kv-block-size` | 16 | KV cache block size in tokens |
| `--enable-prefix-caching` | false | Enable prefix caching (requires max-batch-size > 0) |

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

### List Models

```bash
curl http://localhost:8080/v1/models
```

### Health Check

```bash
curl http://localhost:8080/health
```

### Metrics

```bash
curl http://localhost:8080/metrics
```

## Benchmarking

### Using the Benchmark Script

```bash
cd scripts

# Install dependencies
pip install requests

# Run benchmarks
python3 performance_bench.py
```

### Sample Benchmark Results (Jan-v3-4B-base-instruct-8bit)

Sequential performance:
| Configuration | Avg Latency | Throughput |
|--------------|-------------|------------|
| temp=0.7, 50 tokens | 1569ms | **32 tokens/sec** |
| temp=0.7, 100 tokens | 3235ms | 31 tokens/sec |
| temp=0.1, 50 tokens | 1618ms | 31 tokens/sec |

Parallel performance (batch processing with max-batch-size=8):
| Concurrency | Wall Time | Throughput |
|-------------|-----------|------------|
| 2 | ~79s | 13 tokens/sec |
| 4 | ~159s | 6 tokens/sec |
| 8 | ~302s | 3 tokens/sec |

**Note:** For MLX on Apple Silicon, sequential processing is often optimal due to efficient utilization of unified memory. Parallel batching adds overhead but can improve throughput under high load.

### Simple Test Request

```bash
# Test single request
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "model",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 20,
    "temperature": 0.7
  }'
```

## Project Structure

```
mlx-server/
├── Sources/
│   └── MLXServer/
│       ├── MLXServerCommand.swift    # CLI entry point
│       ├── ModelRunner.swift          # Core inference engine
│       ├── Server.swift               # HTTP server & API handlers
│       ├── PromptCache.swift          # KV cache management
│       ├── BatchScheduler.swift       # Request batching
│       └── OpenAITypes.swift          # API type definitions
├── scripts/
│   ├── performance_bench.py          # Comprehensive benchmark with parallel tests
│   ├── simple_bench.py               # Simple request/response test
│   └── quick_bench.sh                # Quick shell benchmark
├── Package.swift                      # Swift package manifest
└── README.md                          # This file
```

## Architecture

### Core Components

1. **ModelRunner** - Manages model loading, warm-up, and inference
2. **MLXHTTPServer** - HTTP server with OpenAI-compatible endpoints
3. **PromptCache** - KV cache optimization for repeated prefixes
4. **BatchScheduler** - Request queuing and batch processing

### Performance Optimizations

- **Parallel Batch Execution** - Concurrent request processing using Swift structured concurrency
- **String Building** - Array-based accumulation to reduce allocations
- **Improved Hash Function** - FNV-1a hash for better cache hit rates
- **Continuous Batching** - Better GPU utilization under varying load
- **Priority Queue** - Request prioritization and adaptive sleep

## Integration with Jan

The mlx-server is designed to integrate with Jan for local LLM inference:

```json
{
  "backend": "mlx",
  "urls": ["http://127.0.0.1:8080/v1"],
  "apiKey": "optional-api-key"
}
```

## Troubleshooting

### Metal Library Not Found

```
MLX error: Failed to load the default metallib
```

Solution: Copy the metallib from Xcode build products:
```bash
METALLIB=$(find ~/Library/Developer/Xcode/DerivedData -name "default.metallib" | head -1)
cp "$METALLIB" .build/arm64-apple-macosx/release/
```

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