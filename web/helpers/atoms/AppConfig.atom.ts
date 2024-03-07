import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

const EXPERIMENTAL_FEATURE = 'experimentalFeature'
const PROXY_FEATURE_ENABLED = 'proxyFeatureEnabled'
const VULKAN_ENABLED = 'vulkanEnabled'
const IGNORE_SSL = 'ignoreSSLFeature'
const HTTPS_PROXY_FEATURE = 'httpsProxyFeature'

export const janDataFolderPathAtom = atom('')

export const experimentalFeatureEnabledAtom = atomWithStorage(
  EXPERIMENTAL_FEATURE,
  false
)

export const proxyEnabledAtom = atomWithStorage(PROXY_FEATURE_ENABLED, false)
export const proxyAtom = atomWithStorage(HTTPS_PROXY_FEATURE, '')

export const ignoreSslAtom = atomWithStorage(IGNORE_SSL, false)
export const vulkanEnabledAtom = atomWithStorage(VULKAN_ENABLED, false)
