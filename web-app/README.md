# @janhq/web-app

The React frontend of Jan Desktop: TypeScript, TanStack Router, Radix UI, Tailwind CSS,
and Zustand. It is a Yarn workspace package, not a standalone app - it renders inside the
Tauri shell and calls the Rust backend over Tauri IPC.

## Commands

From this directory:

```bash
yarn dev        # Vite dev server on port 1420
yarn build      # tsc -b, then vite build
yarn test       # vitest
yarn lint       # eslint
yarn preview    # serve a local build
```

From the repo root, `yarn dev:web` runs the dev server alone and `yarn build:web` builds
this package. The Vite server has no proxy to the backend, so a browser-only session has
no working Tauri commands; use `yarn dev` at the repo root to run the desktop shell.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the directory layout, routing, Tauri
integration, state management, and debugging notes.
