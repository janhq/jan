/**
 * Platform-aware fetch utility
 * Uses Tauri's fetch on desktop to avoid CORS issues
 * Uses browser's fetch on web
 */

import { isPlatformTauri } from './index'

let tauriFetch: typeof fetch | null = null

// Dynamically import Tauri fetch only on Tauri platform
if (isPlatformTauri()) {
  import('@tauri-apps/plugin-http')
    .then((module) => {
      tauriFetch = module.fetch
    })
    .catch(() => {
      // Fallback to browser fetch if Tauri fetch fails
      tauriFetch = null
    })
}

/**
 * Platform-aware fetch function
 * Automatically chooses the right fetch implementation
 */
export const platformFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  // On Tauri platform, use Tauri's fetch to avoid CORS issues
  if (isPlatformTauri() && tauriFetch) {
    return tauriFetch(input, init)
  }
  
  // On web platform, use browser's native fetch
  return fetch(input, init)
}

/**
 * Get the appropriate fetch function for the current platform
 */
export const getPlatformFetch = (): typeof fetch => {
  if (isPlatformTauri() && tauriFetch) {
    return tauriFetch
  }
  return fetch
}