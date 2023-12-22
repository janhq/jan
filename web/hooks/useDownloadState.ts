import { ExtensionType, ModelExtension, Model } from '@janhq/core'
import { atom, useSetAtom, useAtomValue } from 'jotai'

import { toaster } from '@/containers/Toast'

import { downloadedModelsAtom } from './useGetDownloadedModels'

import { extensionManager } from '@/extension'

// download states
export const modelDownloadStateAtom = atom<Record<string, DownloadState>>({})

export const downloadingModelsAtom = atom<Model[]>([])

export const getDownloadingModelAtom = atom((get) => get(downloadingModelsAtom))

export const addNewDownloadingModelAtom = atom(
  null,
  (get, set, model: Model) => {
    console.debug('addNewDownloadingModelAtom', JSON.stringify(model))
    set(downloadingModelsAtom, [...get(downloadingModelsAtom), model])
  }
)

export const setDownloadStateAtom = atom(
  null,
  (get, set, state: DownloadState) => {
    const currentState = { ...get(modelDownloadStateAtom) }
    console.debug(
      `current download state for ${state.modelId} is ${JSON.stringify(state)}`
    )
    currentState[state.modelId] = state
    set(modelDownloadStateAtom, currentState)
  }
)

export const onDownloadUpdateAtom = atom(
  null,
  (get, set, newState: DownloadState) => {
    const currentStates = { ...get(modelDownloadStateAtom) }

    for (const key of Object.keys(currentStates)) {
      const downloadState = currentStates[key]
      if (downloadState.children) {
        let totalSize = 0
        let totalTransferred = 0
        let totalSpeed = 0
        let elapsed = 0
        let remaining = 0

        for (let i = 0; i < downloadState.children.length; i++) {
          if (downloadState.children[i].modelId === newState.modelId) {
            downloadState.children[i] = newState
          }
          totalSize += downloadState.children[i].size.total
          totalTransferred += downloadState.children[i].size.transferred
          totalSpeed += downloadState.children[i].speed

          elapsed = Math.max(elapsed, downloadState.children[i].time.elapsed)
          remaining = Math.max(
            remaining,
            downloadState.children[i].time.remaining
          )
        }

        currentStates[key] = {
          ...downloadState,
          percent: totalTransferred / totalSize,
          size: { total: totalSize, transferred: totalTransferred },
          speed: totalSpeed,
          time: {
            elapsed,
            remaining,
          },
        }
        set(modelDownloadStateAtom, currentStates)
      }
    }
  }
)

export const onDownloadSuccessAtom = atom(
  null,
  (get, set, fileName: string) => {
    const allDownloadStates = { ...get(modelDownloadStateAtom) }
    console.debug(`onDownloadSuccessAtom filename: ${fileName}`)
    for (const key of Object.keys(allDownloadStates)) {
      const downloadState = allDownloadStates[key]
      if (downloadState.children) {
        // if all of the children are completed, then we can mark the parent as completed
        for (let i = 0; i < downloadState.children.length; i++) {
          if (downloadState.children[i].modelId === fileName) {
            downloadState.children[i] = {
              ...downloadState.children[i],
              isFinished: true,
            }
            break
          }
        }

        let isAllChildrenDownloaded = true
        for (const childDownloadState of downloadState.children) {
          if (!childDownloadState.isFinished) {
            isAllChildrenDownloaded = false
            break
          }
        }

        if (isAllChildrenDownloaded) {
          const model: Model | undefined = get(getDownloadingModelAtom).find(
            (m) => m.id === key
          )

          if (!model) {
            return
          }

          // add to downloaded models
          set(downloadedModelsAtom, [...get(downloadedModelsAtom), model])

          // update json file
          extensionManager
            .get<ModelExtension>(ExtensionType.Model)
            ?.saveModel(model)

          toaster({
            title: 'Download Completed',
            description: `Download ${model.id} completed`,
          })
          delete allDownloadStates[key]
          set(modelDownloadStateAtom, allDownloadStates)
        } else {
          // just update the state
          allDownloadStates[key] = downloadState
          set(modelDownloadStateAtom, allDownloadStates)
        }
      }
    }
  }
)

export const onDownloadFailedAtom = atom(null, (get, set, fileName: string) => {
  console.debug(`onDownloadFailedAtom filename: ${fileName}`)
  const allDownloadStates = { ...get(modelDownloadStateAtom) }

  let modelId: string | undefined = undefined
  for (const key of Object.keys(allDownloadStates)) {
    const downloadState = allDownloadStates[key]
    if (downloadState.children) {
      for (let i = 0; i < downloadState.children.length; i++) {
        if (downloadState.children[i].modelId === fileName) {
          modelId = key
          break
        }
      }
    }
  }

  if (!modelId) {
    return
  }

  delete allDownloadStates[modelId]
  set(modelDownloadStateAtom, allDownloadStates)

  set(
    downloadingModelsAtom,
    [...get(downloadingModelsAtom)].filter((m) => m.id !== modelId)
  )

  toaster({
    title: 'Download cancelled',
    description: `Download ${modelId} has been cancelled!`,
  })
})

export function useDownloadState() {
  const modelDownloadState = useAtomValue(modelDownloadStateAtom)
  const setDownloadState = useSetAtom(setDownloadStateAtom)

  const downloadStates: DownloadState[] = []
  for (const [, value] of Object.entries(modelDownloadState)) {
    downloadStates.push(value)
  }

  return {
    modelDownloadStateAtom,
    modelDownloadState,
    setDownloadState,
    downloadStates,
  }
}
