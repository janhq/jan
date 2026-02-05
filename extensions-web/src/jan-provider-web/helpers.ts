import type { JanModel } from './store'
import { MODEL_PROVIDER_STORAGE_KEY } from './const'

type StoredModel = {
  id?: string
  capabilities?: unknown
  [key: string]: unknown
}

type StoredProvider = {
  provider?: string
  models?: StoredModel[]
  [key: string]: unknown
}

type StoredState = {
  state?: {
    providers?: StoredProvider[]
    [key: string]: unknown
  }
  version?: number
  [key: string]: unknown
}

const normalizeCapabilities = (capabilities: unknown): string[] => {
  if (!Array.isArray(capabilities)) {
    return []
  }

  return [...new Set(capabilities.filter((item): item is string => typeof item === 'string'))].sort(
    (a, b) => a.localeCompare(b)
  )
}

/**
 * Synchronize Jan models stored in localStorage with the latest server state.
 * Returns true if the stored data was modified (including being cleared).
 */
export function syncJanModelsLocalStorage(
  remoteModels: JanModel[],
  storageKey: string = MODEL_PROVIDER_STORAGE_KEY
): boolean {
  const rawStorage = localStorage.getItem(storageKey)
  if (!rawStorage) {
    return false
  }

  let storedState: StoredState
  try {
    storedState = JSON.parse(rawStorage) as StoredState
  } catch (error) {
    console.warn('Failed to parse Jan model storage; clearing entry.', error)
    localStorage.removeItem(storageKey)
    return true
  }

  const providers = storedState?.state?.providers
  if (!Array.isArray(providers)) {
    return false
  }

  const remoteModelMap = new Map(remoteModels.map((model) => [model.id, model]))
  let storageUpdated = false

  for (const provider of providers) {
    if (provider.provider !== 'jan' || !Array.isArray(provider.models)) {
      continue
    }

    const updatedModels: StoredModel[] = []

    for (const model of provider.models) {
      const modelId = typeof model.id === 'string' ? model.id : null
      if (!modelId) {
        storageUpdated = true
        continue
      }

      const remoteModel = remoteModelMap.get(modelId)
      if (!remoteModel) {
        console.log(`Removing unknown Jan model from localStorage: ${modelId}`)
        storageUpdated = true
        continue
      }

      const storedCapabilities = normalizeCapabilities(model.capabilities)
      const remoteCapabilities = normalizeCapabilities(remoteModel.capabilities)

      const capabilitiesMatch =
        storedCapabilities.length === remoteCapabilities.length &&
        storedCapabilities.every((cap, index) => cap === remoteCapabilities[index])

      if (!capabilitiesMatch) {
        console.log(
          `Updating capabilities for Jan model ${modelId}:`,
          storedCapabilities,
          '=>',
          remoteCapabilities
        )
        updatedModels.push({
          ...model,
          capabilities: remoteModel.capabilities,
        })
        storageUpdated = true
      } else {
        updatedModels.push(model)
      }
    }

    if (updatedModels.length !== provider.models.length) {
      storageUpdated = true
    }

    provider.models = updatedModels
  }

  if (storageUpdated) {
    localStorage.setItem(storageKey, JSON.stringify(storedState))
  }

  return storageUpdated
}
