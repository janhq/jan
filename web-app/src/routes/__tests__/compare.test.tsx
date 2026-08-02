import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

type MockModel = { id: string; name?: string; embedding?: boolean }
type MockProvider = { provider: string; active?: boolean; models?: MockModel[] }

let mockProviders: MockProvider[] = []

// createFileRoute is a no-op wrapper in tests so we can render Route.component directly.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    (config: { component: React.ComponentType }) => ({ ...config, id: '/compare' }),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => ({ providers: mockProviders }),
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="header-page">{children}</div>
  ),
}))

// Mocked so the route module can import them without pulling in Tauri / the AI SDK.
vi.mock('@/lib/model-factory', () => ({
  ModelFactory: { createModel: vi.fn() },
}))
vi.mock('ai', () => ({ streamText: vi.fn() }))

import { Route } from '../compare'

const renderCompare = () => {
  const Component = Route.component as React.ComponentType
  return render(<Component />)
}

describe('Compare route', () => {
  beforeEach(() => {
    mockProviders = []
    vi.clearAllMocks()
  })

  it('shows an empty state when no models are available', () => {
    renderCompare()
    expect(screen.getByText(/no models available yet/i)).toBeInTheDocument()
  })

  it('lists models across active providers and exposes the run modes', () => {
    mockProviders = [
      {
        provider: 'lmstudio',
        active: true,
        models: [
          { id: 'qwen3-4b', name: 'Qwen3 4B' },
          { id: 'nomic-embed', name: 'Embed', embedding: true },
        ],
      },
      { provider: 'openrouter', active: true, models: [{ id: 'gpt-4o', name: 'GPT-4o' }] },
    ]
    renderCompare()

    // models from multiple backends are selectable
    expect(screen.getByRole('button', { name: /Qwen3 4B/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /GPT-4o/ })).toBeInTheDocument()
    // embedding models are excluded
    expect(screen.queryByRole('button', { name: /Embed/ })).not.toBeInTheDocument()
    // execution modes
    expect(screen.getByRole('button', { name: 'By backend' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Concurrent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sequential' })).toBeInTheDocument()
  })

  it('excludes inactive providers from the picker', () => {
    mockProviders = [
      { provider: 'off', active: false, models: [{ id: 'x', name: 'Hidden' }] },
    ]
    renderCompare()
    expect(screen.queryByRole('button', { name: /Hidden/ })).not.toBeInTheDocument()
    expect(screen.getByText(/no models available yet/i)).toBeInTheDocument()
  })

  it('toggles a model selection on click', () => {
    mockProviders = [
      { provider: 'lmstudio', active: true, models: [{ id: 'qwen3-4b', name: 'Qwen3 4B' }] },
    ]
    renderCompare()
    expect(screen.getAllByText(/\(0 selected\)/).length).toBeGreaterThan(0)

    const btn = screen.getByRole('button', { name: /Qwen3 4B/ })
    expect(btn.className).not.toMatch(/border-accent/)
    fireEvent.click(btn)
    expect(btn.className).toMatch(/border-accent/)
    expect(screen.getAllByText(/\(1 selected\)/).length).toBeGreaterThan(0)
  })
})
