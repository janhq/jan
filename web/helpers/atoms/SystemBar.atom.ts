import { atom } from 'jotai'

export const totalRamAtom = atom<number>(0)
export const usedRamAtom = atom<number>(0)

export const cpuUsageAtom = atom<number>(0)
export const ramUtilitizedAtom = atom<number>(0)

export const gpusAtom = atom<Record<string, never>[]>([])

export const nvidiaTotalVramAtom = atom<number>(0)
export const systemMonitorCollapseAtom = atom<boolean>(false)
