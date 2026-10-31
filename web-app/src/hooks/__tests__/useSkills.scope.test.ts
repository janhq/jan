import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSkills } from '../useSkills'

const store = vi.hoisted(() => ({
  listSkills: vi.fn(), readSkill: vi.fn(), writeSkill: vi.fn(), deleteSkill: vi.fn(),
}))
vi.mock('@/lib/skillStore', () => ({
  ...store,
  storeScope: { kind: 'store' },
  projectScope: (folder: string) => ({ kind: 'project', folder }),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  store.listSkills.mockImplementation(async (scope: { kind: string }) =>
    (scope.kind === 'store' ? ['shared', 'global-only'] : ['shared']).map((name) => ({ name })))
})
it('keeps edit/read/delete origin-directed, but creates in the explicitly selected destination', async () => {
  const { result } = renderHook(() => useSkills('/folder'))
  await waitFor(() => expect(result.current.skills).toHaveLength(2))
  expect(result.current.skills.find((s) => s.name === 'shared')?.origin).toBe('project')
  await act(async () => {
    await result.current.read('shared')
    await result.current.write('global-only', 'edit')
    await result.current.remove('shared')
    await result.current.write('global-only', 'new folder copy', true)
  })
  expect(store.readSkill).toHaveBeenCalledWith({ kind: 'project', folder: '/folder' }, 'shared')
  expect(store.writeSkill).toHaveBeenCalledWith({ kind: 'store' }, 'global-only', 'edit')
  expect(store.deleteSkill).toHaveBeenCalledWith({ kind: 'project', folder: '/folder' }, 'shared')
  expect(store.writeSkill).toHaveBeenCalledWith({ kind: 'project', folder: '/folder' }, 'global-only', 'new folder copy')
})
it('Global reveals and modifies the global copy even when a folder shadows its name', async () => {
  const { result } = renderHook(() => useSkills(null))
  await waitFor(() => expect(result.current.skills).toHaveLength(2))
  expect(result.current.skills.every((s) => s.origin === 'store')).toBe(true)
  await act(async () => {
    await result.current.read('shared')
    await result.current.write('shared', 'global edit')
    await result.current.remove('shared')
  })
  expect(store.readSkill).toHaveBeenCalledWith({ kind: 'store' }, 'shared')
  expect(store.writeSkill).toHaveBeenCalledWith({ kind: 'store' }, 'shared', 'global edit')
  expect(store.deleteSkill).toHaveBeenCalledWith({ kind: 'store' }, 'shared')
})
