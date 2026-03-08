/**
 * Utility to check if the system supports blur/acrylic effects
 * based on OS information from hardware data
 */

import type { HardwareData } from '@/hooks/useHardware'

/**
 * Check if Windows supports blur effects based on build number
 * Windows 10 build 17134 (version 1803) and later support acrylic effects
 */
function checkWindowsBlurSupport(osName: string): boolean {
  // os_name format: "Windows 10 Pro (build 22631)" or similar
  const buildMatch = osName.match(/build\s+(\d+)/i)

  if (buildMatch && buildMatch[1]) {
    const build = parseInt(buildMatch[1], 10)
    return build >= 17134
  }

  // If we can't detect build number, assume modern Windows supports blur
  return true
}

/**
 * Check if Linux supports blur effects based on desktop environment
 */
function checkLinuxBlurSupport(): boolean {
  // Check environment variables (only available in Tauri)
  if (typeof window === 'undefined') return false

  // These checks would need to be done on the backend
  // For now, we'll assume Linux with common DEs supports blur
  return true
}

/**
 * Check if the system supports blur/acrylic effects
 *
 * @param hardwareData - Hardware data from the hardware plugin
 * @returns true if blur effects are supported
 */
export function supportsBlurEffects(hardwareData: HardwareData | null): boolean {
  if (!hardwareData) return false

  const { os_type, os_name } = hardwareData

  // macOS always supports blur/vibrancy effects
  if (os_type === 'macos') {
    return true
  }

  // Windows: Check build number
  if (os_type === 'windows') {
    return checkWindowsBlurSupport(os_name)
  }

  // Linux: Check desktop environment (simplified for now)
  if (os_type === 'linux') {
    return checkLinuxBlurSupport()
  }

  // Unknown platforms: assume no blur support
  return false
}
