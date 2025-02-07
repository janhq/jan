import { useCallback, useEffect } from 'react'

import { ExtensionTypeEnum, ModelExtension } from '@janhq/core'
import { useAtomValue } from 'jotai'

import { extensionManager } from '@/extension'
import {
  ignoreSslAtom,
  noProxyAtom,
  proxyAtom,
  proxyEnabledAtom,
  proxyPasswordAtom,
  proxyUsernameAtom,
  verifyHostSslAtom,
  verifyPeerSslAtom,
  verifyProxyHostSslAtom,
  verifyProxySslAtom,
} from '@/helpers/atoms/AppConfig.atom'

export const useConfigurations = () => {
  const proxyEnabled = useAtomValue(proxyEnabledAtom)
  const proxyUrl = useAtomValue(proxyAtom)
  const proxyIgnoreSSL = useAtomValue(ignoreSslAtom)
  const verifyProxySSL = useAtomValue(verifyProxySslAtom)
  const verifyProxyHostSSL = useAtomValue(verifyProxyHostSslAtom)
  const verifyPeerSSL = useAtomValue(verifyPeerSslAtom)
  const verifyHostSSL = useAtomValue(verifyHostSslAtom)
  const noProxy = useAtomValue(noProxyAtom)
  const proxyUsername = useAtomValue(proxyUsernameAtom)
  const proxyPassword = useAtomValue(proxyPasswordAtom)

  const configurePullOptions = useCallback(() => {
    extensionManager
      .get<ModelExtension>(ExtensionTypeEnum.Model)
      ?.configurePullOptions(
        proxyEnabled
          ? {
              proxy_username: proxyUsername,
              proxy_password: proxyPassword,
              proxy_url: proxyUrl,
              verify_proxy_ssl: proxyIgnoreSSL ? false : verifyProxySSL,
              verify_proxy_host_ssl: proxyIgnoreSSL
                ? false
                : verifyProxyHostSSL,
              verify_peer_ssl: proxyIgnoreSSL ? false : verifyPeerSSL,
              verify_host_ssl: proxyIgnoreSSL ? false : verifyHostSSL,
              no_proxy: noProxy,
            }
          : {
              proxy_username: '',
              proxy_password: '',
              proxy_url: '',
              verify_proxy_ssl: false,
              verify_proxy_host_ssl: false,
              verify_peer_ssl: false,
              verify_host_ssl: false,
              no_proxy: '',
            }
      )
  }, [
    proxyEnabled,
    proxyUrl,
    proxyIgnoreSSL,
    noProxy,
    proxyUsername,
    proxyPassword,
    verifyProxySSL,
    verifyProxyHostSSL,
    verifyPeerSSL,
    verifyHostSSL,
  ])

  useEffect(() => {
    configurePullOptions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configurePullOptions])

  return {
    configurePullOptions,
  }
}
