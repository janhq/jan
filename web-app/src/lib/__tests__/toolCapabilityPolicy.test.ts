import { describe, expect, it } from 'vitest'
import { PLAN_DENIED_TOOLS, resolveToolCapabilities } from '../toolCapabilityPolicy'
import { MONITOR_TOOL_NAME } from '../coworkMonitor'

// These are advertisement decisions, not schemas or permission grants.
const names = ['read', 'write', 'edit', 'shell', 'memory', 'skill_list', 'skill_read', 'skill_write', 'screenshot']

describe('bounded tool advertisement policy', () => {
  it('withholds the monitor identity in plan mode because it schedules shell scripts', () => {
    expect(PLAN_DENIED_TOOLS.has(MONITOR_TOOL_NAME)).toBe(true)
    const policy = resolveToolCapabilities({ surface: 'cowork', planMode: true, allowSubagents: true, webSearch: true })
    expect(policy.monitor).toBe(false)
    expect(policy.allowsNativeTool(MONITOR_TOOL_NAME)).toBe(false)
  })

  it.each([true, false])('Chat never widens its native subset (model tools=%s)', (modelSupportsTools) => {
    for (const shellEnabled of [true, false]) {
      for (const webSearch of [true, false]) {
        const policy = resolveToolCapabilities({ surface: 'chat', modelSupportsTools, shellEnabled, webSearch })
        expect(names.filter(policy.allowsNativeTool)).toEqual(modelSupportsTools && shellEnabled ? ['shell'] : [])
        expect(policy.loadNativeTools).toBe(modelSupportsTools && shellEnabled)
        expect(policy.webSearch).toBe(modelSupportsTools && webSearch)
        expect(policy.task).toBe(false)
        expect(policy.monitor).toBe(false)
      }
    }
  })

  it.each([true, false])('Cowork preserves plan/web/delegation distinctions (plan=%s)', (planMode) => {
    for (const allowSubagents of [true, false]) {
      for (const webSearch of [true, false]) {
        const policy = resolveToolCapabilities({ surface: 'cowork', planMode, allowSubagents, webSearch })
        expect(names.filter(policy.allowsNativeTool)).toEqual(planMode
          ? ['read', 'memory', 'skill_list', 'skill_read', 'screenshot'] : names)
        expect(policy.webSearch).toBe(webSearch)
        expect(policy.task).toBe(!planMode && allowSubagents)
        expect(policy.monitor).toBe(!planMode)
      }
    }
  })
})
