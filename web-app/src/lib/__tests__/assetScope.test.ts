import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/platform/utils', () => ({ isPlatformTauri: () => true }))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ core: () => ({ invoke }) }),
}))
vi.mock('@/lib/backendStorage', () => ({
  backendStorage: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}))

import { grantCoworkFolders, grantFolders } from '@/lib/assetScope'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'

const grantedFolders = () =>
  invoke.mock.calls
    .filter(([cmd]) => cmd === 'asset_scope_allow_folder')
    .map(([, args]) => (args as { folder: string }).folder)

describe('assetScope', () => {
  beforeEach(() => invoke.mockClear())

  it('grants each folder once and skips empty slots', () => {
    grantFolders(['/once', null, '/once'])
    grantFolders(['/once'])
    expect(grantedFolders()).toEqual(['/once'])
  })

  it('grants persisted folders and ones attached later', () => {
    const store = useCoworkSessions.getState()
    const a = store.createSession()
    store.setFolder(a, '/persisted')
    grantCoworkFolders()
    expect(grantedFolders()).toEqual(['/persisted'])

    useCoworkSessions.getState().setFolder(a, '/attached/later')
    expect(grantedFolders()).toEqual(['/persisted', '/attached/later'])
  })
})
