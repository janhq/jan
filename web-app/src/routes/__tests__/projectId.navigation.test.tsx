/* eslint-disable @typescript-eslint/no-explicit-any */
// Real-router regression for project draft-consent isolation: navigating
// /project/a -> /project/b keeps the SAME route component mounted, so project
// A's elevated pending draft must reset synchronously — an immediate send on
// B can never carry A's grant. Real @tanstack/react-router navigations, no
// manual rerender.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'

const h = vi.hoisted(() => ({
  setCaps: vi.fn(async () => undefined),
  prepareOutcome: undefined as unknown,
}))

vi.mock('@/lib/version', () => ({ isCoworkEnabled: () => false }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => ({
    selectedModel: { id: 'model-a', capabilities: ['tools'] },
    selectedProvider: 'llamacpp',
  }),
}))
vi.mock('@/hooks/useThreads', () => {
  const useThreads = (selector: any) =>
    selector({
      threads: {},
      deleteAllThreadsByProject: vi.fn(),
      setCurrentThreadId: vi.fn(),
    })
  ;(useThreads as any).getState = () => ({
    setConversationCapabilities: h.setCaps,
  })
  return { useThreads }
})
vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: () => ({
    getFolderById: (id: string) => ({ id, name: `Project ${id}`, updated_at: 1 }),
    updateFolder: vi.fn(),
  }),
}))
vi.mock('@/hooks/useAssistant', () => ({ useAssistant: () => ({ assistants: [] }) }))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({ dialog: () => ({ open: vi.fn(async () => null) }) }),
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
vi.mock('@/containers/HeaderPage', () => ({ default: () => null }))
vi.mock('@/containers/ThreadList', () => ({ default: () => null }))
vi.mock('@/containers/ProjectFiles', () => ({ default: () => null }))
vi.mock('@/containers/ConversationHeaderTitle', () => ({ ConversationHeaderTitle: () => null }))
vi.mock('@/containers/AvatarEmoji', () => ({ AvatarEmoji: () => null }))
vi.mock('@/containers/dialogs/AddProjectDialog', () => ({ default: () => null }))
vi.mock('@/containers/dialogs/DeleteProjectDialog', () => ({ DeleteProjectDialog: () => null }))
vi.mock('@/containers/dialogs/DeleteAllThreadsInProjectDialog', () => ({
  DeleteAllThreadsInProjectDialog: () => null,
}))
vi.mock('@/lib/utils', () => ({ cn: (...c: any[]) => c.filter(Boolean).join(' ') }))

import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from '@tanstack/react-router'
import { Route as ProjectRoute } from '../project/$projectId'

const buildRouter = () => {
  const rootRoute = createRootRoute()
  const projectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/project/$projectId',
    component: (ProjectRoute as any).options.component,
  })
  return createRouter({
    routeTree: rootRoute.addChildren([projectRoute]) as any,
    history: createMemoryHistory({ initialEntries: ['/project/a'] }),
  })
}

describe('project draft isolation under real router navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.prepareOutcome = undefined
  })

  it('an elevated draft on project A never reaches an immediate send on project B', async () => {
    const router = buildRouter()
    // Finish the initial load BEFORE mounting interactions: the router swaps
    // the match in after first paint, remounting the route component and
    // resetting any open collapsible.
    await act(async () => {
      await router.load()
    })
    render(<RouterProvider router={router as any} />)
    await screen.findByTestId('project-scope-consent-trigger')
    await act(async () => {})
    // Elevate grants on project A via the real consent UI.
    fireEvent.click(screen.getByTestId('project-scope-consent-trigger'))
    fireEvent.click(
      await screen.findByLabelText('Allow shell commands to access the network')
    )
    fireEvent.click(
      screen.getByLabelText('Allow durable memory writes beyond this conversation')
    )
    await waitFor(() =>
      expect(screen.getByTestId('chat-input')).toHaveAttribute('data-has-prepare', 'true')
    )

    // Real navigation to project B keeps the component mounted.
    await act(async () => {
      await router.navigate({ to: '/project/$projectId', params: { projectId: 'b' } })
    })
    // Immediate send on B: no prepare path, and the setter is never called
    // with A's grant.
    await waitFor(() =>
      expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-has-prepare')
    )
    fireEvent.click(screen.getByTestId('invoke-prepare'))
    expect(h.setCaps).not.toHaveBeenCalled()
    expect(screen.getByTestId('project-scope-consent-trigger')).toHaveTextContent(
      /^Conversation permissions$/
    )

    // B can then elevate independently, applying only B's own draft. The
    // collapsible UI state stays open across the navigation (same mounted
    // component — exactly why the draft itself must reset), so the controls
    // are already visible.
    fireEvent.click(
      await screen.findByLabelText('Allow shell commands to access the network')
    )
    await waitFor(() =>
      expect(screen.getByTestId('chat-input')).toHaveAttribute('data-has-prepare', 'true')
    )
    fireEvent.click(screen.getByTestId('invoke-prepare'))
    await waitFor(() =>
      expect(h.setCaps).toHaveBeenCalledExactlyOnceWith('created-thread', {
        version: 1,
        folderScope: null,
        shellNetwork: true,
        memoryWrite: false,
      })
    )
  })
})
