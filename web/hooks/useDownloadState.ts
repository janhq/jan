import { DownloadState } from '@janhq/core'
import { atom } from 'jotai'

import { toaster } from '@/containers/Toast'

import {
  configuredModelsAtom,
  downloadedModelsAtom,
  removeDownloadingModelAtom,
} from '@/helpers/atoms/Model.atom'

// download states
export const modelDownloadStateAtom = atom<Record<string, DownloadState>>({})

/**
 * Used to set the download state for a particular model.
 */
export const setDownloadStateAtom = atom(
  null,
  (get, set, state: DownloadState) => {
    try {
      const currentState = { ...get(modelDownloadStateAtom) }

      if (state.downloadState === 'end') {
        const modelDownloadState = currentState[state.modelId]

        const updatedChildren: DownloadState[] = (
          modelDownloadState.children ?? []
        ).filter((m) => m.fileName !== state.fileName)
        updatedChildren.push(state)
        modelDownloadState.children = updatedChildren
        currentState[state.modelId] = modelDownloadState

        const isAllChildrenDownloadEnd = modelDownloadState.children?.every(
          (m) => m.downloadState === 'end'
        )

        if (isAllChildrenDownloadEnd) {
          // download successfully
          delete currentState[state.modelId]
          set(removeDownloadingModelAtom, state.modelId)

          const model = get(configuredModelsAtom).find(
            (e) => e.id === state.modelId
          )
          if (model) set(downloadedModelsAtom, (prev) => [...prev, model])
          toaster({
            title: 'Download Completed',
            description: `Download ${state.modelId} completed`,
            type: 'success',
          })
        }
      } else if (state.downloadState === 'error') {
        // download error
        delete currentState[state.modelId]
        set(removeDownloadingModelAtom, state.modelId)
        if (state.error === 'aborted') {
          toaster({
            title: 'Cancel Download',
            description: `Model ${state.modelId} download cancelled`,
            type: 'warning',
          })
        } else {
          let error = state.error
          if (
            typeof error?.includes === 'function' &&
            state.error?.includes('certificate')
          ) {
            error +=
              '. To fix enable "Ignore SSL Certificates" in Advanced settings.'
          }
          toaster({
            title: 'Download Failed',
            description: `Model ${state.modelId} download failed: ${error}`,
            type: 'error',
          })
        }
      } else {
        // download in progress
        if (state.size.total === 0 || !currentState[state.modelId]) {
          // this is initial state, just set the state
          currentState[state.modelId] = state
          set(modelDownloadStateAtom, currentState)
          return
        }

        const modelDownloadState = currentState[state.modelId]
        if (!modelDownloadState) {
          console.debug('setDownloadStateAtom: modelDownloadState not found')
          return
        }

        // delete the children if the filename is matched and replace the new state
        const updatedChildren: DownloadState[] = (
          modelDownloadState.children ?? []
        ).filter((m) => m.fileName !== state.fileName)

        updatedChildren.push(state)

        // re-calculate the overall progress if we have all the children download data
        const isAnyChildDownloadNotReady = updatedChildren.some(
          (m) =>
            m.size.total === 0 &&
            !modelDownloadState.children?.some(
              (e) => e.fileName === m.fileName && e.downloadState === 'end'
            ) &&
            modelDownloadState.children?.some((e) => e.fileName === m.fileName)
        )

        modelDownloadState.children = updatedChildren

        if (isAnyChildDownloadNotReady) {
          // just update the children
          currentState[state.modelId] = modelDownloadState
          set(modelDownloadStateAtom, currentState)
          return
        }

        const parentTotalSize = updatedChildren.reduce(
          (acc, m) => acc + m.size.total,
          0
        )
        // calculate the total transferred size by sum all children transferred size
        const transferredSize = updatedChildren.reduce(
          (acc, m) => acc + m.size.transferred,
          0
        )
        modelDownloadState.size.transferred = transferredSize

        modelDownloadState.percent =
          parentTotalSize === 0 ? 0 : transferredSize / parentTotalSize
        currentState[state.modelId] = modelDownloadState
      }

      set(modelDownloadStateAtom, currentState)
    } catch (e) {
      console.debug('setDownloadStateAtom: state', state)
      console.debug('setDownloadStateAtom: error', e)
    }
  }
)
