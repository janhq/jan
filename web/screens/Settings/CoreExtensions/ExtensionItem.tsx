import { useCallback, useEffect, useState } from 'react'

import {
  BaseExtension,
  Compatibility,
  InstallationState,
  abortDownload,
} from '@janhq/core'

import { useAtomValue } from 'jotai'

import { marked } from '@/utils/marked'

import InstallStateIndicator from '../InstallStateIndicator'

import { extensionManager } from '@/extension'
import { installingExtensionAtom } from '@/helpers/atoms/Extension.atom'

type Props = {
  item: BaseExtension
}

const ExtensionItem: React.FC<Props> = ({ item }) => {
  const [compatibility, setCompatibility] = useState<Compatibility | undefined>(
    undefined
  )
  const [installState, setInstallState] =
    useState<InstallationState>('NotRequired')
  const installingExtensions = useAtomValue(installingExtensionAtom)
  const isInstalling = installingExtensions.some(
    (e) => e.extensionId === item.name
  )

  const progress = isInstalling
    ? (installingExtensions.find((e) => e.extensionId === item.name)
        ?.percentage ?? -1)
    : -1

  useEffect(() => {
    const getExtensionInstallationState = async () => {
      const extension = extensionManager.getByName(item.name)
      if (!extension) return

      if (typeof extension?.installationState === 'function') {
        const installState = await extension.installationState()
        setInstallState(installState)
      }
    }

    getExtensionInstallationState()
  }, [item.name, isInstalling])

  useEffect(() => {
    const extension = extensionManager.getByName(item.name)
    if (!extension) return
    setCompatibility(extension.compatibility())
  }, [setCompatibility, item.name])

  const onInstallClick = useCallback(async () => {
    const extension = extensionManager.getByName(item.name)
    if (!extension) return

    await extension.install()
  }, [item.name])

  const onCancelInstallingClick = () => {
    const extension = installingExtensions.find(
      (e) => e.extensionId === item.name
    )
    if (extension?.localPath) {
      abortDownload(extension.localPath)
    }
  }

  const description = marked.parse(item.description ?? '', { async: false })

  return (
    <div className="mx-4 flex items-start justify-between border-b border-[hsla(var(--app-border))] py-6 first:pt-4 last:border-none">
      <div className="flex-1 flex-shrink-0 space-y-1">
        <div className="flex items-center gap-x-2">
          <h6 className="font-semibold">Additional Dependencies</h6>
        </div>
        <div
          dangerouslySetInnerHTML={{ __html: description }}
          className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]"
        />
      </div>

      <div className="flex min-w-[150px] flex-row justify-end">
        <InstallStateIndicator
          installProgress={progress}
          installState={installState}
          compatibility={compatibility}
          onInstallClick={onInstallClick}
          onCancelClick={onCancelInstallingClick}
        />
      </div>
    </div>
  )
}

export default ExtensionItem
