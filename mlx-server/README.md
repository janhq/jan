# MLX Server

A high-performance inference server for MLX models on Apple Silicon, providing
an OpenAI-compatible HTTP API.

The backend is a **Python service** built on top of
[`AtomicBot-ai/mlx-vlm`](https://github.com/AtomicBot-ai/mlx-vlm)
(`mlx_vlm.server`) — an Atomic-Chat fork of
[`Blaizzy/mlx-vlm`](https://github.com/Blaizzy/mlx-vlm) — with native support
for **DFlash** speculative decoding (the `z-lab/*-DFlash` drafter family) and
**Gemma 4 MTP** drafting for accelerated generation.

## Features

- **OpenAI-Compatible API** — drop-in replacement for OpenAI Chat Completions
  and Responses endpoints.
- **Streaming** — Server-Sent Events for real-time token streaming.
- **Tool Calling** — function calls in OpenAI format with per-family parsers
  (Qwen 3 / 3.5 / 3-Coder, Hermes, Llama 3.1, Mistral, Gemma 4, GLM 4.7,
  MiniMax M2, Kimi K2, Long-Cat).
- **Vision & Audio** — multimodal inputs (image + audio) for VLMs and Omni
  models like Qwen-VL, Gemma 3n, MiniCPM-O.
- **DFlash Speculative Decoding** — block-diffusion drafting via
  `--draft-model ... --draft-kind dflash` for ~2-3× higher tokens/sec.
- **Gemma 4 MTP Drafting** — Multi-Token Prediction via `--draft-kind mtp` for
  Gemma 4 base/assistant pairs.
- **Continuous Batching** — concurrent requests share a single decoding batch.
- **Automatic Prefix Caching (APC)** — block-level K/V reuse across requests
  with shared prefixes (warm-memory + warm-disk tiers).
- **KV Cache Quantization** — uniform 8-bit and TurboQuant 3.5-bit for longer
  contexts under tighter memory.
- **Structured Outputs** — `response_format: json_schema` constrained
  generation.
- **Vision Feature Caching** — multi-turn conversations about the same image
  reuse projected vision features.
- **Cancellable generation** — client disconnect aborts in-flight generation
  server-side.

## Requirements

- macOS 14.0+ (Sonoma or later)
- Apple Silicon (M1, M2, M3, M4, M5)
- Python 3.10+
- At least 8 GB of unified memory (more for larger models)

## Installation

The backend lives in the
[`AtomicBot-ai/mlx-vlm`](https://github.com/AtomicBot-ai/mlx-vlm)
repository. Install in editable mode for development:

```bash
git clone https://github.com/AtomicBot-ai/mlx-vlm.git
cd mlx-vlm
pip install -e .
```

> Use a dedicated virtual environment — `transformers`, `mlx-lm`,
> `mlx-audio`, `opencv-python` and friends pull in a sizeable stack.

## Quick Start

### Plain MLX inference

```bash
python -m mlx_vlm.server \
  --model mlx-community/Qwen3.5-4B-MLX-4bit \
  --host 127.0.0.1 \
  --port 8080
```

### With DFlash speculative decoding

Provide a DFlash draft model that matches the target. Example for Qwen3.5-4B:

```bash
python -m mlx_vlm.server \
  --model Qwen/Qwen3.5-4B \
  --draft-model z-lab/Qwen3.5-4B-DFlash \
  --draft-kind dflash \
  --draft-block-size 16 \
  --host 127.0.0.1 \
  --port 8080
```

A list of supported target/draft pairs is published in the
[`z-lab/dflash` collection](https://huggingface.co/collections/z-lab/dflash).

### With Gemma 4 MTP drafting

```bash
python -m mlx_vlm.server \
  --model mlx-community/gemma-4-31B-it-bf16 \
  --draft-model mlx-community/gemma-4-31B-it-assistant-bf16 \
  --draft-kind mtp \
  --draft-block-size 4 \
  --host 127.0.0.1 \
  --port 8080
```

### Vision Language Model

```bash
python -m mlx_vlm.server \
  --model mlx-community/Qwen2.5-VL-3B-Instruct-4bit \
  --host 127.0.0.1 \
  --port 8080

curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen2.5-VL-3B-Instruct-4bit",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "What is in this image?"},
        {"type": "input_image", "image_url": "/path/to/image.jpg"}
      ]
    }],
    "max_tokens": 200
  }'
```

## Command-Line Options

### Server

| Option        | Default       | Description                                   |
|---------------|---------------|-----------------------------------------------|
| `--host`      | `0.0.0.0`     | Bind host (use `127.0.0.1` for loopback only) |
| `--port`      | `8080`        | HTTP port                                     |
| `--reload`    | off           | Uvicorn auto-reload (dev only)                |
| `--log-level` | `INFO`        | `DEBUG` / `INFO` / `WARNING` / `ERROR` / `CRITICAL` |

### Model loading

| Option                   | Default | Description                                                 |
|--------------------------|---------|-------------------------------------------------------------|
| `--model`                | (lazy)  | HF repo id or local MLX directory; preloads at startup      |
| `--adapter-path`         | (none)  | LoRA adapter to apply to the preloaded model                |
| `--trust-remote-code`    | off     | Allow model code from `transformers`/HF to execute on load  |
| `--vision-cache-size`    | `20`    | LRU cache size for projected vision features                |

### KV cache

| Option                  | Default     | Description                                       |
|-------------------------|-------------|---------------------------------------------------|
| `--max-kv-size`         | unlimited   | Cap KV cache tokens (per request)                 |
| `--kv-bits`             | (none)      | KV quantization bits (`8` uniform, `3.5` TurboQuant, …) |
| `--kv-quant-scheme`     | `uniform`   | `uniform` or `turboquant`                         |
| `--kv-group-size`       | `64`        | Group size for uniform KV quant                   |
| `--quantized-kv-start`  | (driver)    | Skip first N tokens before quantizing             |

### Speculative decoding

| Option              | Default  | Description                                                           |
|---------------------|----------|-----------------------------------------------------------------------|
| `--draft-model`     | (none)   | HF repo id or local path of a DFlash / MTP drafter                    |
| `--draft-kind`      | `dflash` | `dflash` (block-diffusion) or `mtp` (multi-token prediction, Gemma 4) |
| `--draft-block-size`| (auto)   | Override the drafter's configured block size                          |

### Generation defaults

| Option                | Default       | Description                                       |
|-----------------------|---------------|---------------------------------------------------|
| `--max-tokens`        | env-aware     | Default max new tokens                            |
| `--prefill-step-size` | (driver)      | Tokens per prefill step                           |
| `--top-logprobs-k`    | `0`           | Cap for `top_logprobs` (0 = disabled, max 20)     |

> **No `--api-key`**: the server is designed to bind to `127.0.0.1` for
> Atomic-Chat's local-only use case and has no built-in auth. Bind to a
> non-loopback host **only** behind your own reverse-proxy / firewall.

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

### Tool Calling

`tools` and `tool_choice` follow the OpenAI schema. The server picks the right
tool-call parser per model family (Qwen, Hermes, Llama 3.1, Mistral, Gemma 4,
GLM, MiniMax, Kimi K2, Long-Cat) and returns OpenAI-shaped `tool_calls` in a
final streaming chunk with `finish_reason: "tool_calls"`.

### Reasoning Control (Qwen3 / GLM-4.5 / Gemma 4)

Pass per-render template knobs via `chat_template_kwargs`:

```json
{ "chat_template_kwargs": { "enable_thinking": false } }
```

Templates that don't recognise the kwarg are gracefully ignored. When
thinking is enabled, the server emits the chain-of-thought as
`delta.reasoning` separately from the visible `delta.content`.

### Structured Outputs

`response_format: { type: "json_schema", json_schema: {...} }` constrains
generation against the supplied JSON schema (works with streaming and
non-streaming). **Note**: structured outputs and speculative decoding are
mutually exclusive.

### Cancel Active Generation

There is **no** dedicated `/v1/cancel` endpoint. To abort a running request,
**close the streaming connection** — the server detects the disconnect and
cancels the corresponding generation.

### Responses API

```bash
curl -X POST http://localhost:8080/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "model",
    "messages": [
      {"role": "user", "content": [
        {"type": "input_text", "text": "What is in this image?"},
        {"type": "input_image", "image_url": "/path/to/image.jpg"}
      ]}
    ],
    "max_tokens": 200
  }'
```

### List Models

```bash
curl http://localhost:8080/v1/models
```

> Lists Hugging Face cache repos that look like MLX-LM-compatible checkpoints.
> Atomic-Chat's local-API-server proxy synthesises its own model list from
> session state, so this endpoint is not consulted by the desktop app.

### Health Check

```bash
curl http://localhost:8080/health
```

Returns `{"status": "healthy", "loaded_model": "...", "loaded_adapter": "...",
"apc_enabled": false, ...}`.

### Unload Model

```bash
curl -X POST http://localhost:8080/unload
```

### APC (Automatic Prefix Cache)

```bash
curl http://localhost:8080/v1/cache/stats
curl -X POST http://localhost:8080/v1/cache/reset
```

APC is opt-in via env vars (`APC_ENABLED=1 APC_NUM_BLOCKS=4096 …`). See
mlx-vlm's main README for the full env table.

## Architecture

### Core Components

1. **`mlx_vlm.server`** — FastAPI + uvicorn HTTP server with OpenAI-compatible
   endpoints (`/v1/chat/completions`, `/v1/responses`, `/v1/models`,
   `/health`, `/unload`, `/v1/cache/*`).
2. **`ResponseGenerator` thread** — owns all GPU work: a dedicated thread runs
   the `BatchGenerator`, consuming continuous batches of decode steps. Image
   requests are prefilled individually; text-only requests are batched
   together for efficient prefill; all join a shared decode batch.
3. **Target model** — loaded via `mlx_vlm.utils.load`, which delegates to
   `mlx_lm.load` for text-only and `mlx_vlm` for VLM/Omni checkpoints.
4. **Drafter (optional)** — loaded via `load_drafter(kind=draft_kind)` from
   `mlx_vlm.speculative.drafters`; routes to `_dflash_rounds_batch` or
   `_mtp_rounds_batch` per kind.
5. **Tool-call parsers** — `mlx_vlm.tool_parsers.<family>` (overrides) +
   `mlx_lm.tool_parsers.<family>` (fallback). Detection happens via the
   tokenizer's chat template heuristic.
6. **APC** — `mlx_vlm.apc.APCManager` manages per-block K/V tensors with
   warm-memory + warm-disk tiers.

### Notes

- The server binds to whatever `--host` is passed; Atomic-Chat always passes
  `--host 127.0.0.1` for security (no auth layer).
- A client disconnect propagates as a cancel signal to `ResponseGenerator`,
  releasing the GPU slot.
- Streaming holds back partial tool-call marker prefixes so clients never
  observe a leaked half-marker.

## Troubleshooting

### Model Loading Fails

Ensure the target model directory contains:

- `config.json` — model configuration
- `tokenizer.json` — tokenizer vocabulary
- `model.safetensors` or `model.safetensors.index.json` — model weights
- Optional: `generation_config.json`, `chat_template.jinja`, vision /
  preprocessor configs

For models that ship custom modeling code, pass `--trust-remote-code`.

### DFlash Draft Model Mismatch

The draft must be trained against the chosen target. Use a published pair
from the [z-lab/dflash collection](https://huggingface.co/collections/z-lab/dflash)
or omit `--draft-model` to disable speculative decoding.

### Vision / Audio dependency errors

`opencv-python`, `Pillow`, `miniaudio`, `mlx-audio` are required for
multimodal inputs. They ship with the standalone macOS binary; for
development installs make sure the editable `pip install -e .` succeeded.

### Port Already in Use

```bash
--port 8081
```

## Benchmarking

Use the upstream APC sweep harness:

```bash
python scripts/bench_apc_context_sweep.py \
  --model Qwen/Qwen3-VL-4B-Instruct \
  --contexts 8000 20000 50000 100000 \
  --disk-cap-gb 0
```

Or the
[mlx-lm server benchmark script](https://github.com/ml-explore/mlx-lm/blob/main/benchmarks/server_benchmark.py)
against the running HTTP endpoint:

```bash
python server_benchmark.py --url http://localhost:8080/v1/chat/completions --model model
```

## License

This project is part of Jan — an open-source desktop AI application.

## Resources

- [AtomicBot-ai/mlx-vlm](https://github.com/AtomicBot-ai/mlx-vlm) — backend
  source (Atomic-Chat fork; this is the package the server is shipped from).
- [Blaizzy/mlx-vlm](https://github.com/Blaizzy/mlx-vlm) — upstream mlx-vlm
  project.
- [z-lab/dflash](https://huggingface.co/collections/z-lab/dflash) — DFlash
  speculative drafter checkpoints.
- [MLX](https://github.com/ml-explore/mlx) and
  [mlx-lm](https://github.com/ml-explore/mlx-lm).
- [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat).
- [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses).
