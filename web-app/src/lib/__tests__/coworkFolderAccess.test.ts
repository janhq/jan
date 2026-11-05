import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensure: vi.fn(),
  setCaps: vi.fn(),
  fetchThreads: vi.fn(),
}))
vi.mock('@/lib/coworkSync', () => ({ ensureCoworkRecorded: mocks.ensure }))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ threads: () => ({ setConversationCapabilities: mocks.setCaps, fetchThreads: mocks.fetchThreads }) }),
}))

import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { useChatPermissions } from '@/hooks/useChatPermissions'
import { sessionFromThread } from '../coworkPersistence'
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
/**
 * Models what the host's `list_threads` returns for a Cowork record (see
 * `read_cowork_listing` / `apply_listed_*`): the effective grant when the
 * in-process mirror still allows it, else the all-off record plus a denied
 * annotation carrying the stored path; `null` stored = true detach.
 */
const off = { version: 1, folderScope: null, shellNetwork: false, memoryWrite: false }
const listing = (
  stored: { path: string; access: 'read' | 'write' } | null,
  confirmed: boolean
) => ({
  id: 's',
  metadata: {
    mode: 'cowork',
    conversationCapabilities: confirmed
      ? { ...off, folderScope: stored }
      : off,
    ...(stored && !confirmed
      ? { conversationCapabilitiesDenied: { denied: true, path: stored.path } }
      : {}),
  },
})
const hostLists = (...threads: unknown[]) => mocks.fetchThreads.mockResolvedValue(threads)
const current = () => useCoworkSessions.getState().sessions[0]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.ensure.mockResolvedValue(undefined)
  mocks.setCaps.mockResolvedValue(undefined)
  mocks.fetchThreads.mockReset()
  mocks.fetchThreads.mockRejectedValue(new Error('listing unavailable'))
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
    hostLists(listing({ path: '/proj', access: 'write' }, true))
    await expect(setCoworkFolderGrant('s', { path: '/proj', access: 'read' })).rejects.toThrow('host down')
    expect(current()).toMatchObject({ folder: '/proj', folderAccess: null })
    expect(liveCoworkFolderGrant('s')).toEqual({ folder: null, access: null })
  })

  it('a rejected first attach with no stored record shows no folder', async () => {
    mocks.setCaps.mockRejectedValueOnce(new Error('host down'))
    hostLists({ id: 's', metadata: { mode: 'cowork' } })
    await expect(setCoworkFolderGrant('s', { path: '/proj', access: 'write' })).rejects.toThrow()
    expect(current().folder).toBeNull()
    expect(liveCoworkFolderGrant('s')).toEqual({ folder: null, access: null })
  })

  it('a failed switch A -> B whose confirmation failed shows the stored B inactive', async () => {
    seed({ folder: '/A', folderAccess: 'write' })
    mocks.setCaps.mockRejectedValueOnce(new Error('confirmation failed'))
    // Host stored B but denies it (failed confirm): all-off + denied annotation.
    hostLists(listing({ path: '/B', access: 'write' }, false))
    await expect(setCoworkFolderGrant('s', { path: '/B', access: 'write' })).rejects.toThrow('confirmation failed')
    expect(current()).toMatchObject({ folder: '/B', folderAccess: null })
    expect(liveCoworkFolderGrant('s')).toEqual({ folder: null, access: null })
    const reloaded = sessionFromThread(listing({ path: '/B', access: 'write' }, false), null)
    expect(reloaded).toMatchObject({ folder: current().folder, folderAccess: current().folderAccess })
  })

  it('a failed switch A -> B that never reached the host keeps A inactive, not B', async () => {
    seed({ folder: '/A', folderAccess: 'write' })
    mocks.setCaps.mockRejectedValueOnce(new Error('Invalid version 1 conversation capabilities'))
    // The setter rejected before storing: the host still holds A (still confirmed here).
    hostLists(listing({ path: '/A', access: 'write' }, true))
    await expect(setCoworkFolderGrant('s', { path: '/B', access: 'write' })).rejects.toThrow()
    expect(current()).toMatchObject({ folder: '/A', folderAccess: null })
    expect(liveCoworkFolderGrant('s')).toEqual({ folder: null, access: null })
  })

  it('a host-validation rejection (Windows drive path on Unix) keeps A inactive', async () => {
    seed({ folder: '/A', folderAccess: 'read' })
    mocks.setCaps.mockRejectedValueOnce(new Error('Folder path must be absolute'))
    hostLists(listing({ path: '/A', access: 'read' }, true))
    await expect(setCoworkFolderGrant('s', { path: 'C:\\proj', access: 'write' })).rejects.toThrow('absolute')
    expect(mocks.setCaps).toHaveBeenCalledOnce()
    expect(current()).toMatchObject({ folder: '/A', folderAccess: null })
  })

  it('a failed thread record keeps A inactive and skips the setter', async () => {
    seed({ folder: '/A', folderAccess: 'write' })
    mocks.ensure.mockRejectedValueOnce(new Error('no record'))
    hostLists(listing({ path: '/A', access: 'write' }, true))
    await expect(setCoworkFolderGrant('s', { path: '/B', access: 'write' })).rejects.toThrow('no record')
    expect(mocks.setCaps).not.toHaveBeenCalled()
    expect(current()).toMatchObject({ folder: '/A', folderAccess: null })
  })

  it('an unreadable listing keeps the current folder inactive', async () => {
    seed({ folder: '/A', folderAccess: 'write' })
    mocks.setCaps.mockRejectedValueOnce(new Error('host down'))
    await expect(setCoworkFolderGrant('s', { path: '/B', access: 'write' })).rejects.toThrow('host down')
    expect(mocks.fetchThreads).toHaveBeenCalled()
    expect(current()).toMatchObject({ folder: '/A', folderAccess: null })
  })

  it.each([
    ['a missing thread', [] as unknown[]],
    ['a host read error', [{ id: 's', metadata: { mode: 'cowork', conversationCapabilities: off, conversationCapabilitiesError: 'io' } }]],
    ['a malformed record', [{ id: 's', metadata: { mode: 'cowork', conversationCapabilities: { version: 9 } } }]],
    ['a malformed denied annotation', [{ id: 's', metadata: { mode: 'cowork', conversationCapabilities: off, conversationCapabilitiesDenied: { denied: true, path: 'rel' } } }]],
  ])('%s in the listing falls back to the current folder, inactive', async (_name, threads) => {
    seed({ folder: '/A', folderAccess: 'write' })
    mocks.setCaps.mockRejectedValueOnce(new Error('host down'))
    hostLists(...threads)
    await expect(setCoworkFolderGrant('s', { path: '/B', access: 'write' })).rejects.toThrow()
    expect(current()).toMatchObject({ folder: '/A', folderAccess: null })
  })

  it('a failed detach keeps the current folder inactive, not detached', async () => {
    seed({ folder: '/A', folderAccess: 'write' })
    mocks.setCaps.mockRejectedValueOnce(new Error('host down'))
    hostLists(listing({ path: '/A', access: 'write' }, true))
    await expect(setCoworkFolderGrant('s', null)).rejects.toThrow('host down')
    expect(current()).toMatchObject({ folder: '/A', folderAccess: null })
  })

  it('a failed detach the host did store shows detached', async () => {
    seed({ folder: '/A', folderAccess: 'write' })
    mocks.setCaps.mockRejectedValueOnce(new Error('confirmation failed'))
    hostLists({ id: 's', metadata: { mode: 'cowork', conversationCapabilities: off } })
    await expect(setCoworkFolderGrant('s', null)).rejects.toThrow()
    expect(current().folder).toBeNull()
    expect(liveCoworkFolderGrant('s')).toEqual({ folder: null, access: null })
  })

  it('a failed detach with no folder stays detached', async () => {
    mocks.setCaps.mockRejectedValueOnce(new Error('host down'))
    await expect(setCoworkFolderGrant('s', null)).rejects.toThrow()
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
    // The failed request's host re-read finishes before the next request starts.
    expect(mocks.fetchThreads.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.setCaps.mock.invocationCallOrder[0])
    expect(mocks.fetchThreads.mock.invocationCallOrder[0]).toBeLessThan(mocks.setCaps.mock.invocationCallOrder[1])
    expect(current()).toMatchObject({ folder: '/proj', folderAccess: 'write' })
  })
})
