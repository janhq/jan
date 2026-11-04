import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const env = vi.hoisted(() => ({ pathname: '/', mobile: true }))

vi.mock('@tanstack/react-router', () => ({
  useLocation: ({ select }: { select?: (l: { pathname: string }) => unknown } = {}) =>
    select ? select({ pathname: env.pathname }) : { pathname: env.pathname },
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => env.mobile }))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/hooks/useLeftPanel', () => ({ useLeftPanel: () => ({ open: true }) }))
vi.mock('@/stores/titlebar-layout-store', () => ({
  useTitlebarLayout: (selector: (s: unknown) => unknown) =>
    selector({ layout: { left: [], right: [] } }),
}))
vi.mock('@/containers/DownloadManegement', () => ({
  DownloadManagement: () => <div data-testid="downloads" />,
}))
vi.mock('../NavCoworkTools', () => ({ NavCoworkTools: () => null }))
vi.mock('../NavHistory', () => ({ NavHistory: () => null }))
vi.mock('../NavMain', () => ({ NavMain: () => null }))
vi.mock('../NavProjects', () => ({ NavProjects: () => null }))

import { LeftSidebar } from '..'
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'

const tree = () => (
  <SidebarProvider open>
    <LeftSidebar />
    <SidebarTrigger data-testid="outer-trigger" className="outer" />
  </SidebarProvider>
)

beforeEach(() => {
  env.pathname = '/'
  env.mobile = true
  vi.stubGlobal('IS_MACOS', false)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('closes the mobile overlay when navigation lands on a new page', () => {
  const view = render(tree())
  fireEvent.click(screen.getAllByRole('button', { name: 'common:sidebar.toggle' }).at(-1)!)
  expect(screen.getByRole('dialog', { name: 'common:sidebar.navigation' })).toBeInTheDocument()

  env.pathname = '/threads/1'
  act(() => view.rerender(tree()))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('keeps the overlay open while the page does not change', () => {
  const view = render(tree())
  fireEvent.click(screen.getAllByRole('button', { name: 'common:sidebar.toggle' }).at(-1)!)
  act(() => view.rerender(tree()))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

it('leaves the download indicator to the page header on mobile but keeps it in the docked sidebar', () => {
  const mobile = render(tree())
  fireEvent.click(screen.getAllByRole('button', { name: 'common:sidebar.toggle' }).at(-1)!)
  expect(screen.queryByTestId('downloads')).not.toBeInTheDocument()
  mobile.unmount()

  env.mobile = false
  render(tree())
  expect(screen.getByTestId('downloads')).toBeInTheDocument()
})
