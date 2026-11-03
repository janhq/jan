/* eslint-disable @typescript-eslint/no-explicit-any */
// Real-router regression for the temporary-chat gating: the home route's
// validateSearch keeps only threadModel, so toggling ?temporary-chat=true can
// leave the VALIDATED search structurally equal. The gate must still react,
// because it subscribes to the router's raw searchStr — proven here with real
// @tanstack/react-router navigations and no manual rerender. There is no
// in-app entry that sets this flag on the current branch (the web-platform
// writer was removed); this guards deep links and legacy queries.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'

const h = vi.hoisted(() => ({
  setCaps: vi.fn(async () => undefined),
  prepareOutcome: undefined as unknown,
  selectedModel: { id: 'model-a', capabilities: ['tools'] } as any,
}))

// Everything EXCEPT @tanstack/react-router is mocked like the main home
// suite; the router itself is real.
vi.mock('@/lib/version', () => ({ isCoworkEnabled: () => false }))
vi.mock('@/lib/providerReadiness', () => ({ hasUsableProvider: () => true }))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({ dialog: () => ({ open: vi.fn(async () => null) }) }),
}))
vi.mock('@/hooks/useCoworkRun', () => ({
  useCoworkRun: { getState: () => ({ runId: {} }) },
}))
vi.mock('@/hooks/usePrompt', () => ({
  usePrompt: { getState: () => ({ setPrompt: vi.fn() }) },
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => ({
    providers: [{ provider: 'llamacpp' }],
    selectedModel: h.selectedModel,
    selectedProvider: 'llamacpp',
  }),
}))
vi.mock('@/hooks/useThreads', () => {
  const useThreads = () => ({ setCurrentThreadId: vi.fn() })
  ;(useThreads as any).getState = () => ({
    setConversationCapabilities: h.setCaps,
  })
  return { useThreads }
})
vi.mock('@/hooks/useTools', () => ({ useTools: vi.fn() }))
vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: () => ({ addFolder: vi.fn(), folders: [] }),
}))
vi.mock('@/containers/ChatInput', () => ({
  default: ({ prepareThreadCreation }: any) => (
    <div
      data-testid="chat-input"
      data-has-prepare={prepareThreadCreation ? 'true' : undefined}
    >
      <button
        data-testid="invoke-prepare"
        onClick={() => {
          const apply = prepareThreadCreation?.()
          if (apply) void apply('created-thread').then((result: unknown) => { h.prepareOutcome = result })
        }}
      />
    </div>
  ),
}))
vi.mock('@/containers/CoworkComposerMenu', () => ({ CoworkComposerMenu: () => null }))
vi.mock('@/containers/HeaderPage', () => ({ default: () => null }))
vi.mock('@/containers/SetupScreen', () => ({ default: () => null }))
vi.mock('@/containers/dialogs/AddProjectDialog', () => ({ default: () => null }))
vi.mock('@/lib/utils', () => ({ cn: (...c: any[]) => c.filter(Boolean).join(' ') }))

import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from '@tanstack/react-router'
import { Route as IndexRoute } from '../index'

const buildRouter = () => {
  const rootRoute = createRootRoute()
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    // The REAL production validator, which drops the temporary-chat key.
    validateSearch: (IndexRoute as any).options.validateSearch,
    component: (IndexRoute as any).options.component,
  })
  return createRouter({
    routeTree: rootRoute.addChildren([homeRoute]) as any,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
}

describe('home temporary-chat gating under real router navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.prepareOutcome = undefined
    h.selectedModel = { id: 'model-a', capabilities: ['tools'] }
  })

  it('a real query toggle hides the draft consent without any manual rerender and never applies the pending grant', async () => {
    const router = buildRouter()
    render(<RouterProvider router={router as any} />)
    // Elevate the draft through the real consent UI.
    fireEvent.click(await screen.findByTestId('home-scope-consent-trigger'))
    fireEvent.click(
      await screen.findByLabelText('Allow shell commands to access the network')
    )
    expect(screen.getByTestId('chat-input')).toHaveAttribute('data-has-prepare', 'true')

    // Real navigation setting the flag; validateSearch drops the key, so only
    // the searchStr subscription can propagate this. No rerender() call.
    await act(async () => {
      await router.navigate({ to: '/', search: { 'temporary-chat': true } as any })
    })
    await waitFor(() =>
      expect(screen.queryByTestId('home-scope-consent-trigger')).not.toBeInTheDocument()
    )
    expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-has-prepare')
    // The hidden pending grant can never be applied in temporary mode.
    fireEvent.click(screen.getByTestId('invoke-prepare'))
    expect(h.setCaps).not.toHaveBeenCalled()
    expect(h.prepareOutcome).toBeUndefined()

    // Leaving temporary mode by real navigation resurfaces the draft, pending.
    await act(async () => {
      await router.navigate({ to: '/', search: {} as any })
    })
    await waitFor(() =>
      expect(screen.getByTestId('home-scope-consent-trigger')).toHaveTextContent(
        'Conversation permissions (pending)'
      )
    )
    expect(screen.getByTestId('chat-input')).toHaveAttribute('data-has-prepare', 'true')
  })
})
