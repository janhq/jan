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

// Stand-in for a routed page: a fresh composer (as ChatInput) mounts per path.
const routeTree = () => (
  <SidebarProvider open>
    <LeftSidebar />
    <SidebarTrigger data-testid="outer-trigger" className="outer" />
    <textarea
      key={env.pathname}
      aria-label="composer"
      data-navigation-focus-target
      autoFocus
    />
  </SidebarProvider>
)

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

it('keeps the destination composer focused when navigation closes the overlay', async () => {
  const view = render(routeTree())
  const toggle = screen.getAllByRole('button', { name: 'common:sidebar.toggle' }).at(-1)!
  fireEvent.click(toggle)
  expect(screen.getByRole('dialog')).toBeInTheDocument()

  env.pathname = '/threads/1'
  act(() => view.rerender(routeTree()))
  await settle()

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByLabelText('composer')).toHaveFocus()
  expect(toggle).not.toHaveFocus()
})

it('still returns focus to the toggle when Escape dismisses the overlay', async () => {
  render(routeTree())
  const toggle = screen.getAllByRole('button', { name: 'common:sidebar.toggle' }).at(-1)!
  fireEvent.click(toggle)
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  await settle()

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(toggle).toHaveFocus()
})

it('returns focus to the toggle on Escape after an earlier navigation close', async () => {
  const view = render(routeTree())
  const toggle = () => screen.getAllByRole('button', { name: 'common:sidebar.toggle' }).at(-1)!
  fireEvent.click(toggle())
  env.pathname = '/threads/1'
  act(() => view.rerender(routeTree()))
  await settle()

  fireEvent.click(toggle())
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  await settle()
  expect(toggle()).toHaveFocus()
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
