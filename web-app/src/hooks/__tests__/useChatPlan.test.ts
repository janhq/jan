import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ threads: {} as Record<string, any>, updateThread: vi.fn() }))
vi.mock('@/hooks/useThreads', () => ({ useThreads: { getState: () => h } }))
import { HOME_PLAN_KEY, useChatPlan, chatPlanEnabled, setChatPlan } from '../useChatPlan'

describe('conversation Plan mode ownership', () => {
  beforeEach(() => { h.threads = {}; h.updateThread.mockReset(); useChatPlan.setState({ drafts: {} }) })
  it('isolates home and thread drafts', () => {
    setChatPlan(HOME_PLAN_KEY, true)
    expect(chatPlanEnabled(HOME_PLAN_KEY)).toBe(true)
    expect(chatPlanEnabled('another-thread')).toBe(false)
    setChatPlan('another-thread', true)
    setChatPlan(HOME_PLAN_KEY, false)
    expect(chatPlanEnabled('another-thread')).toBe(true)
  })
  it('reads migrated metadata and persists changes without touching grants', () => {
    const grant = { folderScope: { path: '/project', access: 'read' } }
    h.threads.t = { metadata: { planMode: true, conversationCapabilities: grant, other: 'retained' } }
    expect(chatPlanEnabled('t')).toBe(true)
    setChatPlan('t', false)
    expect(h.updateThread).toHaveBeenCalledWith('t', { metadata: { planMode: false, conversationCapabilities: grant, other: 'retained' } })
  })
})
