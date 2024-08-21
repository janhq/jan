import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

const EXPERIMENTAL_FEATURE = 'experimentalFeature'
const PROXY_FEATURE_ENABLED = 'proxyFeatureEnabled'
const VULKAN_ENABLED = 'vulkanEnabled'
const IGNORE_SSL = 'ignoreSSLFeature'
const HTTPS_PROXY_FEATURE = 'httpsProxyFeature'
const QUICK_ASK_ENABLED = 'quickAskEnabled'
const PRESERVE_MODEL_SETTINGS = 'preserveModelSettings'

export const janDataFolderPathAtom = atom('')

export const experimentalFeatureEnabledAtom = atomWithStorage(
  EXPERIMENTAL_FEATURE,
  false
)

export const proxyEnabledAtom = atomWithStorage(PROXY_FEATURE_ENABLED, false)
export const proxyAtom = atomWithStorage(HTTPS_PROXY_FEATURE, '')

export const ignoreSslAtom = atomWithStorage(IGNORE_SSL, false)
export const vulkanEnabledAtom = atomWithStorage(VULKAN_ENABLED, false)
export const quickAskEnabledAtom = atomWithStorage(QUICK_ASK_ENABLED, false)

export const hostAtom = atom('http://localhost:1337/')

// This feature is to allow user to cache model settings on thread creation
export const preserveModelSettingsAtom = atomWithStorage(
  PRESERVE_MODEL_SETTINGS,
  false
)
