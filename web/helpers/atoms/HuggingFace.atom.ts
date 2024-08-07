import { HuggingFaceRepoData } from '@janhq/core'
import { atom } from 'jotai'

// modals
export type ImportHuggingFaceModelStage = 'NONE' | 'REPO_DETAIL'

export const importingHuggingFaceRepoDataAtom = atom<
  HuggingFaceRepoData | undefined
>(undefined)

export const importHuggingFaceModelStageAtom =
  atom<ImportHuggingFaceModelStage>('NONE')
