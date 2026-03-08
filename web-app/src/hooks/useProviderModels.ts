import { useState, useEffect, useCallback, useRef } from 'react'
import { useServiceHub } from './useServiceHub'

type UseProviderModelsState = {
  models: string[]
  loading: boolean
  error: string | null
  refetch: () => void
}

const modelsCache = new Map<string, { models: string[]; timestamp: number }>()
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

export const useProviderModels = (provider?: ModelProvider): UseProviderModelsState => {
  const serviceHub = useServiceHub()
  const [models, setModels] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const prevProviderKey = useRef<string>('')
  const requestIdRef = useRef(0)

  const fetchModels = useCallback(async () => {
    if (!provider || !provider.base_url) {
      // Clear models if provider is invalid (base_url is required, api_key is optional)
      setModels([])
      setError(null)
      setLoading(false)
      return
    }

    // Clear any previous state when starting a new fetch for a different provider
    const currentProviderKey = `${provider.provider}-${provider.base_url}`
    if (currentProviderKey !== prevProviderKey.current) {
      setModels([])
      setError(null)
      setLoading(false)
      prevProviderKey.current = currentProviderKey
    }

    const cacheKey = `${provider.provider}-${provider.base_url}`
    const cached = modelsCache.get(cacheKey)

    // Check cache first
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      setModels(cached.models)
      return
    }

    const currentRequestId = ++requestIdRef.current
    setLoading(true)
    setError(null)

    try {
      const fetchedModels = await serviceHub.providers().fetchModelsFromProvider(provider)
      if (currentRequestId !== requestIdRef.current) return
      const sortedModels = fetchedModels.sort((a, b) => a.localeCompare(b))

      setModels(sortedModels)

      // Cache the results
      modelsCache.set(cacheKey, {
        models: sortedModels,
        timestamp: Date.now(),
      })
    } catch (err) {
      if (currentRequestId !== requestIdRef.current) return
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch models'
      setError(errorMessage)
      console.error(`Error fetching models from ${provider.provider}:`, err)
    } finally {
      if (currentRequestId === requestIdRef.current) setLoading(false)
    }
  }, [provider, serviceHub])

  const refetch = useCallback(() => {
    if (provider) {
      const cacheKey = `${provider.provider}-${provider.base_url}`
      modelsCache.delete(cacheKey)
      fetchModels()
    }
  }, [provider, fetchModels])

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  return {
    models,
    loading,
    error,
    refetch,
  }
}
