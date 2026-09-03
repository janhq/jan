import { describe, expect, it } from 'vitest'
import type { MonitorUpdate } from '@/lib/agentTools'
import {
  MONITOR_TOOL_NAME,
  MonitorLane,
  monitorSpecFromArgs,
  monitorTool,
  parseMonitorId,
  type MonitorInbox,
  type MonitorViewSink,
} from '@/lib/coworkMonitor'
import type { SubagentNotice } from '@/lib/coworkSubagent'
import type { MonitorView } from '@/types/coworkSession'

function fakeInbox() {
  const calls: string[] = []
  const notices: SubagentNotice[] = []
  const inbox: MonitorInbox = {
    begin: () => calls.push('begin'),
    finish: (n) => {
      calls.push('finish')
      notices.push(n)
    },
    note: (n) => {
      calls.push('note')
      notices.push(n)
    },
    abandon: () => calls.push('abandon'),
  }
  return { inbox, calls, notices }
}

const startResult = (id: string) =>
  `Monitor started (monitor_id=${id}) watching build.log with 2 conditions.`

const update = (over: Partial<MonitorUpdate>): MonitorUpdate => ({
  monitorId: 'mon-1',
  headline: 'Monitor mon-1: condition "x" matched',
  text: 'Monitor mon-1 condition x matched on build.log:\nhit',
  done: false,
  met: ['x'],
  unmet: ['y'],
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
  it('reads the file and condition names out of a start call', () => {
    expect(
      monitorSpecFromArgs({
        op: 'start',
        file: 'build.log',
        conditions: [{ name: 'ok', script: 'true' }, { script: 'nameless' }],
      })
    ).toEqual({ file: 'build.log', conditions: ['ok'] })
  })

  it('is empty for malformed arguments', () => {
    expect(monitorSpecFromArgs(null)).toEqual({ file: '', conditions: [] })
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
  it('claims a slot on start and releases it on the terminal update', () => {
    const { inbox, calls, notices } = fakeInbox()
    const lane = new MonitorLane(inbox)
    lane.started(startResult('mon-1'))
    lane.update(update({ done: false }))
    lane.update(update({ done: true }))
    expect(calls).toEqual(['begin', 'note', 'finish'])
    expect(notices[1].text).toContain('hit')
  })

  it('does not claim a slot for a failed start', () => {
    const { inbox, calls } = fakeInbox()
    new MonitorLane(inbox).started('ERROR: outside the project')
    expect(calls).toEqual([])
  })

  it('an explicit stop releases the slot without a ping', () => {
    const { inbox, calls } = fakeInbox()
    const lane = new MonitorLane(inbox)
    lane.started(startResult('mon-1'))
    lane.stopped('mon-1', 'Monitor mon-1 stopped. Conditions met: none; unmet: x.')
    expect(calls).toEqual(['begin', 'abandon'])
  })

  it('a stop that failed releases nothing', () => {
    const { inbox, calls } = fakeInbox()
    const lane = new MonitorLane(inbox)
    lane.started(startResult('mon-1'))
    lane.stopped('mon-1', "ERROR: unknown or already-stopped monitor 'mon-1'")
    expect(calls).toEqual(['begin'])
  })

  it('a terminal update racing an earlier stop cannot release the slot twice', () => {
    const { inbox, calls } = fakeInbox()
    const lane = new MonitorLane(inbox)
    lane.started(startResult('mon-1'))
    lane.stopped('mon-1', 'Monitor mon-1 stopped. Conditions met: none; unmet: x.')
    lane.update(update({ done: true }))
    // The late update is still shown as a note, but the shared running count
    // (which also guards live subagents) comes down exactly once.
    expect(calls).toEqual(['begin', 'abandon', 'note'])
  })
})

describe('MonitorLane view', () => {
  /// The rail has no other account of a watcher: it opens on the start (with
  /// what the call asked for), moves with every update, closes on a stop.
  it('mirrors start, update and stop into the view', () => {
    const { inbox } = fakeInbox()
    const { view, events, views } = fakeView()
    const lane = new MonitorLane(inbox, view)
    lane.started(startResult('mon-1'), { file: 'build.log', conditions: ['x', 'y'] })
    lane.update(update({}))
    lane.stopped('mon-1', 'Monitor mon-1 stopped. Conditions met: x; unmet: y.')
    expect(events).toEqual(['started', 'updated:mon-1', 'stopped:mon-1'])
    expect(views[0]).toMatchObject({
      monitorId: 'mon-1',
      file: 'build.log',
      met: [],
      unmet: ['x', 'y'],
      status: 'running',
    })
  })

  it('opens nothing for a failed start and closes nothing for a failed stop', () => {
    const { inbox } = fakeInbox()
    const { view, events } = fakeView()
    const lane = new MonitorLane(inbox, view)
    lane.started('ERROR: outside the project', { file: 'x', conditions: [] })
    lane.stopped('mon-1', "ERROR: unknown or already-stopped monitor 'mon-1'")
    expect(events).toEqual([])
  })
})

describe('monitorTool', () => {
  it('keeps the contract the Rust schema advertises', () => {
    expect(MONITOR_TOOL_NAME).toBe('monitor')
    const description = monitorTool().description ?? ''
    expect(description).toContain('<SYSTEM> note per match')
    expect(description).toContain('exit 0 means the condition matched')
  })
})
