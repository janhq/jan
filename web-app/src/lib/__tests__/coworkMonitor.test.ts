import { describe, expect, it } from 'vitest'
import type { MonitorUpdate } from '@/lib/agentTools'
import {
  MONITOR_TOOL_NAME,
  MonitorLane,
  dropMonitorLane,
  monitorLaneFor,
  monitorSpecFromArgs,
  monitorTool,
  parseMonitorId,
  type MonitorViewSink,
} from '@/lib/coworkMonitor'
import type { MonitorView } from '@/types/coworkSession'

const startResult = (id: string) =>
  `Monitor started (monitor_id=${id}): 'build' runs every 5s.`

const update = (over: Partial<MonitorUpdate>): MonitorUpdate => ({
  monitorId: 'mon-1',
  name: 'x',
  headline: "Monitor mon-1: 'x' matched",
  text: "Monitor 'mon-1' ('x') matched:\nhit\n\nIt has stopped.",
  matched: true,
  ...over,
})

function fakeView() {
  const events: string[] = []
  const views: MonitorView[] = []
  const view: MonitorViewSink = {
    started: (v) => {
      events.push('started')
      views.push(v)
    },
    updated: (u) => events.push(`updated:${u.monitorId}`),
    stopped: (id) => events.push(`stopped:${id}`),
  }
  return { view, events, views }
}

describe('monitorSpecFromArgs', () => {
  it('reads the name and script out of a start call', () => {
    expect(
      monitorSpecFromArgs({ op: 'start', name: ' build ', script: 'grep OK log' })
    ).toEqual({ name: 'build', script: 'grep OK log' })
  })

  it('labels an unnamed monitor by its script, like the Rust parser', () => {
    expect(monitorSpecFromArgs({ op: 'start', script: 'test -f done' })).toEqual({
      name: 'test -f done',
      script: 'test -f done',
    })
  })

  it('is empty for malformed arguments', () => {
    expect(monitorSpecFromArgs(null)).toEqual({ name: '', script: '' })
  })
})

describe('parseMonitorId', () => {
  it('extracts the id a start result names', () => {
    expect(parseMonitorId(startResult('mon-3'))).toBe('mon-3')
  })

  it('is null for an error result', () => {
    expect(parseMonitorId('ERROR: at most 8 monitors may be active')).toBeNull()
  })
})

describe('MonitorLane', () => {
  it('queues the update as a ping and closes the watcher, matched or not', () => {
    const lane = new MonitorLane()
    lane.started(startResult('mon-1'))
    lane.started(startResult('mon-2'))
    expect(lane.watching()).toBe(2)
    lane.update(update({ matched: true }))
    lane.update(update({ monitorId: 'mon-2', matched: false }))
    expect(lane.watching()).toBe(0)
    const notices = lane.take()
    expect(notices).toHaveLength(2)
    expect(notices[0].text).toContain('hit')
    expect(lane.hasQueued()).toBe(false)
  })

  it('a running watcher is not queued work: nothing parks on it', () => {
    const lane = new MonitorLane()
    lane.started(startResult('mon-1'))
    expect(lane.hasQueued()).toBe(false)
  })

  it('opens nothing for a failed start', () => {
    const lane = new MonitorLane()
    lane.started('ERROR: outside the project')
    expect(lane.watching()).toBe(0)
  })

  it('an explicit stop closes the watcher without a ping', () => {
    const lane = new MonitorLane()
    lane.started(startResult('mon-1'))
    lane.stopped('mon-1', "Monitor mon-1 ('x') stopped after 1 poll without a match.")
    expect(lane.watching()).toBe(0)
    expect(lane.hasQueued()).toBe(false)
  })

  it('a stop that failed closes nothing', () => {
    const lane = new MonitorLane()
    lane.started(startResult('mon-1'))
    lane.stopped('mon-1', "ERROR: unknown or already-stopped monitor 'mon-1'")
    expect(lane.watching()).toBe(1)
  })

  it('wait resolves on a ping, and onPing fires so an idle session can start a turn', async () => {
    const lane = new MonitorLane()
    let pings = 0
    lane.onPing = () => pings++
    const waited = lane.wait()
    lane.update(update({}))
    await waited
    expect(pings).toBe(1)
    expect(lane.hasQueued()).toBe(true)
  })

  it('wait resolves at once when a ping is already queued or the run is aborted', async () => {
    const lane = new MonitorLane()
    lane.update(update({}))
    await lane.wait()
    const aborted = new AbortController()
    aborted.abort()
    await new MonitorLane().wait(aborted.signal)
  })
})

describe('monitorLaneFor', () => {
  it('hands the same lane to every run of a session until it is dropped', () => {
    const lane = monitorLaneFor('sid-a')
    lane.started(startResult('mon-1'))
    expect(monitorLaneFor('sid-a')).toBe(lane)
    expect(monitorLaneFor('sid-a').watching()).toBe(1)
    expect(monitorLaneFor('sid-b')).not.toBe(lane)
    dropMonitorLane('sid-a')
    expect(monitorLaneFor('sid-a')).not.toBe(lane)
    dropMonitorLane('sid-a')
    dropMonitorLane('sid-b')
  })
})

describe('MonitorLane view', () => {
  /// The rail has no other account of a watcher: it opens on the start (with
  /// what the call asked for), moves with every update, closes on a stop.
  it('mirrors start, update and stop into the view', () => {
    const { view, events, views } = fakeView()
    const lane = new MonitorLane(view)
    lane.started(startResult('mon-1'), { name: 'x', script: 'grep x build.log' })
    lane.started(startResult('mon-2'), { name: 'y', script: 'grep y build.log' })
    lane.update(update({}))
    lane.stopped('mon-2', "Monitor mon-2 ('y') stopped after 3 polls without a match.")
    expect(events).toEqual(['started', 'started', 'updated:mon-1', 'stopped:mon-2'])
    expect(views[0]).toMatchObject({
      monitorId: 'mon-1',
      name: 'x',
      script: 'grep x build.log',
      status: 'running',
    })
  })

  it('opens nothing for a failed start and closes nothing for a failed stop', () => {
    const { view, events } = fakeView()
    const lane = new MonitorLane(view)
    lane.started('ERROR: at most 8 monitors may be active', { name: 'x', script: 'x' })
    lane.stopped('mon-1', "ERROR: unknown or already-stopped monitor 'mon-1'")
    expect(events).toEqual([])
  })
})

describe('monitorTool', () => {
  it('keeps the contract the Rust schema advertises', () => {
    expect(MONITOR_TOOL_NAME).toBe('monitor')
    const description = monitorTool().description ?? ''
    expect(description).toContain('<SYSTEM> note')
    expect(description).toContain('exits 0')
  })
})
