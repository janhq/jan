/* eslint-disable @typescript-eslint/no-explicit-any */
import { Platform, PlatformFeature } from './types'

declare const IS_WEB_APP: boolean

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
  if (typeof navigator === 'undefined') return false
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream
  )
}

export const isPlatformAndroid = (): boolean => {
  if (typeof navigator === 'undefined') return false
  return /Android/.test(navigator.userAgent)
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
