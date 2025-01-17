import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

const EXPERIMENTAL_FEATURE = 'experimentalFeature'
const PROXY_FEATURE_ENABLED = 'proxyFeatureEnabled'
const VULKAN_ENABLED = 'vulkanEnabled'
const IGNORE_SSL = 'ignoreSSLFeature'
const VERIFY_PROXY_SSL = 'verifyProxySSL'
const VERIFY_PROXY_HOST_SSL = 'verifyProxyHostSSL'
const VERIFY_PEER_SSL = 'verifyPeerSSL'
const VERIFY_HOST_SSL = 'verifyHostSSL'
const HTTPS_PROXY_FEATURE = 'httpsProxyFeature'
const PROXY_USERNAME = 'proxyUsername'
const PROXY_PASSWORD = 'proxyPassword'
const QUICK_ASK_ENABLED = 'quickAskEnabled'
const NO_PROXY = 'noProxy'

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

export const proxyUsernameAtom = atomWithStorage(
  PROXY_USERNAME,
  '',
  undefined,
  { getOnInit: true }
)

export const proxyPasswordAtom = atomWithStorage(
  PROXY_PASSWORD,
  '',
  undefined,
  { getOnInit: true }
)

export const ignoreSslAtom = atomWithStorage(IGNORE_SSL, false, undefined, {
  getOnInit: true,
})

export const noProxyAtom = atomWithStorage(NO_PROXY, '', undefined, {
  getOnInit: false,
})

export const verifyProxySslAtom = atomWithStorage(
  VERIFY_PROXY_SSL,
  false,
  undefined,
  { getOnInit: true }
)

export const verifyProxyHostSslAtom = atomWithStorage(
  VERIFY_PROXY_HOST_SSL,
  false,
  undefined,
  { getOnInit: true }
)

export const verifyPeerSslAtom = atomWithStorage(
  VERIFY_PEER_SSL,
  false,
  undefined,
  { getOnInit: true }
)

export const verifyHostSslAtom = atomWithStorage(
  VERIFY_HOST_SSL,
  false,
  undefined,
  { getOnInit: true }
)

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
