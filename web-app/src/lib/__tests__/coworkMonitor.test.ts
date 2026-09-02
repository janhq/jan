import { describe, expect, it } from 'vitest'
import type { MonitorUpdate } from '@/lib/agentTools'
import {
  MONITOR_TOOL_NAME,
  MonitorLane,
  monitorTool,
  parseMonitorId,
  type MonitorInbox,
} from '@/lib/coworkMonitor'
import type { SubagentNotice } from '@/lib/coworkSubagent'

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
  ...over,
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

describe('monitorTool', () => {
  it('keeps the contract the Rust schema advertises', () => {
    expect(MONITOR_TOOL_NAME).toBe('monitor')
    const description = monitorTool().description ?? ''
    expect(description).toContain('<SYSTEM> note per match')
    expect(description).toContain('exit 0 means the condition matched')
  })
})
