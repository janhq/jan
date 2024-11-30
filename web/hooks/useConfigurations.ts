import { useCallback, useEffect } from 'react'

import { ExtensionTypeEnum, ModelExtension } from '@janhq/core'
import { useAtomValue } from 'jotai'

import { extensionManager } from '@/extension'
import {
  ignoreSslAtom,
  proxyAtom,
  proxyEnabledAtom,
} from '@/helpers/atoms/AppConfig.atom'

export const useConfigurations = () => {
  const proxyEnabled = useAtomValue(proxyEnabledAtom)
  const proxyUrl = useAtomValue(proxyAtom)
  const proxyIgnoreSSL = useAtomValue(ignoreSslAtom)

  const configurePullOptions = useCallback(() => {
    extensionManager
      .get<ModelExtension>(ExtensionTypeEnum.Model)
      ?.configurePullOptions(
        proxyEnabled
          ? {
              proxy_url: proxyUrl,
              verify_peer_ssl: !proxyIgnoreSSL,
            }
          : {
              proxy_url: '',
              verify_peer_ssl: false,
            }
      )
  }, [proxyEnabled, proxyUrl, proxyIgnoreSSL])

  useEffect(() => {
    configurePullOptions()
  }, [])

  return {
    configurePullOptions,
  }
}
