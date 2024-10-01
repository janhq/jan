import { ImportingModel, InferenceEngine, Model, ModelFile } from '@janhq/core'
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

/**
 * Enum for the keys used to store models in the local storage.
 */
enum ModelStorageAtomKeys {
  DownloadedModels = 'downloadedModels',
  AvailableModels = 'availableModels',
}
//// Models Atom
/**
 * Downloaded Models Atom
 * This atom stores the list of models that have been downloaded.
 */
export const downloadedModelsAtom = atomWithStorage<ModelFile[]>(
  ModelStorageAtomKeys.DownloadedModels,
  []
)

/**
 * Configured Models Atom
 * This atom stores the list of models that have been configured and available to download
 */
export const configuredModelsAtom = atomWithStorage<ModelFile[]>(
  ModelStorageAtomKeys.AvailableModels,
  []
)

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

/**
 * Atom to store the selected model (from ModelDropdown)
 */
export const selectedModelAtom = atom<ModelFile | undefined>(undefined)

/**
 * Atom to store the expanded engine sections (from ModelDropdown)
 */
export const showEngineListModelAtom = atom<string[]>([InferenceEngine.nitro])

/// End Models Atom
/// Model Download Atom

export const stateModel = atom({ state: 'start', loading: false, model: '' })

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

/// End Model Download Atom
/// Model Import Atom

/// TODO: move this part to another atom
// store the paths of the models that are being imported
export const importingModelsAtom = atom<ImportingModel[]>([])

// DEPRECATED: Remove when moving to cortex.cpp
// Default model template when importing
export const defaultModelAtom = atom<Model | undefined>(undefined)

/**
 * Importing progress Atom
 */
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

/**
 * Importing error Atom
 */
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

/**
 * Importing success Atom
 */
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

/**
 * Update importing model metadata Atom
 */
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

/// End Model Import Atom

/// ModelDropdown States Atom
export const isDownloadALocalModelAtom = atom<boolean>(false)
export const isAnyRemoteModelConfiguredAtom = atom<boolean>(false)
/// End ModelDropdown States Atom
