/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  coworkEnabled: false,
  providers: [] as any[],
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
  useServiceHub: () => ({ dialog: () => ({ open: vi.fn() }) }),
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
  useModelProvider: () => ({ providers: h.providers }),
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: () => ({ setCurrentThreadId: h.setCurrentThreadId }),
}))

vi.mock('@/hooks/useTools', () => ({
  useTools: h.useTools,
}))

vi.mock('@/containers/ChatInput', () => ({
  default: ({ model, initialMessage, onSubmit, surfaceControls }: any) => (
    <div data-testid="chat-input" data-initial={String(initialMessage)}>
      {model ? model.id : 'no-model'}
      <div data-testid="surface-controls">{surfaceControls}</div>
      <button
        data-testid="submit"
        onClick={() => (onSubmit ?? (() => {}))('do the thing', undefined, undefined, 'do the thing')}
      />
    </div>
  ),
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
    expect(screen.getByTestId('dropdown')).toBeInTheDocument()
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

  it('passes threadModel from search into DropdownModelProvider and ChatInput', () => {
    h.providers = [{ provider: 'openai', models: [] }]
    h.providerHasRemoteApiKeys.mockReturnValue(true)
    h.search = { threadModel: { id: 'gpt-x', provider: 'openai' } }
    renderComponent()
    expect(screen.getByTestId('dropdown')).toHaveTextContent('gpt-x')
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

    it('Cowork mode shows the folder control and the ideas', () => {
      h.coworkEnabled = true
      useHomeMode.setState({ mode: 'cowork' })
      renderComponent()
      expect(screen.getByTestId('home-cowork-folder')).toBeInTheDocument()
      expect(screen.getByText('common:homeMode.ideas')).toBeInTheDocument()
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
