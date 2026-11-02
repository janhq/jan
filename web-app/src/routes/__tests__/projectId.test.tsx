/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  coworkEnabled: false,
  selectedModel: undefined as any,
  selectedProvider: '',
  project: {
    id: 'project-1',
    name: 'Project',
    updated_at: 1,
    assistantId: undefined as string | undefined,
  } as any,
  startCoworkConversation: vi.fn(() => 'session-1'),
  toastError: vi.fn(),
  lastSubmitResult: undefined as unknown,
  setCaps: vi.fn(async () => undefined),
  prepareOutcome: undefined as unknown,
  projectId: 'project-1',
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => ({ ...config, id: '/project/$projectId' }),
  useNavigate: () => h.navigate,
  useLocation: (opts: any) => opts.select({ searchStr: window.location.search }),
  useParams: () => ({ projectId: h.projectId }),
}))

vi.mock('@/lib/version', () => ({ isCoworkEnabled: () => h.coworkEnabled }))
vi.mock('@/lib/startCoworkConversation', () => ({
  startCoworkConversation: (opts: any) => h.startCoworkConversation(opts),
}))
vi.mock('sonner', () => ({ toast: { error: (...args: any[]) => h.toastError(...args) } }))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => ({
    selectedModel: h.selectedModel,
    selectedProvider: h.selectedProvider,
  }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    dialog: () => ({ open: vi.fn(async () => null) }),
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
    getFolderById: (id: string) => ({ ...h.project, id }),
    updateFolder: vi.fn(),
  }),
}))

vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: () => ({ assistants: [] }),
}))

