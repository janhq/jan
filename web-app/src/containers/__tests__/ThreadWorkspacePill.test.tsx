import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  state: {
    threads: { t1: { id: 't1', metadata: {} } } as Record<string, any>,
    caps: { version: 1, folderScope: null, shellNetwork: false, memoryWrite: false } as any,
    setConversationCapabilities: vi.fn(async () => undefined),
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

  it('shows a saved folder as inactive without restoring any grants', () => {
    persistFolder()
    render(<ThreadWorkspacePill threadId="t1" />)
    expect(screen.getByText('saved')).toBeInTheDocument()
    expect(screen.getByText('common:conversationScope.folderNeedsConfirmation')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common:conversationScope.confirmFolder' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'common:workspace.a11yWithFolder' })).toBeNull()
    expect(h.state.setConversationCapabilities).not.toHaveBeenCalled()
  })

  it('confirms only the saved folder through the strict setter, preserving effective global grants', async () => {
    persistFolder()
    h.state.caps.shellNetwork = true
    h.state.setConversationCapabilities.mockImplementationOnce(async (_id, next) => {
      h.state.caps = next
      h.state.threads.t1.metadata.conversationCapabilities = next
    })
    render(<ThreadWorkspacePill threadId="t1" />)
    fireEvent.click(screen.getByRole('button', { name: 'common:conversationScope.confirmFolder' }))
    await waitFor(() => expect(h.state.setConversationCapabilities).toHaveBeenCalledWith('t1', {
      version: 1, folderScope: saved, shellNetwork: true, memoryWrite: false,
    }))
    expect(await screen.findByRole('button', { name: 'common:workspace.a11yWithFolder' })).toBeInTheDocument()
    expect(screen.queryByText('common:conversationScope.folderNeedsConfirmation')).toBeNull()
  })

  it('keeps the inactive folder available for retry if confirmation fails after metadata was denied', async () => {
    persistFolder()
    h.state.setConversationCapabilities.mockImplementationOnce(async () => {
      h.state.threads.t1.metadata = {}
      throw new Error('save failed')
    })
    render(<ThreadWorkspacePill threadId="t1" />)
    fireEvent.click(screen.getByRole('button', { name: 'common:conversationScope.confirmFolder' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('common:conversationScope.saveFailed')
    expect(screen.getByText('saved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common:conversationScope.confirmFolder' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'common:workspace.a11yWithFolder' })).toBeNull()
  })

  it('removes a saved folder without confirming it', async () => {
    persistFolder()
    h.state.setConversationCapabilities.mockImplementationOnce(async () => {
      h.state.threads.t1.metadata = {}
    })
    const { container } = render(<ThreadWorkspacePill threadId="t1" />)
    fireEvent.click(screen.getByRole('button', { name: 'common:conversationScope.removeFolder' }))
    await waitFor(() => expect(h.state.setConversationCapabilities).toHaveBeenCalledWith('t1', expect.objectContaining({ folderScope: null })))
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('retains the host uncertainty warning and retry actions after an unacknowledged remove', async () => {
    persistFolder()
    h.state.setConversationCapabilities.mockImplementation(async () => {
      h.state.threads.t1.metadata = {}
      throw new HostRevokeUnconfirmedError('t1', true)
    })
    render(<ThreadWorkspacePill threadId="t1" />)
    for (let retry = 0; retry < 2; retry++) {
      fireEvent.click(screen.getByRole('button', { name: 'common:conversationScope.removeFolder' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('common:conversationScope.hostRevokeUnconfirmed')
      expect(screen.getByRole('button', { name: 'common:conversationScope.removeFolder' })).toBeEnabled()
    }
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

  it('changing the folder starts read-only, never inheriting write', async () => {
    h.state.caps = { ...h.state.caps, folderScope: { path: '/work/proj', access: 'write' } }
    h.picked = '/work/other'
    render(<ThreadWorkspacePill threadId="t1" />)
    fireEvent.click(screen.getByRole('button', { name: 'common:workspace.a11yWithFolder' }))
    fireEvent.click(await screen.findByText('common:workspace.change'))
    await waitFor(() => expect(h.state.setConversationCapabilities).toHaveBeenCalledWith('t1', expect.objectContaining({ folderScope: { path: '/work/other', access: 'read' } })))
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
  it('attaches a picked folder read-only from the + menu', async () => {
    open('t1')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'common:homeMode.addFolderAction' }))
    await waitFor(() =>
      expect(h.state.setConversationCapabilities).toHaveBeenCalledWith('t1', {
        version: 1,
        folderScope: { path: '/work/proj', access: 'read' },
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
