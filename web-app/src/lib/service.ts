import { CoreRoutes, APIRoutes } from '@janhq/core'
import { invoke, InvokeArgs } from '@tauri-apps/api/core'

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
}
