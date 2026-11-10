import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const h = vi.hoisted(() => ({
  searchStr: '',
  picked: '/home/u/app' as unknown,
  tauri: true,
  cowork: true,
  model: { id: 'm', capabilities: ['tools'] } as unknown,
  navigate: vi.fn(),
  start: vi.fn(),
  info: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useLocation: ({ select }: { select: (l: { searchStr: string }) => string }) =>
    select({ searchStr: h.searchStr }),
  useRouter: () => ({ navigate: h.navigate }),
}))
vi.mock('sonner', () => ({ toast: { info: h.info, error: vi.fn() } }))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: (selector: (s: unknown) => unknown) =>
    selector({ selectedModel: h.model }),
}))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({ dialog: () => ({ open: async () => h.picked }) }),
}))
vi.mock('@/lib/coworkSync', () => ({ supportsCowork: () => h.tauri }))
vi.mock('@/lib/version', () => ({ isCoworkEnabled: () => h.cowork }))
vi.mock('@/lib/startCoworkFromDraft', () => ({
  startCoworkFromDraft: (...args: unknown[]) => h.start(...args),
}))

import { useFolderDraft } from '../useFolderDraft'

const submission = { text: 'hi', draft: 'hi' }

describe('useFolderDraft', () => {
  beforeEach(() => {
    h.searchStr = ''
    h.picked = '/home/u/app'
    h.tauri = true
    h.cowork = true
    h.model = { id: 'm', capabilities: ['tools'] }
    h.start.mockReset().mockReturnValue('started')
    h.info.mockReset()
  })

  it('is an ordinary chat while no folder is attached', () => {
    const { result } = renderHook(() => useFolderDraft())
    expect(result.current.onFolderDraft(submission)).toBe('chat')
    expect(h.start).not.toHaveBeenCalled()
  })

  it('starts a cowork conversation with the attached folder, then forgets it', async () => {
    const { result } = renderHook(() => useFolderDraft())
    await act(async () => result.current.attach())
    expect(result.current.folder).toBe('/home/u/app')
    let outcome = ''
    act(() => {
      outcome = result.current.onFolderDraft(submission)
    })
    expect(outcome).toBe('started')
    expect(h.start).toHaveBeenCalledWith(
      expect.objectContaining({ folder: '/home/u/app', submission })
    )
    expect(result.current.folder).toBeNull()
  })

  it('keeps the folder when the run was refused', async () => {
    h.start.mockReturnValue('refused')
    const { result } = renderHook(() => useFolderDraft())
    await act(async () => result.current.attach())
    act(() => {
      result.current.onFolderDraft(submission)
    })
    expect(result.current.folder).toBe('/home/u/app')
  })

  it('does not offer a folder to a model without tools', async () => {
    h.model = { id: 'plain', capabilities: [] }
    const { result } = renderHook(() => useFolderDraft())
    await act(async () => result.current.attach())
    expect(result.current.folder).toBeNull()
    expect(h.info).toHaveBeenCalledWith('common:conversationScope.folderUnsupported')
  })

  it('asks for a model before offering a folder', async () => {
    h.model = undefined
    const { result } = renderHook(() => useFolderDraft())
    await act(async () => result.current.attach())
    expect(result.current.folder).toBeNull()
    expect(h.info).toHaveBeenCalledWith('common:conversationScope.folderSelectModel')
  })

  it('ignores a cancelled folder dialog', async () => {
    h.picked = null
    const { result } = renderHook(() => useFolderDraft())
    await act(async () => result.current.attach())
    expect(result.current.folder).toBeNull()
  })

  it('keeps no workspace in a temporary chat', async () => {
    h.searchStr = '?temporary-chat=true'
    const { result } = renderHook(() => useFolderDraft())
    await act(async () => result.current.attach())
    expect(result.current.folder).toBeNull()
    expect(result.current.onFolderDraft(submission)).toBe('chat')
    expect(h.info).toHaveBeenCalledWith('common:conversationScope.temporary')
  })

  it('is unavailable outside the desktop host', () => {
    h.tauri = false
    const { result } = renderHook(() => useFolderDraft())
    expect(result.current.available).toBe(false)
    expect(result.current.onFolderDraft(submission)).toBe('chat')
  })

  it('is unavailable on builds that do not ship Cowork, even with a folder picked', async () => {
    h.cowork = false
    const { result } = renderHook(() => useFolderDraft())
    expect(result.current.available).toBe(false)
    await act(async () => result.current.attach())
    expect(result.current.folder).toBeNull()
    expect(result.current.onFolderDraft(submission)).toBe('chat')
    expect(h.start).not.toHaveBeenCalled()
  })
})
