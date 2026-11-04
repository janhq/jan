import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useThreads', async () => {
  const { create } = await import('zustand')
  const { resolveConversationCapabilities } = await import('@/lib/conversationCapabilities')
  // Match the production getter: resolving the grant allocates a new folder
  // object on every read, even when no store update has occurred.
  const useThreads = create<any>((_set, get) => ({
    threads: { t1: { id: 't1', metadata: {} } },
    caps: { version: 1, folderScope: { path: '/work/saved', access: 'write' }, shellNetwork: false, memoryWrite: false },
    getConversationCapabilities: () => resolveConversationCapabilities(get().caps),
    setConversationCapabilities: vi.fn(),
  }))
  return { useThreads }
})
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    dialog: () => ({ open: vi.fn() }),
    opener: () => ({ openPath: vi.fn(), revealItemInDir: vi.fn() }),
  }),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))

import { useThreads } from '@/hooks/useThreads'
import { ThreadWorkspacePill } from '../ThreadWorkspacePill'

afterEach(cleanup)

describe('ThreadWorkspacePill Zustand subscription', () => {
  it('renders a fresh-object getter without looping and tracks access, path and revocation', () => {
    const first = useThreads.getState().getConversationCapabilities('t1').folderScope
    const second = useThreads.getState().getConversationCapabilities('t1').folderScope
    expect(first).toEqual(second)
    expect(first).not.toBe(second)

    const { rerender } = render(<ThreadWorkspacePill threadId="t1" />)
    expect(screen.getByRole('button', { name: 'common:workspace.a11yWithFolder' })).toBeInTheDocument()
    rerender(<ThreadWorkspacePill threadId="t1" />)

    const setFolder = (folderScope: typeof first) => act(() => {
      useThreads.setState({ caps: { version: 1, folderScope, shellNetwork: false, memoryWrite: false } } as any)
    })
    setFolder({ path: '/work/saved', access: 'read' })
    expect(screen.getByRole('button', { name: 'common:workspace.a11yWithFolderReadOnly' })).toBeInTheDocument()
    setFolder({ path: '/work/other', access: 'read' })
    expect(screen.getByText('other')).toBeInTheDocument()
    setFolder(null)
    expect(screen.queryByRole('button')).toBeNull()
    setFolder({ path: '/work/restored', access: 'write' })
    expect(screen.getByText('restored')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common:workspace.a11yWithFolder' })).toBeInTheDocument()
  })
})
