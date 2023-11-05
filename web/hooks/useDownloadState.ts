import { atom, useSetAtom, useAtomValue } from 'jotai'

import { toaster } from '@/containers/Toast'

// download states
const modelDownloadStateAtom = atom<Record<string, DownloadState>>({})

const setDownloadStateAtom = atom(null, (get, set, state: DownloadState) => {
  const currentState = { ...get(modelDownloadStateAtom) }
  console.debug(
    `current download state for ${state.fileName} is ${JSON.stringify(state)}`
  )
  currentState[state.fileName] = state
  set(modelDownloadStateAtom, currentState)
})

const setDownloadStateSuccessAtom = atom(null, (get, set, fileName: string) => {
  const currentState = { ...get(modelDownloadStateAtom) }
  const state = currentState[fileName]
  if (!state) {
    console.error(`Cannot find download state for ${fileName}`)
    toaster({
      title: 'Cancel Download',
      description: `Model ${fileName} cancel download`,
    })
    return
  }
  delete currentState[fileName]
  set(modelDownloadStateAtom, currentState)
  toaster({
    title: 'Download Completed',
    description: `Download ${fileName} completed`,
  })
})

export function useDownloadState() {
  const modelDownloadState = useAtomValue(modelDownloadStateAtom)
  const setDownloadState = useSetAtom(setDownloadStateAtom)
  const setDownloadStateSuccess = useSetAtom(setDownloadStateSuccessAtom)

  const downloadStates: DownloadState[] = []
  for (const [, value] of Object.entries(modelDownloadState)) {
    downloadStates.push(value)
  }

  return {
    modelDownloadStateAtom,
    modelDownloadState,
    setDownloadState,
    setDownloadStateSuccess,
    downloadStates,
  }
}
