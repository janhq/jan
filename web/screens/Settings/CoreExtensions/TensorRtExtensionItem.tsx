import { useCallback, useEffect, useState } from 'react'

import { Compatibility, InstallationState } from '@janhq/core'
import {
  Button,
  Progress,
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from '@janhq/uikit'

import { InfoCircledIcon } from '@radix-ui/react-icons'
import { useAtomValue } from 'jotai'

import { formatExtensionsName } from '@/utils/converter'

import { extensionManager } from '@/extension'
import Extension from '@/extension/Extension'
import { installingExtensionAtom } from '@/helpers/atoms/Extension.atom'

type Props = {
  item: Extension
}

const TensorRtExtensionItem: React.FC<Props> = ({ item }) => {
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
    ? installingExtensions.find((e) => e.extensionId === item.name)
        ?.percentage ?? -1
    : -1

  useEffect(() => {
    const getExtensionInstallationState = async () => {
      const extension = extensionManager.get(item.name ?? '')
      if (!extension) return

      if (typeof extension?.installationState === 'function') {
        const installState = await extension.installationState()
        setInstallState(installState)
      }
    }

    getExtensionInstallationState()
  }, [item.name, isInstalling])

  useEffect(() => {
    const extension = extensionManager.get(item.name ?? '')
    if (!extension) return
    setCompatibility(extension.compatibility())
  }, [setCompatibility, item.name])

  const onInstallClick = useCallback(async () => {
    const extension = extensionManager.get(item.name ?? '')
    if (!extension) return

    await extension.install()
  }, [item.name])

  return (
    <div className="flex w-full items-start justify-between border-b border-border py-4 first:pt-4 last:border-none">
      <div className="flex-1 flex-shrink-0 space-y-1.5">
        <div className="flex gap-x-2">
          <h6 className="text-sm font-semibold capitalize">
            {formatExtensionsName(item.name ?? item.description ?? '')}
          </h6>
          <p className="whitespace-pre-wrap font-semibold leading-relaxed ">
            v{item.version}
          </p>
        </div>
        <p className="whitespace-pre-wrap leading-relaxed ">
          {item.description}
        </p>
      </div>
      {!compatibility || compatibility['platform']?.includes('win32') ? (
        <InstallStateIndicator
          installProgress={progress}
          installState={installState}
          onInstallClick={onInstallClick}
        />
      ) : (
        <div className="rounded-md bg-secondary px-3 py-1.5 text-sm font-semibold text-gray-400">
          <div className="flex flex-row items-center justify-center gap-1">
            Incompatible{' '}
            <Tooltip>
              <TooltipTrigger className="w-full">
                <InfoCircledIcon />
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent side="top">
                  <span>
                    Only available on{' '}
                    {compatibility.platform
                      ?.map((e: string) =>
                        e === 'win32'
                          ? 'Windows'
                          : e === 'linux'
                            ? 'Linux'
                            : 'MacOS'
                      )
                      .join(', ')}
                  </span>
                  <TooltipArrow />
                </TooltipContent>
              </TooltipPortal>
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  )
}

type InstallStateProps = {
  installProgress: number
  installState: InstallationState
  onInstallClick: () => void
}

const InstallStateIndicator: React.FC<InstallStateProps> = ({
  installProgress,
  installState,
  onInstallClick,
}) => {
  if (installProgress !== -1) {
    const progress = installProgress * 100
    return (
      <div className="flex flex-row items-center justify-center space-x-2 rounded-md bg-secondary px-2 py-[2px]">
        <Progress className="h-2 w-24" value={progress} />
        <span className="text-xs font-bold text-muted-foreground">
          {progress.toFixed(2)}%
        </span>
      </div>
    )
  }

  // TODO: NamH check for dark mode here
  switch (installState) {
    case 'Installed':
      return (
        <div className="rounded-md bg-secondary px-3 py-1.5 text-sm font-semibold text-gray-400">
          Installed
        </div>
      )
    case 'NotInstalled':
      return (
        <Button themes="secondaryBlue" size="sm" onClick={onInstallClick}>
          Install
        </Button>
      )
    default:
      return <div></div>
  }
}

export default TensorRtExtensionItem
