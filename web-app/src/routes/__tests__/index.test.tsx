/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
  setCaps: vi.fn(async () => undefined),
  prepareOutcome: undefined as unknown,
  toastError: vi.fn(),
  toastInfo: vi.fn(),
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
  useLocation: (opts: any) => opts.select({ searchStr: window.location.search }),
}))

vi.mock('@/lib/version', () => ({ isCoworkEnabled: () => h.coworkEnabled }))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({ dialog: () => ({ open: h.pickFolder }) }),
}))
vi.mock('sonner', () => ({
  toast: {
    error: (...args: any[]) => h.toastError(...args),
    info: (...args: any[]) => h.toastInfo(...args),
  },
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
    <div data-testid="chat-input" data-initial={String(initialMessage)} data-project-id={projectId} data-scope-key={scopeKey} data-has-prepare={prepareThreadCreation ? 'true' : undefined} data-has-onsubmit={onSubmit ? 'true' : undefined}>
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

import { Route } from '../index'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'

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

  describe('Single home flow', () => {
    beforeEach(() => {
      h.providers = [{ provider: 'llamacpp', models: [{ id: 'x' }] }]
    })

    it('shows no mode selector and an ordinary submit never starts a legacy Cowork session', () => {
      // Even where Cowork is available: the home composer is one Chat flow.
      h.coworkEnabled = true
      renderComponent()
      expect(screen.queryByTestId('home-mode-toggle')).not.toBeInTheDocument()
      const input = screen.getByTestId('chat-input')
      // No onSubmit override: ChatInput keeps its own create-thread send path.
      expect(input).not.toHaveAttribute('data-has-onsubmit')
      expect(input).not.toHaveAttribute('data-scope-key')
      fireEvent.click(screen.getByTestId('submit'))
      expect(useCoworkSessions.getState().sessions).toHaveLength(0)
      expect(h.navigate).not.toHaveBeenCalled()
    })

    it('offers draft conversation permissions only for a tool-capable model', () => {
      h.selectedModel = { id: 'model-a', capabilities: ['tools'] } as any
      const view = renderComponent()
      expect(screen.getByTestId('home-scope-consent-trigger')).toBeInTheDocument()
      expect(screen.queryByTestId('home-scope-unsupported')).not.toBeInTheDocument()
      view.unmount()
      h.selectedModel = { id: 'model-b', capabilities: [] } as any
      renderComponent()
      expect(screen.queryByTestId('home-scope-consent-trigger')).not.toBeInTheDocument()
    })

    it('states a truthful unsupported reason without refusing ordinary direct chat', () => {
      h.selectedModel = { id: 'model-b', capabilities: [] } as any
      renderComponent()
      const notice = screen.getByTestId('home-scope-unsupported')
      expect(notice).toHaveTextContent('common:conversationScope.unsupported')
      expect(notice).not.toHaveTextContent('common:conversationScope.pendingKept')
      // Live attributes live on the persistent wrapper only, never doubled.
      const region = screen.getByTestId('home-scope-status')
      expect(region).toHaveAttribute('role', 'status')
      expect(region).toHaveAttribute('aria-live', 'polite')
      expect(region).toContainElement(notice)
      expect(notice).not.toHaveAttribute('role')
      expect(notice).not.toHaveAttribute('aria-live')
      // The composer stays fully usable: no send-time refusal, no prepare
      // path, no hidden session start for a one-call non-tool model.
      const input = screen.getByTestId('chat-input')
      expect(input).not.toHaveAttribute('data-has-onsubmit')
      expect(input).not.toHaveAttribute('data-has-prepare')
      fireEvent.click(screen.getByTestId('submit'))
      expect(useCoworkSessions.getState().sessions).toHaveLength(0)
    })

    it('keeps the live region mounted and updates only its inner text', async () => {
      const Component = Route.component as React.ComponentType
      h.selectedModel = { id: 'model-a', capabilities: ['tools'] } as any
      const view = renderComponent()
      const region = screen.getByTestId('home-scope-status')
      expect(region).toBeEmptyDOMElement()
      fireEvent.click(screen.getByTestId('home-scope-consent-trigger'))
      fireEvent.click(
        await screen.findByLabelText('Allow shell commands to access the network')
      )
      // Unsupported model: text appears INSIDE the same mounted region node.
      h.selectedModel = { id: 'model-b', capabilities: [] } as any
      view.rerender(<Component />)
      expect(screen.getByTestId('home-scope-status')).toBe(region)
      expect(region).toHaveTextContent('common:conversationScope.unsupported')
      expect(region).toHaveTextContent('common:conversationScope.pendingKept')
      // Supported again: same node, text removed, region still mounted.
      h.selectedModel = { id: 'model-a', capabilities: ['tools'] } as any
      view.rerender(<Component />)
      expect(screen.getByTestId('home-scope-status')).toBe(region)
      expect(region).toBeEmptyDOMElement()
      expect(region.querySelectorAll('[aria-live],[role="status"]')).toHaveLength(0)
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
      // The control disappears with a persistent explanation; the elevated draft
      // is stated as kept, and temporary tools are never enabled.
      expect(screen.getByTestId('home-scope-unsupported')).toHaveTextContent(
        'common:conversationScope.temporary common:conversationScope.pendingKept'
      )
      // Leaving temporary mode resurfaces the preserved draft, explicitly pending.
      window.history.replaceState({}, '', '/')
      view.rerender(<Component />)
      expect(screen.getByTestId('home-scope-consent-trigger')).toHaveTextContent(
        'Conversation permissions (pending)'
      )
      expect(screen.getByTestId('chat-input')).toHaveAttribute('data-has-prepare', 'true')
    })

    it('no selected model shows no unsupported notice, keeps the control hidden and prepare off, then resurfaces the pending draft', async () => {
      const Component = Route.component as React.ComponentType
      h.selectedModel = { id: 'model-a', capabilities: ['tools'] } as any
      const view = renderComponent()
      expect(screen.queryByTestId('home-scope-unsupported')).not.toBeInTheDocument()
      fireEvent.click(screen.getByTestId('home-scope-consent-trigger'))
      fireEvent.click(
        await screen.findByLabelText('Allow shell commands to access the network')
      )
      expect(screen.getByTestId('chat-input')).toHaveAttribute('data-has-prepare', 'true')
      // No model selected yet: not a "model without tools", so no false notice.
      h.selectedModel = undefined
      view.rerender(<Component />)
      expect(screen.queryByTestId('home-scope-unsupported')).not.toBeInTheDocument()
      expect(screen.queryByTestId('home-scope-consent-trigger')).not.toBeInTheDocument()
      expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-has-prepare')
      h.selectedModel = { id: 'model-a', capabilities: ['tools'] } as any
      view.rerender(<Component />)
      expect(screen.getByTestId('home-scope-consent-trigger')).toHaveTextContent(
        'Conversation permissions (pending)'
      )
      expect(screen.getByTestId('chat-input')).toHaveAttribute('data-has-prepare', 'true')
    })

    it('announces a hidden pending draft when the model loses tool support', async () => {
      const Component = Route.component as React.ComponentType
      h.selectedModel = { id: 'model-a', capabilities: ['tools'] } as any
      const view = renderComponent()
      fireEvent.click(screen.getByTestId('home-scope-consent-trigger'))
      fireEvent.click(
        await screen.findByLabelText('Allow shell commands to access the network')
      )
      h.selectedModel = { id: 'model-b', capabilities: [] } as any
      view.rerender(<Component />)
      expect(screen.getByTestId('home-scope-unsupported')).toHaveTextContent(
        'common:conversationScope.pendingKept'
      )
      expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-has-prepare')
    })

    it.each(['/?x-temporary-chat=true', '/?temporary-chat=truex', '/?temporary-chat=false', '/?temporary-chat=false&temporary-chat=false', '/?other=temporary-chat%3Dtrue'])(
      'does not treat %s as temporary mode',
      (url) => {
        h.selectedModel = { id: 'model-a', capabilities: ['tools'] } as any
        window.history.replaceState({}, '', url)
        renderComponent()
        expect(screen.getByTestId('home-scope-consent-trigger')).toBeInTheDocument()
      }
    )

    it.each([
      '/?temporary%2Dchat=true',
      '/?temporary-chat=%74rue',
      '/?temporary-chat=false&temporary-chat=true',
      '/?temporary-chat=true&temporary-chat=false',
      '/?temporary-chat=true&temporary-chat=true',
    ])(
      'treats %s as temporary mode',
      (url) => {
        h.selectedModel = { id: 'model-a', capabilities: ['tools'] } as any
        window.history.replaceState({}, '', url)
        renderComponent()
        expect(screen.queryByTestId('home-scope-consent-trigger')).not.toBeInTheDocument()
      }
    )

    it('temporary mode keeps the workspace folder action grant-free with a truthful note', async () => {
      h.selectedModel = { id: 'model-a', capabilities: ['tools'] } as any
      window.history.replaceState({}, '', '/?temporary-chat=true')
      renderComponent()
      fireEvent.click(screen.getByRole('button', { name: 'Menu folder' }))
      await waitFor(() =>
        expect(h.toastInfo).toHaveBeenCalledWith('common:conversationScope.temporary')
      )
      expect(h.pickFolder).not.toHaveBeenCalled()
      expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-has-prepare')
    })

    it('routes the workspace folder action through the consent draft as a read-only narrow grant', async () => {
      h.selectedModel = { id: 'model-a', capabilities: ['tools'] } as any
      h.pickFolder.mockResolvedValue('/synthetic/workspace')
      renderComponent()
      expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-has-prepare')
      fireEvent.click(screen.getByRole('button', { name: 'Menu folder' }))
      await waitFor(() =>
        expect(screen.getByTestId('chat-input')).toHaveAttribute('data-has-prepare', 'true')
      )
      // No legacy Session was started: the folder is a pending Chat grant.
      expect(useCoworkSessions.getState().sessions).toHaveLength(0)
      expect(screen.getByTestId('home-scope-consent-trigger')).toHaveTextContent(
        'Conversation permissions (pending)'
      )
      expect(h.toastInfo).toHaveBeenCalledExactlyOnceWith(
        'common:conversationScope.folderSelected'
      )
      fireEvent.click(screen.getByTestId('home-scope-consent-trigger'))
      expect(await screen.findByText('Read only: /synthetic/workspace')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('invoke-prepare'))
      await waitFor(() =>
        expect(h.setCaps).toHaveBeenCalledExactlyOnceWith('created-thread', {
          version: 1,
          folderScope: { path: '/synthetic/workspace', access: 'read' },
          shellNetwork: false,
          memoryWrite: false,
        })
      )
    })

    it('folder pick toast describes only the selected path: no stale replacement claim, same path or changed draft', async () => {
      h.selectedModel = { id: 'model-a', capabilities: ['tools'] } as any
      renderComponent()
      h.pickFolder.mockResolvedValue('/synthetic/one')
      fireEvent.click(screen.getByRole('button', { name: 'Menu folder' }))
      await waitFor(() => expect(h.toastInfo).toHaveBeenCalledTimes(1))
      // Re-pick the SAME path: identical descriptive note, never "replaced".
      fireEvent.click(screen.getByRole('button', { name: 'Menu folder' }))
      await waitFor(() => expect(h.toastInfo).toHaveBeenCalledTimes(2))
      // Pick a different path while an older one is pending.
      h.pickFolder.mockResolvedValue('/synthetic/two')
      fireEvent.click(screen.getByRole('button', { name: 'Menu folder' }))
      await waitFor(() => expect(h.toastInfo).toHaveBeenCalledTimes(3))
      expect(h.toastInfo.mock.calls.map((c: any[]) => c[0])).toEqual([
        'common:conversationScope.folderSelected',
        'common:conversationScope.folderSelected',
        'common:conversationScope.folderSelected',
      ])
      expect(h.toastInfo.mock.calls[2]).toEqual(['common:conversationScope.folderSelected'])
      expect(JSON.stringify(h.toastInfo.mock.calls)).not.toContain('folderReplaced')
      // The read-only grant for the last pick is what gets applied.
      fireEvent.click(screen.getByTestId('invoke-prepare'))
      await waitFor(() =>
        expect(h.setCaps).toHaveBeenCalledExactlyOnceWith('created-thread', {
          version: 1,
          folderScope: { path: '/synthetic/two', access: 'read' },
          shellNetwork: false,
          memoryWrite: false,
        })
      )
    })

    it('a draft edit made while the picker is open is kept, with no stale-closure decision', async () => {
      h.selectedModel = { id: 'model-a', capabilities: ['tools'] } as any
      let release: (path: string) => void = () => {}
      h.pickFolder.mockImplementation(
        () => new Promise<string>((resolve) => { release = resolve })
      )
      renderComponent()
      fireEvent.click(screen.getByRole('button', { name: 'Menu folder' }))
      fireEvent.click(screen.getByTestId('home-scope-consent-trigger'))
      fireEvent.click(
        await screen.findByLabelText('Allow shell commands to access the network')
      )
      release('/synthetic/late')
      await waitFor(() => expect(h.toastInfo).toHaveBeenCalledTimes(1))
      fireEvent.click(screen.getByTestId('invoke-prepare'))
      await waitFor(() =>
        expect(h.setCaps).toHaveBeenCalledExactlyOnceWith('created-thread', {
          version: 1,
          folderScope: { path: '/synthetic/late', access: 'read' },
          shellNetwork: true,
          memoryWrite: false,
        })
      )
    })

    it('denies an unsupported folder path on both folder entry points and grants nothing', async () => {
      h.selectedModel = { id: 'model-a', capabilities: ['tools'] } as any
      h.pickFolder.mockResolvedValue('not-absolute')
      renderComponent()
      fireEvent.click(screen.getByRole('button', { name: 'Menu folder' }))
      await waitFor(() =>
        expect(h.toastError).toHaveBeenCalledWith('common:conversationScope.invalidFolder')
      )
      expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-has-prepare')
      fireEvent.click(screen.getByTestId('home-scope-consent-trigger'))
      fireEvent.click(await screen.findByRole('button', { name: 'Choose folder to read' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'This folder path is not supported. Choose another folder.'
      )
      expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-has-prepare')
      fireEvent.click(screen.getByTestId('invoke-prepare'))
      expect(h.setCaps).not.toHaveBeenCalled()
    })

    it('explains instead of silently ignoring the folder action for a non-tool model', async () => {
      h.selectedModel = { id: 'model-b', capabilities: [] } as any
      renderComponent()
      fireEvent.click(screen.getByRole('button', { name: 'Menu folder' }))
      await waitFor(() =>
        expect(h.toastInfo).toHaveBeenCalledWith('common:conversationScope.folderUnsupported')
      )
      expect(h.pickFolder).not.toHaveBeenCalled()
      expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-has-prepare')
    })

    it('asks for a model instead of the unsupported-model toast when none is selected, without picker or grant', async () => {
      h.selectedModel = undefined as any
      renderComponent()
      fireEvent.click(screen.getByRole('button', { name: 'Menu folder' }))
      await waitFor(() =>
        expect(h.toastInfo).toHaveBeenCalledWith('common:conversationScope.folderSelectModel')
      )
      expect(h.toastInfo).not.toHaveBeenCalledWith('common:conversationScope.folderUnsupported')
      expect(h.pickFolder).not.toHaveBeenCalled()
      expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-has-prepare')
      fireEvent.click(screen.getByTestId('invoke-prepare'))
      expect(h.setCaps).not.toHaveBeenCalled()
    })

    it('keeps the temporary notice when temporary mode has no selected model', async () => {
      h.selectedModel = undefined as any
      window.history.replaceState({}, '', '/?temporary-chat=true')
      renderComponent()
      fireEvent.click(screen.getByRole('button', { name: 'Menu folder' }))
      await waitFor(() =>
        expect(h.toastInfo).toHaveBeenCalledWith('common:conversationScope.temporary')
      )
      expect(h.toastInfo).not.toHaveBeenCalledWith('common:conversationScope.folderSelectModel')
      expect(h.pickFolder).not.toHaveBeenCalled()
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
      fireEvent.click(screen.getByRole('button', { name: 'common:conversationScope.removeProject' }))
      expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-project-id')
      expect(screen.queryByTestId('home-chat-project')).not.toBeInTheDocument()
    })
  })
})
