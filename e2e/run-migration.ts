import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, mkdtempSync, openSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isolationEnv } from './isolation.js'
import { exited, ownedPhase } from './owned-process.js'
import { setTimeout as delay } from 'node:timers/promises'
import { assertSafeE2eHome, assertSafeLaunchEnvironment, canonicalPath, launchContext } from './launch-guard.js'
import { janUserDataDir } from './helpers/paths.js'
import { assertMigrated, migrationPhases, seedMigration } from './migration.js'

const context = launchContext()
assertSafeLaunchEnvironment(context)
// Never accept a caller's profile: this runner alone owns seeding and deletion.
if (process.env.JAN_E2E_HOME) throw new Error('Unset JAN_E2E_HOME: migration requires a fresh owned profile')
if (process.env.JAN_E2E_EMBEDDER_DOWNLOAD) throw new Error('Unset JAN_E2E_EMBEDDER_DOWNLOAD for migration smoke')
const port = Number(process.env.TAURI_WEBDRIVER_PORT ?? 4445)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid TAURI_WEBDRIVER_PORT')
const home = assertSafeE2eHome(mkdtempSync(join(realpathSync(tmpdir()), 'jan-e2e-migration-')), context)
const logs = join(home, 'runner-logs')
mkdirSync(logs)
let interrupted = false
let cancelPhase: ((error: Error) => void) | undefined
const interrupt = () => {
  interrupted = true
  cancelPhase?.(new Error('Migration interrupted'))
}
process.on('SIGINT', interrupt)
process.on('SIGTERM', interrupt)

async function listening() {
  return new Promise<boolean>((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.setTimeout(1000)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('timeout', () => { socket.destroy(); reject(new Error('driver port probe timed out')) })
    socket.once('error', error => {
      socket.destroy()
      if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') resolve(false)
      else reject(error)
    })
  })
}
async function closed() {
  const deadline = Date.now() + 30_000
  while (await listening()) {
    if (Date.now() >= deadline) throw new Error(`Embedded driver port ${port} did not close; no foreign process will be killed`)
    await delay(200)
  }
}

let success = false
try {
  seedMigration(home)
  // Seed once, before either process starts. Config/worker evaluation must not
  // rewrite this file on launch two (see wdio.conf.ts).
  writeFileSync(join(janUserDataDir(home), 'settings.json'), JSON.stringify({ 'llamacpp-embedder-bootstrapped': 'true' }))
  await migrationPhases(async phase => {
    if (interrupted) throw new Error('Migration interrupted')
    assertSafeE2eHome(home, context)
    const output = openSync(join(logs, `phase-${phase}.log`), 'w')
    console.log(`Migration phase ${phase}: ${home} (logs: ${logs})`)
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancellation = new Promise<never>((_resolve, reject) => {
      cancelPhase = error => { cancelled = true; reject(error) }
      timer = setTimeout(() => cancelPhase?.(new Error(`Migration phase ${phase} timed out`)), 600_000)
    })
    try {
      await ownedPhase(async own => {
        mkdirSync(join(home, 'tmp'), { recursive: true })
        if (process.platform === 'win32') {
          mkdirSync(join(home, 'AppData', 'Roaming'), { recursive: true })
          mkdirSync(join(home, 'AppData', 'Local'), { recursive: true })
        }
        const app = spawn(resolve(import.meta.dirname, '../src-tauri/target/debug',
          process.platform === 'win32' ? 'Jan-Desktop.exe' : 'Jan-Desktop'), [], {
          env: { ...process.env, ...isolationEnv(home), TAURI_WEBDRIVER_PORT: String(port), WDIO_EMBEDDED_SERVER: 'true' },
          stdio: ['ignore', output, output],
        })
        own(app)
        // Subscribe immediately, including ENOENT / crashes before readiness.
        const appExit = exited(app).then(() => {
          cancelled = true
          throw new Error('App exited before phase teardown')
        }, error => { cancelled = true; throw error })
        const run = async () => {
          const deadline = Date.now() + 60_000
          while (!cancelled) {
            try {
              const response = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1000) })
              const status = await response.json() as { value?: { ready?: boolean } }
              if (response.ok && status.value?.ready) break
            } catch { /* app may not have bound yet */ }
            if (Date.now() >= deadline) throw new Error('Embedded driver startup timed out')
            await delay(200)
          }
          // The cancellation race may already have entered teardown. Never
          // register another child after that point.
          if (cancelled) return
          const wdio = spawn(process.execPath, [join(import.meta.dirname, 'node_modules/@wdio/cli/bin/wdio.js'), 'run', './wdio.conf.ts'], {
            cwd: import.meta.dirname,
            env: { ...process.env, JAN_E2E_HOME: home, JAN_E2E_SCENARIO: 'migration', JAN_E2E_MIGRATION_PHASE: String(phase) },
            stdio: ['ignore', output, output],
          })
          own(wdio)
          await exited(wdio)
        }
        await Promise.race([run(), appExit])
      }, cancellation)
    } finally {
      cancelled = true
      clearTimeout(timer)
      cancelPhase = undefined
      closeSync(output)
      // A closed port is necessary, not sufficient: ownedPhase also awaited
      // each tracked root's exit. Failure of either barrier retains the profile.
      await closed()
    }
    assertMigrated(home)
  }, closed)
  success = true
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  process.removeListener('SIGINT', interrupt)
  process.removeListener('SIGTERM', interrupt)
  if (success && !process.env.JAN_E2E_KEEP && canonicalPath(home) === home) {
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  } else {
    console.log(`Migration profile and logs retained: ${home}`)
  }
}
