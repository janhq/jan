import '@testing-library/jest-dom/vitest'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const channel = vi.hoisted(() => ({ cowork: false }))

vi.mock('@/lib/version', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/version')>()),
  isCoworkEnabled: () => channel.cowork,
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useLocation: () => ({ pathname: '/' }),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/hooks/useLeftPanel', () => ({ useLeftPanel: () => ({ open: true }) }))
vi.mock('@/stores/titlebar-layout-store', () => ({ useTitlebarLayout: () => 0 }))
vi.mock('@/containers/DownloadManegement', () => ({ DownloadManagement: () => null }))
vi.mock('@/containers/dialogs/SkillsManagerDialog', () => ({
  default: ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) =>
    open ? <div role="dialog"><button onClick={() => onOpenChange(false)}>Close skills</button></div> : null,
}))
vi.mock('@/hooks/useThreadManagement', () => ({ useThreadManagement: () => ({ addFolder: vi.fn() }) }))
vi.mock('@/hooks/useSearchDialog', () => ({ useSearchDialog: () => ({ open: false, setOpen: vi.fn() }) }))
vi.mock('@/hooks/useProjectDialog', () => ({ useProjectDialog: () => ({ open: false, setOpen: vi.fn() }) }))
vi.mock('@/containers/dialogs/AddProjectDialog', () => ({ default: () => null }))
vi.mock('@/containers/dialogs/SearchDialog', () => ({ SearchDialog: () => null }))
vi.mock('../NavHistory', () => ({ NavHistory: () => <div>Chats and tasks</div> }))
vi.mock('../NavProjects', () => ({ NavProjects: () => <div>Projects</div> }))
vi.mock('@/components/ui/sidebar', () => {
  const Box = ({ children }: { children: ReactNode }) => <div>{children}</div>
  return {
    Sidebar: Box,
    SidebarContent: Box,
    SidebarHeader: Box,
    SidebarMenu: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
    SidebarMenuItem: ({ children }: { children: ReactNode }) => <li>{children}</li>,
    SidebarMenuButton: (props: ComponentProps<'button'> & { asChild?: boolean; isActive?: boolean }) => {
      const { asChild, isActive, ...buttonProps } = props
      void asChild
      void isActive
      return <button {...buttonProps} />
    },
    SidebarTrigger: () => null,
    SidebarRail: () => null,
  }
})
vi.mock('@/components/animated-icon/animated-lucide', () => ({
  AnimatedLucideIcon: () => null,
}))

import { LeftSidebar } from '..'

beforeEach(() => {
  channel.cowork = false
})

it('renders one sidebar: navigation, projects and a single history, with no tab switcher', () => {
  render(<LeftSidebar />)
  expect(screen.getByText('common:newChat')).toBeInTheDocument()
  expect(screen.getByText('Projects')).toBeInTheDocument()
  expect(screen.getByText('Chats and tasks')).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'common:cowork' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'common:home' })).not.toBeInTheDocument()
})

it('hides the Cowork-only entries where Cowork is not available', () => {
  render(<LeftSidebar />)
  expect(screen.queryByTestId('nav-artifacts')).not.toBeInTheDocument()
  expect(screen.queryByTestId('nav-customize')).not.toBeInTheDocument()
})

it('shows Artifacts and Skills where Cowork ships, without replacing the rest', () => {
  channel.cowork = true
  render(<LeftSidebar />)
  expect(screen.getByTestId('nav-artifacts')).toBeInTheDocument()
  expect(screen.getByTestId('nav-customize')).toHaveTextContent('common:skills')
  expect(screen.queryByText('common:customize')).not.toBeInTheDocument()
  const artifacts = screen.getByTestId('nav-artifacts')
  expect(screen.getByText('common:search').compareDocumentPosition(artifacts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(artifacts.compareDocumentPosition(screen.getByText('common:hub')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByText('common:newChat')).toBeInTheDocument()
  expect(screen.getByText('Chats and tasks')).toBeInTheDocument()
})

it('inserts Skills directly before Settings as a menu row and opens its dialog', () => {
  channel.cowork = true
  render(<LeftSidebar />)
  const skills = screen.getByRole('button', { name: 'common:skills' })
  const row = skills.closest('li')!
  expect(row.nextElementSibling).toHaveTextContent('common:settings')
  expect(row.parentElement?.tagName).toBe('UL')
  expect(document.querySelector('ul ul')).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(skills)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Close skills'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
