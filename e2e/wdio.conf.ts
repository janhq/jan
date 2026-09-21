import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { TauriCapabilities, TauriServiceOptions } from '@wdio/tauri-service'
import { SevereServiceError } from 'webdriverio'
import { janUserDataDir } from './helpers/paths.js'
import { isolationEnv } from './isolation.js'

// The app resolves its data folder through `core::app::paths::data_dir()`, and
// isolation is only sound where that call can be redirected by environment:
//
//   macOS   $HOME/Library/Application Support          -> HOME
//   Linux   $XDG_DATA_HOME, else $HOME/.local/share    -> both (see isolationEnv)
//   Windows FOLDERID_RoamingAppData                    -> nothing
//
// Windows has no lever of its own -- `dirs` goes straight to the known-folder
// API, which takes no environment input -- so Jan reads `JAN_DATA_ROOT` ahead of
// it, and isolationEnv() sets that variable there. `paths.rs` honours it on all
// three platforms, but the harness sets it only on Windows: macOS and Linux
// already have a lever, and pushing them down the override branch would stop the
// suite exercising the `dirs` lookup a real user actually gets. See
// src-tauri/src/core/app/paths.rs for why the variable is Jan's own rather than
// `%APPDATA%`, and isolationEnv() for what is still not isolated on Windows.

const repoRoot = resolve(import.meta.dirname, '..')

// The desktop binary built by `yarn build:e2e:app`. Debug profile: the e2e
// feature is a test-only opt-in and never goes near a release artifact.
const appBinary = join(
  repoRoot,
  'src-tauri/target/debug',
  process.platform === 'win32' ? 'Jan-Desktop.exe' : 'Jan-Desktop'
)

// Fail here rather than 2 minutes later inside a driver-connection retry loop,
// which is what a missing binary otherwise looks like.
if (!existsSync(appBinary)) {
  throw new Error(
    `no app binary at ${appBinary}. Run \`yarn build:e2e:app\` from the repo root ` +
      '(or `yarn e2e`, which builds and then runs this suite).'
  )
}

// A throwaway profile per run, which is what keeps the suite away from the
// developer's real Jan data. See isolationEnv() for the variables that confine
// the app to it -- HOME alone is not sufficient on Linux.
//
// Deliberately NOT using JAN_DATA_FOLDER, which despite the name is a different
// variable from JAN_DATA_ROOT above: it names the data folder itself rather than
// the OS root it sits under, and only resolve_jan_data_folder() reads it, which
// is the CLI path. The desktop build ignores it.
// Deliberately NOT using CI=e2e: that hook short-circuits
// get_app_configurations() to a hardcoded "./data", which would skip the very
// config resolution this test is meant to cover.
//
// This module is evaluated twice -- once in the wdio launcher, once in each
// spawned worker. Only the launcher creates the directory; workers inherit the
// path through JAN_E2E_HOME. Creating it unconditionally would give the specs a
// different path from the one the app was actually launched with.
//
// `ownsTestHome` is load-bearing for safety, not just tidiness: cleanup deletes
// recursively, so it must only ever delete a directory this process created. A
// JAN_E2E_HOME inherited from the environment (a stray export, a CI variable)
// is used but never removed.
const inheritedHome = process.env.JAN_E2E_HOME
const ownsTestHome = !inheritedHome
// resolve() because `dirs` silently ignores a relative XDG value and falls back
// to its $HOME-relative default -- which, with a relative HOME, is also relative.
const testHome = inheritedHome
  ? resolve(inheritedHome)
  : mkdtempSync(join(realpathSync(tmpdir()), 'jan-e2e-'))
process.env.JAN_E2E_HOME = testHome

