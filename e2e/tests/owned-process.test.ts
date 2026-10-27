import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { ownedPhase, stopOwned, type OwnedChild } from '../owned-process.js'

class FakeChild extends EventEmitter implements OwnedChild {
  pid = 123
  exitCode: number | null = null
  signalCode: string | null = null
  signals: string[] = []
  ignoreTerm = false
  kill(signal: NodeJS.Signals) {
    this.signals.push(signal)
    if (signal !== 'SIGTERM' || !this.ignoreTerm) this.exit()
    return true
  }
  exit() { this.exitCode = 0; this.emit('exit', 0, null) }
}

for (const stage of ['startup', 'run', 'timeout']) {
  test(`${stage} interruption awaits app and runner teardown`, async () => {
    const app = new FakeChild()
    const wdio = new FakeChild()
    const events: string[] = []
    let cancel!: (error: Error) => void
    const cancellation = new Promise<never>((_, reject) => { cancel = reject })
    const phase = ownedPhase(async own => {
      own(app)
      if (stage !== 'startup') own(wdio)
      cancel(new Error(stage))
      await new Promise<void>(() => {})
    }, cancellation, async child => {
      events.push(child === app ? 'app' : 'wdio')
      await stopOwned(child, { platform: 'linux', graceMs: 5 })
      events.push('exited')
    })
    await assert.rejects(phase, new RegExp(stage))
    assert.deepEqual(events, stage === 'startup' ? ['app', 'exited'] : ['app', 'exited', 'wdio', 'exited'])
  })
}

test('Unix escalates a tracked handle and awaits exit', async () => {
  const app = new FakeChild()
  app.ignoreTerm = true
  await stopOwned(app, { platform: 'linux', graceMs: 5 })
  assert.deepEqual(app.signals, ['SIGTERM', 'SIGKILL'])
})

test('Windows kills only the owned PID tree before root termination', async () => {
  const app = new FakeChild()
  await stopOwned(app, { platform: 'win32', graceMs: 5, killTree: async pid => {
    assert.equal(pid, app.pid)
    assert.equal(app.exitCode, null)
    app.exit()
  } })
  assert.deepEqual(app.signals, [])
})

test('already exited roots are not signalled (avoid reused PIDs)', async () => {
  const app = new FakeChild()
  app.exit()
  await stopOwned(app, { platform: 'win32', killTree: async () => { assert.fail('must not taskkill') } })
  assert.deepEqual(app.signals, [])
})

test('cleanup failure still attempts the other root and rejects', async () => {
  const children = [new FakeChild(), new FakeChild()]
  const stopped: OwnedChild[] = []
  await assert.rejects(ownedPhase(async own => { children.forEach(own) }, new Promise<never>(() => {}), async child => {
    stopped.push(child)
    if (child === children[0]) throw new Error('uncertain exit')
  }), /teardown failed/)
  assert.deepEqual(stopped, children)
})

test('startup spawn failure still tears down registered handle', async () => {
  const app = new FakeChild()
  await assert.rejects(ownedPhase(async own => {
    own(app)
    throw new Error('spawn error')
  }, new Promise<never>(() => {}), child => stopOwned(child, { platform: 'linux', graceMs: 5 })), /spawn error/)
  assert.equal(app.exitCode, 0)
})
