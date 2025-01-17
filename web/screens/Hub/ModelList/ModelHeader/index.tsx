import { useCallback } from 'react'

import { Model } from '@janhq/core'
import { Button, Tooltip } from '@janhq/joi'

import { useAtomValue, useSetAtom } from 'jotai'
import { ChevronDownIcon } from 'lucide-react'

import ModalCancelDownload from '@/containers/ModalCancelDownload'

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
}

const ModelItemHeader = ({ model }: Props) => {
  const { downloadModel } = useDownloadModel()
  const downloadingModels = useAtomValue(getDownloadingModelAtom)
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const { requestCreateNewThread } = useCreateNewThread()
  const totalRam = useAtomValue(totalRamAtom)
  const { settings } = useSettings()

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
    downloadModel(model.sources[0].url, model.id, model.name)
  }, [model, downloadModel])

  const isDownloaded = downloadedModels.find((md) => md.id === model.id) != null

  let downloadButton = (
    <div className="group flex h-8 cursor-pointer items-center justify-center rounded-md bg-[hsla(var(--primary-bg))]">
      <div
        className="flex h-full items-center rounded-l-md duration-200 hover:backdrop-brightness-75"
        onClick={onDownloadClick}
      >
        <span className="mx-4 font-medium text-white">Download</span>
      </div>
      <div className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-r-md border-l border-blue-500 duration-200 hover:backdrop-brightness-75">
        <ChevronDownIcon size={14} color="white" />
      </div>
    </div>
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
            theme="ghost"
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
    <div className="rounded-t-md bg-[hsla(var(--app-bg))]">
      <div className="flex items-center justify-between py-2">
        <div className="group flex cursor-pointer items-center gap-2">
          <span className="line-clamp-1 text-base font-medium group-hover:text-blue-500 group-hover:underline">
            {model.name}
          </span>
        </div>
        <div className="inline-flex items-center space-x-2">
          <div className="hidden items-center sm:inline-flex">
            <span className="mr-4 text-sm font-light text-[hsla(var(--text-secondary))]">
              {toGibibytes(model.metadata?.size)}
            </span>
          </div>
          {downloadButton}
        </div>
      </div>
    </div>
  )
}

export default ModelItemHeader
