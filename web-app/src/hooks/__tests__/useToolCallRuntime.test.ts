import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  findRunningToolCallId,
  useToolCallRuntime,
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
})
