import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { ownedPhase, stopOwned, type OwnedChild } from '../owned-process.js'
import { deadlineCancellation, withCleanup } from '../phase-lifecycle.js'

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

for (const stage of ['startup', 'run']) {
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

for (const workFails of [false, true]) {
  for (const cleanupFails of [false, true]) {
    test(`owned phase preserves failures: work=${workFails}, cleanup=${cleanupFails}`, async () => {
      const original = new Error('WDIO assertion failed')
      const teardown = new Error('app did not exit')
      const children = [new FakeChild(), new FakeChild()]
      const stopped: OwnedChild[] = []
      const phase = ownedPhase(async own => {
        children.forEach(own)
        if (workFails) throw original
      }, new Promise<never>(() => {}), async child => {
        stopped.push(child)
        if (cleanupFails && child === children[0]) throw teardown
      })
      if (cleanupFails) {
        await assert.rejects(phase, error => {
          assert.ok(error instanceof AggregateError)
          assert.deepEqual(error.errors, workFails ? [original, teardown] : [teardown])
          assert.equal(error.cause, workFails ? original : undefined)
          return true
        })
      } else if (workFails) await assert.rejects(phase, error => error === original)
      else await phase
      assert.deepEqual(stopped, children)
    })
  }
}

for (const phaseFails of [false, true]) {
  for (const portFails of [false, true]) {
    test(`port closure barrier preserves failures: phase=${phaseFails}, port=${portFails}`, async () => {
      const original = new Error('phase failed')
      const port = new Error('Embedded driver port did not close')
      let checked = false
      const phase = withCleanup(async () => {
        if (phaseFails) throw original
        return 42
      }, () => [async () => {
        checked = true
        if (portFails) throw port
      }], 'Migration phase cleanup failed')
      if (portFails) await assert.rejects(phase, error => {
        assert.ok(error instanceof AggregateError)
        assert.deepEqual(error.errors, phaseFails ? [original, port] : [port])
        assert.equal(error.cause, phaseFails ? original : undefined)
        return true
      })
      else if (phaseFails) await assert.rejects(phase, error => error === original)
      else assert.equal(await phase, 42)
      assert.equal(checked, true)
    })
  }
}

test('phase, owned teardown, log cleanup and port closure failures all survive', async () => {
  const original = new Error('startup failed')
  const teardown = new Error('owned teardown failed')
  const log = new Error('log close failed')
  const port = new Error('port closure failed')
  let checked = false
  await assert.rejects(withCleanup(() => ownedPhase(async own => {
    own(new FakeChild())
    throw original
  }, new Promise<never>(() => {}), async () => { throw teardown }), () => [
    () => { throw log },
    () => { checked = true; throw port },
  ], 'Migration phase cleanup failed'), error => {
    assert.ok(error instanceof AggregateError)
    assert.deepEqual(error.errors.slice(1), [log, port])
    const inner = error.errors[0]
    assert.ok(inner instanceof AggregateError)
    assert.deepEqual(inner.errors, [original, teardown])
    assert.equal(inner.cause, original)
    assert.equal(error.cause, inner)
    return true
  })
  assert.equal(checked, true)
})

test('undefined work rejection is not mistaken for success', async () => {
  await assert.rejects(withCleanup(async () => { throw undefined },
    () => [() => { throw new Error('cleanup') }], 'cleanup failed'), error => {
    assert.ok(error instanceof AggregateError)
    assert.equal(error.errors.length, 2)
    assert.equal(error.errors[0], undefined)
    return true
  })
})

test('real deadline automatically cancels work and awaits every owned root', async () => {
  const children = [new FakeChild(), new FakeChild()]
  const error = new Error('phase deadline expired')
  const events: string[] = []
  const deadline = deadlineCancellation(10, error, () => { events.push('cancel') })
  try {
    await assert.rejects(ownedPhase(async own => {
      children.forEach(own)
      await new Promise<void>(() => {})
    }, deadline.promise, async child => {
      assert.deepEqual(events[0], 'cancel')
      await stopOwned(child, { platform: 'linux', graceMs: 5 })
      events.push('exited')
    }), rejection => rejection === error)
    assert.deepEqual(events, ['cancel', 'exited', 'exited'])
    assert.ok(children.every(child => child.exitCode === 0))
  } finally { deadline.dispose() }
})

test('disposing the deadline prevents automatic cancellation', async () => {
  let cancelled = false
  const deadline = deadlineCancellation(5, new Error('unused'), () => { cancelled = true })
  deadline.dispose()
  await new Promise(resolve => setTimeout(resolve, 15))
  assert.equal(cancelled, false)
})
