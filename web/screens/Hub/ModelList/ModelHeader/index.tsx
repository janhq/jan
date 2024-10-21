import { useCallback } from 'react'

import { Model } from '@janhq/core'
import { Button, Badge, Tooltip } from '@janhq/joi'

import { useAtomValue, useSetAtom } from 'jotai'

import { ChevronDownIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import ModalCancelDownload from '@/containers/ModalCancelDownload'

import ModelLabel from '@/containers/ModelLabel'

import { toaster } from '@/containers/Toast'

import { MainViewState } from '@/constants/screens'

import { useCreateNewThread } from '@/hooks/useCreateNewThread'
import useDownloadModel from '@/hooks/useDownloadModel'

import { useSettings } from '@/hooks/useSettings'

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

const ModelItemHeader = ({ model, onClick, open }: Props) => {
  const { downloadModel } = useDownloadModel()
  const downloadingModels = useAtomValue(getDownloadingModelAtom)
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const { requestCreateNewThread } = useCreateNewThread()
  const totalRam = useAtomValue(totalRamAtom)
  const { settings } = useSettings()
  // const [imageLoaded, setImageLoaded] = useState(true)

  const nvidiaTotalVram = useAtomValue(nvidiaTotalVramAtom)
  const setMainViewState = useSetAtom(mainViewStateAtom)

  // Default nvidia returns vram in MB, need to convert to bytes to match the unit of totalRamW
  let ram = nvidiaTotalVram * 1024 * 1024
  if (ram === 0 || settings?.run_mode === 'cpu') {
    ram = totalRam
  }
  const serverEnabled = useAtomValue(serverEnabledAtom)
  const assistants = useAtomValue(assistantsAtom)

  const onDownloadClick = useCallback(() => {
    downloadModel(model.sources[0].url, model.id)
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

  const isDownloading = downloadingModels.some((md) => md === model.id)

  const onUseModelClick = useCallback(async () => {
    if (assistants.length === 0) {
      toaster({
        title: 'No assistant available.',
        description: `Could not use Model ${model.name} as no assistant is available.`,
        type: 'error',
      })
      return
    }
    await requestCreateNewThread(assistants[0], model)
    setMainViewState(MainViewState.Thread)
  }, [assistants, model, requestCreateNewThread, setMainViewState])

  if (isDownloaded) {
    downloadButton = (
      <Tooltip
        trigger={
          <Button
            onClick={onUseModelClick}
            disabled={serverEnabled}
            data-testid={`use-model-btn-${model.id}`}
            variant="outline"
            className="min-w-[98px]"
          >
            Use
          </Button>
        }
        disabled={!serverEnabled}
        content="Threads are disabled while the server is running"
      />
    )
  } else if (isDownloading) {
    downloadButton = <ModalCancelDownload model={model} />
  }

  return (
    <div
      className="cursor-pointer rounded-t-md bg-[hsla(var(--app-bg))]"
      onClick={onClick}
    >
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="line-clamp-1 text-base font-semibold">
            {model.name}
          </span>
          <EngineBadge engine={model.engine} />
        </div>
        <div className="inline-flex items-center space-x-2">
          <div className="hidden items-center sm:inline-flex">
            <span className="mr-4 font-semibold">
              {toGibibytes(model.metadata?.size)}
            </span>
            <ModelLabel metadata={model.metadata} />
          </div>
          {downloadButton}
          <ChevronDownIcon
            className={twMerge(
              'h-5 w-5 flex-none',
              open === model.id && 'rotate-180'
            )}
          />
        </div>
      </div>
    </div>
  )
}

type EngineBadgeProps = {
  engine: string
}

const EngineBadge = ({ engine }: EngineBadgeProps) => {
  const title = 'TensorRT-LLM'

  switch (engine) {
    case 'nitro-tensorrt-llm':
      return <Badge title={title}>{title}</Badge>
    default:
      return null
  }
}

export default ModelItemHeader
