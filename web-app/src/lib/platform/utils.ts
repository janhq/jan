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

export const getCurrentPlatform = (): Platform => {
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
