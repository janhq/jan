# Hello Provider (sample Jan extension)

A minimal third-party extension that uses every contribution point a worker
extension has. Start from it when writing your own.

Licensed under Apache-2.0.

| Contribution | What it does |
|---|---|
| command `hello.greet` | Shows a toast (`ui.notify`) with the `greeting` setting and bumps the status item |
| command `hello.ping` | `ctx.http.fetch` of `http://127.0.0.1:11999/v1/models`, or of the URL passed as its argument (anything outside the grants fails with `E_PERMISSION`) |
| setting `greeting` | Text input, default `Hello`; the status item follows changes |
| status item `hello.status` | `<greeting> (<count>)`; clicking runs `hello.greet` |
| tool `echo_upper` | Returns `text` upper-cased; with `delayMs` it waits first and stops at once when the call is cancelled |
| provider `hello-local` | OpenAI-compatible at `http://127.0.0.1:11999/v1`; `listModels` reports `hello-1` |

Permissions: `ui:notify`, `tools`, `providers` and `network:127.0.0.1` (a
provider needs network access to its `baseUrl` host).

## How it runs

Jan runs each third-party extension in its own Web Worker. The host builds
one script from its runtime prelude followed by this bundle, so the bundle
has to be:

- a single file, `format: 'iife'` with `name: 'JanExtension'` (see
  `rolldown.config.mjs`), exporting `activate(ctx)` and optionally
  `deactivate()`;
- free of runtime imports. Import only types from `@janhq/extension-api`;
  everything else goes through `ctx`.

The host enforces the shape before it starts a worker: parsed on its own as
a classic script, the file must be exactly one top-level
`var JanExtension = <expression>;` statement, optionally preceded by a
`'use strict'` directive and with comments anywhere. No other top-level
`function`, `class`, `var`, `let` or `const`, and no other statement, is
allowed, because top-level declarations of the shared worker script are
bound before the runtime prelude runs. Keep everything inside the IIFE: a
rolldown or esbuild `banner`/`footer`/`intro` that adds top-level code makes
the bundle fail to load ("is not a valid extension bundle").

Before the bundle runs, the prelude removes `fetch`, `XMLHttpRequest`,
`WebSocket`, `importScripts`, `Notification`, IndexedDB, `navigator.storage`,
`navigator.serviceWorker`, the Tauri globals and similar from the worker. `ctx.http.fetch` is the only way to reach the network, and the
host checks every call (and every redirect) against the granted
`network:<host>` permissions.

Network requests of an installed extension run in Rust
(tauri-plugin-extensions `http_fetch`): the grants are re-read from
`extensions.json` on every request, no cookie jar is attached, Jan's local
API server port is refused, and no redirect is followed there; the host
follows them itself and checks each hop. The host runs inference for
`hello-local` against its `baseUrl` itself, on the same path, with the SSE
body streamed back from Rust; nothing streams through the worker.

A folder loaded unpacked has no entry in `extensions.json`, so it has no
network path: its `ctx.http.fetch` fails with `E_NOT_FOUND` and its
provider cannot be chatted with. Install the packed bundle (`yarn pack`,
then Settings > Extensions > Install from file) to try those.

## Build

From the repository root (yarn v4):

```bash
yarn install
yarn build:extension-api && yarn build:extension-runtime
yarn workspace @janhq/sample-hello-provider build   # type-check + dist/index.js
yarn vitest run --project @janhq/sample-hello-provider
```

`yarn build:samples` builds every sample. The tests rebuild `dist/index.js`
themselves (`vitest.global-setup.mjs`).

## Load it unpacked (development builds)

Once the dev loader (P2-4) is in: in a development build of Jan
(`yarn dev:tauri`), open Settings > Extensions, choose **Load unpacked** and
pick this folder (the one holding `package.json`). Jan validates the `jan`
manifest, lists the permissions it requests, and starts `dist/index.js` in a
worker. A dev-loaded extension is labelled "Development" and is not kept
across restarts.

## Tests

- `src/__tests__/index.test.ts`: `activate` against an in-memory context.
- `src/__tests__/manifest.test.ts`: the manifest passes the host's validator.
- `src/__tests__/bundle.test.ts`: the built bundle meets the bundle contract
  and boots behind the real prelude in the worker sandbox.
- `web-app/src/lib/extensions/__tests__/sample.integration.test.ts`: the
  built bundle through the app's real `ExtensionHost` (dispatcher,
  contribution store, settings store, tools, providers, network checks).
