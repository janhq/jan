# foundation-models-server

A lightweight OpenAI-compatible HTTP server that wraps Apple's Foundation Models framework, enabling Jan to use on-device Apple Intelligence models on macOS 26+.

## Requirements

- macOS 26 (Tahoe) or later
- Apple Silicon Mac with Apple Intelligence enabled
- Xcode 26 or later

## Building

```bash
swift build -c release
```

The binary will be at `.build/release/foundation-models-server`.

## Usage

```bash
# Check availability
foundation-models-server --check

# Start server on default port
foundation-models-server --port 8080

# Start server with API key
foundation-models-server --port 8080 --api-key <key>
```

## API

The server exposes an OpenAI-compatible API:

- `GET /health` — health check
- `GET /v1/models` — lists the `apple/on-device` model
- `POST /v1/chat/completions` — chat completions (streaming and non-streaming)

The model ID is always `apple/on-device`.
