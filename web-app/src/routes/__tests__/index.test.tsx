/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  pickFolder: vi.fn(),
  coworkEnabled: false,
  providers: [] as any[],
  selectedModel: undefined as Model | undefined,
  selectedProvider: '',
  search: { threadModel: undefined as any },
  setCurrentThreadId: vi.fn(),
  setCaps: vi.fn(async () => undefined),
  prepareOutcome: undefined as unknown,
  useTools: vi.fn(),
  providerHasRemoteApiKeys: vi.fn(() => false),
  predefinedProviders: [
    { provider: 'openai' },
    { provider: 'llamacpp' },
    { provider: 'jan' },
  ],
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => ({ ...config, id: '/' }),
  useSearch: () => h.search,
  useNavigate: () => h.navigate,
}))

vi.mock('@/lib/version', () => ({ isCoworkEnabled: () => h.coworkEnabled }))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({ dialog: () => ({ open: h.pickFolder }) }),
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
    providers: h.providers,
    selectedModel: h.selectedModel,
    selectedProvider: h.selectedProvider,
  }),
}))

vi.mock('@/hooks/useThreads', () => {
  const useThreads = () => ({ setCurrentThreadId: h.setCurrentThreadId })
  ;(useThreads as any).getState = () => ({
    setConversationCapabilities: h.setCaps,
  })
  return { useThreads }
})

vi.mock('@/hooks/useTools', () => ({
  useTools: h.useTools,
}))

vi.mock('@/containers/ChatInput', () => ({
  default: ({ model, initialMessage, onSubmit, surfaceControls, leadingControls, menuWorkspace, menuControls, projectId, scopeKey, prepareThreadCreation }: any) => (
    <div data-testid="chat-input" data-initial={String(initialMessage)} data-project-id={projectId} data-scope-key={scopeKey} data-has-prepare={prepareThreadCreation ? 'true' : undefined}>
      {model ? model.id : 'no-model'}
      <div data-testid="menu-workspace">{menuWorkspace}</div>
      <div data-testid="menu-controls">{menuControls}</div>
      <div data-testid="surface-controls">{leadingControls}{surfaceControls}</div>
      <button
        data-testid="submit"
        onClick={() => (onSubmit ?? (() => {}))('do the thing', undefined, undefined, 'do the thing')}
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

vi.mock('@/containers/CoworkComposerMenu', () => ({
  CoworkComposerMenu: ({ onAttachFolder, onSelectProject, onAddProject }: any) => <>
    <button onClick={onAttachFolder}>Menu folder</button>
    <button onClick={() => onSelectProject({ id: 'project-1', name: 'Project' })}>Menu project</button>
    <button onClick={onAddProject}>Menu new project</button>
  </>,
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: any) => <div data-testid="header-page">{children}</div>,
}))

vi.mock('@/containers/DropdownModelProvider', () => ({
  default: ({ model }: any) => (
    <div data-testid="dropdown">{model ? model.id : 'none'}</div>
  ),
}))

vi.mock('@/containers/SetupScreen', () => ({
  default: () => <div data-testid="setup-screen" />,
}))

vi.mock('@/lib/utils', () => ({
  cn: (...c: any[]) => c.filter(Boolean).join(' '),
}))

vi.mock('@/lib/provider-api-keys', () => ({
  providerHasRemoteApiKeys: (p: any) => h.providerHasRemoteApiKeys(p),
}))

vi.mock('@/constants/providers', () => ({
  predefinedProviders: h.predefinedProviders,
}))

vi.mock('@/constants/routes', () => ({
  route: { home: '/', coworkSession: '/cowork/$sessionId' },
}))

vi.mock('@/containers/dialogs/AddProjectDialog', () => ({ default: () => null }))
vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: () => ({ addFolder: vi.fn(), folders: [] }),
}))

import { useChatAttachments, NEW_THREAD_ATTACHMENT_KEY } from '@/hooks/useChatAttachments'
import { Route } from '../index'
import { useHomeMode } from '@/hooks/useHomeMode'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { COWORK_HANDOFF_PREFIX } from '@/lib/coworkHandoff'

