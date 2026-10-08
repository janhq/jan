import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'

const channel = vi.hoisted(() => ({ cowork: false }))

vi.mock('@/lib/version', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/version')>()),
  isCoworkEnabled: () => channel.cowork,
}))

import { ensureCoworkEnabled } from '../coworkAccess'
import { route } from '@/constants/routes'

/**
 * The real router over the guarded routes, so a redirect is observable as the
 * path the app settles on rather than as an object thrown by the guard.
 */
async function routerAt(pathname: string) {
  const rootRoute = createRootRoute()
  const page = (path: string, beforeLoad?: () => void) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      beforeLoad,
      component: () => null,
    })
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      page(route.home),
      page(route.cowork, () => ensureCoworkEnabled()),
      page(route.settings.general),
      page(route.settings.cowork, () =>
        ensureCoworkEnabled(route.settings.general)
      ),
    ]),
    history: createMemoryHistory({ initialEntries: [pathname] }),
  })
  await router.load()
  return router.state.location.pathname
}

beforeEach(() => {
  channel.cowork = false
})

describe('ensureCoworkEnabled', () => {
  it('lands a bookmarked Cowork URL on Home', async () => {
    expect(await routerAt(route.cowork)).toBe(route.home)
  })

  it('lands the Cowork settings URL on General settings', async () => {
    expect(await routerAt(route.settings.cowork)).toBe(route.settings.general)
  })

  it('keeps Cowork URLs routable where Cowork ships', async () => {
    channel.cowork = true
    expect(await routerAt(route.cowork)).toBe(route.cowork)
    expect(await routerAt(route.settings.cowork)).toBe(route.settings.cowork)
  })
})
