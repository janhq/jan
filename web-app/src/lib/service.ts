import { CoreRoutes, APIRoutes } from '@janhq/core'
import { getServiceHub } from '@/hooks/useServiceHub'
import { isPlatformTauri } from '@/lib/platform'
import type { InvokeArgs } from '@/services/core/types'
import { webStorage } from '@/lib/web-storage'

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

// Web platform implementations for thread/message storage via localStorage
const webAPIs: Record<string, (args?: InvokeArgs) => unknown> = {
  listThreads: () => Promise.resolve(webStorage.listThreads()),
  createThread: (args) => {
    const thread = (args as { thread: Thread })?.thread
    return Promise.resolve(webStorage.createThread(thread))
  },
  modifyThread: (args) => {
    const thread = (args as { thread: Thread })?.thread
    webStorage.modifyThread(thread)
    return Promise.resolve()
  },
  deleteThread: (args) => {
    const threadId = (args as { threadId: string })?.threadId
    webStorage.deleteThread(threadId)
    return Promise.resolve()
  },
  listMessages: (args) => {
    const threadId = (args as { threadId: string })?.threadId
    return Promise.resolve(webStorage.listMessages(threadId))
  },
  createMessage: (args) => {
    const message = (args as { message: unknown })?.message
    return Promise.resolve(webStorage.createMessage(message as { thread_id?: string }))
  },
  modifyMessage: (args) => {
    const message = (args as { message: unknown })?.message
    return Promise.resolve(webStorage.modifyMessage(message as { thread_id?: string; id?: string }))
  },
  deleteMessage: (args) => {
    const { threadId, messageId } = args as { threadId: string; messageId: string }
    webStorage.deleteMessage(threadId, messageId)
    return Promise.resolve()
  },
  getThreadAssistant: (args) => {
    const threadId = (args as { threadId: string })?.threadId
    return Promise.resolve(webStorage.getThreadAssistant(threadId))
  },
  createThreadAssistant: (args) => {
    const threadId = (args as { threadId: string })?.threadId
    const assistant = (args as { assistant: unknown })?.assistant
    return Promise.resolve(webStorage.createThreadAssistant(threadId, assistant))
  },
  modifyThreadAssistant: (args) => {
    const threadId = (args as { threadId: string })?.threadId
    const assistant = (args as { assistant: unknown })?.assistant
    return Promise.resolve(webStorage.modifyThreadAssistant(threadId, assistant))
  },
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

            const raw: Record<string, unknown> = (args || {}) as Record<string, unknown>

            const pickString = (obj: Record<string, unknown>, keys: string[]): string | undefined => {
              for (const key of keys) {
                const value = obj[key]
                if (typeof value === 'string') return value
              }
              return undefined
            }

            const pickNumber = (obj: Record<string, unknown>, keys: string[]): number | undefined => {
              for (const key of keys) {
                const value = obj[key]
                if (typeof value === 'number') return value
              }
              return undefined
            }

            const pickStringArray = (obj: Record<string, unknown>, keys: string[]): string[] | undefined => {
              for (const key of keys) {
                const value = obj[key]
                if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
                  return value as string[]
                }
              }
              return undefined
            }

            const config = {
              host: pickString(raw, ['host']),
              port: pickNumber(raw, ['port']),
              prefix: pickString(raw, ['prefix']),
              api_key: pickString(raw, ['api_key', 'apiKey']),
              trusted_hosts: pickStringArray(raw, ['trusted_hosts', 'trustedHosts']),
              proxy_timeout: pickNumber(raw, ['proxy_timeout', 'proxyTimeout']),
            }
            return getServiceHub().core().invoke(command, { config })
          }

          return getServiceHub().core().invoke(command, args)
        } else {
          // For Web platform, use localStorage-based implementations where available
          if (proxy.route in webAPIs) {
            return webAPIs[proxy.route](args)
          }
          // Silently return null for unimplemented routes
          return Promise.resolve(null)
        }
      },
    }
  }, {}),
  openExternalUrl,
}
