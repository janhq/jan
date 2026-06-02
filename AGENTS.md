# AGENTS.md — Atomic Chat

Operational guide for AI coding agents working in this repository.
Humans: this is a quick orientation; the source of truth for end-user docs is
`README.md` and `DEVELOP.md`.

---

## 1. Product identity

- **Product name:** **Atomic Chat**.
- **Origin:** hard fork of [Jan](https://github.com/janhq/jan). Significant
  parts of the codebase still carry the original `jan*` / `@janhq/*` naming
  for historical reasons (see §6 *Known naming debt*).
- **Direction:** all **new** features, modules, identifiers, package names,
  log lines, user-facing strings, and product copy must use **Atomic Chat**
  branding — not Jan. We are actively moving away from Jan, but renaming
  existing artefacts is a separate, explicit task (don't do it
  opportunistically — it breaks user-data migrations on Windows; see §6).
- **App identifiers** (do not change without a dedicated migration task):
  - Tauri bundle id: `chat.atomic.app`
  - Cargo crate: `Atomic-Chat`
  - macOS / Windows product name: `Atomic Chat`
  - Workspace package: `@janhq/web-app` (legacy)
  - CLI binary: `jan-cli` (legacy)

---

## 2. What Atomic Chat is

Cross-platform desktop / mobile app (Tauri + React) that runs LLMs locally
and exposes an OpenAI-compatible API at `http://localhost:1337/v1`. Two
inference backends sit behind that single facade — callers don't need to
know which one is serving a request.

Supported platforms: macOS (Universal), Windows x64, Linux (AppImage),
iOS, Android. Apple Silicon is a first-class target.

---

## 3. Repository map

Top-level layout (only the directories agents touch regularly):

| Path                         | What lives there                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `web-app/`                   | Frontend (React + Vite + TanStack Router, Tailwind, shadcn). Workspace `@janhq/web-app`.                               |
| `web-app/src/routes/launch/` | Top-level "Launch" page: install + configure external coding agents / assistants (Claude Code, Codex CLI, OpenCode, Hermes, OpenClaw) against the local API. Catalog in `web-app/src/constants/integrations.ts`; install/configure commands in `src-tauri/src/core/system/commands.rs`. |
| `core/`                      | Shared TS core: types, browser-side runtime, extension contracts. Built and `yarn pack`'d, consumed by extensions.     |
| `extensions/`                | Pluggable backend extensions (TS, rolldown-bundled). Each has its own `src/`, `package.json`, `settings.json`.         |
| `extensions/llamacpp-extension/` | Driver for the `atomic-llama-cpp-turboquant` backend.                                                              |
| `extensions/mlx-extension/`  | Driver for the MLX-VLM backend (Apple Silicon only).                                                                   |
| `extensions/foundation-models-extension/` | Driver for Apple Foundation Models (macOS / iOS, via `foundation-models-server/`).                        |
| `extensions/assistant-extension/` | Built-in assistants.                                                                                              |
| `extensions/conversational-extension/` | Threads / chat history persistence.                                                                          |
| `extensions/download-extension/` | Model / backend downloader.                                                                                        |
| `extensions/rag-extension/`, `extensions/vector-db-extension/` | RAG + vector store glue.                                                          |
| `src-tauri/`                 | Rust / Tauri shell. `src/lib.rs`, `src/main.rs`, plugins, capabilities, platform bundle configs.                       |
| `src-tauri/plugins/`         | Custom Tauri plugins (built by `yarn build:tauri:plugin:api`).                                                         |
| `mlx-server/`                | Swift wrapper around `mlx-vlm` (see §4.1). Built via `make build-mlx-server` → shipped as a sidecar binary.            |
| `foundation-models-server/`  | Swift sidecar for Apple Foundation Models.                                                                             |
| `pre-install/`               | Pre-built extension tarballs (`*.tgz`) bundled into the installer. **Still named `janhq-*-*.tgz`** (legacy).           |
| `scripts/`                   | Build, packaging, signing, download helpers.                                                                           |
| `docs/`                      | Public docs site (Next.js / MDX).                                                                                      |
| `benchmarks/`, `autoqa/`     | Throughput benchmarks and automated QA harness.                                                                        |
| `tests/`                     | Top-level Vitest tests.                                                                                                |
| `assets/`                    | Logos / preview images for README.                                                                                     |
| `flatpak/`, `downloads/`     | Linux Flatpak metadata; installer assets.                                                                              |

External repos owned by us that this repo depends on:

| Repo                                                                                                  | Role                                  |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------- |
| [AtomicBot-ai/mlx-vlm](https://github.com/AtomicBot-ai/mlx-vlm)                                       | MLX inference backend (Apple Silicon) |
| [AtomicBot-ai/atomic-llama-cpp-turboquant](https://github.com/AtomicBot-ai/atomic-llama-cpp-turboquant) | llama.cpp inference backend (all platforms) |

---

## 4. Inference backends

Both backends are reachable through the same local OpenAI-compatible API
exposed by the desktop app at `http://localhost:1337/v1`.

### 4.1 MLX backend — `AtomicBot-ai/mlx-vlm`

- **Fork of:** [`Blaizzy/mlx-vlm`](https://github.com/Blaizzy/mlx-vlm).
- **Target hardware:** Apple Silicon (Metal). Vision-language and omni
  (vision + audio) models.
- **How it ships in Atomic Chat:**
  - `mlx-server/` is a Swift Package that wraps `mlx_vlm.server` (FastAPI)
    and is built as a sidecar binary by `make build-mlx-server`.
  - `extensions/mlx-extension/` is the TS driver that spawns / health-checks
    the sidecar and registers MLX models with the app's model registry.
- **Headline features we rely on:**
  - Continuous batching (text-only + image requests in the same batch).
  - Automatic Prefix Caching (APC), warm-memory + warm-disk tiers.
  - KV-cache quantization, including **TurboQuant** (`--kv-bits 3.5
    --kv-quant-scheme turboquant`).
  - Vision feature LRU cache for multi-turn image chats.
  - Speculative decoding across three drafter families, all selected via
    `--draft-kind` (auto-detected from the drafter's HF `model_type` when
    omitted): **DFlash** (`z-lab/*`, Qwen3.5/3.6 + gpt-oss + Llama),
    **MTP** (Gemma 4 `*-assistant-*` plus the split-out Qwen 3.5/3.6 and
    DeepSeek-V4 `*-MTP-bf16` heads) and **EAGLE-3** (Gemma 4
    `RedHatAI/*-speculator.eagle3`).
  - OpenAI-compatible `/v1/chat/completions` and `/v1/responses`,
    structured outputs (`json_schema`), per-token logprobs.
- **CLI surface we care about** (server side):
  `mlx_vlm.server --model <hf|path> [--adapter-path …] [--draft-model …]
  [--draft-kind dflash|eagle3|mtp] [--draft-block-size N] [--kv-bits N]
  [--kv-quant-scheme uniform|turboquant] [--enable-thinking]
  [--top-logprobs-k K]`.

### 4.2 LLM backend — `AtomicBot-ai/atomic-llama-cpp-turboquant`

- **Fork of:** [`TheTom/llama-cpp-turboquant`](https://github.com/TheTom/llama-cpp-turboquant)
  (itself based on `ggml-org/llama.cpp`).
- **Active branch:** `feature/turboquant-kv-cache`.
- **Target hardware (per platform policy):**
  - **macOS (Apple Silicon, Metal) — our fork** `atomic-llama-cpp-turboquant`.
  - **Linux (x86_64 AppImage, Vulkan / CPU) — official upstream
    [`ggml-org/llama.cpp`](https://github.com/ggml-org/llama.cpp)**, *not*
    our TurboQuant fork. Vulkan is the **sole** GPU path — NVIDIA, AMD,
    and Intel users all share the single `linux-vulkan-x64` build because
    upstream publishes no `ubuntu-cuda-*` asset. ROCm 7.2 and OpenVINO
    2026.0 are upstream-available but excluded from Phase 1. CUDA / HIP
    are not supported on Linux today. See ADR 2026-05-28 *Linux ships only
    `llamacpp-upstream` (AppImage, upstream `ggml-org/llama.cpp`); Vulkan
    is the sole GPU path* in §7. (This supersedes the earlier
    macOS / Linux row of this table.)
  - **Windows (x64, CUDA / Vulkan / CPU) — official upstream
    [`ggml-org/llama.cpp`](https://github.com/ggml-org/llama.cpp)**, *not*
    our TurboQuant fork. Windows does **not** get TurboQuant KV / weights,
    Gemma 4 MTP, or Qwen 3.6 NextN today. See ADR 2026-05-19 *Windows uses
    upstream llama.cpp* in §7.
- **How it ships in Atomic Chat:**
 - Pre-built `llama-server` / library binaries are downloaded per platform
 by `scripts/download-bin.mjs` / `scripts/download-lib.mjs` and the
 platform-specific `Makefile` targets (`download-llamacpp-backend` for
 the turboquant fork, `download-llamacpp-upstream-backend` for the
 official upstream). The download manifest picks our fork's release
 **only on macOS**; **Windows and Linux pull the official
 `ggml-org/llama.cpp` release** (per the 2026-05-22 and 2026-05-28 ADRs
 in §7). The `download-llamacpp-backend` make target is a no-op on
 Windows and skips on Linux for the same reason.
 - `extensions/llamacpp-extension/` is the TS driver for the turboquant
 fork; it is the **only** llama.cpp driver on macOS for the fork side
 and is **excluded from the Windows and Linux installer bundles** (see
 `package.json :: build:extensions:{win32,linux}`). On Windows and
 Linux the sole driver is `extensions/llamacpp-upstream-extension/`
 (registered provider id `llamacpp-upstream`); on macOS both drivers
 ship side-by-side. Features gated to the fork (TurboQuant `-ctk`/
 `-ctv`, `--mtp-head`, `--spec-type mtp|nextn`) must be guarded behind a
 platform / backend-build check before they are surfaced to the UI —
 they are simply unavailable on Windows and Linux today.
 - **macOS also ships the vanilla upstream `ggml-org/llama.cpp` build as a
 second, parallel provider** named "Llama.cpp", driven by
 `extensions/llamacpp-upstream-extension/` + the sibling Rust plugin
 `src-tauri/plugins/tauri-plugin-llamacpp-upstream/`. Bundle root:
 `resources/llamacpp-backend-upstream/`. Make target:
 `download-llamacpp-upstream-backend`. We do **not** fork upstream — the
 official release tarball is re-codesigned with our Developer ID during
 the build. See ADR 2026-05-19 *Ship upstream `ggml-org/llama.cpp` as a
 second macOS provider* in §7.
- **Headline features we rely on:**
  - **TurboQuant KV cache** — WHT-rotated low-bit quantization, kernels on
    Metal (TurboFlash) / CUDA / Vulkan / HIP. Recommended default
    `-ctk turbo3 -ctv turbo3` (~4.3× vs F16); also `turbo2` (~6.4×) and
    `turbo4` (~3.8×).
  - **TurboQuant weight quantization** — `TQ3_1S` / `TQ4_1S` (WHT-rotated
    Lloyd-Max, block 32), built via `llama-quantize`.
  - **Gemma 4 MTP speculative decoding** — pair a `gemma4` target with the
    official `gemma4_assistant` head via `--mtp-head <gguf> --spec-type mtp`.
    Headline gain: **+30–50 %** short-prompt throughput on Gemma 4 26B-A4B
    / 31B.
  - **Qwen 3.6 NextN speculative decoding** — point `--model-draft` at the
    same combined `*_MTP.gguf` and pass `--spec-type nextn`. Shared-model
    draft context (no second mmap). Headline gain: **+24–36 %** tps on
    Qwen 3.6 35B-A3B MoE.
  - **Multimodal + speculative decoding on a single slot:** `--mmproj` can
    be loaded alongside `mtp` / `nextn` / `eagle3` (text-only turns get
    spec-decode; image-bearing turns fall back to plain target decode).
- **Recommended pre-built artefacts** we point users at:
  - Gemma 4 assistant heads:
    [`AtomicChat/gemma-4-{E2B,E4B,26B-A4B,31B}-it-assistant-GGUF`](https://huggingface.co/AtomicChat).
  - Qwen 3.6 UDT combined `_MTP.gguf` quants:
    [`AtomicChat/Qwen3.6-{27B,35B-A3B}-UDT-MTP-GGUF`](https://huggingface.co/AtomicChat).
- **Reference docs in the backend repo:** `README.md`, `MTP.md`, `NEXTN.md`,
  `docs/speculative.md`, `docs/qwen-udt/RUNBOOK.md`.

### 4.3 Apple Foundation Models backend

`foundation-models-server/` (Swift) + `extensions/foundation-models-extension/`.
Used on macOS / iOS where Apple's on-device foundation models are available.
Out of scope for most cross-platform work; touch only when explicitly asked.

---

## 5. Build & dev workflow

Authoritative dev guide is **`DEVELOP.md`**. Cheatsheet:

```bash
# Full first-time setup (installs deps, builds core/extensions/icons, launches Tauri):
make dev

# Hot iteration loop once make dev has run once:
yarn dev          # = yarn dev:tauri (Vite + Tauri, with hot reload)

# Production build:
make build        # or yarn build / yarn build:tauri (per-platform)

# Tests & lint:
make test         # vitest + lints
yarn test
yarn lint         # @janhq/web-app eslint
```

Platform-specific build targets live in the root `Makefile` and `package.json`
(`build:tauri:darwin`, `build:tauri:darwin:debug`, `build:tauri:win32`,
`build:tauri:linux`, `build:android`, `build:ios`, …). Mobile builds use
`--features mobile`.

Where Atomic Chat stores runtime data per OS, including the three legacy
APPDATA folders on Windows (`Atomic Chat\`, `chat.atomic.app\`,
`Atomic-Chat\`), is documented in `DEVELOP.md` — do **not** invent new
data paths.

---

## 6. Rules for agents working in this repo

These are *additional* to the user's global engineering rules. They override
defaults where they conflict.

1. **Do only what is explicitly asked.** No opportunistic refactors, no
   "while I'm here" cleanups. If a tempting improvement appears — propose
   it, don't ship it.
2. **Don't rename `jan*` / `@janhq/*` artefacts unless renaming them is
   the task.** The legacy names are load-bearing for installer migrations,
   pre-install tarball paths (`pre-install/janhq-*-*.tgz`), Windows
   APPDATA folders, and the bundle identifier split. Touching them without
   a coordinated migration breaks existing user installs.
3. **New code uses Atomic Chat naming.** New modules, packages, env vars,
   log prefixes, CLI subcommands, telemetry events, user-facing strings,
   and docs use `atomic` / `Atomic Chat` — never `jan` / `Jan`. If you
   must wire new code into a legacy `@janhq/*` package, that's fine; just
   don't add new `jan*` identifiers.
4. **Don't fabricate backend behaviour.** When uncertain about a flag or
   capability of `mlx-vlm` or `atomic-llama-cpp-turboquant`, read the
   upstream `README.md` / `MTP.md` / `NEXTN.md` / `docs/speculative.md`
   instead of guessing. Both repos are checked out alongside this one
   under `/Users/misha/Work/Atomic/`.
5. **OpenAI-compat is a contract.** The local `http://localhost:1337/v1`
   surface must stay OpenAI-compatible — third-party tools (OpenCode,
   OpenClaude, Hermes Workspace, nanoclaw, …) depend on it. Adding
   non-standard fields is fine; breaking standard ones is not.
6. **Verify before committing.**
   - JS/TS: `yarn lint` in the affected workspace; `yarn test` for changed
     packages.
   - Rust: `cargo check` / `cargo clippy` inside `src-tauri/`.
   - Don't commit unless the user explicitly asks.
7. **No new top-level folders, config files, or dependencies** without
   explicit approval. New runtime deps in `web-app/` or extensions need a
   name + reason + the user's "ok".
8. **No destructive commands** (`rm -rf`, `git push --force`,
   `cargo clean --release`, dropping user data folders) without explicit
   confirmation.
9. **Log every important engineering decision** in §7 below. If you make a
   non-trivial choice (architecture, backend selection, perf trade-off,
   security default, schema/migration), append an entry — same session,
   before you finish.

### Known naming debt (do not "fix" silently)

| Surface                                | Legacy value             | New code should use            |
| -------------------------------------- | ------------------------ | ------------------------------ |
| Root `package.json` `name`             | `jan-app`                | (leave; rename = migration)    |
| Web app workspace                      | `@janhq/web-app`         | (leave)                        |
| Pre-install tarballs                   | `janhq-*-*.tgz`          | (leave; installer expects it)  |
| Tauri CLI binary                       | `jan-cli`                | (leave)                        |
| Repo URL in `Cargo.toml`               | `github.com/janhq/jan`   | (leave)                        |
| Bundle id                              | `chat.atomic.app`        | use this                       |
| Cargo crate name                       | `Atomic-Chat`            | use this                       |
| Product name (macOS / Windows)         | `Atomic Chat`            | use this                       |

---

## 7. Engineering Decisions Log (ADR-lite)

Append-only. Newest at top. Each entry follows this shape:

```
### YYYY-MM-DD — short imperative title
- Context: what problem / question prompted this.
- Decision: what we picked.
- Consequences: what this enables, what it costs, what to watch for.
- Owner: @github-handle or "team".
- Links: PRs, issues, commits, external docs.
```

> Rule: any non-trivial engineering choice goes here. If it's worth
> arguing about, it's worth recording. If this section grows past ~50
> entries, split into `docs/decisions/ADR-XXXX.md` per entry and keep
> a one-line index here.

---

### 2026-06-02 — Sync `AtomicBot-ai/mlx-vlm` fork to upstream v0.6.0 and surface a third speculative drafter family (EAGLE-3) + Qwen / DeepSeek-V4 MTP
- **Context:** The MLX backend fork (`AtomicBot-ai/mlx-vlm`) was **+8 / -105**
  vs `Blaizzy/mlx-vlm` `upstream/main` (= **v0.6.0 + 1 commit**). The headline
  wins in v0.6.0 are all engine-layer: the new drafter auto-detect path
  (upstream #1125), a third speculative family (`eagle3`), spec-decode
  sampling fixes (#1188/#1210/#1259), spec-compliant streaming usage/timings
  (#1216), and `chat_template_kwargs` support (#1130). The crux of the merge
  was upstream PR #1203, which **deleted the 3778-line monolith
  `mlx_vlm/server.py`** and split it into a package `mlx_vlm/server/`
  (`app.py`, `cli.py`, `openai.py`, `anthropic.py`, `generation.py`,
  `runtime.py`, `responses_state.py`, `schemas.py`, `__main__.py`,
  `__init__.py`). Our 8 commits lived almost entirely in `server.py`, so the
  merge produced a **modify/delete conflict** that had to be hand-ported into
  the new modules. Our Rust facade (`src-tauri/src/core/server/proxy.rs`)
  owns the public `/v1` contract (incl. its own Anthropic `/v1/messages`
  transform), so v0.6.0's value to us is the engine, not the new server
  protocol surface.
- **Decision:** Merge `upstream/main` into the fork and re-port only the
  fork-specific behaviour that upstream still doesn't cover; then extend the
  downstream MLX extension/UI from a 2-family to a 3-family drafter system.

  **Fork sync (`AtomicBot-ai/mlx-vlm`):**
  - **Kept / re-ported into `mlx_vlm/server/`:**
    - `MLX_VLM_SINGLE_MODEL` single-model guard → re-ported into
      `server/app.py::get_cached_model` (the desktop sidecar pins one model
      and must ignore arbitrary `model` labels in incoming request bodies,
      else it 401s trying to fetch a non-existent HF repo).
    - EOS aggregation (`_collect_stop_tokens` / `_coerce_eos_to_set`) →
      re-ported into `server/generation.py`. Upstream still doesn't robustly
      union `eos_token_id` across `config.json` / `text_config` /
      `generation_config.json` / tokenizer for VLM/omni configs.
    - `chat_template_kwargs` nesting → re-ported into `server/app.py`
      `_build_gen_args` (kept as a thin precedence shim over the now-native
      upstream fields, so `enable_thinking` / `thinking_budget` keep flowing).
    - `in_thinking` prompt-seed → re-ported into `server/openai.py` streaming
      path (many chat templates inject the opening `<think>` /
      `<|channel>thought` marker into the *prompt*, so without seeding the
      reasoning/content split the whole CoT leaks into `delta.content`).
  - **Dropped (superseded by upstream):** the `top_p_sampling` arbitrary-batch
    patch (#docstring already documents `[B,T,vocab]`), the lossless
    spec-decode target-sampling patch (#1188/#1210/#1259), and the
    fork's `_make_sampler(temp=0)` spec-decode override (upstream's verify
    path is fixed). The bespoke final-SSE-chunk TPS/usage frame was dropped in
    favour of upstream's spec-compliant `stream_options.include_usage` →
    `GenerationTimings` (see the downstream `includeUsage` fix below).
  - **Fork infra preserved:** `_entry_server.py` (`from mlx_vlm.server import
    main` resolves against the new `__init__.py`), the CI workflows
    (`build-mlxvlm-macos.yml` + the two `*.disabled`), and `uv.lock`
    regenerated keeping `llguidance` + `mlx-audio` (now also in upstream's
    `requirements.txt`).

  **Downstream (`Atomic-Chat`):**
  - **TPS regression fix:** `web-app/src/lib/model-factory.ts::createMlxModel`
    now sets `includeUsage: true`. v0.6.0 (#1216) made the streaming
    `usage`/`timings` frame opt-in via `stream_options.include_usage`; the
    pre-v0.6.0 fork emitted it unconditionally, so the UI used to get
    `timings.predicted_per_second` for free. Without the flag the decode-rate
    readout would silently fall back to a wall-clock estimate.
  - **Third drafter family surfaced (EAGLE-3) + new MTP pairings:**
    - New `extensions/mlx-extension/src/eagle3Registry.ts` mapping the two
      Gemma 4 targets → `RedHatAI/gemma-4-{31B,26B-A4B}-it-speculator.eagle3`
      (mirrors `dflashRegistry.ts`; E2B/E4B have no EAGLE-3 head and keep
      using the MTP assistant).
    - `extensions/mlx-extension/src/mtpRegistry.ts` extended with the
      split-out, separately-published `mlx-community/*-MTP-bf16` heads:
      Qwen `3.5-4B`, `3.5-9B`, `3.6-27B`, `3.6-35B-A3B` (`model_type:
      qwen3_5_mtp`) and `DeepSeek-V4-Flash` (`model_type: deepseek_v4_mtp`).
      All three families share `--draft-kind` values, so they all resolve via
      the same `mtp` kind; the reverse-lookup was generalised from
      `-assistant` to also match `-MTP-` ids. Every repo id was verified
      against the live HF API — no fabricated repos.
    - `extensions/mlx-extension/src/index.ts`: the 2-way (`mtp|dflash`)
      `performLoad` resolver became a 3-way (`mtp|eagle3|dflash`, fixed
      precedence `mtp > eagle3 > dflash`); `ensureDraftDownloaded`'s `kind`
      union, the `onSettingUpdate` block-size debounce map, and the
      enable/disable mutex now cover `eagle3`. New `enableEagle3` /
      `disableEagle3` / `checkEagle3Support` mirror the MTP trio. EAGLE-3's
      block size defaults to `0` = "use the speculator's built-in depth"
      (the Rust shim only emits `--draft-block-size` when > 0).
    - `extensions/mlx-extension/settings.json`: added `eagle3_enabled` +
      `eagle3_block_size` toggles. UI: new
      `web-app/src/containers/dialogs/Eagle3UnsupportedDialog.tsx`, an
      EAGLE-3 Switch + handler in
      `web-app/src/routes/settings/providers/$providerName.tsx` (mutually
      exclusive with DFlash/MTP, MLX-provider-gated), and `eagle3*` i18n keys
      in `web-app/src/locales/en/settings.json`.
  - **Rust contract:** `tauri-plugin-mlx::MlxConfig.draft_kind` was already a
    verbatim passthrough to `--draft-kind`; only its doc comments were updated
    to enumerate the third family. No behavioural Rust change was needed.
- **Consequences:**
  - macOS users get auto-detected drafter loading, the upstream spec-decode
    correctness fixes, and a third drafter family in the MLX provider
    settings. Coverage now spans DFlash + MTP (Gemma 4 / Qwen / DeepSeek-V4) +
    EAGLE-3 (Gemma 4), each guarded behind a static, network-free registry
    with local-first resolution and direct `/resolve/main/<file>` downloads.
  - The public `localhost:1337/v1` contract is unchanged — the Rust proxy
    still owns it; `/chat/completions` and `/v1/messages` behave as before.
  - The three drafter families share one on-disk cache
    (`mlx/draft-models/<repo>/`); collisions are impossible because the repo
    prefixes are disjoint (`z-lab/…`, `mlx-community/…`, `RedHatAI/…`).
  - **Not done:** TurboQuant-for-MLX weight quant and any non-macOS MLX path
    remain out of scope (MLX is Apple-Silicon-only). The fork is **not yet
    committed** — changes await explicit approval per the plan's verification
    ritual.
- **Owner:** team.
- **Links:** [AtomicBot-ai/mlx-vlm](https://github.com/AtomicBot-ai/mlx-vlm),
  [Blaizzy/mlx-vlm](https://github.com/Blaizzy/mlx-vlm) (v0.6.0, PRs #1125,
  #1130, #1188, #1203, #1210, #1216, #1259), §4.1 *MLX backend*,
  files: `extensions/mlx-extension/src/eagle3Registry.ts`,
  `extensions/mlx-extension/src/mtpRegistry.ts`,
  `extensions/mlx-extension/src/index.ts`,
  `extensions/mlx-extension/settings.json`,
  `web-app/src/containers/dialogs/Eagle3UnsupportedDialog.tsx`,
  `web-app/src/routes/settings/providers/$providerName.tsx`,
  `web-app/src/lib/model-factory.ts`,
  `src-tauri/plugins/tauri-plugin-mlx/src/commands.rs`.

### 2026-06-01 — Add a "Launch" page to install + configure external coding agents / assistants against the local OpenAI-compatible API
- **Context:** To use Atomic Chat's local models from external agents
 (Claude Code, Codex CLI, OpenCode, Hermes, OpenClaw) users had to
 hand-edit each agent's config to point at `http://localhost:1337/v1`.
 Ollama solves the same problem with `ollama launch <agent>`
 (docs.ollama.com/integrations). We wanted the same one-click ergonomics
 without inventing a new CLI surface. The repo already had the building
 blocks: a Settings → Integrations section, the Rust writers
 `launch_claude_code_with_config` / `configure_hermes_agent`, and the
 `start_server` / `get_server_status` commands.
- **Decision:** Ship a **buttons-only, top-level "Launch" page** (no new
 CLI binary — "Variant A"). Each agent card has two actions:
 **Install** (`install_agent` spawns the agent's official installer via
 `std::process::Command`, streaming stdout/stderr to the UI through the
 `agent_install_log:<id>` Tauri event; a missing prerequisite such as
 `npm` returns a clear error with the agent's docs URL — no browser
 auto-open) and **Enable** (ensures the local server is running, then
 writes the agent's config pointing at
 `http://${serverHost}:${serverPort}${apiPrefix}`). New Rust commands in
 `src-tauri/src/core/system/commands.rs`: `detect_agent_installed`,
 `install_agent`, `configure_codex` (`~/.codex/config.toml`, managed
 block), `configure_opencode` (`~/.config/opencode/opencode.json`, strict
 JSON merge, always sets `provider.atomic.name` so options forward),
 `configure_openclaw` (`~/.openclaw/openclaw.json` + the
 `agents.defaults.models` allowlist; honours `OPENCLAW_CONFIG_PATH`).
 Claude Code and Hermes reuse the existing writers. First iteration =
 Claude Code, Codex CLI, OpenCode (coding) + Hermes, OpenClaw
 (assistants). New frontend: route `web-app/src/routes/launch/index.tsx`,
 sidebar item in `NavMain.tsx`, catalog `web-app/src/constants/integrations.ts`,
 locale namespace `web-app/src/locales/en/launch.json`.
- **Consequences:**
 - Reuses the established Rust home-dir config-writer pattern; no new
 top-level folders or dependencies. The whole surface is gated behind a
 single new top-level page marked "Experimental".
 - **No CLI surface.** A future CLI epic (`atomic-chat-cli launch <agent>`)
 can reuse the same Rust config-writers; the logic deliberately lives in
 `core/system/commands.rs` rather than a UI-only path.
 - **Install depends on host tooling.** Install paths verified against each
 vendor (2026-06-01): Claude Code (`npm i -g @anthropic-ai/claude-code`),
 Codex (`npm i -g @openai/codex`), OpenCode (`npm i -g opencode-ai`) and
 OpenClaw (`npm i -g openclaw`, needs Node 22+) ship as global npm
 packages. **Hermes is a Python project**, installed via its official
 bootstrap script (`curl -fsSL .../scripts/install.sh | bash` on Unix,
 `iex (irm .../scripts/install.ps1)` on Windows) — so `install_agent`
 spawns that script for Hermes instead of npm; its prerequisite is
 `curl` (Unix) / `powershell` (Windows).
 - **OpenClaw config is JSON5** but we parse/merge with `serde_json`; if a
 user's file contains comments/trailing commas the parse fails and we
 return an actionable error instead of clobbering it (no `json5` dep
 added).
 - **API key** from `useLocalApiServer` is passed automatically when set;
 it is usually empty, so Codex omits auth and OpenCode/OpenClaw fall back
 to a placeholder key.
 - **Per-agent request timeouts are seeded for local models.** Small local
 GGUF/MLX models, once wrapped in an agent's system prompt + tools, take
 longer per turn than these agents' cloud-tuned defaults expect.
 `configure_openclaw` seeds `agents.defaults.timeoutSeconds = 240` (its
 default is far shorter). `configure_hermes_agent` seeds
 `providers.custom.request_timeout_seconds = 180` — note Hermes' own
 default is the opposite extreme (1800s via `HERMES_API_TIMEOUT`), so for
 Hermes this is a *tightening* so a wedged turn fails fast rather than
 hanging 30 min. The key is the resolved provider id (Hermes reads
 `providers.<id>.request_timeout_seconds` in
 `run_agent.py::get_provider_request_timeout`; our model uses provider
 `custom`). Both writers **preserve any value the user already set** —
 they only fill the gap, never clobber.
- **Owner:** team.
- **Links:** docs.ollama.com/integrations,
 [`web-app/src/routes/launch/index.tsx`](web-app/src/routes/launch/index.tsx),
 [`web-app/src/constants/integrations.ts`](web-app/src/constants/integrations.ts),
 [`src-tauri/src/core/system/commands.rs`](src-tauri/src/core/system/commands.rs),
 [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs),
 [`web-app/src/components/left-sidebar/NavMain.tsx`](web-app/src/components/left-sidebar/NavMain.tsx).

### 2026-05-28 — Linux ships only `llamacpp-upstream` (AppImage, upstream `ggml-org/llama.cpp`); Vulkan is the sole GPU path
- **Context:** Atomic Chat had no Linux release channel at all — the only
 supported targets were macOS (Universal) and Windows x64. The "Linux
 support" epic (Daniel, 2026-05-26) calls for closing that gap in two
 phases: Phase 1 is the mainstream `linux-x86_64` build for ordinary
 desktops, Phase 2 (deferred to a separate epic) targets `linux-aarch64`
 + NVIDIA DGX Spark (GB10, `sm_121`). The current repo already had a
 partial Linux scaffolding — `src-tauri/tauri.linux.conf.json` listed
 `["deb", "appimage"]` bundle targets, `package.json :: build:tauri:linux`
 plus the helper scripts `src-tauri/build-utils/buildAppImage.sh`
 (hardcoded `Jan.AppDir` / `appimagetool-x86_64.AppImage`) and
 `src-tauri/build-utils/shim-linuxdeploy.sh`, and `scripts/download-bin.mjs`
 already knew how to fetch `bun` / `uv` for both `x86_64-unknown-linux-gnu`
 and `aarch64-unknown-linux-gnu`. The legacy `flatpak/ai.jan.Jan.yml`
 metadata was also still present. What was missing: any CI job, any
 llama.cpp binary fetch path, any Linux entry in the upstream backend
 matrix, and any `latest.json` platform key.

 Two facts about the upstream `ggml-org/llama.cpp` release stream
 forced the shape of this decision. (1) On the `b9371`
 reference snapshot taken while planning this work, the Linux
 archive set is exactly: `ubuntu-x64.tar.gz`, `ubuntu-arm64.tar.gz`,
 `ubuntu-s390x.tar.gz`, `ubuntu-vulkan-x64.tar.gz`,
 `ubuntu-vulkan-arm64.tar.gz`, `ubuntu-rocm-7.2-x64.tar.gz`,
 `ubuntu-openvino-2026.0-x64.tar.gz`. (2) **There is no
 `ubuntu-cuda-*` asset of any architecture on the upstream release
 stream** — CUDA is published only as `win-cuda-12.4-x64.zip` and
 `win-cuda-13.3-x64.zip`. The original epic text assumed a
 `linux-x64-cuda` binary would just be there; it is not.

- **Decision:** Phase 1 is Linux/x86_64 only, AppImage only, upstream
 only, with Vulkan as the sole GPU path. Concretely:

 1. **One package format: AppImage.** `src-tauri/tauri.linux.conf.json`
 `bundle.targets` is narrowed from `["deb", "appimage"]` to
 `["appimage"]`. We do not ship `.deb`, `.rpm`, Snap, or Flatpak.
 Rationale: a single artefact yields one updater path
 (Tauri-signed AppImage), works on every mainstream distro
 (Ubuntu 22.04+, Debian 12+, Fedora 40+, Arch, openSUSE, Mint,
 Pop!_OS, etc.), and avoids per-distro packaging tax until we
 have actual user demand. Native `apt` integration for the
 Debian / Ubuntu cohort is recognised as a follow-up trade-off
 we are accepting against the maintenance burden of multiple
 release channels.
 2. **One backend provider: `llamacpp-upstream`.** Linux drives
 `extensions/llamacpp-upstream-extension/` +
 `src-tauri/plugins/tauri-plugin-llamacpp-upstream/` exactly the
 way Windows does after the 2026-05-22 ADR
 *Windows ships only `llamacpp-upstream`*. The turboquant
 `@janhq/llamacpp-extension` is excluded from
 `package.json :: build:extensions:linux` so only one provider
 ships. This **supersedes** the Linux clause of the 2026-05-19
 ADR *Use `AtomicBot-ai/atomic-llama-cpp-turboquant` as the LLM
 backend* and the §4.2 platform table line
 *"Linux (CUDA / Vulkan / HIP / CPU) — our fork
 `atomic-llama-cpp-turboquant`"*. Both lose the Linux row to
 this entry; macOS and Windows are unchanged.
 3. **Vulkan is the only GPU path on Linux.** Because upstream
 publishes no `ubuntu-cuda-*` asset, NVIDIA, AMD, and Intel
 users all share the single `linux-vulkan-x64` build. We
 explicitly do **not** ship ROCm 7.2 or OpenVINO 2026.0
 builds in Phase 1 — both are upstream-available
 (`ubuntu-rocm-7.2-x64.tar.gz`, `ubuntu-openvino-2026.0-x64.tar.gz`)
 and can be added later behind a hardware-gated whitelist
 entry in `fetchRemoteBackends` + `get_supported_features`,
 but they are out of scope today.
 4. **Bundled-by-default: `linux-cpu-x64`.** Mirrors the Windows
 ADR — the installer ships exactly one llama-server build
 (the CPU one), so Atomic Chat is usable offline on first
 launch on any Linux box without a working GPU stack. The
 hardware-gated picker (`detectIdealBackendType`) auto-suggests
 `linux-vulkan-x64` when `tauri-plugin-hardware` reports a
 working Vulkan loader and at least one GPU. The user can
 also install it manually from Settings → Providers →
 Llama.cpp → Find optimal backend.
 5. **Backend id naming.** The Rust matrix in
 `tauri-plugin-llamacpp-upstream/src/backend.rs` ::
 `determine_supported_backends` is rewritten for the
 `linux-x86_64` arm to emit `linux-cpu-x64` and (conditionally)
 `linux-vulkan-x64`. The legacy janhq-mirror ids previously
 hard-coded in that file (`linux-common_cpus-x64`,
 `linux-cuda-{11,12,13}-common_cpus-x64`,
 `linux-vulkan-common_cpus-x64`) are removed from the matrix
 but kept addressable through `map_old_backend_to_new`, which
 maps every persisted legacy id to its closest current
 equivalent (`linux-vulkan-*` → `linux-vulkan-x64`, anything
 else including the dropped Linux CUDA tiers →
 `linux-cpu-x64`). The TS-side
 `extensions/llamacpp-upstream-extension/src/backend.ts` ::
 `fetchRemoteBackends` gets a `linux` branch with a whitelist
 of `linux-cpu-x64` and `linux-vulkan-x64`, translating
 upstream's `ubuntu-{x64,vulkan-x64}` asset names into the
 internal `linux-*` ids; `getBackendDownloadUrl` handles the
 reverse mapping plus the `.tar.gz` extension upstream uses
 on Linux (vs `.zip` on Windows / macOS).
 6. **`Makefile` Linux branch.** `download-llamacpp-upstream-backend`
 grows an `else ifeq ($(shell uname -s),Linux)` arm that
 reuses the existing `_gh_get` / `_gh_fetch` retry helpers
 from the Windows branch to pull
 `llama-${TAG}-bin-ubuntu-x64.tar.gz` into
 `src-tauri/resources/llamacpp-backend-upstream/`,
 normalising the layout into `build/bin/` to match the
 Windows / macOS conventions. `download-llamacpp-upstream-backend-if-exists`
 gets the matching Linux branch. A convenience target
 `download-llamacpp-upstream-backend-linux-cpu` is added for
 CI to invoke explicitly, mirroring
 `download-llamacpp-upstream-backend-win-cpu`.
 7. **CI: `build-linux-x64` job on `ubuntu-22.04`.**
 `.github/workflows/release.yml` gains a third platform job
 next to `build-macos` / `build-windows`. The runner is
 pinned to `ubuntu-22.04` (glibc 2.35) so the AppImage stays
 compatible with the widest possible distro range (Ubuntu
 24.04 / Debian 12 / Fedora 40 / etc. all ship glibc ≥ 2.35).
 The job installs the WebKitGTK 4.1 + Tauri AppImage system
 deps, downloads the Linux upstream backend, builds web /
 core / extensions (with the new exclusion), builds the
 `jan-cli` Linux binary, and runs `yarn build:tauri:linux`
 which already chains `shim-linuxdeploy.sh` + `tauri build` +
 `buildAppImage.sh`. The collected artefacts are the
 `*.AppImage` and its companion `.AppImage.sig` (Tauri
 updater signature).
 8. **`latest.json` gets a `linux-x86_64` block.**
 `src-tauri/latest.json.template` adds the new platform key,
 and `publish-latest-json` in `release.yml` extends its `jq`
 pipeline to populate or `del()` the block based on whether
 `build-linux-x64.result == 'success'`, mirroring the
 existing handling for `darwin-*` and `windows-x86_64`. The
 Tauri updater now serves Linux clients on the same channel
 as macOS / Windows.
 9. **Rename collateral.** `tauri.linux.conf.json` title flips
 from `"Jan"` to `"Atomic Chat"`. `buildAppImage.sh` flips
 its hardcoded `Jan.AppDir` / `usr/lib/Jan/binaries` paths
 to the matching `Atomic Chat` paths produced by the new
 product name. `web-app/src/lib/utils.ts`'s `LOCAL_LLAMACPP_PROVIDER`
 / `LOCAL_LLAMACPP_EXTENSION_NAME` switches from
 `IS_WINDOWS ? upstream : turboquant` to
 `IS_WINDOWS || IS_LINUX ? upstream : turboquant` so the UI
 routes to the right provider id on Linux without forking
 dozens of call sites.

- **Consequences:**
 - **Linux x86_64 release channel exists.** Every tagged release
 publishes `Atomic-Chat_x.y.z_amd64.AppImage` + `.sig` and a
 `linux-x86_64` entry in `latest.json`. Linux users get the
 same auto-update flow as macOS / Windows users.
 - **One UI experience across all desktops.** Linux users see the
 same single "Llama.cpp" provider that Windows users see
 (per the 2026-05-22 ADR). macOS keeps its dual-provider
 layout (turboquant + upstream side-by-side) — that is a
 macOS-only thing.
 - **NVIDIA-on-Linux performance ceiling.** Without `ubuntu-cuda-*`
 upstream artefacts, NVIDIA users on Linux take a Vulkan
 backend — historically ~10–20 % slower decode than CUDA on
 the same card. Acceptable for Phase 1 (the alternative is
 building and signing a CUDA-Linux binary ourselves, which is
 deferred to a follow-up epic). The README "Running on Linux"
 section will state this trade-off plainly so users with
 high perf requirements know to wait for the CUDA-Linux work
 or run the turboquant fork manually.
 - **No TurboQuant / MTP / NextN on Linux.** All three depend on
 our fork and are not in upstream. Linux users do not see
 those options in the UI. Re-enabling them is the explicit
 subject of a future ADR (it requires (a) qualifying the
 turboquant fork against Linux/x86_64 CUDA + Linux/x86_64
 Metal-equivalent backends, (b) shipping a second `llamacpp`
 provider on Linux like macOS does).
 - **DGX Spark / aarch64 deferred.** Phase 2 of the Linux epic
 stays open. The decision **not** to ship aarch64 in Phase 1
 is a hard prerequisite — we want stable x86_64 packaging
 + CI infrastructure before splitting the matrix again.
 Phase 2 will produce a separate ADR covering the aarch64
 build, the AppImage tooling story
 (`appimagetool-aarch64.AppImage`,
 `linuxdeploy-aarch64.AppImage`), the DGX Spark backend
 choice (Vulkan on GB10 vs. building a CUDA-`sm_121` binary
 ourselves), and the test-hardware plan.
  - **Legacy `flatpak/` files deleted.** The `flatpak/ai.jan.Jan.yml`
 manifest, its `flathub.json` / `ai.jan.Jan.metainfo.xml`
 siblings, and `flatpak/patches/fix-cstdint.patch` were
 archaeology from the janhq fork and carried the wrong
 identifier (`ai.jan.Jan` vs. our `chat.atomic.app`). They
 were removed in this epic. If we ever decide to ship a
 Flatpak in the future, we will write a fresh manifest under
 the current identifier and address the genuinely-hard parts
 separately — Flathub's "no runtime executable downloads"
 rule conflicts with our sidecar-download model
 (`@janhq/download-extension` fetches backend binaries at
 runtime), CUDA / Vulkan need either `--filesystem=host` or a
 dedicated Flatpak extension, and the local `localhost:1337`
 OpenAI-compat surface needs explicit portal config for the
 third-party tools that consume it (OpenCode, OpenClaude,
 Hermes Workspace, nanoclaw). Deferring Flatpak past Phase 1
 keeps the maintenance surface focused.
 - **`s390x`, `rocm-7.2-x64`, `openvino-2026.0-x64` upstream
 assets ignored.** The TS asset whitelist explicitly drops
 them; the Rust matrix does not enumerate them. Adding any
 of the three is a one-line whitelist edit plus a feature
 detector in `get_supported_features` — no architectural
 blocker, just out of scope today.
 - **`map_old_backend_to_new` rescues persisted settings.**
 Linux users who used a pre-2026-05-28 dev build with the
 turboquant `linux-cuda-*` / `linux-vulkan-common_cpus-x64`
 ids in their settings get auto-mapped onto the new
 `linux-cpu-x64` / `linux-vulkan-x64` ids on next start —
 no manual intervention required.
 - **Test coverage.** New unit tests in
 `tauri-plugin-llamacpp-upstream` lock down the Linux matrix
 (cpu-only, cpu + vulkan, vulkan-without-cpu impossible) and
 every legacy-id mapping path. Existing macOS / Windows
 tests are unchanged and still pass.
 - **Smoke-test plan.** Phase-1 acceptance requires (a) a clean
 Ubuntu 24.04 x86_64 VM run (no GPU) — AppImage downloads,
 launches under WebKitGTK 4.1, loads Qwen3 0.6B Q8 on the
 bundled CPU backend, answers via `http://localhost:1337/v1`;
 (b) an Ubuntu 22.04 + NVIDIA GPU host run — same as (a) plus
 "Find optimal backend" installs `linux-vulkan-x64` and the
 GPU is actually used. Both verifications run before the
 first tagged Linux release.

- **Owner:** team.
- **Links:** §4.2 *LLM backend*, the 2026-05-22 ADR
 *Windows ships only `llamacpp-upstream`*, the 2026-05-19 ADRs
 *Use `AtomicBot-ai/atomic-llama-cpp-turboquant` as the LLM backend*
 and *Ship upstream `ggml-org/llama.cpp` as a second macOS provider*,
 the "Linux support for Atomic Chat" epic (Daniel, 2026-05-26),
 [ggml-org/llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases),
 files: [`src-tauri/tauri.linux.conf.json`](src-tauri/tauri.linux.conf.json),
 [`src-tauri/build-utils/buildAppImage.sh`](src-tauri/build-utils/buildAppImage.sh),
 [`src-tauri/build-utils/shim-linuxdeploy.sh`](src-tauri/build-utils/shim-linuxdeploy.sh),
 [`src-tauri/latest.json.template`](src-tauri/latest.json.template),
 [`src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/backend.rs`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/backend.rs),
 [`extensions/llamacpp-upstream-extension/src/backend.ts`](extensions/llamacpp-upstream-extension/src/backend.ts),
 [`package.json`](package.json) (`build:extensions:linux`),
 [`Makefile`](Makefile) (`download-llamacpp-upstream-backend` Linux branch),
 [`.github/workflows/release.yml`](.github/workflows/release.yml)
 (`build-linux-x64` job),
 [`web-app/src/lib/utils.ts`](web-app/src/lib/utils.ts)
 (`LOCAL_LLAMACPP_PROVIDER`).

### 2026-05-27 — Replace `janhq/model-catalog` + Fuse.js with curated `AtomicBot-ai/atomic-chat-model-catalog` and a pre-built MiniSearch index
- **Context:** Hub's "Search models" surface had two compounding problems.
 First, the catalog itself — fetched from `raw.githubusercontent.com/janhq/model-catalog/main/model_catalog_v2.json`
 at startup — had stagnated. The upstream repo no longer received
 curatorial attention: dead Hugging Face links, mixed-quality
 quantizers, no discipline around MLX entries, and a couple of months
 of stale `downloads`/`created_at` snapshots. Second, the client did a
 per-keystroke `new Fuse(filtered, { keys: ['model_name',
 'quants.model_id', 'safetensors_files.model_id'] }).search(query)` over
 the raw JSON ([`web-app/src/routes/hub/index.tsx:213-220`](web-app/src/routes/hub/index.tsx)).
 Fuse's small-corpus scoring degrades past a few thousand entries, the
 keyset ignored organisation / tags / description, and long-tail
 queries (e.g. `qwen3.5 mlx 4bit`) routinely ranked irrelevant quants
 first. The combination meant users with a specific HF repo in mind
 either typed the full slug to win or gave up and pasted the URL into
 the existing fallback. The fallback path
 (`services/models/default.ts :: searchHuggingFaceRepo`) was
 well-engineered but only ever surfaced **one** best match per query,
 so it could not act as a recall safety net.

- **Decision:** Stand up a new public repo
 [`AtomicBot-ai/atomic-chat-model-catalog`](https://github.com/AtomicBot-ai/atomic-chat-model-catalog)
 to own the curated catalog and ship a client-side MiniSearch pipeline
 around it.

 1. **Curated catalog repo + scraper.** `config/orgs.json` is a
    JSON-schema-validated whitelist of trusted HF orgs (GGUF
    quantizers `bartowski` / `unsloth` / `mradermacher` / `ubergarm`
    / `lmstudio-community` / `MaziyarPanahi` / `QuantFactory` /
    `ggml-org`, MLX contributors `mlx-community` / `prince-canuma` /
    `apple` / `Goekdeniz-Guelmez`, first-parties `Qwen` / `microsoft`
    / `meta-llama` / `mistralai` / `google` / `deepseek-ai` / `nvidia`
    / `NousResearch` / `allenai` / `cognitivecomputations`, plus
    `AtomicChat` as the in-house track and `TheBloke` / `janhq` as
    archived). `scripts/scrape.py` (uv-managed, Python 3.13) paginates
    `GET /api/models?author={org}&full=true`, follows `Link: rel=next`
    headers, applies a first-pass filter (downloads ≥ threshold,
    GGUF/MLX hint via tags/library/path), fetches per-repo detail with
    `?blobs=true&files_metadata=true`, and emits a `catalog.json`
    whose `models[]` is a strict superset of the client's
    `CatalogModel` interface — every download URL, sha256, mmproj
    sibling, and safetensors entry is preserved verbatim so the
    existing llama.cpp / MLX download pipelines work unchanged.
 2. **Pre-built MiniSearch snapshot.** `scripts/build_index.mjs`
    consumes the scraper output and writes `catalog.idx.json` —
    a JSON-serialised `MiniSearch.toJSON()` instance configured with
    multi-field BM25 (`model_name` ×5, `developer` ×3,
    `tags_normalized` ×2, `description` ×1), fuzzy 0.2, prefix-true,
    AND-combine, plus a custom tokenizer that splits on
    `\s\-_./:,;()[\]<>+` so repo names like `qwen3.5-9b-mlx-4bit`
    index as discrete tokens. The wrapper carries an `index_version`
    so the client refuses snapshots built with a config it does not
    understand.
 3. **Release-based hosting.** `.github/workflows/cron.yml` runs
    every 12 hours plus on `workflow_dispatch` / `repository_dispatch`,
    publishes `catalog.json`, `catalog.idx.json`, `stats.json` to a
    dated GitHub Release, and re-points the `latest` alias release at
    the new artefacts. `.github/workflows/validate.yml` smoke-tests
    every PR against `ggml-org` and validates schemas with
    `ajv-cli@5`.
 4. **Client loader + store.** New
    [`web-app/src/services/model-catalog-registry.ts`](web-app/src/services/model-catalog-registry.ts)
    mirrors the architecture of `provider-registry.ts` and
    `recommended-models-registry.ts`: TTL 1h cache in `localStorage`
    (`atomic_model_catalog_cache_v1` / `atomic_model_catalog_idx_v1`,
    distinct from the sibling registries), tauri-HTTP fallback when
    standard `fetch` fails, baseline `BASELINE_MODEL_CATALOG` in
    [`web-app/src/constants/models.ts`](web-app/src/constants/models.ts)
    for offline first-launch. Companion
    [`web-app/src/stores/model-catalog-store.ts`](web-app/src/stores/model-catalog-store.ts)
    bootstraps in the background on module import and exposes
    `catalog`, `index`, `status`, `source`, `manifestUpdatedAt` to
    React; `getCatalogSync()` / `ensureCatalogLoaded()` cover
    non-React callers.
 5. **Client search service.** New
    [`web-app/src/services/model-search.ts`](web-app/src/services/model-search.ts)
    is the single search API. `loadSnapshot` hydrates the pre-built
    `MiniSearch` payload; `rebuild` is the on-the-fly fallback. The
    ranking pipeline is BM25 × platform-aware `ORG_BOOST` (e.g.
    `mlx-community` is 1.5 on macOS, 0 on Windows / Linux —
    defense-in-depth alongside `useModelSources`' MLX filter) ×
    `log1p(downloads / 100)` × exponential recency decay (180-day
    half-life on `created_at`). Empty queries use the same ranking
    minus the BM25 term, so the Hub default view stays consistent
    with search results.
 6. **Hub integration.**
    [`web-app/src/routes/hub/index.tsx`](web-app/src/routes/hub/index.tsx)
    drops Fuse.js entirely. `searchService.search(...)` runs against
    the catalog snapshot, and a new effect kicks off
    `services/models/default.ts :: searchHuggingFaceCandidates` (a
    new public method returning up to 10 HF candidates as lightweight
    `CatalogModel` entries) whenever the curated set has fewer than
    5 hits for a ≥3-character query. Those candidates are deduped
    against the curated list and appended at the tail of the
    virtualised list, so curated results always rank first while the
    long-tail HF search remains discoverable.
 7. **Compatibility shim.**
    [`web-app/src/hooks/useModelSources.ts`](web-app/src/hooks/useModelSources.ts)
    is now a thin Zustand store that subscribes to
    `useModelCatalogStore`, applies the existing `sanitizeModelId` on
    quants, and drops MLX entries when `!IS_MACOS`. Dozens of existing
    Hub consumers do not need to change. `services/models/default.ts ::
    fetchModelCatalog` proxies to `getCatalogOrFallback()` so callers
    that still reach for the old API keep working.
 8. **Build config.**
    [`web-app/vite.config.ts`](web-app/vite.config.ts) flips the
    compile-time `MODEL_CATALOG_URL` global to the new catalog URL
    (with `VITE_MODEL_CATALOG_URL` / `VITE_MODEL_CATALOG_INDEX_URL`
    env overrides), kept as a transitional alias for one release.
    `fuse.js` is removed from `web-app/package.json`; `minisearch` is
    added (`^7.1.2`).
 9. **Locale + docs.** New `hub:fromHuggingFace*` keys added to
    `web-app/src/locales/en/hub.json`.
    [`web-app/src/services/AGENTS.md`](web-app/src/services/AGENTS.md)
    grows a §3 "Model Catalog Registry" mirroring §§1–2.

- **Consequences:**
 - **Catalog freshness.** A 12-hour cron + manual / external dispatch
   means new community quants (and our own `AtomicChat/*` releases)
   surface in Hub within an hour of merging the corresponding PR
   against the catalog repo — no Atomic Chat release required.
 - **Search quality.** On a 167-entry sanity scrape of `ggml-org`,
   the MiniSearch index builds in 7ms and answers per-query in <1ms.
   Long-tail queries like `qwen3.5 mlx 4bit` rank the
   `mlx-community/Qwen3.5-9B-MLX-4bit` repo first on macOS, the
   GGUF quants first elsewhere — verified by
   `web-app/src/services/__tests__/model-search.test.ts`.
 - **Reach.** The catalog is intentionally a curated whitelist (≈25
   orgs). Models from outside that whitelist remain discoverable via
   the Path B HF fallback, which now returns up to 10 candidates per
   query instead of one. Pasting a `huggingface.co/owner/repo` URL
   still hits the existing exact-id path in
   `default.ts :: fetchHuggingFaceRepo` and renders the model card
   immediately.
 - **Bundle size & startup.** `minisearch` adds ~28 kB gzipped to the
   web bundle; `fuse.js` (~7 kB) is removed. The pre-built index ships
   over the wire (sized roughly 1 MB for a 5k-model catalog), so
   first-launch search is instant once the GitHub Release is reachable.
   Offline first launches fall back to `BASELINE_MODEL_CATALOG` (5
   entries today) so Hub never renders empty.
 - **Backwards compatibility.** No persisted client state changes
   shape. `useModelSources`' public surface (`sources`, `fetchSources`,
   `loading`, `error`) is preserved bit-for-bit. The legacy
   `MODEL_CATALOG_URL` global keeps working through a transitional
   alias in `vite.config.ts`. Drop the alias in a follow-up after one
   release window.
 - **What did NOT change.** `recommended-models-registry` stays on
   `atomic-chat-conf` (its manifest is intentionally hand-curated, not
   scraped). `provider-registry` is untouched. Download / verification
   pipelines (`llamacpp` / `mlx`) consume the exact same `CatalogModel`
   shape they always have.
 - **Test coverage.** Three new vitest suites
   (`model-catalog-registry.test.ts` — 6 cases covering the six
   failure-mode branches; `model-search.test.ts` — 7 cases pinning the
   ranking properties; rewritten `useModelSources.test.ts` — 4 cases
   covering the shim) plus the existing provider / recommended-models
   suites all pass (42 tests).

- **Owner:** team.
- **Links:** [AtomicBot-ai/atomic-chat-model-catalog](https://github.com/AtomicBot-ai/atomic-chat-model-catalog),
 [`web-app/src/services/model-catalog-registry.ts`](web-app/src/services/model-catalog-registry.ts),
 [`web-app/src/services/model-search.ts`](web-app/src/services/model-search.ts),
 [`web-app/src/stores/model-catalog-store.ts`](web-app/src/stores/model-catalog-store.ts),
 [`web-app/src/hooks/useModelSources.ts`](web-app/src/hooks/useModelSources.ts),
 [`web-app/src/services/models/default.ts`](web-app/src/services/models/default.ts),
 [`web-app/src/routes/hub/index.tsx`](web-app/src/routes/hub/index.tsx),
 [`web-app/src/constants/models.ts`](web-app/src/constants/models.ts),
 [`web-app/src/services/AGENTS.md`](web-app/src/services/AGENTS.md) §3,
 [MiniSearch](https://github.com/lucaong/minisearch).

### 2026-05-27 — System Monitor falls back to NVML/Vulkan when `--list-devices` is empty; fix NVIDIA dup-log spam and the missing `refresh_system_info` ACL
- **Context:** Two new Discord reports confirmed that the 2026-05-26
  work (driver-gate precision + tier-picker corroboration guard +
  `DriverOutdatedBanner`) did not move the user-visible symptom on
  the affected cohort:
    - **Xenix** — RTX 4090 Laptop, Win 11 Pro, driver `596.49`, CUDA
      13.2, i9-14900HX, 128 GiB RAM. `nvidia-smi` shows
      `llama-server.exe` running as a Compute (`C`) process with
      15.6 / 16.4 GiB VRAM in use, yet System Monitor still says
      "No GPUs detected".
    - **killinkluck** — AMD RX 7900 XTX (24 GiB), Win 11 Pro,
      Ryzen 9 5950X. Same UI symptom, and the user explicitly
      reports "I do see GPU utilization when using, just not visible
      in the UI" — i.e. the Vulkan backend is decoding on the GPU
      but the Active GPUs panel pretends nothing is there.

  Root cause is in the **UI layer**, not the backend picker the
  2026-05-26 ADR addressed:
  [`web-app/src/routes/system-monitor.tsx`](web-app/src/routes/system-monitor.tsx)
  and [`web-app/src/routes/settings/hardware.tsx`](web-app/src/routes/settings/hardware.tsx)
  both used `llamacppDevices.length === 0` (the parsed stdout of
  `llama-server.exe --list-devices`) as the **single** source of
  truth for the Active GPUs panel. The 2026-05-26 corroboration
  guard for `tierEnumeratesDevices` only ran in
  `detectIdealBackendType()` — it stopped the backend picker from
  misbehaving but did not fix the cosmetic UI bug, which is exactly
  what end users notice.

  Two collateral bugs surfaced while we were here:
    1. **`get_usage_nvidia called on non-NVIDIA GPU` log spam.**
       [`tauri-plugin-hardware/src/commands.rs::compute_system_info`](src-tauri/plugins/tauri-plugin-hardware/src/commands.rs)
       deduplicates GPUs by `uuid`, but NVML's CUDA UUID and
       Vulkan's `VkPhysicalDeviceIDProperties.deviceUUID` are
       **not guaranteed to be byte-identical for the same physical
       NVIDIA card** (a documented NVIDIA quirk). On hosts where
       they differ, one RTX 4090 ends up as two map entries — one
       NVML-sourced (`nvidia_info: Some`), one Vulkan-sourced
       (`vendor: NVIDIA` via PCI vendor_id 0x10DE,
       `nvidia_info: None`). Every 5 s `get_system_usage` poll
       called `get_usage_nvidia` on the Vulkan duplicate, tripped
       the `nvidia_info.is_none()` branch, and spammed
       `log::error!("called on non-NVIDIA GPU")` — wrong message
       (the card IS NVIDIA) and infinite noise.
    2. **`Command plugin:hardware:refresh_system_info not allowed
       by ACL`.** [`tauri-plugin-hardware/build.rs`](src-tauri/plugins/tauri-plugin-hardware/build.rs)
       had `const COMMANDS: &[&str] = &["get_system_info",
       "get_system_usage"]`, missing `refresh_system_info`. The
       command was wired in
       [`lib.rs::init`](src-tauri/plugins/tauri-plugin-hardware/src/lib.rs)
       and called from
       [`web-app/src/services/hardware/tauri.ts`](web-app/src/services/hardware/tauri.ts)
       on every visibility change, but `tauri_plugin::Builder` had
       never generated an autogen permission TOML for it, so the
       default permission set didn't allow it.

- **Decision:**
    1. **UI fallback (Fix C / Bug #1).** When `llamacppDevices` is
       empty AND `hardwareData.gpus.length > 0`, render the GPUs
       the hardware plugin sees, with a subdued note
       (`system-monitor:liveStatsUnavailable`, EN + RU; other
       locales fall back to EN) clarifying that live VRAM stats
       are limited but the GPU is still usable. New helper
       [`web-app/src/lib/gpuFallback.ts`](web-app/src/lib/gpuFallback.ts)
       exports `buildFallbackDevices(gpus)` which dedupes by
       `(vendor, name, total_memory)` — a safe UI-side dedup that
       collapses the NVML/Vulkan duplicate from Bug #2 for the
       single-physical-GPU case (99% of hosts) while leaving
       multi-GPU rigs with two identical cards slightly wrong
       (queued as future ADR follow-up; see Future Work below).
       Fallback cards omit `free` / `used` because (a) the
       Vulkan-sourced duplicate has no matching `systemUsage.gpus[]`
       entry post-Fix B and (b) the `--list-devices` code path that
       normally provides per-device free VRAM is the very thing
       we're routing around. The misleading "No GPUs detected"
       message now only shows when both signals agree (neither
       `--list-devices` nor NVML/Vulkan see anything).
    2. **Dispatch guard for the dup-spam (Fix B / Bug #2).**
       [`tauri-plugin-hardware/src/gpu.rs::GpuInfo::get_usage`](src-tauri/plugins/tauri-plugin-hardware/src/gpu.rs)
       now matches on `Vendor::NVIDIA if self.nvidia_info.is_some()`
       — Vulkan-only NVIDIA entries (the duplicate) fall through to
       `get_usage_unsupported` silently. The now-unreachable guard
       inside `get_usage_nvidia`
       ([`vendor/nvidia.rs`](src-tauri/plugins/tauri-plugin-hardware/src/vendor/nvidia.rs))
       is kept as defense-in-depth but its `log::error!` was
       downgraded to `log::trace!` with an explanatory comment.
       The underlying UUID-mismatch dedup is **not** fixed by this
       ADR — that needs PCI-BDF-based reconciliation across
       NVML / Vulkan / Win32_VideoController and is queued as
       separate work (Fix D in the 2026-05-27 plan); the current
       dedup behaviour in `commands.rs` is preserved unchanged.
    3. **Missing ACL (Fix A / Bug #3).** Added `"refresh_system_info"`
       to `COMMANDS` in
       [`tauri-plugin-hardware/build.rs`](src-tauri/plugins/tauri-plugin-hardware/build.rs),
       added `"allow-refresh-system-info"` to
       [`permissions/default.toml`](src-tauri/plugins/tauri-plugin-hardware/permissions/default.toml),
       and committed the matching autogen
       `permissions/autogenerated/commands/refresh_system_info.toml`
       so the fix is self-contained. The `reference.md` and
       `permissions/schemas/schema.json` were regenerated by the
       tauri build that happened during local verification. All
       five existing capability files in `src-tauri/capabilities/`
       already include `"hardware:default"` and therefore pick up
       the new permission with no further edits.

- **Consequences:**
    - **End-user-visible.** Xenix and killinkluck (and anyone in
      their cohort) will now see their GPU in System Monitor and
      Settings → Hardware, with the subdued note explaining live
      VRAM stats are limited. Inference path is unchanged — the
      backend picker still routes through the 2026-05-26 health
      check; we only fixed what we **display**.
    - **Log noise gone.** On Xenix-class hosts (Bug #2 cohort), the
      NVIDIA dup spam stops immediately on next launch. No log
      throttling required.
    - **Visibility-refresh works.** The previously-failing
      `plugin:hardware:refresh_system_info` invocation now succeeds,
      restoring the post-resume / post-tab-focus GPU re-detection
      that was silently broken.
    - **No silent fallback to CPU regressions.** The corroboration
      guard from the 2026-05-26 ADR is unchanged. The new UI
      fallback only changes what we display.
    - **NOT fixed by this ADR (deliberately):**
        - The underlying NVML/Vulkan UUID dedup quirk — multi-GPU
          rigs with two identical NVIDIA cards will still see a
          single collapsed entry in the fallback view. Single-GPU
          and mixed-card multi-GPU setups are unaffected. Fix D
          (PCI-BDF-based dedup) is the proper follow-up.
        - The two-code-paths divergence in `llama-server.exe`
          (why `--list-devices` returns empty while real inference
          works) — needs `--list-devices` stderr from an affected
          host. The diagnostics collector
          [`scripts/collect-windows-gpu-diag.ps1`](scripts/collect-windows-gpu-diag.ps1)
          captures exactly this; we're waiting on the .zip from
          Xenix / killinkluck.
        - Manual backend override UI (m.iko feature request) — out
          of scope for this round.

- **Owner:** team.
- **Links:** Discord support thread 2026-05-26/27 (Xenix:
  RTX 4090 Laptop / drv 596.49 / CUDA 13.2; killinkluck:
  RX 7900 XTX), the 2026-05-26 ADR *Correct CUDA 13.1 driver
  gate …*,
  files: [`web-app/src/routes/system-monitor.tsx`](web-app/src/routes/system-monitor.tsx),
  [`web-app/src/routes/settings/hardware.tsx`](web-app/src/routes/settings/hardware.tsx),
  [`web-app/src/lib/gpuFallback.ts`](web-app/src/lib/gpuFallback.ts),
  [`web-app/src/locales/en/system-monitor.json`](web-app/src/locales/en/system-monitor.json),
  [`web-app/src/locales/ru/system-monitor.json`](web-app/src/locales/ru/system-monitor.json),
  [`src-tauri/plugins/tauri-plugin-hardware/src/gpu.rs`](src-tauri/plugins/tauri-plugin-hardware/src/gpu.rs),
  [`src-tauri/plugins/tauri-plugin-hardware/src/vendor/nvidia.rs`](src-tauri/plugins/tauri-plugin-hardware/src/vendor/nvidia.rs),
  [`src-tauri/plugins/tauri-plugin-hardware/build.rs`](src-tauri/plugins/tauri-plugin-hardware/build.rs),
  [`src-tauri/plugins/tauri-plugin-hardware/permissions/default.toml`](src-tauri/plugins/tauri-plugin-hardware/permissions/default.toml),
  [`src-tauri/plugins/tauri-plugin-hardware/permissions/autogenerated/commands/refresh_system_info.toml`](src-tauri/plugins/tauri-plugin-hardware/permissions/autogenerated/commands/refresh_system_info.toml),
  [`scripts/collect-windows-gpu-diag.ps1`](scripts/collect-windows-gpu-diag.ps1)
  (diagnostics collector still pending data from affected users).

### 2026-05-26 — Correct CUDA 13.1 driver gate to NVIDIA-documented `581.15` and add runtime `--list-devices` health-check as self-healing degrade for the Windows tier picker
- **Context:** Multiple bug reports
  ([AtomicBot-ai/Atomic-Chat#25](https://github.com/AtomicBot-ai/Atomic-Chat/issues/25),
  [janhq/jan#7553](https://github.com/janhq/jan/issues/7553),
  [ggml-org/llama.cpp#19868](https://github.com/ggml-org/llama.cpp/issues/19868))
  surfaced "No GPUs detected" on Windows for high-end NVIDIA cards
  (RTX 4090 Laptop, 5090). System Monitor's `noGpus` label is driven by
  `llamacppDevices.length === 0` (the parsed stdout of
  `llama-server.exe --list-devices` for the currently-selected backend),
  not by raw `hardwareData.gpus` enumeration. So the user-visible
  message fires whenever the chosen backend's binary loads but its
  `cuInit()` returns zero devices — not when NVML/Vulkan can't see the
  card. Two separate driver-class root causes were observable:
    1. **H1 — `cuda-13.1` binary on a driver below the documented CUDA
       Toolkit 13.1 minimum (Windows `581.15`).** Our static driver gate
       `min_cuda13_driver` was `"581"` (effectively `>= 581.00`), a
       0.15 below the NVIDIA-published floor. Drivers in the narrow
       `581.00–581.14` band passed our gate but failed `cuInit()` at
       runtime → empty `--list-devices` → "No GPUs detected".
    2. **H7 — Drivers in `528.xx–550.xx`** (NVIDIA Studio Driver 528 /
       537 / 546, GameReady 531 / 536 / 546, corporate WHQL, OEM
       pre-installs) silently lost CUDA entirely after the
       2026-05-22 ADR *Windows ships only `llamacpp-upstream`* bumped
       `min_cuda12_driver` from `527.41` (CUDA 12.0, supported by the
       legacy janhq mirror) to `551.61` (CUDA 12.4, ggml-org's lowest
       Windows CUDA tier). These users fell back to `win-cpu-x64` with
       no UI signal telling them to update the driver.

  Independent of the driver root cause, both H1 and H7 produced the
  same opaque symptom because `detectIdealBackendType()` had no
  health-check — it picked the highest tier the static gate allowed
  and `recheckOptimalBackend()` returned `null` ("already on optimal
  category") whenever the persisted `version_backend` already matched
  the picked category, even if the corresponding binary couldn't
  actually enumerate any device. Once a broken `cuda-13.1` was
  persisted, the user was stuck on it forever without manual
  intervention.

- **Decision:**
    1. **Bump `min_cuda13_driver` for Windows from `"581"` to `"581.15"`**
       in [`src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/backend.rs`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/backend.rs),
       matching the NVIDIA CUDA Toolkit 13.1 Release Notes exactly.
       Linux and the turboquant plugin's thresholds unchanged. New
       boundary tests cover `581.14` (rejected), `581.15` (accepted),
       `581.42` (accepted — typical recent driver), `550.00` (rejected
       for both CUDA tiers — H7), and `551.61` (CUDA 12.4 only).
    2. **Add a runtime `--list-devices` health-check** to the Windows
       tier picker, **guarded by a corroborating-GPU check** against the
       hardware plugin (NVML / Vulkan). New private method
       `tierEnumeratesDevices(backendType, sysInfo)` in
       [`extensions/llamacpp-upstream-extension/src/index.ts`](extensions/llamacpp-upstream-extension/src/index.ts)
       returns a tri-state — `'works' | 'unverified' | 'broken'`:
         - `'works'` — `--list-devices` returned ≥1 device;
         - `'unverified'` — tier is not installed yet, OR tier is
           installed and `--list-devices` is empty / threw BUT NVML /
           Vulkan corroborate a matching GPU (NVIDIA for cuda-*, any
           GPU for vulkan-*);
         - `'broken'` — tier is installed, `--list-devices` is empty /
           threw, AND the hardware plugin sees no matching GPU.
       `detectIdealBackendType()` on Windows now iterates the ordered
       tier list `[cuda-13.1?, cuda-12.4?, vulkan?]` and skips a tier
       only when it returns `'broken'` (two independent signals agree).
       Helper `hasCorroboratingGpu(backendType, sysInfo)` does the
       NVML / Vulkan match by reading `sysInfo.gpus[*].vendor` (matches
       the strings serialised by
       [`tauri-plugin-hardware/src/types.rs`](src-tauri/plugins/tauri-plugin-hardware/src/types.rs)).
       The probe is **non-destructive** — it never triggers a download
       — and is only invoked from the two existing user-facing entry
       points (`SetupBackendStep` on first launch and the manual
       "Find optimal backend" button in provider settings).
    3. **Surface the H7 cohort with a UI banner.** New
       [`web-app/src/containers/DriverOutdatedBanner.tsx`](web-app/src/containers/DriverOutdatedBanner.tsx)
       (with helper `findOutdatedNvidiaGpu` + Rust-mirror
       `compareDriverVersions`) is mounted in
       [`web-app/src/routes/system-monitor.tsx`](web-app/src/routes/system-monitor.tsx)
       and [`web-app/src/routes/settings/hardware.tsx`](web-app/src/routes/settings/hardware.tsx)
       conditionally on `hardwareData.gpus.length > 0 &&
       llamacppDevices.length === 0`. It identifies any NVIDIA GPU
       below the `551.61` floor and renders an actionable alert with a
       link to `https://www.nvidia.com/drivers`. i18n keys
       `system-monitor:driverOutdated.{title,description,updateAction}`
       added for EN + RU; other locales fall back to EN.
    4. **Promote diagnostic logs from `debug!` to `warn!`** in
       [`src-tauri/plugins/tauri-plugin-hardware/src/vendor/nvidia.rs`](src-tauri/plugins/tauri-plugin-hardware/src/vendor/nvidia.rs)
       (NVML init failure, NVML not available) and enrich
       [`src-tauri/plugins/tauri-plugin-hardware/src/vendor/vulkan.rs`](src-tauri/plugins/tauri-plugin-hardware/src/vendor/vulkan.rs)
       (mention `vulkan-1.dll` / `libvulkan.so` as the likely missing
       library) and
       [`src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/device.rs`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/device.rs)
       (list three most common causes of an empty device list and
       point at the TS-side `tierEnumeratesDevices` as the consumer of
       this signal). Release-build logs (default `RUST_LOG=info`) now
       surface NVML / Vulkan loader failures and empty-enumeration
       events without needing a debug build.

- **Consequences:**
    - **Fix 1 is precision, not the primary user-visible fix.** The
      gate move from `"581"` to `"581.15"` affects only the narrow
      `581.00–581.14` driver band — typically beta / pre-release
      builds. The actual `cuInit()` failure observed in #25 (RTX 4090
      Laptop on a recent ≥581.15 driver) is *not* a driver-floor
      issue and is not fixed by Fix 1 alone. The most likely
      remaining cause for that cohort is NVIDIA Optimus / MUX-switch
      laptops where the dGPU is parked and `cuInit()` returns zero
      devices to a process started in the iGPU context. Fix 2 is the
      mechanism that rescues those users.
    - **Fix 2 makes the picker self-healing, but conservatively.** Two
      independent signals must agree before we degrade away from a
      tier: `--list-devices` must come back empty / throw AND the
      hardware plugin (NVML for CUDA, Vulkan loader for vulkan) must
      also fail to see a matching GPU. When that happens,
      `recheckOptimalBackend()` surfaces a recommendation to switch to
      the next tier — `cuda-13.1` → `cuda-12.4` → `vulkan` → `cpu`
      (terminal). The existing download-recommended-backend UI flow
      then carries the user through the upgrade. When `--list-devices`
      is empty but NVML / Vulkan corroborate a matching GPU, the tier
      is kept (`'unverified'`) and a single `info` log records the
      mismatch — the inference path uses its own CUDA init and is
      unaffected by `--list-devices` quirks (see Amendment below for
      the nvidia-smi evidence that motivated this guard). Cost: each
      already-installed tier costs one `--list-devices` invocation
      per `recheckOptimalBackend()` call — bounded at three tiers
      with a 30-second Rust-side timeout per call, so worst-case
      ~90s blocking for a host whose entire CUDA stack is broken.
      Probing is only triggered by the two existing user-facing entry
      points (`SetupBackendStep` on first launch, and the manual
      "Find optimal backend" button in provider settings) — there is
      no automatic background probe. A future ADR may add an
      auto-trigger when `hardwareData.gpus.length > 0 &&
      llamacppDevices.length === 0` is detected for >N seconds; for
      now this is a manual escalation step the banner from Fix 3
      drives the user to.
    - **Fix 3 makes the H7 cohort self-serve.** Users on drivers
      `528.xx–550.xx` previously saw a silent fallback to CPU. They
      now see a yellow actionable banner the moment they open
      System Monitor or Settings → Hardware. Cost: an extra check
      on every render of those screens, bounded by the size of
      `hardwareData.gpus` (typically 1–3) and `compareDriverVersions`
      runtime (microseconds). The banner is shown only when the
      symptom is present (`llamacppDevices.length === 0` AND a
      qualifying GPU is in `hardwareData.gpus`), so it cannot
      false-positive on healthy installs.
    - **Fix 4 makes user-shared logs informative.** The previous
      `debug!` level meant release-build logs were silent on NVML /
      Vulkan / `cuInit()` failures, forcing every bug report into a
      "please attach a debug-level log" round-trip. New `warn!` lines
      let triage start from the first user log.
    - **Backwards-compatible.** No persisted settings schema changes.
      No model migrations. No new IPC commands. No new on-disk paths.
      The new TS health-check uses the existing
      `plugin:llamacpp-upstream|get_devices` IPC, the existing
      `getLocalInstalledBackends`, and the existing
      `getBackendExePath`. macOS is unaffected (the early `IS_MAC`
      return in `recheckOptimalBackend` still bypasses the whole
      flow; the new tier-list code path is gated by
      `sysInfo.os_type === 'windows'`).
    - **Test coverage.** `cargo test` on the upstream plugin grew from
      27 to 31 backend tests; all 31 pass plus 126 plugin-wide tests.
      No new TS unit tests yet — `tierEnumeratesDevices` is
      integration-level (requires a real installed backend) and is
      covered by the manual test plan in the PR.

- **Amendment (same day) — nvidia-smi evidence narrowed Fix 2 scope:**
  After the four fixes landed, the #25 reporter shared `nvidia-smi`
  output from a representative affected host: **driver 596.49, CUDA
  13.2, RTX 4090 Laptop, WDDM mode, 15.6 / 16.4 GiB VRAM in use,
  `llama-server.exe` listed twice as a Compute (`C`) process.** This
  directly opposes the H1 root-cause for that host — the driver is
  well above `581.15`, CUDA 13.x ABI is fully supported, and the real
  inference path is already using the GPU successfully (VRAM is
  loaded, llama-server holds a Compute context). The "No GPUs
  detected" UI message and the empty `--list-devices` output must
  therefore come from a different code path than the inference one
  — most likely a parser quirk in
  [`tauri-plugin-llamacpp-upstream/src/device.rs::parse_device_output`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/device.rs),
  a cudart DLL search-path difference between the `--list-devices`
  invocation and the `load_session` invocation, or an environment /
  cwd mismatch between the two `Command::new("llama-server.exe")`
  call sites. Without that guard, the original Fix 2 (degrade on
  empty `--list-devices` alone) would have pushed this user — and
  the whole cohort he represents — off a **working** CUDA-13.1 onto
  CUDA-12.4 / Vulkan / CPU, making the bug worse. The
  corroborating-GPU guard added in this amendment ensures
  `tierEnumeratesDevices` returns `'unverified'` (not `'broken'`)
  when NVML still reports the matching NVIDIA GPU, so the picker
  keeps the working tier. Fix 2 still degrades when both signals
  agree — i.e. when the binary really cannot use any GPU (no NVML
  detection AND empty `--list-devices`). Outstanding follow-up to
  fully close #25 (separate from this ADR): capture stderr of
  `llama-server.exe --list-devices` on an affected host and decide
  between (a) hardening the stdout parser, (b) preferring NVML /
  Vulkan as the authoritative source for the System Monitor
  "Active GPUs" panel, or (c) both.

- **Owner:** team.
- **Links:** [AtomicBot-ai/Atomic-Chat#25](https://github.com/AtomicBot-ai/Atomic-Chat/issues/25),
  [janhq/jan#7553](https://github.com/janhq/jan/issues/7553),
  [ggml-org/llama.cpp#19868](https://github.com/ggml-org/llama.cpp/issues/19868),
  [ggml-org/llama.cpp release b9334](https://github.com/ggml-org/llama.cpp/releases/tag/b9334)
  (confirms `Windows x64 (CUDA 13) - CUDA 13.1 DLLs` shipping
  artifact),
  NVIDIA CUDA Toolkit 13.1 Release Notes (Windows minimum driver
  `581.15`), the 2026-05-22 ADR *Windows ships only `llamacpp-upstream`*,
  files: [`src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/backend.rs`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/backend.rs),
  [`extensions/llamacpp-upstream-extension/src/index.ts`](extensions/llamacpp-upstream-extension/src/index.ts),
  [`web-app/src/containers/DriverOutdatedBanner.tsx`](web-app/src/containers/DriverOutdatedBanner.tsx),
  [`web-app/src/routes/system-monitor.tsx`](web-app/src/routes/system-monitor.tsx),
  [`web-app/src/routes/settings/hardware.tsx`](web-app/src/routes/settings/hardware.tsx),
  [`src-tauri/plugins/tauri-plugin-hardware/src/vendor/nvidia.rs`](src-tauri/plugins/tauri-plugin-hardware/src/vendor/nvidia.rs),
  [`src-tauri/plugins/tauri-plugin-hardware/src/vendor/vulkan.rs`](src-tauri/plugins/tauri-plugin-hardware/src/vendor/vulkan.rs),
  [`src-tauri/plugins/tauri-plugin-hardware/src/types.rs`](src-tauri/plugins/tauri-plugin-hardware/src/types.rs)
  (source of truth for `vendor` strings consumed by
  `hasCorroboratingGpu`),
  [`src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/device.rs`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/device.rs).

### 2026-05-22 — Windows ships only `llamacpp-upstream`, sourced from `ggml-org/llama.cpp`
- **Context:** After the 2026-05-19 ADR *Ship upstream `ggml-org/llama.cpp`
  as a second macOS provider*, Windows ended up exposing **two** llama.cpp
  providers with effectively identical UI titles — the turboquant
  `llamacpp` extension (driven by `extensions/llamacpp-extension/` against
  `janhq/llama.cpp` Windows binaries that lack our TurboQuant kernels — see
  the 2026-05-19 ADR *Windows uses upstream `ggml-org/llama.cpp`, not the
  TurboQuant fork*) and the parallel `llamacpp-upstream` extension
  (driven by `extensions/llamacpp-upstream-extension/` against ggml-org
  directly on macOS). Because the turboquant features TurboQuant KV cache,
  TurboQuant weights, Gemma 4 MTP, Qwen 3.6 NextN are explicitly disabled
  on Windows anyway, the two providers were functionally equivalent on
  Windows — just two onboarding paths, two settings pages, two model lists,
  two backend folders on disk, two best-backend buttons. Users got
  confused. Internally we maintained two near-identical Windows code
  paths, two CI download steps, and two Tauri plugin registrations.
- **Decision:** On **Windows x64** only the `llamacpp-upstream` provider
  ships and the entire user-facing surface (onboarding, best-backend
  detection, settings, model imports) is routed through
  `llamacpp-upstream-extension` + `tauri-plugin-llamacpp-upstream`. The
  upstream extension is the **sole** source of Windows backend binaries
  (downloaded from `ggml-org/llama.cpp` releases as `.zip` archives) and
  the bundled offline fallback (`win-cpu-x64`) is shipped under
  `src-tauri/resources/llamacpp-backend-upstream/`. macOS keeps both
  providers per the 2026-05-19 ADR. Linux keeps `llamacpp` as the sole
  primary.
- **Consequences:**
  - **Build artefacts:**
    - `package.json :: build:extensions:win32` excludes
      `@janhq/llamacpp-extension` so the Windows `pre-install/` folder
      only carries `janhq-llamacpp-upstream-extension-*.tgz`.
    - `src-tauri/tauri.windows.conf.json` bundle resources include
      `resources/llamacpp-backend-upstream/**/*` and NOT
      `resources/llamacpp-backend/**/*`.
    - The `tauri-plugin-llamacpp` Rust crate is still registered on
      Windows because `src-tauri/src/core/server/proxy.rs` threads its
      `LlamacppState` type through ~16 routing sites. The plugin is
      effectively **dead code** on Windows — no extension drives it,
      no resource dir feeds it, no settings UI exposes it. The proxy's
      built-in "try turboquant pool → fall back to upstream pool →
      fall back to MLX" routing transparently handles any stray call.
      A future ADR may cfg-gate the type itself.
  - **Windows backend naming changes (NOT compatible with the legacy
    janhq matrix):** the supported variants are
    `win-cpu-x64`, `win-cuda-12.4-x64`, `win-cuda-13.1-x64`,
    `win-vulkan-x64`. There is **no CUDA 11 build** on Windows anymore
    (ggml-org dropped it; hosts whose NVIDIA driver only supports CUDA
    11 fall back to the CPU build). Driver thresholds are now
    `>= 551.61` for CUDA 12.4 and `>= 581` for CUDA 13.1, matching the
    ggml-org release notes. Legacy names like
    `win-cuda-12-common_cpus-x64` are mapped to the closest new variant
    by `map_old_backend_to_new` in
    `tauri-plugin-llamacpp-upstream/src/backend.rs`.
  - **On-disk layout:** the active backends directory on Windows
    becomes `<data>\llamacpp-upstream\backends\`. The legacy
    `<data>\llamacpp\backends\` from prior installs is intentionally
    left **orphaned** — there is no migration script. Onboarding's
    `SetupBackendStep` runs again on first launch (its
    `llamacpp_onboarding_done` localStorage flag stays per-provider on
    completion, not on identity) and auto-downloads the optimal
    upstream backend. If GPU detection or download fails, the bundled
    `win-cpu-x64` build serves as the always-available offline
    fallback.
  - **Models stay shared.** `MODELS_PROVIDER_ROOT = 'llamacpp'` in both
    extensions, so all GGUFs continue to live under
    `<data>\llamacpp\models\` regardless of which provider downloaded
    them. No model migration is needed; macOS users that switch
    between providers see the same model list on both.
  - **cudart DLLs source.** `ggml-org` publishes companion
    `cudart-llama-bin-win-cuda-12.4-x64.zip` /
    `cudart-llama-bin-win-cuda-13.1-x64.zip` archives on every release,
    so the cudart helper (`scripts/download-llamacpp-cudart-windows.ps1`
    and the runtime `ensureCudartReady` in
    `llamacpp-upstream-extension/src/index.ts`) pulls from ggml-org —
    not from `janhq/llama.cpp` like before. The companion archives are
    `.zip`, so the helper uses `Expand-Archive` instead of `tar -xzf`.
  - **UI shows a single provider on Windows.** The Settings →
    Providers list contains exactly one "Llama.cpp" entry, the
    onboarding `SetupBackendStep` and the Settings → Providers
    "Find optimal backend" button both target the upstream provider,
    and `getProviderTitle('llamacpp')` no longer returns "Llama.cpp"
    because that provider is not registered on Windows. The Windows
    arm of the provider id is centralized as
    `LOCAL_LLAMACPP_PROVIDER` / `LOCAL_LLAMACPP_EXTENSION_NAME` in
    `web-app/src/lib/utils.ts` so individual call sites don't fork
    per OS.
  - **CI / dev scripts:** `Makefile :: download-llamacpp-backend` is
    a no-op on Windows; the Windows branch of
    `download-llamacpp-upstream-backend` now does GPU detection and
    pulls the optimal ggml-org backend into the upstream resource dir,
    with `download-llamacpp-backend-win-cpu` kept as a deprecated
    alias delegating to `download-llamacpp-upstream-backend-win-cpu`.
    `scripts/dev-windows.ps1`, `scripts/build-windows-release.ps1`,
    and `.github/workflows/release.yml` (Windows job) all target
    `ggml-org/llama.cpp` and the upstream resource dir.
  - **macOS / Linux unchanged.** No code path on macOS or Linux is
    touched by this ADR. Linux still ships only the turboquant
    `llamacpp` provider; macOS still ships both per the 2026-05-19
    dual-provider ADR.
- **Owner:** team.
- **Links:** §4.2 *LLM backend*, the 2026-05-19 ADRs *Ship upstream
  `ggml-org/llama.cpp` as a second macOS provider* and *Windows uses
  upstream `ggml-org/llama.cpp`*, the 2026-05-22 ADR *Ship cudart DLLs
  with every Windows CUDA backend*, `extensions/llamacpp-upstream-extension/`,
  `src-tauri/plugins/tauri-plugin-llamacpp-upstream/`,
  `src-tauri/tauri.windows.conf.json`, `Makefile`,
  `scripts/dev-windows.ps1`, `scripts/build-windows-release.ps1`,
  `scripts/download-llamacpp-cudart-windows.ps1`,
  `web-app/src/lib/utils.ts`,
  `web-app/src/hooks/useBackendUpdater.ts`,
  `web-app/src/containers/SetupBackendStep.tsx`,
  `web-app/src/containers/SetupScreen.tsx`,
  `web-app/src/routes/settings/providers/$providerName.tsx`.

### 2026-05-22 — Pin static WiX `upgradeCode` to legacy Jan UUID for in-place MSI upgrades
- **Context:** Installing a newer Atomic Chat MSI on top of an existing Jan
  MSI (or, transitively, on top of an older Atomic Chat MSI built before this
  change) produced a side-by-side install instead of an in-place upgrade
  ([GitHub issue #11](https://github.com/AtomicBot-ai/Atomic-Chat/issues/11)).
  Root cause: Tauri 2 derives the WiX `UpgradeCode` from `productName` as
  `UUIDv5("<productName>.exe.app.x64")`. The Jan → Atomic Chat rebrand
  changed `productName` from `"Jan"` to `"Atomic Chat"`, which silently
  switched the derived UpgradeCode from `b75dd42f-800c-57cb-8c5c-ed7fcbef13a0`
  to `e66a76fe-8004-5158-ab35-98fc7d71e98d`, breaking Windows Installer's
  `MajorUpgrade` match.
- **Decision:** Set `bundle.windows.wix.upgradeCode =
  "b75dd42f-800c-57cb-8c5c-ed7fcbef13a0"` in `src-tauri/tauri.windows.conf.json`
  — the legacy Jan UUIDv5. From now on every Atomic Chat MSI carries this
  pinned UpgradeCode and is independent of any future `productName` rename.
  Verified via `npx tauri inspect wix-upgrade-code`:
  `Application Upgrade Code override: b75dd42f-…`.
- **Consequences:**
  - **Jan MSI → Atomic Chat MSI** now upgrades in place (Windows Installer
    sees the matching `UpgradeCode`, runs `MajorUpgrade`, removes Jan, and
    installs Atomic Chat into the same slot). Fixes #11 for that path.
  - **Atomic Chat MSI v_N → v_{N+1}**, both built after this ADR, upgrades
    in place forever, regardless of future rebrands.
  - **Atomic Chat MSI built before this ADR** (already shipped with the
    derived `e66a76fe-…` UpgradeCode) → Atomic Chat MSI built after this
    ADR will install side-by-side **once**. Users on those MSI builds must
    manually uninstall the old "Atomic Chat" entry from Programs & Features
    before the new MSI takes its place. The README and the auto-updater
    both use the NSIS channel, so the MSI install base is small.
  - NSIS channel and auto-updater are unaffected (NSIS detects previous
    installs via `Software\…\Uninstall\{ProductName}`, which is governed by
    `productName`, not `UpgradeCode`).
  - If the one-time side-by-side proves painful, a follow-up ADR may add a
    custom WiX fragment via `wix.fragmentPaths` containing an extra
    `<Upgrade Id="e66a76fe-8004-5158-ab35-98fc7d71e98d">` block that also
    detects and removes the old derived-UpgradeCode product. Not in this ADR.
- **Owner:** team.
- **Links:** [GitHub issue #11](https://github.com/AtomicBot-ai/Atomic-Chat/issues/11),
  `src-tauri/tauri.windows.conf.json`.

### 2026-05-22 — Ship `janhq/llama.cpp` cudart DLLs with every Windows CUDA backend
- **Context:** On Windows, `llama-server.exe --list-devices` from a freshly
  installed `win-cuda-{11,12,13}-common_cpus-x64` backend returned an empty
  device list, so GPU detection failed even on machines with a working
  NVIDIA driver
  ([GitHub issue #14](https://github.com/AtomicBot-ai/Atomic-Chat/issues/14)).
  Root cause: the `llama-{tag}-bin-win-cuda-*-common_cpus-x64.tar.gz` archive
  the app downloads ships `llama-server.exe` and direct deps only; the CUDA
  Toolkit runtime DLLs (`cudart64_*.dll`, `cublas64_*.dll`,
  `cublasLt64_*.dll`, …) live in a sibling
  `cudart-llama-bin-win-cu{X.Y}-x64.tar.gz` on the same `janhq/llama.cpp`
  release. Without those DLLs, llama-server's CUDA backend loader silently
  fails on hosts that don't have the CUDA Toolkit installed system-wide.
- **Decision:** Always merge the matching cudart DLLs into
  `<backendDir>/build/bin/` immediately after the main backend archive is
  extracted. Source is the **same** `janhq/llama.cpp` release as the main
  tarball — never `ggml-org`. Hard-coded mapping:
  - `win-cuda-11-common_cpus-x64` → `cudart-llama-bin-win-cu11.7-x64.tar.gz`
  - `win-cuda-12-common_cpus-x64` → `cudart-llama-bin-win-cu12.0-x64.tar.gz`
  - `win-cuda-13-common_cpus-x64` → `cudart-llama-bin-win-cu13.0-x64.tar.gz`

  Implemented at **two layers**, both idempotent:
  1. **Runtime** in `extensions/llamacpp-extension/`:
     - `getCudartDownloadUrl` / `getCudartArchiveName` / `getCudaToolkitVersion`
       helpers in `backend.ts`.
     - `ensureCudartReady` private method in `index.ts` that downloads
       through `@janhq/download-extension` (so the standard download UI
       tracks progress), extracts to a temp dir, and copies every `*.dll`
       into `build/bin/`. Probes `plugin:llamacpp|is_cuda_installed` first
       and is a no-op when DLLs are already present.
     - Wired into `downloadAndInstallBackend` (after main extract) and
       `ensureBackendReady` (pre-flight for users already on `b8892`
       without DLLs — they get the DLLs without re-downloading the 300 MB
       main tarball).
  2. **Build time** in `scripts/download-llamacpp-cudart-windows.ps1`
     (small reusable PowerShell helper), called from:
     - `Makefile :: download-llamacpp-backend` (Windows branch).
     - `scripts/dev-windows.ps1` after the main backend extract.
- **Consequences:**
  - GPU enumeration works out of the box on Windows for the CUDA-11/12/13
    backends, whether the backend was bundled in the installer
    (`make build-windows-release` with a CUDA backend env-var) or downloaded
    at runtime from janhq.
  - Already-installed users (e.g. the issue #14 reporter on `b8892`) are
    fixed on next backend interaction without forcing a full re-download.
  - +50–110 MB on disk per CUDA variant (per-user, after extract).
  - No new external host, no new dependency. Still no change to CI's
    bundled backend choice (Windows CI still ships CPU-only by default);
    the helper is available the moment CI flips to a CUDA bundle.
- **Owner:** team.
- **Links:** [GitHub issue #14](https://github.com/AtomicBot-ai/Atomic-Chat/issues/14),
  `extensions/llamacpp-extension/src/backend.ts`,
  `extensions/llamacpp-extension/src/index.ts`,
  `scripts/download-llamacpp-cudart-windows.ps1`,
  `Makefile` (`download-llamacpp-backend` Windows branch),
  `scripts/dev-windows.ps1`.

### 2026-05-22 — Windows auto-updater uses NSIS as sole relauncher
- **Context:** After a passive NSIS update on Windows 11, users saw a blank
  window until a manual restart. NSIS `.onInstSuccess` already launches the
  new binary via `RunAsUser`, while the frontend also called `relaunch()` →
  `app.restart()`, racing two processes.
- **Decision:** On Windows, skip `window.core.api.relaunch()` after
  `downloadAndInstallWithProgress()` completes. Let NSIS be the only
  relauncher. macOS/Linux keep the existing `relaunch()` path.
- **Consequences:** Eliminates the double-relaunch race on Win11. The old
  process may exit without an explicit `app.restart()`; users see a brief
  toast that the app will restart. No NSIS template changes required.
- **Owner:** team.
- **Links:** `web-app/src/hooks/useAppUpdater.ts`,
  `src-tauri/tauri.bundle.windows.nsis.template` (`.onInstSuccess`).

### 2026-05-22 — Windows ships `atomic-chat-cli.exe` as a copy of `jan.exe`
- **Context:** Settings UI told users to run `atomic-chat-cli`, but only
  `jan.exe` existed after install (renamed from bundled `jan-cli.exe`). Unix
  was unchanged and still exposes `jan` only.
- **Decision:** On Windows only, after `install_jan_cli` renames to `jan.exe`,
  copy `jan.exe` → `atomic-chat-cli.exe` in the same `resources/bin` directory
  (already on user PATH). Uninstall removes both binaries. Settings copy on
  Windows mentions both names; non-Windows copy says `jan` only.
- **Consequences:** `atomic-chat-cli` works on Windows without renaming legacy
  `jan-cli` / `jan.exe` artefacts. Two copies on disk (~small overhead).
  macOS/Linux unchanged.
- **Owner:** team.
- **Links:** `src-tauri/src/core/system/commands.rs`,
  `web-app/src/routes/settings/general.tsx`.

### 2026-05-19 — Ship upstream `ggml-org/llama.cpp` as a second macOS provider, no fork
- **Context:** Some users prefer (or need) the vanilla upstream
 `ggml-org/llama.cpp` build on macOS — for compatibility testing, parity
 with other tools, or to avoid TurboQuant-specific behavior. Maintaining
 our own macOS fork of upstream just to re-publish identical binaries
 would be pure overhead.
- **Decision:** Bundle the **official `ggml-org/llama.cpp`** macOS release
 alongside our `AtomicBot-ai/atomic-llama-cpp-turboquant` fork in the same
 DMG, surface it in the UI as a separate provider named **"Llama.cpp"**.
 We do **not** fork upstream. We pull the official macOS release tarballs
 (`llama-bXXXX-bin-macos-arm64.tar.gz` / `-macos-x64.tar.gz`) and
 **re-codesign** every Mach-O with our Developer ID + hardened runtime +
 timestamp so the binaries survive notarization inside our `.app`.
- **Consequences:**
 - macOS users now see two `llama.cpp`-family providers:
   - "Llama.cpp + TurboQuant" — `extensions/llamacpp-extension/` driving
     the turboquant fork (`resources/llamacpp-backend/`).
   - "Llama.cpp" — `extensions/llamacpp-upstream-extension/` driving the
     upstream build (`resources/llamacpp-backend-upstream/`).
 - The new pipeline is wired through `make download-llamacpp-upstream-backend`
   (called from `dev*` targets and the macOS CI job
   `build-macos > "Download upstream llama.cpp backend"`).
 - A sibling Rust plugin `tauri-plugin-llamacpp-upstream` (capability
   `llamacpp-upstream:default`) was created by copying
   `tauri-plugin-llamacpp` and switching the bundle root. `args.rs` keeps
   its `is_turboquant()` gate, so vanilla version strings fall back to
   `q8_0` KV automatically — no flag stripping required.
 - DMG size grows by ~40–60 MiB. We accept this in exchange for
   offline-ready, single-click provider switching.
 - Windows / Linux are **not** affected — their pipelines stay on the
   turboquant fork (Linux/macOS-Intel/macOS-arm64) and `janhq/llama.cpp`
   mirror (Windows) respectively.
 - Cost: a parallel Rust plugin and TS extension. Mostly mechanical copies
   — a future cleanup may collapse them behind a vendor-aware plugin.
 - **Local API Server proxy is dual-state aware.** The proxy at
   `http://localhost:1337/v1` (see `src-tauri/src/core/server/proxy.rs`
   and `core/server/commands.rs`) takes session-pool handles from both
   `tauri_plugin_llamacpp::state::LlamacppState` (turboquant) and
   `tauri_plugin_llamacpp_upstream::state::LlamacppState` (upstream).
   Model lookup tries turboquant first, then upstream, then MLX, and
   tags `state.backend` with `"llamacpp" | "llamacpp-upstream" | "mlx"`
   accordingly. `/v1/models` lists models from all three pools,
   `/v1/metrics` resolves the right `llama-server` for either llama.cpp
   variant, and the auto-increase-ctx retry path treats
   `llamacpp-upstream` symmetrically with `llamacpp`. The upstream
   extension only listens to `local_backend://auto_increase_ctx` events
   whose `backend === 'llamacpp-upstream'`, so ownership is unambiguous.
 - **Shared GGUF tree, isolated engines.** Both providers store and read
   models from the same on-disk tree at `<jan>/llamacpp/models/<modelId>/`
   (constant `MODELS_PROVIDER_ROOT = 'llamacpp'` in the upstream
   extension). A single download serves both engines. Backend binaries
   and per-provider settings stay isolated under each provider's own
   folder: `<jan>/llamacpp/backends/` for turboquant and
   `<jan>/llamacpp-upstream/backends/` for upstream. Each provider's
   Models tab in the UI shows the same model list but reports
   `Running` (and exposes Start/Stop) only for sessions owned by **its
   own** plugin state, because each plugin holds an independent
   `LlamacppState` pool and queries it via its own
   `plugin:llamacpp|*` or `plugin:llamacpp-upstream|*` IPC namespace.
   This means a single model can be running on both engines
   simultaneously on different ports — fine, both processes mmap the
   same GGUF read-only.
 - **Upstream backend updates ship only with Atomic Chat releases.**
   `extensions/llamacpp-upstream-extension/src/backend.ts::fetchRemoteBackends`
   returns `[]` unconditionally, mirroring the turboquant extension's
   macOS behavior. The Atomic Chat installer ships exactly one
   `llama-server` build per release — the one fetched and re-codesigned
   by `make download-llamacpp-upstream-backend` against
   `https://api.github.com/repos/ggml-org/llama.cpp/releases/latest`
   at build time. The provider settings dropdown therefore only lists
   the bundled backend plus any backends the user installed locally;
   no runtime GitHub polling, no silent in-place upgrades, no
   rate-limit surprises. Re-enabling runtime fetching is a deliberate
   future ADR change, not an opportunistic one.
- **Owner:** team.
- **Links:** `Makefile` (`download-llamacpp-upstream-backend`),
 `src-tauri/plugins/tauri-plugin-llamacpp-upstream/`,
 `extensions/llamacpp-upstream-extension/`,
 [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp).

### 2026-05-19 — Windows uses upstream `ggml-org/llama.cpp`, not the TurboQuant fork
- **Context:** Our `atomic-llama-cpp-turboquant` fork ships TurboQuant KV /
  weight kernels and the Gemma 4 MTP / Qwen 3.6 NextN speculative-decoding
  paths on Metal / CUDA / Vulkan / HIP. Producing and validating signed
  Windows builds of the fork with all of those code paths working
  (especially the Metal-equivalents and the CUDA TurboQuant kernels) is
  not yet at the bar we ship on.
- **Decision:** On **Windows x64** Atomic Chat downloads and runs the
  **official `ggml-org/llama.cpp`** release as the `llamacpp-extension`
  backend. macOS and Linux continue to use our
  `AtomicBot-ai/atomic-llama-cpp-turboquant` fork.
- **Consequences:**
  - Windows users do **not** get TurboQuant KV cache (`-ctk turbo*` /
    `-ctv turbo*`), TurboQuant weight types (`TQ3_1S` / `TQ4_1S`), Gemma 4
    MTP (`--mtp-head`, `--spec-type mtp`) or Qwen 3.6 NextN
    (`--spec-type nextn`) today. They get the standard upstream feature
    set instead.
  - The download manifest in `scripts/download-bin.mjs` /
    `scripts/download-lib.mjs` and the platform-dispatch logic in
    `extensions/llamacpp-extension/` are the source of truth for "which
    binary on which OS". Any new fork-only flag wired into the extension
    must be guarded behind a runtime capability check, not assumed
    available on every host.
  - UI surfaces that advertise TurboQuant / MTP / NextN must hide or
    disable the controls when the active backend build is the upstream
    Windows one.
  - When we are ready to ship the fork on Windows, replace this ADR with
    a follow-up entry that records the build / signing / kernel-coverage
    work that unblocked it.
- **Owner:** team.
- **Links:** §4.2 *LLM backend*,
  [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp),
  [AtomicBot-ai/atomic-llama-cpp-turboquant](https://github.com/AtomicBot-ai/atomic-llama-cpp-turboquant),
  `extensions/llamacpp-extension/`, `scripts/download-bin.mjs`.

### 2026-05-19 — Use `AtomicBot-ai/mlx-vlm` as the MLX backend
- **Context:** We need a fast, actively maintained MLX VLM stack on Apple
  Silicon that supports continuous batching, KV-cache quantization, prefix
  caching, and speculative decoding for Gemma 4 / Qwen 3.5.
- **Decision:** Use our fork [`AtomicBot-ai/mlx-vlm`](https://github.com/AtomicBot-ai/mlx-vlm)
  of `Blaizzy/mlx-vlm`. Wrap it in `mlx-server/` (Swift sidecar) and drive
  it from `extensions/mlx-extension/`.
- **Consequences:** Apple Silicon gets first-class VLM / omni support with
  features upstream `llama.cpp` does not have on Metal (TurboQuant + APC
  + DFlash/MTP drafters). Cost: we now own a Python ML fork and must keep
  it in sync with `Blaizzy/mlx-vlm` upstream changes.
- **Owner:** team.
- **Links:** [AtomicBot-ai/mlx-vlm](https://github.com/AtomicBot-ai/mlx-vlm),
  `mlx-server/`, `extensions/mlx-extension/`.

### 2026-05-19 — Use `AtomicBot-ai/atomic-llama-cpp-turboquant` as the LLM backend
- **Context:** We need a cross-platform LLM runtime (Metal / CUDA / Vulkan /
  HIP / CPU) with aggressive KV compression and speculative decoding so
  long-context chat fits in laptop / desktop budgets.
- **Decision:** Use our fork
  [`AtomicBot-ai/atomic-llama-cpp-turboquant`](https://github.com/AtomicBot-ai/atomic-llama-cpp-turboquant),
  branch `feature/turboquant-kv-cache`. Default KV cache settings on
  supported platforms: `-ctk turbo3 -ctv turbo3 -fa on`. Recommend
  Gemma 4 MTP and Qwen 3.6 NextN speculative decoding where the target
  family supports it.
- **Consequences:** Single binary serves all desktop OSes; +30–50 %
  short-prompt throughput on Gemma 4 26B-A4B / 31B and +24–36 % on
  Qwen 3.6 35B-A3B MoE. Cost: we maintain a llama.cpp fork (credit:
  @TheTom for the original TurboQuant work) and must rebase against
  `ggml-org/llama.cpp` periodically.
- **Owner:** team.
- **Links:** [AtomicBot-ai/atomic-llama-cpp-turboquant](https://github.com/AtomicBot-ai/atomic-llama-cpp-turboquant),
  `extensions/llamacpp-extension/`, `MTP.md`, `NEXTN.md`,
  `docs/speculative.md` (in the backend repo).

### 2026-05-19 — Product identity is "Atomic Chat"; new code stops carrying Jan branding
- **Context:** The repo is a hard fork of `janhq/jan`. Existing artefacts
  (root `package.json` `name: jan-app`, `@janhq/*` workspaces, `jan-cli`
  binary, `pre-install/janhq-*.tgz`, Windows APPDATA folders) still carry
  Jan names because renaming any of them would break installer migrations
  and existing user data on disk.
- **Decision:** Atomic Chat is the product. **All new** features, modules,
  package names, identifiers, env vars, log prefixes, telemetry events,
  user-facing copy, and docs use Atomic Chat — never Jan. Existing legacy
  names stay until a dedicated migration task renames them with a proper
  data-migration plan.
- **Consequences:** Clear forward direction without breaking installed
  users; some short-term inconsistency between legacy and new naming is
  accepted. Future migration tasks (rename CLI, repackage extensions,
  consolidate APPDATA folders, change repo URL in `Cargo.toml`) will each
  get their own ADR entry.
- **Owner:** team.
- **Links:** §1 *Product identity*, §6 *Known naming debt*, `DEVELOP.md`
  "Where Atomic Chat stores data on Windows".
