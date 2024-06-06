import { ImportingModel, Model, ModelStatus } from '@janhq/core'
import { atom } from 'jotai'

import { activeThreadAtom, threadsAtom } from './Thread.atom'

export const stateModel = atom({ state: 'start', loading: false, model: '' })
export const activeAssistantModelAtom = atom<Model | undefined>(undefined)

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

export const defaultModelAtom = atom<Model | undefined>(undefined)

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

const selectedModelAtom = atom<Model | undefined>(undefined)

export const getSelectedModelAtom = atom((get) => get(selectedModelAtom))

export const updateSelectedModelAtom = atom(null, (get, set, model: Model) => {
  const activeThread = get(activeThreadAtom)
  if (activeThread) {
    activeThread.assistants[0].model = model.id
    // update threadsAtom
    const allThreads = get(threadsAtom)
    allThreads.forEach((t) => {
      if (t.id === activeThread.id) {
        t.assistants[0].model = model.id
      }
    })
    console.debug(
      `Update threads state list: ${JSON.stringify(allThreads, null, 2)}`
    )
    set(threadsAtom, allThreads)
  }
  console.debug('Set selected model:', JSON.stringify(model, null, 2))
  set(selectedModelAtom, model)
})

export const activeModelsAtom = atom<ModelStatus[]>([])
