import { Platform, PlatformFeature } from './types'

declare const IS_WEB_APP: boolean
declare const IS_IOS: boolean
declare const IS_ANDROID: boolean

export const isPlatformTauri = (): boolean => {
  if (typeof IS_WEB_APP === 'undefined') {
    return true
  }
  if (IS_WEB_APP === true || (IS_WEB_APP as unknown as string) === 'true') {
    return false
  }

  // In dev, web can be built with Tauri flags but still opened in a regular browser.
  // Only treat as Tauri when a runtime bridge is actually present.
  if (typeof window !== 'undefined') {
    const w = window as Window & {
      __TAURI__?: unknown
      __TAURI_INTERNALS__?: unknown
    }
    const hasTauriBridge =
      typeof w.__TAURI__ !== 'undefined' ||
      typeof w.__TAURI_INTERNALS__ !== 'undefined'
    if (!hasTauriBridge) {
      return false
    }
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

export const getCurrentPlatform = (): Platform => {
  if (isPlatformIOS()) return 'ios'
  if (isPlatformAndroid()) return 'android'
  return isPlatformTauri() ? 'tauri' : 'web'
}

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
