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
    --kv-quant-scheme turboquant`). Surfaced in the UI via the MLX
    provider's **KV Cache Quantization** (off / turboquant / uniform) +
    **KV Cache Bits** settings, plumbed through `MlxConfig.kv_quant_scheme`
    / `MlxConfig.kv_bits` in `tauri-plugin-mlx`.
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

### 2026-06-24 — Add a "Find optimal backend" button + a once-ever post-first-launch popup to the TurboQuant `llamacpp` provider on Windows/Linux (clean-id optimal detection, provider-aware `useBackendUpdater`)
- **Context:** The 2026-06-23 ADR shipped the TurboQuant `llamacpp` provider
 on Windows/Linux as a second provider, resolving its backend catalog from
 the `atomic-chat-conf` turboquant manifest with clean ids
 (`windows-x64-cuda-13.3`, `linux-x64-vulkan`, …). But the *optimal-detection*
 path was stale: `detectIdealBackendType`
 ([`extensions/llamacpp-extension/src/index.ts`](extensions/llamacpp-extension/src/index.ts))
 still returned legacy janhq ids (`win-cuda-13-common_cpus-x64`) absent from
 the manifest, so a recommendation pointed at a non-existent asset; the
 web-app `useBackendUpdater`
 ([`web-app/src/hooks/useBackendUpdater.ts`](web-app/src/hooks/useBackendUpdater.ts))
 was hardwired to the upstream extension + the `llama_cpp_*` localStorage
 keys; and the Settings "Find optimal backend" button
 ([`web-app/src/routes/settings/providers/$providerName.tsx`](web-app/src/routes/settings/providers/$providerName.tsx))
 was gated to `provider === LOCAL_LLAMACPP_PROVIDER` (upstream only). So a
 TurboQuant user on Win/Linux booted on the bundled CPU build with no way to
 discover/download a faster GPU backend, and the default-vision out-of-box
 path (request #3, upstream-first) was already correct but unverified.
- **Decision (per the user-chosen options — popup shown `once_ever`, scope
 `win_linux`):**
 1. **Clean-id optimal detection (TurboQuant extension).**
 `detectIdealBackendType` rewritten to pick from `listSupportedBackends()`
 (already manifest-filtered to clean, supported ids) and return the
 upstream-style discriminated `IdealBackendResult` (`gpu` / `cpu-optimal`
 / `detection-failed`) + an exported `BACKEND_DETECTION_FAILED` sentinel:
 Windows prefers `windows-x64-cuda-13.3` (cuda13) → `windows-x64-cuda-12.4`
 (cuda12) → `windows-x64-vulkan` (vulkan + VRAM); Linux → `linux-x64-vulkan`
 (vulkan + VRAM) else cpu-optimal. `recheckOptimalBackend` runs detection
 under `withTimeout`, throws `BACKEND_DETECTION_FAILED` on manifest
 unreachability, returns null on cpu-optimal, and on `gpu` resolves the
 concrete `{ version: tag, backend: id }` straight from the catalog (each
 turboquant entry carries its own tag), persisting + emitting
 `onBetterBackendDetected`. `get_backend_category`/`backendCategoryToLabel`
 updated to recognise the clean ids. Provider-specific localStorage keys
 (`TURBOQUANT_RECOMMENDATION_KEY` / `TURBOQUANT_PENDING_KEY`) replace the
 hardcoded `llama_cpp_*` keys to avoid collision with the upstream
 extension (both ship on Win/Linux).
 2. **Provider-aware `useBackendUpdater`.** New optional
 `UseBackendUpdaterConfig` (`extensionName` / `providerId` /
 `recommendationKey` / `postUpgradeRecheckEnabled`), defaulting to the
 upstream extension + existing keys. `handleBetterBackendDetected` now
 filters events by `providerId` so the turboquant and upstream instances
 of the hook never cross-contaminate. `$providerName.tsx` builds the config
 with `useMemo` keyed on `providerName === 'llamacpp'` and extends the
 button's render gate + `handleFindOptimalBackend` to fire for
 `provider === 'llamacpp'` on `IS_WINDOWS || IS_LINUX`, reusing the
 existing `backendUpdater.*` i18n.
 3. **Once-ever first-launch popup.** New
 [`web-app/src/containers/dialogs/TurboquantOptimalBackendDialog.tsx`](web-app/src/containers/dialogs/TurboquantOptimalBackendDialog.tsx)
 (Skip / Find optimal), mounted globally in
 [`__root.tsx`](web-app/src/routes/__root.tsx) next to `BackendUpdater`
 (gated on `isSetupCompleted`). It drives the whole flow through a
 turboquant-configured `useBackendUpdater`, so detection → download →
 hot-swap → restart-required render off the hook's `recommendationPhase`.
 Trigger: `maybePromptTurboquantOptimal` in
 [`switchModel.ts`](web-app/src/utils/switchModel.ts) dispatches a window
 `TURBOQUANT_OPTIMAL_PROMPT_EVENT` on a successful start where the provider
 is `llamacpp`, on Win/Linux, and the new
 `localStorageKey.turboquantOptimalPromptShown` flag is unset (called on
 both the already-active and full-load success paths). The dialog **sets
 the flag the moment it is shown**, so it is strictly once-ever even if the
 user dismisses with Esc or reloads mid-flow.
 4. **Driver-floor alignment (Part A.4).** `min_cuda13_driver` for Windows
 in [`tauri-plugin-llamacpp/src/backend.rs`](src-tauri/plugins/tauri-plugin-llamacpp/src/backend.rs)
 raised to the NVIDIA-documented `581.15`, matching the `llamacpp-upstream`
 plugin.
 5. **Default-provider verification (request #3).** Confirmed upstream is
 already the default everywhere (`LOCAL_LLAMACPP_PROVIDER =
 'llamacpp-upstream'`, `getModelToStart` order upstream-first); added the
 missing `'llamacpp-upstream'` arm to the empty-state fallback `find` in
 [`DropdownModelProvider.tsx`](web-app/src/containers/DropdownModelProvider.tsx)
 (previously matched only `llamacpp | mlx`, so a fresh install with models
 only under the upstream provider could fail to auto-select one).
- **Consequences:** TurboQuant users on Windows/Linux now get a one-time
 prompt after their first model start offering to download the fastest
 backend for their hardware (CUDA/Vulkan), plus a persistent
 Settings → Providers "Find optimal backend" button — exactly mirroring the
 upstream provider, but resolving every id/tag from the turboquant manifest.
 "Skip" keeps the current (bundled CPU) backend; the model is already running
 either way. macOS turboquant (single `macos-arm64` backend) is untouched —
 the popup and button are Win/Linux-gated. **Deliberately NOT done:** no
 per-provider tagging of the `app:backend-hotswapped` event (pre-existing;
 both dialog instances receive it, harmless since the global `BackendUpdater`
 has a null turboquant recommendation); no stale-comment sweep beyond the
 `DropdownModelProvider` fallback. **Verified:** web-app `tsc -b` clean;
 `eslint` clean on all 7 touched web-app files; turboquant extension rolldown
 build clean (`dist/index.js` 196.11 kB, exit 0 — the authoritative compile);
 `cargo test --lib backend` 33/33 green in `tauri-plugin-llamacpp`; all reused
 `backendUpdater.*` keys present and the new `turboquantOptimalPrompt.*` block
 added in EN + RU (other locales fall back to EN). Manual Win/Linux
 first-launch smoke test is the remaining step (no such host in the sandbox).
- **Owner:** team.
- **Links:** the 2026-06-23 ADR *Ship the TurboQuant `llamacpp` provider on
 Windows + Linux …* (the manifest + clean-id foundation), the 2026-06-15 ADR
 *Stop "Find optimal backend" from silently degrading to CPU …* (the
 `IdealBackendResult` / `BACKEND_DETECTION_FAILED` contract this mirrors), the
 2026-06-09 ADR *Default the macOS local llama.cpp engine to `llamacpp-upstream`*
 (ATO-116, upstream-first default), files:
 [`extensions/llamacpp-extension/src/index.ts`](extensions/llamacpp-extension/src/index.ts)
 (`detectIdealBackendType`, `recheckOptimalBackend`, `get_backend_category`,
 `TURBOQUANT_RECOMMENDATION_KEY`/`TURBOQUANT_PENDING_KEY`),
 [`web-app/src/hooks/useBackendUpdater.ts`](web-app/src/hooks/useBackendUpdater.ts)
 (`UseBackendUpdaterConfig`, provider-filtered events),
 [`web-app/src/routes/settings/providers/$providerName.tsx`](web-app/src/routes/settings/providers/$providerName.tsx)
 (button gate + `useMemo` config),
 [`web-app/src/containers/dialogs/TurboquantOptimalBackendDialog.tsx`](web-app/src/containers/dialogs/TurboquantOptimalBackendDialog.tsx),
 [`web-app/src/routes/__root.tsx`](web-app/src/routes/__root.tsx),
 [`web-app/src/utils/switchModel.ts`](web-app/src/utils/switchModel.ts)
 (`TURBOQUANT_OPTIMAL_PROMPT_EVENT`, `maybePromptTurboquantOptimal`),
 [`web-app/src/constants/localStorage.ts`](web-app/src/constants/localStorage.ts)
 (`turboquantOptimalPromptShown`),
 [`web-app/src/containers/DropdownModelProvider.tsx`](web-app/src/containers/DropdownModelProvider.tsx)
 (empty-state fallback),
 [`src-tauri/plugins/tauri-plugin-llamacpp/src/backend.rs`](src-tauri/plugins/tauri-plugin-llamacpp/src/backend.rs)
 (`min_cuda13_driver`),
 [`web-app/src/locales/en/settings.json`](web-app/src/locales/en/settings.json) +
 [`web-app/src/locales/ru/settings.json`](web-app/src/locales/ru/settings.json)
 (`turboquantOptimalPrompt`).

### 2026-06-23 — Ship the TurboQuant `llamacpp` provider on Windows + Linux as a second provider (side-by-side with `llamacpp-upstream`), resolving the backend index from a static `atomic-chat-conf` turboquant manifest (per-backend tag) and downloading GPU variants at runtime from the `AtomicBot-ai/atomic-llama-cpp-turboquant` releases CDN
- **Context:** Our `atomic-llama-cpp-turboquant` fork now publishes
 Windows (`cpu` / `vulkan` / `cuda-12.4` / `cuda-13.3`) and Linux
 (`vulkan`, with built-in CPU fallback via `GGML_BACKEND_DL`) builds, on top
 of the existing macOS `arm64` build. Until now the turboquant `llamacpp`
 provider (`@janhq/llamacpp-extension` + `tauri-plugin-llamacpp`) was
 **macOS-only**: the 2026-05-22 ADR *Windows ships only `llamacpp-upstream`*
 and the 2026-05-28 ADR *Linux ships only `llamacpp-upstream`* excluded it
 from the Windows/Linux installer bundles (`package.json ::
 build:extensions:{win32,linux}` carried `--exclude
 @janhq/llamacpp-extension`), gated the whole flow behind `IS_MAC` in the
 extension, and `fetchRemoteBackends` early-`return []`'d off macOS. Two facts
 about the turboquant release stream forced the index-resolution shape:
 (1) **the releases are scattered — each variant is its OWN GitHub release
 with its OWN tag** (all on the same SHA, e.g. `d86eb0b`: tags
 `turboquant-windows-x64-cpu-d86eb0b`, `turboquant-windows-x64-cuda-12.4-…`,
 `turboquant-linux-x64-vulkan-…`, …), so a `/releases/latest` lookup is
 useless and a `/releases` list scan would hammer the rate-limited
 `api.github.com` (the exact problem the 2026-06-17 ATO-199 ADR solved for
 upstream); and (2) the Windows CUDA zips **already bundle**
 `cudart64`/`cublas64`/`cublasLt64` DLLs, so the janhq-style separate-cudart
 download is unnecessary.
- **Decision (per the user-chosen options — `side_by_side` provider,
 `download_variants` runtime delivery, `clean` release-aligned id scheme):**
 1. **Clean backend-ID scheme** (directly mirrors the release asset names):
 `windows-x64-cpu`, `windows-x64-cuda-12.4`, `windows-x64-cuda-13.3`,
 `windows-x64-vulkan`, `linux-x64-vulkan`, `macos-arm64`. Asset =
 `llama-turboquant-<id>.zip` (Windows) / `.tar.gz` (Linux/macOS); per-id
 tag prefix = `turboquant-<id>`.
 2. **Static turboquant manifest in `atomic-chat-conf`** (extends the
 2026-06-17 ATO-199 channel precedent). New `backends/turboquant-manifest.json`
 (`{ $schema, updated_at, commit, backends: [{ id, tag, asset }] }`, seeded
 from the `d86eb0b` set — 4 Windows ids + `linux-x64-vulkan`) +
 `backends/turboquant-schema.json` (Draft-07) + a `Validate turboquant
 manifest` ajv job and a node integrity check in
 [`.github/workflows/validate.yml`](https://github.com/AtomicBot-ai/atomic-chat-conf)
 (every `tag` starts `turboquant-<id>`, asset matches
 `llama-turboquant-<id>.(zip|tar.gz)`, ids unique). **The only structural
 difference from the upstream manifest** (single `tag_name` + `assets`) is
 that **each turboquant entry carries its own `tag`**, because the variants
 live in different releases. The archive *downloads* still come from the
 releases CDN (`github.com/.../releases/download`, not rate-limited).
 3. **Rust** ([`tauri-plugin-llamacpp/src/backend.rs`](src-tauri/plugins/tauri-plugin-llamacpp/src/backend.rs)):
 `determine_supported_backends` rewritten to the clean ids
 (windows/x86_64 → always `windows-x64-cpu` + conditionally
 `windows-x64-cuda-13.3` / `-cuda-12.4` / `-vulkan`; linux/x86_64 → always
 `linux-x64-vulkan`; macOS keeps `macos-arm64`);
 `get_backend_category` / `prioritize_backends` / `map_old_backend_to_new`
 (maps persisted legacy janhq ids onto the clean ids) /
 `is_cuda_installed` (cudart lives in the backend's own `build/bin`, no
 janhq migration path) updated; the `#[cfg(test)]` matrix asserts the new
 ids (33 backend tests green).
 4. **TS** ([`extensions/llamacpp-extension/src/backend.ts`](extensions/llamacpp-extension/src/backend.ts)):
 new `TURBOQUANT_BACKEND_MANIFEST_URL`
 (`raw.githubusercontent.com/AtomicBot-ai/atomic-chat-conf/main/backends/turboquant-manifest.json`);
 `fetchRemoteBackends` drops the `IS_MAC → []` early return, fetches the
 manifest (tauriFetch + `globalThis.fetch` fallback race, mirroring the
 upstream helper), keeps entries whose `id` is in the hardware-supported set,
 and emits `{ version: entry.tag, backend: entry.id }` (`[]` on any failure
 — preserves the offline-fallback contract); `getBackendDownloadUrl` builds
 `${BASE}/${tag}/llama-turboquant-${id}.${zip|tar.gz}`; the cudart companion
 logic (`getCudartDownloadUrl`/`CUDART_*`) is removed; `listSupportedBackends`
 now applies the hardware gate on Linux too.
 [`index.ts`](extensions/llamacpp-extension/src/index.ts): `IS_MAC` gates
 around `configureBackends`/`ensureBackendReady` removed, `ensureCudartReady`
 skipped for turboquant, bundled-fallback install wired for Win
 (`windows-x64-cpu`) / Linux (`linux-x64-vulkan`).
 5. **Build & bundling:** [`package.json`](package.json) un-excludes
 `@janhq/llamacpp-extension` on `build:extensions:{win32,linux}` (the
 turboquant `.tgz` now ships in `pre-install/`);
 `resources/llamacpp-backend/**/*` added to
 [`tauri.windows.conf.json`](src-tauri/tauri.windows.conf.json) +
 [`tauri.linux.conf.json`](src-tauri/tauri.linux.conf.json);
 [`Makefile`](Makefile) `download-llamacpp-backend` Windows/Linux branches
 now resolve `tag`+`asset` from the turboquant manifest
 (`curl … --retry 5 --retry-delay 3` + `jq`, or PowerShell
 `Invoke-RestMethod` in the new `download-llamacpp-backend-win-cpu` target)
 and pull the bundled offline fallback (`windows-x64-cpu` / `linux-x64-vulkan`)
 from the releases CDN into `resources/llamacpp-backend/build/bin`.
 6. **CI** ([`.github/workflows/release.yml`](.github/workflows/release.yml)):
 `build-windows` gains a manifest-driven `windows-x64-cpu` download step
 (inline bash + `jq` — not `make …-win-cpu`, whose PowerShell `$(...)` is
 mangled by make's `/usr/bin/sh`); `build-linux-x64` calls
 `make download-llamacpp-backend` for `linux-x64-vulkan`.
 7. **web-app** ([`web-app/src/lib/utils.ts`](web-app/src/lib/utils.ts)):
 `getProviderTitle('llamacpp')` now unconditionally returns `'Atomic
 Llama.cpp Turboquant'` (the `IS_WINDOWS/IS_LINUX → 'Llama.cpp'` vestige is
 gone). `LOCAL_LLAMACPP_PROVIDER` stays `'llamacpp-upstream'` (default
 unchanged); `getModelToStart` order already lists turboquant second.
- **Consequences:** Windows and Linux now show **two** llama.cpp providers —
 the default `llamacpp-upstream` plus the secondary "Atomic Llama.cpp
 Turboquant" — exactly like macOS. Turboquant GPU variants download at
 runtime from the releases CDN (CUDA zips carry their own cudart); the
 bundled `windows-x64-cpu` / `linux-x64-vulkan` build is the always-available
 offline fallback. Both providers share the GGUF tree
 (`MODELS_PROVIDER_ROOT='llamacpp'`); backend binaries and settings stay
 isolated per provider. Updating turboquant to a new commit = edit one
 manifest file in `atomic-chat-conf` (no app release, no `api.github.com`).
 **This supersedes the Windows-only / Linux-only `llamacpp-upstream`
 clauses of the 2026-05-22 and 2026-05-28 ADRs** (upstream remains the
 *default* provider on both, but turboquant is no longer excluded) and
 **extends the manifest-channel precedent of the 2026-06-17 ATO-199 ADR**
 (per-backend `tag` instead of a single `tag_name`). **Deliberately NOT
 done (out of scope):** no CUDA-on-Linux turboquant (the fork publishes
 none — Linux Vulkan serves both CPU and GPU); no change to the
 `:1337/v1` proxy contract (it already routes the turboquant + upstream +
 MLX pools); no cron auto-generator for the manifest (hand-maintained,
 same as the upstream ADR); no legacy `jan*` renames. macOS is unchanged.
 **Verified:** `cargo test --lib backend` 33/33 green in
 `tauri-plugin-llamacpp`; `turboquant-manifest.json` valid against
 `turboquant-schema.json` (`ajv --strict=false`) and the node integrity
 check passes (5 backends, tags/assets well-formed, ids unique); the
 `llamacpp-extension` rolldown build is clean (the authoritative compile);
 web-app `tsc -b` + `eslint src/lib/utils.ts` clean; `make -n
 download-llamacpp-backend` parses on both the Windows (PowerShell) and
 Linux (bash+jq) branches. The extension `vitest` run hits a pre-existing
 `ERR_REQUIRE_ESM` env issue (vitest/vite version mismatch in the hoisted
 root `node_modules`) unrelated to this change.
- **Owner:** team.
- **Links:** the 2026-06-17 ADR *Resolve the `llamacpp-upstream` backend
 index from a static `atomic-chat-conf` manifest …* (ATO-199, the
 manifest-channel precedent), the 2026-05-22 ADR *Windows ships only
 `llamacpp-upstream`*, the 2026-05-28 ADR *Linux ships only
 `llamacpp-upstream`*, the 2026-05-19 ADRs *Use
 `AtomicBot-ai/atomic-llama-cpp-turboquant` as the LLM backend* and *Ship
 upstream `ggml-org/llama.cpp` as a second macOS provider*, §4.2 *LLM
 backend*,
 [AtomicBot-ai/atomic-llama-cpp-turboquant releases](https://github.com/AtomicBot-ai/atomic-llama-cpp-turboquant/releases),
 files:
 [`src-tauri/plugins/tauri-plugin-llamacpp/src/backend.rs`](src-tauri/plugins/tauri-plugin-llamacpp/src/backend.rs),
 [`extensions/llamacpp-extension/src/backend.ts`](extensions/llamacpp-extension/src/backend.ts),
 [`extensions/llamacpp-extension/src/index.ts`](extensions/llamacpp-extension/src/index.ts),
 [`package.json`](package.json),
 [`src-tauri/tauri.windows.conf.json`](src-tauri/tauri.windows.conf.json),
 [`src-tauri/tauri.linux.conf.json`](src-tauri/tauri.linux.conf.json),
 [`Makefile`](Makefile),
 [`.github/workflows/release.yml`](.github/workflows/release.yml),
 [`web-app/src/lib/utils.ts`](web-app/src/lib/utils.ts), and
 `atomic-chat-conf` `backends/turboquant-manifest.json` +
 `backends/turboquant-schema.json` + `.github/workflows/validate.yml`.

### 2026-06-17 — Resolve the `llamacpp-upstream` backend *index* from a static `atomic-chat-conf` manifest (raw.githubusercontent.com) instead of the rate-limited `api.github.com` (ATO-199)
- **Context:** `fetchRemoteBackends()` in
 [`extensions/llamacpp-upstream-extension/src/backend.ts`](extensions/llamacpp-upstream-extension/src/backend.ts)
 hit `https://api.github.com/repos/ggml-org/llama.cpp/releases/latest`
 **unauthenticated** to learn which backend builds exist. GitHub's
 unauthenticated REST limit is 60 req/hr **per IP**, which is shared/NAT/VPN
 networks exhaust quickly → `403` → the function returns `[]` → a *fresh*
 install dead-ends with no GPU backend resolvable and no locally-installed
 fallback yet ([ATO-199](https://linear.app/atomicchat/issue/ATO-199)). The
 archive *downloads* themselves go through the ggml-org CDN
 (`github.com/.../releases/download`, `LLAMACPP_DOWNLOAD_BASE`) which is **not**
 rate-limited — only the *index lookup* was the choke point.
- **Decision (hotfix; Windows + Linux x64 only — macOS is bundle-only and early
 `return []`s in `fetchRemoteBackends`, never touching the index):** Move the
 index lookup off `api.github.com` onto a **static manifest** committed to our
 existing config repo `AtomicBot-ai/atomic-chat-conf`, served via
 `raw.githubusercontent.com` (no per-IP rate limit — same channel the
 model/provider/recommended registries already use). The manifest
 **mirrors the GitHub release shape** (`{ tag_name, assets: [{ name }] }`) so
 the client's per-OS asset-name regex + Windows/Linux whitelist parser is
 reused **verbatim** — the only change is the source URL.
 1. **atomic-chat-conf:** new `backends/manifest.json` seeded with the newest
 *complete* ggml-org release (`b9691`, 8 Windows/Linux assets: cpu /
 cuda-12.4 / cuda-13.3 / vulkan win + ubuntu cpu/vulkan + 2 cudart
 companions). New `backends/schema.json` (Draft-07, mirrors the
 `models/`/`providers/` schema style incl. `format: date-time`), a
 `Validate backends manifest` + integrity-check pair in
 [`.github/workflows/validate.yml`](https://github.com/AtomicBot-ai/atomic-chat-conf)
 (ajv `--strict=false` + a node check: tag shape `^b\d+$`, unique
 non-empty asset names, and every `llama-*` asset carries the declared tag
 so the client regex matches), and a `README.md` `backends/` section.
 2. **Extension:** `LLAMACPP_RELEASES_API` → `LLAMACPP_BACKEND_MANIFEST_URL`
 (`raw.githubusercontent.com/AtomicBot-ai/atomic-chat-conf/main/backends/manifest.json`);
 `fetchRemoteBackends` swaps only the request URL (transport `tauriFetch`,
 `User-Agent`, `buildHttpProxyOptions()`, timeouts, and all downstream
 parsing unchanged); the dead macOS-branch `void LLAMACPP_RELEASES_API` is
 removed. `getBackendDownloadUrl` / `getCudartDownloadUrl` (CDN) untouched.
- **Consequences:** Fresh installs on shared/NAT/VPN networks resolve the
 backend catalog without burning the GitHub anon quota; the `[]`-on-failure
 contract is preserved, so the existing offline floors
 (`newestInstalledOfFamily`, `resolveBackendFallback`, bundled `win-cpu-x64`)
 and `detection-failed` UX still apply when raw is unreachable.
 **Deliberately NOT done (next phase):** the manifest is **static and
 hand-edited** — it can lag new ggml-org releases until a cron auto-generator
 (de-pinning CUDA minors) is added; a last-good disk-cache of the manifest
 (PR #84 part 4) and differentiated error classification
 (`rate_limited`/`timeout`/`offline`) + `backend_resolve_failed` telemetry
 (PR #81/#84) are out of this slice. Chosen over PR #84's approach (host the
 manifest as a release-asset in the *main* repo + cron) because reusing the
 already-working `atomic-chat-conf` raw channel needs no new release-asset or
 CI to ship the hotfix. **Verified:** rolldown `build` clean
 (`dist/index.js` 227 kB, exit 0 — authoritative compile); 5 new
 `backend.test.ts` cases pass (URL = raw not `api.github.com`; Windows
 catalog cpu/cuda-12.4/cuda-13.3/vulkan, cudart not surfaced; Linux
 cpu+vulkan; macOS `[]` with **no** network call; `[]` on fetch failure) —
 the 4 other failures in that suite (`getBackendDir`/`isBackendInstalled`
 `llamacpp` vs `llamacpp-upstream` path) are **pre-existing** (confirmed by a
 stash baseline); `eslint` clean on both edited files; conf `manifest.json` +
 `schema.json` valid (ajv `--strict=false`, matching CI) and the integrity
 check passes (tag `b9691`, 8 assets). Standalone `tsc --noEmit` on the
 extension shows only the documented pre-existing module-resolution / base-class
 noise (no new errors from the URL swap).
- **Amendment (same day) — extend the manifest source to the *build-time*
 `Makefile` download (Windows + Linux), so a Windows/Linux rebuild also stops
 hitting `api.github.com`.** The runtime fix above only covered the in-app
 `fetchRemoteBackends` index lookup; the build-side
 `download-llamacpp-upstream-backend` target (and the PowerShell
 `download-llamacpp-upstream-backend-win-cpu` target) in
 [`Makefile`](Makefile) still resolved the tag/asset by querying
 `api.github.com/repos/ggml-org/llama.cpp/releases` — the same rate-limited
 choke point, just at build time — so a fresh `make`/`yarn download:bin` on a
 shared/NAT/VPN host (or in CI without `GH_TOKEN`) could still 403. Both the
 **Windows** (`ifeq ($(OS),Windows_NT)`) and **Linux**
 (`ifeq ($(shell uname -s),Linux)`) branches of
 `download-llamacpp-upstream-backend` now `curl … --retry 5 --retry-delay 3`
 the **same static manifest**
 (`raw.githubusercontent.com/AtomicBot-ai/atomic-chat-conf/main/backends/manifest.json`)
 into a `mktemp` temp file and resolve `tag_name` + the per-platform asset with
 `jq` against the single manifest object (Windows keeps the family→highest-minor
 CUDA resolution, e.g. `win-cuda-13-x64` → `b9691 win-cuda-13.3-x64`, from the
 2026-06-16 ADR; Linux matches `llama-<tag>-bin-<infix>.tar.gz`). The
 `download-llamacpp-upstream-backend-win-cpu` PowerShell target swaps its
 `Invoke-RestMethod` from the releases API to the manifest and finds the
 `win-cpu-x64` asset in the single object. The `GH_TOKEN`/`_gh_fetch`/`_tag_ok`
 GitHub-list machinery is dropped from these branches (raw needs no auth); the
 archive *downloads* still come from the ggml-org CDN. **The macOS branch is
 deliberately left on `api.github.com`** — macOS is bundle-only, its assets
 (`macos-arm64`/`macos-x64`) are **not** in the manifest, and it re-codesigns
 the upstream tarball per the 2026-05-19 ADR; pinning it to the
 Windows/Linux-scoped manifest would break the macOS build. **Verified:**
 `make -n download-llamacpp-upstream-backend` parses clean on the macOS host
 (Darwin branch expands as before); the exact Windows/Linux `jq` resolvers were
 run against the live manifest fixture → `win-cuda-13-x64`→`b9691 win-cuda-13.3-x64`,
 `win-cuda-12-x64`→`b9691 win-cuda-12.4-x64`, `win-cpu-x64`/`win-vulkan-x64`/
 `ubuntu-x64`/`ubuntu-vulkan-x64`→`b9691`, and a non-existent `win-cuda-11-x64`
 family → empty (correctly aborts the build). A live Windows/Linux build was
 **not** executed (no such host in the sandbox).
- **Owner:** team.
- **Links:** [ATO-199](https://linear.app/atomicchat/issue/ATO-199),
 [PR #84](https://github.com/AtomicBot-ai/Atomic-Chat/pull/84) (alternative,
 superseded by this approach), the 2026-05-27 ADR *Replace `janhq/model-catalog`
 … with curated `atomic-chat-model-catalog`* (raw-channel precedent), the
 2026-06-16 ADR *Tiered graceful backend fallback …* (offline floors this
 relies on), §4.2 *LLM backend*, files:
 [`extensions/llamacpp-upstream-extension/src/backend.ts`](extensions/llamacpp-upstream-extension/src/backend.ts)
 (`LLAMACPP_BACKEND_MANIFEST_URL`, `fetchRemoteBackends`),
 [`extensions/llamacpp-upstream-extension/src/test/backend.test.ts`](extensions/llamacpp-upstream-extension/src/test/backend.test.ts),
 [`Makefile`](Makefile) (`download-llamacpp-upstream-backend`
 Windows/Linux branches + `download-llamacpp-upstream-backend-win-cpu`),
 `atomic-chat-conf` `backends/manifest.json` + `backends/schema.json` +
 `.github/workflows/validate.yml` + `README.md`.

### 2026-06-17 — Recover the poisoned Metal backend + surface a clear OOM message after a GPU compute error, instead of retrying 3× into a dead backend (ATO-197)
- **Context:** On macOS, a llama.cpp Metal GPU out-of-memory during prompt
 processing (e.g. `janhq/Jan-v2-VL-high-Q4_K_M` + an image, ~4865-token prompt)
 returns HTTP `500 {"error":{"message":"Compute error"}}` and leaves the ggml
 Metal backend in a permanent error state ("backend is in error state from a
 previous command buffer failure - recreate the backend to recover"). HTTP 500
 is retryable, so the AI SDK retried the identical request 3× into the
 still-poisoned backend → all failed identically, surfacing only
 *"Failed after 3 attempts. Last error: Compute error."* The OOM detail
 (`kIOGPUCommandBufferCallbackErrorOutOfMemory` / `Insufficient Memory`) appears
 only in `llama-server` **stderr**, never the HTTP body, so neither the proxy
 nor the UI could classify it as OOM ([ATO-197](https://linear.app/atomicchat/issue/ATO-197)).
- **Decision (minimal, reuses existing machinery; scoped to the reported
 `llamacpp-upstream` backend):**
 1. **Proxy** ([`proxy.rs`](src-tauri/src/core/server/proxy.rs)): new
 `is_compute_backend_error()` detects a fatal local-backend compute/decode
 failure from the body (`"compute error"` / `"failed to decode"` /
 `"failed to compute graph"` / `"backend is in error state"` /
 `"ggml_backend_sched_graph_compute"`, status 500 only), checked **after** the
 existing context-overflow retry path so ctx errors keep their flow. On match
 (`can_retry_local`) it **recreates the backend** for `llamacpp-upstream` by
 reusing `maybe_auto_increase_and_retry` with a new `compute_error_recovery`
 trigger (reload **same-ctx**, not a ctx grow — growing ctx would worsen an
 OOM), then returns a **non-retryable HTTP 400** structured
 `insufficient_memory` envelope (`compute_error_envelope`) with actionable
 guidance. The same request is **not** auto-retried (a deterministic prefill
 OOM would just re-poison the fresh backend); the recreate leaves the backend
 healthy for the *next* request.
 2. **Extension** ([`llamacpp-upstream-extension/src/index.ts`](extensions/llamacpp-upstream-extension/src/index.ts)):
 `handleAutoIncreaseCtx` handles the `compute_error_recovery` trigger by
 unload + reload with existing settings (recreate the dead backend), skipping
 the ctx-grow / `AUTO_INCREASE_CTX_NOTIFY` path.
 3. **web-app** ([`error.ts`](web-app/src/utils/error.ts),
 [`$threadId.tsx`](web-app/src/routes/threads/$threadId.tsx)): new
 `isOutOfMemoryError()` + `OUT_OF_MEMORY_TITLE`/`MESSAGE`; the thread error
 panel shows clear OOM guidance instead of the raw "Compute error".
- **Consequences:** The 3× retry-into-dead-backend loop is gone (non-retryable
 400), the poisoned backend self-heals on the failing request so the next
 message works, and the user gets an actionable OOM message. **Deliberately NOT
 done (follow-ups):** recovery is gated to `llamacpp-upstream` — the turboquant
 `llamacpp` extension gets the clearer 400 message but no auto-recreate (mlx is
 unaffected; different phrasing); reading the `llama-server` stderr tail in the
 proxy for exact OOM-vs-other-compute discrimination was avoided (needs
 per-session stderr-capture plumbing in both plugins), so the message hedges
 when the body itself doesn't pin OOM. **Verified:** `cargo check -p
 Atomic-Chat` clean; `cargo test --lib core::server::` 71 passed incl. 3 new
 (`detects_metal_compute_error_body`, `ignores_non_compute_errors`,
 `compute_error_envelope_is_structured_oom`); web-app `vitest` `error.test.ts`
 28/28, `eslint` 0 errors, `tsc -b` clean; upstream extension rolldown build
 clean. The end-to-end reload round-trip (proxy → extension → done event) was
 **not** integration-tested (no Metal hardware / live `llama-server` in the
 sandbox) — PR opened as `[needs-review]`.
- **Owner:** team.
- **Links:** [ATO-197](https://linear.app/atomicchat/issue/ATO-197),
 [PR #80](https://github.com/AtomicBot-ai/Atomic-Chat/pull/80), the 2026-06-16
 ADR *Tiered graceful backend fallback …* + the auto-increase-ctx reload
 machinery, §4.2 *LLM backend*, files:
 [`src-tauri/src/core/server/proxy.rs`](src-tauri/src/core/server/proxy.rs)
 (`is_compute_backend_error`, `compute_error_envelope`, the `is_error`
 recovery block),
 [`extensions/llamacpp-upstream-extension/src/index.ts`](extensions/llamacpp-upstream-extension/src/index.ts)
 (`COMPUTE_ERROR_RECOVERY_TRIGGER`, `handleAutoIncreaseCtx`),
 [`web-app/src/utils/error.ts`](web-app/src/utils/error.ts)
 (`isOutOfMemoryError`),
 [`web-app/src/routes/threads/$threadId.tsx`](web-app/src/routes/threads/$threadId.tsx).

### 2026-06-16 — Port the runtime CUDA-family resolution into the Windows build scripts so `make dev-windows` / `download:bin` stop 404ing on a hardcoded `win-cuda-13.1` minor (ATO-174, build side)
- **Context:** `yarn download:bin` → `make dev-windows` →
 `download-llamacpp-upstream-backend` (Windows GPU-detection branch) failed on a
 user's CUDA-capable host with `[FATAL] No recent release carries asset
 llama-<tag>-bin-win-cuda-13.1-x64.zip`. Root cause is the **build-side twin** of
 [ATO-174](https://linear.app/atomicchat/issue/ATO-174): the same-day 2026-06-15
 ADR *Stop "Find optimal backend" from silently degrading to CPU … de-hardcode
 the Windows CUDA minor to a family id* fixed the **runtime** (TS
 [`backend.ts`](extensions/llamacpp-upstream-extension/src/backend.ts) +
 Rust [`backend.rs`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/backend.rs)
 resolve `win-cuda-13-x64` → highest published minor), but the **build scripts**
 still hardcoded the concrete `win-cuda-13.1-x64` / `win-cuda-12.4-x64` asset
 names. ggml-org moved its published Windows CUDA-13 asset from `13.1` → `13.3`,
 so the exact-name lookup in the build scripts matched nothing and aborted. CI
 was **never** affected — the Windows release job bundles a hardcoded
 `BACKEND="win-cpu-x64"` (CPU-only offline fallback; GPU CUDA is resolved at
 runtime in-app), and the macOS/Linux `make download-llamacpp-upstream-backend`
 steps take their own non-CUDA branches — so this was purely a local
 dev/`download:bin` failure.
- **Decision (per the user's "fix it for users *and* CI" ask; build-scripts-only,
 no app/runtime/Rust change — runtime was already fixed):** Mirror the runtime's
 family-resolution into every build-side Windows backend selector. The selector
 now emits a **minor-less family id** (`win-cuda-13-x64` / `win-cuda-12-x64`) and
 a resolver turns it into the **highest concrete minor actually published** in
 the newest release that carries it.
 1. **[`Makefile`](Makefile)** (`download-llamacpp-upstream-backend`, Windows
 branch): driver gate raised `58100` → `58115` (matches the Rust
 `min_cuda13_driver = 581.15`; CUDA-12 stays `55161`), backend set to
 `win-cuda-13-x64` / `win-cuda-12-x64`. A new `jq` branch (gated on
 `^win-cuda-[0-9]+-x64$`) extracts the major, scans the `?per_page=20` release
 list, and for the newest release carrying any `…-bin-win-cuda-<major>.<minor>-x64.zip`
 picks `(minor | max)` → concrete `TAG` + `BACKEND`; non-family ids keep the
 existing exact-name `_resolve_tag`. The resolved concrete `BACKEND`/`TAG` flow
 into the download URL, `backend.txt`/`version.txt`, and the
 `download-llamacpp-cudart-windows.ps1` cudart merge.
 2. **[`scripts/dev-windows.ps1`](scripts/dev-windows.ps1)**: driver gate
 `581` → `581.15`, `$cudaTier` values `131`/`124` → `13`/`12`, backend →
 `win-cuda-{13,12}-x64`. New `Resolve-BackendFromReleases` (family → highest
 published minor, else exact match) and `Test-BackendSatisfiedBy` (does an
 already-installed `win-cuda-13.3-x64` satisfy the selected `win-cuda-13-x64`
 family → skip re-download). The resolved concrete id is what's written to
 `backend.txt` and passed to the cudart merge.
 3. **[`scripts/download-llamacpp-cudart-windows.ps1`](scripts/download-llamacpp-cudart-windows.ps1)**:
 dropped the static `cuda-12.4`/`cuda-13.1` → cudart-archive map. The regex now
 accepts any `^win-cuda-(\d+)\.\d+-x64$`; the cudart archive name is derived as
 `cudart-llama-bin-<backend>.zip` and the marker DLL as `cudart64_<major>.dll`
 — so any future minor works with no edit.
- **Consequences:** Local `make dev-windows` / `yarn download:bin` on a
 CUDA host now resolve to whatever CUDA-13/12 minor ggml-org currently ships
 (verified `13.3` on the live release set) instead of dead-ending on the stale
 `13.1`, and survive future minor bumps. **CI is unchanged** (it already bundled
 `win-cpu-x64`; the GPU path is runtime-resolved in-app), so the
 `release.yml` / `build-windows-release.ps1` files were reviewed and left
 untouched. macOS/Linux build branches untouched. **Verified:** the `jq`
 family-resolution program tested against a fixture (newest release with `13.3` +
 an older `13.1` + cpu/vulkan/12.4 noise) → `b9670 win-cuda-13.3-x64` for major
 13, `…12.4…` for major 12, empty for major 99; the PowerShell
 `Resolve-BackendFromReleases` / `Test-BackendSatisfiedBy` truth table passes
 (family→highest-minor, exact cpu match, null on no-match, `13.3` satisfies
 `13-family` but `12.4`/`vulkan` don't); both `.ps1` files pass the PowerShell
 AST parser; `make -n download-llamacpp-upstream-backend` parses clean. No
 lingering hardcoded CUDA minor remains in any build script (only illustrative
 `13.3` comments).
- **Amendment (same day) — make `dev-windows.ps1`'s release fetch survive GitHub
 rate-limits / outages (degrade, don't abort `make dev`).** After the family fix,
 a user hit `Invoke-RestMethod : API rate limit exceeded` — the **bare,
 un-retried** `Invoke-RestMethod` in `dev-windows.ps1`'s download path (the
 script `make dev-windows` actually runs; the hardened Makefile `_gh_fetch`
 branch is a *different* target) hit GitHub's 60-req/hr unauthenticated limit and
 hard-failed the whole dev run. Added `Invoke-GitHubReleases` (retry/backoff on
 403/429/5xx, mirroring the Makefile `_gh_fetch`; honors `GH_TOKEN`; returns
 `$null` instead of throwing so the caller can degrade) and **reordered the
 download block** so the destructive `Remove-Item` of a differing existing
 backend now happens **only after** a replacement is resolved — a
 rate-limited/failed fetch no longer destroys a working backend. On total fetch
 failure the script degrades to an **already-installed** backend (reuse, warn)
 and only hard-fails when nothing usable is on disk, with an **actionable**
 message pointing at `GH_TOKEN` (raises the limit to 5000 req/hr). Driver-gate
 note: a host on driver `581.08` correctly selects `win-cuda-12-x64` (below the
 NVIDIA-documented `581.15` floor for CUDA 13.1, matching the in-app runtime
 gate) — not a regression. **Verified:** `dev-windows.ps1` passes the PowerShell
 AST parser; `Invoke-GitHubReleases` returns the array on success and `$null`
 (no throw) on failure.
- **Owner:** team.
- **Links:** [ATO-174](https://linear.app/atomicchat/issue/ATO-174), the
 2026-06-15 ADR *Stop "Find optimal backend" from silently degrading to CPU … de-hardcode
 the Windows CUDA minor to a family id (ATO-174)* (runtime side), the
 2026-06-08 ADR *Windows: fix clean-install config persistence (ATO-107),
 de-hardcode the CUDA-13 minor (ATO-105) …*, the 2026-05-22 ADR *Windows ships
 only `llamacpp-upstream`*, the 2026-05-22 ADR *Ship cudart DLLs with every
 Windows CUDA backend*, the 2026-06-05 ADR *Make the Windows release backend
 download asset-aware … (ATO-95, CI)*, files:
 [`Makefile`](Makefile) (`download-llamacpp-upstream-backend` Windows branch),
 [`scripts/dev-windows.ps1`](scripts/dev-windows.ps1)
 (`Resolve-BackendFromReleases`, `Test-BackendSatisfiedBy`),
 [`scripts/download-llamacpp-cudart-windows.ps1`](scripts/download-llamacpp-cudart-windows.ps1),
 runtime counterparts
 [`extensions/llamacpp-upstream-extension/src/backend.ts`](extensions/llamacpp-upstream-extension/src/backend.ts)
 / [`src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/backend.rs`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/backend.rs).

### 2026-06-16 — Validate the model/mmproj GGUF (presence + size) before load so a missing/partial download fails fast with an actionable, classified error (ATO-187)
- **Context:** `model_load.error_code = 'MODEL_FILE_NOT_FOUND'` = 230 events / 18
  users over 30d (mostly Windows), with stderr `Invalid or inaccessible model
  path: \\?\C:\Users\...\model.ggu…` — Bug #3 of epic
  [ATO-181](https://linear.app/atomicchat/issue/ATO-181). Root cause is a
  desync between "model is in `model.yml`" and "the GGUF is actually a complete
  file on disk": an interrupted/partial download that never produced the final
  GGUF, a file removed outside the app, or (historically) a stale backend path.
  The Rust loader (`tauri-plugin-llamacpp{,-upstream}/src/path.rs ::
  validate_model_path`) only checks `.exists()` and **only after** the backend
  binary is spun up — so a genuinely missing file produces an opaque
  truncated-path crash, and a **partially-downloaded file that exists** slips
  past `.exists()` and fails deep inside the loader as an unclassified
  `LLAMA_CPP_PROCESS_ERROR`. The UI infra to handle this already existed
  end-to-end (`MODEL_FILE_NOT_FOUND` → "re-download" toast; `MODEL_FILE_CORRUPT`
  → "delete & re-download" toast in `switchModel.ts`, with EN/RU locale keys),
  but nothing classified the *partial-download* case, and classification of the
  missing-file case happened late.
- **Decision (per the issue's fix direction #1 — "validate presence + size
  before load"; the auto re-download (#1b) and stale-path rewrite (#2) were
  deliberately deferred as larger/riskier — auto re-download needs a source URL
  that `model.yml` does not store, a schema change out of this slice):** add a
  pre-load `validateModelArtifacts()` to `performLoad` in **both** llama.cpp
  extensions (`llamacpp-upstream-extension` — the Windows/Linux/macOS-default
  provider — and the macOS turboquant `llamacpp-extension`, for parity, mirroring
  the existing dual-provider text-only-fallback pattern). Right after the
  model/mmproj paths are resolved and **before** the backend `loadLlamaModel`
  call/try-block, it stats each file: a missing/inaccessible file throws a coded
  `MODEL_FILE_NOT_FOUND` Error (skipping the wasted process spawn and opaque
  stderr); a file smaller than the expected size recorded at import
  (`model_size_bytes` / `mmproj_size_bytes`, absent for local-file imports → size
  check skipped, no false positives) throws `MODEL_FILE_CORRUPT`. A small
  `codedLoadError(code, message)` helper attaches the `code` own-property so the
  web-app's `reportModelLoadError` (`toErrorObject` → `err.code`) maps it to the
  existing actionable toast. Consistency follow-ups: `MODEL_FILE_CORRUPT` added
  to `RECOVERABLE_MODEL_LOAD_CODES`
  ([`telemetry.ts`](web-app/src/lib/telemetry.ts), so a re-downloadable partial
  file is not sent to Sentry as a crash) and to `TERMINAL_LOAD_CODES`
  ([`switchModel.ts`](web-app/src/utils/switchModel.ts), so the auto-start gate
  doesn't loop on a corrupt file that only a manual re-download fixes).
- **Consequences:** Missing/partial model files now fail fast with the actionable
  "re-download"/"delete & re-download" guidance instead of an opaque crash, and
  the backend process is no longer spawned for a model known to be unusable. The
  partial-download case is newly classified as `MODEL_FILE_CORRUPT` (previously
  an unclassified process error). **Deliberately NOT done:** auto re-download on
  missing file (needs a source-URL schema change + download plumbing — larger,
  deferred) and the ATO-116-linked stale-path rewrite (both providers now share
  the `llamacpp/models` tree so the relative `model_path` resolves regardless of
  backend, making it a non-issue in practice). Scope: 2 extension TS files + 2
  web-app files; no Rust, IPC, on-disk layout, or settings-schema change.
  **Verified:** rolldown build clean on both extensions (`dist/index.js`
  221.60 kB upstream / 187.95 kB turboquant, exit 0 — the authoritative compile);
  web-app `tsc -b` clean; `eslint` clean on `switchModel.ts` + `telemetry.ts`.
  Upstream extension vitest: the 4 `backend.test.ts` failures + the
  `index.test.ts`/`autoIncreaseCtx.test.ts` file-level errors are **pre-existing**
  (confirmed by a worktree baseline on parent `6dc54bd39` — identical failing
  files, none touch the new `validateModelArtifacts`/`assertCompleteGguf`); the
  new code path is not covered by the isolated suites (`performLoad` is not
  directly unit-tested, consistent with prior ADRs).
- **Owner:** team.
- **Links:** [ATO-187](https://linear.app/atomicchat/issue/ATO-187),
  [ATO-181](https://linear.app/atomicchat/issue/ATO-181),
  [ATO-116](https://linear.app/atomicchat/issue/ATO-116), the 2026-06-11 ADR
  *Quiet the top-10 Sentry desktop anomalies …* (`MODEL_FILE_CORRUPT` classifier,
  `RECOVERABLE_MODEL_LOAD_CODES`, `TERMINAL_LOAD_CODES`), the 2026-06-11 ADR
  *ATO-135 (web-app slice) …* (`MODEL_FILE_NOT_FOUND` → `modelFileMissing*` toast),
  files:
  [`extensions/llamacpp-upstream-extension/src/index.ts`](extensions/llamacpp-upstream-extension/src/index.ts)
  (`validateModelArtifacts`, `assertCompleteGguf`, `codedLoadError`,
  `ERR_MODEL_FILE_NOT_FOUND`/`ERR_MODEL_FILE_CORRUPT`),
  [`extensions/llamacpp-extension/src/index.ts`](extensions/llamacpp-extension/src/index.ts)
  (mirrored),
  [`web-app/src/lib/telemetry.ts`](web-app/src/lib/telemetry.ts)
  (`RECOVERABLE_MODEL_LOAD_CODES`),
  [`web-app/src/utils/switchModel.ts`](web-app/src/utils/switchModel.ts)
  (`TERMINAL_LOAD_CODES`), Rust classifier
  [`tauri-plugin-llamacpp-upstream/src/error.rs`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/error.rs)
  / [`path.rs`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/path.rs).

### 2026-06-16 — Raise the model-load readiness timeout to a 30-min floor so large/cold-storage loads aren't cut off at 600s (ATO-188, MODEL_LOAD_TIMED_OUT)
- **Context:** Bug #7 of epic [ATO-181](https://linear.app/atomicchat/issue/ATO-181)
  ([ATO-188](https://linear.app/atomicchat/issue/ATO-188)) bundles four small
  but deterministic download/load error buckets (PostHog 30d): `IO_ERROR`
  (34/11u — `Bad CPU type in executable`, wrong-arch binary), `BINARY_NOT_FOUND`
  (13/12u — backend binary missing / not shipped), `MODEL_LOAD_TIMED_OUT`
  (11/7u — `Timeout: 600s`), `MODEL_FILE_CORRUPT` (2/1u). The
  `MODEL_LOAD_TIMED_OUT` bucket is the one with a clean, code-side, verifiable
  root cause: the model-load **readiness** wait in both llama.cpp extensions
  passed `Number(this.timeout)` (the user-facing "connection and load timeout",
  default **600s**) to `loadLlamaModel(...)`. Large models on slow / cold (first
  read, network) storage legitimately need >10 min to mmap + warm up and report
  ready, so `llama-server` was killed at 600s with a raw `MODEL_LOAD_TIMED_OUT`
  ([`commands.rs`](src-tauri/plugins/tauri-plugin-llamacpp/src/commands.rs)
  emits the `Timeout: {}s` message). The issue's own fix direction is "raise the
  timeout".
- **Decision (scope = MODEL_LOAD_TIMED_OUT only; the other three buckets are
  build/release-pipeline-coupled and not fixable/verifiable from the app
  codebase here):** Add a module-level helper `modelLoadReadyTimeoutSecs()` +
  constant `MODEL_LOAD_READY_TIMEOUT_FLOOR_SECS = 1800` (30 min) to **both**
  [`extensions/llamacpp-extension/src/index.ts`](extensions/llamacpp-extension/src/index.ts)
  and
  [`extensions/llamacpp-upstream-extension/src/index.ts`](extensions/llamacpp-upstream-extension/src/index.ts),
  and use it at every `loadLlamaModel(...)` **readiness** call site (turboquant:
  2 — initial + text-only mmproj retry; upstream: 3 — + the MTP-disable retry).
  The effective load-ready timeout is `max(configured, 1800)`, so it honors a
  *larger* user-configured value and floors everyone (incl. existing users
  stuck at the persisted 600) to 30 min. **The streaming / connection timeout is
  unchanged** — the two `stream_local_http` sites still use
  `Number(this.timeout) || 600`, and `settings.json` / the class default are
  untouched (most surgical: only the "wait for server ready" window grows).
- **Consequences:** Large-model first loads on slow disks no longer hard-fail at
  600s. **Trade-off (accepted):** a user who *lowered* the timeout for fast-fail
  loses that on the load-ready path (streaming still respects their value) — a
  rare case, and load-readiness fast-fail is rarely desirable. **Deliberately
  NOT done (out of scope, separate causes):** `IO_ERROR` "Bad CPU type"
  (wrong-arch bundled/downloaded binary — a build/release-pipeline issue),
  `BINARY_NOT_FOUND` (backend not shipped / not downloaded — partly addressed by
  the 2026-06-15 ATO-153 bundled-backend recovery), and `MODEL_FILE_CORRUPT`
  (post-download checksum + retry — a download-verification feature, gated by the
  `skipVerification`-default path). No progress-bar UI for slow loads (a larger
  UX change). Scope: 2 extension TS files; no Rust, IPC, settings-schema, or
  on-disk-layout change. **Verified:** rolldown build clean on both extensions
  (`dist/index.js` 186.14 kB turboquant / 219.81 kB upstream, exit 0 — the
  authoritative compile per prior ADRs); the two streaming-timeout sites
  confirmed unchanged. Extensions have no eslint config (no `lint` script),
  consistent with prior ADRs.
- **Owner:** team.
- **Links:** [ATO-188](https://linear.app/atomicchat/issue/ATO-188),
  [ATO-181](https://linear.app/atomicchat/issue/ATO-181),
  [ATO-116](https://linear.app/atomicchat/issue/ATO-116),
  [ATO-135](https://linear.app/atomicchat/issue/ATO-135), the 2026-06-15 ADR
  *Stop the `llamacpp-upstream` auto-upgrade from wiping turboquant backends …
  (ATO-153)*, files:
  [`extensions/llamacpp-extension/src/index.ts`](extensions/llamacpp-extension/src/index.ts)
  (`MODEL_LOAD_READY_TIMEOUT_FLOOR_SECS`, `modelLoadReadyTimeoutSecs`),
  [`extensions/llamacpp-upstream-extension/src/index.ts`](extensions/llamacpp-upstream-extension/src/index.ts),
  [`src-tauri/plugins/tauri-plugin-llamacpp/src/commands.rs`](src-tauri/plugins/tauri-plugin-llamacpp/src/commands.rs)
  (`ModelLoadTimedOut` emission).

### 2026-06-16 — Tiered graceful backend fallback when a pinned `llamacpp-upstream` tag 404s / the ggml-org release stream is unreachable (ATO-178; extends ATO-179)
- **Context:** Failure mode 2 of [ATO-176](https://linear.app/atomicchat/issue/ATO-176).
  A model is pinned to a concrete ggml-org tag whose per-platform asset **404s**
  (`Failed to download backend b9616/ubuntu-vulkan-x64: HTTP status 404` — 263
  events; `b9637/ubuntu-vulkan-x64: 404` — 44) or the **release stream is
  unreachable** (`Could not resolve a release for 'win-cuda-13.3-x64' /
  'win-cuda-12.4-x64' / 'win-vulkan-x64' / 'linux-vulkan-x64' … unreachable and
  no version of this backend is installed locally.` — 149/97/70/63). The
  same-day ATO-179 fix already added a **single-tier** load-path fallback
  (`findCompatibleInstalledBackend` → newest installed of the same type) into
  [`ensureBackendReady`](extensions/llamacpp-upstream-extension/src/index.ts),
  which covers the "pinned tag empty but a sibling is installed" case — but it
  does **not** cover ATO-178's core asks: (a) **404 on the pinned tag → fetch
  the nearest available (newer published) tag** of the same family, and (b) a
  last-resort degrade + an actionable error. The automated-triage PR #67 had
  implemented exactly (a)+(b) but on the *pre-ATO-179* signature, so it
  conflicted with `main` and was closed in favour of this extend-on-top-of-179
  change.
- **Decision (per chosen option "extend on main"; extension-only, no Rust/IPC/
  schema change):** Replace the single-tier AC2 block in `ensureBackendReady`
  (load path, `allowFallback=true`) with a new tiered resolver
  `resolveBackendFallback(backend, failedVersion)` returning
  `{ version, backend, persist } | null`, resolving most-preferred first:
  1. **Same-type installed** (`findCompatibleInstalledBackend`, the ATO-179
     mechanism) — instant, offline-safe, preserves the variant. `persist:true`.
  2. **Newest published tag of the same family on ggml-org**
     (`resolveLatestBackendString` → `downloadAndInstallBackend`) — the genuine
     "404 on this tag → pull the nearest available tag" path; adopted only if it
     actually installs. `persist:true` (same variant, newer tag).
  3. **Newest installed backend of any family** (`getLocalInstalledBackends`,
     sorted by build number) — last-resort safety net so the app stays usable
     (e.g. degrade a GPU variant to the bundled CPU build; installed backends
     are host-compatible by construction). **`persist:false`** — a temporary
     degrade must not permanently downgrade a GPU user to CPU, so it is applied
     **in-memory only** (`this.config.version_backend`), letting a later "Find
     optimal backend" / manual pick re-target the right tier once the stream
     recovers. The terminal throw is now **actionable** ("…release stream may be
     unreachable or that release has no build for your platform … Check your
     internet connection (Settings → Proxy) and try again later.") instead of
     the generic "reinstall the app".
- **Consequences:** A 404/unreachable on a pinned tag no longer hard-fails when
  any compatible backend is on disk **or** when a newer same-family release
  ships the asset; only a same-variant tier persists, the CPU degrade stays
  ephemeral. The strict no-fallback path is preserved for explicit
  install/update flows (`updateBackend`, `onSettingUpdate`, `getDevices` still
  pass `allowFallback=false`). Scope: one extension TS file (the AC2 block +
  new `resolveBackendFallback`); ATO-179's AC1 (clear stale dir) / AC3 (startup
  sweep) / `getDevices` fallback / `persistVersionBackend` are untouched. macOS
  turboquant `llamacpp` and MLX unaffected. **Verified:** rolldown build clean
  (`dist/index.js` 220.78 kB, exit 0 — the authoritative compile); vitest 88
  passed / 14 failed — the 14 failures are **pre-existing** (env/network
  `__TAURI_INTERNALS__` in the sandbox, identical to the ATO-179 baseline),
  unchanged by this diff. PR #67 closed as superseded.
- **Owner:** team.
- **Links:** [ATO-178](https://linear.app/atomicchat/issue/ATO-178),
  [ATO-176](https://linear.app/atomicchat/issue/ATO-176),
  [ATO-177](https://linear.app/atomicchat/issue/ATO-177),
  [PR #67](https://github.com/AtomicBot-ai/Atomic-Chat/pull/67) (closed,
  superseded), the same-day ADR *Treat empty/incomplete `llamacpp-upstream`
  backend folders as not-installed … (ATO-179)*, the 2026-06-10 ADR *Fix the two
  real model-load bugs … resolve the `latest/<backend>` sentinel before load
  (ATO-124)*, files:
  [`extensions/llamacpp-upstream-extension/src/index.ts`](extensions/llamacpp-upstream-extension/src/index.ts)
  (`ensureBackendReady` AC2 block, `resolveBackendFallback`).

### 2026-06-16 — Treat empty/incomplete `llamacpp-upstream` backend folders as not-installed, fall back to a compatible installed backend on load, and sweep orphan folders at startup (ATO-179)
- **Context:** A user hit `BINARY_NOT_FOUND` on model load: the model's pinned
  `version_backend` pointed at a backend whose on-disk folder
  (`llamacpp-upstream/backends/<tag>/<type>/`) was an **empty stub** (no
  `llama-server` exe — left by a failed/interrupted download or a pruned
  upstream tag), even though a **working compatible** backend of the same type
  (different tag, e.g. `b9652/macos-arm64` vs the pinned `b9642/macos-arm64`)
  was already installed. The load dead-ended instead of self-healing. Root
  cause is not the install check itself —
  [`isBackendInstalled`](extensions/llamacpp-upstream-extension/src/backend.ts)
  and the Rust `get_local_installed_backends` already gate on exe presence — but
  three missing recoveries: (1) a stale incomplete dir for the exact pinned pair
  wasn't cleared before re-download, (2) when the pinned backend couldn't be
  obtained at all there was no fallback to a working sibling, only a throw, and
  (3) nothing ever swept the orphan stub folders.
- **Decision (the issue's 3 acceptance criteria; extension-only, no Rust/IPC/
  schema change):**
  1. **AC1 — clear stale stub before re-download.** In
     [`ensureBackendReady`](extensions/llamacpp-upstream-extension/src/index.ts),
     when the requested pair isn't installed (exe missing), `fs.rm` its dir (if
     present) before attempting the download so decompress writes into a clean
     dir and the model is never stuck on an empty stub.
  2. **AC2 — fall back to a compatible installed backend.** `ensureBackendReady`
     now returns the **effective** `{ version, backend }` and takes an
     `allowFallback` flag (true only from the load paths `performLoad` /
     `getDevices`; explicit user-driven backend switches keep strict
     throw-on-failure). When the pinned backend can't be obtained, new
     `findCompatibleInstalledBackend(type)`
     ([`backend.ts`](extensions/llamacpp-upstream-extension/src/backend.ts))
     returns the newest installed backend of the **same type** (any tag), the
     corrected `version_backend` is persisted via new `persistVersionBackend`
     (settings + in-memory config + `settingsChanged` emit), and the load runs
     on it instead of failing. **Compatibility is deliberately same-type-only**
     (every tag of a type targets the same platform/GPU variant and is
     interchangeable); cross-type fallback (e.g. cuda→cpu) is intentionally NOT
     automatic — it's a feature/perf trade-off that must stay a user choice.
  3. **AC3 — sweep orphans at startup.** New `cleanupIncompleteBackends()`
     ([`backend.ts`](extensions/llamacpp-upstream-extension/src/backend.ts))
     scans `llamacpp-upstream/backends/`, `fs.rm`s any `<tag>/<type>` dir with no
     exe and any now-empty `<tag>` dir, and returns the removed ids. Called from
     `onLoad` right **after** `activatePendingBackend` (a completed pending
     backend has a valid exe → never removed) and before `configureBackends`.
     Scoped strictly to the upstream backends tree — the shared GGUF model tree
     and the turboquant `llamacpp` backends are never touched.
- **Consequences:** A model pinned to a missing/incomplete backend now
  re-downloads cleanly, and if that fails but a compatible build is on disk it
  loads on the sibling (with the pin corrected) instead of `BINARY_NOT_FOUND`;
  empty stub folders self-clean at startup. Same-type-only fallback exactly
  covers the reported case (`b9642`→`b9652`, both `macos-arm64`). macOS
  turboquant `llamacpp` and MLX are untouched (this is the upstream provider).
  **Verified:** rolldown build clean (`dist/index.js` 217.54 kB, exit 0 — the
  authoritative compile); vitest suite 88 passed / 14 failed — the 14 failures
  are **pre-existing** (stash-baseline on HEAD: identical 14 failed / 88 passed,
  env/network `__TAURI_INTERNALS__` in the sandbox), unchanged by this diff.
- **Owner:** team.
- **Links:** [ATO-179](https://linear.app/atomicchat/issue/ATO-179),
  [ATO-176](https://linear.app/atomicchat/issue/ATO-176), the 2026-06-15 ADR
  *Stop the `llamacpp-upstream` auto-upgrade from wiping turboquant backends …
  (ATO-153)*, files:
  [`extensions/llamacpp-upstream-extension/src/backend.ts`](extensions/llamacpp-upstream-extension/src/backend.ts)
  (`findCompatibleInstalledBackend`, `cleanupIncompleteBackends`),
  [`extensions/llamacpp-upstream-extension/src/index.ts`](extensions/llamacpp-upstream-extension/src/index.ts)
  (`ensureBackendReady`, `persistVersionBackend`, `performLoad`, `getDevices`,
  `onLoad`).

### 2026-06-16 — Switch macOS autostart from `LaunchAgent` to `AppleScript` (real Login Item) + one-time choice-preserving migration for existing users
- **Context:** User report — the "Launch at startup" toggle exists (ATO-96 +
 the 2026-06-10 default-ON seed), but on macOS the app does **not** start on
 reboot and does not appear in `System Settings → General → Login Items →
 "Open at Login"`. Root cause: the autostart plugin was registered with
 `MacosLauncher::LaunchAgent`
 ([`src-tauri/src/lib.rs`](src-tauri/src/lib.rs)). Confirmed against the crate
 sources: `tauri-plugin-autostart` 2.5.1 → `auto-launch` 0.5.0
 (`src/macos.rs`) — LaunchAgent mode writes
 `~/Library/LaunchAgents/{app_name}.plist` (`{app_name}` =
 `app.package_info().name`, here `"Atomic Chat"`; `RunAtLoad=true`) instead of
 registering a Login Item. So (a) it never shows under "Open at Login" (it can
 only appear under "Allow in the Background"), and (b) if autostart was ever
 enabled from a **dev** build, the plist's `ProgramArguments` points at the
 `target/debug` binary, which doesn't exist after a normal reboot → launchd
 can't launch it. The earlier ADR (ATO-96) chose LaunchAgent deliberately to
 avoid the Apple Events prompt.
- **Decision (per the user's chosen option — AppleScript Login Item, with a
 migration that preserves prior on/off choice):**
 1. **Launcher switch.** `MacosLauncher::LaunchAgent` →
 `MacosLauncher::AppleScript` in [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs).
 AppleScript mode registers a real Login Item via `osascript`
 (`make login item …`), visible in System Settings and started by
 `loginwindow` on reboot. Trade-off (accepted): a one-time
 automation-permission prompt on first enable.
 2. **Choice-preserving migration (macOS only, one-shot).** New Rust command
 `migrate_macos_autostart_launchagent`
 ([`src-tauri/src/core/system/commands.rs`](src-tauri/src/core/system/commands.rs),
 registered in both `generate_handler!` lists in
 [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs)): resolves the **exact** legacy
 plist path from `app.package_info().name` (the same value the plugin used, so
 the filename matches by construction), and if `~/Library/LaunchAgents/{app_name}.plist`
 exists — i.e. the user had launch-at-startup **ON** under the old launcher —
 best-effort `launchctl unload`s it, removes it (so it can't double-launch or
 point at a stale binary), and returns `true`; otherwise returns `false`
 (and `false` on non-macOS). Frontend
 ([`web-app/src/providers/DataProvider.tsx`](web-app/src/providers/DataProvider.tsx)):
 a new `IS_MACOS`-gated effect, guarded by a one-shot localStorage flag
 `autostart-applescript-migrated`
 ([`web-app/src/constants/localStorage.ts`](web-app/src/constants/localStorage.ts)),
 calls the command; when it reports a prior ON, re-registers the Login Item via
 `enableAutostart()` (guarded by `!isAutostartEnabled()`), so the user **keeps**
 autostart — now as a Login Item. A user who had it **off** has no legacy plist
 → no-op → choice preserved. New users are covered by the existing default-ON
 seed (which now creates an AppleScript Login Item); the migration is a no-op
 for them.
- **Consequences:** Existing macOS users who had autostart enabled keep it (now
 a reboot-reliable Login Item visible in System Settings); those who disabled it
 stay disabled; new users get the Login Item by default. The stale LaunchAgent
 plist is cleaned up so it can't double-launch alongside the Login Item. Scope:
 1 Rust command + the launcher line + 1 web-app effect + 1 localStorage key; no
 IPC shape change beyond the additive command, no on-disk layout or settings
 schema change. Windows/Linux unaffected (the command returns `false` off
 macOS; their autostart paths are unchanged). **Verified:**
 `cargo check -p Atomic-Chat` 0 errors (pre-existing `dead_code` warnings only);
 `eslint` clean on the two touched web-app files; `tsc -b` shows only the
 pre-existing, unrelated `jsonrepair` missing-module error (dependency declared
 in `package.json` but not installed in the sandbox), nothing from the edited
 files. **Caveat:** first enable triggers the macOS automation-permission
 prompt; the migration is keyed on localStorage, so a cleared localStorage /
 factory reset re-runs it once (harmless — it re-detects the real plist state).
- **Owner:** team.
- **Links:** [ATO-96](https://linear.app/atomicchat/issue/ATO-96), the 2026-06-09
 ADR *Add a cross-platform "Launch at startup" toggle …* and the 2026-06-10 ADR
 *Default "Launch at startup" to ON for all users …*,
 [`tauri-plugin-autostart` 2.5.1](https://crates.io/crates/tauri-plugin-autostart) /
 `auto-launch` 0.5.0 (`src/macos.rs`), files:
 [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs)
 (`MacosLauncher::AppleScript`, command registration),
 [`src-tauri/src/core/system/commands.rs`](src-tauri/src/core/system/commands.rs)
 (`migrate_macos_autostart_launchagent`),
 [`web-app/src/providers/DataProvider.tsx`](web-app/src/providers/DataProvider.tsx)
 (migration effect),
 [`web-app/src/constants/localStorage.ts`](web-app/src/constants/localStorage.ts)
 (`autostartAppleScriptMigrated`).

### 2026-06-15 — Add Cline CLI as a one-click Launch-page coding agent (configure by running `cline auth`, not writing a file)
- **Context:** The Launch page one-click installs + configures external coding
  agents against the local OpenAI-compatible server. Cline CLI was requested
  (`kind: "coding"`), but unlike the other agents it has **no** clean
  user-facing config file and **no** base-URL env var; its on-disk state
  (`~/.cline/globalState.json`) is a brittle legacy format that must not be
  hand-written. Cline ships an official non-interactive setup command — the same
  one `ollama launch cline` invokes under the hood.
- **Decision:** Mirror the existing integration pattern, but configure by
  **running the `cline` binary** instead of writing a file. Added a `cline`
  entry to `INTEGRATION_AGENTS` (after `opencode`)
  ([`web-app/src/constants/integrations.ts`](web-app/src/constants/integrations.ts)),
  an `AgentIcon` case (`IconBox` bg `#2b303b` + `cline.png` with `object-cover`)
  and a `configureAgent` case
  ([`web-app/src/routes/launch/index.tsx`](web-app/src/routes/launch/index.tsx)).
  Backend ([`src-tauri/src/core/system/commands.rs`](src-tauri/src/core/system/commands.rs)):
  install spec in `agent_install_spec` (global npm `cline`, prereq `npm`) and a
  new `configure_cline` command that spawns
  `cline auth --provider openai-compatible --apikey <key> --modelid <model> --baseurl <api_url>`
  via `std::process::Command` (mirroring `install_agent`: `apply_login_path` so
  the GUI build finds the npm-installed `cline`, `CREATE_NO_WINDOW` on Windows,
  trimmed stderr on non-zero exit). `<key>` falls back to the placeholder
  `"local"` when no API key is set (Cline rejects an empty apikey, and an empty
  modelid — model is always present because `requiresModel` is true).
  `endpointWithPrefix` true (base URL carries `/v1`). Registered in both
  `generate_handler!` lists ([`src-tauri/src/lib.rs`](src-tauri/src/lib.rs)).
  No special `handleRun` terminal command — Cline launches its TUI with the bare
  `cline` binary (the default `agent.detectBin` path).
- **Consequences:** One more agent installable + configurable in one click. The
  configure step shells out to the vendor's supported `cline auth` path (no
  fragile file surgery on `globalState.json`), so it stays correct across
  Cline's on-disk format changes. `cline` is guaranteed installed before
  configure runs (handleRun installs first). Watch: the upstream `cline` package
  name or the `cline auth` flag surface may drift.
- **Owner:** team.
- **Links:** branch `feat/launch-cline-cli`; https://docs.cline.bot/cline-cli/getting-started.

### 2026-06-15 — Add MiMo Code (Xiaomi) as a one-click Launch-page coding agent
- **Context:** MiMo Code (Xiaomi, `XiaomiMiMo/MiMo-Code`) was requested as another
  one-click Launch-page coding agent against the local OpenAI-compatible server
  (port 1337). MiMo Code is a **fork of OpenCode**: its config system is
  OpenCode's field-for-field, just at different paths.
- **Decision:** Mirror the existing integration pattern exactly. Added a `mimo`
  entry to `INTEGRATION_AGENTS`
  ([`web-app/src/constants/integrations.ts`](web-app/src/constants/integrations.ts))
  immediately after `opencode` (`kind: "coding"`, install global npm
  `@mimo-ai/cli`, `detectBin: "mimo"`, `endpointWithPrefix` true). Because MiMo
  ships only a wide wordmark (no usable square logo), the `AgentIcon` case is an
  initial-letter tile on a branded `#ff6700` background — no image file is
  referenced. Added a `configureAgent` case (`configure_mimo`); no special
  `handleRun` command (like OpenCode it launches its TUI from the bare
  `detectBin`)
  ([`web-app/src/routes/launch/index.tsx`](web-app/src/routes/launch/index.tsx)).
  Backend ([`src-tauri/src/core/system/commands.rs`](src-tauri/src/core/system/commands.rs)):
  install spec in `agent_install_spec` (global npm) and `configure_mimo`
  registered in both `generate_handler!` lists
  ([`src-tauri/src/lib.rs`](src-tauri/src/lib.rs)). `configure_mimo` is a
  near-copy of `configure_opencode` — it upserts `provider.atomic`
  (`@ai-sdk/openai-compatible`, `baseURL` `/v1`) and sets `model` to
  `atomic/<model>` in `~/.config/mimocode/mimocode.json`; only the config path
  and `$schema` (`https://mimo.xiaomi.com/config.json`) differ from OpenCode.
- **Consequences:** One more agent installable + configurable in one click.
  `configure_mimo` preserves unrelated user content and returns an actionable
  parse error (never clobber) on a malformed existing file. No new analytics
  (the generic `agent_run` capture keys on id). No new image asset (initial-tile
  icon). Watch: upstream package name `@mimo-ai/cli` / config path may drift,
  and since MiMo tracks OpenCode, keep `configure_mimo` in sync with
  `configure_opencode` if the OpenCode config schema changes.
- **Owner:** team.
- **Links:** branch `feat/launch-mimo-code`; `XiaomiMiMo/MiMo-Code`.

### 2026-06-16 — Fail fast with a clear "CPU not supported" message when loading a CPU backend on an x86 CPU without AVX (ATO-185)
- **Context:** `LLAMA_CPP_PROCESS_ERROR` over-indexes ×9.5 on CPUs reporting
  `cpu_avx='none'` — measured rate 31.6% (700/2 216) vs avx 0.39%, avx2 1.95%,
  avx512 2.55% (PostHog 30d, [ATO-185](https://linear.app/atomicchat/issue/ATO-185),
  Bug #8 of [ATO-181](https://linear.app/atomicchat/issue/ATO-181)). Root cause:
  the shipped ggml-org CPU build executes AVX instructions unconditionally, so on
  an x86 host with **no AVX at all** `llama-server` dies with SIGILL (Unix signal
  4) / `STATUS_ILLEGAL_INSTRUCTION` (Windows) the instant it starts. The crash
  leaves empty stderr, and `is_crash_exit`
  ([`error.rs`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/error.rs))
  only recognises access-violation / segfault / abort codes (not SIGILL /
  illegal-instruction), so `from_exit_status` fell through to the opaque generic
  `LLAMA_CPP_PROCESS_ERROR` "unexpected error". The crashing population is the
  Windows/Linux upstream CPU build (macOS is excluded — Apple Silicon has no AVX
  concept and Intel Macs all ship AVX). Crucially the measured floor is **AVX,
  not AVX2**: AVX-only machines fail at just 0.39%, so only `cpu_avx='none'` is
  unsupported.
- **Decision (per the issue's accepted "clearly report incompatibility instead
  of a silent crash" option):** Detect the incompatibility up front in the
  `llamacpp-upstream` extension's `performLoad`, before spawning `llama-server`,
  and throw a structured, actionable error instead of letting the process
  SIGILL. New pure, unit-tested helpers in
  [`util.ts`](extensions/llamacpp-upstream-extension/src/util.ts):
  `isCpuBackend` (matches `*-cpu-*` ids, never the macOS `macos-*` ids),
  `cpuHasAvx` (mirrors the web-app `cpuAvxLevel`: avx / avx2 / avx512* ⇒ true),
  `isUnsupportedNoAvxCpu` (blocks **only** on a positive no-AVX signal — x86
  arch + CPU backend + a **non-empty** extension list lacking AVX — so an empty
  list from a non-x86 host or a hardware-probe failure never false-blocks), and
  the `CPU_NO_AVX_ERROR_CODE` constant. `performLoad`
  ([`index.ts`](extensions/llamacpp-upstream-extension/src/index.ts)) probes
  `getSystemInfo()` (gated to CPU backends so GPU loads don't pay for it; a probe
  failure is logged and the load proceeds) and throws an `Error` carrying
  `code = 'CPU_NO_AVX'`. The web-app surfaces it via a new branch in
  `reportModelLoadError`
  ([`switchModel.ts`](web-app/src/utils/switchModel.ts)) with new
  `cpuNoAvx*` keys in
  [`en/model-errors.json`](web-app/src/locales/en/model-errors.json) +
  [`ru/model-errors.json`](web-app/src/locales/ru/model-errors.json) (other
  locales fall back to EN), and `CPU_NO_AVX` is added to
  `RECOVERABLE_MODEL_LOAD_CODES`
  ([`telemetry.ts`](web-app/src/lib/telemetry.ts)) so this expected
  hardware-incompatibility condition is not reported to Sentry as a crash.
- **Consequences:** No-AVX x86 users now see a plain "Your CPU is not supported"
  message instead of a silent crash + opaque error, and the distinct
  `CPU_NO_AVX` code de-noises the `LLAMA_CPP_PROCESS_ERROR` bucket in telemetry.
  **Deliberately NOT done (out of this slice):** shipping a separate no-AVX
  fallback `llama-server` binary — ggml-org publishes no such asset and adding
  one means changes to the CI release pipeline, Makefile download targets, the
  backend matrix, and signing; it's a larger, riskier effort tracked separately.
  The gate requires **AVX** (the build's real floor per the data), not AVX2, so
  AVX-only machines (which work fine) are never blocked. Scope: 1 extension TS
  module + the extension entry + 1 test file; web-app = 1 util + 1 util branch +
  2 locale files; no Rust, IPC, on-disk layout, or settings-schema change. The
  turboquant macOS `llamacpp` provider is untouched (macOS unaffected).
  **Verified:** extension rolldown build clean (`dist/index.js` 221.06 kB, exit
  0 — the authoritative compile); new `util.test.ts` cases pass (57/57, +26 for
  `isCpuBackend` / `cpuHasAvx` / `isUnsupportedNoAvxCpu`); web-app `tsc -b` clean;
  `eslint` clean on `switchModel.ts` + `telemetry.ts`; both locale JSONs parse.
- **Owner:** team.
- **Links:** [ATO-185](https://linear.app/atomicchat/issue/ATO-185),
  [ATO-181](https://linear.app/atomicchat/issue/ATO-181),
  [ATO-116](https://linear.app/atomicchat/issue/ATO-116), the 2026-06-11 ADR
  *Quiet the top-10 Sentry desktop anomalies …* (native-crash classification),
  §4.2 *LLM backend*, files:
  [`extensions/llamacpp-upstream-extension/src/util.ts`](extensions/llamacpp-upstream-extension/src/util.ts)
  (`isCpuBackend`, `cpuHasAvx`, `isUnsupportedNoAvxCpu`, `CPU_NO_AVX_ERROR_CODE`),
  [`extensions/llamacpp-upstream-extension/src/index.ts`](extensions/llamacpp-upstream-extension/src/index.ts)
  (`performLoad` AVX preflight),
  [`extensions/llamacpp-upstream-extension/src/util.test.ts`](extensions/llamacpp-upstream-extension/src/util.test.ts),
  [`web-app/src/utils/switchModel.ts`](web-app/src/utils/switchModel.ts)
  (`reportModelLoadError`),
  [`web-app/src/lib/telemetry.ts`](web-app/src/lib/telemetry.ts)
  (`RECOVERABLE_MODEL_LOAD_CODES`),
  [`web-app/src/locales/en/model-errors.json`](web-app/src/locales/en/model-errors.json),
  [`web-app/src/locales/ru/model-errors.json`](web-app/src/locales/ru/model-errors.json).

### 2026-06-15 — Stop the `llamacpp-upstream` auto-upgrade from wiping turboquant backends (point cleanup at the provider's own tree) + recover the bundled macOS turboquant backend if missing (ATO-153)
- **Context:** On macOS both llama.cpp providers ship side-by-side and **share
  the on-disk GGUF tree** (`MODELS_PROVIDER_ROOT='llamacpp'`), but their
  **backend binaries are isolated** —
  `<jan>/llamacpp/backends/` (turboquant, bundled-in-resources, *not* in any
  release stream) vs `<jan>/llamacpp-upstream/backends/` (downloaded from
  ggml-org). When the upstream provider auto-upgraded its backend, the cleanup
  step in
  [`updateBackend`](extensions/llamacpp-upstream-extension/src/index.ts)
  built the "remove old versions" path from a **hardcoded `'llamacpp'`**
  segment instead of the provider id, so
  [`removeOldBackendVersions`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/backend.rs)
  ran against the **turboquant** `llamacpp/backends` dir and deleted every
  version that didn't equal the upstream `latest_version` — i.e. **all**
  turboquant backends (none match an upstream tag). Turboquant-bound models
  then failed to load with the generic "not installed" error, even though the
  turboquant binary ships in app resources ([ATO-153](https://linear.app/atomicchat/issue/ATO-153)).
- **Decision (per chosen scope — Fix #1 primary + Fix #3 recovery; Fix #2
  deferred):**
  1. **#1 Primary fix.** In `updateBackend` the cleanup `backendsDir` is now
     built from `this.providerId` (= `llamacpp-upstream`), never the literal
     `'llamacpp'`, so the upstream auto-upgrade only ever prunes its **own**
     backends tree. This matches `getBackendDir`
     ([`backend.ts`](extensions/llamacpp-upstream-extension/src/backend.ts)),
     which already correctly uses the `llamacpp-upstream` segment — the
     hardcoded literal in the cleanup path was the lone inconsistency.
  2. **#3 Recovery (defense-in-depth).** In
     [`ensureBackendReady`](extensions/llamacpp-extension/src/index.ts) (the
     turboquant provider), before throwing the terminal "not installed" error
     on macOS, attempt `tryInstallBundledBackend()` and re-check
     `isBackendInstalled`; if the bundled SHA matches the model's pinned
     `version_backend` this fully restores a backend wrongly deleted by a
     *pre-fix* upstream upgrade (otherwise it's a harmless no-op and we fall
     through to the unchanged error). This rescues users already bricked by the
     #1 bug without a reinstall.
- **Consequences:** Upstream backend upgrades no longer touch the turboquant
  tree; already-affected macOS users self-heal on next turboquant start.
  **Deliberately NOT done:** Fix #2 (a Rust-side guard in
  `remove_old_backend_versions` to refuse a `backends_dir` outside the calling
  provider) — the TS fix removes the only caller that passed the wrong dir, and
  the Rust guard is a larger cross-plugin change deferred as belt-and-suspenders.
  Windows/Linux ship only `llamacpp-upstream` (no turboquant tree to wipe), so
  this is a macOS-only impact; the recovery is macOS-gated. Scope: 2 extension
  TS files + 1 test; no Rust, IPC, on-disk layout, or settings-schema change.
  **Verified:** rolldown build clean on both extensions (`dist/index.js`
  213.54 kB upstream / 181.56 kB turboquant, exit 0 — the authoritative compile;
  standalone `tsc --noEmit` module-resolution noise is pre-existing per prior
  ADRs); new vitest case *cleanup target directory (ATO-153)* passes (asserts
  the cleanup `joinPath` resolves the `llamacpp-upstream` tree, never
  `llamacpp`) — suite 36 passed / 9 failed, the 9 failures confirmed
  pre-existing by a stash-baseline on HEAD (35 passed / 9 failed). Extensions
  have no eslint config (no `lint` script), consistent with prior ADRs.
- **Owner:** team.
- **Links:** [ATO-153](https://linear.app/atomicchat/issue/ATO-153), the
  2026-05-19 ADR *Ship upstream `ggml-org/llama.cpp` as a second macOS
  provider* (shared-GGUF / isolated-backends model), the 2026-05-22 ADR
  *Windows ships only `llamacpp-upstream`*, files:
  [`extensions/llamacpp-upstream-extension/src/index.ts`](extensions/llamacpp-upstream-extension/src/index.ts)
  (`updateBackend` cleanup `backendsDir`),
  [`extensions/llamacpp-extension/src/index.ts`](extensions/llamacpp-extension/src/index.ts)
  (`ensureBackendReady` bundled-backend recovery),
  [`extensions/llamacpp-upstream-extension/src/test/index.test.ts`](extensions/llamacpp-upstream-extension/src/test/index.test.ts)
  (ATO-153 cleanup-path test),
  [`src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/backend.rs`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/backend.rs)
  (`remove_old_backend_versions`).

### 2026-06-15 — Detect Launch-page agents installed inside WSL + add a manual binary-path override (detection-only) (ATO-169)
- **Context:** Community request (Discord, m.iko). On Windows many CLI agents are
  installed inside **WSL** (they want a bash environment), not in native
  cmd/PowerShell. Detection
  ([`detect_agent_installed`](src-tauri/src/core/system/commands.rs)) was a pure
  native-PATH lookup — `where` (Windows) / `which` (Unix) — with
  `apply_login_path` a no-op on Windows. So a WSL-installed tool was invisible
  (`where.exe` only sees the Win32 PATH) and showed as "Not installed" with no
  way for the user to correct it. There was also no manual path override for
  agents installed in any non-standard location. The frontend
  ([`launch/index.tsx`](web-app/src/routes/launch/index.tsx)) ran detection per
  catalog entry ([`integrations.ts`](web-app/src/constants/integrations.ts)).
- **Decision (per the chosen scope — *detection-only*):** Both new signals
  affect **only** the Installed/Not status; Enable/Run stays native and
  unchanged. A full end-to-end WSL path (configure into the WSL home + launch via
  `wsl.exe`) was **deliberately deferred** — a Windows process cannot exec the
  Linux ELF binary directly even given its `\\wsl$\…` path, so making Enable work
  through WSL is a large, separate cross-filesystem effort. Manual path is
  likewise scoped to detection (it mainly helps native installs in odd
  locations; it does not make WSL launch work).
  1. **Rust** ([`commands.rs`](src-tauri/src/core/system/commands.rs)):
     `detect_agent_installed` now takes `custom_path: Option<String>` and returns
     a struct `AgentDetection { installed, via_wsl }` (was `bool`). Resolution
     order: (1) `custom_path` is authoritative when non-empty — installed iff the
     file exists; (2) native PATH lookup (`detect_on_native_path`); (3) Windows
     only — `detect_via_wsl` runs `wsl.exe -e sh -lc 'command -v <bin>'` (login
     shell so the user's WSL `PATH` is in scope), setting `via_wsl = true`. Both
     spawned probes keep `CREATE_NO_WINDOW`. The agent names come from a fixed
     catalog, so the `sh -lc` interpolation has no injection surface. The
     internal `install_agent` prereq caller was updated to `…(prereq, None).await.installed`.
  2. **Frontend:** new persisted store
     [`launch-settings-store.ts`](web-app/src/stores/launch-settings-store.ts)
     (`customPaths`, key `launch-custom-paths` in
     [`localStorage.ts`](web-app/src/constants/localStorage.ts)) — survives
     reloads, unlike the intentionally-transient
     [`launch-store.ts`](web-app/src/stores/launch-store.ts) (which gained a
     transient `viaWsl` map). `detect` passes `customPath` and records
     `installed` + `viaWsl`; the mount effect re-detects when `customPaths`
     changes, so saving a path refreshes status automatically. UI: an
     "Installed (WSL)" badge variant, and a collapsible per-agent "Set binary
     path" editor (shared `Input` + Save, local draft state). New EN i18n keys in
     [`launch.json`](web-app/src/locales/en/launch.json) (only EN exists for this
     namespace; others fall back).
- **Consequences:** WSL-installed agents on Windows now show "Installed (WSL)"
  instead of "Not installed", and any agent can be force-marked installed via an
  explicit path — directly fixing the "can't even see it's installed / can't fix
  it" complaint. **Deliberately not done (deferred):** running configure/launch
  through WSL, and threading the custom path into `configure_*` / the launch
  terminal (so enabling a WSL-only agent still isn't wired end-to-end — the badge
  is informational). Scope: 1 Rust command (+2 helpers, 1 struct) and 4 web-app
  files; no IPC beyond the command's new param/return shape, no on-disk layout
  change. **Verified:** `cargo check -p Atomic-Chat` 0 errors (pre-existing
  dead_code warnings only; the `#[cfg(windows)]` WSL helper isn't compiled on the
  macOS dev host); `tsc -b` clean; `eslint` clean on all touched web-app files.
- **Owner:** team.
- **Links:** [ATO-169](https://linear.app/atomicchat/issue/ATO-169), the
  2026-06-04 ADR *Resolve the login-shell PATH for Launch-page agent detection*,
  the 2026-06-01 ADR *Add a "Launch" page …*, files:
  [`src-tauri/src/core/system/commands.rs`](src-tauri/src/core/system/commands.rs)
  (`detect_agent_installed`, `detect_on_native_path`, `detect_via_wsl`,
  `AgentDetection`),
  [`web-app/src/stores/launch-settings-store.ts`](web-app/src/stores/launch-settings-store.ts),
  [`web-app/src/stores/launch-store.ts`](web-app/src/stores/launch-store.ts),
  [`web-app/src/routes/launch/index.tsx`](web-app/src/routes/launch/index.tsx),
  [`web-app/src/constants/localStorage.ts`](web-app/src/constants/localStorage.ts),
  [`web-app/src/locales/en/launch.json`](web-app/src/locales/en/launch.json).

### 2026-06-15 — Raise the MLX default load context to `min(train-max, 16384)` + surface a clear context-overflow message instead of raw "Error generating response" (ATO-170)
- **Context:** With Exa (or any large tool-result) enabled, generation on MLX
  models failed with a raw "Error generating response". Root cause (proven in
  [ATO-170](https://linear.app/atomicchat/issue/ATO-170)) is **context
  overflow**, not a tool/serialization bug: the bundled mlx-vlm server
  preflights the budget (`validate_context_budget` → `PromptTooLongError`) and
  rejects an over-budget request with HTTP 400 `Request needs N context tokens
  (...), but MAX_KV_SIZE is M`. MLX models were loaded at a **hardcoded 4096**
  (`extensions/mlx-extension/src/index.ts` `ctx_size: Number(cfg.ctx_size ??
  4096)`); Exa returns full-text pages so 2-3 results blow past 4096. The
  extension already reads the model's training-max
  (`resolveModelMaxCtxTrain`, resolved into `modelMaxCtxTrain` early in
  `performLoad`) for the auto-increase ceiling but never used it at load time.
  MLX `model.yml` carries **no** `settings` block (`import` writes only
  `model_path`/`name`/`size_bytes`/caps), so `startModel` passes
  `settings=undefined` → `cfg.ctx_size` is genuinely unset on a normal start,
  which lets us distinguish "default" from a user-pinned value.
- **Decision (scope = #1 prevention + #2 graceful degradation; #3 KV-quant
  no-op deferred, needs reporter logs):**
  1. **#1 Prevention (the proven primary fix).** In `performLoad`, when
     `cfg.ctx_size` is not a valid positive number, default the load context to
     `min(trainMax, MLX_DEFAULT_CTX_CAP)` (`MLX_DEFAULT_CTX_CAP = 16384`),
     falling back to `MLX_DEFAULT_CTX_FALLBACK = 4096` only when the
     training-max couldn't be read from `config.json`. An explicit, valid
     `ctx_size` (user-pinned, or the auto-increase override `{ ctx_size: … }`)
     always wins. The cap (chosen over the issue's literal "full
     `max_position_embeddings`") avoids blindly allocating a huge KV cache —
     **OOM risk** on smaller Macs and on huge-context coder models (Qwen3-Coder
     train-ctx reaches 256K). The auto-increase ladder still has headroom
     (`computeNextCtxLen(16384) → 32768`, capped at train-max).
  2. **#2 Graceful degradation.** New `isContextLimitError(error)` +
     `CONTEXT_OVERFLOW_TITLE` / `CONTEXT_OVERFLOW_MESSAGE` in
     [`web-app/src/utils/error.ts`](web-app/src/utils/error.ts), mirroring the
     Rust `is_context_limit_error` matcher in
     [`proxy.rs`](src-tauri/src/core/server/proxy.rs) (matches `max_kv_size`,
     `kv cache` + exceed/overflow/too, and `context` + size/length/limit/…).
     [`$threadId.tsx`](web-app/src/routes/threads/$threadId.tsx) now uses the
     helper for **both** the client-side auto-increase trigger effect and the
     error-render block; when the failure is a context overflow it shows the
     clear title/message (and keeps the existing "Increase Context Size" button)
     instead of the generic "Error generating response" + raw engine 400 body.
- **Consequences:** The common Exa scenario no longer 400s on the first
  large turn (load floor is now up to 16K), and a genuine overflow (auto-increase
  exhausted / at train-max) renders an actionable message rather than opaque
  engine text. **Deliberately not done:** the issue's #3 — when KV-quant
  (TurboQuant) is on, the mlx-vlm server can't raise `MAX_KV_SIZE` on reload
  (`". uses QuantizedKVCache, can't set max KV size."`) so auto-increase
  silently no-ops; fixing that needs the reporter's `app.log` (to split case
  (a) retry-still-too-big vs (b) KV-quant block) and likely a Python-side
  change in the `mlx-vlm` fork + sidecar rebuild — out of this slice. **Scope:**
  one MLX extension TS file + two web-app files; no Rust, IPC, schema, or
  persistence change. **Verified:** `tsc -b` clean on web-app; eslint clean on
  the two web-app files (one pre-existing `exhaustive-deps` warning untouched,
  confirmed by stash-baseline). The 2 standalone `tsc --noEmit` errors in the
  MLX extension (`eagle3`/`DraftKind`) are **pre-existing** (confirmed by
  stash-baseline on HEAD) and unrelated; the extension ships via rolldown.
- **Owner:** team.
- **Links:** [ATO-170](https://linear.app/atomicchat/issue/ATO-170),
  [ATO-135](https://linear.app/atomicchat/issue/ATO-135) (TurboQuant epic; KV-quant
  no-op lives there), the 2026-06-02 ADR *Surface MLX KV-cache quantization …*,
  files:
  [`extensions/mlx-extension/src/index.ts`](extensions/mlx-extension/src/index.ts)
  (`MLX_DEFAULT_CTX_CAP`, `performLoad` ctx resolution),
  [`web-app/src/utils/error.ts`](web-app/src/utils/error.ts)
  (`isContextLimitError`, `CONTEXT_OVERFLOW_TITLE`/`_MESSAGE`),
  [`web-app/src/routes/threads/$threadId.tsx`](web-app/src/routes/threads/$threadId.tsx),
  [`src-tauri/src/core/server/proxy.rs`](src-tauri/src/core/server/proxy.rs)
  (`is_context_limit_error`).

---

### 2026-06-15 — Pin the filesystem MCP server version (cache-bust the stale `bun` copy) + add a `cwd` field for spawned stdio servers (ATO-164)
- **Context:** A Windows user set the filesystem MCP
  (`@modelcontextprotocol/server-filesystem`) with allowed dir
  `…\Documents\Atomic_chat`, but the model writing a **relative** path
  (`test_data/test.md`) failed with `Access denied - path outside allowed
  directories`, resolving against the **app** dir
  (`…\AppData\Local\Atomic Chat\…`) instead of the allowed dir; absolute paths
  worked ([ATO-164](https://linear.app/atomicchat/issue/ATO-164)). Root cause
  (code-reviewed): the user ran an **outdated** server. Old versions resolved
  relative paths against `process.cwd()` (upstream
  [servers#2526](https://github.com/modelcontextprotocol/servers/issues/2526),
  fixed in [servers#2609](https://github.com/modelcontextprotocol/servers/pull/2609));
  current npm `latest` is **`2026.1.14`** (the issue's "0.6.3" was stale info,
  verified via `npm view`), which resolves relative paths against the allowed
  dirs and succeeds. Why users got the old build is **our** side: (1) the
  default config template and the user's config invoke the server via
  `npx -y @modelcontextprotocol/server-filesystem` **with no pinned version**,
  and `start_mcp_server` rewrites `npx` → `bun x` with `BUN_INSTALL` pointing
  at our app cache (`<app>/.npx`) — a stale cached copy keeps being served;
  (2) spawned stdio MCP servers never set `current_dir`, so the child inherits
  the app CWD (`AppData\Local\Atomic Chat`), which is exactly where old-version
  relative resolution lands. The "different dir each retry" loop is model
  behaviour (small local model hallucinating paths), **not** the cwd/version
  bug, and is out of scope.
- **Decision (per chosen scope — primary fix + defense-in-depth #2; pin a
  concrete version):**
  1. **Pin a concrete version (primary).** New constants in
     [`constants.rs`](src-tauri/src/core/mcp/constants.rs):
     `FILESYSTEM_MCP_PACKAGE`, `FILESYSTEM_MCP_PINNED_VERSION = "2026.1.14"`,
     and `filesystem_mcp_pinned_spec()` (=
     `@modelcontextprotocol/server-filesystem@2026.1.14`). The default config
     template's filesystem arg now uses a `__JAN_FS_MCP_SPEC__` placeholder
     substituted from that single source of truth in `default_mcp_config()`
     (no literal/const drift). Pinning a **concrete** version is the
     cache-bust: `bun x <pkg>@2026.1.14` misses the cached old version and
     fetches the fixed build — `@latest` would not reliably do so. Trade-off:
     the version must be bumped manually when a newer fixed release is
     validated (deliberately chosen over `@latest`).
  2. **Migrate existing on-disk configs** ([`commands.rs :: get_mcp_configs`](src-tauri/src/core/mcp/commands.rs),
     mirroring the existing `LEGACY_FILESYSTEM_PLACEHOLDER` migration): scan
     **every** server's `args` (not just the one named `filesystem`, so
     custom-named entries are covered) and rewrite a **bare** unpinned
     `@modelcontextprotocol/server-filesystem` token → the pinned spec. Only
     the bare token is rewritten — an explicit user pin (`…@<ver>`) is left
     untouched — and the rewrite is idempotent (once pinned it equals the
     spec and never re-triggers).
  3. **`cwd` field for spawned stdio servers (defense-in-depth #2).** Added
     `cwd: Option<String>` to `McpServerConfig`
     ([`models.rs`](src-tauri/src/core/mcp/models.rs)), parsed in
     `extract_command_args` ([`helpers.rs`](src-tauri/src/core/mcp/helpers.rs),
     empty-string filtered), and applied via `cmd.current_dir(cwd)` in
     `start_mcp_server` before spawn (no-op when unset → inherits app CWD).
     The default template's `filesystem` entry now also carries
     `"cwd": "__JAN_DEFAULT_FS_DIR__"` (= the sandbox root) so relative paths
     land in the allowed dir even on an old server. TS parity:
     `cwd?: string` added to `MCPServerConfig`
     ([`useMCPServers.ts`](web-app/src/hooks/useMCPServers.ts)).
- **Consequences:** Fresh installs get the fixed, version-pinned server with a
  sandbox CWD; existing installs are auto-migrated to the pinned version on
  next config read (the concrete-version pin busts their stale `bun` cache),
  so relative-path writes resolve against the allowed dir. **Deliberately NOT
  done:** defense-in-depth #3 (advertising MCP **roots** / injecting allowed
  dirs into the system prompt — deferred per chosen scope); retrofitting `cwd`
  into *existing* on-disk filesystem entries (the version pin already fixes
  them; `cwd` default ships only for fresh installs and manual use); upgrading
  an explicitly user-pinned *old* version (left to the user). The retry-loop
  is a model-quality issue, untouched. Scope: 3 Rust files (mcp constants /
  commands / models / helpers) + 1 web-app type; no IPC, on-disk layout, or
  settings-schema-shape change beyond the additive optional `cwd` field.
  **Verified:** `cargo check -p Atomic-Chat` 0 errors (pre-existing
  unrelated `dead_code` warnings only); `tsc -b` clean; `eslint` clean on the
  touched TS file.
- **Owner:** team.
- **Links:** [ATO-164](https://linear.app/atomicchat/issue/ATO-164),
  [servers#2526](https://github.com/modelcontextprotocol/servers/issues/2526),
  [servers#2609](https://github.com/modelcontextprotocol/servers/pull/2609),
  files:
  [`src-tauri/src/core/mcp/constants.rs`](src-tauri/src/core/mcp/constants.rs)
  (`FILESYSTEM_MCP_*`, `filesystem_mcp_pinned_spec`, template placeholders),
  [`src-tauri/src/core/mcp/commands.rs`](src-tauri/src/core/mcp/commands.rs)
  (`get_mcp_configs` pin migration),
  [`src-tauri/src/core/mcp/models.rs`](src-tauri/src/core/mcp/models.rs)
  (`McpServerConfig.cwd`),
  [`src-tauri/src/core/mcp/helpers.rs`](src-tauri/src/core/mcp/helpers.rs)
  (`extract_command_args`, `start_mcp_server` `current_dir`),
  [`web-app/src/hooks/useMCPServers.ts`](web-app/src/hooks/useMCPServers.ts)
  (`MCPServerConfig.cwd`).

### 2026-06-15 — Reset the global `llamacpp-upstream` MTP toggle on active-model change so it can't stay "on" for a non-MTP model (ATO-54)
- **Context:** The `llamacpp-upstream` **MTP** toggle is a **provider-global**
 boolean (`mtp` in the extension settings, surfaced as a Switch in
 [`$providerName.tsx`](web-app/src/routes/settings/providers/$providerName.tsx)).
 Support was validated **only on manual toggle-on** (`handleToggleLlamacppMtp`),
 never when the active model changed. Two reported scenarios
 ([ATO-54](https://linear.app/atomicchat/issue/ATO-54)): (1) MTP "auto-on" /
 stale global flag applied to a non-MTP model (`Qwen3.6-…-APEX`) → opaque load
 failure; (2) toggle stays on when switching from an MTP-capable model A to a
 non-capable model B → same failure. The 2026-06-10 load-time capability gate
 (ATO-122, `performLoad`) already **prevents the crash** (silently drops
 `cfg.mtp` for non-capable targets), but the **UI Switch stayed visually "on"**,
 a confusing mismatch — exactly ATO-54's remaining ask.
- **Decision:** Per the user's chosen option (**MLX parity, capability-aware**;
 the alternative of true per-model `model.yml` persistence was explicitly
 rejected as the larger change ADR 2026-06-10 had already deferred). Added a
 brother-effect to the existing MLX reset-on-model-change effect, scoped to
 `provider === 'llamacpp-upstream'`: a `useMemo` tracks the active upstream
 model id (`activeModels ∩ provider.models`), and a `useEffect` (skipping first
 mount + no-op changes, mirroring the MLX one) reconciles on change — when
 `mtp` is on and the new active model is **not** MTP-capable (same heuristic as
 the toggle handler / load gate: Qwen built-in MTP = id contains `"mtp"`, or
 `engine.checkGemmaMtpSupport(id)` for Gemma 4 31B/26B-A4B), it writes
 `mtp = false` via `updateSettings` + `updateProvider`. MTP-capable targets keep
 the value. The capability probe is async (Gemma check) and guarded by a
 `cancelled` flag for unmount safety.
- **Consequences:** Switching to a non-MTP model now flips the Switch off and
 persists `mtp = false`, so the UI reflects reality and no stale spec-decode arg
 is carried (the ATO-122 load gate remains as defense-in-depth). **Trade-off
 (accepted, = MLX parity):** the flag is still **provider-global**, not true
 per-model memory — re-selecting a previously-MTP model A does **not** restore
 its toggle (it defaults off). **First-mount is intentionally skipped** (MLX
 parity), so opening Settings with an already-active non-MTP model + a stale
 `mtp` flag won't auto-reset until the next model change; correctness is
 unaffected because the load gate still drops MTP. Scope: web-app only (1 effect
 + 1 memo + 1 ref in `$providerName.tsx`); no Rust, IPC, `model.yml`/settings
 schema, or extension change. macOS turboquant `llamacpp` (no MTP toggle) and
 MLX (already has its own reset) are untouched. **Verified:** `tsc -b` clean
 (exit 0); `eslint` clean ("No issues found") on the touched file.
- **Owner:** team.
- **Links:** [ATO-54](https://linear.app/atomicchat/issue/ATO-54),
 [ATO-122](https://linear.app/atomicchat/issue/ATO-122), the 2026-06-10 ADR
 *Gate the global `mtp` flag on per-model capability at load time …*, files:
 [`web-app/src/routes/settings/providers/$providerName.tsx`](web-app/src/routes/settings/providers/$providerName.tsx)
 (`activeLlamacppUpstreamModelId` memo + reset effect, mirroring the MLX
 `activeMlxModelId` reset).

### 2026-06-15 — Stop "Find optimal backend" from silently degrading to CPU when the ggml-org release stream is unreachable (ATO-161) + de-hardcode the Windows CUDA minor to a family id (ATO-174)
- **Context:** Two coupled `llamacpp-upstream` defects around the
 GitHub-hosted backend release stream
 (`api.github.com/repos/ggml-org/llama.cpp/releases`).
 - **[ATO-161](https://linear.app/atomicchat/issue/ATO-161):**
 `detectIdealBackendType()` returned `string | null`, conflating two very
 different outcomes in the single `null`: "CPU is genuinely the best this
 hardware can do" **and** "I couldn't fetch the GPU options because the
 release stream was unreachable / slow / rate-limited". `recheckOptimalBackend()`
 logged the merged *"CPU is optimal or detection failed"* and returned
 `null`; the "Find optimal backend" handler
 ([`$providerName.tsx`](web-app/src/routes/settings/providers/$providerName.tsx))
 then showed the reassuring **"You're already on the optimal backend"**
 toast. Net effect on a GPU-capable host with a flaky/blocked GitHub: the
 app silently stayed on (or implied) CPU and *told the user that was
 optimal* — actively misleading.
 - **[ATO-174](https://linear.app/atomicchat/issue/ATO-174):** the manual
 backend dropdown's `staticVariants` hard-coded concrete Windows CUDA
 minors (`win-cuda-12.4-x64`, `win-cuda-13.3-x64`), and
 `resolveLatestBackendString` / `newestInstalledOfFamily` matched the
 selected id against published assets by **exact string**. ggml-org bumps
 the CUDA minor over time (`13.3 → 13.4 → …`); the next bump would make the
 hard-coded sentinel exact-match nothing → `latest/win-cuda-13.3-x64`
 resolves to no asset → dead-end. Manual CUDA selection also surfaced only a
 generic failure when `api.github.com` was unreachable, with no offline path
 and no actionable guidance. This finishes the 2026-06-08 ATO-105 work
 (which already made the *detection* path family-aware but left the manual
 dropdown + resolvers on hard-coded minors).
- **Decision:** Web-app + extension only; no Rust, IPC, on-disk layout, or
 settings-schema change.
 1. **ATO-161 — discriminated detection result.** New
 `IdealBackendResult = { kind: 'gpu'; backend } | { kind: 'cpu-optimal' } |
 { kind: 'detection-failed' }` and an exported `BACKEND_DETECTION_FAILED`
 sentinel in
 [`index.ts`](extensions/llamacpp-upstream-extension/src/index.ts).
 `detectIdealBackendType()` now returns this union instead of
 `string | null`: a picked GPU tier → `{ kind: 'gpu', backend }`; a
 **GPU-capable** host (driver/feature gate says CUDA/Vulkan usable) with
 **no** GPU backend anywhere in the merged local+remote catalog → `{ kind:
 'detection-failed' }` (ggml-org *always* publishes CUDA+Vulkan Windows
 assets, so an empty GPU catalog means `fetchRemoteBackends()` returned `[]`
 — a fetch failure, not "CPU is best"); the `catch` and the genuine
 no-GPU-hardware paths → `{ kind: 'cpu-optimal' }`. Linux's non-GPU outcome
 stays `cpu-optimal` (its Vulkan recommend is a pure local libvulkan probe,
 no network). `recheckOptimalBackend()` wraps detection in the existing
 20 s `withTimeout` (timeout → `detection-failed`), **throws
 `Error(BACKEND_DETECTION_FAILED)`** on failure, and returns `null` only for
 real `cpu-optimal`/already-optimal. Its outer `catch` re-throws the
 sentinel and still swallows every *other* error to `null` (onboarding must
 not regress). All three callers handle the throw:
 [`$providerName.tsx`](web-app/src/routes/settings/providers/$providerName.tsx)
 → distinct `backendUpdater.detectionUnavailable` toast (not "already
 optimal"); [`SetupBackendStep.tsx`](web-app/src/containers/SetupBackendStep.tsx)
 → its existing `detection-failed` phase (CPU stays a usable fallback,
 onboarding advances); the `useBackendUpdater` post-upgrade auto-recheck →
 warn-and-continue.
 2. **ATO-174 — family-id resolution.** `staticVariants` (Windows) now lists
 the minor-less family ids `win-cuda-12-x64` / `win-cuda-13-x64` (the
 dropdown renders them as "Latest CUDA 12 / CUDA 13" via the existing
 `friendlyBackendLabel`). Three pure helpers in
 [`backend.ts`](extensions/llamacpp-upstream-extension/src/backend.ts) —
 `cudaFamilyMajor`, `isConcreteOfCudaFamily`, `resolveCudaFamilyConcrete`
 (picks the **highest** published minor of a major). `resolveLatestBackendString`
 falls back to `resolveCudaFamilyConcrete` when the exact id isn't a
 published asset (so `latest/win-cuda-13-x64` → `b____/win-cuda-13.<newest>-x64`
 across minor bumps); `newestInstalledOfFamily` matches a family id against
 any installed concrete minor (offline fallback returns the **concrete**
 installed id, never the family id, which would 404). `downloadManualBackend`'s
 dead-end now throws an actionable message naming `api.github.com` and
 pointing at Settings → Proxy / "Install backend from file" instead of a
 bare failure. The `detectIdealBackendType` Windows CUDA-13 picker was
 already family-aware (`^win-cuda-13\.\d+-`) from ATO-105 and is untouched;
 CUDA-12 stays `12.4` (the only 12.x ggml-org ships).
 3. **i18n:** new `backendUpdater.detectionUnavailable` (EN + RU); other
 locales fall back to EN.
- **Consequences:** A GPU-capable user with blocked/slow GitHub now sees a
 calm, accurate *"couldn't reach the release stream — keeping your current
 backend, check connection/proxy"* instead of a false "already optimal", and
 is never silently parked on CPU. Manual CUDA selection survives future
 ggml-org minor bumps and degrades to the newest locally-installed CUDA copy
 when offline. **Trade-off / lossy by design:** `detection-failed` is
 *inferred* on Windows from "GPU-capable + empty GPU catalog" rather than a
 first-class network-error signal threaded up from `fetchRemoteBackends()`
 — a rare false-positive is possible if a GPU-capable host legitimately has
 zero GPU assets for some other reason, but ggml-org's release matrix makes
 that practically impossible. Broader network resilience (retries, response
 caching, authenticated requests, a server-side mirror) was **deliberately
 deferred** — out of this slice. **Verified:** rolldown build clean
 (`dist/index.js` 213.53 kB, exit 0 — the authoritative extension compile;
 standalone `tsc --noEmit` noise from missing ambient base-class globals is
 pre-existing and not introduced here); web-app `tsc -b` clean; `eslint`
 clean on `$providerName.tsx`; both locale JSONs parse; all three
 `recheckOptimalBackend` call sites confirmed to handle the new sentinel.
- **Owner:** team.
- **Links:** [ATO-161](https://linear.app/atomicchat/issue/ATO-161),
 [ATO-174](https://linear.app/atomicchat/issue/ATO-174),
 [ATO-105](https://linear.app/atomicchat/issue/ATO-105),
 [ATO-95](https://linear.app/atomicchat/issue/ATO-95), the 2026-06-08 ADR
 *Windows: fix clean-install config persistence (ATO-107), de-hardcode the
 CUDA-13 minor (ATO-105) …* and the 2026-06-05 ADR *Resolve the
 `latest/<backend>` sentinel …*, files:
 [`extensions/llamacpp-upstream-extension/src/index.ts`](extensions/llamacpp-upstream-extension/src/index.ts)
 (`IdealBackendResult`, `BACKEND_DETECTION_FAILED`, `detectIdealBackendType`,
 `recheckOptimalBackend`, `resolveLatestBackendString`,
 `newestInstalledOfFamily`, `downloadManualBackend`, `staticVariants`),
 [`extensions/llamacpp-upstream-extension/src/backend.ts`](extensions/llamacpp-upstream-extension/src/backend.ts)
 (`cudaFamilyMajor`, `isConcreteOfCudaFamily`, `resolveCudaFamilyConcrete`),
 [`web-app/src/routes/settings/providers/$providerName.tsx`](web-app/src/routes/settings/providers/$providerName.tsx)
 (`handleFindOptimalBackend` catch),
 [`web-app/src/containers/SetupBackendStep.tsx`](web-app/src/containers/SetupBackendStep.tsx),
 [`web-app/src/locales/en/settings.json`](web-app/src/locales/en/settings.json),
 [`web-app/src/locales/ru/settings.json`](web-app/src/locales/ru/settings.json).

### 2026-06-15 — Migrate the stale macOS `llamacpp` default to `llamacpp-upstream` for pre-ATO-116 profiles (ATO-136)
- **Context:** ADR 2026-06-09 *Default the macOS local llama.cpp engine to
  `llamacpp-upstream`* (ATO-116) made upstream the default so the Recommended
  Gemma 4 vision model loads out of the box. A user on the built v1.1.106
  reported it "not effective": freshly downloaded GGUFs on macOS still ran on
  the turboquant fork (`llamacpp`), crashing on new archs (gemma4uv / lfm2moe).
  Investigation ([ATO-136](https://linear.app/atomicchat/issue/ATO-136))
  showed the reporter's "proof" (models living in `data/llamacpp/models/`,
  `data/llamacpp-upstream/models/` empty) is a **false signal** — both
  providers deliberately share the on-disk GGUF tree
  (`MODELS_PROVIDER_ROOT='llamacpp'` in
  [`extensions/llamacpp-upstream-extension/src/index.ts`](extensions/llamacpp-upstream-extension/src/index.ts)),
  so an upstream import lands there too. The **real** cause: ATO-116 only
  flipped the *constants* (`LOCAL_LLAMACPP_PROVIDER='llamacpp-upstream'`,
  `getModelToStart` order) and deliberately left the persisted-state
  migration `IS_WINDOWS`-gated (to avoid the macOS "hanging-thread" risk it
  documented). So a **pre-ATO-116 macOS profile** keeps `selectedProvider:
  'llamacpp'` in the zustand `model-provider` store *and* `{ provider:
  'llamacpp' }` in the non-zustand `lastUsedModel` localStorage blob; both
  validate fine on macOS (the turboquant provider still ships) and drive
  `DataProvider` auto-start + the model-bar default back onto turboquant.
  Fresh installs were unaffected (they start at the new default); only
  upgraded users were stuck.
- **Decision:** Move only the **global default selection** off turboquant on
  macOS, in two coordinated one-shot migrations — explicitly *not* removing
  the turboquant `llamacpp` provider (still a valid manual choice on macOS)
  and *not* touching per-thread bindings (so the ADR 2026-06-09 "don't hang
  existing threads" constraint holds). This reverses only the *default*
  clause of the `IS_WINDOWS` gate, not the whole gate.
  1. **zustand `selectedProvider`** ([`useModelProvider.ts`](web-app/src/hooks/useModelProvider.ts)):
     persist `version` bumped `13 → 14`; new `migrate` block redirects
     `selectedProvider 'llamacpp' → LOCAL_LLAMACPP_PROVIDER` when `version <=
     13 && IS_MACOS`. `selectedModel` is intentionally left untouched —
     `setProviders` re-resolves it against the upstream provider's copy of the
     same shared-tree model on first paint (same mechanism the v13 Windows
     block relies on). The version bump is required because v1.1.106 already
     persists `version: 13`, so a one-time edit to the v13 block alone would
     never re-run for those users.
  2. **`lastUsedModel` localStorage blob** (NEW
     [`web-app/src/lib/macosLlamacppDefaultMigration.ts`](web-app/src/lib/macosLlamacppDefaultMigration.ts)):
     mirrors the Windows sibling
     [`windowsProviderMigration.ts`](web-app/src/lib/windowsProviderMigration.ts)
     (shared `{ provider, model }` rewrite shape, one-shot flag
     `atomic_macos_llamacpp_default_to_upstream_v1`, non-fatal try/catch) but
     macOS-gated and trimmed to just the `lastUsedModel` rewrite (no Windows
     optimal-backend recheck). Called from
     [`main.tsx`](web-app/src/main.tsx) right after
     `runWindowsLlamacppProviderMigration()`, *before* React mounts, so the
     first `DataProvider` auto-start reads the upstream provider.
- **Consequences:** Upgraded macOS users now auto-start / default GGUFs on
  `llamacpp-upstream` (a superset of turboquant that handles the new archs),
  fixing the ATO-136 crash-on-load without re-downloading or re-importing
  models. **Trade-off:** a macOS user who *deliberately* selected turboquant
  before this build is redirected to upstream **once** and must re-select
  turboquant if they want it — accepted, matching the Windows v13 redirect's
  behaviour and the "turboquant is a manual/advanced choice" framing. Scope:
  web-app only (1 store migration + 1 new lib module + 1 `main.tsx` call); no
  Rust, IPC, on-disk layout, or settings-schema change; Windows/Linux are
  no-ops (the new module early-returns on `!IS_MACOS`, the v14 block on
  `!IS_MACOS`). **Verified:** `tsc -b` clean (exit 0); `eslint` clean on the
  three touched/new files.
- **Owner:** team.
- **Links:** [ATO-136](https://linear.app/atomicchat/issue/ATO-136),
  [ATO-116](https://linear.app/atomicchat/issue/ATO-116), the 2026-06-09 ADR
  *Default the macOS local llama.cpp engine to `llamacpp-upstream`*, the
  2026-05-22 ADR *Windows ships only `llamacpp-upstream`*, files:
  [`web-app/src/hooks/useModelProvider.ts`](web-app/src/hooks/useModelProvider.ts)
  (v14 migrate block),
  [`web-app/src/lib/macosLlamacppDefaultMigration.ts`](web-app/src/lib/macosLlamacppDefaultMigration.ts),
  [`web-app/src/main.tsx`](web-app/src/main.tsx),
  [`web-app/src/lib/windowsProviderMigration.ts`](web-app/src/lib/windowsProviderMigration.ts)
  (mirrored pattern).

### 2026-06-12 — Make sampling global (model-bar popover) + slim the assistant to persona-only (ATO-155 rework)
- **Context:** Sampling parameters (`temperature`/`top_p`/`top_k`/`min_p`/
 penalties + optional `max_output_tokens`) lived **per-assistant** in
 `assistant.parameters` and were read by `custom-chat-transport`. The same
 sampling knobs *also* had dead load-time twins under `model.settings.*`
 (surfaced in the `ModelSetting` gear), so users saw two competing places to
 set temperature and were confused about what an "assistant" even was. The
 ATO-155 Sampling popover (model bar) had been wired to edit
 `assistant.parameters`, which entangled persona and sampling.
- **Decision:** Split the two concerns cleanly.
 1. **Global sampling store** (new
 [`web-app/src/hooks/useSamplingSettings.ts`](web-app/src/hooks/useSamplingSettings.ts)):
 Zustand + `persist` (new key `sampling-settings` in
 [`localStorage.ts`](web-app/src/constants/localStorage.ts)), holding one
 app-wide `params` bag. Seeded once from `defaultAssistant.parameters` so the
 historical defaults (`temperature 0.7`, `top_k 20`, `top_p 0.8`,
 `repeat_penalty 1.12`) survive the move; only keys actually present are sent,
 so untouched params keep the backend default (no behavior change).
 2. **Transport reads the global store**
 ([`custom-chat-transport.ts`](web-app/src/lib/custom-chat-transport.ts)):
 `inferenceParams` and `maxOutputTokens` now come from
 `useSamplingSettings.getState().getParams()` instead of
 `currentAssistant.parameters`. `currentAssistant` remains the
 system-prompt/identity source (instructions path untouched).
 3. **Popover** ([`SamplerPopover.tsx`](web-app/src/containers/SamplerPopover.tsx)):
 Sampling section now reads/writes the global store; added a **Context**
 section editing the current model's `ctx_len` (`model.settings.ctx_len`),
 persisted via `updateProvider` and applied to a *running* model via a
 debounced `stopModel`+`startModel` (mirrors `ModelSetting`'s restart). Takes
 `model` + `provider` props from
 [`DropdownModelProvider.tsx`](web-app/src/containers/DropdownModelProvider.tsx).
 The assistant switcher stays (persona selection for a new chat) but no longer
 carries sampling.
 4. **Assistant editor**
 ([`AddEditAssistant.tsx`](web-app/src/containers/dialogs/AddEditAssistant.tsx)):
 stripped the Settings header, predefined-param chips, and dynamic
 key/type/value rows — only emoji/name/description/instructions remain. On
 save, existing on-disk `parameters` are **preserved untouched** (vestigial,
 default `{}` for new assistants) — migrations unaffected.
 5. **Gear de-dup** ([`ModelSetting.tsx`](web-app/src/containers/ModelSetting.tsx)):
 a `LEGACY_SAMPLING_KEYS` block-list hides the load-time sampling twins
 (`temperature`/`top_p`/`top_k`/`min_p`/`repeat_penalty`/`repeat_last_n`/
 `presence_penalty`/`frequency_penalty`) from the gear UI. The gear stays the
 editor for genuine load-time/engine settings (`ctx_len`, `ngl`,
 `chat_template`, `batch_size`, `cpu_moe`, mmproj, …). Persisted
 `model.settings.*` values are left on disk (only hidden).
- **Consequences:** Exactly one place to tune sampling (the popover); the
 assistant is now unambiguously persona-only. Context size is editable inline
 and restarts a running model only on `ctx_len` change (sampling never
 restarts — applied per-request). **Deliberately not done:** per-family
 recommended sampling (ATO-99); deleting `assistant.parameters` or the
 `model.settings.*` sampling twins from disk (kept for rollback/migration).
 **Verified:** `ReadLints` clean, `eslint` clean, `tsc -b` clean on all
 touched files.
- **Owner:** team.
- **Links:** [ATO-155](https://linear.app/atomicchat/issue/ATO-155), files:
 [`web-app/src/hooks/useSamplingSettings.ts`](web-app/src/hooks/useSamplingSettings.ts),
 [`web-app/src/lib/custom-chat-transport.ts`](web-app/src/lib/custom-chat-transport.ts),
 [`web-app/src/containers/SamplerPopover.tsx`](web-app/src/containers/SamplerPopover.tsx),
 [`web-app/src/containers/DropdownModelProvider.tsx`](web-app/src/containers/DropdownModelProvider.tsx),
 [`web-app/src/containers/dialogs/AddEditAssistant.tsx`](web-app/src/containers/dialogs/AddEditAssistant.tsx),
 [`web-app/src/containers/ModelSetting.tsx`](web-app/src/containers/ModelSetting.tsx),
 [`web-app/src/constants/localStorage.ts`](web-app/src/constants/localStorage.ts).

---

### 2026-06-12 — Fix variant-row height jump on the Hub model-card page by giving the in-progress download the same pill button as the rest of the Hub
- **Context:** The earlier same-day pill ADR (below) only converted the three
 shared download components, but the **model-card variant table** renders its
 action cell **inline** in
 [`$modelId.tsx`](web-app/src/routes/hub/$modelId.tsx), not via
 `ModelDownloadAction`. So clicking "Download" on a variant swapped a
 `Button size="sm"` (~h-8) for a shorter inline cluster (thin `Progress w-12`
 + percent text + an `icon-xs` ghost X), shrinking the `td` content height and
 making the whole table jump.
- **Decision:** Replace the inline in-progress cluster with the exact same
 button-shaped pill used elsewhere — `Button variant="outline" size="sm"`
 (`group relative ml-auto w-24 …`) with a `bg-primary/20` width-driven progress
 fill, a `group-hover`-revealed `IconX` cancel, keeping the existing
 `markResumableDownload` / `markDownloadCancellationRequested` /
 `abortDownload` cancel wiring. Same footprint as the "Download" / "New chat"
 buttons in the other two row states, so the row height is constant across
 idle → downloading → downloaded. Removed the now-unused `Progress` import.
- **Consequences:** No more layout shift when a variant download starts; the
 variant table now matches the Hub-wide pill look. `tsc -b` + eslint clean.
 Scope limited to the one inline surface that the prior pass missed.
- **Amendment (same day) — variant-row pill is pause/resume, cancel moves to the
 download popover.** The PM asked that the in-progress pill on the model-card
 variant rows ([`$modelId.tsx`](web-app/src/routes/hub/$modelId.tsx)) toggle
 **pause/resume** on hover (an `IconPlayerPause` / `IconPlayerPlay` revealed
 over the percent), with **cancel (`IconX`) available only in the title-bar
 download-management popover** ([`DownloadManegement.tsx`](web-app/src/containers/DownloadManegement.tsx)).
 Implemented by mirroring that popover's ATO-154 pause/resume wiring into the
 row: `handlePauseDownload` = `markPausedDownload` + `markResumableDownload` +
 `abortDownload` (the partial GGUF is kept on disk; the global
 `onFileDownloadStopped` paused-branch keeps the `downloads[id]` entry so the
 pill survives with frozen progress), and `handleResumeDownload` = replay the
 stored `resumeParams[id]` via `pullModelWithMetadata(..., resume=true)`.
 Gated by `isPausableDownload` (non-`llamacpp*` / non-`mlx*`) — always true for
 the GGUF variant table, kept as a safety gate (`disabled` + no hover icon
 otherwise). The previous cancel wiring (`markDownloadCancellationRequested` +
 `abortDownload`) and its now-unused import were dropped from the row.
- **Owner:** team.
- **Links:** the same-day ADR *Make the Hub download in-progress state a
 button-shaped "pill" …* (below), the ATO-154 pause/resume model-download work,
 files:
 [`web-app/src/routes/hub/$modelId.tsx`](web-app/src/routes/hub/$modelId.tsx),
 [`web-app/src/containers/DownloadManegement.tsx`](web-app/src/containers/DownloadManegement.tsx)
 (cancel stays here).

### 2026-06-12 — Force the model-status dot green while a llama.cpp model is running (drop the misleading "doesn't work on your device" red)
- **Context:** The header model-status dot
 ([`ModelSupportStatus`](web-app/src/containers/ModelSupportStatus.tsx)) for the
 `llamacpp` / `llamacpp-upstream` providers is driven by a **static**
 `serviceHub.models().isModelSupported(path, ctxSize)` probe → GREEN/YELLOW/RED
 with tooltip "Works Well / Might work / Doesn't work on your device (ctx: N)".
 That estimate is keyed off the **configured** context size, so a model with
 ctx set to 16k–32k shows RED even though it loads and runs fine in practice
 (the user rarely reaches that context, and runtime context overflow is
 already surfaced by a dedicated error). PM: while the model is actually
 running, the dot must always be green. (MLX already worked this way — its
 status is derived from `activeModels`.)
- **Decision:** Mirror the MLX behaviour for the llama.cpp providers. Added
 `isModelRunning = !!modelId && activeModels.includes(modelId)`
 (`activeModels` is populated from `getActiveModels()`, which queries the local
 engines, so a running GGUF model's id is present). In the llama.cpp support
 effect, short-circuit to `GREEN` when the model is in `activeModels` and skip
 the static ctx probe (effect dep list gains `activeModels`). The GREEN tooltip
 now reads "Model is running" when running, else keeps "Works Well on your
 device (ctx: N)". The pre-start probe (GREEN/YELLOW/RED) is unchanged when the
 model is **not** running — the red hint still helps before load.
- **Consequences:** No more red "doesn't work" dot for a model that is in fact
 loaded; changing the ctx slider while running no longer flips the dot to red.
 Context-overflow feedback is unaffected (separate runtime error). Display-only
 — no engine/IPC/store change. Verified: `tsc -b` clean, `eslint` clean.
- **Owner:** team.
- **Links:** files:
 [`web-app/src/containers/ModelSupportStatus.tsx`](web-app/src/containers/ModelSupportStatus.tsx).

### 2026-06-12 — Make the Hub download in-progress state a button-shaped "pill" and surface the title-bar download indicator (auto-open + pulse)
- **Context:** PM feedback (screenshots) on the Hub: (1) once a variant
 download starts, the row's action cell collapsed from a proper button
 ("Download" / "New chat") to a thin `Progress` bar + "NN%" + a tiny ghost `X`
 icon (`w-24` block), reading as a broken "недокнопка" next to the real
 buttons; (2) the title-bar download indicator
 ([`DownloadManagement`](web-app/src/containers/DownloadManegement.tsx)) — a
 ghost icon with a faint progress ring shown only while `downloadCount > 0` —
 was nearly invisible, so users didn't notice a download was running. The same
 in-progress markup was triplicated across
 [`ModelDownloadAction`](web-app/src/containers/ModelDownloadAction.tsx),
 [`DownloadButton`](web-app/src/containers/DownloadButton.tsx) (Hub index
 cards), and [`MlxModelDownloadAction`](web-app/src/containers/MlxModelDownloadAction.tsx).
 **Correction (same day):** the `$modelId` variant table the PM actually
 screenshotted does **not** use `ModelDownloadAction` — it renders the action
 cell inline in [`$modelId.tsx`](web-app/src/routes/hub/$modelId.tsx), so the
 first pass didn't change that surface. A follow-up applied the same pill there
 too (see the same-day ADR *Fix variant-row height jump …* below).
- **Decision (per the user's chosen options):**
 1. **Pill button** — replace the bar+%+X trio with a single
 `variant="outline" size="sm"` button matching the "Download"/"New chat"
 footprint (`w-24`): a left-anchored `bg-primary/20` width-`%` progress fill
 behind the centered "NN%" label; on hover the percent fades out and a
 centered `IconX` fades in; the whole button is the cancel control
 (`onClick={handleCancelDownload}`, `title`/`aria-label` =
 `common:cancelDownload`). Applied **identically to all three** Hub
 download-action components for visual consistency (the PM only flagged the
 variant rows, but the widget is shared — fixing one and leaving the others
 inconsistent would be a half-fix). Inlined in each (no new shared
 component/file). `Progress` import dropped from all three (sole consumer
 removed).
 2. **Indicator visibility** — in `DownloadManagement`, when `downloadCount`
 rises from `0`, briefly auto-open the popover (4s `setTimeout` auto-close;
 refs `prevDownloadCount` / `autoCloseTimer`, cleared on unmount; the
 controlled `onOpenChange` clears the timer on any manual open/close so we
 never fight the user). **Amendment (same day, per user):** the visual
 highlight that originally rode along — `highlightIndicator` pulse
 (`animate-pulse ring-2 ring-primary/40`) and the `downloadCount > 0`
 `text-primary` icon recolor — was **reverted**; only the auto-open logic was
 kept. The icon stays its original `text-muted-foreground` with just the
 existing progress ring.
- **Consequences:** Downloading rows now look like first-class buttons and the
 cancel affordance is the whole control (larger hit target) rather than a 12px
 `X`. The title-bar indicator announces itself on start and stays
 color-highlighted while active. Display-only — no change to download
 start/cancel/resume logic, the store, IPC, or telemetry. Auto-open is
 best-effort UX: it closes after 4s (acceptable per "briefly open") and yields
 to manual interaction; a second concurrent download starting while one is
 active does not re-open (trigger gated on `prev === 0`). Verified: `tsc -b`
 clean, `eslint` clean on all four touched files.
- **Owner:** team.
- **Links:** files:
 [`web-app/src/containers/ModelDownloadAction.tsx`](web-app/src/containers/ModelDownloadAction.tsx),
 [`web-app/src/containers/DownloadButton.tsx`](web-app/src/containers/DownloadButton.tsx),
 [`web-app/src/containers/MlxModelDownloadAction.tsx`](web-app/src/containers/MlxModelDownloadAction.tsx),
 [`web-app/src/containers/DownloadManegement.tsx`](web-app/src/containers/DownloadManegement.tsx).

### 2026-06-11 — ATO-135 (web-app slice): clear the stuck "Failed to load" toast on a successful load (ATO-63) + map classified engine errors to actionable messages (ATO-121)
- **Context:** Epic [ATO-135](https://linear.app/atomicchat/issue/ATO-135) bundles
  one root pattern (bundled runtime forks lag upstream on new architectures —
  `lfm2moe`/LFM2.5, Gemma 4 `gemma4uv`) plus the poor UX around the resulting
  load failures. Two of its sub-tickets are clean, self-contained **web-app**
  fixes (the rest — MLX `mlx-vlm` bump for `lfm2_moe` (ATO-62), the TurboQuant
  `GGML_ASSERT` crash on `lfm2moe`, the macOS-default-not-effective-in-release
  investigation, and LFM2.5 native tool-call parsing (ATO-64) — are
  backend-coupled / external-repo and deliberately out of this slice).
  - **ATO-63** — in [`switchModel.ts`](web-app/src/utils/switchModel.ts) the
    `reportModelLoadError` toast (`id:'model-load-error'`) was raised on a failed
    load but **never dismissed on a later success**. So when MLX fails to load a
    model (e.g. `lfm2_moe`) and the user then starts the same model on llama.cpp,
    the stale "Failed to load" toast keeps hanging while the model is actually
    running and answering.
  - **ATO-121** — `reportModelLoadError` always rendered the generic
    `modelLoadFailedDescription` ("…encountered an unexpected error"). The Rust
    plugins already classify the cause (`LlamacppError::from_stderr` /
    `from_exit_status`: `MULTIMODAL_PROJECTOR_LOAD_FAILED`,
    `MODEL_ARCH_NOT_SUPPORTED`, native-crash, OOM) and ATO-117's
    `formatLoadError` carries `message`/`details`/`[CODE]` to the UI — but the UI
    never used `err.code` to give a clean, actionable message with a next step.
- **Decision:** Web-app only; no Rust, IPC, schema, or backend change.
  1. **ATO-63** — new `clearModelLoadError()` helper (`toast.dismiss('model-load-error')`
     + `useModelLoad.setModelLoadError(undefined)`), called on **both** success
     paths: the `switchToModel` "already serving" early return and the
     `doSwitchToModel` happy path (step 7). Failures are untouched (the toast
     still appears), and successes never throttle.
  2. **ATO-121** — `reportModelLoadError` now branches on `err.code` before the
     generic fallback: `MULTIMODAL_PROJECTOR_LOAD_FAILED` →
     `multimodalUnsupported*`, `MODEL_ARCH_NOT_SUPPORTED` → `archNotSupported*`,
     `MODEL_FILE_NOT_FOUND` → `modelFileMissing*` — each a clean title +
     actionable hint ("Try a different backend in Settings → Model Providers, or
     update the app." / "Try re-downloading the model."). OOM keeps its existing
     persistent toast; `LLAMA_CPP_PROCESS_ERROR` deliberately stays on the
     generic path because its `from_exit_status` crash message is already
     meaningful and re-routing every generic process error to "incompatible"
     would over-claim. New keys in
     [`en/model-errors.json`](web-app/src/locales/en/model-errors.json) +
     [`ru/model-errors.json`](web-app/src/locales/ru/model-errors.json); other
     locales fall back to EN.
- **Consequences:** The stuck "Failed to load" toast no longer survives a
  successful cross-backend load; engine-incompatibility / missing-file / unknown
  projector failures now show a clear cause + next step instead of "unexpected
  error". **Scope:** 1 util + 2 locale files. **Verified:** `tsc -b` clean;
  `eslint` clean on `switchModel.ts`; `ReadLints` clean on all three; both JSON
  files parse. **Not done (out of this slice, still open under ATO-135):**
  ATO-62 (MLX `lfm2_moe` bump + sidecar rebuild), the TurboQuant `lfm2moe`
  `GGML_ASSERT` crash defense, the macOS-default-not-effective-in-v1.1.106
  investigation, and **ATO-64** — found to be **backend-coupled**: the
  `Failed to parse input at pos N` originates in `llama-server`'s own
  chat-format parser (the model never reaches the web-app as clean text), and
  the `<|tool_call_start|>` markers would also be eaten by
  `stripSpecialTokensTransform` in [`custom-chat-transport.ts`](web-app/src/lib/custom-chat-transport.ts);
  a pure web-app parser would not fix the reported case, so it was left for a
  backend-coupled follow-up.
- **Owner:** team.
- **Links:** [ATO-135](https://linear.app/atomicchat/issue/ATO-135),
  [ATO-63](https://linear.app/atomicchat/issue/ATO-63),
  [ATO-121](https://linear.app/atomicchat/issue/ATO-121),
  [ATO-117](https://linear.app/atomicchat/issue/ATO-117),
  [ATO-62](https://linear.app/atomicchat/issue/ATO-62),
  [ATO-64](https://linear.app/atomicchat/issue/ATO-64), files:
  [`web-app/src/utils/switchModel.ts`](web-app/src/utils/switchModel.ts)
  (`clearModelLoadError`, `reportModelLoadError`),
  [`web-app/src/locales/en/model-errors.json`](web-app/src/locales/en/model-errors.json),
  [`web-app/src/locales/ru/model-errors.json`](web-app/src/locales/ru/model-errors.json),
  Rust classifier
  [`tauri-plugin-llamacpp/src/error.rs`](src-tauri/plugins/tauri-plugin-llamacpp/src/error.rs)
  (`from_stderr`, `from_exit_status`).

### 2026-06-11 — Quiet the top-10 Sentry desktop anomalies: telemetry hygiene (downgrade/throttle/dedup) + two real fixes (sharded GGUF 8.3 path, native-crash classification)
- **Context:** The `atomic-chat-desktop` Sentry project was drowning in events
  (top issue ~thousands). Root cause is architectural amplification, not ten
  separate bugs: the [`SentryLogger`](src-tauri/src/core/telemetry/mod.rs) bridge
  (`wrap_logger`) turns **every** Rust `log::error!` into a crash-level Sentry
  event with no severity filter, throttle, or dedup, and the frontend choke point
  ([`switchModel.ts`](web-app/src/utils/switchModel.ts)) captured Sentry on
  **every** failed load with no throttle. One failed model load fanned out into 3+
  events (frontend `Error in load command` + Rust `exited with error code N` + Rust
  `Invalid path`), and a tight auto-start retry loop multiplied that into hundreds.
  Mapping of the 10 issues → workstreams: `-1B`/`-T` (exit 1/256) → WS1.1 duplicate
  exit-code log; `-6D`/`-6C` (Invalid model path) → WS1.2 + WS2; `-4` (AMD GPU
  memory probe) → WS1.3; `-Z` (Connection refused) → WS1.4; `-9`/`-3`/`-57`
  (`Error in load command`) → WS1.5 + WS3.1 (sharded GGUF, the true root of `-9`);
  `-A` (`0xC0000005` access violation) → WS3.2.
- **Decision:** Three workstreams; **no** change to the public `localhost:1337/v1`
  contract, no legacy `jan*` rename, no patch of the upstream llama.cpp binary
  (only defense against its segfault).
  - **WS1 — telemetry hygiene (kills ~90% of volume).** Recoverable/expected
    conditions log `warn!`/`debug!` (the bridge demotes those to breadcrumbs, not
    crash events); duplicates and probe spam are silenced; the frontend capture is
    throttled.
    1. **WS1.1** — in both
       [`tauri-plugin-llamacpp-upstream/src/commands.rs`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/commands.rs)
       and [`tauri-plugin-llamacpp/src/commands.rs`](src-tauri/plugins/tauri-plugin-llamacpp/src/commands.rs):
       the process-exit logs (both the early-exit and the ready-loop blocks)
       dropped `error!` → `warn!` — the structured error is already reported once
       by the frontend choke point, so the Rust log was a pure duplicate.
    2. **WS1.2** — in both
       [`path.rs`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/path.rs):
       `Invalid or inaccessible model/mmproj path` (`ModelFileNotFound`) dropped
       `error!` → `warn!` (a deleted/moved file is a user condition, not a crash).
    3. **WS1.3** — [`tauri-plugin-hardware/src/vendor/amd.rs`](src-tauri/plugins/tauri-plugin-hardware/src/vendor/amd.rs):
       the Windows `Failed to get AMD GPU memory usage` probe (fires every ~5s)
       dropped `error!` → `debug!` (the caller already degrades via
       `get_usage_unsupported()`).
    4. **WS1.4** — [`proxy.rs`](src-tauri/src/core/server/proxy.rs):
       `Proxy request to model failed` dropped `error!` → `warn!` (a refused proxy
       connection is a downstream symptom of the server not being up; the PostHog
       `error_kind` is still recorded).
    5. **WS1.5** — [`telemetry.ts`](web-app/src/lib/telemetry.ts) +
       [`switchModel.ts`](web-app/src/utils/switchModel.ts): new
       `shouldCaptureModelLoadSentry(model, code)` (independent map mirroring the
       existing PostHog `shouldEmitModelLoadFailure`, same 5-min window) gates the
       `captureHandledError` call, and `isRecoverableModelLoadCode` skips Sentry
       entirely for `MODEL_FILE_NOT_FOUND` / `BINARY_NOT_FOUND` /
       `MULTIMODAL_PROJECTOR_LOAD_FAILED`. **Systemic backstop:**
       [`mod.rs::before_send`](src-tauri/src/core/telemetry/mod.rs) now drops
       fingerprint-identical events (message + logentry + first exception + level)
       repeating within a 60s window (`is_duplicate_event`, bounded map, fails
       open), so any future `error!` flood self-limits.
  - **WS2 — stop the retry loop at the source (`-6D`, the dominant multiplier).**
    The initiator is the ChatInput auto-start effect
    ([`ChatInput.tsx`](web-app/src/containers/ChatInput.tsx)): a failed
    `switchToModel` flips `serverStatus`→`stopped` and `loadingModel`→`false`,
    **both effect deps**, so the effect re-fires and reloads on a fresh random
    port every ~1s (961 events / 22 min for one missing model). Fix: `switchModel.ts`
    records the last auto-start outcome per `(provider, model)` —
    `shouldAttemptAutoStart()` returns false for terminal codes
    (`MODEL_FILE_NOT_FOUND` / `BINARY_NOT_FOUND`, never auto-retried) and backs off
    others 30s; a success (or already-serving) clears the record. The auto-start
    effect consults it before calling `switchToModel`; **explicit user switches
    (dropdown / send) bypass the gate**, so a manual retry is always possible.
  - **WS3 — the two real functional defects.**
    1. **WS3.1 (root of `-9`)** — sharded GGUF on Windows. `validate_model_path`
       passed split files through `get_short_path`, mangling
       `model-00001-of-00003.gguf` → 8.3 `MODEL~1.GGU`; the `~N` index ≠ the split
       index, so llama.cpp rejects the load (`illegal split file idx: 2 … must be
       loaded with the first split`) and short names break sibling-split discovery.
       Fix (both plugins): new `is_split_gguf_name` (no regex — manual
       `-NNNNN-of-NNNNN.gguf` tail check) skips 8.3 conversion for split names,
       keeping the long path; unit-tested.
    2. **WS3.2 (`-A`)** — `llama-server` native crash (`3221225477` =
       `STATUS_ACCESS_VIOLATION`; Unix `SIGSEGV`/`SIGABRT`) left empty stderr, so
       `from_stderr` only yielded the opaque generic process error. New
       `LlamacppError::from_exit_status` (both plugins) classifies recognised crash
       exit codes into an **actionable** message hinting at an incompatible model /
       unsupported speculative-decoding (MTP) config, while still preferring a
       specific stderr cause (OOM/arch/projector) when present. The commands.rs
       blocks call it instead of `from_stderr` on non-success exit. **Investigation
       flag:** the observed crashes were MTP on **gemma-4-12B** on Windows upstream
       — the true bug is in the upstream binary (related to the ATO-122 MTP
       capability gate); this ADR only adds defense + diagnostics, MTP-on-Windows
       for gemma-4 needs a separate upstream-tracking task.
- **Consequences:** The recoverable/duplicate/probe conditions no longer become
  Sentry crash events; the `-6D` loop is cut at its source; sharded GGUF loads on
  Windows; native crashes get an actionable message instead of `[object Object]`-
  class opacity. **Lossy by design:** exact retry/repeat counts within the throttle
  & dedup windows are not preserved (accepted — the dashboards are device-weighted);
  the upstream segfault itself is not fixed. Scope: 2 Rust plugins (commands/path/
  error), 1 hardware plugin, the proxy + Rust telemetry backstop, and 3 web-app
  files (telemetry/switchModel/ChatInput) — no IPC, on-disk layout, or
  settings-schema change. **Verified:** `cargo check` 0 errors on
  `Atomic-Chat` + both llamacpp plugins + hardware (pre-existing dead_code warnings
  only); new `is_split_gguf_name` unit test passes in both plugins; `tsc -b` clean;
  `yarn lint` clean on the 3 touched web-app files (the 3 `ttft-timing.ts` errors +
  the `processImageFiles` warning are pre-existing and untouched); `ReadLints`
  clean on all edited files.
- **Owner:** team.
- **Links:** Sentry `atomic-chat-desktop` top-10 (`-1B`/`-T`/`-6D`/`-6C`/`-4`/`-Z`/
  `-9`/`-3`/`-57`/`-A`), the 2026-06-10 ADRs *Throttle crashloop `model_load`
  failure spam …* (ATO-130/133) and *Fix the two real model-load bugs …*
  (ATO-124/125), the 2026-06-09 ADR *Add zero-PII Sentry crash/error tracking …*
  (ATO-113), files:
  [`src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/commands.rs`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/commands.rs),
  [`src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/error.rs`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/error.rs)
  (`from_exit_status`, `is_crash_exit`),
  [`src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/path.rs`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/path.rs)
  (`is_split_gguf_name`), the mirror trio under
  [`tauri-plugin-llamacpp`](src-tauri/plugins/tauri-plugin-llamacpp/src/error.rs),
  [`src-tauri/plugins/tauri-plugin-hardware/src/vendor/amd.rs`](src-tauri/plugins/tauri-plugin-hardware/src/vendor/amd.rs),
  [`src-tauri/src/core/server/proxy.rs`](src-tauri/src/core/server/proxy.rs),
  [`src-tauri/src/core/telemetry/mod.rs`](src-tauri/src/core/telemetry/mod.rs)
  (`is_duplicate_event`),
  [`web-app/src/lib/telemetry.ts`](web-app/src/lib/telemetry.ts)
  (`shouldCaptureModelLoadSentry`, `isRecoverableModelLoadCode`),
  [`web-app/src/utils/switchModel.ts`](web-app/src/utils/switchModel.ts)
  (`shouldAttemptAutoStart`),
  [`web-app/src/containers/ChatInput.tsx`](web-app/src/containers/ChatInput.tsx).

### 2026-06-11 — Surface a user-selectable K/V cache type dropdown on the upstream `llamacpp-upstream` provider (standard types only)
- **Context:** The TurboQuant `llamacpp` provider exposes **KV Cache K/V Type**
 dropdowns (`cache_type_k` / `cache_type_v`,
 [`extensions/llamacpp-extension/settings.json`](extensions/llamacpp-extension/settings.json)
 lines 251–290) defaulting to the fork-only `turbo3`, plus the standard
 ggml-org types. The upstream `llamacpp-upstream` provider had **no** such UI:
 the whole end-to-end plumbing already existed — guest-js
 (`tauri-plugin-llamacpp-upstream/guest-js/types.ts` +
 `normalizeLlamacppConfig`) carries `cache_type_k/v`, and the Rust arg builder
 ([`args.rs`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/args.rs)
 ~514–532) already emits `--cache-type-k` (skipped when `f16`) and
 `--cache-type-v` (skipped when `f16`/`f32` **or** when `flash_attn === "off"`),
 with `sanitize_cache_type` falling non-turboquant builds back to `q8_0`. The
 **extension** deliberately hid it: `clearLegacyKvCacheSettings()` (migration
 v4, the 2026-06-04-era "vanilla `llama-server` performs best with its own
 `f16` default" decision) pruned the two keys from the settings list and
 cleared the in-memory config so `args.rs` skipped the flags entirely.
- **Decision:** Re-surface the dropdowns on the upstream provider with **only
 the K/V quant types vanilla ggml-org/llama.cpp supports** — no `turbo*`.
 1. **`settings.json`**
 ([`extensions/llamacpp-upstream-extension/settings.json`](extensions/llamacpp-upstream-extension/settings.json)):
 added `cache_type_k` + `cache_type_v` dropdowns after `mlock`, **default
 `f16`** (llama.cpp's native default → `args.rs` emits nothing, preserving
 prior behaviour for anyone who leaves it untouched), options =
 `f32, f16, bf16, q8_0, q4_0, q4_1, iq4_nl, q5_0, q5_1` (the
 `STANDARD_CACHE_TYPES` allowlist, **no `turbo3`**). `cache_type_v`'s
 description notes quantized V requires Flash Attention enabled (Auto/On).
 2. **Migrations**
 ([`index.ts`](extensions/llamacpp-upstream-extension/src/index.ts) `onLoad`):
 **removed the `await this.clearLegacyKvCacheSettings()` call** (it would
 strip the freshly-added entries for fresh installs and never re-add them)
 **and the `await this.migrateKvCacheDefaults()` call** (it would flip the new
 `f16` default to `q8_0` for fresh installs). Both methods are left defined
 but uncalled — consistent with the already-dead `migrateKvCacheToTurbo3` —
 so the existing isolated unit tests for `migrateKvCacheDefaults`
 (`src/test/index.test.ts`) still pass unchanged. v3 (`migrateFitDefault`)
 is untouched.
- **Consequences:** Upstream users can now pick a quantized K/V cache type from
 the provider settings to shrink the KV cache (e.g. `q8_0`/`q4_0`), with V
 quantization gated behind Flash Attention exactly as `args.rs` enforces.
 Default stays `f16` (no behavioural change unless the user opts in). **This
 reverses the upstream-specific clause of the earlier "clear KV overrides →
 native `f16`" migration** — the goal is the same native `f16` default, now via
 an explicit, user-overridable dropdown rather than a hidden cleared setting.
 Existing users who already ran v4 (`llamacpp_upstream_kv_cache_cleared_v1`
 set) get the new dropdown automatically once `registerSettings` re-merges the
 keys on the next load. **Scope:** extension only (1 settings file + 2 removed
 call sites + comment) — **no Rust, IPC, guest-js, on-disk, or web-app TSX
 change** (the generic `DynamicControllerSetting` renders the dropdown purely
 from `settings.json`). **Verified:** `settings.json` parses, both entries
 present with `f16` default + standard-only options; `ReadLints` clean on both
 edited files; the `migrateKvCacheDefaults` method (and its tests) is
 byte-unchanged. `tsc`/`rolldown`/`vitest` standalone runs in the sandbox
 resolve to the root workspace config (pre-existing, unrelated `@janhq/web-app`
 `interface.test.tsx` failures) and are not authoritative for these scoped
 edits. **Caveat:** the extension must be rebuilt (`build:extensions`) so the
 new `settings.json` is embedded into the compile-time `SETTINGS` constant.
- **Owner:** team.
- **Links:** §4.2 *LLM backend*, the 2026-06-04 ADR *Recover from unsupported
 multimodal projector …* and the 2026-06-08 ADR *Add Gemma 4 MTP speculative
 decoding to `llamacpp-upstream` …* (KV-quant + MTP warning), files:
 [`extensions/llamacpp-upstream-extension/settings.json`](extensions/llamacpp-upstream-extension/settings.json),
 [`extensions/llamacpp-upstream-extension/src/index.ts`](extensions/llamacpp-upstream-extension/src/index.ts)
 (`onLoad` migration block),
 [`src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/args.rs`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/args.rs)
 (`--cache-type-k/-v`, `sanitize_cache_type`).

### 2026-06-11 — Add pause/resume for model downloads in the global Download popover (ATO-154)
- **Context:** Community request (Discord, @m.iko) — parity with Jan.ai. The
  global Download popover ([`DownloadManegement.tsx`](web-app/src/containers/DownloadManegement.tsx))
  only offered **cancel (X)** per download; no pause/resume. The plumbing was
  already half-present: the Rust downloader
  ([`src-tauri/src/core/downloads/helpers.rs`](src-tauri/src/core/downloads/helpers.rs))
  **keeps the partial file on cancel** (`keep_partial_on_cancel = true`) and
  **resumes** from the `.tmp` + saved-`url` match (`_get_maybe_resume`, `resume`
  flag); `download_files`/`cancel_download_task` and `pullModelWithMetadata(…,
  resume)` already thread `resume`; and the store
  ([`useDownloadStore`](web-app/src/hooks/useDownloadStore.ts)) had
  `resumableDownloads` + `markResumableDownload`/`clearResumableDownload`. But
  "resumable" was only used for retry/error toasts and Hub-card re-clicks — no
  pause/resume control was surfaced in the popover, and the popover had no way
  to resume because it only knows the model id, not the HF paths/token.
- **Decision:** Ship Jan-parity pause/resume, **gated to resumable GGUF model
  downloads only** (the team chose parity over extending it to backend
  binaries). The gate is `!id.startsWith('llamacpp') && !id.startsWith('mlx')`,
  identical to Jan — which conveniently also excludes **MLX model repos**
  (`mlx-community/*` starts with `mlx`, and MLX downloads go through
  `engine.import` directly, not `pullModelWithMetadata`) and **backend-binary
  downloads** (`llamacpp*`). So pause/resume covers exactly the
  `pullModelWithMetadata` (llama.cpp GGUF) path; MLX + binaries keep cancel-only.
  1. **Store** ([`useDownloadStore.ts`](web-app/src/hooks/useDownloadStore.ts)):
     new `pausedDownloads: Set<string>` (+ `markPausedDownload` /
     `clearPausedDownload`) and `resumeParams: { [id]: DownloadResumeParams }`
     (+ `setResumeParams` / `clearResumeParams`), where `DownloadResumeParams =
     { modelPath, mmprojPath?, hfToken?, skipVerification? }`.
  2. **Resume-param capture at the single GGUF choke point**
     ([`services/models/default.ts :: pullModelWithMetadata`](web-app/src/services/models/default.ts)):
     `setResumeParams(id, …)` right beside the existing `markDownloadStart`
     telemetry anchor — so **every** initiator (Hub, onboarding, prompts,
     claude-code) populates resume params without touching ~7 call sites.
  3. **Swallow-on-paused** (same method): if
     `useDownloadStore.getState().pausedDownloads.has(id)` in the catch, return
     instead of emitting `onFileDownloadError` / rethrowing — so a paused
     download (which rejects the in-flight import with a cancellation error)
     does **not** trigger the initiator's "download failed" toast or row
     cleanup. Read from `getState()` (not a React closure) to avoid racing the
     async stop event.
  4. **Popover** ([`DownloadManegement.tsx`](web-app/src/containers/DownloadManegement.tsx)):
     per-row Pause (`IconPlayerPause`) / Resume (`IconPlayerPlay`) buttons shown
     only when `isPausableDownload(id)`; `handlePauseDownload` =
     `markPausedDownload` + `markResumableDownload` + `abortDownload`;
     `handleResumeDownload` = read `resumeParams[id]`, `clearPausedDownload`,
     `pullModelWithMetadata(…, resume=true)` (falls back to a cancel-style
     cleanup + toast if params are missing, e.g. after an app restart).
     `onFileDownloadStopped` early-returns (keeping the `downloads[id]` row +
     last progress) when the store says paused; all true-terminal handlers
     (success / verification-success / validation-failed / error) and the X
     button now also `clearPausedDownload` + `clearResumeParams`.
  5. **i18n:** `pauseDownload` / `resumeDownload` added to
     [`en/common.json`](web-app/src/locales/en/common.json) +
     [`ru/common.json`](web-app/src/locales/ru/common.json) (other locales fall
     back to EN); the X title now uses the existing `cancelDownload` key.
- **Consequences:** Resumable GGUF downloads can be paused and resumed from the
  popover; the partial file on disk means resume continues from where it
  stopped. MLX (`mlx-community/*`) and backend binaries stay cancel-only —
  accepted per the chosen Jan parity. **Scope:** web-app only (store + service +
  popover + 2 locales); no Rust, IPC, on-disk layout, or settings-schema change
  — the Rust resume support already existed. **Caveat:** resume params are
  in-memory (cleared on app restart / cleared localStorage); a paused download
  resumed after a restart hits the missing-params fallback (cancel-style toast)
  rather than continuing — acceptable, the partial file is still reusable via a
  fresh Hub-card download (which already passes `resume`). **Verified:**
  `tsc -b` clean; `eslint` clean on all three edited TS/TSX files;
  `useDownloadStore.test.ts` 18/18. The `models.test.ts` failures are
  **pre-existing** (`fetchHuggingFaceRepo` headers + `pullModel` resume arg;
  `pullModelWithMetadata` is not referenced by that suite) and unrelated.
- **Owner:** team.
- **Links:** [ATO-154](https://linear.app/atomicchat/issue/ATO-154), files:
  [`web-app/src/hooks/useDownloadStore.ts`](web-app/src/hooks/useDownloadStore.ts),
  [`web-app/src/services/models/default.ts`](web-app/src/services/models/default.ts)
  (`pullModelWithMetadata`),
  [`web-app/src/containers/DownloadManegement.tsx`](web-app/src/containers/DownloadManegement.tsx),
  [`web-app/src/locales/en/common.json`](web-app/src/locales/en/common.json),
  [`web-app/src/locales/ru/common.json`](web-app/src/locales/ru/common.json),
  Rust resume support in
  [`src-tauri/src/core/downloads/helpers.rs`](src-tauri/src/core/downloads/helpers.rs).

### 2026-06-11 — Add a unified "Sampling — {assistant}" popover (assistant switcher + sampling params in one place) (ATO-155)
- **Context:** Community request (Discord, @m.iko) for Jan.ai parity
  ([ATO-155](https://linear.app/atomicchat/issue/ATO-155)). In Atomic the
  surface was scattered: assistant selection was an inline **"Use Assistant"**
  submenu in [`ChatInput.tsx`](web-app/src/containers/ChatInput.tsx); sampling
  params had **no** dedicated UI (the gear-Sheet
  [`ModelSetting.tsx`](web-app/src/containers/ModelSetting.tsx) edits backend
  `model.settings` — `ctx_len`/`ngl`/… — not sampling); per-assistant params
  were only a generic key/value list in
  [`dialogs/AddEditAssistant.tsx`](web-app/src/containers/dialogs/AddEditAssistant.tsx).
  Confirmed data flow: sampling params are read from
  `useAssistant.getState().currentAssistant?.parameters` in
  [`custom-chat-transport.ts`](web-app/src/lib/custom-chat-transport.ts) and, for
  **local** backends, the whole `parameters` bag is injected verbatim into the
  request body (`{ ...body, ...parameters }` in
  [`model-factory.ts`](web-app/src/lib/model-factory.ts)); cloud providers strip
  local-only keys. `currentAssistant` is synced from the thread's first
  assistant on thread load ([`routes/threads/$threadId.tsx`](web-app/src/routes/threads/$threadId.tsx)).
- **Decision:** Build a single **`SamplerPopover`** trigger "Sampling —
  {assistant}" in the chat-input toolbar, with the assistant switcher in its
  header and sampling params in its body, writing into the assistant's
  `parameters`. Per the issue's approved scope (full Jan parity + **replace** the
  old submenu):
  1. **Schema** — rewrote
     [`web-app/src/lib/predefinedParams.ts`](web-app/src/lib/predefinedParams.ts):
     `paramsSettings` gains `controllerType` / `category` / `min` / `max` /
     `step` (backward-compatible — old consumers only read `key`/`value`/`title`);
     added `min_p` + `repeat_penalty`; new `paramCategories`, `paramGroups`
     (sampling / penalties / general), and `SAMPLING_PARAM_KEYS`. Keys map 1:1
     onto the OpenAI-compatible body keys local backends accept (the body-inject
     reality), so the popover is genuinely effective on llamacpp/llamacpp-upstream/mlx.
  2. **UI** — new
     [`ParametersSection.tsx`](web-app/src/containers/ParametersSection.tsx)
     (slider + number input per numeric param, switch for `stream`, grouped by
     category) and
     [`SamplerPopover.tsx`](web-app/src/containers/SamplerPopover.tsx) (trigger,
     header assistant dropdown, body = ParametersSection).
  3. **Persistence sync** — the popover edits the **effective** assistant
     (unsaved-chat `selectedAssistant` → thread-bound assistant → default →
     first). On a param change it calls `updateAssistant` (persists globally +
     keeps `currentAssistant` in sync so the transport picks it up immediately),
     and **only** when the assistant is bound to the current thread also calls
     `updateCurrentThreadAssistant` (avoids implicitly binding the default to a
     thread); if it's the unsaved-chat selection it mirrors back via the
     `onSelectAssistant` prop. Assistant switching reuses the old submenu logic.
  4. **ChatInput** — removed the "Use Assistant" submenu block and its now-orphan
     imports (`DropdownMenuSub*`, `IconUser`, `AvatarEmoji`) and store selectors
     (`currentThread`, `updateCurrentThreadAssistant`); rendered `<SamplerPopover>`
     in the toolbar next to `<ReasoningToggle />`, gated `!effectiveAgentMode &&
     !projectId`.
  5. **i18n** — `none` / `noAssistants` / `samplingTrigger` / `paramCategory.*`
     in [`en/assistants.json`](web-app/src/locales/en/assistants.json) +
     [`ru/assistants.json`](web-app/src/locales/ru/assistants.json); other locales
     fall back to EN.
- **Consequences:** Assistant choice + explicit sampling controls
  (temperature / top_p / top_k / min_p / penalties / repeat_penalty / stream) now
  live in one popover bound to the selected assistant; the old inline submenu is
  gone. **Caveat (unchanged, pre-existing):** sampling params reach **local**
  backends only — cloud providers still receive only the reasoning override (the
  transport strips local-only keys), so editing e.g. temperature for an OpenAI
  model is a no-op today; not addressed here. `max_output_tokens` /
  `max_context_tokens` / `auto_compact` were **deliberately not** re-added to the
  schema (they were trimmed from the Atomic `predefinedParams.ts` earlier and are
  consumed by separate transport logic, not body-injected). Scope: web-app only
  (1 rewritten lib + 2 new containers + ChatInput edit + 2 locale files); no Rust,
  IPC, schema, or persistence-shape change. **Verified:** `eslint` 0 errors on all
  four touched TS/TSX files (one pre-existing `exhaustive-deps` warning on the
  unrelated `processImageFiles` untouched); `tsc -b` clean ("No errors found");
  `ReadLints` clean.
- **Amendment (same day) — relocate the trigger into the model bar and soften
  the popover chrome.** Per UX feedback (the chat-input toolbar placement felt
  cramped, opened upward, and the controls looked bulky / too high-contrast), the
  `SamplerPopover` trigger was **moved out of `ChatInput`'s toolbar into the model
  bar** ([`DropdownModelProvider.tsx`](web-app/src/containers/DropdownModelProvider.tsx)),
  rendered inside the model pill to the right of the `ModelSupportStatus` dot,
  wrapped in a `stopPropagation` container so it doesn't open the model dropdown
  (same pattern as the inline `ModelSetting` gear). Because the trigger no longer
  lives next to `ChatInput`'s local `selectedAssistant` state, that unsaved-chat
  selection was **lifted into the `useAssistant` store** as `pendingAssistant` /
  `setPendingAssistant` ([`useAssistant.ts`](web-app/src/hooks/useAssistant.ts));
  `ChatInput` now reads/writes the store (and falls back to default → first
  assistant when binding a brand-new thread, preserving the old seed behaviour),
  and `SamplerPopover` reads the same store directly (its `selectedAssistant` /
  `onSelectAssistant` props were dropped). A new `showSampler` prop on
  `DropdownModelProvider` (default `true`) reproduces the old `!projectId` guard —
  the **project** route passes `showSampler={false}`. The old
  `!effectiveAgentMode` guard is **dropped** (the model bar has no per-thread
  agent-mode context; sampling controls now also show in agent-mode threads,
  judged acceptable). Styling: the per-param bordered number box (`Input` with
  `border` + `dark:bg-input/30` — the "harsh black") became a borderless,
  muted, `tabular-nums` value field; spacing tightened (`space-y-5/3` →
  `space-y-3/2`); category labels softened (`text-[11px] text-muted-foreground/70`);
  and the popover surface mirrors the model dropdown (`bg-background/95
  backdrop-blur-2xl p-3`) instead of the stark `bg-popover p-4`. Now at the top
  of the window, the popover opens downward into ample space (the earlier
  upward-open / overflow issues were a bottom-of-screen artefact). **Verified:**
  `tsc -b` clean (exit 0); `ReadLints` clean on all touched files.
- **Owner:** team.
- **Links:** [ATO-155](https://linear.app/atomicchat/issue/ATO-155), files:
  [`web-app/src/lib/predefinedParams.ts`](web-app/src/lib/predefinedParams.ts),
  [`web-app/src/containers/ParametersSection.tsx`](web-app/src/containers/ParametersSection.tsx),
  [`web-app/src/containers/SamplerPopover.tsx`](web-app/src/containers/SamplerPopover.tsx),
  [`web-app/src/containers/DropdownModelProvider.tsx`](web-app/src/containers/DropdownModelProvider.tsx),
  [`web-app/src/hooks/useAssistant.ts`](web-app/src/hooks/useAssistant.ts),
  [`web-app/src/containers/ChatInput.tsx`](web-app/src/containers/ChatInput.tsx),
  [`web-app/src/routes/project/$projectId.tsx`](web-app/src/routes/project/$projectId.tsx),
  [`web-app/src/locales/en/assistants.json`](web-app/src/locales/en/assistants.json),
  [`web-app/src/locales/ru/assistants.json`](web-app/src/locales/ru/assistants.json).

### 2026-06-10 — Add Pi, Goose, OpenHands, and KiloCode as one-click Launch-page coding agents
- **Context:** The Launch page lets users one-click install + configure external
  coding agents against the local OpenAI-compatible server (port 1337). Four
  more real CLIs were requested and verified on-machine: Pi, Goose, OpenHands,
  and KiloCode — all `kind: "coding"`.
- **Decision:** Mirror the existing integration pattern exactly. Added four
  entries to `INTEGRATION_AGENTS`
  ([`web-app/src/constants/integrations.ts`](web-app/src/constants/integrations.ts)),
  an `AgentIcon` case per brand using official SVG logos self-hosted under
  [`web-app/public/images/integrations/`](web-app/public/images/integrations/)
  (`pi.svg`, `goose.svg`, `openhands.svg`, `kilo.svg`), a `configureAgent` case
  per id, and per-agent terminal commands in `handleRun`
  ([`web-app/src/routes/launch/index.tsx`](web-app/src/routes/launch/index.tsx)).
  Backend ([`src-tauri/src/core/system/commands.rs`](src-tauri/src/core/system/commands.rs)):
  install specs in `agent_install_spec` (Pi/Kilo = global npm; OpenHands =
  `uv tool install openhands --python 3.12`; Goose = dual-OS shell/PowerShell
  bootstrap like Hermes) and four `configure_*` commands registered in both
  `generate_handler!` lists ([`src-tauri/src/lib.rs`](src-tauri/src/lib.rs)).
  - **Pi** (`configure_pi`): strict-JSON merge of `~/.pi/agent/models.json`
    (upsert `providers.atomic`) and `settings.json` (`defaultProvider`/
    `defaultModel`); `endpointWithPrefix` true. Terminal: `pi`.
  - **Goose** (`configure_goose`): env-var agent via `write_marked_env_to_shell`
    / `setx` (marker `# Atomic Chat - Goose Config`, prefix `GOOSE_`):
    `GOOSE_PROVIDER=openai`, `GOOSE_MODEL`, `OPENAI_HOST` (bare host:port —
    `endpointWithPrefix` false), `OPENAI_BASE_PATH=v1/chat/completions`,
    `OPENAI_API_KEY`. Terminal: `goose session`.
  - **OpenHands** (`configure_openhands`): env-var agent (marker
    `# Atomic Chat - OpenHands Config`, prefix `LLM_`): `LLM_MODEL=openai/<model>`
    (litellm prefix required), `LLM_BASE_URL` (`/v1`), `LLM_API_KEY`. Read only
    with `--override-with-envs`. Terminal: `openhands --override-with-envs`.
  - **KiloCode** (`configure_kilo`): json5 parse + strict-JSON re-serialize of
    `~/.config/kilo/kilo.jsonc`; upsert `provider.atomic`
    (`@ai-sdk/openai-compatible`, `baseURL` `/v1`), set `model` to
    `atomic/<model>`; `endpointWithPrefix` true. Terminal: `kilo`.
- **Consequences:** Four more agents installable + configurable in one click.
  All `configure_*` functions preserve unrelated user content and return an
  actionable parse error (never clobber) on a malformed existing file. No new
  analytics (the generic `agent_run` capture keys on id). Icons are the agents'
  official SVG logos, self-hosted under `web-app/public/images/integrations/`
  (fetched once, not hot-linked). Watch: upstream package names / install paths
  may drift.
- **Owner:** team.
- **Links:** branch `feat/launch-agents-pi-goose-openhands-kilo`.

### 2026-06-10 — Add the LiquidAI (LFM) family logo to the Hub model-logo system + render monochrome brand marks via a theme-safe CSS mask (ATO-138)
- **Context:** In Hub model search, LFM models (LiquidAI's *Liquid Foundation
  Models*) showed letter placeholders instead of a brand icon — e.g.
  `LFM2.5-8B-A1B-GGUF` by Unsloth → `U`, by LiquidAI → `L`,
  `LFM2-24B-A2B-MLX-{4,5,6}bit` by Lmstudio-Community → `L`
  ([ATO-138](https://linear.app/atomicchat/issue/ATO-138), v1.1.106). Root
  cause: the family-logo registry in
  [`web-app/src/lib/model-logo.ts`](web-app/src/lib/model-logo.ts) only
  recognized deepseek / gemma / qwen / llama / mistral; LFM matched nothing, so
  [`ModelLogo`](web-app/src/containers/ModelLogo.tsx) fell back to the first
  letter of the author. The same-family models showed *different* letters
  because the fallback keys on the quantizer (Unsloth / LiquidAI /
  Lmstudio-Community), not the family. The system matches on the model **name
  family** by design (so a community repack still shows the brand mark), exactly
  per the issue's "show family logo, keep letter only as fallback".
- **Decision:** Extend the existing local-asset family-logo mechanism (no remote
  avatar fetch — that constraint is preserved). Two facets:
  1. **Asset + rule.** Bundle the official LiquidAI brand mark (from
     `@lobehub/icons`, the same set the other `*-color.svg` logos follow) at
     [`web-app/public/svg/liquid.svg`](web-app/public/svg/liquid.svg) and add a
     `/lfm/i → /svg/liquid.svg` rule to `FAMILY_LOGO_RULES`.
  2. **Theme-safe monochrome render.** The Liquid mark is single-color
     (`fill="currentColor"`, brand black); painted as a plain `<img>` it would
     be near-invisible on the dark-theme tile (`dark:bg-input/30`). So
     `model-logo.ts` now also exports `isMonochromeFamilyLogo(src)` (backed by a
     `MONOCHROME_FAMILY_LOGOS` set), and `ModelLogo` renders such marks through a
     CSS `mask-image` span tinted with `currentColor` (`text-foreground`) — so
     they inherit a theme-aware color, mirroring the letter they replace. Colored
     marks keep the existing `<img>` path (with its `onError` letter fallback).
     `modelFamilyLogoSrc` keeps its `string | null` signature, so the other
     consumer ([`SetupScreen.tsx`](web-app/src/containers/SetupScreen.tsx),
     curated recs only — never LFM) is untouched.
- **Consequences:** LFM models now show the LiquidAI mark regardless of who
  quantized them; the letter remains the genuine fallback when no family logo
  matches. Adding future monochrome brands is a two-line change (drop the SVG,
  add it to the rules + the mono set); colored brands need only a rule. Scope:
  web-app only (one new asset + two edited files); no Rust, IPC, schema, or
  persistence change, and no remote fetch. Lint-clean on both edited files.
- **Owner:** team.
- **Links:** [ATO-138](https://linear.app/atomicchat/issue/ATO-138),
  [@lobehub/icons](https://github.com/lobehub/lobe-icons) (Liquid mark source),
  files: [`web-app/public/svg/liquid.svg`](web-app/public/svg/liquid.svg),
  [`web-app/src/lib/model-logo.ts`](web-app/src/lib/model-logo.ts)
  (`FAMILY_LOGO_RULES`, `isMonochromeFamilyLogo`),
  [`web-app/src/containers/ModelLogo.tsx`](web-app/src/containers/ModelLogo.tsx)
  (mono CSS-mask render path).

### 2026-06-10 — Throttle crashloop `model_load` failure spam client-side; confirm `model_load.status` / api 404-noise are already-fixed-pending-rollout, not code bugs (ATO-130: ATO-133 + ATO-131 + ATO-132)
- **Context:** Epic [ATO-130](https://linear.app/atomicchat/issue/ATO-130)
 reported three data-quality defects in the new PostHog telemetry (the
 `model_load` / hardware super-prop / `api_server_request` work from the
 2026-06-09 ADRs *Extend the PostHog telemetry channel …* / ATO-108):
 (1) [ATO-131](https://linear.app/atomicchat/issue/ATO-131) `model_load.status`
 always `None` (19 788 events / 72 devices over 14d); (2)
 [ATO-132](https://linear.app/atomicchat/issue/ATO-132) `api_server_request`
 404-noise not removed (~202k `not_found`) + new `error_kind`s nearly empty;
 (3) [ATO-133](https://linear.app/atomicchat/issue/ATO-133) crashloop devices
 spamming thousands of `model_load` events (top: 4504 / 3700 / 3458 / 1517 /
 1062). Investigation correlated the queries (run 2026-06-10) against the
 release timeline: **the new telemetry first shipped in `v1.1.105`
 (2026-06-09 ~17:52 MSK) and `v1.1.106` (18:27)** — i.e. < 1 day before the
 14-day-window queries, with rollout barely started (~87 / 2502 devices carry
 `gpu_vendor`). Code audit at HEAD:
 - **ATO-132 is already fixed in code.** [`proxy.rs`](src-tauri/src/core/server/proxy.rs)
 sets `skip_emit = true` on the catch-all 404 (the `_ =>` arm) and on
 `GET /v1/models` polling, and splits `upstream` into
 `local_model_error` / `remote_provider_error` / `local_model_unreachable` /
 `proxy_internal` / `server_bind_failed` via `upstream_error_kind` /
 `unreachable_error_kind`. The 202k `not_found` + empty new kinds are the
 **pre-`v1.1.105` population**; this self-resolves as `v1.1.106` rolls out. No
 code change.
 - **ATO-131 is not a code defect.** The sole emitter
 ([`switchModel.ts::emitModelLoad`](web-app/src/utils/switchModel.ts), added
 in `df7cc39d3`, in `v1.1.105`) sets `status: 'success' | 'failed'` in the
 captured props; the PostHog `sanitize_properties` denylist in
 [`AnalyticProvider.tsx`](web-app/src/providers/AnalyticProvider.tsx) does
 **not** contain `status`; other props from the same `capture` call (model_id
 etc.) arrive fine, ruling out an init/instance problem; and PostHog does not
 reserve a top-level event property named `status`. No code defect was
 identifiable from static analysis — fabricating a "fix" was rejected.
 Recommended resolution is a filtered re-query (`app_version >= 1.1.105`,
 tight window) to confirm whether it is a dirty-window artifact or a
 PostHog-side ingestion/materialization quirk; renaming `status` →
 `load_status` was rejected because it would break the existing dashboards
 that GROUP BY `properties.status`.
- **Decision:** Implement only the one defect that genuinely needs code —
 ATO-133. Add a client-side throttle for **repeated identical `model_load`
 failures**, following the existing dedup-helper pattern in
 [`lib/telemetry.ts`](web-app/src/lib/telemetry.ts) (`finalizeDownloadOnce`,
 the download-dedup trio): new `shouldEmitModelLoadFailure(modelId, errorCode)`
 keyed on `${modelId}::${errorCode ?? 'unknown'}`, suppressing duplicates
 within a 5-minute window (`MODEL_LOAD_FAILURE_THROTTLE_MS`, Map capped at 500
 keys). `emitModelLoad` computes `error_code` up front and returns early when
 the throttle says skip; **successes are never throttled** (they are not the
 spam source and are individually valuable). This is the ticket's option (a)
 ("don't send the same fail more than once per N minutes per device"); the
 attempt-counter alternative was deliberately not taken (pure throttle is
 minimal and the dashboards are already device-weighted, so losing per-burst
 magnitude is acceptable).
- **Consequences:**
 - A device stuck in a load crashloop now emits at most one `model_load`
 failure per (model, error_code) per 5 min instead of one per retry, so
 event-weighted metrics stop being dominated by a handful of stuck machines.
 The throttle is per-process in-memory (resets on app restart), which is fine
 — it targets tight retry loops, not cross-session dedup.
 - **Lossy by design:** exact retry counts within a window are not preserved
 (accepted per ticket). The underlying *product* bug — why those machines
 loop — is **not** addressed here (separate investigation noted on ATO-133).
 - **ATO-131 / ATO-132 ship no code** from this session: ATO-132 awaits
 rollout; ATO-131 awaits a filtered re-query to decide if any action is even
 warranted. Scope: web-app only (two files), no Rust / IPC / schema / on-disk
 change. Lint-clean on both edited files.
- **Owner:** team.
- **Links:** [ATO-130](https://linear.app/atomicchat/issue/ATO-130),
 [ATO-131](https://linear.app/atomicchat/issue/ATO-131),
 [ATO-132](https://linear.app/atomicchat/issue/ATO-132),
 [ATO-133](https://linear.app/atomicchat/issue/ATO-133),
 [ATO-112](https://linear.app/atomicchat/issue/ATO-112), the 2026-06-09 ADRs
 *Extend the PostHog telemetry channel …* and *Add zero-PII Sentry …*, files:
 [`web-app/src/lib/telemetry.ts`](web-app/src/lib/telemetry.ts)
 (`shouldEmitModelLoadFailure`),
 [`web-app/src/utils/switchModel.ts`](web-app/src/utils/switchModel.ts)
 (`emitModelLoad`).

### 2026-06-10 — Fix the two real model-load bugs under the Sentry retry-loop noise: resolve the `latest/<backend>` sentinel before load (ATO-124) + reactive MTP-disable fallback (ATO-125)
- **Context:** First Sentry triage of `atomic-chat-desktop` ([ATO-123](https://linear.app/atomicchat/issue/ATO-123))
 showed ~18k events in ~13h, ~90% a single backoff-less retry-loop, hiding two
 real load bugs. **ATO-124 (Urgent):** `version_backend.includes('/')` was used
 as the "backend resolved" predicate, but the sentinel `latest/<backend>` also
 contains `/` and passed it, so the load path started on an unresolved sentinel
 → `ensureBackendReady('latest')` → `downloadAndInstallBackend` throws on the
 `version === 'latest'` guard (ATO-95) → web-app auto-restarts → tight loop
 (Sentry `ATOMIC-CHAT-DESKTOP-1` win-cpu ~10.4k, `-5` linux-cpu ~6.5k; ~74% of
 90d events). **ATO-125 (Medium):** the else-branch that zeroed `mtp_draft_path`
 left `cfg.mtp = true` for a model with no MTP layers/head (Gemma 4 E4B) →
 `llama-server` aborts `context type MTP requested but model doesn't contain MTP
 layers`.
- **Decision:** Apply both fixes to the `llamacpp-upstream` extension (the
 default/Windows+Linux provider). Crucially, **the ATO-125 preventive crash is
 already fixed in the working tree** by the same-day ATO-122 load-time MTP
 capability gate (`performLoad`, ~3268 — keeps `mtp` only for a Qwen built-in
 MTP id or a resolved Gemma draft, else `cfg.mtp = false`), which is *stronger*
 than ATO-125's optional preventive snippet (that snippet would wrongly disable
 a Qwen built-in MTP model with no draft path). So ATO-125 here is implemented
 only as the **reactive fallback** (variant A), as defense-in-depth, not a
 duplicate preventive guard.
 1. Two pure helpers in
 [`util.ts`](extensions/llamacpp-upstream-extension/src/util.ts):
 `isConcreteVersionBackend(vb)` (BOM/whitespace-stripped; rejects empty /
 `none` / no-slash / `latest/…` sentinel) and `matchesMtpLoadFailure(text)`
 (matches the three MTP-rejection stderr phrasings, case-insensitive,
 apostrophe-optional).
 2. **ATO-124** in [`index.ts`](extensions/llamacpp-upstream-extension/src/index.ts):
 `configureBackends` (~737, apply bundled backend over a sentinel) and `load`
 (~3075, wait for `configureBackends` when not yet concrete) now use
 `isConcreteVersionBackend`; plus a defense-in-depth resolve at the top of
 `performLoad` (before the `version_backend.split('/')`) that turns a leftover
 `latest/<backend>` into a concrete `<tag>/<backend>` via
 `resolveLatestBackendString` → `newestInstalledOfFamily`, **persisting** it to
 `this.config` so subsequent loads short-circuit (and warns when both resolvers
 return null — the accepted residual offline gap).
 3. **ATO-125** in `index.ts`: a one-shot retry inside `performLoad`'s `catch`
 (after the mmproj text-only retry, before the final `logger.error`) — if
 `cfg.mtp` and the error matches `matchesMtpLoadFailure`, retry once with
 `cfg.mtp=false`/`mtp_draft_path=''`.
- **Consequences:** The sentinel can no longer reach the download guard, killing
 the dominant retry-loop at the source for every load entry point; MTP loads
 degrade gracefully even if a future model slips past the ATO-122 gate. Scope:
 web-app extension only (one Rust-free TS module + the extension entry); macOS
 turboquant `llamacpp` and MLX unaffected. **Verified:** `ReadLints` clean on
 all three files; `util.test.ts` 38/38 (21 new — 13 `isConcreteVersionBackend`
 + 8 `matchesMtpLoadFailure`); rolldown build clean (`dist/index.js` 205 kB).
 The 14 other failures in the extension suite are **pre-existing** — proven by a
 stash-baseline run on HEAD showing the identical `index.test.ts`(9) /
 `backend.test.ts`(4) / `autoIncreaseCtx.test.ts`(1) failures (env/network in
 the sandbox), unchanged by this diff (66→87 passing = exactly +21). **Not
 done:** ATO-126/127/128 (Sentry hygiene: backoff+dedup, noise downgrade,
 `setUser`) are separate hygiene tickets; changes not committed/pushed (await
 review).
- **Owner:** team.
- **Links:** [ATO-123](https://linear.app/atomicchat/issue/ATO-123),
 [ATO-124](https://linear.app/atomicchat/issue/ATO-124),
 [ATO-125](https://linear.app/atomicchat/issue/ATO-125),
 [ATO-95](https://linear.app/atomicchat/issue/ATO-95), the 2026-06-10 ADR *Gate
 the global `mtp` flag …* (ATO-122) and the 2026-06-05 ADRs *Resolve the
 `latest/<backend>` sentinel …* / *Make the Windows release backend download
 asset-aware …*, files:
 [`util.ts`](extensions/llamacpp-upstream-extension/src/util.ts),
 [`index.ts`](extensions/llamacpp-upstream-extension/src/index.ts),
 [`util.test.ts`](extensions/llamacpp-upstream-extension/src/util.test.ts).

### 2026-06-10 — Gate the global `mtp` flag on per-model capability at load time so non-MTP models can't be bricked by a stale toggle (ATO-122)
- **Context:** The `llamacpp-upstream` **MTP (multi-token prediction)** toggle is
 a **provider-global** setting (`mtp` in the extension's localStorage → loaded
 into `this.config`), not bound to a model and never reset on model switch
 (unlike MLX, which resets `mtp_enabled`/`dflash_enabled`/`eagle3_enabled` when
 the active MLX model changes). So enabling MTP on a capable target (e.g. a
 Qwen built-in-MTP GGUF) and then loading a model **without** MTP layers (e.g.
 the **Recommended** `gemma-4-12b-it-IQ4_XS`) left `cfg.mtp === true`, and the
 Rust arg builder [`add_mtp_args`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/args.rs)
 gated **only** on `config.mtp` + build number — never on whether the GGUF is
 MTP-capable. With an empty `mtp_draft_path` it emitted the Qwen-style
 `--spec-type draft-mtp` (the model as its own draft context), and
 `llama-server` (upstream `b9562`) aborted the whole load:
 `context type MTP requested but model doesn't contain MTP layers` →
 `failed to create MTP context` → exit. The user saw a generic
 "Failed to load the model" and blamed themselves (Discord `ez5554`, Mac Studio
 M4 Max, v1.1.104). Repro: enable MTP on Qwen → switch to Gemma-4-12B → Start →
 crash. The same Gemma loads fine the moment MTP is toggled off. The crash is a
 **first-run hazard** because Gemma-4-12B is Recommended.
- **Decision:** Implement the ticket's **graceful-fallback** option (option 3 of
 "any of"), at the lowest common load layer rather than only the UI toggle. A
 new capability gate in
 [`performLoad`](extensions/llamacpp-upstream-extension/src/index.ts) (right
 after Gemma draft-head resolution, before building Rust args): when `cfg.mtp`
 is on, keep it on **only** if the target genuinely supports MTP — either a
 **Qwen-style built-in MTP** GGUF (`modelId.toLowerCase().includes('mtp')`,
 mirroring the UI's own heuristic in
 [`$providerName.tsx`](web-app/src/routes/settings/providers/$providerName.tsx))
 **or** a **Gemma 4** target whose separate draft head resolved to a non-empty
 `cfg.mtp_draft_path` above. Otherwise set `cfg.mtp = false` and `logger.warn`,
 so the model loads cleanly without MTP. The gate sits in TS (not Rust) because
 Rust cannot distinguish a Qwen built-in-MTP model from a plain GGUF — both
 carry no draft path; only the extension knows the model id / Gemma registry.
- **Consequences:**
 - **The reported crash is gone for every load entry point** (chat model
 switch, onboarding, API), not just the settings toggle. The Recommended
 Gemma 4 model can no longer be bricked by a stale global MTP flag.
 - **Emergent per-model behaviour without per-model state.** The provider
 toggle stays in localStorage (still globally "on"); MTP now silently
 *follows capability* — active for Qwen/Gemma MTP targets, dropped for
 everything else, re-activating automatically when an MTP-capable model is
 loaded again. This satisfies the spirit of option 1 (per-model) with a
 one-block change and no schema/UI migration.
 - **Deliberately did NOT** (a) move `mtp` into `model.yml` / `model.settings`
 (larger UI + persistence change, unnecessary given the gate), or (b) add an
 upstream model-change reset effect mirroring MLX (the load-time gate is
 strictly more robust — it also covers loads triggered outside the settings
 screen). The UI capability check in `handleToggleLlamacppMtp` (which only
 runs when a model is already loaded) is left as-is; the gate backstops it.
 - **Caveat:** the toggle UI can still read "on" while a non-MTP model is
 loaded — accepted per the ticket (graceful fallback is an explicitly
 acceptable resolution). Related to [ATO-121](https://linear.app/atomicchat/issue/ATO-121)
 (surface a clear engine-incompatibility error), which is a separate ticket.
 - Scope: one TS block in the upstream extension; no Rust, IPC, on-disk layout,
 or settings-schema change. macOS turboquant `llamacpp` provider has no MTP
 toggle and is unaffected; MLX is unaffected. Lint-clean on the edited file.
- **Owner:** team.
- **Links:** [ATO-122](https://linear.app/atomicchat/issue/ATO-122),
 [ATO-121](https://linear.app/atomicchat/issue/ATO-121), §4.2 *LLM backend*,
 the 2026-06-08 ADR *Add Gemma 4 MTP speculative decoding to `llamacpp-upstream`
 via a separate draft head …*, files:
 [`extensions/llamacpp-upstream-extension/src/index.ts`](extensions/llamacpp-upstream-extension/src/index.ts)
 (`performLoad` MTP capability gate),
 [`src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/args.rs`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/args.rs)
 (`add_mtp_args`),
 [`web-app/src/routes/settings/providers/$providerName.tsx`](web-app/src/routes/settings/providers/$providerName.tsx)
 (`handleToggleLlamacppMtp`).

### 2026-06-10 — Render inline image (`file`) parts in the chat thread bubble (ATO-120)
- **Context:** Attaching an image to a chat message (model
 `gemma-4-12B-it-4bit`, a vision model; macOS) did **not** render the image in
 the thread — neither in the user bubble nor in history — yet the model
 received and correctly described it. So the image reached the backend; only
 the **UI render path** was broken. Reproduced with both clipboard paste and
 file upload ([ATO-120](https://linear.app/atomicchat/issue/ATO-120)). Root
 cause: after the AI SDK / `UIMessage.parts` migration, images live as
 `type: 'file'` parts (`mediaType` + data-URL `url`) and are forwarded to the
 model via `convertToModelMessages`
 ([`custom-chat-transport.ts`](web-app/src/lib/custom-chat-transport.ts)), but
 the **display** path never handled them:
 [`buildTraceBlocks`](web-app/src/lib/tools/message-trace-parts.ts) only
 emitted `text` / `reasoning` / `tool-*` blocks and silently dropped `file`
 parts, and [`MessageItem`](web-app/src/containers/MessageItem.tsx) only
 rendered those block kinds (image URLs were extracted **only** to feed the
 Edit dialog's thumbnails — proof the data was present). Net effect: text
 bubble shown, image gone; an image-only message rendered as a blank row. The
 `previewImage` full-screen overlay already existed in `MessageItem` but
 `setPreviewImage` was never called (dead code).
- **Decision:** Implement the missing render path (display-only; no change to
 the model/persistence path, which already round-trips images correctly via
 [`messages.ts`](web-app/src/lib/messages.ts) ↔ `ContentType.Image`). Three
 edits:
 1. New `TraceBlock` variant `{ kind: 'file'; key; url; mediaType; filename? }`
 in [`types.ts`](web-app/src/lib/tools/types.ts).
 2. `buildTraceBlocks` now emits a `file` block for any
 `part.type === 'file'` whose `mediaType` starts with `image/` (preserving
 part order; non-image files are still ignored).
 3. `MessageItem` gains `renderFileBlock` (an `<img>` thumbnail, capped
 `max-h-80`, aligned right for user / left for assistant) wired into the
 block switch, and clicking it now drives the **previously-dead**
 `setPreviewImage` overlay for full-screen preview.
- **Consequences:** Attached images render inline in the thread for both fresh
 sends and reloaded history; image-only messages are no longer blank; the
 full-screen image preview is now reachable. Display-only — no Rust, IPC,
 schema, or persistence change; non-image attachments and the document-chip
 (`[ATTACHED_FILES]`) path are untouched. Images render in natural part order
 (text-then-image for user sends) rather than grouped inside the text bubble —
 acceptable and minimal; grouping into a single bubble was deliberately not
 done. Verified: `tsc -b` clean, `eslint` clean on the three touched files.
 **Not done:** preserving images on message edit (`handleEditMessage` still
 strips to text-only) and the orphan `ImageModal` component remain as-is.
- **Owner:** team.
- **Links:** [ATO-120](https://linear.app/atomicchat/issue/ATO-120), files:
 [`web-app/src/lib/tools/types.ts`](web-app/src/lib/tools/types.ts),
 [`web-app/src/lib/tools/message-trace-parts.ts`](web-app/src/lib/tools/message-trace-parts.ts),
 [`web-app/src/containers/MessageItem.tsx`](web-app/src/containers/MessageItem.tsx).

### 2026-06-10 — Default "Launch at startup" to ON for all users (new + existing), one-time seed, still user-disable-able
- **Context:** The ATO-96 autostart feature shipped with the default **OFF**
 (the plugin created no autostart entry unless the user flipped the
 Settings → General toggle; there was deliberately no auto-`enable()` on first
 launch). Product wants autostart **ON by default for everyone** — both fresh
 installs and existing users on update — while preserving the ability to turn
 it off in Settings.
- **Decision:** Add a one-time **seed** at app startup. New localStorage key
 `autostartSeeded` (`'autostart-seeded'`) in
 [`web-app/src/constants/localStorage.ts`](web-app/src/constants/localStorage.ts).
 A new `IS_TAURI`-gated effect in
 [`web-app/src/providers/DataProvider.tsx`](web-app/src/providers/DataProvider.tsx)
 (mounted at app root, runs once on startup) checks the seed flag; if unset it
 calls `enable()` from `@tauri-apps/plugin-autostart` when autostart isn't
 already on, then records the flag. The flag is set **only after** autostart is
 confirmed on (already-enabled or successful `enable()`), so a transient
 failure retries on the next launch, and — critically — once seeded a later
 manual **disable** in Settings is never re-enabled. The existing
 Settings → General toggle ([`general.tsx`](web-app/src/routes/settings/general.tsx))
 still reads the OS as source of truth and is unchanged.
- **Consequences:**
 - Fresh installs and existing users (on the first launch after this ships)
 get autostart turned ON automatically, exactly once. Users who then disable
 it keep it disabled (seed flag already set). Users who had **manually**
 enabled it before are unaffected (seed sees it already on, just records the
 flag).
 - **Reverses the ATO-96 "default OFF / no auto-enable on first launch"
 decision.** Desktop-only (gated by `IS_TAURI`); mobile unaffected. No Rust,
 capability, or schema change — purely a web-app startup seed reusing the
 already-registered `tauri-plugin-autostart`. Lint-clean on both touched files.
 - **Caveat:** the seed is keyed on localStorage, so a factory reset / cleared
 localStorage re-seeds (re-enables) autostart once — acceptable given the new
 default is ON anyway.
- **Owner:** team.
- **Links:** [ATO-96](https://linear.app/atomicchat/issue/ATO-96), the
 2026-06-09 ADR *Add a cross-platform "Launch at startup" toggle …*, files:
 [`web-app/src/providers/DataProvider.tsx`](web-app/src/providers/DataProvider.tsx),
 [`web-app/src/constants/localStorage.ts`](web-app/src/constants/localStorage.ts),
 [`web-app/src/routes/settings/general.tsx`](web-app/src/routes/settings/general.tsx).

### 2026-06-09 — Add zero-PII Sentry crash/error tracking to both the React frontend and the Rust/Tauri desktop, gated behind `productAnalytic` (ATO-113)
- **Context:** The app had no crash/error telemetry — user-facing failures
  (model-load crashes incl. OOM, download failures, context overflow) surfaced
  only as toasts / `console.error`, and Rust panics were lost entirely. There
  was no agent-fixable context (typed `error_code`, hardware tags, release =
  git SHA, symbolicated stacks). [ATO-113](https://linear.app/atomicchat/issue/ATO-113)
  scoped automatic 100%-capture for both runtimes with strict zero-PII, reusing
  the existing `productAnalytic` consent (Sentry SaaS, two projects;
  self-hosted ATO-115 + perf tracing + replay explicitly out of scope).
- **Decision:** Two Sentry SaaS projects (`atomic-chat-frontend` js-react,
  `atomic-chat-desktop` rust), two SDKs, one shared privacy doctrine, one
  git-SHA release id.
  1. **Build-time env (mirrors PostHog).** Frontend `SENTRY_DSN` /
     `SENTRY_ENVIRONMENT` / `SENTRY_RELEASE` injected via `define` in
     [`vite.config.ts`](web-app/vite.config.ts) (declared in
     [`global.d.ts`](web-app/src/types/global.d.ts), mirrored in
     [`vitest.config.ts`](web-app/vitest.config.ts)). Rust reads
     `SENTRY_DSN_DESKTOP` / `SENTRY_RELEASE` / `SENTRY_ENVIRONMENT` via
     `option_env!` (no DSN baked in ⇒ Sentry is a no-op, so local dev stays
     inert). **Dev convenience (amendment 2026-06-09):** because `cargo` does
     not read `.env` and `option_env!` resolves at compile time,
     [`src-tauri/build.rs`](src-tauri/build.rs) now hand-parses a gitignored
     `src-tauri/.env` (no new crate) and emits `cargo:rustc-env` for those three
     keys **only when the var is absent from the ambient environment** — so the
     CI `export` (production path) always wins and the file just fills the gap
     for `yarn dev:tauri`. `**/.env` is already in `.gitignore`.
  2. **Frontend** ([`web-app/src/lib/sentry.ts`](web-app/src/lib/sentry.ts)):
     `@sentry/react` (10.57.0) init early in
     [`main.tsx`](web-app/src/main.tsx) (guarded on `SENTRY_DSN` + `IS_TAURI`,
     `sendDefaultPii:false`, `tracesSampleRate:0`, default integrations so
     `window.onerror`/`unhandledrejection` auto-capture).
     `Sentry.ErrorBoundary` wraps `<RouterProvider>` (fallback = existing
     `GlobalError`); the TanStack `errorComponent` in
     [`__root.tsx`](web-app/src/routes/__root.tsx) also captures.
     **Consent without re-init churn:** `beforeSend`/`beforeBreadcrumb` read
     `useProductAnalytic.getState().productAnalytic` and return `null` when off
     (fail-closed if the store isn't ready). Identity = anonymous device id
     only (`Sentry.setUser({id})`). Explicit `captureHandledError` at the three
     choke points — `reportModelLoadError` ([`switchModel.ts`](web-app/src/utils/switchModel.ts),
     `fatal` on OOM else `error`, tags `error_code`/`oom_subtype`/`backend`/
     `model_id`/`quant`/`context_length` + scrubbed `stderr_tail`), download
     failure ([`DownloadManegement.tsx`](web-app/src/containers/DownloadManegement.tsx),
     `failure_reason`/`http_status`/`download_kind`, cancellations excluded),
     and context overflow ([`$threadId.tsx`](web-app/src/routes/threads/$threadId.tsx),
     `warning` with `model_id`/`context_length`/`total_tokens`). Zero-PII
     hardware tags + device id pushed from
     [`AnalyticProvider.tsx`](web-app/src/providers/AnalyticProvider.tsx) reusing
     `collectHardwareSuperProps`; a dedicated effect syncs consent to **both**
     SDKs on every toggle.
  3. **Rust/Tauri** (new [`src-tauri/src/core/telemetry/`](src-tauri/src/core/telemetry/mod.rs),
     desktop-only `#[cfg(not(any(android, ios)))]`): `sentry = "0.34"`
     (feature `log`) in the desktop Cargo target. `init()` guard held for the
     whole process from the **top of [`main.rs`](src-tauri/src/main.rs)** so the
     default panic hook is armed before any work (`panic = "abort"` is fine —
     the hook runs first). Consent = process-global `AtomicBool` (default ON)
     checked in `before_send`/`before_breadcrumb`, reconciled from the frontend
     via the `set_telemetry_consent` command; hardware tags arrive via
     `set_telemetry_context` (both registered in
     [`lib.rs`](src-tauri/src/lib.rs)). **Log bridge:** `tauri-plugin-log` is
     installed with `.split()` (not `.build()`) and its logger wrapped in
     `SentryLogger::with_dest` so `log::error!` → Sentry event,
     `info`/`warn` → breadcrumbs, while stdout/webview/`app.log` keep working.
     `before_send` strips `server_name`/IP/username/email, scrubs every
     free-text field + stack `filename`/`abs_path`, clears frame `vars`, and
     attaches a scrubbed ~50 KB tail of `app.log`.
  4. **Shared scrubber.** TS `scrubPii` in
     [`telemetry.ts`](web-app/src/lib/telemetry.ts) extended to redact
     sensitive query-param values; Rust mirror
     [`scrub.rs`](src-tauri/src/core/telemetry/scrub.rs) implemented **without
     `regex`** (manual string passes) to avoid a heavy new dep — masks
     `/Users|/home|C:\Users` user segment (keeps folder structure), proxy
     creds, `hf_*`, `Bearer`, and sensitive query values. Key-based redaction
     (tokens/creds/`base_url`/uuid/hostname) on object values both sides.
  5. **PII source fixes** in [`proxy.rs`](src-tauri/src/core/server/proxy.rs):
     `log_ttft_prefix_dump` now logs message/tool **counts + byte sizes**, and
     the Anthropic-fallback `log::error!` logs only the request body's
     **top-level keys** — never prompt content.
  6. **Symbolication (code side).** `vite.config.ts` emits source maps + runs
     `@sentry/vite-plugin` **only** when CI provides `SENTRY_AUTH_TOKEN` +
     `SENTRY_ORG` + `SENTRY_PROJECT_FRONTEND` (uploads, associates with the
     git-SHA release, then deletes maps from `dist` — never shipped). Rust
     `[profile.release]` now `debug = 1` + `split-debuginfo = "packed"` so a
     separate dSYM/dwp/pdb exists for `sentry-cli debug-files upload` while the
     shipped binary stays `strip = "symbols"`. **CI heap (amendment
     2026-06-09):** emitting source maps for the ~12.9k-module bundle pushes the
     `yarn build:web` step past Node's ~2 GB default and it OOM'd
     (`Reached heap limit`); the three `Build web app` steps in
     [`release.yml`](.github/workflows/release.yml) now set
     `NODE_OPTIONS=--max-old-space-size=8192`.
- **Consequences:**
  - 100% capture when consented, total silence when not — no re-init on toggle.
    Zero-PII by construction on both runtimes (single scrubber doctrine, tags
    allow-listed to enum/id/number/bucket/bool, prompts → never sent).
  - **Verified:** `cargo check -p Atomic-Chat` 0 errors; `cargo test`
    `core::telemetry` 6/6 (scrub) pass; web-app `tsc -b` clean; eslint clean on
    all touched files (one pre-existing `exhaustive-deps` warning untouched);
    provider vitest 7/7. `@sentry/react` + `@sentry/vite-plugin` installed
    (hoisted to root `node_modules`).
  - **Remaining (owned by user / out of code scope):** the GitHub Actions wiring
    — set `SENTRY_*` env on the build steps (`SENTRY_RELEASE = ${{ github.sha }}`
    shared by both projects) and add the `sentry-cli debug-files upload` /
    release-finalize steps + GitHub secrets; the Sentry.io-side org config (auth
    token scopes, server-side scrubbers, Linear+Seer integration + alert rule);
    and the **acceptance test** (trigger a crash per project on a DSN-baked build
    and eyeball the payload). `cuda_runtime_version` tag is best-effort (inherited
    from the PostHog super-prop). Mobile is entirely excluded.
- **Owner:** team.
- **Links:** [ATO-113](https://linear.app/atomicchat/issue/ATO-113), the
  2026-06-09 ADR *Extend the PostHog telemetry channel …* (shared
  `telemetry.ts` helpers + consent model), files:
  [`web-app/src/lib/sentry.ts`](web-app/src/lib/sentry.ts),
  [`web-app/src/lib/telemetry.ts`](web-app/src/lib/telemetry.ts),
  [`web-app/src/main.tsx`](web-app/src/main.tsx),
  [`web-app/src/routes/__root.tsx`](web-app/src/routes/__root.tsx),
  [`web-app/src/providers/AnalyticProvider.tsx`](web-app/src/providers/AnalyticProvider.tsx),
  [`web-app/src/utils/switchModel.ts`](web-app/src/utils/switchModel.ts),
  [`web-app/src/containers/DownloadManegement.tsx`](web-app/src/containers/DownloadManegement.tsx),
  [`web-app/src/routes/threads/$threadId.tsx`](web-app/src/routes/threads/$threadId.tsx),
  [`web-app/vite.config.ts`](web-app/vite.config.ts),
  [`src-tauri/src/core/telemetry/mod.rs`](src-tauri/src/core/telemetry/mod.rs),
  [`src-tauri/src/core/telemetry/scrub.rs`](src-tauri/src/core/telemetry/scrub.rs),
  [`src-tauri/src/core/telemetry/commands.rs`](src-tauri/src/core/telemetry/commands.rs),
  [`src-tauri/src/main.rs`](src-tauri/src/main.rs),
  [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs),
  [`src-tauri/src/core/server/proxy.rs`](src-tauri/src/core/server/proxy.rs),
  [`src-tauri/Cargo.toml`](src-tauri/Cargo.toml).

### 2026-06-09 — Extend the PostHog telemetry channel with hardware super-properties, model download/load events, and an api_server_request error breakdown (ATO-108: ATO-111 + ATO-109 + ATO-112)
- **Context:** The only product-analytics surface was the single Rust-emitted
  `analytics://api_server_request` event (forwarded to PostHog by
  [`AnalyticProvider.tsx`](web-app/src/providers/AnalyticProvider.tsx)), whose
  super-properties were just `app_version` + `platform`, plus four ad-hoc
  web-app `posthog.capture` sites. Triage of crashes / load failures /
  download failures had no hardware context, no model-lifecycle events, and the
  api_server_request stream was both noisy (model-list / metrics / 404 polling)
  and lossy (every upstream failure collapsed to a single `error_kind:"upstream"`
  with the model's own HTTP status discarded). [ATO-108](https://linear.app/atomicchat/issue/ATO-108)
  scoped the fix to **PostHog only** — Sentry (ATO-110/113) explicitly deferred,
  ATO-114 cancelled, ATO-115 (hosted) out of scope.
- **Decision:** Three PostHog-only workstreams, all under a single PII rule
  (**only enum / id / number / `*_bucket` / bool / sanitized string** — never
  prompts, file paths, usernames, HF/API tokens, `base_url`, GPU serials, or
  `GpuInfo.uuid`). RAM/VRAM bucketed when surfaced.
  1. **Shared helpers** — new
     [`web-app/src/lib/telemetry.ts`](web-app/src/lib/telemetry.ts) centralizes
     all classification/sanitization: `quantFromModelId`, `sizeBucket`,
     `classifyDownloadFailure`/`parseHttpStatus`, `downloadKind`, `oomSubtype`,
     `mmprojProjectorType`, `scrubPii`/`sanitizeStderrTail`, `urlHost`/`isHfUrl`,
     `mapGpuVendor`, `cpuAvxLevel`, `loadBackendFromProvider`, and a
     download-dedup trio (`markDownloadStart` / `takeDownloadDuration` /
     `finalizeDownloadOnce`).
  2. **ATO-111 — hardware super-properties.**
     [`AnalyticProvider.tsx`](web-app/src/providers/AnalyticProvider.tsx)
     now `register()`s OS/arch/`cpu_avx`/RAM/GPU(vendor,model,VRAM,driver,
     CUDA-cc,Vulkan)/active+recommended-backend before `capture('app_opened')`
     (each probe wrapped in `withTimeout` so startup isn't blocked; the slow
     `getLlamacppDevices()` `device_parse_ok` probe is detached and registered
     onto later events since super-props persist in localStorage). A new
     optional Rust command `get_installer_type`
     ([`commands.rs`](src-tauri/src/core/system/commands.rs), registered in
     [`lib.rs`](src-tauri/src/lib.rs), surfaced via the `AppService` layer
     `getInstallerType()`) returns `appimage` (Linux `APPIMAGE` env) /
     `msi`|`setup_exe` (Windows uninstall-registry heuristic) / `dmg` (macOS
     best-effort) / `unknown`.
  3. **ATO-109 — `model_download` + `model_load`.** `model_download` `started`
     fires in [`services/models/default.ts`](web-app/src/services/models/default.ts)
     `pullModelWithMetadata`; terminal `completed`/`failed`/`cancelled` fire in
     [`DownloadManegement.tsx`](web-app/src/containers/DownloadManegement.tsx)
     listeners, deduped via `finalizeDownloadOnce` and timed via the
     `markDownloadStart`/`takeDownloadDuration` Map. `model_load`
     (success/failed, local engines only) fires in
     [`switchModel.ts`](web-app/src/utils/switchModel.ts) around `startModel`,
     carrying `backend`/`backend_version`/`ctx`/`n_gpu_layers`/`is_multimodal`/
     `device_used`/`load_duration_ms` on success and
     `error_code`/`oom_subtype`/`mmproj_projector_type`/sanitized `stderr_tail`
     on failure.
  4. **ATO-112 — api_server_request noise + breakdown** (Rust
     [`proxy.rs`](src-tauri/src/core/server/proxy.rs) + types in
     [`analytics.ts`](web-app/src/types/analytics.ts)). `skip_emit=true` added
     for `GET /models` and the catch-all 404 (`endpoint=other`). The single
     `error_kind:"upstream"` is split at every emission site by `state.backend`
     into `local_model_error` / `local_model_unreachable` /
     `remote_provider_error` / `proxy_internal` (helpers `is_local_backend`,
     `upstream_error_kind`, `unreachable_error_kind`). New `EmitState` /
     `ApiRequestEvent` fields `upstream_status` (the model's/provider's own
     status, previously discarded), `oom_detected` (new `body_indicates_oom`
     heuristic), `ctx_overflow_detected` (reuses `is_context_limit_error`), and
     `server_bind_failed` — the last emitted as a dedicated one-off event from
     the `start_server_internal` bind-error arm (it can't ride a real request).
     TS `analytics.ts` updated: new `error_kind` union, `'responses'`/`'metrics'`
     endpoints, `BIND` method, `llamacpp-upstream`/`''` backends, optional
     breakdown fields.
- **Consequences:**
  - Crash/load/download triage now has device context + lifecycle events;
    api_server_request is lower-volume and its failures are attributable to
    local-model vs remote-provider vs proxy-internal with the upstream status
    preserved. All payloads remain PII-free by construction (single helper
    module).
  - **Stringly-typed download errors are classified in web-app**, not via a Rust
    download-core refactor (deliberate, minimally invasive — a structural
    `failure_reason` from Rust is a possible later hardening). `cuda_runtime_version`
    is best-effort (supported-features + compute-capability), exact string
    deferred. `installer_type` on macOS is best-effort (`dmg`/`unknown`).
  - **Out of scope / not done:** Sentry (ATO-110/113), hosted PostHog
    (ATO-115), 404 aggregation (chose `skip_emit` over a buffered summary),
    `ctx_auto_increased`/`new_ctx_len` on `model_load` (best-effort, deferred).
  - **Verification:** `cargo check -p Atomic-Chat` passes (0 errors,
    pre-existing dead_code warnings only); `yarn lint` clean on all touched
    files (the 3 `ttft-timing.ts` errors are pre-existing and untouched);
    `ReadLints` clean on every edited TS/TSX file. Runtime confirmation via
    `posthog.debug()` on a dev build is the remaining manual step.
- **Owner:** team.
- **Links:** [ATO-108](https://linear.app/atomicchat/issue/ATO-108),
  [ATO-111](https://linear.app/atomicchat/issue/ATO-111),
  [ATO-109](https://linear.app/atomicchat/issue/ATO-109),
  [ATO-112](https://linear.app/atomicchat/issue/ATO-112), files:
  [`web-app/src/lib/telemetry.ts`](web-app/src/lib/telemetry.ts),
  [`web-app/src/providers/AnalyticProvider.tsx`](web-app/src/providers/AnalyticProvider.tsx),
  [`web-app/src/services/models/default.ts`](web-app/src/services/models/default.ts),
  [`web-app/src/containers/DownloadManegement.tsx`](web-app/src/containers/DownloadManegement.tsx),
  [`web-app/src/utils/switchModel.ts`](web-app/src/utils/switchModel.ts),
  [`web-app/src/types/analytics.ts`](web-app/src/types/analytics.ts),
  [`web-app/src/services/app/{types,default,tauri}.ts`](web-app/src/services/app/tauri.ts),
  [`src-tauri/src/core/server/proxy.rs`](src-tauri/src/core/server/proxy.rs),
  [`src-tauri/src/core/system/commands.rs`](src-tauri/src/core/system/commands.rs),
  [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs).

### 2026-06-09 — Default the macOS local llama.cpp engine to `llamacpp-upstream` so the Recommended Gemma 4 vision model loads out of the box (ATO-116)
- **Context:** On macOS the default local engine was the **TurboQuant fork**
  (`llamacpp`), not vanilla upstream. The Hub "Recommended" model
  `unsloth/gemma-4-12b-it-IQ4_XS` (vision, ships an `mmproj.gguf`) downloaded
  into and started on TurboQuant, which can't parse Gemma 4's unified
  multimodal projector `gemma4uv` (the fork carries only `gemma4v`/`gemma4a`;
  upstream `b9562` has the full set). The load crashed entirely and the UI
  showed only `[object Object]` ([ATO-116](https://linear.app/atomicchat/issue/ATO-116);
  the `[object Object]` rendering is its own ticket, [ATO-117](https://linear.app/atomicchat/issue/ATO-117)).
  Switching the model's engine to `llamacpp-upstream` made it load fine. So
  **out of the box on macOS the Recommended model crashed with an opaque
  error.** Confirmed root cause in code (branch `main`): `LOCAL_LLAMACPP_PROVIDER`
  resolved to `llamacpp` on macOS (`web-app/src/lib/utils.ts`), `pullModel()`
  routes downloads through it, and `getModelToStart.ts` tried `llamacpp` first.
- **Decision (per the ticket's accepted resolution):** Make the **default**
  local engine `llamacpp-upstream` on macOS too; keep TurboQuant available as
  an explicit manual choice (do **not** remove it, do **not** migrate existing
  models). Three edits:
  1. [`web-app/src/lib/utils.ts`](web-app/src/lib/utils.ts): `LOCAL_LLAMACPP_PROVIDER`
     and its mirror `LOCAL_LLAMACPP_EXTENSION_NAME` are now unconditionally
     `'llamacpp-upstream'` / `'@janhq/llamacpp-upstream-extension'` (previously
     `IS_WINDOWS || IS_LINUX ? upstream : turboquant`). Both flip together so
     downloads, model start, onboarding (`SetupBackendStep`), the backend
     updater, and the hardware probe all resolve the **same** engine — leaving
     the provider on upstream while the extension stayed on turboquant would
     make onboarding fetch the turboquant backend under an upstream-routed
     model.
  2. [`web-app/src/utils/getModelToStart.ts`](web-app/src/utils/getModelToStart.ts):
     start order `['llamacpp-upstream', 'llamacpp', 'mlx']` (upstream first).
  3. The session's earlier text-only fallback in the TurboQuant pair (ADR
     below) stays as **complementary defense-in-depth** for users whose models
     already live under `engine: llamacpp`.
- **Consequences:**
  - Fresh macOS installs download + start the Recommended Gemma 4 vision model
    on upstream, which supports `gemma4uv`/`gemma4ua`, so **vision works out of
    the box** (the text-only fallback degrades; this flip keeps vision).
  - **Backwards-compatible, by the ticket's explicit constraints.** Only the
    default for fresh downloads / empty state changes. Existing models stay in
    `data/llamacpp/models/` with `engine: llamacpp` and keep running on
    TurboQuant; a user's explicitly-selected `selectedProvider` (zustand-persist)
    is preserved. **No** forced `engine` migration and **no** macOS runtime
    alias — the `llamacpp → llamacpp-upstream` alias + v13 purge in
    `useModelProvider.ts` remain `IS_WINDOWS`-gated, so macOS threads /
    `lastUsedModel` bound to `llamacpp` are untouched (copying the Windows
    approach would hang them).
  - TurboQuant remains a first-class manual provider on macOS (turbo3 KV-cache
    memory savings); `getProviderTitle('llamacpp')` still renders "Atomic
    Llama.cpp Turboquant" on macOS.
  - **Rejected alternatives** (per ticket): TurboQuant-default + auto-fallback
    to upstream on load failure (leaves first run failing); route vision→upstream
    / text→TurboQuant (needs projector-type detection, fragile on new archs);
    forced model migration (risks hanging others' threads, removes user choice).
  - Scope: web-app only; no Rust, IPC, on-disk layout, or settings-schema
    change. `IS_WINDOWS`/`IS_LINUX` are still used elsewhere in `utils.ts`
    (`getProviderTitle`), so no dead globals. Lint-clean; the
    `models.windowsProviderRouting` suite (4 tests) passes; no test asserted
    the old macOS default.
  - **`[object Object]` (ATO-117) not fixed here** — that's the generic
    load-error rendering in `llamacpp-extension`; this ADR just stops the
    Recommended model from reaching the crash path on a fresh install.
- **Owner:** team.
- **Links:** [ATO-116](https://linear.app/atomicchat/issue/ATO-116),
  [ATO-117](https://linear.app/atomicchat/issue/ATO-117), the same-day ADR
  *Text-only fallback in the TurboQuant `llamacpp` provider …* (below), the
  2026-05-22 ADR *Windows ships only `llamacpp-upstream`*, the 2026-05-19 ADR
  *Ship upstream `ggml-org/llama.cpp` as a second macOS provider*, files:
  [`web-app/src/lib/utils.ts`](web-app/src/lib/utils.ts)
  (`LOCAL_LLAMACPP_PROVIDER`, `LOCAL_LLAMACPP_EXTENSION_NAME`),
  [`web-app/src/utils/getModelToStart.ts`](web-app/src/utils/getModelToStart.ts).

### 2026-06-09 — Text-only fallback in the TurboQuant `llamacpp` provider on unsupported multimodal projector (Gemma 4 12B unified `gemma4uv`/`gemma4ua`)
- **Context:** Loading `unsloth/gemma-4-12b-it-IQ4_XS` on the TurboQuant
  macOS provider (`tauri-plugin-llamacpp` + `extensions/llamacpp-extension`,
  bundled binary `turboquant-macos-arm64-0a635dc`) crashed the whole
  `llama-server` during clip warmup:
  `clip_init: ... unknown projector type: gemma4uv` →
  `mtmd_init_from_file: error: Failed to load CLIP model ...` →
  `main: exiting due to model loading error`. The **text model loaded fine**
  (arch `gemma4` accepted, 48 layers on GPU, TurboQuant `turbo3` KV up, EOG
  `<turn|>`=106 recognised); only the multimodal projector failed. Root
  cause: the mmproj for Gemma 4's **unified** ("any-to-any") 12B declares the
  projector type `gemma4uv` (unified vision; its audio sibling is `gemma4ua`).
  Verified against sources: upstream `ggml-org/llama.cpp` master enumerates
  **four** Gemma 4 projector types (`gemma4v`, `gemma4a`, `gemma4uv`,
  `gemma4ua`), but **every branch of our fork
  `AtomicBot-ai/atomic-llama-cpp-turboquant`** (`feature/turboquant-kv-cache`,
  `feature/gemma-mtp`, …) carries only the non-unified pair `gemma4v` /
  `gemma4a`. So the fork is behind upstream on the *unified* projectors that
  the 12B uses. Compounding it, the TurboQuant extension/plugin pair lacked
  the text-only fallback we already gave the `llamacpp-upstream` pair in the
  2026-06-04 ADR (issue #44) — so instead of degrading gracefully it
  hard-failed with an opaque `[object Object]` in the UI.
- **Decision:** Port the **same text-only fallback** to the TurboQuant pair
  (path A of the user's choice; the full projector port — path B — is
  deferred). Two mirrored edits:
  1. **Rust** ([`tauri-plugin-llamacpp/src/error.rs::from_stderr`](src-tauri/plugins/tauri-plugin-llamacpp/src/error.rs)):
     classify stderr containing `unknown projector type` (lowercased) as
     `ErrorCode::MultimodalProjectorLoadFailed` (the variant already existed)
     with the same actionable message as the upstream plugin, placed after
     the OOM and arch-not-supported checks so those still win.
  2. **TS** ([`extensions/llamacpp-extension/src/index.ts::performLoad`](extensions/llamacpp-extension/src/index.ts)):
     when `loadLlamaModel` rejects with `code ===
     'MULTIMODAL_PROJECTOR_LOAD_FAILED'` **and** an `mmprojPath` was set, retry
     the load **once** with `mmprojPath = undefined` (text-only), caching the
     session and ctx size as on the happy path; any other error (or a retry
     that also fails) propagates unchanged. New module const
     `ERR_MULTIMODAL_PROJECTOR_LOAD_FAILED`.
- **Consequences:**
  - Gemma 4 12B (and any model whose mmproj uses a projector the TurboQuant
    fork can't build) now **loads and chats text-only** on macOS instead of
    failing the whole load. Vision/audio is silently dropped for that model
    on that backend until the fork ships the unified projectors.
  - **Deliberately no toast.** Unlike the upstream pair, this fallback does
    **not** emit `local_backend://multimodal_disabled_fallback` — that
    web-app listener was removed earlier this session, so emitting would be
    dead code. The fallback is logged (`logger.warn`) and otherwise silent.
  - **Lossy by design / not the full fix.** This is path A (unblock text).
    Returning vision/audio for unified Gemma 4 on TurboQuant requires path B:
    porting `gemma4uv` / `gemma4ua` (clip-impl.h enums+names, clip.cpp graph
    builders, mtmd.cpp preprocessors) from `ggml-org/llama.cpp` into the fork
    and rebuilding the sidecar — tracked as a separate follow-up.
  - Single-shot retry, gated on the specific error code + present mmproj, so
    non-multimodal loads and other failure modes are unaffected. No new
    settings, IPC, deps, or on-disk layout. `cargo check -p
    tauri-plugin-llamacpp` passes (pre-existing warnings only); both edited
    files are lint-clean.
- **Owner:** team.
- **Links:** §4.2 *LLM backend*, the 2026-06-04 ADR *Recover from unsupported
  multimodal projector (`gemma4a`) … text-only fallback* (issue #44, upstream
  pair), [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp)
  (`tools/mtmd/clip-impl.h`, four `gemma4*` projector types),
  [AtomicBot-ai/atomic-llama-cpp-turboquant](https://github.com/AtomicBot-ai/atomic-llama-cpp-turboquant)
  (carries only `gemma4v` / `gemma4a`), files:
  [`src-tauri/plugins/tauri-plugin-llamacpp/src/error.rs`](src-tauri/plugins/tauri-plugin-llamacpp/src/error.rs)
  (`from_stderr`),
  [`extensions/llamacpp-extension/src/index.ts`](extensions/llamacpp-extension/src/index.ts)
  (`performLoad`, `ERR_MULTIMODAL_PROJECTOR_LOAD_FAILED`).

### 2026-06-09 — Add a cross-platform "Launch at startup" toggle via `tauri-plugin-autostart` (ATO-96)
- **Context:** A Discord user (Andrej) asked whether Atomic Chat can be
  configured to run at system startup; no such option existed. Investigation
  confirmed there was **no** autostart mechanism anywhere — no
  `tauri-plugin-autostart` in [`src-tauri/Cargo.toml`](src-tauri/Cargo.toml),
  no plugin registration in [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs), no
  UI control (the only `*Startup*` symbol in the codebase is the unrelated
  `preloadModelOnStartup`). Requirement: a cross-platform (macOS / Windows /
  Linux) toggle in Settings → General.
- **Decision:** Use the official `tauri-plugin-autostart` v2 (under the hood
  the `auto-launch` crate: macOS Login Items / LaunchAgent, Windows
  `HKCU\…\Run` registry key, Linux `~/.config/autostart/*.desktop`). MVP only —
  exactly the ticket's scope.
  1. **Rust** ([`Cargo.toml`](src-tauri/Cargo.toml),
     [`lib.rs`](src-tauri/src/lib.rs)): `tauri-plugin-autostart = "2.5.1"` added
     to the **desktop-only** target block
     (`cfg(not(any(target_os = "android", target_os = "ios")))`, beside
     `tauri-plugin-single-instance` / `tauri-plugin-updater`) so it is never
     compiled on mobile. Registered inside the existing `#[cfg(desktop)]` block
     **after** `single_instance` (the plugin requires single-instance first),
     with `MacosLauncher::LaunchAgent` (avoids the Apple Events prompt) and
     `None` launch args.
  2. **Capabilities:** `"autostart:default"` (covers
     `allow-enable` / `allow-disable` / `allow-is-enabled`) added to
     [`capabilities/default.json`](src-tauri/capabilities/default.json) and
     [`capabilities/desktop.json`](src-tauri/capabilities/desktop.json).
  3. **TS** ([`web-app/package.json`](web-app/package.json)):
     `@tauri-apps/plugin-autostart@2.5.1`.
  4. **UI** ([`general.tsx`](web-app/src/routes/settings/general.tsx)): a
     `CardItem` + `Switch` in the General card, gated behind `IS_TAURI`. The
     **OS is the source of truth** — state comes from a direct `isEnabled()`
     query on mount; the toggle calls `enable()` / `disable()` then re-reads
     `isEnabled()`. No localStorage/zustand mirror (avoids drift if the user
     removes the autostart entry externally). On error a toast
     (`settings:general.launchAtStartupError`) is shown and the switch is
     reconciled to the real OS state.
  5. **i18n:** `launchAtStartup` / `launchAtStartupDesc` /
     `launchAtStartupError` in
     [`en/settings.json`](web-app/src/locales/en/settings.json) and
     [`ru/settings.json`](web-app/src/locales/ru/settings.json); other locales
     fall back to EN.
- **Consequences:** Default is **OFF** — the plugin creates no autostart entry
  unless the user flips the toggle; there is no auto-`enable()` on first launch.
  Desktop-only (gated by both the Cargo target and `IS_TAURI`); mobile is
  unaffected. **Out of scope (not built):** hidden/tray start on autostart
  (would need an `--autostart` launch arg + hidden-window logic) and any
  localStorage mirroring. **Cross-platform caveat to confirm at smoke-test:** on
  Linux AppImage, `auto-launch` relies on the `APPIMAGE` env var to write the
  correct exec path into the `.desktop` file — verify the generated
  `~/.config/autostart/Atomic Chat.desktop` points at the AppImage, not an
  extracted temp path.
- **Owner:** team.
- **Links:** [ATO-96](https://linear.app/atomicchat/issue/ATO-96), §5 *Build &
  dev workflow*, files:
  [`src-tauri/Cargo.toml`](src-tauri/Cargo.toml),
  [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs),
  [`src-tauri/capabilities/default.json`](src-tauri/capabilities/default.json),
  [`src-tauri/capabilities/desktop.json`](src-tauri/capabilities/desktop.json),
  [`web-app/package.json`](web-app/package.json),
  [`web-app/src/routes/settings/general.tsx`](web-app/src/routes/settings/general.tsx),
  [`web-app/src/locales/en/settings.json`](web-app/src/locales/en/settings.json),
  [`web-app/src/locales/ru/settings.json`](web-app/src/locales/ru/settings.json).

### 2026-06-09 — Make the Local API Server "Invalid host header" rejection actionable + fix Trusted Hosts field copy (ATO-118, scope I+II)
- **Context:** LAN users cannot reach the local API server (`:1337`) from
  another machine — they get `403 Invalid host header` even with `host=0.0.0.0`
  and Trusted Hosts filled in. Recurring (Discord; upstream
  [janhq/jan#7345](https://github.com/janhq/jan/issues/7345), maintainer's
  official answer is `*`). The check `is_valid_host`
  ([`src-tauri/utils/src/http.rs:19`](src-tauri/utils/src/http.rs)) is
  **correct** — a security feature inherited verbatim from Jan — but the UX
  misleads users into two systematic mistakes: (1) entering the **client**
  (source) IP, when the `Host` header carries the **destination** (server)
  address, so there is nothing to match; (2) entering wildcard patterns
  (`10.*.*.*`), which are compared as literal strings — only the literal `*`
  short-circuits to allow-all. The 403 body was the opaque string
  `"Invalid host header"` (main branch, `proxy.rs:1740`) /`"Host not allowed"`
  (CORS-preflight branch, `proxy.rs:1611`); both are read by the **external
  LAN client** (curl / third-party app), not our own UI.
- **Decision:** Ship the low-risk core only (ticket's items 1+2); **do not**
  touch the security-validation logic. The stretch CIDR/`*`-wildcard support
  in `is_valid_host` (ticket item 3) was deliberately deferred.
  1. **Actionable error (`proxy.rs`).** Both rejection branches now return a
     host-naming hint: `Host '<host>' is not in Trusted Hosts. Add this
     server's address (e.g. its LAN IP or hostname) in Settings → Local API
     Server → Trusted Hosts, or use '*' to allow all.` (interpolating
     `host_header` / `host` respectively). No status-code or routing change.
  2. **Field copy (EN only).** `trustedHostsDesc`
     (`web-app/src/locales/en/settings.json`) rewritten to state it is the
     **server's** own address (LAN IP / hostname, with inline example
     `192.168.1.100, my-host`), **not** the connecting client's, that `*`
     allows all, and that wildcard/CIDR patterns are unsupported. The
     placeholder `enterTrustedHosts`
     (`web-app/src/locales/en/common.json`, sole consumer
     `TrustedHostsInput.tsx`) now reads `This server's address, e.g.
     192.168.1.100, my-host (or * for all)`. Other locales fall back to EN.
- **Consequences:** The 403 now tells the LAN debugger exactly what to do; the
  Settings field stops inviting the client-IP mistake. No behaviour change to
  who is actually allowed — `is_valid_host` is byte-for-byte unchanged, so the
  inherited security posture is preserved. `cargo check -p Atomic-Chat` passes
  (0 errors; pre-existing unrelated `dead_code` warnings only); the two EN JSON
  scrolls lint clean. **Not done (deferred):** CIDR / `10.*.*.*` matching in
  `is_valid_host`, unit tests for that function (still uncovered), and any
  non-EN locale copy.
- **Owner:** team.
- **Links:** [ATO-118](https://linear.app/atomicchat/issue/ATO-118),
  [janhq/jan#7345](https://github.com/janhq/jan/issues/7345), §5 *Local API*,
  files: [`src-tauri/src/core/server/proxy.rs`](src-tauri/src/core/server/proxy.rs)
  (host-rejection branches),
  [`web-app/src/locales/en/settings.json`](web-app/src/locales/en/settings.json)
  (`trustedHostsDesc`),
  [`web-app/src/locales/en/common.json`](web-app/src/locales/en/common.json)
  (`enterTrustedHosts`).

### 2026-06-08 — Hide base (non-`-it`) Gemma 4 MLX models from Hub + recommend the `-it` variants (ATO-88 head 1, fourth follow-up)
- **Context:** After the `<|turn>` template + `<turn|>` stop fix (ADR below),
  `mlx-community/gemma-4-12B-4bit` *still* produced garbage on the sidecar
  (`0a82347`) — stray MathML, wrong-script glyphs, fabricated dialogue. Root
  cause is **not a code bug**: that repo's model card declares
  `base_model: google/gemma-4-12B` — the **base (pretrain) model**, not the
  instruction-tuned `…-it`. Base Gemma has **no chat template by design** and
  only does raw text continuation, so it falls out of distribution in chat. The
  earlier server-side template/suppress fixes only masked symptoms; nothing in
  the engine can make a base model behave as an assistant. Confirmed: the user's
  `-it` builds (`gemma-4-e2b-it-4bit`, `gemma-4-e4b-it-4bit`) work; only the base
  `gemma-4-12B-4bit` fails. Sweeping the upstream `Blaizzy/mlx-vlm` delta (fork
  is 69 commits behind, v0.6.2) found no fix for this — `cef92e2` (#1301) targets
  `num_kv_shared_layers > 0` QAT loads (the 12B has `0`), `a4ddde9` is image/video
  drop, the rest docs. Worse, **`atomic-chat-conf/models/recommended.json` itself
  recommended the base e2b/e4b** (`mlx-community/gemma-4-e2b-4bit` /
  `…-e4b-4bit`), and the recommended block resolves `model_name` verbatim
  (`useResolvedRecommendedModels`), bypassing any Hub catalog filter.
- **Decision:** Make base Gemma 4 MLX models unreachable in the UI; recommend the
  `-it` variants. No backend/sidecar change.
  1. **Data fix (`atomic-chat-conf/models/recommended.json`).**
     `gemma-4-e2b-4bit` → `gemma-4-e2b-it-4bit`, `gemma-4-e4b-4bit` →
     `gemma-4-e4b-it-4bit` (both verified live, HTTP 200); bumped `updated_at`.
     The web-app offline constants (`RECOMMENDED_MODEL_FALLBACKS`,
     `BASELINE_MODEL_CATALOG`) already used `-it` — untouched.
  2. **Hub filter (`web-app/src/routes/hub/index.tsx`).** New predicate
     `isUnsupportedBaseGemmaMlx(model)` (mirrors the existing `isJanCatalogModel`
     style): hides a model when it is MLX (`is_mlx` / `library_name==='mlx'`) AND
     its repo basename matches `gemma[-_]?4` AND it is **not** `-it`
     (`/(^|[-_])it([-_]|$)/`, so `4bit`'s "it" is not a false positive) AND not a
     drafter artifact (`assistant`/`eagle3`/`speculator`/`dflash`/`-mtp`). Applied
     at the two aggregation chokepoints: the curated-catalog/​exact-repo filter
     (`filteredModels`, alongside `!isJanCatalogModel`) and the long-tail HF
     fallback tail (`virtualListModels`).
- **Consequences:**
  - Scoped to **MLX + Gemma 4** (the reported failure). GGUF base Gemma stays
    visible (different surface, not reported); Gemma 3 base is out of scope.
    Instruction-tuned `-it`, plus the MTP/EAGLE/DFlash drafter repos, stay
    browsable/usable. Verified with a 14-case truth table (base hidden incl.
    `google/gemma-4-12B`; every `-it`/drafter/non-MLX/non-Gemma kept); `ReadLints`
    clean on the edited TSX; `recommended.json` valid JSON.
  - The `recommended.json` change ships independently of an app release (12-hour
    cron / dispatch in `atomic-chat-model-catalog`'s sibling flow); the Hub filter
    ships with the next web-app build. Neither requires a sidecar rebuild.
  - The prior server-side Gemma fixes (template/suppress/stop) remain correct and
    useful for legitimately template-less `-it` MLX conversions; they are not
    reverted.
- **Owner:** team.
- **Links:** [ATO-88](https://linear.app/atomicchat/issue/ATO-88), §4.1 *MLX
  backend*, the three 2026-06-08 ADRs below, files:
  [`atomic-chat-conf/models/recommended.json`](https://github.com/AtomicBot-ai/atomic-chat-conf),
  `web-app/src/routes/hub/index.tsx` (`isUnsupportedBaseGemmaMlx`,
  `filteredModels`, `virtualListModels`).

### 2026-06-08 — Use the Gemma 4 `<|turn>` unified chat template (not Gemma 3's) for `gemma4_unified` + stop on `<turn|>` (ATO-88 head 1, third follow-up)
- **Context:** The same-day `654a520` fix (immediately below) installed a Gemma
  **3** turn template (`<start_of_turn>` / `<end_of_turn>` framing) as the
  fallback for *every* template-less Gemma — including `gemma4_unified`. Live
  testing of `gemma-4-12B-4bit` on the resulting sidecar
  (`mlxvlm-macos-arm64-654a520`) showed the model now answered coherently **but
  never stopped** — it emitted its answer and then ran on into an endless
  fabricated self-dialogue (`…<end_of_turn>\n<start_of_turn>user\n…`). Root
  cause: **Gemma 4 does not speak the Gemma 3 turn dialect.** Confirmed against
  the live tokenizer + on-disk configs:
  - Gemma 4's real turn tokens are **`<|turn>` (105)** / **`<turn|>` (106)** with
    reasoning channels **`<|channel>` (100)** / **`<channel|>` (101)** — *not*
    `<start_of_turn>`/`<end_of_turn>`. Encoding the literal string
    `<end_of_turn>` against the Gemma 4 tokenizer splits into 7 sub-word pieces
    and collapses to `<unk>` (id 3) — it is not a token. So the Gemma 3 template
    fed the model out-of-distribution framing; the model echoed the literal
    `<end_of_turn>` **as plain text** and, having no real turn-end token to emit,
    never tripped a stop.
  - `tokenizer_config.json` declares `eot_token: "<turn|>"` (= 106), but
    `generation_config.json::eos_token_id` is just `[1]` (`<eos>`). The previous
    `_collect_stop_tokens` mined only `eos_token_id`, so **106 was never a stop**
    even once correct framing made the model want to emit it.
  - Sibling builds **E2B/E4B** (`model_type: gemma4`) **ship their own
    `chat_template.jinja`** — both already on the `<|turn>` dialect, byte-format
    identical family to the 12B-it template — which is why they worked. **12B**
    (`gemma4_unified`) ships **no template at all** (none in
    `tokenizer_config.json`, no `chat_template.{json,jinja}`), so the fallback is
    mandatory there.
- **Decision:** Fix in `AtomicBot-ai/mlx-vlm` (`mlx_vlm/server/`), no Atomic-Chat
  app change. Three edits:
  1. **Authoritative Gemma 4 template.** `_chat_templates.py` gains
     `GEMMA4_UNIFIED_CHAT_TEMPLATE`, embedded **byte-exact** (17 466 B,
     `json.dumps`) from the published `mlx-community/gemma-4-12B-it-4bit`
     `chat_template.jinja` (`<|turn>`/`<turn|>` framing, `<|channel>` reasoning
     channels, tool macros, and the thinking-disabled generation-prompt seed
     `<|turn>model\n<|channel>thought\n<channel|>`). The Gemma 3 template is
     **kept** as `GEMMA_CHAT_TEMPLATE`, now correctly scoped.
  2. **Family-correct selection.** `_GEMMA_TEMPLATE_MODEL_TYPES` (a flat set) is
     replaced by `_GEMMA_TEMPLATE_BY_TYPE` mapping `gemma3`/`gemma3n` →
     `GEMMA_CHAT_TEMPLATE` and `gemma4`/`gemma4_unified` →
     `GEMMA4_UNIFIED_CHAT_TEMPLATE`. `_maybe_install_gemma_chat_template` picks by
     `model_type`; still install-only-when-absent, idempotent, never clobbers a
     shipped template (so E2B/E4B keep their own).
  3. **Stop on `<turn|>`.** `_collect_stop_tokens` now also reads
     `tokenizer_config.json::eot_token`, resolves it via the tokenizer
     (`convert_tokens_to_ids`, guarded against `<unk>` / bools / negatives), and
     unions the id (106) into the stop set. Generic across the Gemma family —
     Gemma 3's `<end_of_turn>` (also 106) was already covered via
     `generation_config`, so this is additive, not a regression there.
- **Consequences:**
  - **Validated** (isolated, no GPU — tokenizer + template only, to avoid
    fighting the live sidecar): `_collect_stop_tokens(gemma-4-12B-4bit)` →
    `{1, 106}`; the fallback installs the `<|turn>` template (asserted no
    `<start_of_turn>` present); rendering a user turn yields
    `<bos><|turn>user\n…<turn|>\n<|turn>model\n<|channel>thought\n<channel|>` and
    re-encodes to the real single special tokens 105/100/101. `py_compile` clean;
    `ruff format` + `ruff check` clean.
  - **Committed `0a82347`, pushed to `origin/main`** (`654a520..0a82347`, no
    force) → re-triggers `build-mlxvlm-macos.yml` → new sidecar release
    **`mlxvlm-macos-arm64-0a82347`**. **Not yet shipped to the app:** run
    `make build-mlx-server` (or `-if-exists` auto-update) so
    `src-tauri/resources/bin/mlx-server-version.txt` flips `654a520 → 0a82347`,
    then restart. Final runtime confirmation on Apple Silicon (coherent answer,
    no leak, **halts cleanly at `<turn|>`**) is pending that bump.
  - The unified template's thinking-disabled seed (`<|channel>thought\n<channel|>`)
    relies on the fork's existing `in_thinking`/channel handling in
    `server/openai.py`; E2B/E4B exercise the same path with their shipped copy,
    so it is proven for this family.
  - Sampling (ATO-99) remains a separate, still-open app-side matter (Gemma's
    recommended temp 1.0 / top_k 64 / top_p 0.95 not yet wired per family).
- **Owner:** team.
- **Links:** [ATO-88](https://linear.app/atomicchat/issue/ATO-88), §4.1 *MLX
  backend*, the 2026-06-08 ADR *Honor `…suppress_tokens` …* (immediately below,
  whose Gemma-3-template clause this supersedes for `gemma4*`), fork commit
  `0a82347`, files: `mlx_vlm/server/_chat_templates.py`
  (`GEMMA4_UNIFIED_CHAT_TEMPLATE`), `mlx_vlm/server/generation.py`
  (`_GEMMA_TEMPLATE_BY_TYPE`, `_maybe_install_gemma_chat_template`,
  `_collect_stop_tokens`).

### 2026-06-08 — Windows: fix clean-install config persistence (ATO-107), de-hardcode the CUDA-13 minor (ATO-105), and harden onboarding hardware detection against hangs (ATO-104)
- **Context:** Three related Windows bugs from a single Discord report
  (TechnicallyBen, RTX Quadro 6000, driver 596.59, 1.1.103, clean install):
  - **[ATO-107](https://linear.app/atomicchat/issue/ATO-107) (Urgent, confirmed
    by code + logs):** on a clean install `settings.json` was never written —
    50+ repeats of `App config not found … Failed to create default config: The
    system cannot find the path specified. (os error 3)`. Root cause: the config
    path is `app_data_dir()` = `…\Roaming\chat.atomic.app`, which does not exist
    yet on a fresh install, and both writers
    ([`get_app_configurations`](src-tauri/src/core/app/commands.rs) and
    [`update_app_configuration`](src-tauri/src/core/app/commands.rs)) called
    `fs::write` **without** `create_dir_all` on the parent (the CLI path
    `resolve_config_file_path` already did). Nothing persisted (backend choice,
    onboarding completion, data_folder), and `Failed to add server config / MCP
    config` cascaded from the same cause.
  - **[ATO-105](https://linear.app/atomicchat/issue/ATO-105) (Medium, latent):**
    [`determine_supported_backends`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/backend.rs)
    hardcoded `win-cuda-13.3-x64` while the rest of the Windows path was already
    dynamic (`fetchRemoteBackends` whitelist `^win-cuda-13\.\d+-x64$`,
    `get_backend_category`, cudart resolve). It only matched the live ggml-org
    asset (`b9553` → `win-cuda-13.3-x64`) by accident; the next CUDA-13 minor
    bump would silently drop CUDA for all Windows users (CPU fallback / 404).
  - **[ATO-104](https://linear.app/atomicchat/issue/ATO-104) (High, not yet
    root-caused to one commit):** clean-install onboarding hung on "Detecting
    your hardware". Suspected mechanism is the ATO-107 config-persistence failure
    plus an unbounded detection await; the ticket still wants user logs + a
    release bisect (1.1.99–1.1.102) to nail the exact regressor.
- **Decision:** One combined Windows fix set. ATO-104 is handled by *defensive
  hardening* now (per maintainer direction), deferring the deep root-cause to
  logs/bisect.
  1. **ATO-107:** create the parent dir before every config write. Added
     `if let Some(parent) = configuration_file.parent() { fs::create_dir_all(parent) }`
     ahead of `fs::write` in both `get_app_configurations` (log-and-continue on
     error, matching its existing non-fatal style) and `update_app_configuration`
     (propagates the error via `?`).
  2. **ATO-105:** make CUDA-13 a *family*, never a hardcoded minor.
     `determine_supported_backends` now pushes the minor-less id
     **`win-cuda-13-x64`** when `features.cuda13`. The TS filter in
     [`listSupportedBackends`](extensions/llamacpp-upstream-extension/src/backend.ts)
     accepts any concrete `win-cuda-13.<minor>-x64` remote asset when the family
     `win-cuda-13-x64` is in the supported set (regex `^win-cuda-13\.\d+-(x64|arm64)$`),
     and keeps passing the **concrete** id downstream so the correct asset is
     downloaded. `map_old_backend_to_new` gained a pass-through so the new family
     id round-trips unchanged; the legacy `cuda-13.x → 13.3` folding (migration of
     persisted ids only, backstopped by `resolveLatestBackendString`) is left as-is.
  3. **ATO-104:** guarantee onboarding detection terminates. In the extension,
     `recheckOptimalBackend` now wraps `detectIdealBackendType()`,
     `listSupportedBackends()`, and `resolveLatestBackendString()` in the existing
     `withTimeout` (20s each → `null`/`[]` on timeout, i.e. "no GPU recommendation"
     → CPU fallback) instead of awaiting unbounded. In the UI,
     [`SetupBackendStep`](web-app/src/containers/SetupBackendStep.tsx) gained a 30s
     watchdog that flips a still-`detecting` step to `detection-failed`
     (auto-advances to the model step), so the user is never trapped on the spinner.
     The `get_devices` probe is already bounded (30s, `device.rs`) and isn't even
     invoked on a clean install (CUDA tier not installed yet); the ATO-95
     hard-throw on an unresolved `latest` sentinel is already guarded and untouched.
- **Consequences:**
  - Clean Windows installs persist config on first launch (ATO-107). CUDA-13
    survives future ggml-org minor bumps with no source edits (ATO-105).
    Onboarding can no longer hang indefinitely on detection; worst case it
    degrades to CPU and the user proceeds (ATO-104).
  - **Deferred (non-code):** the exact 1.1.98→1.1.103 regressor for ATO-104 still
    needs the user's `Settings → Logs` capture and a per-release bisect. The
    hardening makes the symptom non-fatal but does not, by itself, prove the
    original cause.
  - **Verification:** `cargo check -p Atomic-Chat` and the upstream plugin both
    compile (0 errors, pre-existing dead_code warnings only); `cargo test` in
    `tauri-plugin-llamacpp-upstream` → 37 backend tests pass (incl. new
    `test_determine_supported_backends_windows_cuda13_family_id` and the
    `win-cuda-13-x64` map round-trip). `tsc --noEmit` clean on the upstream
    extension; eslint clean on `SetupBackendStep.tsx`. macOS/Linux paths
    untouched; no settings-schema, IPC, or on-disk-layout changes.
- **Owner:** team.
- **Links:** [ATO-107](https://linear.app/atomicchat/issue/ATO-107),
  [ATO-105](https://linear.app/atomicchat/issue/ATO-105),
  [ATO-104](https://linear.app/atomicchat/issue/ATO-104), the 2026-05-26 ADR
  *Correct CUDA 13.1 driver gate …* and the 2026-06-05 ADRs *Resolve the
  `latest/<backend>` sentinel …* / *Make the Windows release backend download
  asset-aware …*, §4.2 *LLM backend*, files:
  [`src-tauri/src/core/app/commands.rs`](src-tauri/src/core/app/commands.rs)
  (`get_app_configurations`, `update_app_configuration`),
  [`src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/backend.rs`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/backend.rs)
  (`determine_supported_backends`, `map_old_backend_to_new`),
  [`extensions/llamacpp-upstream-extension/src/backend.ts`](extensions/llamacpp-upstream-extension/src/backend.ts)
  (`listSupportedBackends`),
  [`extensions/llamacpp-upstream-extension/src/index.ts`](extensions/llamacpp-upstream-extension/src/index.ts)
  (`recheckOptimalBackend`),
  [`web-app/src/containers/SetupBackendStep.tsx`](web-app/src/containers/SetupBackendStep.tsx).

### 2026-06-08 — Honor `generation_config.json::suppress_tokens` and install a Gemma chat-template fallback in the `mlx-vlm` server (ATO-88 head 1, second follow-up)
- **Context:** After the same-day #1288 cherry-pick fixed the *quant/prefill*
  corruption (sidecar `mlxvlm-macos-arm64-88d260c`), live testing of
  `gemma-4-12B-4bit` (`model_type: gemma4_unified`, an omni vision+audio build)
  against the running dev app's `http://localhost:1337/v1` showed the model was
  **still unusable**, but for two *new*, independent reasons — neither a quant
  issue nor app-side. Empirical findings on the live sidecar:
  - **temp=0 (greedy, the sidecar default):** repetition loops **plus** a flood
    of leaked `<image>`/`<audio>` control tokens.
  - **temp=1.0/top_k=64/top_p=0.95 (Gemma's own recommended sampling):** no
    loops, no leak, but **incoherent rambling** — even "What is the capital of
    France?" was never answered.
  - Suppressing token ids `258883`/`258882` via a request `logit_bias` killed
    the `<image>`/`<audio>` leak instantly; framing the prompt with the
    canonical Gemma turn markers (sent as pre-framed content) made the model
    answer **"The capital of France is Paris."** correctly.

  Two root causes, both **server-side in the fork**, confirmed against the code:
  1. **`suppress_tokens` ignored.** The model ships
     `generation_config.json::suppress_tokens: [258883, 258882]` (its image/audio
     soft-token ids, which must never appear in text). `_collect_stop_tokens`
     mined that file **only** for `eos_token_id`; nothing applied
     `suppress_tokens`, so they leaked.
  2. **No `chat_template`.** This MLX conversion dropped `chat_template` from
     `tokenizer_config.json` (and ships none in `tokenizer.json` or a separate
     file). `prompt_utils.get_chat_template` then falls back to
     `_messages_to_plain_prompt`, which for a single user turn returns the **raw
     content with no `<start_of_turn>` framing**. The instruction-tuned model,
     fed unframed text, does base-style document continuation (echo / ramble)
     instead of answering. `add_special_tokens` only re-adds `<bos>`, not turn
     markers. (All local Gemma 4 MLX builds — E2B/E4B/12B — lack the template.)
- **Decision:** Fix both in `AtomicBot-ai/mlx-vlm` (`mlx_vlm/server/`), no
  Atomic-Chat app change.
  1. **Suppress tokens.** New `_collect_suppress_tokens(model_path)` reads
     `generation_config.json::suppress_tokens` (mirrors the EOS collector's
     hardening: int-only, drops bools). Stored on the generator as
     `self.suppress_tokens` in `_initialize_model`. `_make_logits_processors`
     merges them into the request's `logit_bias` at `-1e9` via `setdefault`
     (large-but-finite to avoid post-temperature NaN; `setdefault` preserves any
     explicit caller bias). Applies on every request through the non-speculative
     continuous-batch path. *(Known limitation: the separate `_run_speculative`
     loop samples without `_make_logits_processors`, so suppression does not yet
     cover speculative decoding — irrelevant for the omni models in scope, which
     run no draft.)*
  2. **Gemma template fallback.** *(Partly superseded — see the 2026-06-08 ADR
     above: the Gemma 3 `<start_of_turn>` template was the **wrong dialect** for
     `gemma4*`, which use `<|turn>`/`<turn|>`; `gemma4*` now get a dedicated
     `GEMMA4_UNIFIED_CHAT_TEMPLATE`. The Gemma 3 template below remains correct
     for `gemma3`/`gemma3n`.)* New module
     `mlx_vlm/server/_chat_templates.py` carries the authoritative Gemma turn
     template (`<start_of_turn>` framing, emits its own `bos_token`), embedded
     **byte-exact** (1532 B, `json.dumps`) from the non-gated published Gemma 3
     IT template (identical turn structure across Gemma 2/3/4 text + image). New
     `_maybe_install_gemma_chat_template(processor, config)` assigns it to the
     processor **and** tokenizer in `_initialize_model`, but **only** when
     `model_type ∈ {gemma3, gemma3n, gemma4, gemma4_unified}` **and** no template
     is already present (never clobbers a real one; idempotent). The existing
     `_cpu_preprocess` gate then sees a non-`None` `chat_template` and flips
     `add_special_tokens` to `False`, so `<bos>` comes from the template — no
     double BOS.
- **Consequences:**
  - **Validated** (without reloading the 12B, to avoid competing with the live
    sidecar): `_collect_suppress_tokens` → `[258882, 258883]`;
    `_maybe_install_gemma_chat_template` builds
    `<bos><start_of_turn>user\n…<end_of_turn>\n<start_of_turn>model\n` for text
    and folds system → first user turn with correct user/model alternation for
    multi-turn; idempotent on second call. End-to-end on the live sidecar,
    proper framing + suppression already yielded a correct, leak-free answer.
    `py_compile` clean; lint clean.
  - **Committed `654a520` and pushed to `origin/main`** (`88d260c..654a520`, no
    force). The push re-triggers `build-mlxvlm-macos.yml` → a new sidecar release
    **`mlxvlm-macos-arm64-654a520`**. **Not yet shipped to the app:** run
    `make build-mlx-server` (or `-if-exists` auto-update) so
    `src-tauri/resources/bin/mlx-server-version.txt` flips `88d260c → 654a520`,
    then restart. Final runtime confirmation on Apple Silicon (coherent answer,
    no `<image>`/`<audio>`, generation halts at `<end_of_turn>`) is pending that
    bump.
  - **Sampling (ATO-99) is a separate, still-open matter.** The template +
    suppress fixes are necessary and sufficient for *coherence and cleanliness*;
    Gemma still benefits from its recommended sampling (temp 1.0 / top_k 64 /
    top_p 0.95) to avoid greedy repetition, which is an app-side default we have
    not yet wired per model family.
  - The Gemma-3 fallback template handles text + image (`<start_of_image>`) but
    not audio framing; the omni audio-input path is not covered by the fallback
    (text/image chat — the failing case — is). Fetching the exact Gemma 4 omni
    template (gated) is a future refinement.
- **Owner:** team.
- **Links:** [ATO-88](https://linear.app/atomicchat/issue/ATO-88),
  [ATO-99](https://linear.app/atomicchat/issue/ATO-99), §4.1 *MLX backend*, the
  2026-06-08 ADR *Cherry-pick mlx-vlm #1288 …* (immediately below), fork commit
  `654a520`, files: `mlx_vlm/server/_chat_templates.py`,
  `mlx_vlm/server/generation.py`
  (`_collect_suppress_tokens`, `_maybe_install_gemma_chat_template`,
  `_make_logits_processors`, `_initialize_model`).

### 2026-06-08 — Cherry-pick mlx-vlm #1288 into the fork to fix Gemma 4 12B MLX garbled generation (ATO-88 head 1 follow-up)
- **Context:** After the 2026-06-05 ADR landed `gemma4_unified` in the fork
  (sidecar `mlxvlm-macos-arm64-f42f567`), Gemma 4 12B **loads** under MLX but
  **generates garbage** — incoherent text interleaved with leaked multimodal
  special tokens (`<image>` / `<audio>`) and stray markup. Root cause: the
  shipped sidecar predates upstream **`9c788e4` "Adjust Gemma4 quantization
  predicate" ([Blaizzy/mlx-vlm #1288](https://github.com/Blaizzy/mlx-vlm/pull/1288))**,
  which landed on `upstream/main` *after* our `f42f567`. #1288 carries two
  fixes that both bite this symptom: (1) it **removes the forced 8-bit/group-64
  override on Gemma 4 MLP proj layers** (`mlp.{gate,up,down}_proj`) in
  `gemma4/language.py`'s quantization predicate — a mismatch between that
  override and how the user's 4-bit repo was actually quantized corrupts the
  loaded weights; (2) it adds a model-level **`chunked_prefill_policy`** to
  `gemma4_unified.py` + `gemma4/language.py` (wired through `generate/ar.py`'s
  new `_chunked_prefill_enabled`) that disables chunked prefill for the
  vision-bidirectional / omni path, fixing prompt-prefill corruption.
- **Decision:** Cherry-pick `9c788e4` whole onto a `fix/gemma4-quant-prefill`
  branch off `main` (`f42f567`) in `AtomicBot-ai/mlx-vlm`, rather than a full
  upstream re-sync (which would re-trigger the heavily-forked `server/` +
  `ar.py` re-port pain). The pick applied **cleanly, zero conflicts**
  (auto-merge of `ar.py`, `gemma4/language.py`, `test_generate.py`). Verified
  post-pick: our MTP-rollback coercion is preserved
  (`gemma4/language.py: accepted = mx.array(list(accepted), dtype=mx.int32)`),
  the MLP quant override is gone, `chunked_prefill_policy` is present in both
  modules, `py_compile` clean on all six changed files (incl. the unrelated
  `hunyuan_vl/language.py` RoPE-dtype hunk that rode along in #1288).
- **Consequences:**
  - Fast-forwarded `fix/gemma4-quant-prefill` (`88d260c`) into `main` and
    **pushed to `origin/main`** (`f42f567..88d260c`, no force). The push
    triggers `build-mlxvlm-macos.yml` (paths `mlx_vlm/**`), which will tag a
    new sidecar release **`mlxvlm-macos-arm64-88d260c`**.
  - **Not yet shipped to the app:** Atomic-Chat must run `make build-mlx-server`
    (or the `-if-exists` auto-update) to pull + re-codesign the new binary;
    `src-tauri/resources/bin/mlx-server-version.txt` flips from `f42f567` to
    `88d260c`. **Runtime validation on Apple Silicon** (load `gemma-4-12B-it`,
    confirm coherent output) is pending that sidecar bump — not provable from
    the code pick alone. If garbage persists, the next suspect is the
    downloaded 4-bit repo itself (re-quantize under the new predicate).
  - No Atomic-Chat app/extension/Rust code changed; this is a sidecar-only fix
    (the MLX extension/plugin resolve by `model_type` via the sidecar).
- **Owner:** team.
- **Links:** [ATO-88](https://linear.app/atomicchat/issue/ATO-88), §4.1 *MLX
  backend*, the 2026-06-05 ADR *Port `gemma4_unified` … into the `mlx-vlm`
  fork*, [Blaizzy/mlx-vlm #1288](https://github.com/Blaizzy/mlx-vlm/pull/1288)
  (`9c788e4`), [#1267](https://github.com/Blaizzy/mlx-vlm/pull/1267),
  [#1280](https://github.com/Blaizzy/mlx-vlm/pull/1280),
  [#1292](https://github.com/Blaizzy/mlx-vlm/pull/1292), fork
  `AtomicBot-ai/mlx-vlm` `main` @ `88d260c`, `Makefile` (`build-mlx-server`).

### 2026-06-08 — Add Gemma 4 MTP speculative decoding to `llamacpp-upstream` via a separate draft head (PR #23398; closes ATO-88 head 2)
- **Context:** Upstream `ggml-org/llama.cpp` merged Gemma 4 Multi-Token
  Prediction ([PR #23398](https://github.com/ggml-org/llama.cpp/pull/23398),
  commit `04eb4c4`, first tagged release **`b9553`**). This was the
  remaining blocker on **head 2 of [ATO-88](https://linear.app/atomicchat/issue/ATO-88)**
  ("llama.cpp Gemma 4 MTP GGUF", previously upstream-blocked). Unlike Qwen
  3.6 built-in MTP — where the head lives *inside* the same GGUF and we just
  pass `--spec-type draft-mtp` (gate `MTP_MIN_BUILD=9180`,
  [`args.rs`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/args.rs)) —
  Gemma 4 ships the MTP head as a **separate draft GGUF** loaded via
  `--model-draft <head>`. Upstream MTP support covers **only Gemma 4 31B
  (dense) and 26B-A4B (MoE)**; the E2B/E4B drafter was deferred upstream and
  12B has no head. The same `b9553` bump also fixes plain Gemma 4 GGUF
  loading and unblocks QAT (ATO-101/99) — that bundle bump is owned
  separately; here we only encode the runtime wiring and a version gate.
- **Decision:** Wire Gemma 4 MTP end-to-end in the **`llamacpp-upstream`**
  provider, reusing the existing provider-level `mtp` toggle and
  distinguishing the two shapes by the presence of a draft path:
  1. **Head registry** (NEW
     [`extensions/llamacpp-upstream-extension/src/gemmaMtpRegistry.ts`](extensions/llamacpp-upstream-extension/src/gemmaMtpRegistry.ts)):
     static target→head map with HF-API-verified `sha256` + `size`.
     **31B → `am17an/Gemma4-31B-it-GGUF` / `mtp-gemma-4-31B-it.gguf`** (the
     PR author's reference head). **26B-A4B →
     `AtomicChat/gemma-4-26B-A4B-it-assistant-GGUF` /
     `gemma-4-26B-A4B-it-assistant.Q8_0.gguf`** — am17an published *no* 26B
     repo (the plan's `am17an/Gemma4-26B-A4B-it-GGUF` does not exist), so we
     point at our **first-party** head, which is model-identical to the
     upstream reference (the 31B AtomicChat `Q8_0` head matches am17an's head
     byte-size) and guaranteed-stable as our own org. `barozp/*-mtp-BF16` and
     any 12B/E2B/E4B head are deliberately **not** supported.
  2. **Extension** ([`index.ts`](extensions/llamacpp-upstream-extension/src/index.ts)):
     new `mtp_draft_path` field in `model.yml`; `ensureGemmaMtpDraft(modelId)`
     downloads the head (idempotent, sha256/size-validated, via
     `@janhq/download-extension`) into
     `<jan>/llamacpp/models/<id>/mtp-draft.gguf` and records the relative
     path in `model.yml`; `performLoad` resolves it to an absolute
     `cfg.mtp_draft_path` only when `cfg.mtp` is on. **Lazy resolution:** if
     `cfg.mtp` is on, the model is a Gemma 4 31B/26B-A4B target, and no
     `mtp_draft_path` is recorded yet, `performLoad` calls
     `ensureGemmaMtpDraft` itself (then re-reads `model.yml`) — so the single
     "Enable MTP" toggle is robust even when it was flipped on with no Gemma
     model active (a download failure is logged and the load proceeds
     text-only, never crashing). `checkGemmaMtpSupport` exposes the registry to
     the UI.
  3. **Rust** ([`args.rs`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/args.rs)):
     new `#[serde(default)] mtp_draft_path: String`; new constant
     **`GEMMA_MTP_MIN_BUILD=9553`**; `add_mtp_args` now branches — with a
     draft path it emits `--model-draft <path> --spec-type draft-mtp
     --spec-draft-n-max 4` gated on `9553`; without one it keeps the Qwen
     path (`--spec-type draft-mtp --spec-draft-n-max 2`, gate `9180`)
     unchanged. **KV-quant guard:** when a draft path is set and `cache_type_k/v`
     is non-`f16`, we `log::warn!` (PR #23398 reviewers reported q8_0 KV +
     Vulkan dropping draft acceptance to ~0) — we warn, we do not override the
     user's KV choice.
  4. **guest-js** (`types.ts` + `normalizeLlamacppConfig`): `mtp_draft_path`
     added to `LlamacppConfig` and `ModelConfig`.
  5. **UI** ([`$providerName.tsx`](web-app/src/routes/settings/providers/$providerName.tsx)):
     `handleToggleLlamacppMtp` gains a Gemma branch — if the active model
     isn't Qwen-MTP (`id` contains "mtp"), it calls `checkGemmaMtpSupport`;
     on a Gemma target it downloads the head (`ensureGemmaMtpDraft`) before
     writing `mtp=true` and reloading; otherwise the existing
     `LlamacppMtpUnsupportedDialog` is shown (now also lists the two Gemma
     targets). New i18n keys `llamacppMtpDownloadingDraft` /
     `llamacppMtpGemmaSupported*` (EN + RU).
- **Consequences:**
  - Gemma 4 **31B** and **26B-A4B** get MTP speculative decoding on
    `llamacpp-upstream` once the bundle is `>= b9553`; on older bundles the
    Gemma path is skipped with a `warn!` (no broken flag passed to
    `llama-server`). Qwen built-in MTP is untouched (separate gate, no
    `--model-draft`). MoE (26B-A4B) gains may be marginal — expected.
  - The MTP head is small (~460–515 MB) and shares the existing model-folder
    download/validation path; both providers share the GGUF tree
    (`MODELS_PROVIDER_ROOT='llamacpp'`) so the head lives beside the target.
  - **Deviation from the plan:** the plan named `am17an/Gemma4-26B-A4B-it-GGUF`
    as the 26B source; it does not exist on HF. Verified-real first-party
    `AtomicChat/gemma-4-26B-A4B-it-assistant-GGUF` is used instead (no
    fabricated repo). macOS turboquant `llamacpp` provider, MLX, and Windows
    are unaffected (this is the upstream provider; the bundle gate keeps it
    inert until `b9553`).
  - **Verification:** new `args.rs` unit tests cover the Gemma path
    (`--model-draft` + n-max 4 at b9553, skipped below b9553, Qwen path
    unaffected, embedding-mode skip). Runtime validation on a `>= b9553`
    bundle (draft acceptance > 0 on 31B) is pending that bundle bump
    (ATO-101).
- **Owner:** team.
- **Links:** [PR #23398](https://github.com/ggml-org/llama.cpp/pull/23398),
  [ATO-88](https://linear.app/atomicchat/issue/ATO-88),
  [ATO-101](https://linear.app/atomicchat/issue/ATO-101),
  [ATO-99](https://linear.app/atomicchat/issue/ATO-99), §4.2 *LLM backend*,
  files: [`gemmaMtpRegistry.ts`](extensions/llamacpp-upstream-extension/src/gemmaMtpRegistry.ts),
  [`index.ts`](extensions/llamacpp-upstream-extension/src/index.ts),
  [`args.rs`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/args.rs),
  [`guest-js/types.ts`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/guest-js/types.ts),
  [`$providerName.tsx`](web-app/src/routes/settings/providers/$providerName.tsx),
  [`LlamacppMtpUnsupportedDialog.tsx`](web-app/src/containers/dialogs/LlamacppMtpUnsupportedDialog.tsx).

### 2026-06-05 — Make the Windows release backend download asset-aware to beat the ggml-org "tag-marked-latest-before-asset-uploaded" race (ATO-95, CI)
- **Context:** The `build-windows` job's inline "Download upstream llamacpp
  backend" step in [`.github/workflows/release.yml`](.github/workflows/release.yml)
  failed with `curl: (22) … 404` on
  `…/releases/download/b9530/llama-b9530-bin-win-cpu-x64.zip`. Root cause is a
  **publish race** in the ggml-org/llama.cpp release stream, not a bad tag:
  GitHub Actions on the upstream side creates the `bXXXX` tag and marks it
  "latest" the instant the release is created, but uploads the per-platform
  assets (macOS, Linux, then Windows `.zip`s) over the following minutes. The
  CI step resolved `GET /releases/latest` → `b9530`, then **blindly** built
  `llama-b9530-bin-win-cpu-x64.zip` and `curl -fSL`'d it — hitting the window
  where the tag exists but the Windows asset has not finished uploading
  (verified: at failure time the GitHub UI showed b9530 "Show all 23 assets
  Loading" with the Windows zip absent; minutes later the same asset URL
  returned 302→200). The runtime extension is **already** immune — its
  `fetchRemoteBackends()` only returns backends whose asset is actually present
  in the release JSON, so the prior-turn `resolveLatestBackendString` fix
  degrades gracefully — but the CI shell step trusted the tag alone.
- **Decision:** Resolve the tag **asset-aware** instead of trusting
  `/releases/latest`. The step now lists
  `GET /releases?per_page=20` and picks, via `jq`, the **newest non-draft /
  non-prerelease release whose `assets[].name` already contains
  `llama-<tag>-bin-win-cpu-x64.zip`** (`_resolve_tag`). A too-fresh release
  whose Windows asset is still uploading is skipped in favour of the previous
  fully-published one. The retry/​auth helpers (`_gh_get` / `_gh_fetch`) are
  unchanged; `_tag_ok` (top-level `.tag_name` probe, invalid for a list
  response) is replaced by `_release_ok` (non-empty JSON array). The asset
  download itself gains `--retry 5 --retry-delay 3` for transient-network
  resilience (404 no longer reachable since the asset is verified present).
- **Consequences:**
  - The Windows release build no longer 404s during the upstream asset-upload
    window; on the rare run that catches a brand-new tag mid-upload it bundles
    the previous release's `win-cpu-x64` build (one build older, fully valid)
    instead of failing. `per_page=20` is ample — every ggml-org release ships
    `win-cpu-x64`.
  - **Scope: every build-time backend-download site that trusted the tag was
    hardened the same way** (the failing `build-windows` inline step *plus* all
    its siblings, since they share the identical latent defect and the same
    upstream release stream):
    1. [`.github/workflows/release.yml`](.github/workflows/release.yml) —
       `build-windows` inline step (the one that actually 404'd). Asset-aware
       `jq` resolver (`_resolve_tag`), `_tag_ok` → `_release_ok` (array check),
       `curl --retry 5 --retry-delay 3`.
    2. [`Makefile`](Makefile) `download-llamacpp-upstream-backend` — **all three
       branches** (macOS `…-bin-<macos-arch>.tar.gz`, Windows
       `…-bin-<backend>.zip`, Linux `…-bin-ubuntu-x64.tar.gz`). Each `else`
       (fetch-latest) path now lists `?per_page=20`, resolves via the inline
       asset-aware `jq`, and the asset `curl` gains `--retry`. The
       `LLAMACPP_UPSTREAM_TAG` pin path is **untouched** (trust an explicit
       pin, no asset check). `_tag_ok` body switched to a non-empty-array probe
       in all three branches.
    3. [`Makefile`](Makefile) `download-llamacpp-upstream-backend-win-cpu`
       (PowerShell) — `Invoke-RestMethod` now lists releases and `foreach`-picks
       the newest carrying `llama-<tag>-bin-win-cpu-x64.zip`, plus a 5-try
       `Invoke-WebRequest` retry loop.
    4. [`scripts/build-windows-release.ps1`](scripts/build-windows-release.ps1)
       and [`scripts/dev-windows.ps1`](scripts/dev-windows.ps1) — same
       asset-aware `foreach` resolution + download retry loop (dev-windows keys
       the asset name off its auto-detected `$backend`).
    A too-fresh release whose target asset is still uploading is skipped in
    favour of the previous fully-published one; `per_page=20` is ample since
    every ggml-org release ships these assets.
  - Pure build/CI change; no app code, no Rust, no bundled-artefact layout
    change. The `LLAMACPP_UPSTREAM_TAG` override semantics are preserved.
    Verified: `release.yml` YAML parses (ruby + js-yaml); `make -n` confirms the
    three bash branches and the PowerShell target expand correctly (`$$`→`$`,
    jq program intact, retry flags present); the `jq` resolver run against the
    live GitHub API returns `b9530` (newest release actually carrying the
    asset). `pwsh` is unavailable on the dev host, so the two standalone `.ps1`
    scripts were validated by expansion/brace review, not execution.
- **Owner:** team.
- **Links:** [ATO-95](https://linear.app/atomicchat/issue/ATO-95-windows-skachivanie-llamacpp-cpu-bekenda-padaet-bityj-url-s-latest),
  the prior 2026-06-05 ADR *Resolve the `latest/<backend>` sentinel …*,
  the 2026-05-22 ADR *Windows ships only `llamacpp-upstream`*,
  [ggml-org/llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases),
  files: [`.github/workflows/release.yml`](.github/workflows/release.yml)
  (`build-windows` step), [`Makefile`](Makefile)
  (`download-llamacpp-upstream-backend` ×3 branches +
  `download-llamacpp-upstream-backend-win-cpu`),
  [`scripts/build-windows-release.ps1`](scripts/build-windows-release.ps1),
  [`scripts/dev-windows.ps1`](scripts/dev-windows.ps1).

### 2026-06-05 — Resolve the `latest/<backend>` sentinel before download + fix "Install from file" on Windows/Linux `llamacpp-upstream` (ATO-95)
- **Context:** A Windows user (Discord, via [ATO-95](https://linear.app/atomicchat/issue/ATO-95-windows-skachivanie-llamacpp-cpu-bekenda-padaet-bityj-url-s-latest))
  could not download the llama.cpp CPU backend, and the "Install from file"
  button did nothing. Two independent bugs in the `llamacpp-upstream`
  provider:
  - **Bug 1 — literal `latest` in the download URL → 404.** The static
    "Latest <variant>" dropdown entries carry a `latest/<backend>` sentinel
    (`extensions/llamacpp-upstream-extension/src/index.ts`), which MUST be
    resolved to a concrete ggml-org release tag (`bXXXX`) before download —
    ggml-org has no `latest` release tag (the `latest` keyword is valid only
    for the `/releases/latest` HTML page, not the `/releases/download/<tag>/…`
    asset path). Resolution existed in `downloadManualBackend()` /
    `onSettingUpdate()` but **not** in the
    `downloadRecommendedBackend → downloadAndInstallBackend →
    getBackendDownloadUrl` path used by onboarding (`SetupBackendStep`) and
    the "Find optimal backend" button. `recheckOptimalBackend()` also
    hard-coded a `|| 'latest'` fallback, and neither `getBackendDownloadUrl`
    nor `downloadAndInstallBackend` guarded against `version === 'latest'` —
    they silently built `…/releases/download/latest/llama-latest-bin-win-cpu-x64.zip`
    (verified 404 against the live GitHub API 2026-06-05; current tag `b9529`,
    correct asset `llama-b9529-bin-win-cpu-x64.zip`).
  - **Bug 2 — "Install from file" no-op on Windows/Linux.**
    `handleInstallBackendFromFile` (`web-app/src/routes/settings/providers/$providerName.tsx`)
    early-returned unless the provider was `llamacpp` or `mlx`, but the local
    provider id on Windows/Linux is `llamacpp-upstream` (`LOCAL_LLAMACPP_PROVIDER`).
    The button is rendered for it, so the click hit the guard and bailed.
- **Decision:** Implement the ticket's three-part fix for Bug 1 plus the
  one-line allowlist fix for Bug 2.
  - `downloadRecommendedBackend` now resolves a leading `latest/<backend>`
    sentinel up front via `resolveLatestBackendString()` (ggml-org release
    lookup), falling back to `newestInstalledOfFamily()` (newest locally
    installed copy) when the release stream is unreachable, and throws when
    neither yields a concrete tag — mirroring `downloadManualBackend`.
  - `recheckOptimalBackend`'s `|| 'latest'` fallback is removed: when
    `listSupportedBackends()` / `findLatestVersionForBackend()` come up empty
    it now calls `resolveLatestBackendString(idealType)`; only if that also
    fails does it reuse the **current** backend's concrete tag, and it
    returns `null` (no recommendation) rather than ever emitting a `latest`
    tag when there is no current tag to borrow.
  - Defense-in-depth: `getBackendDownloadUrl` (`backend.ts`) and
    `downloadAndInstallBackend` (`index.ts`) now `throw` on
    `version === 'latest'` instead of building a 404 URL.
  - Bug 2: the `handleInstallBackendFromFile` guard accepts
    `LOCAL_LLAMACPP_PROVIDER` (already imported in the file); the success
    toast's display name no longer mislabels the upstream provider as "MLX".
- **Consequences:**
  - Onboarding and "Find optimal backend" download a concrete `bXXXX`
    backend on Windows/Linux instead of dead-ending on a 404; offline /
    rate-limited hosts fall back to the newest locally-installed copy or fail
    with an actionable error rather than a silent bad URL. "Install from file"
    works for `llamacpp-upstream`. The `installBackend` hook already resolves
    the platform-active extension via `LOCAL_LLAMACPP_EXTENSION_NAME`, so no
    downstream change was needed.
  - Pure TS/UI change; no Rust, no IPC, no on-disk layout, no settings schema
    changes. macOS (turboquant `llamacpp` provider) is unaffected. ReadLints
    clean on all three files; standalone `tsc`/`rolldown`/`vitest` runs in
    this env resolve to the root workspace config (pre-existing, unrelated
    failures) and are not authoritative for these scoped edits.
- **Owner:** team.
- **Links:** [ATO-95](https://linear.app/atomicchat/issue/ATO-95-windows-skachivanie-llamacpp-cpu-bekenda-padaet-bityj-url-s-latest),
  §4.2 *LLM backend*, the 2026-05-22 ADR *Windows ships only `llamacpp-upstream`*,
  files: [`extensions/llamacpp-upstream-extension/src/index.ts`](extensions/llamacpp-upstream-extension/src/index.ts)
  (`downloadRecommendedBackend`, `recheckOptimalBackend`, `downloadAndInstallBackend`),
  [`extensions/llamacpp-upstream-extension/src/backend.ts`](extensions/llamacpp-upstream-extension/src/backend.ts)
  (`getBackendDownloadUrl`),
  [`web-app/src/routes/settings/providers/$providerName.tsx`](web-app/src/routes/settings/providers/$providerName.tsx)
  (`handleInstallBackendFromFile`).

### 2026-06-05 — Port `gemma4_unified` (+ vision fixes) into the `mlx-vlm` fork so Gemma 4 12B loads under MLX (ATO-88, head 1)
- **Context:** Gemma 4 12B MLX (`gemma-4-12B-it-4bit`, `model_type:
 gemma4_unified`) failed to load with `Model type gemma4_unified not
 supported. Error: No module named 'mlx_vlm.speculative.drafters.gemma4_unified'`
 ([ATO-88](https://linear.app/atomicchat/issue/ATO-88)). Confirmed against
 sources: our fork `AtomicBot-ai/mlx-vlm` (`/Users/misha/Work/Atomic/mlx-vlm`,
 branch `sync/v0.6.0` @ `aed5482`, `__version__ = "0.6.0"`) has
 `mlx_vlm/models/gemma4` but **no** `gemma4_unified`. Upstream
 `Blaizzy/mlx-vlm` added it in **0.6.1** (PR #1267, `608ce45`); the model
 resolver (`mlx_vlm/utils.py::get_model_and_args`) auto-imports
 `mlx_vlm.models.<type>` / `mlx_vlm.speculative.drafters.<type>`, so a missing
 package = unsupported type. The bundled sidecar
 (`mlxvlm-macos-arm64-aed5482`, 2026-06-02) predates the fix. ATO-88 head 2
 (llama.cpp Gemma 4 MTP GGUF) is **upstream-blocked** (no llama.cpp release
 supports it; WIP PR ggml-org/llama.cpp#23398) and was **deliberately
 deferred** — not touched here.
- **Decision:** Sync the fix into the fork by **cherry-picking a curated subset
 of upstream/main onto a new branch `feat/gemma4-unified`** (off `sync/v0.6.0`),
 rather than a full 33-commit merge (which would re-trigger the forked-server
 re-port pain from the 2026-06-02 v0.6.0 sync). Picked, in order:
 - `608ce45` PR #1267 — Add Gemma 4 Unified support (model dir + drafter
 `gemma4_unified_assistant` + additive `gemma4/*`, `prompt_utils`,
 `generate/*`; bumps `version.py` → `0.6.1`).
 - `041f889` PR #1280 — Fix Gemma4 unified long-text prefill.
 - `526c210` PR #1292 — Add video input support for Gemma 4 12B.
 **Deliberately skipped `b3d2380` PR #1266** ("Fix Gemma 4 rollback handling +
 streaming thinking splits"): our fork's rollback fix (2026-06-02 ADR) already
 covers the list-coercion case **more generally** (`elif not isinstance(accepted,
 mx.array)` vs upstream's `isinstance(accepted, (list, tuple))`), and #1266's
 bulk is server-streaming changes (`anthropic.py`/`openai.py`/`responses_state.py`)
 that would collide with our heavily-forked `mlx_vlm/server/`.
- **Consequences:**
 - All three cherry-picks applied **cleanly, zero conflicts**, including on the
 two risk files `models/gemma4/language.py` (carries our MTP-rollback coercion
 — verified preserved at lines ~723–729 post-merge) and `server/generation.py`
 (our forked server). `python3 -m py_compile` passes on all 17 changed
 modules; fork `version.py` is now `0.6.1`.
 - **Text Gemma 4 12B Unified now resolves & loads under MLX.** Vision/long-text
 covered by #1280/#1292; some vision edge cases may remain (upstream is still
 iterating — see branches `pc/fix-gemma4-long-context`,
 `pc/gemma4-quant-predicate-size`). Not pulling those yet.
 - **Merged to fork `main`.** `feat/gemma4-unified` was fast-forwarded into
 `main` (clean `aed5482..f42f567`, no force) and **pushed to
 `origin/main`** of `AtomicBot-ai/mlx-vlm`; `main` now carries both the
 prior v0.6.0 sync (already there at `aed5482`) and the three gemma4
 commits. **Not yet shipped to the app:** a new sidecar release
 `mlxvlm-macos-arm64-<sha>` must be built (CI `build-mlxvlm-macos.yml`) for
 `f42f567`, then `make build-mlx-server` in Atomic-Chat (or the `-if-exists`
 auto-update) pulls + re-codesigns it. **Runtime validation on Apple Silicon
 (load + a text and an image turn on `gemma-4-12B-it-4bit`) is pending that
 build** — not doable from the code port alone.
 - No Atomic-Chat code changed for head 1 (the extension/plugin already resolve
 by model_type via the sidecar). Head 2 remains open as a separate task.
- **Owner:** team.
- **Links:** [ATO-88](https://linear.app/atomicchat/issue/ATO-88), §4.1 *MLX
 backend*, the 2026-06-02 ADRs *Sync `mlx-vlm` to v0.6.0* and *Fix MTP
 speculative rollback crash on Gemma 4 + DeepSeek-V4*,
 [Blaizzy/mlx-vlm PR #1267](https://github.com/Blaizzy/mlx-vlm/pull/1267),
 [#1280](https://github.com/Blaizzy/mlx-vlm/pull/1280),
 [#1292](https://github.com/Blaizzy/mlx-vlm/pull/1292),
 [issue #1277](https://github.com/Blaizzy/mlx-vlm/issues/1277),
 fork `AtomicBot-ai/mlx-vlm` branch `feat/gemma4-unified`, `Makefile`
 (`build-mlx-server`).

### 2026-06-05 — Parse `openclaw.json` with a JSON5-lenient parser (ATO-87)
- **Context:** Atomic Chat and OpenClaw read the **same** file
 `~/.openclaw/openclaw.json` with **different** parsers. OpenClaw uses
 lenient **JSON5** (comments, unquoted keys, trailing commas); our
 `configure_openclaw` in
 [`src-tauri/src/core/system/commands.rs`](src-tauri/src/core/system/commands.rs)
 used strict `serde_json::from_str`. A user (Discord, via [ATO-87](https://linear.app/atomicchat/issue/ATO-87))
 followed support advice to wrap `model` in `{ primary: ... }` with an
 **unquoted** `primary` key — valid JSON5, invalid strict JSON. OpenClaw
 accepted and reloaded the config (`config change applied`), while Atomic
 Chat failed with `Could not parse … as JSON`, giving the user a
 contradictory signal. The old error was also uninformative (no line/column)
 and suggested a manual workaround instead of just parsing the file. This
 **reverses** the 2026-06-01 ADR note ("no `json5` dep added") now that the
 parser-strictness mismatch is a confirmed user-facing bug.
- **Decision:** Add the `json5 = "0.4"` crate and read `openclaw.json` with
 `json5::from_str::<serde_json::Value>` (single source of truth for parse
 strictness with OpenClaw). On parse failure, surface the json5 error
 verbatim (it carries the offending line/column) instead of the generic
 "add the provider manually" advice. We still re-serialize as **strict**
 pretty JSON on write, which normalizes the file (and silently drops any
 JSON5 comments) — acceptable since JSON5 is a strict-JSON superset, so the
 normalized output is still valid for OpenClaw.
- **Consequences:** Configs OpenClaw accepts (unquoted keys, comments,
 trailing commas) no longer break Atomic Chat's Launch-page OpenClaw flow.
 Parse errors now point at a location. The write step rewrites the file as
 strict JSON, so user comments are lost on the next `configure_openclaw`
 run — a deliberate, self-healing trade-off. Scope is limited to OpenClaw;
 the other agent config writers (Claude/Codex/OpenCode/Hermes/Droid) still
 use strict `serde_json` and are untouched. The possible file-watcher
 debounce loop noted in ATO-87 is **not** addressed here (separate ticket if
 confirmed). `cargo check -p Atomic-Chat` passes.
- **Owner:** team.
- **Links:** [ATO-87](https://linear.app/atomicchat/issue/ATO-87),
 the 2026-06-03 ADR *Fix OpenClaw Launch integration*, the 2026-06-01 ADR
 *Add a "Launch" page …* (the "no `json5` dep" note this supersedes),
 files: [`src-tauri/src/core/system/commands.rs`](src-tauri/src/core/system/commands.rs)
 (`configure_openclaw`), [`src-tauri/Cargo.toml`](src-tauri/Cargo.toml).

### 2026-06-04 — Resolve Windows CUDA-13 backend minor dynamically in `llamacpp-upstream`
- **Context:** `ggml-org/llama.cpp` periodically renames Windows CUDA-13 assets by toolkit minor (`13.1` → `13.3` → future `13.x`). Hardcoded ids in `llamacpp-upstream` caused "Failed to download GPU backend" 404 when recommendation/config emitted a stale `win-cuda-13.<old>-x64`.
- **Decision:**
  - In `extensions/llamacpp-upstream-extension/src/backend.ts`, treat Windows CUDA-13 as a family (`win-cuda-13.\d+-x64`) when parsing release assets and derive cudart archive/toolkit version directly from the resolved backend id instead of a fixed `13.3` map.
  - In `extensions/llamacpp-upstream-extension/src/index.ts`, make `detectIdealBackendType()` pick CUDA-13 from the current `listSupportedBackends()` result (actual published asset) instead of emitting a literal backend id.
  - In `src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/backend.rs`, generalize CUDA category matching (`cuda-13.*`) and make `is_cuda_installed` resolve runtime DLL names by CUDA **major** (11/12/13), so new 13.x minors do not break the cudart presence probe.
- **Consequences:** Recommendation/download flow now tracks whichever CUDA-13 minor ggml-org currently publishes without source edits for each minor bump; legacy `13.1`/`13.3` installs remain resolvable through existing migration/category logic.
- **Owner:** team.
- **Links:** [Issue #43](https://github.com/AtomicBot-ai/Atomic-Chat/issues/43), [ggml-org/llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases), files: `extensions/llamacpp-upstream-extension/src/backend.ts`, `extensions/llamacpp-upstream-extension/src/index.ts`, `src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/backend.rs`.

### 2026-06-04 — Resolve the login-shell PATH for Launch-page agent detection/install (fix `command not found` in packaged macOS builds)
- **Context:** A user on a packaged macOS build reported the Launch-page
  one-click flow failing: the bundled installers (and the auto-opened terminal)
  could not find `npm`/`node` or the freshly-installed agent binaries (e.g.
  `openclaw`), even though they were installed via Homebrew/nvm. Root cause: a
  GUI app launched from Finder/Dock inherits the minimal **launchd** PATH
  (`/usr/bin:/bin:/usr/sbin:/sbin`), which excludes the user tool dirs
  (`/opt/homebrew/bin`, `~/.nvm/versions/node/*/bin`, `~/.local/bin`, Volta,
  etc.). So both `detect_agent_installed` (`which`/`where`) and `install_agent`
  (spawning `npm`/`curl`/`powershell`) searched the wrong PATH. This affects
  **every** npm-based agent (Claude Code, Codex, OpenCode, Copilot, Droid,
  OpenClaw) only in packaged builds — `make dev` inherits the terminal PATH and
  masked the bug.
- **Decision:** Resolve the user's real PATH from their interactive login shell
  and apply it to the commands we spawn. New helpers in
  [`src-tauri/src/core/system/commands.rs`](src-tauri/src/core/system/commands.rs):
  1. `login_shell_path()` (Unix-only) runs `$SHELL -lic 'printf …"$PATH"'`
     (`-l` sources `.zprofile`/`.bash_profile` where Homebrew shellenv lives;
     `-i` sources `.zshrc`/`.bashrc` where nvm lives), parses the value out of a
     `__OCPATH__…__OCEND__` sentinel (so rc files that echo to stdout can't
     corrupt it), and caches the result in a `OnceLock` for the process lifetime
     (one shell spawn, not one per agent probe). Returns `None` on failure.
  2. `apply_login_path(&mut Command)` sets `PATH` from that value when present;
     **no-op on Windows**, where processes inherit the registry (user/system)
     PATH and the minimal-PATH problem does not occur (a restart after a fresh
     Node install is the only Windows caveat — out of scope here).
  Both `detect_agent_installed` and the `install_agent` spawn closure now call
  `apply_login_path` before launching. The auto-opened terminal
  (`open_agent_terminal`) already runs the user's login shell, so it needed no
  change.
- **Consequences:**
  - Packaged macOS/Linux builds find `npm`/`node` and the installed agent
    binaries reliably, with no user-visible permission prompt — the only
    prerequisite remains that Node/npm is installed on the machine.
  - One extra (cached) login-shell spawn per app session, ~1s, paid once.
  - Falls back safely to the inherited PATH if the probe fails or returns empty.
  - Windows behaviour is unchanged (still `cmd /C npm …`, inherited PATH).
- **Owner:** team.
- **Links:** Launch-page agents integration (this session),
  [`src-tauri/src/core/system/commands.rs`](src-tauri/src/core/system/commands.rs)
  (`login_shell_path`, `apply_login_path`, `detect_agent_installed`,
  `install_agent`).

### 2026-06-04 — Recover from unsupported multimodal projector (`gemma4a`) by falling back to text-only instead of crashing the load (issue #44)
- **Context:** Loading a multimodal model whose `mmproj.gguf` declares a
  projector type the bundled `llama.cpp`/`libmtmd` build can't build a graph
  for — e.g. the brand-new Gemma 4 audio projector `gemma4a` in
  `unsloth/gemma-4-E4B-it-IQ4_XS` on backend `b9495/macos-arm64` — aborts the
  whole `llama-server` with `clip.cpp:4391: Unknown projector type` →
  `ggml_abort` → SIGABRT (exit code 6) **during mtmd warmup, before the server
  reports ready** ([issue #44](https://github.com/AtomicBot-ai/Atomic-Chat/issues/44),
  confirmed against the user's `app.log`). The model never started — not even
  text-only — because the provider always appends `--mmproj` when an
  `mmproj.gguf` is present, and the UI surfaced only the generic
  `LlamaCppProcessError` ("The model process encountered an unexpected error.")
  since `LlamacppError::from_stderr` had no branch for this signature, even
  though the `MultimodalProjectorLoadFailed` error code was already defined but
  unused. Scope is `llamacpp-upstream` (the macOS/Windows/Linux upstream
  provider) per the issue; the parallel turboquant `llamacpp-extension` is left
  untouched.
- **Decision:** Detect the signature and auto-recover text-only.
  1. **Rust** ([`error.rs::from_stderr`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/error.rs)):
     classify stderr containing `unknown projector type` (lowercased) as
     `ErrorCode::MultimodalProjectorLoadFailed` with an actionable message
     ("This model's multimodal projector isn't supported by the current
     llama.cpp backend. Vision/audio is unavailable …"), placed after the OOM
     and arch checks so those still win.
  2. **TS** ([`index.ts::performLoad`](extensions/llamacpp-upstream-extension/src/index.ts)):
     when `loadLlamaModel` rejects with `code ===
     'MULTIMODAL_PROJECTOR_LOAD_FAILED'` **and** an `mmprojPath` was set, retry
     the load **once** with `mmprojPath = undefined` (text-only). On success,
     cache the session as usual and emit a native Tauri event
     `local_backend://multimodal_disabled_fallback` with `{ modelId }`. Any
     other error (or a retry that also fails) propagates unchanged.
  3. **web-app** ([`DataProvider.tsx`](web-app/src/providers/DataProvider.tsx)):
     subscribe to that Tauri event (alongside the existing
     `auto_increase_ctx_*` listeners) and show a one-shot, non-fatal
     `toast.warning` keyed `mmproj-fallback-<modelId>` telling the user
     vision/audio was disabled and the model loaded text-only.
- **Consequences:**
  - Multimodal models with an unsupported projector now **load and chat
    text-only** instead of failing the whole load with an opaque error; the
    user gets a clear, non-blocking notice. Text-only is a deliberate,
    behavior-changing fallback (vision/audio are silently dropped for that
    model on that backend) — judged better than a hard failure.
  - **Lossy by design:** the model's vision/audio capability is unavailable
    until the bundled backend ships a `libmtmd` that supports the projector;
    tracking upstream `gemma4v`/`gemma4a` mtmd support + bumping the bundled
    macOS build is a separate follow-up (not done here). No backend-currency
    gate or pre-launch projector compat check was added.
  - The retry is **single-shot** and only triggers on the specific error code
    with a present mmproj, so non-multimodal loads and other failure modes are
    unaffected. No new settings, IPC commands, deps, or on-disk paths.
    `cargo check -p tauri-plugin-llamacpp-upstream` passes (pre-existing
    warnings only); the three edited files are lint-clean;
    `DataProvider.test.tsx` passes. The unrelated web-app suite failures
    (hardware/models/interface/etc.) are pre-existing and network/env-bound.
- **Owner:** team.
- **Links:** [issue #44](https://github.com/AtomicBot-ai/Atomic-Chat/issues/44),
  §4.2 *LLM backend*, the 2026-06-02 ADR *Sync `mlx-vlm` to v0.6.0* (EAGLE-3/MTP),
  files: [`src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/error.rs`](src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/error.rs),
  [`extensions/llamacpp-upstream-extension/src/index.ts`](extensions/llamacpp-upstream-extension/src/index.ts)
  (`performLoad`),
  [`web-app/src/providers/DataProvider.tsx`](web-app/src/providers/DataProvider.tsx).

### 2026-06-03 — Fix OpenClaw Launch integration: select the model as primary, use the bare catalog id, and seed `gateway.auth.mode: "none"` on loopback
- **Context:** After installing OpenClaw via the Launch page and pressing
  Run, the CLI still booted into "deterministic typed commands until we
  configure a model" and could not reach its local gateway. Three distinct
  bugs in `configure_openclaw`
  ([`src-tauri/src/core/system/commands.rs`](src-tauri/src/core/system/commands.rs)),
  all confirmed against OpenClaw's own bundled docs
  (`docs/gateway/config-agents.md`, `docs/gateway/local-model-services.md`,
  `docs/gateway/openai-http-api.md`, `docs/gateway/remote.md`):
  1. We wrote the `agents.defaults.models` **allowlist** but never set
     `agents.defaults.model` (the primary selector), so no model was active.
  2. The provider catalog entry used `id: "atomic/<model>"`. OpenClaw builds
     a model ref as `<providerId>/<id>`, so the prefix doubled to
     `atomic/atomic/<model>` and lookup failed. The `id` must be the **bare**
     model id our `/v1` server reports (matching the `inferrs` example where
     `id: "google/gemma-4-E2B-it"` yields ref `inferrs/google/gemma-4-E2B-it`).
  3. OpenClaw's local gateway (`ws://127.0.0.1:18789`) refuses to open its
     websocket without connection auth (`gateway.auth.*`), which was unset.
- **Decision:**
  - Set `agents.defaults.model = "atomic/<model>"` (string form = `model.primary`)
    on every Run — Run is an explicit "use this", so it overwrites.
  - Write the provider catalog entry with the bare id (`{ id: model, name: model }`);
    the `atomic/<model>` ref form is used only for the primary selector and the
    `/model` allowlist key.
  - Seed `gateway.auth.mode: "none"` (private-ingress open auth) via `or_insert`
    so the loopback-only gateway is reachable with no token/password. This is
    documented as valid for loopback binds; **non-loopback binds still require
    token/password/trusted-proxy** and we never touch those. We preserve any
    `gateway.auth` mode a user set deliberately (seed-only, never clobber).
  - Seed `gateway.mode: "local"` (seed-only): `openclaw gateway` only starts in
    local mode, and the TUI needs it to treat the loopback gateway as locally
    managed.
  - **Launch `openclaw chat`, not bare `openclaw`.** Bare `openclaw` (once the
    config has authored settings) starts **Crestodian**, the configless-safe
    setup/repair helper that interprets input as deterministic typed commands
    (e.g. `yo` → a `status` report), not a conversation
    (`docs/cli/crestodian.md`). `openclaw chat` (= `openclaw tui --local`) runs
    the **embedded local agent runtime** (`docs/web/tui.md`), dropping the user
    straight into a chat with agent `main` on the configured model — and it
    needs **no gateway at all**. So the Launch page's auto-opened terminal runs
    `openclaw chat` for OpenClaw (other agents still launch their `detectBin`).
    This makes the gateway irrelevant to the default flow; the
    `gateway.mode`/`gateway.auth.mode` seeds above are kept only as
    forward-compat for users who manually run `openclaw` / `openclaw tui`.
    (An earlier iteration started `openclaw gateway` as a terminal background
    job via an `open_agent_terminal` `background` arg; that was removed once
    `openclaw chat` proved it needs no gateway.)
- **Consequences:** Pressing Run installs (if needed), configures, and opens a
  terminal where the user can immediately chat with the local model — verified
  end-to-end on macOS: `openclaw chat --local --message "…PONG"` replies `PONG`
  on agent `main` using `atomic/Qwen3.5-4B-MLX-4bit` via `:1337/v1`, with no
  gateway running. The loopback `auth.mode: "none"` seed is a security
  relaxation scoped to `127.0.0.1` only and only matters if the user opts into
  gateway mode manually; non-loopback binds still require explicit auth, which
  our seed-only logic leaves intact. Windows uses the same `openclaw chat`
  command (npm install path) but is **not yet validated**; flagged for a
  Windows test pass.
- **Owner:** team.
- **Links:** the 2026-06-01 ADR *Add a "Launch" page …*,
  [`src-tauri/src/core/system/commands.rs`](src-tauri/src/core/system/commands.rs)
  (`configure_openclaw`, `open_agent_terminal`),
  [`web-app/src/routes/launch/index.tsx`](web-app/src/routes/launch/index.tsx)
  (OpenClaw launches `openclaw chat`), OpenClaw bundled docs `docs/gateway/*`,
  `docs/start/openclaw.md`, `docs/platforms/macos.md`, `docs/cli/crestodian.md`,
  `docs/web/tui.md`.

### 2026-06-03 — Expand the MLX DFlash draft registry to the full z-lab collection (incl. Gemma 4) and fix the broken sharded Kimi-K2.5 entry
- **Context:** The DFlash auto-setup registry
  (`extensions/mlx-extension/src/dflashRegistry.ts`) carried 14 of the 20
  drafts published in the curated
  [z-lab/dflash](https://huggingface.co/collections/z-lab/dflash) collection.
  Six were missing — including the two most-downloaded heads in the whole
  collection (`Qwen3.6-27B-DFlash` ~80k, `gemma-4-31B-it-DFlash` ~37k). A live
  HF-API check of every new repo also revealed that **two Kimi drafts ship
  sharded safetensors** (`Kimi-K2.5-DFlash` = 2 shards + index, `Kimi-K2.6-DFlash`
  = 3 shards + index), not a single `model.safetensors`. The pre-existing
  `kimi-k2.5` entry used the default single-file `required` set, so its
  auto-download was **silently broken** — `ensureDraftDownloaded` would 404 on
  the non-existent `model.safetensors` (a hard error for a `required` file) and
  never fetch the shards.
- **Decision:** Add all six missing drafts and repair the sharded set.
  - New keys (normalized via `normalizeBaseId`, verified against EAGLE-3's
    existing gemma keys): `qwen3.6-27b`, `gemma-4-31b`, `gemma-4-26b-a4b`,
    `kimi-k2.6`, `minimax-m2.5`, `minimax-m2.7`.
  - **Gemma 4 gains a third speculative path.** Gemma 4 targets were previously
    served only by MTP (`*-assistant`) and EAGLE-3 (`RedHatAI/*-speculator.eagle3`).
    They now also resolve a DFlash draft (`z-lab/gemma-4-{31B,26B-A4B}-it-DFlash`),
    keyed `gemma-4-31b` / `gemma-4-26b-a4b` to mirror `eagle3Registry.ts`
    (the trailing `-it` is stripped by `TRAIL_HINT_RE`). The three families stay
    mutually exclusive via the existing UI mutex in
    `web-app/src/routes/settings/providers/$providerName.tsx`; the
    `performLoad` precedence (`mtp > eagle3 > dflash`) is unchanged.
  - **Sharded manifest helper.** New `shardedRequired(total)` generates
    `config.json` + `model.safetensors.index.json` + N
    `model-XXXXX-of-YYYYY.safetensors` files. `kimi-k2.5` now uses
    `shardedRequired(2)` (fixing the latent download bug) and `kimi-k2.6` uses
    `shardedRequired(3)`. The other five new repos ship a single
    `model.safetensors` (verified) and keep `DEFAULT_REQUIRED`.
- **Consequences:**
  - DFlash auto-setup now covers the entire z-lab collection (20/20). The two
    highest-traffic drafts and the Gemma 4 family are reachable; Kimi drafts
    actually download instead of erroring. All six repo file sets were confirmed
    against the live HF API (no fabricated filenames).
  - **Product caveat (not addressed here):** a DFlash draft is only useful when
    the matching base MLX model exists and runs locally. MiniMax / Kimi are
    large MoE targets; their entries are present for completeness but their
    practical reach depends on the user having a runnable MLX build of the base
    model. No gating was added — parity with the rest of the registry.
  - Pure data + one local helper; no network calls added to the resolution
    path, no Rust/contract changes. No registry unit tests exist yet.
- **Amendment (same day) — turn the "DFlash unavailable" dialog into an
  inline quant-picker + download/start surface, and close the normalization
  gaps it exposed.** `DflashUnsupportedDialog` now renders every supported base
  model as a Hub-style row (brand `ModelLogo` + name + a quantization
  `<select>` + the shared `MlxModelDownloadAction`). The quant picker is
  populated from the **clean precision builds that actually exist** on
  `mlx-community` (verified against the live HF API — bf16 / mxfp8 / 8/6/5/4/3
  bit / MXFP4 variants per model), ordered highest-first so the default is the
  largest build (bf16 where published).   Each row downloads in place via the shared
  `MlxModelDownloadAction` (progress/cancel) and flips to its own **"New chat"
  (start)** button the moment a matching build is already on disk — matched
  **fuzzily by base prefix + quant tokens** (`localIdMatches`), not by exact
  repo id, so an alternate packaging the user already has (e.g.
  `Qwen3.5-4B-MLX-4bit` when we offer `Qwen3.5-4B-4bit`) is recognized and
  started directly — no navigation to the Hub. The **Start** action launches
  the local build **with its DFlash draft already attached** and stays put (no
  new chat): a new parent handler `handleStartWithDflash` selects the model,
  `enableDflash` downloads/attaches the paired draft (writing engine config
  when no session exists yet, reloading in place if one does), then the
  idempotent `startModel` performs a single draft-carrying load. A
  `startedWithDflashRef` guard in the MLX flag-reset effect stops it from
  wiping `dflash_enabled` when that session becomes active, so the provider
  toggle correctly reflects the running draft. Verifying the repos surfaced gaps where ids did **not**
  normalize back to a registry key (so a draft would never pair): `gpt-oss-*`
  ships only `MXFP4-*` quants, `Kimi-K2.6` only `mxfp8`, and the only published
  `Qwen3-Coder-30B-A3B` MLX repos carry an `-Instruct` infix. Fixes: added
  `mxfp4` / `mxfp8` to `QUANT_SUFFIX_RE` (legitimate quant suffixes, stripped
  only at end → no false positives) and a `qwen3-coder-30b-a3b-instruct` alias
  key. All 107 offered quant repos now normalize to a `STATIC_DRAFT_MAP` key
  (verified by harness). The model→quant list is mirrored in web-app
  (`DflashUnsupportedDialog.tsx`) because web-app can't import the extension
  bundle; it MUST be kept in sync with the registry. New i18n key
  `settings:dflashSupportedListTitle` (EN + RU); the per-row action label comes
  from the shared `MlxModelDownloadAction` (`hub:download` / `hub:newChat`).
- **Owner:** team.
- **Links:** §4.1 *MLX backend*, the 2026-06-02 v0.6.0 sync ADR (EAGLE-3 / MTP
  drafter families), [z-lab/dflash](https://huggingface.co/collections/z-lab/dflash),
  files: [`extensions/mlx-extension/src/dflashRegistry.ts`](extensions/mlx-extension/src/dflashRegistry.ts),
  [`extensions/mlx-extension/src/eagle3Registry.ts`](extensions/mlx-extension/src/eagle3Registry.ts)
  (key convention reference),
  [`web-app/src/containers/dialogs/DflashUnsupportedDialog.tsx`](web-app/src/containers/dialogs/DflashUnsupportedDialog.tsx).

### 2026-06-02 — Add a `/v1/responses` translation shim to the local proxy so Codex CLI works on llama.cpp models
- **Context:** Codex CLI (added as a Launch integration in the 2026-06-01 ADR
  below) failed at the first turn against a local GGUF model with
  `unexpected status 404 Not Found, url: http://127.0.0.1:1337/v1/responses`.
  Root cause is twofold. (1) Codex speaks **only** the OpenAI **Responses**
  wire protocol: its `model_providers.<id>.wire_api` setting accepts
  `responses` as *the single supported value* and it is the default
  ([Codex config reference](https://developers.openai.com/codex/config-reference)).
  The legacy `wire_api = "chat"` escape hatch was removed, so Codex cannot be
  pointed at a Chat Completions endpoint from its own config — the
  `configure_codex` comment that says as much is correct. (2) The `404` was
  emitted by **our own proxy**, not the backend:
  [`proxy.rs::allowed_methods_for_path`](src-tauri/src/core/server/proxy.rs)
  did not know the `/responses` path, so the request fell through to the
  catch-all `_ =>` arm and returned `404 "Not Found"`. The turboquant /
  upstream llama.cpp backends implement only `/v1/chat/completions`; only the
  MLX sidecar serves `/v1/responses` natively (see §4.1), and even that was
  unreachable because the proxy never routed the path. Net effect: every
  Responses-only client (Codex, and any other tool that hard-codes the
  Responses API) was dead on arrival against the Local API server.
- **Decision:** Implement a bidirectional **Responses ↔ Chat Completions**
  translation shim in the proxy rather than shipping a custom Codex config or
  telling users "MLX only".
  1. **Routing.** `/responses` is added to `allowed_methods_for_path`
     (`POST`) and `endpoint_from_path` (`"responses"`, for analytics) in
     [`proxy.rs`](src-tauri/src/core/server/proxy.rs). A dedicated branch in
     `inner_proxy_request` intercepts `POST /responses` *before* the main
     chat-completions match and dispatches to a new self-contained
     `handle_responses_request`, which **returns early** so the shim never
     threads through the chat-completions auto-increase-ctx retry machinery
     (it has its own forwarding).
  2. **Backend split.** `handle_responses_request` resolves the target with
     the same remote-provider → llama → upstream → MLX precedence as
     `/chat/completions`. Backends that serve Responses natively — the **MLX**
     sidecar and **remote providers** (real OpenAI-compatible endpoints) — get
     a byte-for-byte **passthrough** to their `/v1/responses` (reusing
     `build_streaming_response`). The **llama.cpp** turboquant and upstream
     backends are **translated** to `/v1/chat/completions`.
  3. **Pure transforms.** New module
     [`src-tauri/src/core/server/responses_shim.rs`](src-tauri/src/core/server/responses_shim.rs)
     holds the side-effect-free conversions (unit-tested in `tests.rs`):
     - `responses_request_to_chat` — flattens `instructions` → leading system
       message; `input` (string or typed item array) → chat `messages`,
       mapping `function_call` → assistant `tool_calls`, `function_call_output`
       → `role:"tool"` messages, dropping `reasoning` items; flat Responses
       function tools → nested chat `tools`; `max_output_tokens` → `max_tokens`;
       `text.format` (json_schema/json_object) → `response_format`. Sets
       `stream_options.include_usage` on streaming requests so the final usage
       survives.
     - `chat_response_to_responses` — non-streaming chat JSON → a `response`
       object with `output` items (`message` + `function_call`) and mapped
       `usage` (`prompt_tokens`→`input_tokens`, etc.).
     - `ResponsesStreamConverter` — a stateful chat-SSE → Responses-SSE event
       machine emitting the sequence Codex consumes: `response.created`,
       `response.output_item.added` / `response.content_part.added`,
       `response.output_text.delta`, `response.function_call_arguments.delta`,
       the matching `*.done` events, and a terminal `response.completed`
       carrying the full `output` + `usage`. SSE lines are reassembled from a
       byte buffer split on `\n` (not lossy per-chunk string slicing) so
       multibyte tokens spanning network chunks aren't corrupted.
- **Consequences:**
  - **Codex works on local GGUF models.** `POST /v1/responses` against a
    turboquant/upstream llama.cpp session now streams a valid Responses event
    sequence; `configure_codex` is unchanged (its root `model` /
    `model_provider` + `[model_providers.atomic]` block already point Codex at
    `http://127.0.0.1:1337/v1`, `wire_api` left at the only supported value
    `responses`).
  - **No auto-increase-ctx on the Responses path.** The shim forwards on its
    own and does not participate in the `finish_reason=length` /
    context-limit retry that `/chat/completions` enjoys. Codex manages its own
    context window; revisit if Responses clients start hitting silent
    truncation.
  - **Lossy by design for non-text modalities.** Image/file `input` parts and
    Responses-only `reasoning` items are dropped in the llama.cpp translation
    (Chat Completions has no equivalent reasoning-input slot). MLX/remote
    passthrough preserves full fidelity. Built-in Responses tools
    (`web_search`, etc.) are dropped — only `type:"function"` tools translate.
  - **Model-capability caveat.** Codex needs tool-calling + streaming; a small
    GGUF without function-calling support will surface Codex's own error, not
    a shim failure.
  - **Test coverage.** 6 new unit tests in
    [`tests.rs`](src-tauri/src/core/server/tests.rs) pin the request transform
    (string + item-array + tools), the non-streaming response transform (text
    + tool_call), and the streaming converter (text sequence + tool-call
    sequence). Full `core::server` suite: 60 passing.
- **Owner:** team.
- **Links:** §4 *Inference backends*, the 2026-06-01 ADR *Add a "Launch" page …*,
  [Codex config reference](https://developers.openai.com/codex/config-reference),
  files: [`src-tauri/src/core/server/responses_shim.rs`](src-tauri/src/core/server/responses_shim.rs),
  [`src-tauri/src/core/server/proxy.rs`](src-tauri/src/core/server/proxy.rs)
  (`handle_responses_request`, `allowed_methods_for_path`, `endpoint_from_path`),
  [`src-tauri/src/core/server/mod.rs`](src-tauri/src/core/server/mod.rs),
  [`src-tauri/src/core/server/tests.rs`](src-tauri/src/core/server/tests.rs).

### 2026-06-02 — Fix MTP speculative rollback crash on Gemma 4 + DeepSeek-V4 (`'list' object has no attribute 'max'`)
- **Context:** Enabling **MTP** speculative decoding on a Gemma 4 target
  (e.g. `gemma-4-e4b-it-4bit` + the `*-assistant` drafter) crashed the
  generation thread mid-stream with
  `AttributeError: 'list' object has no attribute 'max'` at
  `mlx_vlm/models/gemma4/language.py::rollback_speculative_cache`
  (a secondary `RuntimeError: There is no Stream(gpu, 1)` followed as the
  `BatchGenerator.__del__` cleanup unwound on the wrong thread). Root cause:
  the MTP batch driver `speculative/mtp.py::_mtp_rounds_batch` passes
  `accepted` as a **Python list** of per-row accepted counts, but Gemma 4's
  (and DeepSeek-V4's) `rollback_speculative_cache` only special-cased `int`
  and otherwise assumed an `mx.array`, immediately calling `accepted.max()`.
  The reference `qwen3_5` implementation already normalized `int` / `mx.array`
  / `list`; Gemma 4 and DeepSeek-V4 did not. (The EAGLE-3 path is unaffected —
  `speculative/eagle3.py` wraps `mx.array(accepted_list)` before the call.)
- **Decision:** Coerce `accepted` to an `int32` `mx.array` up front in both
  `mlx_vlm/models/gemma4/language.py` and
  `mlx_vlm/models/deepseek_v4/language.py`
  (`elif not isinstance(accepted, mx.array): accepted = mx.array(list(accepted), dtype=mx.int32)`),
  matching the qwen3_5 convention. Minimal, local, array-path-preserving.
- **Consequences:**
  - **Gemma 4 MTP and DeepSeek-V4 MTP now run** instead of crashing on the
    first speculative round; the cascade `Stream(gpu, 1)` cleanup error is
    gone once the primary exception no longer fires. Qwen MTP was already
    correct (qwen3_5 hook) and is unchanged. DFlash / EAGLE-3 paths untouched.
  - Fix lives in the **`AtomicBot-ai/mlx-vlm` fork** — it takes effect for
    dev runs from source on the next sidecar restart, and reaches the shipped
    app only after the fork is committed + a new sidecar release is built via
    `build-mlxvlm-macos.yml` (see the v0.6.0 sync ADR below). `py_compile`
    passes on both edited modules.
- **Owner:** team.
- **Links:** the 2026-06-02 v0.6.0 sync ADR below,
  `mlx-vlm` `mlx_vlm/models/gemma4/language.py::rollback_speculative_cache`,
  `mlx-vlm` `mlx_vlm/models/deepseek_v4/language.py::rollback_speculative_cache`,
  `mlx-vlm` `mlx_vlm/models/qwen3_5/language.py` (reference impl),
  `mlx-vlm` `mlx_vlm/speculative/mtp.py::_mtp_rounds_batch`.

### 2026-06-02 — Surface MLX KV-cache quantization (TurboQuant / uniform) as a provider setting
- **Context:** The MLX backend (`AtomicBot-ai/mlx-vlm`) supports KV-cache
  quantization on its CLI (`--kv-bits <float> --kv-quant-scheme
  uniform|turboquant`; the server only sets `KV_BITS` when `--kv-bits` is
  passed, so the cache is full-precision by default). After the v0.6.0 sync
  the engine capability was present but **nothing in the desktop app drove
  it** — the `tauri-plugin-mlx` Rust shim only emitted `--max-kv-size`,
  `--draft-model`, `--draft-kind`, `--draft-block-size`. Users could not opt
  into TurboQuant KV (the recommended `--kv-bits 3.5 --kv-quant-scheme
  turboquant`, ~4.3× smaller cache) to fit longer contexts.
- **Decision:** Add two MLX provider settings and plumb them end-to-end as a
  **load-time** arg (mirrors `ctx_size`: applied on the next model load, no
  mid-session auto-reload like the drafter block-size path):
  - `extensions/mlx-extension/settings.json`: `kv_quant_scheme` dropdown
    (`off` (default) / `turboquant` / `uniform`) + `kv_bits` number input
    (default `3.5`, range 0–8).
  - `performLoad` in `extensions/mlx-extension/src/index.ts` normalizes
    `off` → `''` and forces `kv_bits = 0` when the scheme is off, so a stale
    bit-width can't leak; both ride the existing `MlxConfig` IPC.
  - `tauri-plugin-mlx` `MlxConfig` gains `kv_bits: f32` + `kv_quant_scheme:
    String` (both `#[serde(default)]`); `load_mlx_model_impl` emits
    `--kv-bits <bits> --kv-quant-scheme <scheme>` **only** when the scheme is
    `uniform`/`turboquant` AND `kv_bits > 0.0`. guest-js `types.ts` /
    `normalizeMlxConfig` carry the matching fields.
- **Consequences:**
  - Backwards-compatible: empty/legacy configs (and `off`) emit no KV flags,
    so the server keeps its full-precision default — no behavior change for
    existing users. The single source of truth for "is KV quant on" is the
    Rust guard (scheme ∈ {uniform, turboquant} && bits > 0).
  - Quality/latency trade-off is the user's: TurboQuant @ 3.5 bits is the
    documented sweet spot; uniform pairs with 4/8. Wrong pairings only cost
    quality, never correctness.
  - macOS-only surface (MLX provider is Apple-Silicon-only); Windows/Linux
    unaffected. `cargo check` on `tauri-plugin-mlx` passes.
  - Not done: no per-keystroke auto-reload (intentional — KV geometry is
    fixed at cache allocation); no `--kv-group-size` / `--quantized-kv-start`
    exposure (kept on mlx-vlm defaults, can be added later if needed).
- **Owner:** team.
- **Links:** §4.1 *MLX backend*,
  [`extensions/mlx-extension/settings.json`](extensions/mlx-extension/settings.json),
  [`extensions/mlx-extension/src/index.ts`](extensions/mlx-extension/src/index.ts),
  [`src-tauri/plugins/tauri-plugin-mlx/src/commands.rs`](src-tauri/plugins/tauri-plugin-mlx/src/commands.rs),
  [`src-tauri/plugins/tauri-plugin-mlx/guest-js/types.ts`](src-tauri/plugins/tauri-plugin-mlx/guest-js/types.ts).

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
