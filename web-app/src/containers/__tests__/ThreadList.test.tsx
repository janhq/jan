import { describe, it, expect, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import ThreadList from '../ThreadList'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className, title }: any) => (
    <a className={className} title={title}>
      {children}
    </a>
  ),
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
