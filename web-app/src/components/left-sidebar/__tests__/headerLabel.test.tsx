import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const titlebar = vi.hoisted(() => ({ left: [] as string[] }))

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: '/' }),
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
vi.mock('@/stores/titlebar-layout-store', () => ({
  useTitlebarLayout: (
    selector: (state: { layout: { left: string[]; right: string[] } }) => unknown
  ) => selector({ layout: { left: titlebar.left, right: [] } }),
}))
vi.mock('@/containers/DownloadManegement', () => ({
  DownloadManagement: () => null,
}))
vi.mock('../NavCoworkTools', () => ({ NavCoworkTools: () => null }))
vi.mock('../NavHistory', () => ({ NavHistory: () => null }))
vi.mock('../NavMain', () => ({ NavMain: () => null }))
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
  titlebar.left = []
  vi.stubGlobal('IS_MACOS', false)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

it('shows the Jan label on Windows and Linux with window buttons on the right', () => {
  render(<LeftSidebar />)

  expect(screen.getByText('Jan')).toBeInTheDocument()
})

// The traffic lights own the top-left on macOS (#8943).
it('hides the Jan label on macOS', () => {
  vi.stubGlobal('IS_MACOS', true)
  render(<LeftSidebar />)

  expect(screen.queryByText('Jan')).not.toBeInTheDocument()
})

it('hides the Jan label when a Linux desktop puts window buttons on the left', () => {
  titlebar.left = ['close', 'minimize', 'maximize']
  render(<LeftSidebar />)

  expect(screen.queryByText('Jan')).not.toBeInTheDocument()
})
