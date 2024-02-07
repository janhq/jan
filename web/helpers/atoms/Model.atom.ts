import { Model } from '@janhq/core'
import { atom } from 'jotai'

export const stateModel = atom({ state: 'start', loading: false, model: '' })
export const activeAssistantModelAtom = atom<Model | undefined>(undefined)

export const downloadingModelsAtom = atom<Model[]>([])

export const addNewDownloadingModelAtom = atom(
  null,
  (get, set, model: Model) => {
    const currentModels = get(downloadingModelsAtom)
    set(downloadingModelsAtom, [...currentModels, model])
  }
)

export const removeDownloadingModelAtom = atom(
  null,
  (get, set, modelId: string) => {
    const currentModels = get(downloadingModelsAtom)
    set(
      downloadingModelsAtom,
      currentModels.filter((e) => e.id !== modelId)
    )
  }
)

export const downloadedModelsAtom = atom<Model[]>([])

export const configuredModelsAtom = atom<Model[]>([])
