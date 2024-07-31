import { RemoteEngine } from '@janhq/core'
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

export type SetupRemoteModelStage = 'NONE' | 'SETUP_INTRO' | 'SETUP_API_KEY'
const IS_ANY_REMOTE_MODEL_CONFIGURED = 'isAnyRemoteModelConfigured'

export const isAnyRemoteModelConfiguredAtom = atomWithStorage(
  IS_ANY_REMOTE_MODEL_CONFIGURED,
  false
)
const remoteModelSetUpStageAtom = atom<SetupRemoteModelStage>('NONE')
const engineBeingSetUpAtom = atom<RemoteEngine | undefined>(undefined)
const remoteEngineBeingSetUpMetadataAtom = atom<
  Record<string, unknown> | undefined
>(undefined)

export const setUpRemoteModelStageAtom = atom(
  (get) => ({
    stage: get(remoteModelSetUpStageAtom),
    remoteEngine: get(engineBeingSetUpAtom),
    metadata: get(remoteEngineBeingSetUpMetadataAtom),
  }),
  (
    _get,
    set,
    stage: SetupRemoteModelStage,
    remoteEngine: RemoteEngine | undefined,
    metadata?: Record<string, unknown> | undefined
  ) => {
    set(remoteModelSetUpStageAtom, stage)
    set(engineBeingSetUpAtom, remoteEngine)
    set(remoteEngineBeingSetUpMetadataAtom, metadata)
  }
)

export const navigateToSetUpApiKeyAtom = atom(null, (_get, set) => {
  set(remoteModelSetUpStageAtom, 'SETUP_API_KEY')
})
