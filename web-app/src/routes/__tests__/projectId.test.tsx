/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
  // A failed assertion must not leak ?temporary-chat=true into later tests.
  afterEach(() => {
    window.history.replaceState({}, '', '/')
  })
  beforeEach(() => {
    vi.clearAllMocks()
    h.coworkEnabled = false
    h.selectedModel = undefined
    h.selectedProvider = ''
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
    // Live attributes live on the persistent wrapper only, never doubled.
    const region = screen.getByTestId('project-scope-status')
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toContainElement(notice)
    expect(notice).not.toHaveAttribute('role')
    expect(notice).not.toHaveAttribute('aria-live')
    const input = screen.getByTestId('chat-input')
    expect(input).not.toHaveAttribute('data-has-prepare')
    fireEvent.click(screen.getByTestId('submit'))
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it('keeps the live region mounted and updates only its inner text', async () => {
    const Component = Route.component as React.ComponentType
    h.selectedModel = { id: 'model-a', capabilities: ['tools'] }
    const view = renderComponent()
    const region = screen.getByTestId('project-scope-status')
    expect(region).toBeEmptyDOMElement()
    fireEvent.click(screen.getByTestId('project-scope-consent-trigger'))
    fireEvent.click(
      await screen.findByLabelText('Allow shell commands to access the network')
    )
    h.selectedModel = { id: 'model-b', capabilities: [] }
    view.rerender(<Component />)
    expect(screen.getByTestId('project-scope-status')).toBe(region)
    expect(region).toHaveTextContent('common:conversationScope.unsupported')
    expect(region).toHaveTextContent('common:conversationScope.pendingKept')
    expect(region).not.toHaveTextContent('pendingKeptTemporary')
    h.selectedModel = { id: 'model-a', capabilities: ['tools'] }
    view.rerender(<Component />)
    expect(screen.getByTestId('project-scope-status')).toBe(region)
    expect(region).toBeEmptyDOMElement()
    expect(region.querySelectorAll('[aria-live],[role="status"]')).toHaveLength(0)
  })

  it('temporary mode hides draft consent and the prepare path, then resurfaces the pending draft', async () => {
    const Component = Route.component as React.ComponentType
    h.selectedModel = { id: 'model-a', capabilities: ['tools'] }
    const view = renderComponent()
    fireEvent.click(screen.getByTestId('project-scope-consent-trigger'))
    fireEvent.click(
      await screen.findByLabelText('Allow shell commands to access the network')
    )
    expect(screen.getByTestId('chat-input')).toHaveAttribute('data-has-prepare', 'true')
    window.history.replaceState({}, '', '/?temporary-chat=true')
    view.rerender(<Component />)
    expect(screen.queryByTestId('project-scope-consent-trigger')).not.toBeInTheDocument()
    expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-has-prepare')
    // A tool-capable model in temporary mode is not "unsupported", but the
    // hidden control is explained and the elevated draft is stated as kept.
    expect(screen.getByTestId('project-scope-unsupported').textContent).toBe(
      'common:conversationScope.temporary common:conversationScope.pendingKeptTemporary'
    )
    window.history.replaceState({}, '', '/')
    view.rerender(<Component />)
    expect(screen.getByTestId('project-scope-consent-trigger')).toHaveTextContent(
      'Conversation permissions (pending)'
    )
    expect(screen.getByTestId('chat-input')).toHaveAttribute('data-has-prepare', 'true')
  })

  it('temporary mode without an elevated draft shows exactly the temporary note with no pending-kept suffix', () => {
    h.selectedModel = { id: 'model-a', capabilities: ['tools'] }
    window.history.replaceState({}, '', '/?temporary-chat=true')
    renderComponent()
    expect(screen.queryByTestId('project-scope-consent-trigger')).not.toBeInTheDocument()
    expect(screen.getByTestId('project-scope-unsupported').textContent).toBe(
      'common:conversationScope.temporary'
    )
  })

  it('no selected model shows no unsupported notice, keeps the control hidden and prepare off, then resurfaces the pending draft', async () => {
    const Component = Route.component as React.ComponentType
    h.selectedModel = { id: 'model-a', capabilities: ['tools'] }
    const view = renderComponent()
    expect(screen.queryByTestId('project-scope-unsupported')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('project-scope-consent-trigger'))
    fireEvent.click(
      await screen.findByLabelText('Allow shell commands to access the network')
    )
    expect(screen.getByTestId('chat-input')).toHaveAttribute('data-has-prepare', 'true')
    // No model selected yet: not a "model without tools", so no false notice.
    h.selectedModel = undefined
    view.rerender(<Component />)
    expect(screen.queryByTestId('project-scope-unsupported')).not.toBeInTheDocument()
    expect(screen.queryByTestId('project-scope-consent-trigger')).not.toBeInTheDocument()
    expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-has-prepare')
    h.selectedModel = { id: 'model-a', capabilities: ['tools'] }
    view.rerender(<Component />)
    expect(screen.getByTestId('project-scope-consent-trigger')).toHaveTextContent(
      'Conversation permissions (pending)'
    )
    expect(screen.getByTestId('chat-input')).toHaveAttribute('data-has-prepare', 'true')
  })

  it('temporary mode with a non-tools model shows the temporary (not unsupported) notice, then a regular chat preserves the pending draft', async () => {
    const Component = Route.component as React.ComponentType
    h.selectedModel = { id: 'model-a', capabilities: ['tools'] }
    const view = renderComponent()
    fireEvent.click(screen.getByTestId('project-scope-consent-trigger'))
    fireEvent.click(
      await screen.findByLabelText('Allow shell commands to access the network')
    )
    h.selectedModel = { id: 'model-b', capabilities: [] }
    window.history.replaceState({}, '', '/?temporary-chat=true')
    view.rerender(<Component />)
    // Temporary chat never persists consent: the temporary reason (not the
    // unsupported-model one) is shown, with the draft kept, and no prepare path.
    expect(screen.queryByTestId('project-scope-consent-trigger')).not.toBeInTheDocument()
    expect(screen.getByTestId('project-scope-unsupported').textContent).toBe(
      'common:conversationScope.temporary common:conversationScope.pendingKeptTemporary'
    )
    expect(screen.getByTestId('project-scope-unsupported')).not.toHaveTextContent(
      'common:conversationScope.unsupported'
    )
    expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-has-prepare')
    // Switching back to a regular chat still tells the truth about the kept draft.
    window.history.replaceState({}, '', '/')
    view.rerender(<Component />)
    expect(screen.getByTestId('project-scope-unsupported')).toHaveTextContent(
      'common:conversationScope.pendingKept'
    )
    expect(screen.getByTestId('project-scope-unsupported')).not.toHaveTextContent(
      'pendingKeptTemporary'
    )
    expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-has-prepare')
    // And the draft survives to resurface on a tool-capable model.
    h.selectedModel = { id: 'model-a', capabilities: ['tools'] }
    view.rerender(<Component />)
    expect(screen.getByTestId('project-scope-consent-trigger')).toHaveTextContent(
      'Conversation permissions (pending)'
    )
    expect(screen.getByTestId('chat-input')).toHaveAttribute('data-has-prepare', 'true')
  })

  it.each([
    '/?x-temporary-chat=true',
    '/?temporary-chat=truex',
    '/?temporary-chat=false',
    '/?temporary-chat=false&temporary-chat=false',
    '/?other=temporary-chat%3Dtrue',
  ])('does not treat %s as temporary mode', (url) => {
    h.selectedModel = { id: 'model-a', capabilities: ['tools'] }
    window.history.replaceState({}, '', url)
    renderComponent()
    expect(screen.getByTestId('project-scope-consent-trigger')).toBeInTheDocument()
  })

  it.each([
    '/?temporary-chat=true',
    '/?a=1&temporary-chat=true',
    '/?temporary%2Dchat=true',
    '/?temporary-chat=%74rue',
    '/?temporary-chat=false&temporary-chat=true',
    '/?temporary-chat=true&temporary-chat=false',
    '/?temporary-chat=true&temporary-chat=true',
  ])(
    'treats %s as temporary mode exactly',
    (url) => {
      h.selectedModel = { id: 'model-a', capabilities: ['tools'] }
      window.history.replaceState({}, '', url)
      renderComponent()
      expect(screen.queryByTestId('project-scope-consent-trigger')).not.toBeInTheDocument()
      expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-has-prepare')
    }
  )

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
    expect(screen.getByTestId('project-scope-unsupported')).not.toHaveTextContent(
      'pendingKeptTemporary'
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
