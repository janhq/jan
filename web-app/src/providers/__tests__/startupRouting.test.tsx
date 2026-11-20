import { useEffect, useState, type PropsWithChildren } from 'react'
import { render, screen } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import { resolveThreadForRoute } from '@/lib/threadRouteClassification'

const startup = vi.hoisted(() => ({ services: false, extensions: false }))
vi.mock('../ServiceHubProvider', () => ({
  ServiceHubProvider: ({ children }: PropsWithChildren) => {
    const [ready, setReady] = useState(false)
    useEffect(() => {
      startup.services = true
      setReady(true)
    }, [])
    return ready ? children : null
  },
}))
vi.mock('../ExtensionProvider', () => ({
  ExtensionProvider: ({ children }: PropsWithChildren) => {
    const [ready, setReady] = useState(false)
    useEffect(() => {
      startup.extensions = true
      setReady(true)
    }, [])
    return ready ? children : null
  },
}))
vi.mock('@/i18n/TranslationContext', () => ({
  TranslationProvider: ({ children }: PropsWithChildren) => children,
}))
import { StartupProvider } from '../StartupProvider'

describe('initial direct conversation routing', () => {
  it('initializes services and extensions before the initial beforeLoad, without a home navigation', async () => {
    startup.services = false
    startup.extensions = false
    const root = createRootRoute({ component: Outlet })
    const thread = createRoute({
      getParentRoute: () => root,
      path: '/threads/$threadId',
      beforeLoad: async ({ params }) => {
        await resolveThreadForRoute({
          threadId: params.threadId,
          readThread: () => undefined,
          fetchThreads: async () => {
            if (!startup.services) throw new Error('ServiceHub not initialized')
            if (!startup.extensions) throw new Error('Conversational extension not available yet')
            return [{ id: params.threadId }]
          },
          sleep: () => Promise.resolve(),
        })
      },
      component: () => <div>Writable conversation</div>,
      errorComponent: () => <div>Classification unavailable</div>,
    })
    const router = createRouter({
      routeTree: root.addChildren([thread]),
      history: createMemoryHistory({ initialEntries: ['/threads/existing'] }),
    })
    render(
      <StartupProvider>
        <RouterProvider router={router} />
      </StartupProvider>
    )
    expect(await screen.findByText('Writable conversation')).toBeInTheDocument()
  })
})
