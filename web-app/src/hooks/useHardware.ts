import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

// Hardware data types
export interface CPU {
  arch: string
  core_count: number
  extensions: string[]
  name: string
  usage: number
  instructions?: string[] // Cortex migration: ensure instructions data ready
}

export interface OS {
  name: string
  version: string
}

export interface RAM {
  available: number
  total: number
}

export interface HardwareData {
  cpu: CPU
  os_type: string
  os_name: string
  total_memory: number
  os?: OS
  ram?: RAM
}

export interface SystemUsage {
  cpu: number
  used_memory: number
  total_memory: number
}

// Default values
const defaultHardwareData: HardwareData = {
  cpu: {
    arch: '',
    core_count: 0,
    extensions: [],
    name: '',
    usage: 0,
  },
  os_type: '',
  os_name: '',
  total_memory: 0,
}

const defaultSystemUsage: SystemUsage = {
  cpu: 0,
  used_memory: 0,
  total_memory: 0,
}

interface HardwareStore {
  // Hardware data
  hardwareData: HardwareData
  systemUsage: SystemUsage

  // Update functions
  setCPU: (cpu: CPU) => void
  setOS: (os: OS) => void
  setRAM: (ram: RAM) => void

  // Update entire hardware data at once
  setHardwareData: (data: HardwareData) => void

  // Update RAM available
  updateSystemUsage: (usage: SystemUsage) => void

  // GPU loading state
  gpuLoading: { [index: number]: boolean }

  // Polling control
  pollingPaused: boolean
  pausePolling: () => void
  resumePolling: () => void
}

export const useHardware = create<HardwareStore>()(
  persist(
    (set) => ({
      hardwareData: defaultHardwareData,
      systemUsage: defaultSystemUsage,
      gpuLoading: {},
      pollingPaused: false,
      pausePolling: () => set({ pollingPaused: true }),
      resumePolling: () => set({ pollingPaused: false }),

      setCPU: (cpu) =>
        set((state) => ({
          hardwareData: {
            ...state.hardwareData,
            cpu,
          },
        })),

      setOS: (os) =>
        set((state) => ({
          hardwareData: {
            ...state.hardwareData,
            os,
          },
        })),

      setRAM: (ram) =>
        set((state) => ({
          hardwareData: {
            ...state.hardwareData,
            ram,
          },
        })),

      setHardwareData: (data) =>
        set({
          hardwareData: {
            ...data,
            cpu: {
              ...data.cpu,
              // Cortex migration - ensure instructions data ready
              instructions: [],
            },
            ram: {
              available: 0,
              total: 0,
            },
          },
        }),

      updateSystemUsage: (systemUsage) =>
        set(() => ({
          systemUsage,
        })),
    }),
    {
      name: localStorageKey.settingHardware,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
