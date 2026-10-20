import { describe, it, expect, vi, beforeEach } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import {
  listSubagents,
  refreshSubagents,
  __testing,
} from '../coworkSubagentRegistry'

const def = (name: string) => ({
  name,
  description: `d-${name}`,
  system_prompt: `p-${name}`,
  allowed_tools: null,
  model: null,
})

describe('coworkSubagentRegistry', () => {
  beforeEach(() => {
    invoke.mockReset()
    __testing.reset()
  })

  // No `project` argument: a default Cowork session has no project root, which
  // is why the desktop reads a single directory instead of the CLI's merge.
  it('lists definitions with no project argument', async () => {
    invoke.mockResolvedValue([def('researcher')])
    await expect(listSubagents()).resolves.toEqual([def('researcher')])
    expect(invoke).toHaveBeenCalledWith('agent_subagent_list')
    expect(invoke.mock.calls[0]).toHaveLength(1)
  })

  it('caches so a run does not re-read the directory per step', async () => {
    invoke.mockResolvedValue([def('a')])
    await listSubagents()
    await listSubagents()
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('re-reads after a refresh', async () => {
    invoke.mockResolvedValue([def('a')])
    await listSubagents()
    refreshSubagents()
    invoke.mockResolvedValue([def('a'), def('b')])
    await expect(listSubagents()).resolves.toHaveLength(2)
  })

  // A missing directory or an older binary without the command must cost the
  // run its saved names, not the run: a one-off subagent still works.
  it('degrades to an empty list when the command fails', async () => {
    invoke.mockRejectedValue(new Error('command not found'))
    await expect(listSubagents()).resolves.toEqual([])
  })

  it('does not retry a failed load on every step', async () => {
    invoke.mockRejectedValue(new Error('nope'))
    await listSubagents()
    await listSubagents()
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})
