import { useCallback } from 'react'

import { Model } from '@janhq/core'
import {
  Badge,
  Button,
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from '@janhq/uikit'

import { useAtomValue, useSetAtom } from 'jotai'

import { ChevronDownIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import ModalCancelDownload from '@/containers/ModalCancelDownload'

import { MainViewState } from '@/constants/screens'

import { useCreateNewThread } from '@/hooks/useCreateNewThread'
import useDownloadModel from '@/hooks/useDownloadModel'

import { toGibibytes } from '@/utils/converter'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { assistantsAtom } from '@/helpers/atoms/Assistant.atom'
import { serverEnabledAtom } from '@/helpers/atoms/LocalServer.atom'

import {
  downloadedModelsAtom,
  getDownloadingModelAtom,
} from '@/helpers/atoms/Model.atom'
import {
  nvidiaTotalVramAtom,
  totalRamAtom,
} from '@/helpers/atoms/SystemBar.atom'

type Props = {
  model: Model
  onClick: () => void
  open: string
}

const getLabel = (size: number, ram: number) => {
  if (size * 1.25 >= ram) {
    return (
      <Badge className="rounded-md" themes="danger">
        Not enough RAM
      </Badge>
    )
  } else {
    return (
      <Badge className="rounded-md" themes="success">
        Recommended
      </Badge>
    )
  }
}

const ExploreModelItemHeader: React.FC<Props> = ({ model, onClick, open }) => {
  const { downloadModel } = useDownloadModel()
  const downloadingModels = useAtomValue(getDownloadingModelAtom)
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const { requestCreateNewThread } = useCreateNewThread()
  const totalRam = useAtomValue(totalRamAtom)

  const nvidiaTotalVram = useAtomValue(nvidiaTotalVramAtom)
  const setMainViewState = useSetAtom(mainViewStateAtom)

  // Default nvidia returns vram in MB, need to convert to bytes to match the unit of totalRamW
  let ram = nvidiaTotalVram * 1024 * 1024
  if (ram === 0) {
    ram = totalRam
  }
  const serverEnabled = useAtomValue(serverEnabledAtom)
  const assistants = useAtomValue(assistantsAtom)

  const onDownloadClick = useCallback(() => {
    downloadModel(model)
  }, [model, downloadModel])

  const isDownloaded = downloadedModels.find((md) => md.id === model.id) != null

  let downloadButton = (
    <Button
      className="z-50"
      onClick={(e) => {
        e.stopPropagation()
        onDownloadClick()
      }}
    >
      Download
    </Button>
  )

  const isDownloading = downloadingModels.some((md) => md.id === model.id)

  const onUseModelClick = useCallback(async () => {
    if (assistants.length === 0) {
      alert('No assistant available')
      return
    }
    await requestCreateNewThread(assistants[0], model)
    setMainViewState(MainViewState.Thread)
  }, [assistants, model, requestCreateNewThread, setMainViewState])

  if (isDownloaded) {
    downloadButton = (
      <Tooltip>
        <TooltipTrigger>
          <Button
            themes="secondaryBlue"
            className="min-w-[98px]"
            onClick={onUseModelClick}
            disabled={serverEnabled}
          >
            Use
          </Button>
        </TooltipTrigger>
        {serverEnabled && (
          <TooltipPortal>
            <TooltipContent side="top">
              <span>Threads are disabled while the server is running</span>
              <TooltipArrow />
            </TooltipContent>
          </TooltipPortal>
        )}
      </Tooltip>
    )
  } else if (isDownloading) {
    downloadButton = <ModalCancelDownload model={model} />
  }

  return (
    <div
      className="cursor-pointer rounded-t-md bg-background"
      onClick={onClick}
    >
      {model.metadata.cover && (
        <div className="relative h-full w-full ">
          <img
            src={model.metadata.cover}
            className="h-[250px] w-full object-cover"
            alt={`Cover - ${model.id}`}
          />
        </div>
      )}
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-2">
          <span className="font-bold">{model.name}</span>
        </div>
        <div className="inline-flex items-center space-x-2">
          <span className="mr-4 font-semibold text-muted-foreground">
            {toGibibytes(model.metadata.size)}
          </span>
          {getLabel(model.metadata.size, ram)}

          {downloadButton}
          <ChevronDownIcon
            className={twMerge(
              'h-5 w-5 flex-none text-gray-400',
              open === model.id && 'rotate-180'
            )}
          />
        </div>
      </div>
    </div>
  )
}

export default ExploreModelItemHeader
