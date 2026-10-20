import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  findRunningToolCallId,
  queuePositionOf,
  useToolCallRuntime,
  withToolTiming,
} from '../useToolCallRuntime'

const store = () => useToolCallRuntime.getState()

describe('useToolCallRuntime', () => {
  beforeEach(() => {
    store().reset()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-31T10:00:00Z'))
  })

  it('reports the position of each waiting call', () => {
    store().enqueue(['a', 'b', 'c'])
    expect(store().queue).toEqual(['a', 'b', 'c'])
  })

  // Position has to be read from the live queue, not a stored index, or every
  // entry keeps its original number as the ones ahead of it finish.
  it('moves the remaining calls up as each one starts', () => {
    store().enqueue(['a', 'b', 'c'])
    store().markRunning('a')
    expect(store().queue).toEqual(['b', 'c'])
    store().markRunning('b')
    expect(store().queue).toEqual(['c'])
  })

  it('records how long a call took', () => {
    store().enqueue(['a'])
    store().markRunning('a')
    vi.advanceTimersByTime(4200)
    store().markSettled('a')
    const timing = store().timings['a']
    expect(timing.endedAt! - timing.startedAt!).toBe(4200)
  })

  // A denied tool never runs, so it must still leave the queue or the calls
  // behind it stay stuck reporting a position.
  it('drops a call that settled without ever running', () => {
    store().enqueue(['a', 'b'])
    store().markSettled('a')
    expect(store().queue).toEqual(['b'])
    expect(store().timings['a'].startedAt).toBeUndefined()
  })

  // Cards from earlier turns stay on screen, so their durations have to
  // outlive the turn that produced them.
  it('keeps earlier durations when a new turn is enqueued', () => {
    store().enqueue(['a'])
    store().markRunning('a')
    vi.advanceTimersByTime(2000)
    store().markSettled('a')
    store().enqueue(['b'])
    expect(store().timings['a'].endedAt).toBeDefined()
    expect(store().queue).toEqual(['b'])
  })

  // An aborted turn leaves calls in the queue that will never run; left there
  // they keep claiming they are waiting their turn.
  it('clears calls left waiting when a turn is abandoned', () => {
    store().enqueue(['a', 'b'])
    store().markRunning('a')
    store().settleRemaining()
    expect(store().queue).toEqual([])
    expect(store().timings['b'].endedAt).toBeDefined()
    expect(store().timings['b'].startedAt).toBeUndefined()
  })

  // The notification carries no tool call id, so it lands on the call the
  // store already knows is running.
  describe('reportProgress', () => {
    const update = { server: 'github', progress: 3, total: 10, percent: 30 }

    it('attaches an update to the running call', () => {
      store().enqueue(['a', 'b'])
      store().markRunning('a')
      store().reportProgress(update)
      expect(store().progress['a']).toMatchObject({ progress: 3, percent: 30 })
      expect(store().progress['b']).toBeUndefined()
    })

    it('ignores an update when nothing is running', () => {
      store().enqueue(['a'])
      store().reportProgress(update)
      expect(store().progress).toEqual({})
    })

    it('replaces the previous update rather than accumulating', () => {
      store().enqueue(['a'])
      store().markRunning('a')
      store().reportProgress(update)
      store().reportProgress({ ...update, progress: 7, percent: 70 })
      expect(store().progress['a'].progress).toBe(7)
    })

    // A finished call has nothing left to report, and a stale bar under a
    // completed result reads as though it is still working.
    it('drops the update when the call settles', () => {
      store().enqueue(['a'])
      store().markRunning('a')
      store().reportProgress(update)
      store().markSettled('a')
      expect(store().progress['a']).toBeUndefined()
    })
  })

  // A turn can be severed mid-flight (HMR in dev, a reload, a crashed
  // executor), leaving a call marked running that never settles. Since timings
  // outlive their turn, that phantom would stay "running" forever: its elapsed
  // timer keeps ticking, the condensed trace follows it, and MCP progress
  // attaches to it instead of the real call.
  it('settles a call stranded by an abandoned turn when the next one starts', () => {
    store().enqueue(['old'])
    store().markRunning('old')
    store().enqueue(['new'])

    expect(store().timings['old'].endedAt).toBeDefined()
    expect(findRunningToolCallId(store().timings)).toBeUndefined()
  })

  it('reports the running call, ignoring settled ones', () => {
    store().enqueue(['a', 'b'])
    store().markRunning('a')
    store().markSettled('a')
    store().markRunning('b')
    expect(findRunningToolCallId(store().timings)).toBe('b')
  })

  it('ignores transitions for calls it does not know about', () => {
    store().markRunning('ghost')
    store().markSettled('ghost')
    expect(store().timings['ghost']).toBeUndefined()
  })

  // The diff is the whole point of a finished write/edit card, so unlike
  // `progress` it has to outlive the call settling.
  it('keeps a recorded diff after the call settles', () => {
    store().enqueue(['a'])
    store().markRunning('a')
    store().recordDiff('a', '@@ edit 1/1 @@\n+    1 | A')
    store().markSettled('a')
    expect(store().diffs['a']).toContain('+    1 | A')
  })

  it("clears diffs on reset so a thread cannot show another thread's diff", () => {
    store().recordDiff('a', 'diff')
    store().reset()
    expect(store().diffs).toEqual({})
  })

  it('records diffs per call without disturbing the others', () => {
    store().recordDiff('a', 'first')
    store().recordDiff('b', 'second')
    store().recordDiff('a', 'first again')
    expect(store().diffs).toEqual({ a: 'first again', b: 'second' })
  })

  // A turn keeps running when the user opens another thread (#9311), so tool
  // loops of several threads share the store at once. Each must see and settle
  // only its own calls.
  describe('loops of different threads', () => {
    it('queues each thread behind its own calls only', () => {
      store().enqueue(['a1', 'a2'], 'thread-a')
      store().enqueue(['b1', 'b2'], 'thread-b')
      expect(queuePositionOf(store(), 'a2')).toBe(1)
      expect(queuePositionOf(store(), 'b1')).toBe(0)
      expect(queuePositionOf(store(), 'b2')).toBe(1)
    })

    it("does not take another thread's queue or running call when a turn starts", () => {
      store().enqueue(['a1', 'a2'], 'thread-a')
      store().markRunning('a1')
      store().enqueue(['b1'], 'thread-b')
      expect(store().timings['a1'].endedAt).toBeUndefined()
      expect(store().queue).toEqual(['a2', 'b1'])
    })

    it("leaves another thread's queue alone when a loop ends", () => {
      store().enqueue(['a1', 'a2'], 'thread-a')
      store().enqueue(['b1', 'b2'], 'thread-b')
      store().settleRemaining('thread-a')
      expect(store().queue).toEqual(['b1', 'b2'])
      expect(store().timings['a2'].endedAt).toBeDefined()
      expect(store().timings['b1'].endedAt).toBeUndefined()
    })

    it("attaches progress to the running call of the update's server", () => {
      store().enqueue(['a1'], 'thread-a')
      store().enqueue(['b1'], 'thread-b')
      store().markRunning('a1', 'github')
      store().markRunning('b1', 'fetch')
      store().reportProgress({ server: 'fetch', progress: 1 })
      expect(store().progress['b1']).toMatchObject({ server: 'fetch' })
      expect(store().progress['a1']).toBeUndefined()
    })

    // Nothing in the update says which of them it belongs to.
    it('drops progress it cannot attribute to one call', () => {
      store().enqueue(['a1'], 'thread-a')
      store().enqueue(['b1'], 'thread-b')
      store().markRunning('a1', 'github')
      store().markRunning('b1', 'github')
      store().reportProgress({ server: 'github', progress: 1 })
      expect(store().progress).toEqual({})
    })

    it('does not attach progress to the only running call when its server differs', () => {
      store().enqueue(['a1'], 'thread-a')
      store().markRunning('a1', 'github')
      store().reportProgress({ server: 'fetch', progress: 1 })
      expect(store().progress).toEqual({})
    })

    // Cowork records no server, so its call is matched by being the only one.
    it('attaches progress to the only running call when its server is unknown', () => {
      store().enqueue(['c1'])
      store().markRunning('c1')
      store().reportProgress({ server: 'fetch', progress: 1 })
      expect(store().progress['c1']).toMatchObject({ server: 'fetch' })
    })

    it('releases calls enqueued without an owner when asked for none', () => {
      store().enqueue(['c1'])
      store().markRunning('c1')
      store().markSettled('c1')
      store().enqueue(['a1'], 'thread-a')
      store().markRunning('a1')
      store().markSettled('a1')
      store().releaseSettled()
      expect(store().timings['c1']).toBeUndefined()
      expect(store().timings['a1']).toBeDefined()
    })

    it("releases a left thread's settled calls, keeping what its loop still runs", () => {
      store().enqueue(['a1', 'a2', 'a3'], 'thread-a')
      store().enqueue(['b1'], 'thread-b')
      store().markRunning('a1')
      store().recordDiff('a1', 'diff')
      store().markSettled('a1')
      store().markRunning('a2')
      store().markRunning('b1')
      store().markSettled('b1')
      store().releaseSettled('thread-a')
      expect(store().timings['a1']).toBeUndefined()
      expect(store().diffs['a1']).toBeUndefined()
      expect(store().timings['a2'].startedAt).toBeDefined()
      expect(queuePositionOf(store(), 'a3')).toBe(0)
      expect(store().timings['b1']).toBeDefined()
    })
  })

  /// Cowork dispatches serially and has no queue to report, but its cards still
  /// need a duration -- without a timing entry the header shows a bare spinner.
  it('times a single call from dispatch to settle', async () => {
    const during = withToolTiming('a', async () => {
      expect(store().timings['a']?.startedAt).toBeDefined()
      expect(store().timings['a']?.endedAt).toBeUndefined()
      return 'result'
    })
    await expect(during).resolves.toBe('result')
    expect(store().timings['a']?.endedAt).toBeDefined()
  })

  it('settles the call even when it throws', async () => {
    await expect(
      withToolTiming('a', async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    // Otherwise it holds the running slot forever, and every later call reads
    // as queued behind a call that is already gone.
    expect(store().timings['a']?.endedAt).toBeDefined()
  })
})
