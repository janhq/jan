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
  - Speculative decoding: DFlash (Qwen3.5) and Gemma 4 MTP drafters.
  - OpenAI-compatible `/v1/chat/completions` and `/v1/responses`,
    structured outputs (`json_schema`), per-token logprobs.
- **CLI surface we care about** (server side):
  `mlx_vlm.server --model <hf|path> [--adapter-path …] [--draft-model …]
  [--draft-kind dflash|mtp] [--kv-bits N] [--kv-quant-scheme uniform|turboquant]
  [--enable-thinking] [--top-logprobs-k K]`.

### 4.2 LLM backend — `AtomicBot-ai/atomic-llama-cpp-turboquant`

- **Fork of:** [`TheTom/llama-cpp-turboquant`](https://github.com/TheTom/llama-cpp-turboquant)
  (itself based on `ggml-org/llama.cpp`).
- **Active branch:** `feature/turboquant-kv-cache`.
- **Target hardware (per platform policy):**
  - **macOS (Apple Silicon, Metal) — our fork** `atomic-llama-cpp-turboquant`.
  - **Linux (CUDA / Vulkan / HIP / CPU) — our fork** `atomic-llama-cpp-turboquant`.
  - **Windows (x64, CUDA / Vulkan / CPU) — official upstream
    [`ggml-org/llama.cpp`](https://github.com/ggml-org/llama.cpp)**, *not*
    our TurboQuant fork. Windows does **not** get TurboQuant KV / weights,
    Gemma 4 MTP, or Qwen 3.6 NextN today. See ADR 2026-05-19 *Windows uses
    upstream llama.cpp* in §7.
- **How it ships in Atomic Chat:**
 - Pre-built `llama-server` / library binaries are downloaded per platform
 by `scripts/download-bin.mjs` / `scripts/download-lib.mjs`. The download
 manifest picks our fork's release on macOS / Linux and the official
 `ggml-org/llama.cpp` release on Windows.
 - `extensions/llamacpp-extension/` is the TS driver that selects the
 correct backend build (CPU / CUDA / Vulkan) per host and supervises the
 process. Features gated to the fork (TurboQuant `-ctk`/`-ctv`, `--mtp-head`,
 `--spec-type mtp|nextn`) must be guarded behind a platform / backend-build
 check before they are surfaced to the UI.
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
       tier picker. New private method
       `tierEnumeratesDevices(backendType)` in
       [`extensions/llamacpp-upstream-extension/src/index.ts`](extensions/llamacpp-upstream-extension/src/index.ts)
       probes the already-installed backend for the requested tier and
       returns `false` when `--list-devices` is empty or throws.
       `detectIdealBackendType()` on Windows now iterates the ordered
       tier list `[cuda-13.1?, cuda-12.4?, vulkan?]` and degrades to
       the first tier whose binary actually enumerates a device. The
       probe is **non-destructive** — it never triggers a download.
       Tiers that are not yet installed are assumed to work (the
       driver-version gate is the only signal), and any miss is
       caught on the next `recheckOptimalBackend()` once installed.
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
    - **Fix 2 makes the picker self-healing.** When a previously
      installed `cuda-13.1` returns empty `--list-devices`,
      `recheckOptimalBackend()` will now surface a recommendation to
      switch to `cuda-12.4` (or `vulkan`, or `cpu` as terminal
      fallback). The existing download-recommended-backend UI flow
      then carries the user through the upgrade. Cost: each
      already-installed tier costs one `--list-devices` invocation
      per `recheckOptimalBackend()` call — bounded at three tiers
      with a 30-second Rust-side timeout per call, so worst-case ~90s
      blocking for a user whose entire CUDA stack is broken. Probing
      is only triggered by the two existing user-facing entry points
      (`SetupBackendStep` on first launch, and the manual "Find
      optimal backend" button in provider settings) — there is no
      automatic background probe. A future ADR may add an
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
