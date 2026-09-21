import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const navigation = vi.hoisted(() => ({
  pathname: '/cowork',
  session: 'existing-session',
}))
vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: navigation.pathname }),
  Link: ({
    to,
    onClick,
    children,
    ...props
  }: {
    to: string
    onClick?: () => void
    children: ReactNode
  }) => (
    <a
      {...props}
      href={to}
      onClick={(event) => {
        event.preventDefault()
        onClick?.()
        navigation.pathname = to
      }}
    >
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
  navigation.pathname = '/cowork'
  navigation.session = 'existing-session'
})

it('keeps Cowork navigation across Settings pages and returns without starting a session', () => {
  const view = render(<LeftSidebar />)
  navigation.pathname = '/settings/general'
  view.rerender(<LeftSidebar />)
  expect(screen.getByText('Cowork sessions')).toBeInTheDocument()
  expect(screen.queryByText('Chat threads')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'common:cowork' })).toHaveAttribute(
    'aria-current',
    'page'
  )
  navigation.pathname = '/settings/providers'
  view.rerender(<LeftSidebar />)
  fireEvent.click(screen.getByRole('link', { name: 'common:cowork' }))
  view.rerender(<LeftSidebar />)
  expect(navigation.pathname).toBe('/cowork')
  expect(navigation.session).toBe('existing-session')
})

it('keeps the current Cowork session when switching from a chat', () => {
  navigation.pathname = '/threads/chat-1'
  const view = render(<LeftSidebar />)
  navigation.pathname = '/settings/general'
  view.rerender(<LeftSidebar />)
  expect(screen.getByText('Chat threads')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'common:home' })).toHaveAttribute(
    'aria-current',
    'page'
  )
  fireEvent.click(screen.getByRole('link', { name: 'common:cowork' }))
  expect(navigation.session).toBe('existing-session')
})