if (ownsTestHome) {
  // Cleanup on process exit rather than in onComplete: wdio runs user
  // onComplete hooks BEFORE service onComplete hooks (@wdio/cli, "user hooks
  // are run before service hooks"), and the tauri service's hook is what kills
  // the app. Removing the tree from onComplete would race a live Jan process
  // that still holds store/log handles -- which can throw EBUSY (force: true
  // only swallows ENOENT) or let the app recreate paths under the deleted tree.
  //
  // The retries are the second half of that: the exit hook runs after the
  // service killed the app, but a kill is not a barrier -- Windows keeps a
  // handle's file locked until the last one closes, and an antivirus scan of the
  // freshly written profile can hold one for a moment longer. rmSync defaults to
  // maxRetries: 0, so one EBUSY/EPERM would throw, and a throw in an 'exit'
  // listener is not routed through uncaughtException: node prints it and exits
  // 1, turning a green run red on cleanup alone. A second of backoff costs
  // nothing on the runs that do not need it.
  process.once('exit', () => {
    if (process.env.JAN_E2E_KEEP) {
      console.log(`e2e profile kept at ${testHome}`)
      return
    }
    // Belt and braces: never recurse outside the temp root.
    if (!testHome.startsWith(realpathSync(tmpdir()))) return
    rmSync(testHome, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    })
  })
  // No SIGINT/SIGTERM handler on purpose. wdio installs its own, and a second
  // listener would delete the tree while that one is still tearing the app
  // down -- the race the comment above exists to avoid. Ctrl-C therefore leaks
  // one directory under the OS temp root, which is the cheaper failure.
}

// TMPDIR is pinned to a path inside the profile, and temp_dir() will not create
// it. An app that cannot write scratch is a confusing failure; make it exist.
mkdirSync(join(testHome, 'tmp'), { recursive: true })

// The AppData pair is not optional on Windows, and getting it wrong does not
// look like a path problem. SHGetKnownFolderPath resolves the Roaming and Local
// known folders from REG_EXPAND_SZ values of the form
// `%USERPROFILE%\AppData\...`, expands them against this process's environment
// -- so the USERPROFILE override moves them -- and then verifies the result
// exists, because `dirs` does not pass KF_FLAG_DONT_VERIFY. Miss `AppData\Local`
// and `dirs::cache_dir()` is None, which tauri-plugin-http's cookie jar turns
// into a panic at startup: PluginInitialization("http", "unknown path"). The app
// then dies before the embedded driver binds, and the run fails in onPrepare
// reporting only `code=101`.
if (process.platform === 'win32') {
  mkdirSync(join(testHome, 'AppData', 'Roaming'), { recursive: true })
  mkdirSync(join(testHome, 'AppData', 'Local'), { recursive: true })
}

// Pre-seed the one-shot flag that turns off the fallback embedder download, so
// a fresh profile never fetches a model over the network mid-spec.
//
// bootstrapDefaultEmbedder() (extensions/llamacpp-extension/src/index.ts) is a
// startup install of `sentence-transformer-mini` that returns immediately when
// getBackendSetting('llamacpp-embedder-bootstrapped') is truthy. That setting
// comes from the `settings_get` Tauri command, which is backed by
// src-tauri/src/core/app/settings_store.rs: a flat JSON string->string map at
// `<jan_data_folder>/settings.json`. Writing the key here, before the app is
// spawned, is indistinguishable from a previous run having done the bootstrap.
//
// Worth doing because the alternative is a ~45MB download to
// `<jan_data_folder>/llamacpp/models/sentence-transformer-mini/model.gguf` on
// every single run, and with it a "Download Complete" toast that mounts over
// the header at a moment set by network speed rather than by the spec. That is
// a coin flip landing on whatever is being clicked: it produced three
// consecutive red runs where `add-provider-trigger` was reported "still not
// clickable" while present, enabled and visible. Seeding removes the download
// and the toast together; a seeded run leaves a ~112KB profile where an unseeded
// one leaves ~45MB. It does not make the app offline -- it still makes small
// metadata requests, the model catalogue among them -- but nothing in these
// specs waits on one.
//
// Not a workaround for a fragile download. A failed bootstrap is already
// non-fatal -- the whole body is try/caught, logged as "will import on demand",
// and retried next launch because the flag is only recorded on success -- and
// nothing in these specs touches the embedder, which serves RAG rather than
// chat. This is about determinism, not about avoiding a hard failure.
//
// Set JAN_E2E_EMBEDDER_DOWNLOAD to skip the seeding and get the real bootstrap
// back, which is what a spec *about* the embedder needs.
//
// Seeded whether or not this process created the profile. Gating it on
// ownership would let an inherited JAN_E2E_HOME -- a stray export, a CI
// variable, someone reusing a profile -- quietly take the download and the
// toast back, with nothing in the log saying so, which is precisely the
// nondeterminism this block exists to remove. Writing one key into a profile
// we did not create is acceptable: it is the same key the product writes
// itself after a successful bootstrap, it only adds to the file, and a caller
// who wants the real download has the env var above.
//
// NOTE this is the backend settings store, at janUserDataDir() -- NOT the app
// config `settings.json` one directory up at janDataDir(), which is the file
// smoke.e2e.ts asserts on. Same filename, different file, different owner.
if (!process.env.JAN_E2E_EMBEDDER_DOWNLOAD) {
  const backendSettingsDir = janUserDataDir(testHome)
  const backendSettingsFile = join(backendSettingsDir, 'settings.json')
  // A fresh mkdtemp profile cannot have one yet, but an inherited profile can,
  // and a populated one at that -- so merge rather than clobber. An unparseable
  // file is left untouched, since losing whatever it holds is worse than the
  // download this avoids.
  let settings: Record<string, string> | undefined = {}
  if (existsSync(backendSettingsFile)) {
    try {
      settings = JSON.parse(readFileSync(backendSettingsFile, 'utf8'))
    } catch {
      settings = undefined
    }
  }
  if (settings) {
    mkdirSync(backendSettingsDir, { recursive: true })
    writeFileSync(
      backendSettingsFile,
      JSON.stringify({
        ...settings,
        'llamacpp-embedder-bootstrapped': 'true',
      })
    )
  }
}

