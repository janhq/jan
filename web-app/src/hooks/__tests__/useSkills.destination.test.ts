import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  writes: [] as Array<{ scope: { kind: string; folder?: string }; name: string }>,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (command: string) =>
    command === 'agent_skill_enabled_get' ? [] : null,
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({}) }))
vi.mock('@/lib/skillStore', () => ({
  storeScope: { kind: 'store' },
  projectScope: (folder: string) => ({ kind: 'project', folder }),
  listSkills: async () => [],
  writeSkill: async (
    scope: { kind: string; folder?: string },
    name: string
  ) => {
    h.writes.push({ scope, name })
  },
}))

import { useSkills } from '../useSkills'

describe('useSkills destination for a new skill', () => {
  beforeEach(() => {
    h.writes = []
  })

  it('writes to the attached folder by default', async () => {
    const { result } = renderHook(() => useSkills('/project'))
    await act(async () => result.current.write('a', 'body'))
    expect(h.writes).toEqual([
      { scope: { kind: 'project', folder: '/project' }, name: 'a' },
    ])
  })

  it('writes to the global store when that destination is chosen', async () => {
    const { result } = renderHook(() => useSkills('/project', 'global'))
    await act(async () => result.current.write('a', 'body'))
    expect(h.writes).toEqual([{ scope: { kind: 'store' }, name: 'a' }])
  })

  it('writes to the global store when there is no folder', async () => {
    const { result } = renderHook(() => useSkills(null, 'folder'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => result.current.write('a', 'body'))
    expect(h.writes).toEqual([{ scope: { kind: 'store' }, name: 'a' }])
  })
})