vi.mock('@/containers/ChatInput', () => ({
  default: ({
    onSubmit,
    leadingControls,
    projectId,
    scopeKey,
    supportsAssistants,
    ownsToolSet,
    prepareThreadCreation,
  }: any) => (
    <div
      data-testid="chat-input"
      data-project-id={projectId}
      data-scope-key={scopeKey}
      data-supports-assistants={String(supportsAssistants)}
      data-owns-toolset={String(ownsToolSet)}
      data-has-prepare={prepareThreadCreation ? 'true' : undefined}
    >
      <div data-testid="leading-controls">{leadingControls}</div>
      <button
        data-testid="submit"
        onClick={() => {
          h.lastSubmitResult = (onSubmit ?? (() => {}))(
            'project task',
            undefined,
            undefined,
            'project task'
          )
        }}
      />
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

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}))
vi.mock('@/containers/ThreadList', () => ({ default: () => null }))
vi.mock('@/containers/ProjectFiles', () => ({ default: () => null }))
vi.mock('@/containers/ConversationHeaderTitle', () => ({
  ConversationHeaderTitle: () => null,
}))
vi.mock('@/containers/AvatarEmoji', () => ({ AvatarEmoji: () => null }))
vi.mock('@/containers/dialogs/AddProjectDialog', () => ({ default: () => null }))
vi.mock('@/containers/dialogs/DeleteProjectDialog', () => ({
  DeleteProjectDialog: () => null,
}))
vi.mock('@/containers/dialogs/DeleteAllThreadsInProjectDialog', () => ({
  DeleteAllThreadsInProjectDialog: () => null,
}))
vi.mock('@/lib/utils', () => ({
  cn: (...c: any[]) => c.filter(Boolean).join(' '),
}))

import { Route } from '../project/$projectId'

const renderComponent = () => {
  const Component = Route.component as React.ComponentType
  return render(<Component />)
}

describe('Project route single Chat flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.coworkEnabled = false
    h.selectedModel = undefined
    h.selectedProvider = ''
    h.startCoworkConversation.mockReturnValue('session-1')
    h.lastSubmitResult = undefined
    h.projectId = 'project-1'
  })

  it.each([false, true])(
    'shows no mode selector and keeps the ordinary Chat contract (coworkEnabled=%s)',
    (coworkEnabled) => {
      h.coworkEnabled = coworkEnabled
      renderComponent()
      expect(screen.queryByTestId('home-mode-toggle')).not.toBeInTheDocument()
      const input = screen.getByTestId('chat-input')
      expect(input).toHaveAttribute('data-supports-assistants', 'true')
      expect(input).toHaveAttribute('data-owns-toolset', 'undefined')
      expect(input).not.toHaveAttribute('data-scope-key')
      // No onSubmit override: a submit never starts a legacy Cowork session.
      fireEvent.click(screen.getByTestId('submit'))
      expect(h.startCoworkConversation).not.toHaveBeenCalled()
      expect(h.navigate).not.toHaveBeenCalled()
    }
  )

  it('offers draft conversation permissions only for a tool-capable model', () => {
    h.selectedModel = { id: 'model-a', capabilities: ['tools'] }
    const view = renderComponent()
    expect(screen.getByTestId('project-scope-consent-trigger')).toBeInTheDocument()
    expect(screen.queryByTestId('project-scope-unsupported')).not.toBeInTheDocument()
    view.unmount()
    h.selectedModel = { id: 'model-b', capabilities: [] }
    renderComponent()
    expect(screen.queryByTestId('project-scope-consent-trigger')).not.toBeInTheDocument()
  })

  it('states a truthful unsupported reason without refusing ordinary direct chat', () => {
    h.selectedModel = { id: 'model-b', capabilities: [] }
    renderComponent()
    const notice = screen.getByTestId('project-scope-unsupported')
    expect(notice).toHaveTextContent('common:conversationScope.unsupported')
    expect(notice).not.toHaveTextContent('common:conversationScope.pendingKept')
    expect(notice).toHaveAttribute('role', 'status')
    expect(notice).toHaveAttribute('aria-live', 'polite')
    const input = screen.getByTestId('chat-input')
    expect(input).not.toHaveAttribute('data-has-prepare')
    fireEvent.click(screen.getByTestId('submit'))
    expect(h.startCoworkConversation).not.toHaveBeenCalled()
  })

  it('passes prepareThreadCreation only for an elevated draft, applying it through the strict setter', async () => {
    h.selectedModel = { id: 'model-a', capabilities: ['tools'] }
    h.prepareOutcome = undefined
    renderComponent()
    expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-has-prepare')
    fireEvent.click(screen.getByTestId('project-scope-consent-trigger'))
    fireEvent.click(
      await screen.findByLabelText('Allow shell commands to access the network')
    )
    expect(screen.getByTestId('chat-input')).toHaveAttribute('data-has-prepare', 'true')
    fireEvent.click(screen.getByTestId('invoke-prepare'))
    await waitFor(() =>
      expect(h.setCaps).toHaveBeenCalledExactlyOnceWith('created-thread', {
        version: 1,
        folderScope: null,
        shellNetwork: true,
        memoryWrite: false,
      })
    )
    expect(h.prepareOutcome).toBe(true)
  })

  it('an elevated draft hidden by a non-tools model cannot apply and resurfaces visibly pending', async () => {
    const Component = Route.component as React.ComponentType
    h.selectedModel = { id: 'model-a', capabilities: ['tools'] }
    const view = renderComponent()
    fireEvent.click(screen.getByTestId('project-scope-consent-trigger'))
    fireEvent.click(
      await screen.findByLabelText('Allow shell commands to access the network')
    )
    expect(screen.getByTestId('chat-input')).toHaveAttribute('data-has-prepare', 'true')
    // A non-tools model hides the consent UI and removes the prepare path.
    h.selectedModel = { id: 'model-b', capabilities: [] }
    view.rerender(<Component />)
    expect(screen.queryByTestId('project-scope-consent-trigger')).not.toBeInTheDocument()
    expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-has-prepare')
    // The hidden pending draft is announced, not silently dropped.
    expect(screen.getByTestId('project-scope-unsupported')).toHaveTextContent(
      'common:conversationScope.pendingKept'
    )
    // Back on a tool-capable model the draft resurfaces explicitly pending.
    h.selectedModel = { id: 'model-a', capabilities: ['tools'] }
    view.rerender(<Component />)
    expect(screen.getByTestId('project-scope-consent-trigger')).toHaveTextContent(
      'Conversation permissions (pending)'
    )
    expect(screen.getByTestId('chat-input')).toHaveAttribute('data-has-prepare', 'true')
  })

  it('switching projects under the same mounted component resets the draft synchronously', async () => {
    const Component = Route.component as React.ComponentType
    h.selectedModel = { id: 'model-a', capabilities: ['tools'] }
    const view = renderComponent()
    fireEvent.click(screen.getByTestId('project-scope-consent-trigger'))
    fireEvent.click(
      await screen.findByLabelText('Allow shell commands to access the network')
    )
    expect(screen.getByTestId('chat-input')).toHaveAttribute('data-has-prepare', 'true')
    // Same component instance, new project param: project A's elevated draft
    // must not survive into project B even for one committed render.
    h.projectId = 'project-2'
    view.rerender(<Component />)
    expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-has-prepare')
    expect(screen.getByTestId('project-scope-consent-trigger')).toHaveTextContent(
      /^Conversation permissions$/
    )
    fireEvent.click(screen.getByTestId('invoke-prepare'))
    expect(h.setCaps).not.toHaveBeenCalled()
  })

})
