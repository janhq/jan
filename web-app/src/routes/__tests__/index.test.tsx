/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'

const h = vi.hoisted(() => ({
  providers: [] as any[],
  search: { threadModel: undefined as any },
  setCurrentThreadId: vi.fn(),
  useTools: vi.fn(),
  providerHasConfiguredRemoteAuth: vi.fn(() => false),
  predefinedProviders: [
    { provider: 'openai' },
    { provider: 'llamacpp' },
    { provider: 'jan' },
  ],
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => ({ ...config, id: '/' }),
  useSearch: () => h.search,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
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
  default: ({ model, initialMessage }: any) => (
    <div data-testid="chat-input" data-initial={String(initialMessage)}>
      {model ? model.id : 'no-model'}
    </div>
  ),
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: any) => (
    <div data-testid="header-page">{children}</div>
  ),
}))

vi.mock('@/containers/DropdownModelProvider', () => ({
  default: ({ model }: any) => (
    <div data-testid="dropdown">{model ? model.id : 'none'}</div>
  ),
}))

vi.mock('@/containers/ModelToolsPanel', () => ({
  WorkspacePanelsLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="workspace-panels">{children}</div>
  ),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...c: any[]) => c.filter(Boolean).join(' '),
}))

vi.mock('@/lib/provider-api-keys', () => ({
  providerHasConfiguredRemoteAuth: (p: any) => h.providerHasConfiguredRemoteAuth(p),
}))

vi.mock('@/constants/providers', () => ({
  predefinedProviders: h.predefinedProviders,
}))

vi.mock('@/constants/routes', () => ({
  route: {
    home: '/',
    settings: {
      model_providers: '/settings/providers',
    },
  },
}))

import { Route } from '../index'

const renderComponent = () => {
  const Component = Route.component as React.ComponentType
  return render(<Component />)
}

describe('Index route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.providers = []
    h.search = { threadModel: undefined }
    h.providerHasConfiguredRemoteAuth.mockReturnValue(false)
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

  it('renders chat UI when no valid providers exist', () => {
    h.providers = []
    renderComponent()
    expect(screen.getByTestId('chat-input')).toBeInTheDocument()
    expect(
      screen.getByText('No model provider is set up yet.')
    ).toBeInTheDocument()
  })

  it('renders chat UI when predefined provider has no api key and no models', () => {
    h.providers = [{ provider: 'openai', models: [] }]
    h.providerHasConfiguredRemoteAuth.mockReturnValue(false)
    renderComponent()
    expect(screen.getByTestId('chat-input')).toBeInTheDocument()
    expect(
      screen.getByText('No model provider is set up yet.')
    ).toBeInTheDocument()
  })

  it('renders chat UI when predefined provider has api key', () => {
    h.providers = [{ provider: 'openai', models: [] }]
    h.providerHasConfiguredRemoteAuth.mockReturnValue(true)
    renderComponent()
    expect(screen.getByTestId('chat-input')).toBeInTheDocument()
    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('dropdown')).toBeInTheDocument()
    expect(screen.getByText('chat:description')).toBeInTheDocument()
  })

  it('renders chat UI when llamacpp provider has models', () => {
    h.providers = [{ provider: 'llamacpp', models: [{ id: 'x' }] }]
    h.providerHasConfiguredRemoteAuth.mockReturnValue(false)
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

  it('renders chat UI for custom provider with no models', () => {
    h.providers = [{ provider: 'custom-xyz', models: [] }]
    renderComponent()
    expect(screen.getByTestId('chat-input')).toBeInTheDocument()
    expect(
      screen.getByText('No model provider is set up yet.')
    ).toBeInTheDocument()
  })

  it('passes threadModel from search into DropdownModelProvider and ChatInput', () => {
    h.providers = [{ provider: 'openai', models: [] }]
    h.providerHasConfiguredRemoteAuth.mockReturnValue(true)
    h.search = { threadModel: { id: 'gpt-x', provider: 'openai' } }
    renderComponent()
    expect(screen.getByTestId('dropdown')).toHaveTextContent('gpt-x')
    expect(screen.getByTestId('chat-input')).toHaveTextContent('gpt-x')
    expect(screen.getByTestId('chat-input')).toHaveAttribute(
      'data-initial',
      'true'
    )
  })

  it('calls setCurrentThreadId(undefined) and useTools on mount', () => {
    h.providers = [{ provider: 'openai', models: [] }]
    h.providerHasConfiguredRemoteAuth.mockReturnValue(true)
    renderComponent()
    expect(h.setCurrentThreadId).toHaveBeenCalledWith(undefined)
    expect(h.useTools).toHaveBeenCalled()
  })
})
