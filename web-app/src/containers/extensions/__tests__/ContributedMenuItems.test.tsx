import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ExtensionHost } from '@/lib/extensions/host'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ContributedMenuItems,
  ContributedOverflowMenu,
} from '../ContributedMenuItems'
import { createTestHost } from './harness'

const hostRef = vi.hoisted(() => ({ current: undefined as unknown }))
const toastError = vi.hoisted(() => vi.fn())

vi.mock('@/lib/extensions/host', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/extensions/host')>()),
  getExtensionHost: () => hostRef.current,
}))
vi.mock('@/i18n/react-i18next-compat', async () => {
  const i18n = (await import('@/i18n/setup')).default
  return { useTranslation: () => ({ t: i18n.t, i18n }) }
})
vi.mock('sonner', () => ({ toast: { error: toastError } }))

let host: ExtensionHost
let activate: ReturnType<typeof createTestHost>['activate']

beforeEach(() => {
  const test = createTestHost()
  host = test.host
  activate = test.activate
  hostRef.current = host
  toastError.mockReset()
})

afterEach(async () => {
  await act(() => host.deactivateAll())
})

const messageMenus = {
  commands: [
    { id: 'explain', title: 'Explain' },
    { id: 'quote', title: 'Quote' },
    { id: 'pin', title: 'Pin' },
  ],
  menus: {
    'message/actions': [
      { command: 'explain', when: 'message.role == assistant' as const },
      { command: 'quote', when: 'message.role == user' as const },
      { command: 'pin' },
    ],
  },
}

function OpenMenu({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenu open>
      <DropdownMenuTrigger>menu</DropdownMenuTrigger>
      <DropdownMenuContent>{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}

describe('ContributedMenuItems', () => {
  it('shows registered items labelled with the extension and hides them after dispose', async () => {
    await act(() =>
      activate('acme.threads', 'Acme Threads', {
        commands: [{ id: 'summarize', title: 'Summarize' }],
        menus: { 'thread/context': [{ command: 'summarize' }] },
      })
    )
    render(
      <OpenMenu>
        <ContributedMenuItems
          location="thread/context"
          context={{ location: 'thread/context', threadId: 't1' }}
        />
      </OpenMenu>
    )
    const item = screen.getByRole('menuitem', { name: /Summarize/ })
    expect(item).toHaveTextContent('Acme Threads')

    await act(() => host.deactivateAll())
    expect(screen.queryByRole('menuitem', { name: /Summarize/ })).toBeNull()
  })

  it('runs the command with the thread context', async () => {
    const handler = vi.fn()
    await act(() =>
      activate(
        'acme.threads',
        'Acme Threads',
        {
          commands: [{ id: 'summarize', title: 'Summarize' }],
          menus: { 'chatInput/actions': [{ command: 'summarize' }] },
        },
        { summarize: handler }
      )
    )
    render(
      <OpenMenu>
        <ContributedMenuItems
          location="chatInput/actions"
          context={{ location: 'chatInput/actions', threadId: 't9' }}
        />
      </OpenMenu>
    )
    await userEvent.click(screen.getByRole('menuitem', { name: /Summarize/ }))
    await waitFor(() =>
      expect(handler).toHaveBeenCalledWith({
        location: 'chatInput/actions',
        threadId: 't9',
      })
    )
  })

  it.each([
    ['assistant', ['Explain', 'Pin']],
    ['user', ['Pin', 'Quote']],
  ] as const)(
    'filters %s message actions by their when clause',
    async (role, expected) => {
      await act(() => activate('acme.msg', 'Acme', messageMenus))
      render(
        <OpenMenu>
          <ContributedMenuItems
            location="message/actions"
            context={{
              location: 'message/actions',
              threadId: 't1',
              messageId: 'm1',
              role,
            }}
          />
        </OpenMenu>
      )
      const titles = screen
        .getAllByRole('menuitem')
        .map((el) => el.firstChild?.textContent)
      expect(titles).toEqual(expected)
    }
  )

  it('hides thread.hasMessages items on a thread without messages', async () => {
    await act(() =>
      activate('acme.threads', 'Acme', {
        commands: [{ id: 'export', title: 'Export' }],
        menus: {
          'thread/context': [{ command: 'export', when: 'thread.hasMessages' }],
        },
      })
    )
    render(
      <OpenMenu>
        <ContributedMenuItems
          location="thread/context"
          context={{ location: 'thread/context', threadId: 'empty' }}
        />
      </OpenMenu>
    )
    expect(screen.queryByRole('menuitem', { name: /Export/ })).toBeNull()
  })

  it('shows a toast when the command fails', async () => {
    await act(() =>
      activate(
        'acme.threads',
        'Acme Threads',
        {
          commands: [{ id: 'boom', title: 'Boom' }],
          menus: { 'thread/context': [{ command: 'boom' }] },
        },
        {
          boom: () => {
            throw new Error('kaput')
          },
        }
      )
    )
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <OpenMenu>
        <ContributedMenuItems
          location="thread/context"
          context={{ location: 'thread/context', threadId: 't1' }}
        />
      </OpenMenu>
    )
    await userEvent.click(screen.getByRole('menuitem', { name: /Boom/ }))
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Boom (Acme Threads) failed', {
        description: 'kaput',
      })
    )
  })
})

describe('ContributedOverflowMenu', () => {
  it('renders nothing without contributions', () => {
    const { container } = render(
      <ContributedOverflowMenu
        location="message/actions"
        context={{
          location: 'message/actions',
          threadId: 't1',
          messageId: 'm1',
          role: 'user',
        }}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('opens the contributed message actions and runs one with ids only', async () => {
    const handler = vi.fn()
    await act(() =>
      activate('acme.msg', 'Acme', messageMenus, { explain: handler })
    )
    render(
      <ContributedOverflowMenu
        location="message/actions"
        context={{
          location: 'message/actions',
          threadId: 't1',
          messageId: 'm1',
          role: 'assistant',
        }}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    await userEvent.click(
      await screen.findByRole('menuitem', { name: /Explain/ })
    )
    await waitFor(() =>
      expect(handler).toHaveBeenCalledWith({
        location: 'message/actions',
        threadId: 't1',
        messageId: 'm1',
        role: 'assistant',
      })
    )
  })
})
