import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const updateThreadProject = vi.hoisted(() => vi.fn())
vi.mock('@/lib/threadProject', () => ({ updateThreadProject }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useParams: ({ select }: { select?: (p: object) => unknown } = {}) =>
    select ? select({ threadId: undefined }) : { threadId: undefined },
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { projectName?: string }) =>
      opts?.projectName ? `${key}:${opts.projectName}` : key,
  }),
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: (selector: (s: object) => unknown) =>
    selector({ deleteThread: vi.fn(), renameThread: vi.fn(), updateThread: vi.fn() }),
}))

vi.mock('@/hooks/useMessages', () => ({
  useMessages: (selector: (s: object) => unknown) =>
    selector({ messages: {}, getMessages: () => [], setMessages: vi.fn() }),
}))

const folder = { id: 'p1', name: 'Alpha', updated_at: 1 }
vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: () => ({
    folders: [folder],
    getFolderById: () => folder,
  }),
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <li>{children}</li>,
  SidebarMenuButton: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarMenuAction: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  useSidebar: () => ({ isMobile: false }),
}))

vi.mock('@/components/ui/dropdown-menu', () => {
  const Passthrough = ({ children }: { children: React.ReactNode }) => <>{children}</>
  return {
    DropdownMenu: Passthrough,
    DropdownMenuContent: Passthrough,
    DropdownMenuItem: ({
      children,
      onClick,
    }: {
      children: React.ReactNode
      onClick?: (e: { stopPropagation: () => void }) => void
    }) => (
      <button onClick={() => onClick?.({ stopPropagation: () => {} })}>{children}</button>
    ),
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

import ThreadList from '../ThreadList'

const thread = (assigned = false) =>
  ({
    id: 't1',
    title: 'T',
    updated: 0,
    metadata: assigned ? { project: { id: 'p0', name: 'Old', updated_at: 1 } } : {},
  }) as Thread

describe('ThreadList project moves', () => {
  beforeEach(() => vi.clearAllMocks())

  it('toasts success only when the assignment was applied', () => {
    updateThreadProject.mockReturnValue(true)
    render(<ThreadList threads={[thread()]} />)
    fireEvent.click(screen.getByText('Alpha'))
    expect(toast.success).toHaveBeenCalledWith(
      'common:toast.threadAssignedToProject.description:Alpha'
    )
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('toasts an error, not success, when the assignment is refused', () => {
    updateThreadProject.mockReturnValue(false)
    render(<ThreadList threads={[thread()]} />)
    fireEvent.click(screen.getByText('Alpha'))
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      'common:toast.threadProjectMoveFailed.description'
    )
  })

  it('reports removal from a project only when it happened', () => {
    updateThreadProject.mockReturnValue(false)
    render(<ThreadList threads={[thread(true)]} />)
    fireEvent.click(screen.getByText('common:projects.removeFromProject'))
    expect(updateThreadProject).toHaveBeenCalledWith('t1', undefined)
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalled()

    updateThreadProject.mockReturnValue(true)
    fireEvent.click(screen.getByText('common:projects.removeFromProject'))
    expect(toast.success).toHaveBeenCalledWith(
      'common:toast.threadRemovedFromProject.description:Old'
    )
  })
})
