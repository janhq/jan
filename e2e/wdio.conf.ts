import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { TauriCapabilities, TauriServiceOptions } from '@wdio/tauri-service'

// Isolation is only sound on macOS, and silently pretending otherwise is worse
// than not running: the app resolves its data folder through `dirs::data_dir()`,
// which on Windows reads FOLDERID_RoamingAppData via the Win32 known-folder API
// (ignoring USERPROFILE entirely), and on Linux prefers $XDG_DATA_HOME over
// $HOME. Either would let the suite write to a real Jan profile.
if (process.platform !== 'darwin') {
  throw new Error(
    `e2e isolation is only verified on macOS; refusing to run on ${process.platform}. ` +
      'Supporting another platform means redirecting that platform\'s data dir ' +
      '(XDG_DATA_HOME on Linux; the known-folder API on Windows has no env override).'
  )
}

const repoRoot = resolve(import.meta.dirname, '..')

// The desktop binary built by `yarn build:e2e:app`. Debug profile: the e2e
// feature is a test-only opt-in and never goes near a release artifact.
const appBinary = join(repoRoot, 'src-tauri/target/debug/Jan-Desktop')

// A throwaway HOME per run. The desktop app resolves its data folder from
// `app_handle.path().data_dir()` (core/app/commands.rs), which on macOS is
// $HOME/Library/Application Support -- so redirecting HOME is what keeps the
// suite away from the developer's real Jan profile.
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
const testHome =
  inheritedHome ?? mkdtempSync(join(realpathSync(tmpdir()), 'jan-e2e-'))
process.env.JAN_E2E_HOME = testHome

export const testHomeForSpecs = testHome

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
}

const tauriServiceOptions: TauriServiceOptions = {
  // Embedded WebDriver server (tauri-plugin-wdio-webdriver), the only provider
  // that works on macOS -- there is no WKWebView driver to drive from outside.
  driverProvider: 'embedded',
  env: { HOME: testHome },
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
}
