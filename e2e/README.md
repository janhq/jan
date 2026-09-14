# Desktop e2e tests

WebDriver-driven end-to-end tests against a real Jan desktop build, using
[WebdriverIO](https://webdriver.io) and `@wdio/tauri-service`.

**macOS only.** The config refuses to run elsewhere — see [Isolation](#isolation).

## Running

```bash
yarn e2e    # from the repo root
```

That builds icons, stubs the Tauri bundle resources, builds the frontend,
compiles the app with `--features e2e`, then installs and runs this package.

To iterate on specs without rebuilding the app:

```bash
cd e2e && yarn test
```

| Variable | Effect |
| --- | --- |
| `JAN_E2E_KEEP=1` | Keep the throwaway profile after the run instead of deleting it. |
| `JAN_E2E_HOME=<dir>` | Use `<dir>` as the profile instead of a fresh temp dir. A directory supplied this way is never deleted — only a profile the harness created is cleaned up. Primarily how the launcher hands the path to its workers. |

This package is **not** a yarn workspace of the root project. It has its own
lockfile, because it shares no code with `core`/`web-app` and adding it to the
root workspaces put ~180MB of driver tooling into every `yarn install` — including
the release-build jobs that never run this suite.

## How it works

Tauri renders in the OS webview (WKWebView on macOS, WebKitGTK on Linux,
WebView2 on Windows), so Playwright cannot drive it — Playwright only speaks to
browsers it ships. WebDriver is the protocol the webviews themselves implement,
which is why this is the approach Tauri documents.

On macOS there is no WKWebView driver to attach from outside, so the app hosts
an **embedded** WebDriver server itself via `tauri-plugin-wdio-webdriver`. That
plugin is an optional dependency behind the `e2e` cargo feature, and the `e2e`
feature is not enabled by any supported build path — not `default`, not
`desktop`, and not by any command in the `Makefile` or `.github/workflows/`.
Release binaries therefore do not contain a WebDriver listener. (This is a gate
against accidental inclusion, not a hard impossibility: anyone can pass
`--features e2e` to Cargo explicitly, which is exactly what `build:e2e:app`
does to produce the unbundled debug binary these tests drive.)

Verify the gate:

```bash
cargo tree --manifest-path src-tauri/Cargo.toml -i tauri-plugin-wdio-webdriver
# "did not match any packages" = correctly absent from a default build
```

The `e2e` feature also disables `tauri-plugin-single-instance`. It keys off a
`TMPDIR` socket on macOS, which the `HOME` override does not isolate, so a
developer with the real Jan open would otherwise see the test binary hand over
its argv and exit before the WebDriver server ever bound.

## Isolation

Each run gets a throwaway `HOME` (a temp dir), because the desktop app resolves
its data folder from `app_handle.path().data_dir()`, which on macOS is
`$HOME/Library/Application Support`. Tests never touch a real Jan profile.

This is why the suite is macOS-only. `dirs::data_dir()` resolves differently
elsewhere, and neither variant is redirected by `HOME`:

- **Windows** reads `FOLDERID_RoamingAppData` through the Win32 known-folder
  API. It ignores `USERPROFILE`, and there is no environment override — so a
  run would write to the developer's real profile.
- **Linux** prefers `$XDG_DATA_HOME` over `$HOME/.local/share`. Supporting it
  means setting that variable too, not just `HOME`.

Two things that look like they'd work but don't:

- `JAN_DATA_FOLDER` is read only by `resolve_jan_data_folder()`, the CLI path.
  The desktop build ignores it.
- `CI=e2e` short-circuits `get_app_configurations()` to a hardcoded `"./data"`,
  which would skip the config resolution these tests exist to cover.

Because the profile is always fresh, **every run is a first launch** — no
providers are configured, so `/` renders `SetupScreen`. The suite asserts that
rather than working around it.

## Writing specs

`browser.tauri.execute()` is unavailable: it needs `window.__TAURI__`, which
requires `withGlobalTauri: true` in `tauri.conf.json`. That would expose the
full Tauri API to anything running in the webview, so it stays off. Assert
through the UI instead — which is closer to what users actually see.

Navigate with the `goto()` helper in `specs/smoke.e2e.ts` rather than
`browser.url()`: the Tauri asset protocol has no SPA fallback for deep paths, so
a hard navigation 404s. The helper pushes history (which TanStack patches to
notify its own subscribers) and carries `__TSR_index` forward so back/forward
deltas stay valid.

`goto()` does bypass the nav UI and any guard in front of a route. Clicking a
real nav element exercises more and is worth preferring where a selector exists;
treat the helper as the escape hatch for routes that are awkward to reach.

Prefer `data-testid` selectors — around ten shipped components already carry
them. Note that a `grep` for `data-testid` turns up many more hits in
`__tests__` mocks than in real components, so check whether the one you want
actually exists before assuming it does.
