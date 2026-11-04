import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { MemorySavedToast } from '../MemorySavedToast'
import { fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (_key: string, options: { defaultValue: string }) => options.defaultValue }),
}))

describe('MemorySavedToast', () => {
  it('offers a keyboard accessible Inspect link using app routing', async () => {
    const root = createRootRoute({ component: () => <><MemorySavedToast /><Outlet /></> })
    const index = createRoute({ getParentRoute: () => root, path: '/', component: () => null })
    const settings = createRoute({ getParentRoute: () => root, path: '/settings/cowork', component: () => <div>Memory management</div> })
    const router = createRouter({ routeTree: root.addChildren([index, settings]), history: createMemoryHistory({ initialEntries: ['/'] }) })
    render(<RouterProvider router={router} />)
    const inspect = await screen.findByRole('link', { name: 'Inspect saved memory' })
    expect(screen.getByText('Memory saved')).toBeVisible()
    expect(inspect).toHaveTextContent('Inspect')
    expect(inspect).toHaveAttribute('href', '/settings/cowork')
    fireEvent.click(inspect)
    await waitFor(() => expect(screen.getByText('Memory management')).toBeVisible())
    expect(router.state.location.pathname).toBe('/settings/cowork')
    expect(screen.queryByText('Undo')).toBeNull()
  })
})
