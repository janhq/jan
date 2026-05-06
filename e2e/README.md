# Jan E2E (tauri-driver + WebdriverIO)

End-to-end tests that drive the built Jan binary via WebDriver.

## Platform support

| Platform | Status     | Backend                       |
| -------- | ---------- | ----------------------------- |
| Linux    | Supported  | `WebKitWebDriver` (WebKitGTK) |
| Windows  | Supported  | `Microsoft Edge Driver`       |
| macOS    | Unusable   | Apple does not ship a working `WKWebView` WebDriver |

CI should run on Ubuntu.

## One-time setup

```bash
# Rust + tauri-driver (proxy: WebDriver -> system webview driver)
cargo install tauri-driver --locked

# Linux: WebKitGTK WebDriver
sudo apt-get install -y webkit2gtk-driver xvfb

# Windows: install matching Microsoft Edge Driver and put on PATH

# Node deps
cd e2e && yarn install
```

## Build the app under test

`tauri-driver` launches a real binary, not `tauri dev`:

```bash
yarn build:tauri    # produces src-tauri/target/release/Jan
```

To test an installed nightly instead:

```bash
export JAN_BINARY=/usr/bin/Jan-nightly
```

## Run

```bash
cd e2e
yarn test                              # all specs
yarn test --spec specs/smoke.e2e.ts    # one spec

# Headless on Linux CI:
xvfb-run -a yarn test
```

## Writing specs

Use stable `data-testid` attributes in the React components — XPath/CSS
text selectors are fragile across i18n locales. The included
`llamacpp-inference.e2e.ts` lists the test IDs it expects; add them in
`web-app/` as you stabilize each flow.

Shared helpers live in `helpers/`:

- `helpers/app.ts` — `waitForApp`, `clickNav`, `byTestId`, `existsTestId`,
  `dismissDialog`.
- `helpers/settings.ts` — `openSettings(tab)`, `settingsControl`,
  `reloadRenderer`.
- `helpers/profile.ts` — `seedThread`, `seedAssistant`, `reloadAfterSeed`.
  Use these to write fixture data into the per-run XDG profile before
  the renderer reads from disk; lets specs exercise thread/assistant
  flows without needing a running model.

Conventions:

- **English only.** `wdio.conf.ts` pins `LANG`/`LC_ALL`/`LANGUAGE` to
  `en_US.UTF-8` for the spawned Jan process. Don't write specs that
  depend on other locales.
- **Testid-only selectors.** Avoid CSS text or XPath text matches.
- **Failed-test screenshots** are written to `e2e/screenshots/` (gitignored)
  and uploaded by CI as an artifact.
- **Manual-only flows** (anything requiring a real API key, model
  download, or migration from a prior version) should live in
  `specs/manual/` and be skipped by default via
  `describe.skip` or an env-gated guard.

## Coverage gaps

The autoqa checklist (now removed) listed several thread features that
no longer exist in the current UI. We do not have specs for them
because the code paths are gone:

- Thread starring / favourites section / "Unstar All"
- Sidebar thread search (a global SearchDialog exists but is not the
  same surface the checklist described)

Specs that need a running model (chat-message edit/copy/delete/regenerate,
local-API-server end-to-end, hub model download → chat reply) are gated
out of the default run. Land them under `specs/manual/` with an env
guard and pre-seed the model into the test profile.

## Known gotchas

- WebKitGTK driver session can hang if a previous `tauri-driver` is still
  bound to port 4444. `pkill tauri-driver` between runs.
- Profile isolation is automatic: `wdio.conf.ts` creates a fresh tempdir per
  run and points `XDG_DATA_HOME`/`XDG_CONFIG_HOME` (Linux) or `APPDATA`
  (Windows) at it, then deletes it on teardown. Set `JAN_KEEP_PROFILE=1` to
  preserve the dir when debugging.
- First model download in the inference spec is slow — keep that timeout
  generous, or pre-seed the model into the test profile.
