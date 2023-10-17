import { atom } from 'jotai'

/**
 * Stores expand state of conversation container. Default is true.
 */
export const leftSideBarExpandStateAtom = atom<boolean>(true)

export const rightSideBarExpandStateAtom = atom<boolean>(false)
