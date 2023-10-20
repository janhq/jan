import { atom } from 'jotai'

export const systemBarVisibilityAtom = atom<boolean>(true)

export const getSystemBarVisibilityAtom = atom((get) =>
  get(systemBarVisibilityAtom)
)

export const totalRamAtom = atom<number>(0)
