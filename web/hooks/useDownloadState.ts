import { atom, useSetAtom, useAtomValue } from 'jotai'

import { toaster } from '@/containers/Toast'

// download states
const modelDownloadStateAtom = atom<Record<string, DownloadState>>({})

const setDownloadStateAtom = atom(null, (get, set, state: DownloadState) => {
  const currentState = { ...get(modelDownloadStateAtom) }
  console.debug(
    `current download state for ${state.modelId} is ${JSON.stringify(state)}`
  )
  currentState[state.modelId] = state
  set(modelDownloadStateAtom, currentState)
})

const setDownloadStateSuccessAtom = atom(null, (get, set, modelId: string) => {
  const currentState = { ...get(modelDownloadStateAtom) }
  const state = currentState[modelId]
  if (!state) {
    console.debug(`Cannot find download state for ${modelId}`)
    return
  }
  delete currentState[modelId]
  set(modelDownloadStateAtom, currentState)
  toaster({
    title: 'Download Completed',
    description: `Download ${modelId} completed`,
  })
})

const setDownloadStateFailedAtom = atom(null, (get, set, modelId: string) => {
  const currentState = { ...get(modelDownloadStateAtom) }
  const state = currentState[modelId]
  if (!state) {
    console.debug(`Cannot find download state for ${modelId}`)
    toaster({
      title: 'Cancel Download',
      description: `Model ${modelId} cancel download`,
    })
    return
  }
  delete currentState[modelId]
  set(modelDownloadStateAtom, currentState)
})

export function useDownloadState() {
  const modelDownloadState = useAtomValue(modelDownloadStateAtom)
  const setDownloadState = useSetAtom(setDownloadStateAtom)
  const setDownloadStateSuccess = useSetAtom(setDownloadStateSuccessAtom)
  const setDownloadStateFailed = useSetAtom(setDownloadStateFailedAtom)

  const downloadStates: DownloadState[] = []
  for (const [, value] of Object.entries(modelDownloadState)) {
    downloadStates.push(value)
  }

  return {
    modelDownloadStateAtom,
    modelDownloadState,
    setDownloadState,
    setDownloadStateSuccess,
    setDownloadStateFailed,
    downloadStates,
  }
}
