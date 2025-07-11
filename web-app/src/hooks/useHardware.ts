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

  // Update hardware data while preserving GPU order
  updateHardwareDataPreservingGpuOrder: (data: HardwareData) => void

  // Update individual GPU
  updateGPU: (index: number, gpu: GPU) => void

  // Update RAM available
  updateSystemUsage: (usage: SystemUsage) => void

  // Toggle GPU activation (async, with loading)
  toggleGPUActivation: (index: number) => Promise<void>

  // GPU loading state
  gpuLoading: { [index: number]: boolean }
  setGpuLoading: (index: number, loading: boolean) => void

  // Polling control
  pollingPaused: boolean
  pausePolling: () => void
  resumePolling: () => void

  // Reorder GPUs
  reorderGPUs: (oldIndex: number, newIndex: number) => void

  // Get activated GPU device string
  getActivatedDeviceString: (backendType?: string) => string

  // Update GPU activation states from device string
  updateGPUActivationFromDeviceString: (deviceString: string) => void
}

export const useHardware = create<HardwareStore>()(
  persist(
    (set, get) => ({
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
            gpus: data.gpus.map((gpu) => ({
              ...gpu,
              activated: gpu.activated ?? false,
            })),
          },
        }),

      updateHardwareDataPreservingGpuOrder: (data) =>
        set((state) => {
          // If we have existing GPU data, preserve the order and activation state
          if (state.hardwareData.gpus.length > 0) {
            // Reorder fresh GPU data to match existing order, adding new GPUs at the end
            const reorderedGpus: GPU[] = []
            const processedUuids = new Set()

            // First, add existing GPUs in their current order, preserving activation state
            state.hardwareData.gpus.forEach((existingGpu) => {
              const freshGpu = data.gpus.find(
                (gpu) => gpu.uuid === existingGpu.uuid
              )
              if (freshGpu) {
                reorderedGpus.push({
                  ...freshGpu,
                  activated: existingGpu.activated ?? false,
                })
                processedUuids.add(freshGpu.uuid)
              }
            })

            // Then, add any new GPUs that weren't in the existing order (default to inactive)
            data.gpus.forEach((freshGpu) => {
              if (!processedUuids.has(freshGpu.uuid)) {
                reorderedGpus.push({
                  ...freshGpu,
                  activated: false,
                })
              }
            })

            return {
              hardwareData: {
                ...data,
                gpus: reorderedGpus,
              },
            }
          } else {
            // No existing GPU data, initialize all GPUs as inactive
            return {
              hardwareData: {
                ...data,
                gpus: data.gpus.map((gpu) => ({
                  ...gpu,
                  activated: false,
                })),
              },
            }
          }
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

      toggleGPUActivation: async (index) => {
        const { pausePolling, resumePolling, setGpuLoading } = get()
        pausePolling()
        setGpuLoading(index, true)

        try {
          await new Promise((resolve) => setTimeout(resolve, 200)) // Simulate async operation

          set((state) => {
            const newGPUs = [...state.hardwareData.gpus]
            if (index >= 0 && index < newGPUs.length) {
              newGPUs[index] = {
                ...newGPUs[index],
                activated: !newGPUs[index].activated,
              }
            }

            return {
              hardwareData: {
                ...state.hardwareData,
                gpus: newGPUs,
              },
            }
          })

          // Update the device setting after state change
          const updatedState = get()

          // Import and get backend type
          const { useModelProvider } = await import('./useModelProvider')
          const { updateProvider, getProviderByName } =
            useModelProvider.getState()

          const llamacppProvider = getProviderByName('llamacpp')
          const backendType = llamacppProvider?.settings.find(
            (s) => s.key === 'version_backend'
          )?.controller_props.value as string

          const deviceString =
            updatedState.getActivatedDeviceString(backendType)

          if (llamacppProvider) {
            const updatedSettings = llamacppProvider.settings.map((setting) => {
              if (setting.key === 'device') {
                return {
                  ...setting,
                  controller_props: {
                    ...setting.controller_props,
                    value: deviceString,
                  },
                }
              }
              return setting
            })

            updateProvider('llamacpp', {
              settings: updatedSettings,
            })
          }
        } finally {
          setGpuLoading(index, false)
          setTimeout(resumePolling, 1000) // Resume polling after 1s
        }
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

      getActivatedDeviceString: (backendType?: string) => {
        const { hardwareData } = get()

        // Get activated GPUs and generate appropriate device format based on backend
        const activatedDevices = hardwareData.gpus
          .filter((gpu) => gpu.activated)
          .map((gpu) => {
            const isCudaBackend = backendType?.includes('cuda')
            const isVulkanBackend = backendType?.includes('vulkan')

            // Handle different backend scenarios
            if (isCudaBackend && isVulkanBackend) {
              // Mixed backend - prefer CUDA for NVIDIA GPUs, Vulkan for others
              if (gpu.nvidia_info) {
                return `cuda:${gpu.nvidia_info.index}`
              } else if (gpu.vulkan_info) {
                return `vulkan:${gpu.vulkan_info.index}`
              }
            } else if (isCudaBackend && gpu.nvidia_info) {
              // CUDA backend - only use CUDA-compatible GPUs
              return `cuda:${gpu.nvidia_info.index}`
            } else if (isVulkanBackend && gpu.vulkan_info) {
              // Vulkan backend - only use Vulkan-compatible GPUs
              return `vulkan:${gpu.vulkan_info.index}`
            } else if (!backendType) {
              // No backend specified, use GPU's preferred type
              if (gpu.nvidia_info) {
                return `cuda:${gpu.nvidia_info.index}`
              } else if (gpu.vulkan_info) {
                return `vulkan:${gpu.vulkan_info.index}`
              }
            }
            return null
          })
          .filter((device) => device !== null) as string[]

        const deviceString = activatedDevices.join(',')
        return deviceString
      },

      updateGPUActivationFromDeviceString: (deviceString: string) => {
        set((state) => {
          const newGPUs = [...state.hardwareData.gpus]

          // Parse device string to get active device indices
          const activeDevices = deviceString
            .split(',')
            .map((device) => device.trim())
            .filter((device) => device.length > 0)
            .map((device) => {
              const match = device.match(/^(cuda|vulkan):(\d+)$/)
              if (match) {
                return {
                  type: match[1] as 'cuda' | 'vulkan',
                  index: parseInt(match[2]),
                }
              }
              return null
            })
            .filter((device) => device !== null) as Array<{
            type: 'cuda' | 'vulkan'
            index: number
          }>

          // Update GPU activation states
          newGPUs.forEach((gpu, gpuIndex) => {
            const shouldBeActive = activeDevices.some((device) => {
              if (device.type === 'cuda' && gpu.nvidia_info) {
                return gpu.nvidia_info.index === device.index
              } else if (device.type === 'vulkan' && gpu.vulkan_info) {
                return gpu.vulkan_info.index === device.index
              }
              return false
            })

            newGPUs[gpuIndex] = {
              ...gpu,
              activated: shouldBeActive,
            }
          })

          return {
            hardwareData: {
              ...state.hardwareData,
              gpus: newGPUs,
            },
          }
        })
      },
    }),
    {
      name: localStorageKey.settingHardware,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
