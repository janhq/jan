import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const h = vi.hoisted(() => ({
  searchStr: '',
  picked: '/home/u/app' as unknown,
  tauri: true,
  cowork: true,
  model: { id: 'm', capabilities: ['tools'] } as unknown,
  info: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useLocation: ({ select }: { select: (l: { searchStr: string }) => string }) =>
    select({ searchStr: h.searchStr }),
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

import { useFolderDraft } from '../useFolderDraft'

describe('useFolderDraft', () => {
  beforeEach(() => {
    h.searchStr = ''
    h.picked = '/home/u/app'
    h.tauri = true
    h.cowork = true
    h.model = { id: 'm', capabilities: ['tools'] }
    h.info.mockReset()
  })

  it('holds the folder the user picked until it is detached', async () => {
    const { result } = renderHook(() => useFolderDraft())
    await act(async () => result.current.attach())
    expect(result.current.folder).toBe('/home/u/app')
    act(() => result.current.detach())
    expect(result.current.folder).toBeNull()
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
    expect(h.info).toHaveBeenCalledWith('common:conversationScope.temporary')
  })

  it('is unavailable outside the desktop host', () => {
    h.tauri = false
    const { result } = renderHook(() => useFolderDraft())
    expect(result.current.available).toBe(false)
  })

  it('is unavailable on builds that do not ship Cowork, even with a folder picked', async () => {
    h.cowork = false
    const { result } = renderHook(() => useFolderDraft())
    expect(result.current.available).toBe(false)
    await act(async () => result.current.attach())
    expect(result.current.folder).toBeNull()
  })
})
