/* eslint-disable @typescript-eslint/no-explicit-any */
import { CoreRoutes } from '@janhq/core'

import { safeJsonParse } from '@/utils/json'

// Function to open an external URL in a new browser window
export function openExternalUrl(url: string) {
  window?.open(url, '_blank')
}

// Define API routes based on different route types
export const APIRoutes = [...CoreRoutes.map((r) => ({ path: `app`, route: r }))]

// Define the restAPI object with methods for each API route
export const restAPI = {
  ...Object.values(APIRoutes).reduce((acc, proxy) => {
    return {
      ...acc,
      [proxy.route]: (...args: any) => {
        // For each route, define a function that sends a request to the API
        return fetch(
          `${window.core?.api.baseApiUrl}/v1/${proxy.path}/${proxy.route}`,
          {
            method: 'POST',
            body: JSON.stringify(args),
            headers: { contentType: 'application/json' },
          }
        ).then(async (res) => {
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
  // Jan Server URL
  baseApiUrl: process.env.API_BASE_URL ?? API_BASE_URL,
  pollingInterval: 5000,
}
