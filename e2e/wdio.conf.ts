import { spawn, spawnSync, ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Options } from '@wdio/types'

const repoRoot = resolve(__dirname, '..')

const DRIVER_PORT = 4444

// Built Tauri binary. Override with JAN_BINARY for nightly/installed builds.
const defaultBinary =
  process.platform === 'win32'
    ? resolve(repoRoot, 'src-tauri/target/release/Jan.exe')
    : resolve(repoRoot, 'src-tauri/target/release/Jan')

const janBinary = process.env.JAN_BINARY ?? defaultBinary

let tauriDriver: ChildProcess | undefined
let profileDir: string | undefined
let profileEnv: Record<string, string> = {}

async function waitForPort(
  port: number,
  host: string,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((res) => {
      const sock = createConnection({ port, host })
      sock.once('connect', () => {
        sock.end()
        res(true)
      })
      sock.once('error', () => {
        sock.destroy()
        res(false)
      })
    })
    if (ok) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`tauri-driver did not open port ${port} within ${timeoutMs}ms`)
}

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
function makeProfileEnv(): Record<string, string> {
  profileDir = mkdtempSync(join(tmpdir(), 'jan-e2e-'))
  const overrides: Record<string, string> = {}
  if (process.platform === 'win32') {
    overrides.APPDATA = profileDir
    overrides.LOCALAPPDATA = profileDir
  } else {
    overrides.XDG_DATA_HOME = profileDir
    overrides.XDG_CONFIG_HOME = join(profileDir, 'config')
    overrides.XDG_CACHE_HOME = join(profileDir, 'cache')
  }
  return overrides
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
      // `env` is forwarded to the spawned Jan process so per-run profile dirs
      // reach the app even if tauri-driver doesn't inherit our environment.
      'tauri:options': {
        application: janBinary,
        get env() {
          return profileEnv
        },
      },
    } as WebdriverIO.Capabilities,
  ],

  hostname: '127.0.0.1',
  port: DRIVER_PORT,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,

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

  async beforeSession() {
    profileEnv = makeProfileEnv()
    tauriDriver = spawn('tauri-driver', [], {
      stdio: [null, process.stdout, process.stderr],
      // Also set the overrides on tauri-driver itself, so any child it
      // spawns inherits them as a belt-and-braces fallback.
      env: { ...process.env, ...profileEnv },
    })
    tauriDriver.on('error', (err) => {
      throw new Error(`tauri-driver failed to start: ${err.message}`)
    })
    await waitForPort(DRIVER_PORT, '127.0.0.1', 30_000)
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
