import { DownloadState } from '@models/DownloadState'
import { atom } from 'jotai'

// download states
export const modelDownloadStateAtom = atom<Record<string, DownloadState>>({})

export const setDownloadStateAtom = atom(
  null,
  (get, set, state: DownloadState) => {
    const currentState = { ...get(modelDownloadStateAtom) }
    console.debug(
      `current download state for ${state.fileName} is ${JSON.stringify(state)}`
    )
    currentState[state.fileName] = state
    set(modelDownloadStateAtom, currentState)
  }
)

export const setDownloadStateSuccessAtom = atom(
  null,
  (get, set, fileName: string) => {
    const currentState = { ...get(modelDownloadStateAtom) }
    const state = currentState[fileName]
    if (!state) {
      console.error(`Cannot find download state for ${fileName}`)
      return
    }

    delete currentState[fileName]
    set(modelDownloadStateAtom, currentState)
  }
)
