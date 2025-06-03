import {
  CoreRoutes,
  APIRoutes,
  HardwareManagementExtension,
  ExtensionTypeEnum,
} from '@janhq/core'
import { invoke, InvokeArgs } from '@tauri-apps/api/core'
import { ExtensionManager } from './extension'
import { useVulkan } from '@/hooks/useVulkan'

export const AppRoutes = [
  'installExtensions',
  'getTools',
  'callTool',
  'listThreads',
  'createThread',
  'modifyThread',
  'deleteThread',
  'listMessages',
  'createMessage',
  'modifyMessage',
  'deleteMessage',
  'getThreadAssistant',
  'createThreadAssistant',
  'modifyThreadAssistant',
  'saveMcpConfigs',
  'getMcpConfigs',
  'restartMcpServers',
  'getConnectedServers',
  'readLogs',
  'changeAppDataFolder',
  'getSystemInfo',
  'getSystemUsage',
  'saveFile',
  'extractTextFromFile',
]
// Define API routes based on different route types
export const Routes = [...CoreRoutes, ...APIRoutes, ...AppRoutes].map((r) => ({
  path: `app`,
  route: r,
}))

// Function to open an external URL in a new browser window
export function openExternalUrl(url: string) {
  window?.open(url, '_blank')
}

export const systemInformation = async () => {
  const hardwareExtension =
    ExtensionManager.getInstance().get<HardwareManagementExtension>(
      ExtensionTypeEnum.Hardware
    )

  if (!hardwareExtension) return undefined

  const hardwareInfo = await hardwareExtension?.getHardware()

  const gpuSettingInfo = {
    gpus: hardwareInfo.gpus.filter((gpu) => gpu.total_vram > 0),
    vulkan: useVulkan.getState().vulkanEnabled,
    cpu: hardwareInfo.cpu,
  }

  const updateOsInfo = {
    platform: PLATFORM,
    arch: hardwareInfo.cpu.arch,
    freeMem: hardwareInfo.ram.available,
    totalMem: hardwareInfo.ram.total,
  }

  return {
    gpuSetting: gpuSettingInfo,
    osInfo: updateOsInfo,
  }
}

export const APIs = {
  ...Object.values(Routes).reduce((acc, proxy) => {
    return {
      ...acc,
      [proxy.route]: (args?: InvokeArgs) => {
        // For each route, define a function that sends a request to the API
        return invoke(
          proxy.route.replace(/([A-Z])/g, '_$1').toLowerCase(),
          args
        )
      },
    }
  }, {}),
  openExternalUrl,
  systemInformation,
}
