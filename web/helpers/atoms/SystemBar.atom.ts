import { atom } from 'jotai'

export const totalRamAtom = atom<number>(0)
export const usedRamAtom = atom<number>(0)

export const cpuUsageAtom = atom<number>(0)

export const nvidiaGpuUsageAtom = atom<number>(0)
export const nvidiaVramUsageAtom = atom<number>(0)
