import { AppConfiguration } from '@janhq/core'
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

const EXPERIMENTAL_FEATURE = 'experimentalFeature'
const PROXY_FEATURE_ENABLED = 'proxyFeatureEnabled'
const VULKAN_ENABLED = 'vulkanEnabled'
const IGNORE_SSL = 'ignoreSSLFeature'
const HTTPS_PROXY_FEATURE = 'httpsProxyFeature'

export const experimentalFeatureEnabledAtom = atomWithStorage(
  EXPERIMENTAL_FEATURE,
  false
)

export const proxyEnabledAtom = atomWithStorage(PROXY_FEATURE_ENABLED, false)
export const proxyAtom = atomWithStorage(HTTPS_PROXY_FEATURE, '')

export const ignoreSslAtom = atomWithStorage(IGNORE_SSL, false)
export const vulkanEnabledAtom = atomWithStorage(VULKAN_ENABLED, false)

export const appConfigurationAtom = atom<AppConfiguration | undefined>(
  undefined
)

export const updateAppConfigurationAtom = atom(
  null,
  (get, set, appConfig: Partial<AppConfiguration>) => {
    const currentAppConfig = get(appConfigurationAtom)
    if (currentAppConfig) {
      set(appConfigurationAtom, { ...currentAppConfig, ...appConfig })
    }
  }
)
