import { CoreRoutes, APIRoutes } from '@janhq/core'
import { isPlatformTauri } from '@/lib/platform'

// Dynamic import for Tauri invoke
let invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null

if (isPlatformTauri()) {
  import('@tauri-apps/api/core').then(module => {
    invoke = module.invoke
  }).catch(() => {
    console.warn('Failed to load Tauri core module')
  })
}

type InvokeArgs = Record<string, unknown> | undefined

export const AppRoutes = [
  'installExtensions',
  'getTools',
  'callTool',
  'cancelToolCall',
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
        if (invoke) {
          return invoke(
            proxy.route.replace(/([A-Z])/g, '_$1').toLowerCase(),
            args
          )
        } else {
          console.warn(`API call ${proxy.route} not available on web platform`)
          return Promise.resolve(null)
        }
      },
    }
  }, {}),
  openExternalUrl,
}
