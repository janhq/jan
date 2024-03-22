import { ImportingModel, Model } from '@janhq/core'
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

export const removeDownloadedModelAtom = atom(
  null,
  (get, set, modelId: string) => {
    const downloadedModels = get(downloadedModelsAtom)

    set(
      downloadedModelsAtom,
      downloadedModels.filter((e) => e.id !== modelId)
    )
  }
)

export const configuredModelsAtom = atom<Model[]>([])

/// TODO: move this part to another atom
// store the paths of the models that are being imported
export const importingModelsAtom = atom<ImportingModel[]>([])

export const updateImportingModelProgressAtom = atom(
  null,
  (get, set, importId: string, percentage: number) => {
    const model = get(importingModelsAtom).find((x) => x.importId === importId)
    if (!model) return
    const newModel: ImportingModel = {
      ...model,
      status: 'IMPORTING',
      percentage,
    }
    const newList = get(importingModelsAtom).map((x) =>
      x.importId === importId ? newModel : x
    )
    set(importingModelsAtom, newList)
  }
)

export const setImportingModelErrorAtom = atom(
  null,
  (get, set, importId: string, error: string) => {
    const model = get(importingModelsAtom).find((x) => x.importId === importId)
    if (!model) return
    const newModel: ImportingModel = {
      ...model,
      status: 'FAILED',
    }

    console.error(`Importing model ${model} failed`, error)
    const newList = get(importingModelsAtom).map((m) =>
      m.importId === importId ? newModel : m
    )
    set(importingModelsAtom, newList)
  }
)

export const setImportingModelSuccessAtom = atom(
  null,
  (get, set, importId: string, modelId: string) => {
    const model = get(importingModelsAtom).find((x) => x.importId === importId)
    if (!model) return
    const newModel: ImportingModel = {
      ...model,
      modelId,
      status: 'IMPORTED',
      percentage: 1,
    }
    const newList = get(importingModelsAtom).map((x) =>
      x.importId === importId ? newModel : x
    )
    set(importingModelsAtom, newList)
  }
)

export const updateImportingModelAtom = atom(
  null,
  (
    get,
    set,
    importId: string,
    name: string,
    description: string,
    tags: string[]
  ) => {
    const model = get(importingModelsAtom).find((x) => x.importId === importId)
    if (!model) return
    const newModel: ImportingModel = {
      ...model,
      name,
      importId,
      description,
      tags,
    }
    const newList = get(importingModelsAtom).map((x) =>
      x.importId === importId ? newModel : x
    )
    set(importingModelsAtom, newList)
  }
)
