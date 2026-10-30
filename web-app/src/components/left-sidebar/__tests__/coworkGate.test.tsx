import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const channel = vi.hoisted(() => ({ cowork: false }))

vi.mock('@/lib/version', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/version')>()),
  isCoworkEnabled: () => channel.cowork,
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/' }),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/hooks/useLeftPanel', () => ({ useLeftPanel: () => ({ open: true }) }))
vi.mock('@/stores/titlebar-layout-store', () => ({ useTitlebarLayout: () => 0 }))
vi.mock('@/containers/DownloadManegement', () => ({ DownloadManagement: () => null }))
vi.mock('@/containers/dialogs/SkillsManagerDialog', () => ({ default: () => null }))
vi.mock('../NavMain', () => ({ NavMain: () => <div>Navigation</div> }))
vi.mock('../NavHistory', () => ({ NavHistory: () => <div>Chats and tasks</div> }))
vi.mock('../NavProjects', () => ({ NavProjects: () => <div>Projects</div> }))
vi.mock('@/components/ui/sidebar', () => {
  const Box = ({ children }: { children: ReactNode }) => <div>{children}</div>
  return {
    Sidebar: Box,
    SidebarContent: Box,
    SidebarHeader: Box,
    SidebarMenu: Box,
    SidebarMenuItem: Box,
    SidebarMenuButton: ({ children, ...p }: { children: ReactNode }) => (
      <button {...p}>{children}</button>
    ),
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
  expect(screen.getByText('Navigation')).toBeInTheDocument()
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

it('shows Artifacts and Customize where Cowork ships, without replacing the rest', () => {
  channel.cowork = true
  render(<LeftSidebar />)
  expect(screen.getByTestId('nav-artifacts')).toBeInTheDocument()
  expect(screen.getByTestId('nav-customize')).toBeInTheDocument()
  expect(screen.getByText('Navigation')).toBeInTheDocument()
  expect(screen.getByText('Chats and tasks')).toBeInTheDocument()
})
