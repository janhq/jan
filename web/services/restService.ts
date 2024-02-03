/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  AppRoute,
  DownloadRoute,
  ExtensionRoute,
  FileManagerRoute,
  FileSystemRoute,
} from '@janhq/core'

import { safeJsonParse } from '@/utils/json'

// Function to open an external URL in a new browser window
export function openExternalUrl(url: string) {
  window?.open(url, '_blank')
}

// Define API routes based on different route types
export const APIRoutes = [
  ...Object.values(AppRoute).map((r) => ({ path: 'app', route: r })),
  ...Object.values(DownloadRoute).map((r) => ({ path: `download`, route: r })),
  ...Object.values(ExtensionRoute).map((r) => ({
    path: `extension`,
    route: r,
  })),
  ...Object.values(FileSystemRoute).map((r) => ({ path: `fs`, route: r })),
  ...Object.values(FileManagerRoute).map((r) => ({ path: `fs`, route: r })),
]

// Define the restAPI object with methods for each API route
export const restAPI = {
  ...Object.values(APIRoutes).reduce((acc, proxy) => {
    return {
      ...acc,
      [proxy.route]: (...args: any) => {
        // For each route, define a function that sends a request to the API
        return fetch(`${API_BASE_URL}/v1/${proxy.path}/${proxy.route}`, {
          method: 'POST',
          body: JSON.stringify(args),
          headers: { contentType: 'application/json' },
        }).then(async (res) => {
          try {
            if (proxy.path === 'fs') {
              const text = await res.text()
              return safeJsonParse(text) ?? text
            }
            return await res.json()
          } catch (err) {
            console.debug('Op: ', proxy, args, err)
          }
        })
      },
    }
  }, {}),
  openExternalUrl,
}
