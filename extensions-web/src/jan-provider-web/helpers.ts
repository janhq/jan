import type { JanModel } from './types'
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

const deriveCategoryFromModelId = (modelId: string): string => {
  if (modelId.includes('/')) {
    const [maybeCategory] = modelId.split('/')
    return maybeCategory || 'uncategorized'
  }
  return 'uncategorized'
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

export interface GroupedModels {
  category: string
  categoryOrderNumber: number
  models: JanModel[]
}

/**
 * Groups models by category and sorts them by category_order_number.
 * Within each category, models are sorted by model_order_number.
 * 
 * @param models - Array of JanModel objects to group and sort
 * @returns Array of GroupedModels, sorted by category_order_number
 */
export function groupModelsByCategory(models: JanModel[]): GroupedModels[] {
  // Group models by category
  const categoryMap = new Map<string, JanModel[]>()

  for (const model of models) {
    const category = model.category ?? deriveCategoryFromModelId(model.id)
    if (!categoryMap.has(category)) {
      categoryMap.set(category, [])
    }
    categoryMap.get(category)!.push(model)
  }

  // Convert to array and sort categories
  const groupedModels: GroupedModels[] = Array.from(categoryMap.entries()).map(
    ([category, categoryModels]) => {
      // Sort models within category by model_order_number
      const sortedModels = [...categoryModels].sort((a, b) => {
        const orderA = a.model_order_number ?? Number.MAX_SAFE_INTEGER
        const orderB = b.model_order_number ?? Number.MAX_SAFE_INTEGER
        return orderA - orderB
      })

      // Get category order number from first model (all models in same category should have same value)
      const categoryOrderNumber = categoryModels[0]?.category_order_number ?? Number.MAX_SAFE_INTEGER

      return {
        category,
        categoryOrderNumber,
        models: sortedModels,
      }
    }
  )

  // Sort categories by category_order_number
  groupedModels.sort((a, b) => a.categoryOrderNumber - b.categoryOrderNumber)

  return groupedModels
}

