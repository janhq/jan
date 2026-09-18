# Desktop e2e tests

WebDriver-driven end-to-end tests against a real Jan desktop build, using
[WebdriverIO](https://webdriver.io) and `@wdio/tauri-service`.

**macOS, Linux and Windows.** Each can have the app's data folder redirected by
environment — on macOS and Linux through the OS's own variables, on Windows
through one Jan provides. See [Isolation](#isolation).

On Linux you need the Tauri build dependencies plus a display. `libssl-dev` is
easy to miss: `openssl-sys` is in the app's default dependency graph, but GitHub
runners ship OpenSSL preinstalled and the CI workflows never install it, so a
clean machine is the only place the gap shows. (`.devcontainer/postCreateCommand.sh`
does list it.)

```bash
sudo apt-get install -y build-essential cmake pkg-config libssl-dev \
  libglib2.0-dev libatk1.0-dev libpango1.0-dev libgtk-3-dev libsoup-3.0-dev \
  libwebkit2gtk-4.1-dev librsvg2-dev xvfb
```

No `webkit2gtk-driver`: the embedded provider drives the webview in-process and
never launches `WebKitWebDriver`. You would only need it to switch to the
`official` provider.

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
yarn install   # once, on a fresh clone -- see below
yarn e2e       # from the repo root
```

That builds icons, stubs the Tauri bundle resources, builds the workspace
packages, builds the frontend, compiles the app with `--features e2e`, then
installs and runs this package.

`yarn e2e` is not self-contained on a fresh clone, and cannot be: Yarn Berry
refuses to run *any* package script before `node_modules` exists
(`Couldn't find the node_modules state file`), so the install has to happen
outside the script. `build:e2e:deps` runs `yarn install` anyway, which is what
picks up dependency changes after a branch switch.

That deps stage is not optional. The workspace packages have to be **built**,
not just installed -- `web-app` imports `@janhq/core`, which resolves to
`core/dist`. Without it `build:web` fails with
`TS2307: Cannot find module '@janhq/core'`.

`build:e2e:deps` is deliberately the same four steps as `Makefile:44-47`,
including its redundant second build of `core` (`build:extensions` starts by
building `core` again). Staying in step with the Makefile is worth more than the
minute that would save.

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
and Windows use the same embedded provider — they could drive `WebKitWebDriver`
and `msedgedriver` through the `official` provider instead, but sharing one path
means no platform needs `tauri-driver` installed. The plugin backs all three
natively rather than assuming a Unix webview (`src/platform/windows.rs` talks to
WebView2 through `webview2-com`). That plugin is an optional dependency behind the `e2e`
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
is a hardcoded `/tmp/{identifier}_si.sock` on macOS (`platform_impl/macos.rs` —
literally `/tmp`, not `$TMPDIR`, because the path must stay under 100 chars), a
session-bus **D-Bus name** on Linux, and a named mutex on Windows. None live
under `HOME` or any XDG directory, and the macOS socket ignores the pinned
`TMPDIR` too, so nothing in `isolationEnv` isolates them. A developer with the real Jan open would
otherwise see the test binary hand over its argv and exit before the WebDriver
server ever bound.

## Isolation

Each run gets a throwaway profile in a temp dir, so tests never touch real Jan
data. The desktop app resolves its data folder from
`core::app::paths::data_dir()`; which variables that leaves you needing to
override depends on the platform.

| Platform | `data_dir()` | Redirected by |
| --- | --- | --- |
| macOS | `$HOME/Library/Application Support` | `HOME` |
| Linux | `$XDG_DATA_HOME`, else `$HOME/.local/share` | `HOME` **and** `XDG_DATA_HOME` |
| Windows | `FOLDERID_RoamingAppData` | nothing the OS provides — see below |

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

On Windows there is no OS lever at all: `dirs` calls
`SHGetKnownFolderPath(FOLDERID_RoamingAppData, ..)`, which reads the registry and
takes no environment input. So Jan supplies its own — `core/app/paths.rs` prefers
`JAN_DATA_ROOT` and falls back to `dirs`.

It is Jan's own variable rather than `%APPDATA%`, which would also have worked.
The cost is what rules it out: Windows sets `%APPDATA%` for every interactive
session and processes inherit it, so honouring it would move the data root of
every existing install onto a value Jan does not control — and the blast radius
includes the legacy-config migration's `fs::copy` + `fs::remove_file`. A
dedicated name is unset in every real install, so the shipping binary resolves
byte-identically to `dirs` on all three platforms.

`paths.rs` honours the variable everywhere — one that silently did nothing on two
platforms out of three would be a trap — but the harness sets it on Windows only.
macOS and Linux already have a lever, and pushing them down the override branch
would stop the suite exercising the `dirs` lookup a real user gets.

That closes the destructive legacy-config migration too, though not because one
known folder serves both: `dirs::config_dir()` sits behind
`#[cfg(target_os = "linux")]` in `legacy_app_config_candidate_paths()`, so the
only Windows candidate comes from `resolve_bundle_app_data_dir()` —
`paths::data_dir()` joined with the bundle identifier. One variable moves both
because both go through `paths.rs`.

`APPDATA` is still set alongside it, for agreement rather than because `paths.rs`
reads it: anything else in the process tree that reads the variable directly
would otherwise see the real profile.

`USERPROFILE` and `LOCALAPPDATA` are redirected as well, and the harness must
create `AppData\Roaming` and `AppData\Local` under the throwaway profile before
the app starts. `SHGetKnownFolderPath` resolves the Roaming and Local known
folders from `REG_EXPAND_SZ` values of the form `%USERPROFILE%\AppData\...`,
expands them against the process environment — so the `USERPROFILE` override does
move them — and then verifies the result exists, because `dirs` does not pass
`KF_FLAG_DONT_VERIFY`. Miss `AppData\Local` and `dirs::cache_dir()` is `None`,
which `tauri-plugin-http`'s cookie jar turns into a startup panic
(`PluginInitialization("http", "unknown path")`, exit 101) before a window
exists; the embedded driver never binds and the run fails in `onPrepare`
reporting only `code=101`. The pair also takes the WebView2 user-data folder with
it, which Tauri puts at `%LOCALAPPDATA%\<identifier>\EBWebView` — keyed on the
bundle identifier (`jan.ai.app`) rather than on the executable name, so without
the override a test run and an installed Jan share one browser profile. Those
registry values are the default rather than a guarantee, though: folder
redirection or policy can make them literal paths that ignore `USERPROFILE`, so
isolation still rests on `JAN_DATA_ROOT` and `paths.rs`.

Two things Windows still cannot isolate, both of them accepted gaps enumerated
in `isolation.ts` next to `XDG_RUNTIME_DIR`:

- `dirs::home_dir()` resolves `FOLDERID_Profile` from the user's token rather
  than from a `%USERPROFILE%` template, so `USERPROFILE` does not move it the way
  it moves the AppData pair. The readers under `~/.jan` — `config.toml` and the
  subagent directory — therefore read the real user profile where `HOME`
  redirects them on macOS and Linux. The reachable desktop callers are reads, so
  this is a read leak rather than a destructive one.
- `updater.json` is written through `tauri-plugin-store`, which resolves its
  base with Tauri's own resolver rather than `core/app/paths.rs`, landing it in
  the real `%APPDATA%\jan.ai.app\`. Created only when absent.

Both are residue or reads. The one Windows escape that was destructive —
deep-link registration, which rewrites the `HKCU` `jan://` handler to point at
whichever binary is running — is compiled out under the `e2e` feature instead of
being documented, since no environment variable reaches the registry.

Two things that look like they'd work but don't:

- `JAN_DATA_FOLDER` — despite the name, a different variable from
  `JAN_DATA_ROOT` above: it names the data folder itself rather than the OS root
  it sits under, and only `resolve_jan_data_folder()` reads it, which is the CLI
  path. The desktop build ignores it.
- `CI=e2e` short-circuits `get_app_configurations()` to a hardcoded `"./data"`,
  which would skip the config resolution these tests exist to cover.

Because the profile is always fresh, **every run is a first launch** — no
providers are configured, so `/` renders `SetupScreen`. The suite asserts that
rather than working around it.

A first launch used to **download**: Jan fetches its embedding model
`sentence-transformer-mini` (~45MB) on a profile it has not bootstrapped before,
and announces it with a toast that mounts over the header at a moment set by
network speed. `wdio.conf.ts` now pre-seeds the one-shot flag that suppresses
that bootstrap, so a run neither downloads it nor shows the toast — a kept
profile is ~112KB rather than ~45MB. Set `JAN_E2E_EMBEDDER_DOWNLOAD=1` to get
the real bootstrap back, which is what a spec *about* the embedder needs.

That is the one large download removed, not every network call: the app still
fetches small metadata such as the model catalogue, and no attempt has been made
to verify the suite on a machine with no network at all. What it buys is
determinism — the toast was landing on whatever a spec was clicking, and see
[the analytics prompt section](#the-analytics-prompt-covers-the-composer) for
what that cost.

## Writing specs

`browser.tauri.execute()` is unavailable: it needs `window.__TAURI__`, which
requires `withGlobalTauri: true` in `tauri.conf.json`. That would expose the
full Tauri API to anything running in the webview, so it stays off. Assert
through the UI instead — which is closer to what users actually see.

Navigate with the `goto()` helper in `helpers/navigation.ts` rather than
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

Before asserting that something is **absent** from disk, assert it was there
first. An "is it gone?" check against a path that was never written passes
whatever the code does, and it fails silently rather than loudly — nothing about
the green run says the assertion proved nothing. `specs/chat.e2e.ts` brackets its
delete this way: it waits for the thread directory to exist, deletes, then waits
for it to go away.

The same shape applies in time rather than on disk: when you are asserting on
something produced by a **fire-and-forget background request, assert it before
doing anything that cancels it**. The generated thread title is the live example,
and it is product behaviour rather than a harness quirk. The summarizer runs from
`onFinish` only on a refresh tick — the first assistant message, then every fourth
(`web-app/src/routes/threads/$threadId.tsx:632-635`,
`TITLE_REFRESH_EVERY_N_ASSISTANT_MESSAGES = 4`) — and sending the next message
aborts whatever title request is in flight (same file, line 957;
`lib/thread-title-summarizer.ts` swallows the `AbortError` and returns null). With
two assistant messages there is no second attempt, so a spec that sends again
before the title lands leaves the row reading "New Thread" permanently, and no
retry recovers it. `specs/chat.e2e.ts` asserts the title at the end of its first
test, while the thread has exactly one reply.

### The embedded driver has no real input

`tauri-plugin-wdio-webdriver` synthesizes every interaction in JavaScript. From
`src/platform/executor.rs` (v1.4):

- `dispatch_pointer_event()` builds a `MouseEvent` (`mousedown`/`mouseup`/
  `mousemove`, plus a `click` synthesized after a same-spot down+up) and
  dispatches it at `document.elementFromPoint(x, y)`. It never produces a
  `PointerEvent`.
- `click_element()` — what `elementClick`, and so `elem.click()`, maps to — is
  `el.scrollIntoView(); el.click(); el.focus()`.
- `send_keys_to_element()` focuses the element and then dispatches synthesized
  `keydown`/`keyup` at `document.activeElement`.

Three consequences, all of which read as a failure about the wrong thing:

- **CSS `:hover` never applies.** A synthesized `MouseEvent` does not move the
  hover state, so `moveTo()` cannot reveal hover-only UI, and
  `browser.action('pointer')` cannot either.
- **Radix components that open on `pointerdown` never open from a click.**
  `DropdownMenuTrigger` is the one in Jan's sidebar. `DialogTrigger` and
  `PopoverTrigger` use `onClick` and are fine.
- **The workaround for both is the keyboard**, and it is not a hack — it is the
  route a keyboard user takes. `elementClick` leaves the element focused, which
  both satisfies a `group-focus-within:opacity-100` rule and gives
  `browser.keys('Enter')` a target; Radix's trigger opens on Enter.
  `specs/chat.e2e.ts` does exactly this for the thread overflow menu and carries
  the long-form comment.

**Do not use `waitForClickable()` in this suite.** WDIO's clickability check
includes an `elementFromPoint` test; this driver's click does not.
`click_element()` goes straight through anything painted on top, so the precheck
can only ever reject clicks that would have succeeded — and on a first launch
there is plenty painted on top (the analytics consent panel over the composer,
the download toast over the header; both below). The failure mode is a 30-60s
timeout naming an element that is fine.

Use `clickWhenReady(selector)` from `specs/chat.e2e.ts` instead:
`waitForDisplayed()` + `waitForEnabled()` + `click()`. Displayed and enabled are
still worth waiting for, because they are real states this app uses — Add Model
stays disabled until the model-id field is non-empty, and the send button is
*replaced* outright by a stop button while a reply streams, so waiting for it to
exist is the streaming barrier.

`opacity: 0` is **not** one of the differences, so `clickWhenReady()` is no help
there: `waitForDisplayed()` runs `checkVisibility({opacityProperty: true})`
browser-side and rejects a fully transparent element exactly as
`waitForClickable()` would. Anything revealed only on hover or focus needs
`waitForExist()` instead — which is what the third test in `specs/chat.e2e.ts`
does for the thread overflow menu, clicking it to focus it before the
`opacity-0` rule stops applying.

### The analytics prompt covers the composer

Once a provider makes onboarding complete, `PromptAnalytic`
(`web-app/src/containers/analytics/`) floats the consent panel at
`fixed bottom-4 right-4 z-50` — directly over the chat composer's send button.
The button stays present, enabled and non-zero-sized, so it fails only
WebDriver's elementFromPoint check and reports as "still not clickable", which
names an element that is fine.

`specs/chat.e2e.ts` dismisses it in `before()` via
`[data-testid="analytic-deny"]` — deny rather than allow, because a test run has
no business opting into telemetry. Any new spec that reaches a post-onboarding
state has to do the same.

It is not the only thing that floats. The embedding-model download from
[Isolation](#isolation) completes at a different moment every run depending on
network speed, and when it lands a sonner toast (*Download Complete — Model
"sentence-transformer-mini" downloaded and verified successfully*) mounts
top-right, over the header of whatever page is open. Anything that depends on the
header being unobstructed is therefore a coin flip. This produced three
consecutive red runs, with `[data-testid="add-provider-trigger"]` reported as
"still not clickable" while being present, enabled, visible and 132x32 — which is
the `waitForClickable()` ban above, in the wild.

A click that arrives in that window has also been seen to simply not take. Once:
the click on `[data-testid="add-provider-trigger"]` returned and the dialog never
appeared, while the toast was landing. It has not reproduced, and **why** it did
not register is not known. The likeliest explanation is that `el.click()` went to
a node React had just replaced, but that is unverified — the Toaster is a sibling
of the page in `routes/__root.tsx`, and `routes/settings/providers/index.tsx`
does not remount its header when the model list changes, so nothing observed says
a mounting toast re-keys the trigger.

Opening a dialog therefore goes through
`openDialog(triggerSelector, dialogSelector)` in `specs/chat.e2e.ts`, which
re-clicks until the dialog is displayed — kept because the retry is cheap and the
guard makes it safe, not because the cause is understood. The guard is the
load-bearing part and it *is* verified: Radix mirrors open state onto the trigger
as `data-state="open"`, and the trigger's `onClick` is a **toggle**, so a blind
second click would shut a dialog that had in fact opened. The helper skips the
click whenever the trigger already reads `data-state="open"`.

### Per-command focus recovery is switched off

`@wdio/tauri-service`'s `beforeCommand` hook calls `ensureActiveWindowFocus()`
for `getTitle`/`findElement`/`findElements`/`$`/`$$`/`elementClick`, which asks
the app for its window states over `browser.tauri.execute()`. That needs
`window.__wdio_original_core__`, absent here for the same reason
`browser.tauri.execute()` is unavailable to specs — `withGlobalTauri` is off — so
the probe cannot succeed. It times out after 5s **per command**, logging
`Failed to get window states` each time.

`wdio.conf.ts`'s `before` hook turns it off by doing
`browser.switchToWindow(await browser.getWindowHandle())`: `afterCommand` treats
a successful non-internal `switchToWindow` as the user taking charge of window
selection and suppresses the probe for the rest of the session, so switching to
the handle we are already on is a no-op that disables it. Jan runs a single
window under test, so there is nothing to recover. The numbers are the spec
reporter's own per-file timings on macOS: `smoke.e2e.ts` went from 40.3s to
~70ms for the same three assertions, and `chat.e2e.ts` from dying on the Mocha
hook timeout to a few seconds. The work did not get faster — roughly 5s per
element lookup stopped being spent.

If a future spec is mysteriously slow and the log carries
`Failed to get window states`, that hook is what to check.

### Shared helpers

`helpers/` holds the pieces more than one spec needs:

- `navigation.ts` — `goto()`, described above.
- `paths.ts` — two directories, and they are not the same one. Asserting against
  a real on-disk path is what makes a filesystem check meaningful; asserting
  against `isolationEnv()` would only restate what the harness injected.
  - `janDataDir(testHome)` — the directory the Rust side resolves for app data
    inside the throwaway profile (`data_dir()/Jan`). `settings.json` lives here.
  - `janUserDataDir(testHome)` — `janDataDir()/data`, which is what
    `settings.json`'s `data_folder` points at and what the Rust thread code
    takes as its `data_folder` argument (`core/threads/utils.rs`,
    `get_thread_dir`). Threads are at `janUserDataDir()/threads/<id>`.

  Picking the wrong one of those is quiet rather than loud, which is why it is
  worth stating: a path one segment short simply never exists, and an "is it
  gone?" assertion against it passes for the wrong reason.
- `mock-openai.ts` — see below.

### Talking to a model without a model

`specs/chat.e2e.ts` covers the loop the product lives or dies by — send, stream a
reply, keep it across a reload, delete it — against a mock OpenAI-compatible
server on loopback rather than a real one.

`startMockOpenAI()` binds port 0 on `127.0.0.1` and answers three things, all of
which the app genuinely asks for:

- `GET /v1/models` — `useProviderModels` → `fetchModelsFromProvider`
  (`services/providers/tauri.ts`) fetches `${base_url}/models` as soon as the Add
  Model dialog opens. Without it that dialog renders an error state.
- `POST /v1/chat/completions` with `stream: true` — SSE, echoing
  `MOCK_REPLY_PREFIX` plus the last user message back across several chunks.
  Echoing proves the typed text reached the server and returned; several chunks
  prove the webview assembles a stream rather than rendering one blob.
- the same path with a falsy `stream` — the thread-title summarizer, which goes
  through `generateText`. It answers a fixed `MOCK_TITLE` so the sidebar
  assertion is deterministic.

This works from Node because Jan issues those requests from Rust
(`getRuntimeFetch()` → `tauri-plugin-http`), so the server sees an ordinary HTTP
client: no CORS, no preflight, and the capability set already allows
`http://*:*`. The provider is registered through the real Add Provider and Add
Model dialogs, so the configuration path is covered too.

Start the server in `before()` and close it in `after()` — an open listener keeps
the worker's event loop alive and the run never exits.

What this deliberately does not cover is llama.cpp. A real local model means a
multi-gigabyte download, minutes per run, and different behaviour on every
backend; it needs its own platform-specific test rather than a place in the
critical-path suite.

What the mock removes is the *LLM* download from the chat path, not every
download. The app still fetches its `sentence-transformer-mini` embedding model
on a profile that has not been bootstrapped, which the harness now seeds around
— see [Isolation](#isolation).

### Spec order is maintained by hand

`specs` in `wdio.conf.ts` is an explicit array, not a glob, because state leaks
forwards between spec files: `smoke.e2e.ts` asserts the first-run setup wizard
and `chat.e2e.ts` configures a provider, which under an alphabetically sorted
glob ran first and broke it.

It leaks further than a shared profile would explain. The embedded provider
spawns **one** app in the launcher's `onPrepare` and every spec file drives that
same process over its own WebDriver session — the run log carries a single
`Tauri app spawned (PID: …)` line, not one per file. So a later spec inherits
not just what an earlier one wrote to disk but the live webview: its route, its
zustand stores, and any dialog left open. Only an explicit `browser.refresh()`
clears the in-memory half, and `goto()` does not.

A new spec therefore has to be added to that array, and it is worth thinking
about where: a spec that needs a pristine profile belongs before anything that
configures the app.

### A green run still logs errors

Both spec files leave `no such element` and `stale element reference` lines in
the wdio log even when every test passes — on a two-run Linux check, 14 and 23
of them respectively; on Windows, 53. They are `INFO webdriver: RESULT`
responses, not failures: `waitForDisplayed()`, `waitUntil()` and `openDialog()`
all work by polling, so every attempt before the one that succeeds is logged as
an error the client then swallows. React swapping a node under a held reference
produces the stale ones.

The consequence is that grepping a run for `error` tells you nothing. Read the
`✓`/`✗` lines and the `Spec Files:` summary instead, and treat the exit code as
the verdict.
