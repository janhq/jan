import { useCallback, useEffect, useState } from 'react'

import {
  Compatibility,
  GpuSetting,
  InstallationState,
  abortDownload,
  systemInformations,
} from '@janhq/core'
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
  const [isGpuSupported, setIsGpuSupported] = useState<boolean>(false)

  const isInstalling = installingExtensions.some(
    (e) => e.extensionId === item.name
  )

  const progress = isInstalling
    ? installingExtensions.find((e) => e.extensionId === item.name)
        ?.percentage ?? -1
    : -1

  useEffect(() => {
    const getSystemInfos = async () => {
      const info = await systemInformations()
      if (!info) {
        setIsGpuSupported(false)
        return
      }

      const gpuSettings: GpuSetting | undefined = info.gpuSetting
      if (!gpuSettings || gpuSettings.gpus.length === 0) {
        setIsGpuSupported(false)
        return
      }

      const arch = gpuSettings.gpus[0].arch
      if (!arch) {
        setIsGpuSupported(false)
        return
      }

      const supportedGpuArch = ['turing', 'ampere', 'ada']
      setIsGpuSupported(supportedGpuArch.includes(arch))
    }
    getSystemInfos()
  }, [])

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

  const onCancelInstallingClick = () => {
    const extension = installingExtensions.find(
      (e) => e.extensionId === item.name
    )
    if (extension?.localPath) {
      abortDownload(extension.localPath)
    }
  }

  return (
    <div className="flex w-full items-start justify-between border-b border-border py-4 first:pt-4 last:border-none">
      <div className="flex-1 flex-shrink-0 space-y-1.5">
        <div className="flex items-center gap-x-2">
          <h6 className="text-sm font-semibold capitalize">
            TensorRT-LLM Extension
          </h6>
          <p className="whitespace-pre-wrap text-sm font-semibold leading-relaxed ">
            v{item.version}
          </p>
        </div>
        <p className="whitespace-pre-wrap leading-relaxed ">
          {item.description}
        </p>
      </div>
      {(!compatibility || compatibility['platform']?.includes(PLATFORM)) &&
      isGpuSupported ? (
        <InstallStateIndicator
          installProgress={progress}
          installState={installState}
          onInstallClick={onInstallClick}
          onCancelClick={onCancelInstallingClick}
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
                  {compatibility ? (
                    <span>
                      Only available on{' '}
                      {compatibility?.platform
                        ?.map((e: string) =>
                          e === 'win32'
                            ? 'Windows'
                            : e === 'linux'
                              ? 'Linux'
                              : 'MacOS'
                        )
                        .join(', ')}
                    </span>
                  ) : (
                    <span>
                      Your GPUs are not compatible with this extension
                    </span>
                  )}
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
  onCancelClick: () => void
}

const InstallStateIndicator: React.FC<InstallStateProps> = ({
  installProgress,
  installState,
  onInstallClick,
  onCancelClick,
}) => {
  // TODO: NamH support dark mode for this
  if (installProgress !== -1) {
    const progress = installProgress * 100
    return (
      <div className="flex h-10 flex-row items-center justify-center space-x-2 rounded-md bg-[#EFF8FF] px-4 text-primary">
        <button onClick={onCancelClick} className="font-semibold text-primary">
          Cancel
        </button>
        <div className="flex w-[113px] flex-row items-center justify-center space-x-2 rounded-md bg-[#D1E9FF] px-2 py-[2px]">
          <Progress className="h-1 w-[69px]" value={progress} />
          <span className="text-xs font-bold text-primary">
            {progress.toFixed(0)}%
          </span>
        </div>
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
