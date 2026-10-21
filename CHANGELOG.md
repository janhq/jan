# Changelog

This file records what this fork adds on top of
[janhq/jan](https://github.com/janhq/jan).

- **Upstream base:** `ce8fcd2` — *"fix(web-app): show the unreachable-provider
  message in the model-fetch toast (#9351) (#9354)"* (`v0.8.7-4-gce8fcd2`)
- **Divergence:** 36 files changed, 606 insertions, 111 deletions, plus 56 new
  files.
- **Release notes in the house format:**
  [`docs/src/pages/changelog/2026-10-21-jan-v0.8.8-local-cpu-engines.mdx`](docs/src/pages/changelog/2026-10-21-jan-v0.8.8-local-cpu-engines.mdx)
- **Full technical write-up:** [`LOCAL-CPU-ENGINES.md`](LOCAL-CPU-ENGINES.md)

---

## Unreleased — v0.8.8

### Added

**LiteRT-LM and OpenVINO as local CPU inference engines.**

Jan can now run models with Google's LiteRT-LM and Intel's OpenVINO beside
llama.cpp and MLX. Both appear in **Settings → Providers**, run entirely on the
CPU, and are set up from the app: the provider page reports whether the
runtime is installed and offers an **Install** button that puts it in place,
and models are imported from a local file, a local folder, or a URL.

- Engine sidecar: `src-tauri/python-engines/server.py` — a standard-library
  server that loads the model with the engine's runtime and speaks the OpenAI
  chat-completions API.
- Engine plugin: `src-tauri/plugins/tauri-plugin-local-engine/` — resolves the
  interpreter, starts and supervises the sidecar, and reports whether a
  runtime is usable.
- Shared engine base: `packages/local-engine/` — the `AIEngine` implementation
  both extensions share.
- Extensions: `extensions/litert-lm-extension/`,
  `extensions/openvino-extension/`.
- UI: `web-app/src/containers/LocalEngineRuntimeBanner.tsx`,
  `web-app/src/containers/dialogs/ImportLocalEngineModelDialog.tsx`.

**A native browser for the agent.**

Six built-in tools — `browser_open`, `browser_read`, `browser_eval`,
`browser_click`, `browser_type`, `browser_screenshot` — drive a real Chrome
over the DevTools protocol. No MCP server, no extra runtime. The browser is
offered in chat and in Cowork, and because it can act as the user on a site,
every call asks for approval first.

- Implementation:
  `src-tauri/plugins/tauri-plugin-agent-tools/src/tools/browser.rs`.

### Fixed

- **The OpenVINO engine answered with two words and stopped.** OpenVINO's
  streaming callback is not a continue/stop flag: returning "keep going" from
  it ends the generation right there. It now returns what OpenVINO expects.
- **Two OpenVINO requests at once scrambled each other.** OpenVINO's pipeline
  is a single compiled model, so a request overlapping a streaming turn
  interleaved their tokens. The engine now runs one generation at a time.
- **Opening an engine's settings opened a console window and left it there.**
  The engine's helpers now start without a window.
- **The runtime check loaded two gigabytes to answer a yes/no question.** It
  now looks for the runtime on disk (about a tenth of a second, no memory) and
  keeps the answer for a minute.
- **An engine's process was called `python.exe`, like every other python.** Each
  engine now runs under its own name (`jan-openvino`, `jan-litert_lm`), so it
  can be found and stopped on its own.
- **The `screenshot` tool needed `CHROME_PATH` on Windows.** The usual Chrome,
  Chromium, Brave and Edge locations are probed there now, as they already were
  on macOS and Linux.

### Changed

- The knowledge of which providers are local engines moved into one list
  (`web-app/src/lib/localProviders.ts`), so a new engine is one line rather
  than a dozen scattered checks.
- Browser tools have their own capability (`Capability::Browser`): they ask
  for approval, the way a write does, rather than being auto-allowed like
  `web_fetch`.

### Not included (known gaps)

- The LiteRT-LM engine reads `.litertlm` bundles; the older `.task` files load
  but fail to generate.
- Neither new engine can call tools yet.
- The local API server does not serve models from these two engines yet.
- The model hub has no entries for these formats.

---

## How to build and run this fork

```bash
yarn install
yarn build:tauri:plugin:api     # the plugin guest-js bundles
yarn build:core                 # the core library
yarn build:extensions           # the extension bundles
yarn build:web                  # the web app the executable embeds

cd src-tauri && cargo build --release --bin Jan-Desktop
```

To put it over an installed Jan (the original is kept as `Jan-Desktop.exe.orig`):

```bash
node scripts/patch-installed-jan.mjs \
  --build src-tauri/target/release/Jan-Desktop.exe \
  --install "$LOCALAPPDATA/Programs/Jan"
```

To check an engine end to end:

```bash
node scripts/verify-local-engines.mjs \
  --engine openvino \
  --python "<venv>/bin/python" \
  --model "<model dir>"
```
