import { useState, useEffect, useMemo } from 'react'

import { useAtomValue } from 'jotai'

import { isLocalEngine } from '@/utils/modelEngine'

import { extensionManager } from '@/extension'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'
import { threadsAtom } from '@/helpers/atoms/Thread.atom'

export function useStarterScreen() {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const threads = useAtomValue(threadsAtom)

  const isDownloadALocalModel = useMemo(
    () => downloadedModels.some((x) => isLocalEngine(x.engine)),
    [downloadedModels]
  )

  const [extensionHasSettings, setExtensionHasSettings] = useState<
    { name?: string; setting: string; apiKey: string; provider: string }[]
  >([])

  useEffect(() => {
    const getAllSettings = async () => {
      const extensionsMenu: {
        name?: string
        setting: string
        apiKey: string
        provider: string
      }[] = []
      const extensions = extensionManager.getAll()

      for (const extension of extensions) {
        if (typeof extension.getSettings === 'function') {
          const settings = await extension.getSettings()

          if (
            (settings && settings.length > 0) ||
            (await extension.installationState()) !== 'NotRequired'
          ) {
            extensionsMenu.push({
              name: extension.productName,
              setting: extension.name,
              apiKey:
                'apiKey' in extension && typeof extension.apiKey === 'string'
                  ? extension.apiKey
                  : '',
              provider:
                'provider' in extension &&
                typeof extension.provider === 'string'
                  ? extension.provider
                  : '',
            })
          }
        }
      }
      setExtensionHasSettings(extensionsMenu)
    }
    getAllSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isAnyRemoteModelConfigured = useMemo(
    () => extensionHasSettings.some((x) => x.apiKey.length > 1),
    [extensionHasSettings]
  )

  const isShowStarterScreen = useMemo(
    () =>
      !isAnyRemoteModelConfigured && !isDownloadALocalModel && !threads.length,
    [isAnyRemoteModelConfigured, isDownloadALocalModel, threads]
  )

  return {
    extensionHasSettings,
    isShowStarterScreen,
  }
}
