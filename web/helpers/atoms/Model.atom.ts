import { Model } from '@janhq/core'
import { atom } from 'jotai'

export const stateModel = atom({ state: 'start', loading: false, model: '' })
export const activeAssistantModelAtom = atom<Model | undefined>(undefined)

/**
 * Stores the list of models which are being downloaded.
 */
const downloadingModelsAtom = atom<Model[]>([])

export const getDownloadingModelAtom = atom((get) => get(downloadingModelsAtom))

export const addDownloadingModelAtom = atom(null, (get, set, model: Model) => {
  const downloadingModels = get(downloadingModelsAtom)
  if (!downloadingModels.find((e) => e.id === model.id)) {
    set(downloadingModelsAtom, [...downloadingModels, model])
  }
})

export const removeDownloadingModelAtom = atom(
  null,
  (get, set, modelId: string) => {
    const downloadingModels = get(downloadingModelsAtom)

    set(
      downloadingModelsAtom,
      downloadingModels.filter((e) => e.id !== modelId)
    )
  }
)

export const downloadedModelsAtom = atom<Model[]>([])

export const configuredModelsAtom = atom<Model[]>([])
