/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  pickFolder: vi.fn(),
  coworkEnabled: false,
  providers: [] as any[],
  selectedModel: undefined as Model | undefined,
  selectedProvider: '',
  search: { threadModel: undefined as any },
  setCurrentThreadId: vi.fn(),
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

vi.mock('@/hooks/useThreads', () => ({
  useThreads: () => ({ setCurrentThreadId: h.setCurrentThreadId }),
}))

vi.mock('@/hooks/useTools', () => ({
  useTools: h.useTools,
}))

vi.mock('@/containers/ChatInput', () => ({
  default: ({ model, initialMessage, onSubmit, surfaceControls, leadingControls, menuWorkspace, menuControls, projectId }: any) => (
    <div data-testid="chat-input" data-initial={String(initialMessage)} data-project-id={projectId}>
      {model ? model.id : 'no-model'}
      <div data-testid="menu-workspace">{menuWorkspace}</div>
      <div data-testid="menu-controls">{menuControls}</div>
      <div data-testid="surface-controls">{leadingControls}{surfaceControls}</div>
      <button
        data-testid="submit"
        onClick={() => (onSubmit ?? (() => {}))('do the thing', undefined, undefined, 'do the thing')}
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

import { Route } from '../index'
import { useHomeMode } from '@/hooks/useHomeMode'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { COWORK_HANDOFF_PREFIX } from '@/lib/coworkHandoff'

const renderComponent = () => {
  const Component = Route.component as React.ComponentType
  return render(<Component />)
}

describe('Index route', () => {
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
      expect(picker.parentElement?.parentElement).toHaveClass('pt-2')
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
