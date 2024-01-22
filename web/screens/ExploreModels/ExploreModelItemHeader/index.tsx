/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useMemo } from 'react'

import { Model } from '@janhq/core'
import {
  Button,
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from '@janhq/uikit'

import { atom, useAtomValue } from 'jotai'

import { 
  ChevronDownIcon, 
  CheckCircle2, 
  AlertCircle, 
  DownloadIcon,
  ArrowRight
} from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import ModalCancelDownload from '@/containers/ModalCancelDownload'

import { MainViewState } from '@/constants/screens'

import { useCreateNewThread } from '@/hooks/useCreateNewThread'
import useDownloadModel from '@/hooks/useDownloadModel'
import { useDownloadState } from '@/hooks/useDownloadState'
import { getAssistants } from '@/hooks/useGetAssistants'
import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'
import { useMainViewState } from '@/hooks/useMainViewState'

import { toGibibytes } from '@/utils/converter'

import { serverEnabledAtom } from '@/helpers/atoms/LocalServer.atom'

import { totalRamAtom } from '@/helpers/atoms/SystemBar.atom'

type Props = {
  model: Model
  onClick: () => void
  open: string
}

const ExploreModelItemHeader: React.FC<Props> = ({ model, onClick, open }) => {
  const { downloadModel } = useDownloadModel()
  const { downloadedModels } = useGetDownloadedModels()
  const { modelDownloadStateAtom, downloadStates } = useDownloadState()
  const { requestCreateNewThread } = useCreateNewThread()
  const totalRam = useAtomValue(totalRamAtom)
  const serverEnabled = useAtomValue(serverEnabledAtom)

  const downloadAtom = useMemo(
    () => atom((get) => get(modelDownloadStateAtom)[model.id]),
    [model.id]
  )
  const downloadState = useAtomValue(downloadAtom)
  const { setMainViewState } = useMainViewState()

  const onDownloadClick = useCallback(() => {
    downloadModel(model)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model])

  const isDownloaded = downloadedModels.find((md) => md.id === model.id) != null

  let downloadButton = (
    <Tooltip>
      <TooltipTrigger>
        <Button themes="ghost" onClick={() => onDownloadClick()}>
          <DownloadIcon />
        </Button>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent side="top">
          <span>Download</span>
          <TooltipArrow />
        </TooltipContent>
      </TooltipPortal>
    </Tooltip>
  )

  const onUseModelClick = useCallback(async () => {
    const assistants = await getAssistants()
    if (assistants.length === 0) {
      alert('No assistant available')
      return
    }
    await requestCreateNewThread(assistants[0], model)
    setMainViewState(MainViewState.Thread)
  }, [])

  if (isDownloaded) {
    downloadButton = (
      <Tooltip>
        <TooltipTrigger>
          <Button
            themes="ghost"
            className="min-w-[98px] gap-2"
            onClick={onUseModelClick}
            disabled={serverEnabled}
          >
            <ArrowRight />
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
  }

  if (downloadState != null && downloadStates.length > 0) {
    downloadButton = <ModalCancelDownload model={model} />
  }

  const getLabel = (size: number) => {
    if (size * 1.25 >= totalRam) {
      return (
        <Tooltip>
          <TooltipTrigger>
            <AlertCircle className='text-red-500 dark:text-red-400'/>
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent side="top">
              <span>Not enough RAM</span>
              <TooltipArrow />
            </TooltipContent>
          </TooltipPortal>
        </Tooltip>
      )
    } else {
      return (
        <Tooltip>
          <TooltipTrigger>
            <CheckCircle2 className='text-green-600 dark:text-green-400'/>
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent side="top">
              <span>Recommended</span>
              <TooltipArrow />
            </TooltipContent>
          </TooltipPortal>
        </Tooltip>
      )
    }
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
          {getLabel(model.metadata.size)}
        </div>
        <div className="inline-flex items-center space-x-2">
          <span className="mr-2 font-semibold text-muted-foreground">
            {toGibibytes(model.metadata.size)}
          </span>

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
