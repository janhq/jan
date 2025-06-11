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

// Plugin routes - Add new plugins here
const PluginRoutes = [
  // RAG Plugin
  'rag$getEmbeddingConfig',
  'rag$updateEmbeddingConfig',
  'rag$getChunkingConfig',
  'rag$updateChunkingConfig',
  'rag$initializeRag',
  'rag$addDataSource',
  'rag$listDataSources',
  'rag$removeDataSource',
  'rag$queryDocuments',
  'rag$cleanAllDataSources',
  'rag$resetDatabase',
  'rag$getRagStatus',
  
  // Future plugins can be added here:
  // 'otherPlugin$someCommand',
  // 'anotherPlugin$anotherCommand',
]

// Define API routes based on different route types
export const Routes = [...CoreRoutes, ...APIRoutes, ...AppRoutes].map((r) => ({
  path: `app`,
  route: r,
}))

// Define Plugin routes
export const PluginAPIRoutes = PluginRoutes.map((r) => ({
  path: `plugin`,
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
  
  // Plugin routes with generic plugin$ prefix handling
  ...Object.values(PluginAPIRoutes).reduce((acc, proxy) => {
    return {
      ...acc,
      [proxy.route]: (args?: InvokeArgs) => {
        // Handle plugin routes with pluginName$ prefix
        if (proxy.route.includes('$')) {
          const [pluginName, commandName] = proxy.route.split('$')
          
          // Convert camelCase command to snake_case
          const snakeCaseCommand = commandName
            .replace(/([A-Z])/g, '_$1')
            .toLowerCase()
          
          // Call plugin command with plugin:pluginName|command format
          return invoke(`plugin:${pluginName}|${snakeCaseCommand}`, args)
        }
        
        // Fallback to normal pattern (shouldn't happen for plugin routes)
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
