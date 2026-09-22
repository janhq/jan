import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const channel = vi.hoisted(() => ({ cowork: false }))
const navigation = vi.hoisted(() => ({ pathname: '/' }))

vi.mock('@/lib/version', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/version')>()),
  isCoworkEnabled: () => channel.cowork,
}))
vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: navigation.pathname }),
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a {...props} href={to}>
      {children}
    </a>
  ),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/hooks/useLeftPanel', () => ({
  useLeftPanel: () => ({ open: true }),
}))
vi.mock('@/hooks/useThreads', () => ({
  useThreads: (
    selector: (state: { threads: Record<string, unknown> }) => unknown
  ) => selector({ threads: {} }),
}))
vi.mock('@/stores/titlebar-layout-store', () => ({
  useTitlebarLayout: () => 0,
}))
vi.mock('@/containers/DownloadManegement', () => ({
  DownloadManagement: () => null,
}))
vi.mock('../NavCowork', () => ({ NavCowork: () => <div>Cowork sessions</div> }))
vi.mock('../NavMain', () => ({ NavMain: () => <div>Chat navigation</div> }))
vi.mock('../NavChats', () => ({ NavChats: () => <div>Chat threads</div> }))
vi.mock('../NavProjects', () => ({ NavProjects: () => null }))
vi.mock('@/components/ui/sidebar', () => {
  const Box = ({ children }: { children: ReactNode }) => <div>{children}</div>
  return {
    Sidebar: Box,
    SidebarContent: Box,
    SidebarHeader: Box,
    SidebarTrigger: () => null,
    SidebarRail: () => null,
  }
})

import { LeftSidebar } from '..'

beforeEach(() => {
  channel.cowork = false
  navigation.pathname = '/'
})

it('keeps a Cowork URL on the chat surface on builds that do not ship Cowork', () => {
  navigation.pathname = '/cowork'
  render(<LeftSidebar />)

  expect(screen.getByText('Chat navigation')).toBeInTheDocument()
  expect(screen.getByText('Chat threads')).toBeInTheDocument()
  expect(screen.queryByText('Cowork sessions')).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'common:cowork' })).not.toBeInTheDocument()
  // The switcher has a single surface left, so it is not rendered at all.
  expect(screen.queryByRole('link', { name: 'common:home' })).not.toBeInTheDocument()
})

it('shows the Cowork surface and the tab switcher where Cowork ships', () => {
  channel.cowork = true
  navigation.pathname = '/cowork'
  render(<LeftSidebar />)

  expect(screen.getByText('Cowork sessions')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'common:cowork' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'common:home' })).toBeInTheDocument()
  expect(screen.queryByText('Chat threads')).not.toBeInTheDocument()
})
