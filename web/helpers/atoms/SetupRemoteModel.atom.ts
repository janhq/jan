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
