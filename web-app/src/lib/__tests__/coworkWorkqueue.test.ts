import { beforeEach, describe, expect, it, vi } from 'vitest'

const postWork = vi.fn()
const claimWork = vi.fn()
const completeWork = vi.fn()
const listWork = vi.fn()
const readAgent = vi.fn()

vi.mock('@/lib/agentTools', () => ({
  postWork: (...args: unknown[]) => postWork(...args),
  claimWork: (...args: unknown[]) => claimWork(...args),
  completeWork: (...args: unknown[]) => completeWork(...args),
  listWork: (...args: unknown[]) => listWork(...args),
  readAgent: (...args: unknown[]) => readAgent(...args),
}))

import {
  COMPLETE_WORK_TOOL,
  CLAIM_WORK_TOOL,
  LIST_WORK_TOOL,
  POST_WORK_TOOL,
  READ_AGENT_TOOL,
  runWorkOp,
  workqueueTools,
} from '@/lib/coworkWorkqueue'
import type { WorkItemView } from '@/lib/agentTools'

const snapshot = (items: WorkItemView[]) => ({ message: 'ok', items })

describe('coworkWorkqueue', () => {
  beforeEach(() => {
    postWork.mockReset()
    claimWork.mockReset()
    completeWork.mockReset()
    listWork.mockReset()
    readAgent.mockReset()
  })

  it('withholds the mutating tools in plan mode, keeps the read-only pair', () => {
    const normal = workqueueTools(false)
    expect(Object.keys(normal).sort()).toEqual(
      [
        POST_WORK_TOOL,
        CLAIM_WORK_TOOL,
        COMPLETE_WORK_TOOL,
        LIST_WORK_TOOL,
        READ_AGENT_TOOL,
      ].sort()
    )
    const plan = workqueueTools(true)
    expect(plan[POST_WORK_TOOL]).toBeUndefined()
    expect(plan[CLAIM_WORK_TOOL]).toBeUndefined()
    expect(plan[COMPLETE_WORK_TOOL]).toBeUndefined()
    expect(plan[LIST_WORK_TOOL]).toBeDefined()
    expect(plan[READ_AGENT_TOOL]).toBeDefined()
  })

  it('posts as the given agent and applies the returned snapshot', async () => {
    const items: WorkItemView[] = [
      { workId: 'w-1', title: 'do it', state: 'open' },
    ]
    postWork.mockResolvedValue(snapshot(items))
    const applied: WorkItemView[][] = []
    const out = await runWorkOp(
      POST_WORK_TOOL,
      { task: 'do it' },
      { sessionId: 's', agentId: 'main', onWorkQueue: (i) => applied.push(i) }
    )
    expect(postWork).toHaveBeenCalledWith('s', 'main', { task: 'do it' })
    expect(out.output).toBe('ok')
    expect(out.isError).toBe(false)
    expect(applied).toEqual([items])
  })

  it('claims and completes under the caller agent id', async () => {
    claimWork.mockResolvedValue(snapshot([]))
    await runWorkOp(CLAIM_WORK_TOOL, {}, { sessionId: 's', agentId: 'sub-a-1' })
    expect(claimWork).toHaveBeenCalledWith('s', 'sub-a-1')
    completeWork.mockResolvedValue(snapshot([]))
    await runWorkOp(
      COMPLETE_WORK_TOOL,
      { work_id: 'w-1', result: 'done' },
      { sessionId: 's', agentId: 'sub-a-1' }
    )
    expect(completeWork).toHaveBeenCalledWith('s', 'sub-a-1', {
      work_id: 'w-1',
      result: 'done',
    })
  })

  it('routes read_agent to the roster/status read', async () => {
    readAgent.mockResolvedValue('reviewer (sub-a-1) [running]')
    const out = await runWorkOp(
      READ_AGENT_TOOL,
      { run_id: 'sub-a-1' },
      { sessionId: 's', agentId: 'main' }
    )
    expect(readAgent).toHaveBeenCalledWith('s', { run_id: 'sub-a-1' })
    expect(out.output).toContain('running')
  })

  it('reports a failed command as an error result without a snapshot update', async () => {
    listWork.mockResolvedValue(null)
    const applied: WorkItemView[][] = []
    const out = await runWorkOp(LIST_WORK_TOOL, {}, {
      sessionId: 's',
      agentId: 'main',
      onWorkQueue: (i) => applied.push(i),
    })
    expect(out.isError).toBe(true)
    expect(applied).toEqual([])
  })
})
