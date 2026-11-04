import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensure: vi.fn(),
  setCaps: vi.fn(),
}))
vi.mock('@/lib/coworkSync', () => ({ ensureCoworkRecorded: mocks.ensure }))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ threads: () => ({ setConversationCapabilities: mocks.setCaps }) }),
}))

import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { useChatPermissions } from '@/hooks/useChatPermissions'
import {
  coworkFolderGrant,
  liveCoworkFolderGrant,
  setCoworkFolderGrant,
} from '../coworkFolderAccess'

const seed = (extra: Record<string, unknown> = {}) =>
  useCoworkSessions.setState({
    sessions: [{ id: 's', title: 'T', folder: null, turns: [], messages: [], updated: 0, ...extra }] as never,
    currentId: 's',
  })
const current = () => useCoworkSessions.getState().sessions[0]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.ensure.mockResolvedValue(undefined)
  mocks.setCaps.mockResolvedValue(undefined)
  useChatPermissions.setState({ shellNetwork: true, memoryWrite: true } as never)
  seed()
})

describe('coworkFolderGrant', () => {
  it('treats a legacy session with no host record as inactive, never write', () => {
    expect(coworkFolderGrant({ folder: '/p' })).toEqual({ folder: null, access: null })
    expect(coworkFolderGrant({ folder: '/p', folderAccess: 'write' })).toEqual({ folder: '/p', access: 'write' })
    expect(coworkFolderGrant({ folder: '/p', folderAccess: 'read' })).toEqual({ folder: '/p', access: 'read' })
  })

  it('hands tools no folder at all when the host denied it or none is attached', () => {
    expect(coworkFolderGrant({ folder: '/p', folderAccess: null })).toEqual({ folder: null, access: null })
    expect(coworkFolderGrant({ folder: null })).toEqual({ folder: null, access: null })
    expect(coworkFolderGrant(undefined)).toEqual({ folder: null, access: null })
  })

  it('reads the live session so a mid-run change is never stale', () => {
    seed({ folder: '/p', folderAccess: 'write' })
    expect(liveCoworkFolderGrant('s')).toEqual({ folder: '/p', access: 'write' })
    useCoworkSessions.getState().setFolderGrant('s', { path: '/p', access: 'read' })
    expect(liveCoworkFolderGrant('s')).toEqual({ folder: '/p', access: 'read' })
  })
})

describe('setCoworkFolderGrant persistence', () => {
  it('attaches: records the thread, saves through the strict setter, then updates the session', async () => {
    await setCoworkFolderGrant('s', { path: '/proj', access: 'write' })
    expect(mocks.ensure).toHaveBeenCalledWith('s')
    expect(mocks.setCaps).toHaveBeenCalledExactlyOnceWith('s', {
      version: 1,
      folderScope: { path: '/proj', access: 'write' },
      shellNetwork: true,
      memoryWrite: true,
    })
    expect(mocks.ensure.mock.invocationCallOrder[0]).toBeLessThan(mocks.setCaps.mock.invocationCallOrder[0])
    expect(current()).toMatchObject({ folder: '/proj', folderAccess: 'write' })
  })

  it('does not update the session until the host has accepted', async () => {
    let accept!: () => void
    mocks.setCaps.mockImplementationOnce(() => new Promise<void>((r) => { accept = r }))
    const pending = setCoworkFolderGrant('s', { path: '/proj', access: 'write' })
    await vi.waitFor(() => expect(mocks.setCaps).toHaveBeenCalled())
    expect(current().folder).toBeNull()
    accept()
    await pending
    expect(current().folder).toBe('/proj')
  })

  it('switches an attached folder to read-only', async () => {
    seed({ folder: '/proj', folderAccess: 'write' })
    await setCoworkFolderGrant('s', { path: '/proj', access: 'read' })
    expect(mocks.setCaps.mock.calls[0][1].folderScope).toEqual({ path: '/proj', access: 'read' })
    expect(current()).toMatchObject({ folder: '/proj', folderAccess: 'read' })
  })

  it('detaches: persists a null scope, then clears folder and access', async () => {
    seed({ folder: '/proj', folderAccess: 'write' })
    await setCoworkFolderGrant('s', null)
    expect(mocks.setCaps.mock.calls[0][1].folderScope).toBeNull()
    expect(current().folder).toBeNull()
    expect(current().folderAccess).toBeNull()
    expect(liveCoworkFolderGrant('s')).toEqual({ folder: null, access: null })
  })

  it('rejects an unsupported path before any host call', async () => {
    await expect(setCoworkFolderGrant('s', { path: 'relative/dir', access: 'write' })).rejects.toThrow()
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(mocks.setCaps).not.toHaveBeenCalled()
  })

  it('a rejected save keeps the folder visible but with no access, never the old grant', async () => {
    seed({ folder: '/proj', folderAccess: 'write' })
    mocks.setCaps.mockRejectedValueOnce(new Error('host down'))
    await expect(setCoworkFolderGrant('s', { path: '/proj', access: 'read' })).rejects.toThrow('host down')
    expect(current()).toMatchObject({ folder: '/proj', folderAccess: null })
    expect(liveCoworkFolderGrant('s')).toEqual({ folder: null, access: null })
  })

  it('a rejected first attach does not invent a folder', async () => {
    mocks.setCaps.mockRejectedValueOnce(new Error('host down'))
    await expect(setCoworkFolderGrant('s', { path: '/proj', access: 'write' })).rejects.toThrow()
    expect(current().folder).toBeNull()
  })

  it('a failed thread record also leaves no access and skips the setter', async () => {
    seed({ folder: '/proj', folderAccess: 'write' })
    mocks.ensure.mockRejectedValueOnce(new Error('no record'))
    await expect(setCoworkFolderGrant('s', { path: '/proj', access: 'read' })).rejects.toThrow('no record')
    expect(mocks.setCaps).not.toHaveBeenCalled()
    expect(current().folderAccess).toBeNull()
  })

  it('runs one session\'s requests in order and a failure does not block the next', async () => {
    seed({ folder: '/proj', folderAccess: 'write' })
    mocks.setCaps.mockRejectedValueOnce(new Error('boom'))
    const first = setCoworkFolderGrant('s', { path: '/proj', access: 'read' })
    const second = setCoworkFolderGrant('s', { path: '/proj', access: 'write' })
    await expect(first).rejects.toThrow('boom')
    await second
    expect(mocks.setCaps.mock.calls.map((c) => c[1].folderScope.access)).toEqual(['read', 'write'])
    expect(current()).toMatchObject({ folder: '/proj', folderAccess: 'write' })
  })
})
