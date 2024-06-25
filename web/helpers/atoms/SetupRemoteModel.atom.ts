import { Model } from '@janhq/core'
import { atom } from 'jotai'

export type SetupRemoteModelStage = 'NONE' | 'SETUP_INTRO' | 'SETUP_API_KEY'

const remoteModelSetUpStageAtom = atom<SetupRemoteModelStage>('NONE')

export const setRemoteModelSetUpStageAtom = atom(
  null,
  (_get, set, stage: SetupRemoteModelStage) => {
    set(remoteModelSetUpStageAtom, stage)
  }
)

export const getRemoteModelSetUpStageAtom = atom((get) =>
  get(remoteModelSetUpStageAtom)
)

//// The model being setup
const remoteModelBeingSetUpAtom = atom<Model | undefined>(undefined)

export const setRemoteModelBeingSetUpAtom = atom(
  null,
  (_get, set, model: Model) => {
    set(remoteModelBeingSetUpAtom, model)
  }
)

export const clearRemoteModelBeingSetUpAtom = atom(null, (_get, set) => {
  set(remoteModelBeingSetUpAtom, undefined)
})

export const getRemoteModelBeingSetUpAtom = atom((get) =>
  get(remoteModelBeingSetUpAtom)
)
