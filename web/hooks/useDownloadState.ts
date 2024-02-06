import { atom } from 'jotai'

import { toaster } from '@/containers/Toast'

import { removeDownloadingModelAtom } from '@/helpers/atoms/Model.atom'

// download states
export const modelDownloadStateAtom = atom<Record<string, DownloadState>>({})

/**
 * Used to set the download state for a particular model.
 */
export const setDownloadStateAtom = atom(
  null,
  (get, set, state: DownloadState) => {
    const currentState = { ...get(modelDownloadStateAtom) }

    if (state.downloadState === 'end') {
      // download successfully
      delete currentState[state.modelId]
      set(removeDownloadingModelAtom, state.modelId)
      toaster({
        title: 'Download Completed',
        description: `Download ${state.modelId} completed`,
        type: 'success',
      })
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
        if (state.error?.includes('certificate')) {
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
      currentState[state.modelId] = state
    }

    set(modelDownloadStateAtom, currentState)
  }
)
