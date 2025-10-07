import { Platform, PlatformFeature } from './types'

declare const IS_WEB_APP: boolean
declare const IS_IOS: boolean
declare const IS_ANDROID: boolean

/**
 * Determines if the current platform is Tauri (desktop application).
 * Checks the IS_WEB_APP global variable to determine the platform type.
 * 
 * @returns {boolean} True if running on Tauri platform, false if running on web platform
 */
export const isPlatformTauri = (): boolean => {
  if (typeof IS_WEB_APP === 'undefined') {
    return true
  }
  if (IS_WEB_APP === true || (IS_WEB_APP as unknown as string) === 'true') {
    return false
  }
  return true
}

export const isPlatformIOS = (): boolean => {
  return IS_IOS
}

export const isPlatformAndroid = (): boolean => {
  return IS_ANDROID
}

export const isIOS = (): boolean => isPlatformIOS()

export const isAndroid = (): boolean => isPlatformAndroid()

/**
 * Gets the current platform identifier.
 * 
 * @returns {Platform} 'tauri' for desktop application, 'web' for web application, 'ios' for iOS, or 'android' for Android
 */
export const getCurrentPlatform = (): Platform => {
  if (isPlatformIOS()) return 'ios'
  if (isPlatformAndroid()) return 'android'
  return isPlatformTauri() ? 'tauri' : 'web'
}

/**
 * Generates a user-friendly error message for unavailable platform features.
 * Converts camelCase feature names to readable format and includes the current platform.
 * 
 * @param {PlatformFeature} feature - The platform feature that is unavailable
 * @returns {string} Formatted error message indicating the feature is not available on the current platform
 */
export const getUnavailableFeatureMessage = (
  feature: PlatformFeature
): string => {
  const platform = getCurrentPlatform()
  const featureName = feature
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase()
    .replace(/^./, (str) => str.toUpperCase())
  return `${featureName} is not available on ${platform} platform`
}
