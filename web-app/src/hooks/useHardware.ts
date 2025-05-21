import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { setActiveGpus } from '@/services/hardware'

// Hardware data types
export interface CPU {
  arch: string
  cores: number
  instructions: string[]
  model: string
  usage: number
}

export interface GPUAdditionalInfo {
  compute_cap: string
  driver_version: string
}

export interface GPU {
  activated: boolean
  additional_information: GPUAdditionalInfo
  free_vram: number
  id: string
  name: string
  total_vram: number
  uuid: string
  version: string
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
  os: OS
  ram: RAM
}

// Default values
const defaultHardwareData: HardwareData = {
  cpu: {
    arch: '',
    cores: 0,
    instructions: [],
    model: '',
    usage: 0,
  },
  gpus: [],
  os: {
    name: '',
    version: '',
  },
  ram: {
    available: 0,
    total: 0,
  },
}

interface HardwareStore {
  // Hardware data
  hardwareData: HardwareData

  // Update functions
  setCPU: (cpu: CPU) => void
  setGPUs: (gpus: GPU[]) => void
  setOS: (os: OS) => void
  setRAM: (ram: RAM) => void

  // Update entire hardware data at once
  setHardwareData: (data: HardwareData) => void

  // Update individual GPU
  updateGPU: (index: number, gpu: GPU) => void

  // Update CPU usage
  updateCPUUsage: (usage: number) => void

  // Update RAM available
  updateRAMAvailable: (available: number) => void

  // Toggle GPU activation
  toggleGPUActivation: (index: number) => void

  // Reorder GPUs
  reorderGPUs: (oldIndex: number, newIndex: number) => void
}

export const useHardware = create<HardwareStore>()(
  persist(
    (set) => ({
      hardwareData: defaultHardwareData,

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
          hardwareData: data,
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

      updateCPUUsage: (usage) =>
        set((state) => ({
          hardwareData: {
            ...state.hardwareData,
            cpu: {
              ...state.hardwareData.cpu,
              usage,
            },
          },
        })),

      updateRAMAvailable: (available) =>
        set((state) => ({
          hardwareData: {
            ...state.hardwareData,
            ram: {
              ...state.hardwareData.ram,
              available,
            },
          },
        })),

      toggleGPUActivation: (index) => {
        set((state) => {
          const newGPUs = [...state.hardwareData.gpus]
          if (index >= 0 && index < newGPUs.length) {
            newGPUs[index] = {
              ...newGPUs[index],
              activated: !newGPUs[index].activated,
            }
          }
          setActiveGpus({
            gpus: newGPUs.filter((e) => e.activated).map((e) => parseInt(e.id)),
          })
          return {
            hardwareData: {
              ...state.hardwareData,
              gpus: newGPUs,
            },
          }
        })
      },

      reorderGPUs: (oldIndex, newIndex) =>
        set((state) => {
          const newGPUs = [...state.hardwareData.gpus]
          // Move the GPU from oldIndex to newIndex
          if (
            oldIndex >= 0 &&
            oldIndex < newGPUs.length &&
            newIndex >= 0 &&
            newIndex < newGPUs.length
          ) {
            const [removed] = newGPUs.splice(oldIndex, 1)
            newGPUs.splice(newIndex, 0, removed)
          }
          return {
            hardwareData: {
              ...state.hardwareData,
              gpus: newGPUs,
            },
          }
        }),
    }),
    {
      name: localStorageKey.settingHardware,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