// Resolved exactly as the service resolves it -- getEmbeddedPort(): the
// TAURI_WEBDRIVER_PORT env var, else a hardcoded 4445.
const driverPort = Number(process.env.TAURI_WEBDRIVER_PORT) || 4445

function somethingIsListening(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ port, host: '127.0.0.1' })
    const answer = (listening: boolean) => {
      socket.destroy()
      done(listening)
    }
    socket.setTimeout(1_000)
    socket.once('connect', () => answer(true))
    socket.once('timeout', () => answer(false))
    socket.once('error', () => answer(false))
  })
}

const tauriServiceOptions: TauriServiceOptions = {
  // Embedded WebDriver server (tauri-plugin-wdio-webdriver). Required on macOS,
  // where there is no WKWebView driver to attach from outside; used on Linux and
  // Windows too so all three exercise one path and none needs `tauri-driver`
  // installed (those two could otherwise drive WebKitWebDriver / msedgedriver via
  // 'official'). The plugin has a real WebView2 backend, not just a Unix one:
  // src/platform/windows.rs.
  driverProvider: 'embedded',
  env: isolationEnv(testHome),
}

export const config: WebdriverIO.Config = {
  runner: 'local',
  // Ordered by hand, not globbed. State leaks forwards between spec files, and
  // further than the shared profile explains. Every spec in a run shares one
  // on-disk profile: JAN_E2E_HOME is created in the launcher and inherited by
  // each worker (above), so whatever one spec file writes is still there for
  // the next. But the embedded provider also spawns *one* app, in the
  // launcher's onPrepare, and every spec file drives that same process over its
  // own WebDriver session -- one `Tauri app spawned` line per run, and the
  // service skips the per-worker spawn for this provider. So a later spec
  // inherits the live webview as well: its route, its zustand stores, any
  // dialog left open. Only an explicit browser.refresh() clears that half.
  //
  // smoke.e2e.ts asserts the first-run setup wizard, which the app only
  // renders while no provider is configured, and chat.e2e.ts configures one.
  // The previous glob left ordering to wdio, which sorts matches
  // alphabetically -- `chat` ran first and smoke then failed on a provider
  // another file had written, a reason that has nothing to do with what it
  // tests.
  //
  // The cost is that this list is maintained by hand: a new spec that is not
  // added here does not run, and nothing reports its absence.
  //
  // The order below is smoke -> chat -> message-actions, pristine first and
  // most-configured last. message-actions.e2e.ts registers a second provider
  // and leaves two threads behind, so it has to come after anything that cares
  // what the profile holds.
  specs: [
    './specs/smoke.e2e.ts',
    './specs/chat.e2e.ts',
    './specs/message-actions.e2e.ts',
  ],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': { application: appBinary },
      'wdio:tauriServiceOptions': tauriServiceOptions,
    } as TauriCapabilities,
  ],
  services: [['@wdio/tauri-service', tauriServiceOptions]],
  framework: 'mocha',
  reporters: ['spec'],
  logLevel: 'info',
  // Setting this MOVES the driver log off stdout rather than copying it: wdio
  // points WDIO_LOG_PATH at a per-session file, leaving only the spec reporter
  // on the console. That is the point twice over. The console becomes just the
  // pass/fail list, and the command exchange -- which is the only thing that
  // says which selector a polling helper gave up on -- survives as a file CI
  // can upload after the runner is gone. A local run of the two specs writes
  // ~630 webdriver lines here and none to the terminal.
  outputDir: join(import.meta.dirname, 'logs'),
  waitforTimeout: 20_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,
  // Generous on purpose, because this is a backstop rather than the real
  // deadline. Every wait inside the specs is individually bounded and carries a
  // timeoutMsg that names what broke; Mocha's timeout carries none, so whenever
  // it fires first it replaces a diagnosis with "Timeout of Nms exceeded". A
  // before() hook that walks Add Provider and Add Model has half a dozen phases
  // and budgets ~30s each, which sums past two minutes on a machine slow enough
  // to need any of it -- exactly when the message matters most.
  mochaOpts: { ui: 'bdd', timeout: 300_000 },

  // Suppress the service's per-command window-focus recovery, which this app can
  // never satisfy and which costs five seconds on every element lookup.
  //
  // @wdio/tauri-service's beforeCommand hook calls ensureActiveWindowFocus() for
  // getTitle/findElement/findElements/$/$$/elementClick. That asks the app for
  // its window states over `browser.tauri.execute()`, which waits for
  // `window.__wdio_original_core__` -- a global the plugin's guest JS installs,
  // and which is absent here for the same reason `browser.tauri.execute()` is
  // unavailable to specs: `withGlobalTauri` is off. So the probe cannot ever
  // succeed; it just times out after 5s, per command, and the service logs
  // "Failed to get window states" and carries on. A spec doing thirty lookups
  // spends two and a half minutes waiting for a feature that is not there, which
  // is how a correct spec hits the Mocha timeout in a hook.
  //
  // afterCommand treats a successful, non-internal `switchToWindow` as the user
  // taking charge of window selection and suppresses focus recovery for the rest
  // of the session -- so switching to the handle we are already on is a no-op
  // that turns the probe off. Jan runs a single window under test, so there is
  // nothing for the recovery to recover.
  //
  // `before` runs once per worker, before any spec file.
  before: async (_capabilities, _specs, browser) => {
    await browser.switchToWindow(await browser.getWindowHandle())
  },

  // The embedded provider spawns the app and then polls
  // http://127.0.0.1:<port>/status until *something* reports ready. It never
  // checks that the responder is the process it spawned, and it does not test
  // the port first. So if anything is already listening, the poll is satisfied
  // instantly, the app it just spawned loses the bind, and the whole run drives
  // the other process -- which has a different HOME. The isolation spec then
  // fails accusing the isolation of being broken, which is the wrong diagnosis
  // and an expensive one to chase.
  //
  // Two ways to get there, both ordinary: a second `yarn test` in another
  // terminal, or an orphaned Jan-Desktop from a hard-killed run (the service
  // spawns with detached:false, which does not tie the child's lifetime to the
  // launcher's -- SIGKILL the launcher and the app survives holding the port).
  //
  // A config onPrepare is the right place: it runs in the launcher only, and
  // @wdio/cli runs it before the service's own onPrepare, which is what does
  // the spawning.
  //
  // SevereServiceError, not Error: runLauncherHook catches everything, logs it,
  // and only rethrows `e instanceof SevereServiceError` (@wdio/cli, catchFn). A
  // plain Error here is printed and then ignored, and the run continues into the
  // collision this is meant to prevent -- which is exactly what it did.
  onPrepare: async () => {
    if (!(await somethingIsListening(driverPort))) return
    throw new SevereServiceError(
      `something is already listening on 127.0.0.1:${driverPort}, the port the ` +
        'embedded WebDriver server uses. This run would drive that process ' +
        'instead of the app it launches. Most likely another e2e run is in ' +
        'progress, or a previous one was killed and left Jan-Desktop alive ' +
        `(\`${
          process.platform === 'win32'
            ? 'taskkill /IM Jan-Desktop.exe /F'
            : 'pkill -f Jan-Desktop'
        }\`). To use a different port instead, set TAURI_WEBDRIVER_PORT.`
    )
  },
}
