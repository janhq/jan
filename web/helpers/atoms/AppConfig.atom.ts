import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

const EXPERIMENTAL_FEATURE = 'experimentalFeature'
const PROXY_FEATURE_ENABLED = 'proxyFeatureEnabled'
const VULKAN_ENABLED = 'vulkanEnabled'
const IGNORE_SSL = 'ignoreSSLFeature'
const HTTPS_PROXY_FEATURE = 'httpsProxyFeature'
const QUICK_ASK_ENABLED = 'quickAskEnabled'

export const janDataFolderPathAtom = atom('')

export const experimentalFeatureEnabledAtom = atomWithStorage(
  EXPERIMENTAL_FEATURE,
  false,
  undefined,
  { getOnInit: true }
)

export const proxyEnabledAtom = atomWithStorage(
  PROXY_FEATURE_ENABLED,
  false,
  undefined,
  { getOnInit: true }
)
export const proxyAtom = atomWithStorage(HTTPS_PROXY_FEATURE, '', undefined, {
  getOnInit: true,
})

export const ignoreSslAtom = atomWithStorage(IGNORE_SSL, false, undefined, {
  getOnInit: true,
})
export const vulkanEnabledAtom = atomWithStorage(
  VULKAN_ENABLED,
  false,
  undefined,
  { getOnInit: true }
)
export const quickAskEnabledAtom = atomWithStorage(
  QUICK_ASK_ENABLED,
  false,
  undefined,
  { getOnInit: true }
)

export const hostAtom = atom('http://localhost:1337/')
