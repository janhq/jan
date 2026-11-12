import { spawn, type ChildProcess } from 'node:child_process'
import { withCleanup } from './phase-lifecycle.js'

export interface OwnedChild {
  pid?: number
  exitCode: number | null
  signalCode: string | null
  kill(signal: NodeJS.Signals): boolean
  once(event: 'exit' | 'error', listener: (...args: any[]) => void): unknown
  removeListener(event: 'exit' | 'error', listener: (...args: any[]) => void): unknown
}

// Keep the actual ChildProcess, not a PID read from logs or a reusable PID file.
// On Windows tree cleanup MUST happen before killing the owned root.
export async function stopOwned(child: OwnedChild, options: {
  platform?: string
  graceMs?: number
  killTree?: (pid: number) => Promise<void>
} = {}): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return
  const wait = (ms: number) => new Promise<boolean>(resolve => {
    const done = () => { clearTimeout(timer); child.removeListener('exit', done); resolve(true) }
    const timer = setTimeout(() => { child.removeListener('exit', done); resolve(false) }, ms)
    child.once('exit', done)
    if (child.exitCode !== null || child.signalCode !== null) done()
  })
  if ((options.platform ?? process.platform) === 'win32') {
    await (options.killTree ?? taskkillTree)(child.pid)
  } else {
    child.kill('SIGTERM')
    if (await wait(options.graceMs ?? 5_000)) return
    child.kill('SIGKILL')
  }
  if (!await wait(options.graceMs ?? 5_000)) throw new Error(`Owned process ${child.pid} did not exit`)
}

async function taskkillTree(pid: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    const timer = setTimeout(() => {
      killer.kill('SIGKILL')
      reject(new Error(`taskkill owned PID ${pid} timed out`))
    }, 10_000)
    killer.once('error', error => { clearTimeout(timer); reject(error) })
    killer.once('exit', code => {
      clearTimeout(timer)
      code === 0 ? resolve() : reject(new Error(`taskkill owned PID ${pid}: ${code}`))
    })
  })
}

export function exited(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Owned process failed: code=${code} signal=${signal}`)))
  })
}

// Cancellation races both startup and execution. Teardown is awaited even when
// work fails, and both roots are attempted if either teardown fails.
export async function ownedPhase(work: (own: (child: OwnedChild) => void) => Promise<void>, cancel: Promise<never>,
  stop: (child: OwnedChild) => Promise<void> = stopOwned): Promise<void> {
  const children: OwnedChild[] = []
  await withCleanup(
    () => Promise.race([work(child => children.push(child)), cancel]),
    // App is registered first: stop it before WDIO so Windows can traverse its
    // live tree. Attempt every root even if an earlier teardown fails.
    () => children.map(child => () => stop(child)),
    'Owned process teardown failed',
  )
}
