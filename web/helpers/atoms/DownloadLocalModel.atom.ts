import { atom } from 'jotai'

export type DownloadLocalModelStage = 'NONE' | 'MODEL_LIST'

const downloadLocalModelStageAtom = atom<DownloadLocalModelStage>('NONE')

export const setDownloadLocalModelStageAtom = atom(
  null,
  (_get, set, stage: DownloadLocalModelStage) => {
    set(downloadLocalModelStageAtom, stage)
  }
)

export const getDownloadLocalModelStageAtom = atom((get) =>
  get(downloadLocalModelStageAtom)
)
