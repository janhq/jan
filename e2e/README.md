# Jan E2E (tauri-driver + WebdriverIO)

End-to-end tests that drive the built Jan binary via WebDriver. Replaces
the agent-based `autoqa/` harness for deterministic flows.

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

## Known gotchas

- WebKitGTK driver session can hang if a previous `tauri-driver` is still
  bound to port 4444. `pkill tauri-driver` between runs.
- Profile isolation is automatic: `wdio.conf.ts` creates a fresh tempdir per
  run and points `XDG_DATA_HOME`/`XDG_CONFIG_HOME` (Linux) or `APPDATA`
  (Windows) at it, then deletes it on teardown. Set `JAN_KEEP_PROFILE=1` to
  preserve the dir when debugging.
- First model download in the inference spec is slow — keep that timeout
  generous, or pre-seed the model into the test profile.
