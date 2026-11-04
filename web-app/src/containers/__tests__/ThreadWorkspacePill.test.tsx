import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  state: {
    threads: { t1: { id: 't1', metadata: {} } } as Record<string, any>,
    caps: { version: 1, folderScope: null, shellNetwork: false, memoryWrite: false } as any,
    setConversationCapabilities: vi.fn(async (_id: string, _caps: any) => undefined),
  },
  picked: '/work/proj' as string | null,
}))

vi.mock('@/hooks/useThreads', () => {
  const store: any = (sel: any) => sel({ threads: h.state.threads, getConversationCapabilities: () => h.state.caps })
  store.getState = () => ({ getConversationCapabilities: () => h.state.caps, setConversationCapabilities: h.state.setConversationCapabilities })
  return { useThreads: store }
})
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    dialog: () => ({ open: async () => h.picked }),
    opener: () => ({ openPath: vi.fn(), revealItemInDir: vi.fn() }),
  }),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn() } }))

import { HostRevokeUnconfirmedError } from '@/lib/conversationCapabilities'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ThreadAddFolderItem, ThreadWorkspacePill } from '../ThreadWorkspacePill'

beforeEach(() => {
  h.state.threads = { t1: { id: 't1', metadata: {} } }
  h.state.caps = { version: 1, folderScope: null, shellNetwork: false, memoryWrite: false }
  h.state.setConversationCapabilities.mockReset()
  h.picked = '/work/proj'
})
afterEach(cleanup)

