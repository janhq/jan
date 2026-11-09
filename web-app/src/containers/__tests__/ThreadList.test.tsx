import { describe, it, expect, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import ThreadList from '../ThreadList'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className, title, to, params }: any) => (
    <a
      className={className}
      title={title}
      data-to={to}
      data-param={params ? Object.values(params)[0] : undefined}
    >
      {children}
    </a>
  ),
  useParams: ({ select }: any = {}) =>
    select ? select({ threadId: undefined }) : { threadId: undefined },
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: (selector: any) =>
    selector({
      deleteThread: vi.fn(),
      renameThread: vi.fn(),
      updateThread: vi.fn(),
    }),
}))

vi.mock('@/hooks/useMessages', () => ({
  useMessages: (selector: any) =>
    selector({
      messages: {},
      getMessages: () => [],
      setMessages: vi.fn(),
    }),
}))

vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: () => ({
    folders: [],
    getFolderById: vi.fn(),
  }),
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarMenuItem: ({ children }: any) => <li>{children}</li>,
  SidebarMenuButton: ({ children }: any) => <div>{children}</div>,
  SidebarMenuAction: ({ children }: any) => <button>{children}</button>,
  useSidebar: () => ({ isMobile: false }),
}))

vi.mock('@/components/ui/dropdown-menu', () => {
  const Passthrough = ({ children }: any) => <>{children}</>
  return {
    DropdownMenu: Passthrough,
    DropdownMenuContent: Passthrough,
    DropdownMenuItem: Passthrough,
    DropdownMenuSeparator: () => null,
    DropdownMenuTrigger: Passthrough,
    DropdownMenuSub: Passthrough,
    DropdownMenuSubContent: Passthrough,
    DropdownMenuSubTrigger: Passthrough,
  }
})

vi.mock('@/containers/dialogs', () => ({
  RenameThreadDialog: () => null,
  DeleteThreadDialog: () => null,
}))

const longUrl = 'https://example.com/' + 'a'.repeat(300)

const makeThread = (overrides: Partial<Thread> = {}): Thread =>
  ({
    id: 't1',
    title: longUrl,
    updated: 0,
    metadata: {},
    ...overrides,
  }) as Thread

const flushEffects = () => act(() => Promise.resolve())

describe('ThreadList — long-URL overflow guard (#7959)', () => {
  it('truncates non-project thread titles and exposes full text via title attribute', async () => {
    render(<ThreadList threads={[makeThread()]} />)
    await flushEffects()

    const titleSpans = screen
      .getAllByText(longUrl)
      .filter((el) => el.tagName === 'SPAN')
    expect(titleSpans.length).toBeGreaterThan(0)

    const titleEl = titleSpans[0]
    expect(titleEl).toHaveClass('block', 'truncate')
    expect(titleEl).toHaveAttribute('title', longUrl)
  })

  it('opens a chat thread on /threads and a Cowork thread on /cowork', async () => {
    render(
      <ThreadList
        threads={[
          makeThread({ id: 'chat-1', title: 'A chat' }),
          makeThread({ id: 'cw-1', title: 'A task', metadata: { mode: 'cowork' } }),
        ]}
      />
    )
    await flushEffects()

    const chat = screen.getByText('A chat').closest('a')
    const task = screen.getByText('A task').closest('a')
    expect(chat).toHaveAttribute('data-to', '/threads/$threadId')
    expect(chat).toHaveAttribute('data-param', 'chat-1')
    expect(task).toHaveAttribute('data-to', '/cowork/$sessionId')
    expect(task).toHaveAttribute('data-param', 'cw-1')
  })

  it('applies overflow guard on the project-view thread link wrapper', async () => {
    render(
      <ThreadList
        threads={[makeThread()]}
        currentProjectId="project-1"
      />
    )
    await flushEffects()

    const link = screen.getByText(longUrl).closest('a')
    expect(link).not.toBeNull()
    expect(link).toHaveClass('max-w-full', 'overflow-hidden')
  })

  it('falls back to the new-thread label when the title is empty and still truncates', async () => {
    render(<ThreadList threads={[makeThread({ title: '' })]} />)
    await flushEffects()

    const titleEl = screen
      .getAllByText('common:newThread')
      .find((el) => el.tagName === 'SPAN')
    expect(titleEl).toBeDefined()
    expect(titleEl).toHaveClass('block', 'truncate')
    expect(titleEl).toHaveAttribute('title', 'common:newThread')
  })
})
