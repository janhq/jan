import { useEffect, useState } from 'react'

import { Compatibility } from '@janhq/core'
import {
  Button,
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from '@janhq/uikit'

import { InfoCircledIcon } from '@radix-ui/react-icons'
import { useAtomValue } from 'jotai'

import useGpuSetting from '@/hooks/useGpuSetting'

import { formatExtensionsName } from '@/utils/converter'

import { extensionManager } from '@/extension'
import Extension from '@/extension/Extension'
import { ignoreSslAtom, proxyAtom } from '@/helpers/atoms/AppConfig.atom'

type Props = {
  item: Extension
}

const TensorRtExtensionItem: React.FC<Props> = ({ item }) => {
  const { getGpuSettings } = useGpuSetting()
  const proxy = useAtomValue(proxyAtom)
  const ignoreSSL = useAtomValue(ignoreSslAtom)
  const [compatibility, setCompatibility] = useState<Compatibility | undefined>(
    undefined
  )

  useEffect(() => {
    const extension = extensionManager.get(item.name ?? '')
    if (extension) setCompatibility(extension.compatibility?.())
  }, [setCompatibility, item.name])

  const onInstallClick = async () => {
    const result = extensionManager.get(item.name ?? '')
    if (result) {
      const gpuSettings = await getGpuSettings()
      if (
        'downloadRunner' in result &&
        typeof result.downloadRunner === 'function'
      )
        result.downloadRunner(gpuSettings, { proxy, ignoreSSL })
    }
  }

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
      {!compatibility || compatibility['platform']?.includes(PLATFORM) ? (
        <Button themes="secondaryBlue" size="sm" onClick={onInstallClick}>
          Install
        </Button>
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

export default TensorRtExtensionItem
