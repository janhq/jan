---
name: jan-serve-models
description: >-
  Serve local models with the Jan CLI and wire coding agents to them: jan
  serve (LlamaCPP or MLX at localhost:6767/v1), jan launch for Claude Code
  or OpenClaw, jan models and jan threads, HuggingFace model IDs, and
  LLAMA_ARG_ settings. Use when someone wants to run a local model behind
  an OpenAI-compatible endpoint or point an agent at local inference.
---

# Serving local models with Jan

Reference: `docs/src/pages/docs/desktop/cli.mdx`.

The `jan` CLI is installed by the desktop app on first launch
(`/usr/local/bin/jan` or `~/.local/bin/jan`; reinstall from
**Settings > General > Jan CLI**). The CLI and desktop app share one data
folder, so models installed in either are available to both.

## Serve a model

```bash
jan models list
jan serve janhq/Jan-code-4b-gguf                 # http://localhost:6767/v1
jan serve unsloth/Qwen3.5-9B-GGUF                # downloads from HuggingFace if missing
jan serve <model> --port 8080 --api-key "$KEY"   # require a bearer key
jan serve <model> --detach                       # background, prints PID
jan models load-mlx <id>                         # MLX, Apple Silicon only
```

Options: `--port` (0 = random), `--api-key`, `-d/--detach`, `--timeout`
(default 120 s), `-v/--verbose`. Omit the model to choose interactively.

Since Jan 0.8.0 llama-server runs in router mode: `--ctx-size`,
`--n-gpu-layers`, `--threads` and `--fit` are accepted but ignored.
Per-model settings come from `<data-folder>/llamacpp/router.preset.ini`,
edited from the desktop UI. `LLAMA_ARG_*` environment variables are passed
to the router, e.g. `LLAMA_ARG_HOST=0.0.0.0`; only bind beyond localhost
with an API key set.

## Launch an agent on a local model

```bash
jan launch claude --model janhq/Jan-code-4b-gguf
jan launch openclaw --model qwen3.5-35b-a3b
```

`jan launch` starts the model, then the agent with `OPENAI_API_KEY` and
`ANTHROPIC_AUTH_TOKEN` set to `--api-key` (default `jan`) and the base URL
pointed at the local server.

## Threads from the desktop app

```bash
jan threads list
jan threads get <id>
jan threads messages <thread-id>
jan threads delete <id>          # permanent; confirm first
```

## Using the endpoint

Any OpenAI-compatible client works against `http://localhost:6767/v1`
(`/chat/completions`, `/models`). Use the model ID shown by
`jan models list`.