describe('ThreadWorkspacePill', () => {
  it('is quiet until a folder is attached', () => {
    const { container } = render(<ThreadWorkspacePill threadId="t1" />)
    expect(container).toBeEmptyDOMElement()
  })

  const saved = { path: '/work/saved', access: 'write' as const }
  const persistFolder = () => {
    h.state.threads.t1.metadata = {
      conversationCapabilities: { ...h.state.caps, folderScope: saved },
    }
  }

  it('does not show an inactive confirmation UI for denied saved metadata', () => {
    persistFolder()
    render(<ThreadWorkspacePill threadId="t1" />)
    expect(screen.queryByText('common:conversationScope.folderNeedsConfirmation')).toBeNull()
    expect(screen.queryByRole('button', { name: 'common:conversationScope.confirmFolder' })).toBeNull()
    expect(h.state.setConversationCapabilities).not.toHaveBeenCalled()
  })

  it('keeps retry actions and honest uncertainty after a failed detach', async () => {
    h.state.caps = { ...h.state.caps, folderScope: saved }
    h.state.setConversationCapabilities.mockImplementation(async () => {
      h.state.caps = { ...h.state.caps, folderScope: null }
      throw new HostRevokeUnconfirmedError('t1', true)
    })
    render(<ThreadWorkspacePill threadId="t1" />)
    fireEvent.click(screen.getByRole('button', { name: 'common:workspace.a11yWithFolder' }))
    fireEvent.click(await screen.findByText('common:workspace.detach'))
    expect(await screen.findByRole('alert')).toHaveTextContent('common:conversationScope.hostRevokeUnconfirmed')
    fireEvent.click(screen.getByRole('button', { name: 'common:conversationScope.removeFolder' }))
    await waitFor(() => expect(h.state.setConversationCapabilities).toHaveBeenCalledTimes(2))
  })

  it('retries the exact failed detach instead of regranting the saved write folder', async () => {
    h.state.caps = { ...h.state.caps, folderScope: saved }
    persistFolder()
    h.state.setConversationCapabilities.mockImplementationOnce(async () => {
      h.state.caps = { ...h.state.caps, folderScope: null }
      h.state.threads.t1.metadata = { conversationCapabilities: h.state.caps }
      throw new Error('save failed')
    })
    render(<ThreadWorkspacePill threadId="t1" />)
    fireEvent.click(screen.getByRole('button', { name: 'common:workspace.a11yWithFolder' }))
    const popover = screen.getByRole('dialog')
    fireEvent.click(await screen.findByText('common:workspace.detach'))
    expect(await screen.findByRole('alert')).toHaveTextContent('common:conversationScope.saveFailed')
    expect(screen.getByRole('dialog')).toBe(popover)
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByText('common:workspace.writable')).toBeNull()
    expect(screen.queryByText('common:workspace.readOnly')).toBeNull()
    expect(screen.queryByText('common:conversationScope.folderNeedsConfirmation')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'common:run.tryAgain' }))
    await waitFor(() => expect(h.state.setConversationCapabilities).toHaveBeenCalledTimes(2))
    expect(h.state.setConversationCapabilities).toHaveBeenNthCalledWith(2, 't1',
      expect.objectContaining({ folderScope: null }))
  })

  it.each(['read', 'write'] as const)('keeps the popover mounted while saving %s access', async (nextAccess) => {
    const initialAccess = nextAccess === 'read' ? 'write' : 'read'
    h.state.caps = { ...h.state.caps, folderScope: { path: saved.path, access: initialAccess } }
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    h.state.setConversationCapabilities.mockImplementation(async (_id, caps) => {
      h.state.caps = { ...caps, folderScope: null }
      h.state.threads.t1.metadata = { conversationCapabilities: h.state.caps }
      await pending
      h.state.caps = caps
      h.state.threads.t1.metadata = { conversationCapabilities: caps }
    })
    render(<ThreadWorkspacePill threadId="t1" />)
    fireEvent.click(screen.getByRole('button', { name: initialAccess === 'write'
      ? 'common:workspace.a11yWithFolder' : 'common:workspace.a11yWithFolderReadOnly' }))
    const popover = screen.getByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: /common:workspace\.changeAccess/ }))
    expect(screen.getByRole('dialog')).toBe(popover)
    // The host has not acknowledged the new grant yet, so no access claim or toggle.
    expect(screen.queryByRole('button', { name: /common:workspace\.changeAccess/ })).toBeNull()
    expect(screen.queryByText('common:workspace.writable')).toBeNull()
    expect(screen.queryByText('common:workspace.readOnly')).toBeNull()
    expect(screen.queryByText('common:conversationScope.folderNeedsConfirmation')).toBeNull()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'saved' })).toBeInTheDocument()
    for (const action of ['change', 'detach']) {
      expect(screen.getByRole('button', { name: `common:workspace.${action}` })).toBeDisabled()
    }
    await act(async () => { finish(); await pending })
    expect(screen.getByRole('dialog')).toBe(popover)
    const settled = screen.getByRole('button', { name: /common:workspace\.changeAccess/ })
    expect(settled).toBeEnabled()
    expect(settled).toHaveTextContent(nextAccess === 'write' ? 'common:workspace.writable' : 'common:workspace.readOnly')
  })

  it('shows the folder and says read only when the grant is read', () => {
    h.state.caps = { ...h.state.caps, folderScope: { path: '/work/proj', access: 'read' } }
    render(<ThreadWorkspacePill threadId="t1" />)
    expect(screen.getByRole('button', { name: 'common:workspace.a11yWithFolderReadOnly' })).toBeInTheDocument()
    expect(screen.queryByLabelText('common:workspace.a11yWithFolder')).toBeNull()
  })

  it('claims read and write only when the grant is write', () => {
    h.state.caps = { ...h.state.caps, folderScope: { path: '/work/proj', access: 'write' } }
    render(<ThreadWorkspacePill threadId="t1" />)
    expect(screen.getByRole('button', { name: 'common:workspace.a11yWithFolder' })).toBeInTheDocument()
  })

  it('detach removes only the folder and keeps the other grants', async () => {
    h.state.caps = { version: 1, folderScope: { path: '/work/proj', access: 'write' }, shellNetwork: true, memoryWrite: false }
    render(<ThreadWorkspacePill threadId="t1" />)
    fireEvent.click(screen.getByRole('button', { name: 'common:workspace.a11yWithFolder' }))
    fireEvent.click(await screen.findByText('common:workspace.detach'))
    await waitFor(() => expect(h.state.setConversationCapabilities).toHaveBeenCalledWith('t1', expect.objectContaining({ folderScope: null, shellNetwork: true })))
  })

  it('changing the folder grants read and write by default', async () => {
    h.state.caps = { ...h.state.caps, folderScope: { path: '/work/proj', access: 'write' } }
    h.picked = '/work/other'
    render(<ThreadWorkspacePill threadId="t1" />)
    fireEvent.click(screen.getByRole('button', { name: 'common:workspace.a11yWithFolder' }))
    fireEvent.click(await screen.findByText('common:workspace.change'))
    await waitFor(() => expect(h.state.setConversationCapabilities).toHaveBeenCalledWith('t1', expect.objectContaining({ folderScope: { path: '/work/other', access: 'write' } })))
  })

  it('never renders for a temporary chat or a legacy Cowork thread', () => {
    h.state.caps = { ...h.state.caps, folderScope: { path: '/work/proj', access: 'read' } }
    h.state.threads = { 'temporary-chat': { id: 'temporary-chat', metadata: {} }, t1: { id: 't1', metadata: { mode: 'cowork' } } }
    const a = render(<ThreadWorkspacePill threadId="temporary-chat" />)
    expect(a.container).toBeEmptyDOMElement()
    cleanup()
    const b = render(<ThreadWorkspacePill threadId="t1" />)
    expect(b.container).toBeEmptyDOMElement()
  })
})

describe('ThreadAddFolderItem', () => {
  const open = (threadId: string) => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent><ThreadAddFolderItem threadId={threadId} /></DropdownMenuContent>
      </DropdownMenu>
    )
  }

  // With the shield gone, a conversation that already started needs this row to
  // get its first folder at all: the pill above the composer hides until one exists.
  it('attaches a picked folder read/write from the + menu', async () => {
    open('t1')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'common:homeMode.addFolderAction' }))
    await waitFor(() =>
      expect(h.state.setConversationCapabilities).toHaveBeenCalledWith('t1', {
        version: 1,
        folderScope: { path: '/work/proj', access: 'write' },
        shellNetwork: false,
        memoryWrite: false,
      })
    )
  })

  it('does nothing when the picker is cancelled', async () => {
    h.picked = null
    open('t1')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'common:homeMode.addFolderAction' }))
    await new Promise((r) => setTimeout(r, 30))
    expect(h.state.setConversationCapabilities).not.toHaveBeenCalled()
  })

  it('is absent for an unknown or temporary conversation', () => {
    open('missing')
    expect(screen.queryByRole('menuitem', { name: 'common:homeMode.addFolderAction' })).toBeNull()
  })
})
