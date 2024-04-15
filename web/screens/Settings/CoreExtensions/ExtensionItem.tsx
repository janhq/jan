import { useCallback, useEffect, useState } from 'react'

import {
  BaseExtension,
  Compatibility,
  InstallationState,
  abortDownload,
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

import { Marked, Renderer } from 'marked'

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
    ? installingExtensions.find((e) => e.extensionId === item.name)
        ?.percentage ?? -1
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
    <div className="mx-6 flex w-full items-start justify-between border-b border-border py-6 first:pt-4 last:border-none">
      <div className="flex-1 flex-shrink-0 space-y-1.5">
        <div className="flex items-center gap-x-2">
          <h6 className="text-base font-bold">Additional Dependencies</h6>
        </div>
        {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          <div dangerouslySetInnerHTML={{ __html: description }} />
        }
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

type InstallStateProps = {
  installProgress: number
  compatibility?: Compatibility
  installState: InstallationState
  onInstallClick: () => void
  onCancelClick: () => void
}

const InstallStateIndicator: React.FC<InstallStateProps> = ({
  installProgress,
  compatibility,
  installState,
  onInstallClick,
  onCancelClick,
}) => {
  if (installProgress !== -1) {
    const progress = installProgress * 100
    return (
      <div className="flex h-10 flex-row items-center justify-center space-x-2 rounded-lg bg-[#EFF8FF] px-4 text-primary dark:bg-secondary">
        <button onClick={onCancelClick} className="font-semibold text-primary">
          Cancel
        </button>
        <div className="flex w-[113px] flex-row items-center justify-center space-x-2 rounded-md bg-[#D1E9FF] px-2 py-[2px] dark:bg-black/50">
          <Progress className="h-1 w-[69px]" value={progress} />
          <span className="text-xs font-bold text-primary">
            {progress.toFixed(0)}%
          </span>
        </div>
      </div>
    )
  }

  switch (installState) {
    case 'Installed':
      return (
        <div className="rounded-md bg-secondary px-3 py-1.5 text-sm font-semibold text-gray-400">
          Installed
        </div>
      )
    case 'NotCompatible':
      return (
        <div className="rounded-md bg-secondary px-3 py-1.5 text-sm font-semibold text-gray-400">
          <div className="flex flex-row items-center justify-center gap-1">
            Incompatible{' '}
            <Tooltip>
              <TooltipTrigger className="w-full">
                <InfoCircledIcon />
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent side="top">
                  {compatibility &&
                  !compatibility['platform']?.includes(PLATFORM) ? (
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

const marked: Marked = new Marked({
  renderer: {
    link: (href, title, text) => {
      return Renderer.prototype.link
        ?.apply(this, [href, title, text])
        .replace('<a', "<a class='text-blue-500' target='_blank'")
    },
  },
})

export default ExtensionItem
