import { useEffect, useState } from 'react'

import {
  BaseExtension,
  InstallationPackage,
  InstallationState,
} from '@janhq/core'

import { useAtomValue } from 'jotai'

import InstallStateIndicator from '../InstallStateIndicator'

import { extensionManager } from '@/extension'
import { installingPackageAtom } from '@/helpers/atoms/Extension.atom'

type Props = {
  item: BaseExtension
  installationPackage: InstallationPackage
}

const ExtensionPackage: React.FC<Props> = ({ item, installationPackage }) => {
  const installingPackages = useAtomValue(installingPackageAtom)
  const [installState, setInstallState] =
    useState<InstallationState>('NotRequired')
  const installPackage = installingPackages.find(
    (e) =>
      e.extensionId === item.name && e.packageName === installationPackage.name
  )
  const progress = installPackage ? installPackage.percentage : -1
  const isInstalling = !!installPackage
  useEffect(() => {
    const getExtensionInstallationState = async () => {
      const extension = extensionManager.getByName(item.name)
      if (!extension) return

      const installationPackages = await extension.installationPackages()
      const latestInstallationPackage = installationPackages.find(
        (p) => p.name === installationPackage.name
      )
      setInstallState(
        latestInstallationPackage?.installationState ?? 'NotRequired'
      )
    }
    getExtensionInstallationState()
  }, [item.name, isInstalling, installationPackage.name])
  return (
    <div
      key={installationPackage.name}
      className="mx-4 flex items-start justify-between border-b border-[hsla(var(--app-border))] py-6 first:pt-4 last:border-none"
    >
      <div className="flex-1 flex-shrink-0 space-y-1">
        <div className="flex items-center gap-x-2">
          <h6 className="font-semibold">{installationPackage.name}</h6>
        </div>
        <div
          dangerouslySetInnerHTML={{
            __html: installationPackage.description || '',
          }}
          className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]"
        />
      </div>

      <div className="flex min-w-[150px] flex-row justify-end">
        <InstallStateIndicator
          installProgress={progress}
          installState={installState}
          onInstallClick={() => item.installPackage(installationPackage.name)}
          onCancelClick={() =>
            item.abortPackageInstallation(installationPackage.name)
          }
        />
      </div>
    </div>
  )
}

export default ExtensionPackage
