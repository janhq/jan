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

export interface GPUAdditionalInfo {
  compute_cap: string
  driver_version: string
}

export interface GPU {
  name: string
  total_memory: number
  vendor: string
  uuid: string
  driver_version: string
  activated?: boolean
  nvidia_info: {
    index: number
    compute_capability: string
  }
  vulkan_info: {
    index: number
    device_id: number
    device_type: string
    api_version: string
  }
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
  gpus: GPU[]
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
  gpus: {
    uuid: string
    used_memory: number
    total_memory: number
  }[]
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
  gpus: [],
  os_type: '',
  os_name: '',
  total_memory: 0,
}

const defaultSystemUsage: SystemUsage = {
  cpu: 0,
  used_memory: 0,
  total_memory: 0,
  gpus: [],
}

interface HardwareStore {
  // Hardware data
  hardwareData: HardwareData
  systemUsage: SystemUsage

  // Update functions
  setCPU: (cpu: CPU) => void
  setGPUs: (gpus: GPU[]) => void
  setOS: (os: OS) => void
  setRAM: (ram: RAM) => void

  // Update entire hardware data at once
  setHardwareData: (data: HardwareData) => void

  // Update individual GPU
  updateGPU: (index: number, gpu: GPU) => void

  // Update RAM available
  updateSystemUsage: (usage: SystemUsage) => void

  // GPU loading state
  gpuLoading: { [index: number]: boolean }
  setGpuLoading: (index: number, loading: boolean) => void

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
      setGpuLoading: (index, loading) =>
        set((state) => ({
          gpuLoading: {
            ...state.gpuLoading,
            [state.hardwareData.gpus[index].uuid]: loading,
          },
        })),
      pausePolling: () => set({ pollingPaused: true }),
      resumePolling: () => set({ pollingPaused: false }),

      setCPU: (cpu) =>
        set((state) => ({
          hardwareData: {
            ...state.hardwareData,
            cpu,
          },
        })),

      setGPUs: (gpus) =>
        set((state) => ({
          hardwareData: {
            ...state.hardwareData,
            gpus,
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
            gpus: data.gpus.map((gpu) => ({
              ...gpu,
              activated: gpu.activated ?? false,
            })),
          },
        }),

      updateGPU: (index, gpu) =>
        set((state) => {
          const newGPUs = [...state.hardwareData.gpus]
          if (index >= 0 && index < newGPUs.length) {
            newGPUs[index] = gpu
          }
          return {
            hardwareData: {
              ...state.hardwareData,
              gpus: newGPUs,
            },
          }
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
