import { CoreRoutes, APIRoutes } from '@janhq/core'
import { getServiceHub } from '@/hooks/useServiceHub'
import { isPlatformTauri } from '@/lib/platform'
import type { InvokeArgs } from '@/services/core/types'

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
        if (isPlatformTauri()) {
          // For Tauri platform, use the service hub to invoke commands
          const command = proxy.route.replace(/([A-Z])/g, '_$1').toLowerCase()

          // Backward-compatible shim for start_server: wrap args into { config }
          if (command === 'start_server') {
            // If already using new shape, pass through
            if (args && 'config' in args) {
              return getServiceHub().core().invoke(command, args)
            }

            const raw = (args || {}) as Record<string, unknown>
            const config = {
              host: raw.host,
              port: raw.port,
              prefix: raw.prefix,
              api_key: (raw as any).api_key ?? (raw as any).apiKey,
              trusted_hosts:
                (raw as any).trusted_hosts ?? (raw as any).trustedHosts,
              proxy_timeout:
                (raw as any).proxy_timeout ?? (raw as any).proxyTimeout,
            }
            return getServiceHub().core().invoke(command, { config })
          }

          return getServiceHub().core().invoke(command, args)
        } else {
          // For Web platform, provide fallback implementations
          console.warn(`API call '${proxy.route}' not supported in web environment`, args)
          return Promise.resolve(null)
        }
      },
    }
  }, {}),
  openExternalUrl,
}
