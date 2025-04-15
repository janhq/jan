import { CoreRoutes, APIRoutes } from '@janhq/core'
import { invoke } from '@tauri-apps/api/core'

// Define API routes based on different route types
export const Routes = [
  ...CoreRoutes,
  ...APIRoutes,
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
].map((r) => ({
  path: `app`,
  route: r,
}))

// Function to open an external URL in a new browser window
export function openExternalUrl(url: string) {
  window?.open(url, '_blank')
}

// Define the restAPI object with methods for each API route
export const tauriAPI = {
  ...Object.values(Routes).reduce((acc, proxy) => {
    return {
      ...acc,
      /* eslint-disable  @typescript-eslint/no-explicit-any */
      [proxy.route]: (...args: any) => {
        // For each route, define a function that sends a request to the API
        return invoke(
          proxy.route.replace(/([A-Z])/g, '_$1').toLowerCase(),
          ...args
        )
      },
    }
  }, {}),
  openExternalUrl,
  // Jan Server URL
  baseApiUrl: undefined, //process.env.API_BASE_URL ?? API_BASE_URL,
  pollingInterval: 5000,
}
