import { localStorageKey } from '@/constants/localStorage'
import { EMBEDDING_MODEL_ID } from '@/constants/models'
import type { ModelInfo } from '@janhq/core'

// Upstream llama.cpp first: it understands the full Gemma 4 projector set
// (`gemma4uv`/`gemma4ua`) that the turboquant fork doesn't yet carry, so the
// default vision model starts cleanly. TurboQuant (`llamacpp`) stays a
// manual macOS choice. See ADR 2026-06-09 (ATO-116).
const localProviderNames = ['llamacpp-upstream', 'llamacpp', 'mlx'] as const

export const getLastUsedModel = (): {
  provider: string
  model: string
} | null => {
  try {
    const stored = localStorage.getItem(localStorageKey.lastUsedModel)
    return stored ? JSON.parse(stored) : null
  } catch (error) {
    console.debug('Failed to get last used model from localStorage:', error)
    return null
  }
}

function findFirstLocalModel(
  getProviderByName: (name: string) => ModelProvider | undefined
): { model: string; provider: ModelProvider } | null {
  for (const name of localProviderNames) {
    const provider = getProviderByName(name)
    const firstUsable = provider?.models?.find(
      (m) => m.id !== EMBEDDING_MODEL_ID
    )
    if (provider && firstUsable) {
      return { model: firstUsable.id, provider }
    }
  }
  return null
}

// Helper function to determine which model to start
export const getModelToStart = (params: {
  selectedModel?: ModelInfo | null
  selectedProvider?: string | null
  getProviderByName: (name: string) => ModelProvider | undefined
}): { model: string; provider: ModelProvider } | null => {
  const { selectedModel, selectedProvider, getProviderByName } = params

  // Use last used model if available
  const lastUsedModel = getLastUsedModel()
  if (lastUsedModel) {
    const provider = getProviderByName(lastUsedModel.provider)
    if (provider && provider.models.some((m) => m.id === lastUsedModel.model)) {
      return { model: lastUsedModel.model, provider }
    } else {
      const fallback = findFirstLocalModel(getProviderByName)
      if (fallback) return fallback
    }
  }

  // Use selected model if available
  if (selectedModel && selectedProvider) {
    const provider = getProviderByName(selectedProvider)
    if (provider) {
      return { model: selectedModel.id, provider }
    }
  }

  return findFirstLocalModel(getProviderByName)
}
