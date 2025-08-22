import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useProviderModels } from '../useProviderModels'

// Mock the providers service
vi.mock('@/services/providers', () => ({
  fetchModelsFromProvider: vi.fn(),
}))

import { fetchModelsFromProvider } from '@/services/providers'
const mockFetchModelsFromProvider = vi.mocked(fetchModelsFromProvider)

import type { ModelProvider } from '@/types/modelProviders'

// Mock ModelProvider type
type MockModelProvider = Pick<
  ModelProvider,
  'active' | 'provider' | 'base_url' | 'api_key' | 'settings' | 'models'
>

describe('useProviderModels', () => {
  const mockProvider: MockModelProvider = {
    active: true,
    provider: 'openai',
    base_url: 'https://api.openai.com/v1',
    api_key: 'test-api-key',
    settings: [],
    models: [],
  }

  const mockModels = ['gpt-4', 'gpt-3.5-turbo', 'gpt-4-turbo']

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should initialize with empty state', () => {
    const { result } = renderHook(() => useProviderModels())

    expect(result.current.models).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe(null)
    expect(typeof result.current.refetch).toBe('function')
  })

  it('should not fetch models when provider is undefined', () => {
    renderHook(() => useProviderModels(undefined))
    expect(mockFetchModelsFromProvider).not.toHaveBeenCalled()
  })

  it('should not fetch models when provider has no base_url', () => {
    const providerWithoutUrl = { ...mockProvider, base_url: undefined }
    renderHook(() => useProviderModels(providerWithoutUrl))
    expect(mockFetchModelsFromProvider).not.toHaveBeenCalled()
  })

  it('should fetch and sort models', async () => {
    mockFetchModelsFromProvider.mockResolvedValueOnce(mockModels)

    const { result } = renderHook(() => useProviderModels(mockProvider))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Should be sorted alphabetically
    expect(result.current.models).toEqual(['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo'])
    expect(result.current.error).toBe(null)
    expect(mockFetchModelsFromProvider).toHaveBeenCalledWith(mockProvider)
  })

  it('should clear models when switching to invalid provider', async () => {
    mockFetchModelsFromProvider.mockResolvedValueOnce(mockModels)

    const { result, rerender } = renderHook(
      ({ provider }) => useProviderModels(provider),
      { initialProps: { provider: mockProvider } }
    )

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.models).toEqual(['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo'])

    // Switch to invalid provider
    rerender({ provider: { ...mockProvider, base_url: undefined } })

    expect(result.current.models).toEqual([])
    expect(result.current.error).toBe(null)
    expect(result.current.loading).toBe(false)
  })

  it('should not refetch when provider is undefined', () => {
    const { result } = renderHook(() => useProviderModels(undefined))

    result.current.refetch()

    expect(mockFetchModelsFromProvider).not.toHaveBeenCalled()
  })
})