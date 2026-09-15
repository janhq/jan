import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { TauriCapabilities, TauriServiceOptions } from '@wdio/tauri-service'
import { SevereServiceError } from 'webdriverio'
import { isolationEnv } from './isolation.js'

// The app resolves its data folder through `dirs::data_dir()`, so isolation is
// only sound where that call can be redirected by environment:
//
//   macOS   $HOME/Library/Application Support        -> HOME
//   Linux   $XDG_DATA_HOME, else $HOME/.local/share  -> both (see isolationEnv)
//   Windows FOLDERID_RoamingAppData via the Win32
//           known-folder API                         -> no env override exists
//
// Windows therefore cannot be isolated at all, and a run there would use a real
// Jan profile. Failing loudly beats pretending.
if (process.platform !== 'darwin' && process.platform !== 'linux') {
  throw new Error(
    `e2e isolation is not possible on ${process.platform}; refusing to run. ` +
      'On Windows `dirs::data_dir()` reads FOLDERID_RoamingAppData through the ' +
      'known-folder API, which has no environment override.'
  )
}

const repoRoot = resolve(import.meta.dirname, '..')

// The desktop binary built by `yarn build:e2e:app`. Debug profile: the e2e
// feature is a test-only opt-in and never goes near a release artifact.
const appBinary = join(repoRoot, 'src-tauri/target/debug/Jan-Desktop')

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
// Deliberately NOT using JAN_DATA_FOLDER: only resolve_jan_data_folder() reads
// it, and that is the CLI path. The desktop build ignores it.
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
  process.once('exit', () => {
    if (process.env.JAN_E2E_KEEP) {
      console.log(`e2e profile kept at ${testHome}`)
      return
    }
    // Belt and braces: never recurse outside the temp root.
    if (!testHome.startsWith(realpathSync(tmpdir()))) return
    rmSync(testHome, { recursive: true, force: true })
  })
  // No SIGINT/SIGTERM handler on purpose. wdio installs its own, and a second
  // listener would delete the tree while that one is still tearing the app
  // down -- the race the comment above exists to avoid. Ctrl-C therefore leaks
  // one directory under the OS temp root, which is the cheaper failure.
}

// TMPDIR is pinned to a path inside the profile, and temp_dir() will not create
// it. An app that cannot write scratch is a confusing failure; make it exist.
mkdirSync(join(testHome, 'tmp'), { recursive: true })

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
  // where there is no WKWebView driver to attach from outside; used on Linux too
  // so both platforms exercise one path and neither needs `tauri-driver`
  // installed (Linux could otherwise drive WebKitWebDriver via 'official').
  driverProvider: 'embedded',
  env: isolationEnv(testHome),
}

export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: ['./specs/**/*.e2e.ts'],
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
  waitforTimeout: 20_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,
  mochaOpts: { ui: 'bdd', timeout: 120_000 },

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
        '(`pkill -f Jan-Desktop`). To use a different port instead, set ' +
        'TAURI_WEBDRIVER_PORT.'
    )
  },
}
