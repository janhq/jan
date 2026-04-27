import { spawn, spawnSync, ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Options } from '@wdio/types'

const repoRoot = resolve(__dirname, '..')

// Built Tauri binary. Override with JAN_BINARY for nightly/installed builds.
const defaultBinary =
  process.platform === 'win32'
    ? resolve(repoRoot, 'src-tauri/target/release/Jan.exe')
    : resolve(repoRoot, 'src-tauri/target/release/Jan')

const janBinary = process.env.JAN_BINARY ?? defaultBinary

let tauriDriver: ChildProcess | undefined
let profileDir: string | undefined

/**
 * Per-run profile isolation.
 *
 * Jan resolves its data directory via Tauri's `dirs::data_dir()`, which honors
 * `XDG_DATA_HOME` on Linux and `APPDATA` on Windows. Pointing those at a fresh
 * tempdir gives every test run a clean slate (no leftover models, settings,
 * threads). macOS has no env-var override and is unsupported anyway.
 *
 * Set JAN_KEEP_PROFILE=1 to skip cleanup when debugging.
 */
function makeProfileEnv(): NodeJS.ProcessEnv {
  profileDir = mkdtempSync(join(tmpdir(), 'jan-e2e-'))
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (process.platform === 'win32') {
    env.APPDATA = profileDir
    env.LOCALAPPDATA = profileDir
  } else {
    env.XDG_DATA_HOME = profileDir
    env.XDG_CONFIG_HOME = join(profileDir, 'config')
    env.XDG_CACHE_HOME = join(profileDir, 'cache')
  }
  return env
}

export const config: Options.Testrunner = {
  runner: 'local',
  tsConfigPath: './tsconfig.json',

  specs: ['./specs/**/*.e2e.ts'],
  maxInstances: 1,

  capabilities: [
    {
      browserName: 'wry',
      // tauri-driver reads these to launch the app under WebKitWebDriver / Edge Driver.
      'tauri:options': {
        application: janBinary,
      },
    } as WebdriverIO.Capabilities,
  ],

  hostname: '127.0.0.1',
  port: 4444,

  logLevel: 'info',
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 120_000,
  },

  // tauri-driver must be on PATH: `cargo install tauri-driver --locked`
  onPrepare() {
    const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', [
      'tauri-driver',
    ])
    if (which.status !== 0) {
      throw new Error(
        'tauri-driver not found on PATH. Install it with: cargo install tauri-driver --locked'
      )
    }
  },

  beforeSession() {
    const env = makeProfileEnv()
    tauriDriver = spawn('tauri-driver', [], {
      stdio: [null, process.stdout, process.stderr],
      env,
    })
    tauriDriver.on('error', (err) => {
      throw new Error(`tauri-driver failed to start: ${err.message}`)
    })
  },

  afterSession() {
    tauriDriver?.kill()
    if (profileDir && !process.env.JAN_KEEP_PROFILE) {
      try {
        rmSync(profileDir, { recursive: true, force: true })
      } catch {
        // best-effort cleanup; ignore
      }
    }
  },
}