const renderComponent = () => {
  const Component = Route.component as React.ComponentType
  return render(<Component />)
}

describe('Index route', () => {
  // A failed assertion between replaceState calls must not leak
  // ?temporary-chat=true into later tests.
  afterEach(() => {
    window.history.replaceState({}, '', '/')
  })
  beforeEach(() => {
    vi.clearAllMocks()
    h.providers = []
    h.selectedModel = undefined
    h.selectedProvider = ''
    h.search = { threadModel: undefined }
    h.providerHasRemoteApiKeys.mockReturnValue(false)
    h.coworkEnabled = false
    h.navigate.mockClear()
    sessionStorage.clear()
    useHomeMode.setState({ mode: 'chat' })
    useChatAttachments.setState({ attachmentsByThread: {} })
    useCoworkSessions.setState({ sessions: [], currentId: null })
  })

  it('validateSearch returns threadModel from search params', () => {
    const tm = { id: 'm1', provider: 'p1' }
    const result = (Route as any).validateSearch({ threadModel: tm })
    expect(result.threadModel).toEqual(tm)
  })

  it('validateSearch handles missing threadModel', () => {
    const result = (Route as any).validateSearch({})
    expect(result.threadModel).toBeUndefined()
  })

  it('renders SetupScreen when no valid providers exist', () => {
    h.providers = []
    renderComponent()
    expect(screen.getByTestId('setup-screen')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-input')).not.toBeInTheDocument()
  })

  it('renders SetupScreen when predefined provider has no api key and no models', () => {
    h.providers = [{ provider: 'openai', models: [] }]
    h.providerHasRemoteApiKeys.mockReturnValue(false)
    renderComponent()
    expect(screen.getByTestId('setup-screen')).toBeInTheDocument()
  })

  it('renders chat UI when predefined provider has api key', () => {
    h.providers = [{ provider: 'openai', models: [] }]
    h.providerHasRemoteApiKeys.mockReturnValue(true)
    renderComponent()
    expect(screen.getByTestId('chat-input')).toBeInTheDocument()
    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.queryByTestId('dropdown')).not.toBeInTheDocument()
    expect(screen.getByText('chat:description')).toBeInTheDocument()
  })

  it('renders chat UI when llamacpp provider has models', () => {
    h.providers = [{ provider: 'llamacpp', models: [{ id: 'x' }] }]
    h.providerHasRemoteApiKeys.mockReturnValue(false)
    renderComponent()
    expect(screen.getByTestId('chat-input')).toBeInTheDocument()
  })

  it('renders chat UI when jan provider has models', () => {
    h.providers = [{ provider: 'jan', models: [{ id: 'j' }] }]
    renderComponent()
    expect(screen.getByTestId('chat-input')).toBeInTheDocument()
  })

  it('renders chat UI for custom provider with models, no api key required', () => {
    h.providers = [{ provider: 'custom-xyz', models: [{ id: 'c' }] }]
    renderComponent()
    expect(screen.getByTestId('chat-input')).toBeInTheDocument()
  })

  it('renders SetupScreen for custom provider with no models', () => {
    h.providers = [{ provider: 'custom-xyz', models: [] }]
    renderComponent()
    expect(screen.getByTestId('setup-screen')).toBeInTheDocument()
  })

  it('passes threadModel to the composer without a header model picker', () => {
    h.providers = [{ provider: 'openai', models: [] }]
    h.providerHasRemoteApiKeys.mockReturnValue(true)
    h.search = { threadModel: { id: 'gpt-x', provider: 'openai' } }
    renderComponent()
    expect(screen.queryByTestId('dropdown')).not.toBeInTheDocument()
    expect(screen.getByTestId('chat-input')).toHaveTextContent('gpt-x')
    expect(screen.getByTestId('chat-input')).toHaveAttribute('data-initial', 'true')
  })

  it('calls setCurrentThreadId(undefined) and useTools on mount', () => {
    h.providers = [{ provider: 'openai', models: [] }]
    h.providerHasRemoteApiKeys.mockReturnValue(true)
    renderComponent()
    expect(h.setCurrentThreadId).toHaveBeenCalledWith(undefined)
    expect(h.useTools).toHaveBeenCalled()
  })

  describe('Chat | Cowork selector', () => {
    beforeEach(() => {
      h.providers = [{ provider: 'llamacpp', models: [{ id: 'x' }] }]
    })

    it('keeps attachments in one home draft when switching existing workflows', async () => {
      h.coworkEnabled = true
      const image = { type: 'image', name: 'fixture.png' } as any
      const document = { type: 'document', name: 'fixture.txt' } as any
      useChatAttachments.getState().setAttachments(NEW_THREAD_ATTACHMENT_KEY, [image, document])
      renderComponent()
      expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-scope-key')
      fireEvent.click(screen.getByTestId('home-mode-cowork'))
      expect(screen.getByTestId('home-mode-cowork')).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-scope-key')
      expect(useChatAttachments.getState().getAttachments(NEW_THREAD_ATTACHMENT_KEY)).toEqual([image, document])
      expect(screen.getAllByTestId('chat-input')).toHaveLength(1)
    })

    it('removes the folder without losing project intent and discloses writable scope', async () => {
      h.coworkEnabled = true
      h.pickFolder.mockResolvedValue('/synthetic/workspace')
      renderComponent()
      fireEvent.click(screen.getByTestId('home-mode-cowork'))
      fireEvent.click(screen.getByRole('button', { name: 'Menu folder' }))
      await screen.findByText('workspace')
      fireEvent.click(screen.getByRole('button', { name: 'Menu project' }))
      expect(screen.getByRole('status')).toHaveTextContent('common:conversationScope.writable')
      await userEvent.click(screen.getByTestId('home-cowork-folder'))
      fireEvent.click(await screen.findByText('common:homeMode.removeFolder'))
      fireEvent.click(screen.getByTestId('home-mode-chat'))
      expect(screen.getByTestId('chat-input')).toHaveAttribute('data-project-id', 'project-1')
    })

    it('offers draft conversation permissions only for a tool-capable model in chat mode', () => {
      h.selectedModel = { id: 'model-a', capabilities: ['tools'] } as any
      h.coworkEnabled = true
      const view = renderComponent()
      expect(screen.getByTestId('home-scope-consent-trigger')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('home-mode-cowork'))
      expect(screen.queryByTestId('home-scope-consent-trigger')).not.toBeInTheDocument()
      view.unmount()
      useHomeMode.setState({ mode: 'chat' })
      h.selectedModel = { id: 'model-b', capabilities: [] } as any
      renderComponent()
      expect(screen.queryByTestId('home-scope-consent-trigger')).not.toBeInTheDocument()
    })

    it('passes prepareThreadCreation only for an elevated draft, applying it through the strict setter', async () => {
      h.selectedModel = { id: 'model-a', capabilities: ['tools'] } as any
      h.prepareOutcome = undefined
      renderComponent()
      expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-has-prepare')
      fireEvent.click(screen.getByTestId('home-scope-consent-trigger'))
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

    it('temporary mode hides the draft consent entirely and passes no prepare path', async () => {
      const Component = Route.component as React.ComponentType
      h.selectedModel = { id: 'model-a', capabilities: ['tools'] } as any
      const view = renderComponent()
      fireEvent.click(screen.getByTestId('home-scope-consent-trigger'))
      fireEvent.click(
        await screen.findByLabelText('Allow shell commands to access the network')
      )
      expect(screen.getByTestId('chat-input')).toHaveAttribute('data-has-prepare', 'true')
      // Temporary mode: no consent control at all, not even a draft, and no
      // prepare path — an ordinary temporary scratch send cannot be refused
      // by a hidden stale grant.
      window.history.replaceState({}, '', '/?temporary-chat=true')
      view.rerender(<Component />)
      expect(screen.queryByTestId('home-scope-consent-trigger')).not.toBeInTheDocument()
      expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-has-prepare')
      // Leaving temporary mode resurfaces the preserved draft, explicitly pending.
      window.history.replaceState({}, '', '/')
      view.rerender(<Component />)
      expect(screen.getByTestId('home-scope-consent-trigger')).toHaveTextContent(
        'Conversation permissions (pending)'
      )
      expect(screen.getByTestId('chat-input')).toHaveAttribute('data-has-prepare', 'true')
    })

    it('an elevated draft hidden by a mode switch cannot apply and resurfaces visibly pending', async () => {
      h.selectedModel = { id: 'model-a', capabilities: ['tools'] } as any
      h.coworkEnabled = true
      renderComponent()
      fireEvent.click(screen.getByTestId('home-scope-consent-trigger'))
      fireEvent.click(
        await screen.findByLabelText('Allow shell commands to access the network')
      )
      expect(screen.getByTestId('chat-input')).toHaveAttribute('data-has-prepare', 'true')
      // Hidden in cowork mode: no consent UI and no prepare path at all.
      fireEvent.click(screen.getByTestId('home-mode-cowork'))
      expect(screen.queryByTestId('home-scope-consent-trigger')).not.toBeInTheDocument()
      expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-has-prepare')
      // Switching back resurfaces the draft with an explicit pending label.
      fireEvent.click(screen.getByTestId('home-mode-chat'))
      expect(screen.getByTestId('home-scope-consent-trigger')).toHaveTextContent(
        'Conversation permissions (pending)'
      )
      expect(screen.getByTestId('chat-input')).toHaveAttribute('data-has-prepare', 'true')
    })

    it('is hidden where Cowork is not available', () => {
      h.coworkEnabled = false
      renderComponent()
      expect(screen.queryByTestId('home-mode-toggle')).not.toBeInTheDocument()
    })

    it('is shown where Cowork is available, defaulting to Chat with no Cowork extras', () => {
      h.coworkEnabled = true
      renderComponent()
      expect(screen.getByTestId('home-mode-toggle')).toBeInTheDocument()
      expect(screen.getByTestId('home-mode-chat')).toHaveAttribute('aria-checked', 'true')
      expect(screen.queryByTestId('home-cowork-folder')).not.toBeInTheDocument()
    })

    it('associates the Chat draft with its visibly selected project without a folder action', () => {
      renderComponent()
      fireEvent.click(screen.getByRole('button', { name: 'Menu project' }))
      expect(screen.getByTestId('chat-input')).toHaveAttribute('data-project-id', 'project-1')
      expect(screen.getByTestId('home-chat-project')).toHaveTextContent('Project')
      expect(screen.queryByTestId('home-cowork-folder')).not.toBeInTheDocument()
      expect(useCoworkSessions.getState().sessions).toHaveLength(0)
      fireEvent.click(screen.getByTestId('submit'))
      expect(screen.getByTestId('chat-input')).toHaveAttribute('data-project-id', 'project-1')
      fireEvent.click(screen.getByRole('button', { name: 'common:homeMode.removeFolder' }))
      expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-project-id')
      expect(screen.queryByTestId('home-chat-project')).not.toBeInTheDocument()
    })

    it('keeps workspace actions draft-only until submission, alongside the workspace picker', async () => {
      h.coworkEnabled = true
      h.pickFolder.mockResolvedValue('/tmp/workspace')
      useHomeMode.setState({ mode: 'cowork' })
      renderComponent()
      expect(screen.getByTestId('home-cowork-folder')).toBeInTheDocument()
      expect(screen.getByTestId('menu-controls')).toBeEmptyDOMElement()
      fireEvent.click(screen.getByRole('button', { name: 'Menu folder' }))
      await screen.findByText('workspace')
      fireEvent.click(screen.getByRole('button', { name: 'Menu project' }))
      expect(useCoworkSessions.getState().sessions).toHaveLength(0)
      fireEvent.click(screen.getByTestId('submit'))
      const [session] = useCoworkSessions.getState().sessions
      expect(session.folder).toBe('/tmp/workspace')
      expect(session.project).toEqual({ id: 'project-1', name: 'Project' })
    })

    it('Cowork mode shows the folder control and the ideas', () => {
      h.coworkEnabled = true
      useHomeMode.setState({ mode: 'cowork' })
      renderComponent()
      expect(screen.getByTestId('home-cowork-folder')).toBeInTheDocument()
      expect(screen.getByText('common:homeMode.ideas')).toBeInTheDocument()
    })

    it('places the workspace below and outside the composer before ideas', () => {
      h.coworkEnabled = true
      useHomeMode.setState({ mode: 'cowork' })
      renderComponent()
      const picker = screen.getByTestId('home-cowork-folder')
      const composer = screen.getByTestId('chat-input')
      const ideas = screen.getByText('common:homeMode.ideas')
      expect(composer.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(composer).not.toContainElement(picker)
      expect(picker.compareDocumentPosition(ideas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(screen.getByRole('region', { name: 'common:conversationScope.label' }).parentElement).toHaveClass('pt-2')
      expect(screen.getByTestId('surface-controls')).toContainElement(screen.getByTestId('home-mode-toggle'))
    })

    it('submitting in Cowork mode creates a session, hands off the prompt and opens its URL', () => {
      h.coworkEnabled = true
      useHomeMode.setState({ mode: 'cowork' })
      renderComponent()
      fireEvent.click(screen.getByTestId('submit'))
      const [session] = useCoworkSessions.getState().sessions
      expect(session).toBeTruthy()
      expect(JSON.parse(sessionStorage.getItem(`${COWORK_HANDOFF_PREFIX}${session.id}`)!).text).toBe('do the thing')
      expect(h.navigate).toHaveBeenCalledWith({
        to: '/cowork/$sessionId',
        params: { sessionId: session.id },
      })
    })

    it('uses the current model selection instead of the initial URL model on Cowork submit', () => {
      h.coworkEnabled = true
      useHomeMode.setState({ mode: 'cowork' })
      h.search = { threadModel: { id: 'model-a', provider: 'provider-a' } }
      h.selectedModel = { id: 'model-a' }
      h.selectedProvider = 'provider-a'
      const { rerender } = renderComponent()

      // The picker initialized A from the URL, then the user manually picked B.
      h.selectedModel = { id: 'model-b' }
      h.selectedProvider = 'provider-b'
      const Component = Route.component as React.ComponentType
      rerender(<Component />)
      fireEvent.click(screen.getByTestId('submit'))

      expect(useCoworkSessions.getState().sessions[0].model).toEqual({
        id: 'model-b', provider: 'provider-b',
      })
    })

    it('keeps the initialized URL model when it is still selected on Cowork submit', () => {
      h.coworkEnabled = true
      useHomeMode.setState({ mode: 'cowork' })
      h.search = { threadModel: { id: 'model-a', provider: 'provider-a' } }
      h.selectedModel = { id: 'model-a' }
      h.selectedProvider = 'provider-a'
      renderComponent()
      fireEvent.click(screen.getByTestId('submit'))
      expect(useCoworkSessions.getState().sessions[0].model).toEqual(h.search.threadModel)
    })

    it('falls back to the URL model when no current model is selected', () => {
      h.coworkEnabled = true
      useHomeMode.setState({ mode: 'cowork' })
      h.search = { threadModel: { id: 'model-a', provider: 'provider-a' } }
      renderComponent()
      fireEvent.click(screen.getByTestId('submit'))
      expect(useCoworkSessions.getState().sessions[0].model).toEqual(h.search.threadModel)
    })

    it('leaves the Cowork model unset without a current selection or URL model', () => {
      h.coworkEnabled = true
      useHomeMode.setState({ mode: 'cowork' })
      renderComponent()
      fireEvent.click(screen.getByTestId('submit'))
      expect(useCoworkSessions.getState().sessions[0].model).toBeUndefined()
    })

    it('ignores a stored Cowork mode where Cowork is not available', () => {
      h.coworkEnabled = false
      useHomeMode.setState({ mode: 'cowork' })
      renderComponent()
      fireEvent.click(screen.getByTestId('submit'))
      expect(h.navigate).not.toHaveBeenCalled()
      expect(useCoworkSessions.getState().sessions).toHaveLength(0)
    })
  })
})
