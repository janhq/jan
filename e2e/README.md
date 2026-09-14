# Desktop e2e tests

WebDriver-driven end-to-end tests against a real Jan desktop build, using
[WebdriverIO](https://webdriver.io) and `@wdio/tauri-service`.

**macOS and Linux.** Windows cannot be isolated and the config refuses to run
there — see [Isolation](#isolation).

On Linux you need the Tauri build dependencies plus a WebDriver and a display.
`libssl-dev` is required but absent from the repo's other dependency lists —
`openssl-sys` is in the app's default dependency graph, and GitHub runners ship
it preinstalled, so a clean machine is the only place you notice:

```bash
sudo apt-get install -y build-essential cmake pkg-config libssl-dev \
  libglib2.0-dev libatk1.0-dev libpango1.0-dev libgtk-3-dev libsoup-3.0-dev \
  libwebkit2gtk-4.1-dev librsvg2-dev webkit2gtk-driver xvfb
```

Then run headless under Xvfb. Only the suite needs the display, so build first
and wrap just the run:

```bash
yarn build:e2e:app                  # from the repo root
cd e2e && xvfb-run -a yarn test
```

`xvfb-run -a yarn e2e` also works; it just puts the ~20-minute build inside the
virtual display for no reason.

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
an **embedded** WebDriver server itself via `tauri-plugin-wdio-webdriver`. Linux
uses the same embedded provider — it could drive `WebKitWebDriver` through the
`official` provider instead, but sharing one path means neither platform needs
`tauri-driver` installed. That plugin is an optional dependency behind the `e2e`
cargo feature, and the `e2e` feature is not enabled by any supported build path
— not `default`, not `desktop`, and not by any command in the `Makefile` or
`.github/workflows/`.
Release binaries therefore do not contain a WebDriver listener. (This is a gate
against accidental inclusion, not a hard impossibility: anyone can pass
`--features e2e` to Cargo explicitly, which is exactly what `build:e2e:app`
does to produce the unbundled debug binary these tests drive.)

Verify the gate:

```bash
cargo tree --manifest-path src-tauri/Cargo.toml -i tauri-plugin-wdio-webdriver
# "did not match any packages" = correctly absent from a default build
```

The `e2e` feature also disables `tauri-plugin-single-instance`. Its rendezvous
is a `TMPDIR` socket on macOS, a session-bus **D-Bus name** on Linux, and a named
mutex on Windows — none of which live under `HOME` or any XDG directory, so
nothing in `isolationEnv` isolates them. A developer with the real Jan open would
otherwise see the test binary hand over its argv and exit before the WebDriver
server ever bound.

## Isolation

Each run gets a throwaway profile in a temp dir, so tests never touch real Jan
data. The desktop app resolves its data folder from
`app_handle.path().data_dir()`; which variables that leaves you needing to
override depends on the platform.

`dirs::data_dir()` resolves differently per platform, which is what decides
where the suite can run at all:

| Platform | `data_dir()` | Redirected by |
| --- | --- | --- |
| macOS | `$HOME/Library/Application Support` | `HOME` |
| Linux | `$XDG_DATA_HOME`, else `$HOME/.local/share` | `HOME` **and** `XDG_DATA_HOME` |
| Windows | `FOLDERID_RoamingAppData` (Win32 known-folder API) | nothing — no env override exists |

On Linux the harness pins **every** XDG base directory
(`XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`) rather
than relying on them being unset. Each outranks its `$HOME`-relative default, so
a single inherited value defeats the `HOME` override.

`XDG_CONFIG_HOME` is the dangerous one and the reason this is belt-and-braces
rather than minimal. `dirs::config_dir()` feeds the legacy-config migration in
`core/app/commands.rs`, which does `fs::copy` followed by `fs::remove_file`. With
that variable inherited, a run **deletes** the developer's real
`~/.config/Jan/settings.json` — confirmed against a decoy, which did not survive
a single run.

Windows has no equivalent lever, so the config refuses to run there rather than
write into a real Jan profile.

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
