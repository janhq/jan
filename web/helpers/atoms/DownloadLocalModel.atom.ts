import { atom } from 'jotai'

export type DownloadLocalModelStage = 'NONE' | 'MODEL_LIST'

const downloadLocalModelStageAtom = atom<DownloadLocalModelStage>('NONE')
const modelHubSelectedModelHandle = atom<string | undefined>(undefined)

export const localModelModalStageAtom = atom(
  (get) => ({
    stage: get(downloadLocalModelStageAtom),
    modelHandle: get(modelHubSelectedModelHandle),
  }),
  (
    _get,
    set,
    stage: DownloadLocalModelStage,
    modelHandle: string | undefined
  ) => {
    set(downloadLocalModelStageAtom, stage)
    set(modelHubSelectedModelHandle, modelHandle)
  }
)
