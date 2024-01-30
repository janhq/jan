import { HuggingFaceRepoData } from '@janhq/core'
import { atom } from 'jotai'

export const repoIDAtom = atom<string | null>(null)
export const loadingAtom = atom<boolean>(false)
export const fetchErrorAtom = atom<Error | null>(null)
const _repoDataAtom = atom<HuggingFaceRepoData | null>(null)
const _unsupportedAtom = atom<boolean>(false)

export const resetAtom = atom(null, (_get, set) => {
  set(repoIDAtom, null)
  set(loadingAtom, false)
  set(fetchErrorAtom, null)
  set(_repoDataAtom, null)
  set(_unsupportedAtom, false)
})

export const repoDataAtom = atom(
  (get) => get(_repoDataAtom),
  (_get, set, repoData: HuggingFaceRepoData) => {
    set(_repoDataAtom, repoData)
    if (
      !repoData.tags.includes('transformers') ||
      (!repoData.tags.includes('pytorch') &&
        !repoData.tags.includes('safetensors'))
    ) {
      set(_unsupportedAtom, true)
    }
  }
)

export const unsupportedAtom = atom((get) => get(_unsupportedAtom))
