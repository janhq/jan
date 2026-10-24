# Contributing to Jan Extensions

[<- Back to Main Contributing Guide](../CONTRIBUTING.md)

Extensions add specific features to Jan as self-contained modules. Every
extension exports `activate(ctx)` (and optionally `deactivate()`) and reaches
the app only through `ctx`. There is no base class to extend.

There are two kinds:

- **Built-ins** (this folder) run in the main window and receive an
  `InternalExtensionContext` from `@janhq/core`. Next to the stable API they
  get `ctx.internal` (service registry, fs, downloads, engines, internal
  tools, secrets), which has no stability guarantee.
- **Third-party extensions** run in a Web Worker each, receive the stable
  `ExtensionContext` from `@janhq/extension-api` and can use only what their
  manifest permissions grant. `extensions-samples/hello-provider` is the
  reference; start from it.

## Current built-ins

| Folder | Id | What it provides |
|---|---|---|
| `assistant-extension` | `jan.assistant` | `ServiceKeys.Assistants` (assistant CRUD, migrations) |
| `download-extension` | `jan.download` | `ServiceKeys.Downloads` (model downloads with progress) |
| `llamacpp-extension` | `jan.llamacpp` | llama.cpp engine via `ctx.internal.engines`, `ServiceKeys.Llamacpp` |
| `mlx-extension` | `jan.mlx` | MLX engine on Apple Silicon (macOS only), `ServiceKeys.Mlx` |
| `vector-db-extension` | `jan.vector-db` | `ServiceKeys.VectorDB` (sqlite-vec with a linear fallback) |
| `rag-extension` | `jan.rag` | `ServiceKeys.RAG` and the RAG tools; depends on `jan.vector-db` |

The host activates them from `HOST_BUILTINS` in
`web-app/src/lib/extensions/builtins.ts`.

## Adding a built-in

1. `extensions/<name>-extension/package.json`: name it
   `@janhq/<name>-extension`, depend on `@janhq/core` (`workspace:*`), and add
   a `jan` manifest field:
   ```json
   "jan": {
     "id": "jan.<name>",
     "displayName": "My Feature",
     "publisher": "Jan",
     "apiVersion": "^0.1.0",
     "main": "dist/index.js",
     "permissions": []
   }
   ```
   User-facing settings go in `jan.contributes.settings`; the host stores
   them and renders them on Settings > Extensions.
2. `rolldown.config.mjs`, `tsconfig.json` and `vitest.config.ts`, copied from
   `download-extension` (the smallest).
3. `src/index.ts`:
   ```ts
   import { ServiceKeys, type InternalExtensionContext } from '@janhq/core'

   export async function activate(ctx: InternalExtensionContext): Promise<void> {
     const service = createMyService(ctx)
     // Everything added to ctx.subscriptions is disposed on deactivation.
     ctx.subscriptions.add(ctx.internal.services.provide(ServiceKeys.MyService, service))
   }
   ```
   A new service needs its interface and a `ServiceKey` in
   `core/src/browser/host/services.ts`. Callers in the web app read it with
   `getExtensionHost().services.get(ServiceKeys.MyService)`.
4. Wire it up: an entry in `HOST_BUILTINS` (with `dependsOn` if it needs
   another built-in active first), a module declaration in
   `web-app/src/types/bundled-extensions.d.ts`, and the vitest project in the
   root `vitest.config.ts`.

## Lifecycle

1. The app starts and the host validates each built-in's manifest.
2. Built-ins activate in `dependsOn` order: `activate(ctx)` is awaited.
3. Installed third-party extensions then start in their workers.
4. On shutdown or disable the host calls `deactivate()` and disposes
   `ctx.subscriptions`.

A failing `activate` marks only that extension as failed; it never blocks
the others or the UI.

## Building and testing

```bash
yarn build:extensions   # extension-api, runtime, core, every extension, samples
yarn test:ext
make test-extensions-smoke
```

Test against a fake context rather than the real host; see
`rag-extension/src/test/fake-context.ts` and
`llamacpp-extension/src/test/host.ts`.

## Rules

- Extensions do not import each other; they share services through
  `ctx.internal.services` and declare order with `dependsOn`.
- `invoke` calls belong only in a Tauri plugin's `guest-js` layer.
- Release everything you acquire through `ctx.subscriptions`.
- User-visible strings go through i18next (or manifest `l10n` for
  third-party extensions).
