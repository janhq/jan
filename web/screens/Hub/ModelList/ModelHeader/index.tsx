import { useCallback } from 'react'

import { ModelSource } from '@janhq/core'

import { Button, Tooltip, Dropdown, Badge } from '@janhq/joi'

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
  model: ModelSource
  onSelectedModel: () => void
}

const ModelItemHeader = ({ model, onSelectedModel }: Props) => {
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
    downloadModel(model.models?.[0].id, model.id)
  }, [model, downloadModel])

  const isDownloaded = downloadedModels.some((md) => md.id === model.id)

  let downloadButton = (
    <div className="group flex h-8 cursor-pointer items-center justify-center rounded-md bg-[hsla(var(--primary-bg))]">
      <div
        className="flex h-full items-center rounded-l-md duration-200 hover:backdrop-brightness-75"
        onClick={onDownloadClick}
      >
        <span className="mx-4 font-medium text-white">Download</span>
      </div>
      <Dropdown
        className="min-w-[240px]"
        options={model.models.map((e) => ({
          name: (
            <div className="flex space-x-2">
              <span className="line-clamp-1 max-w-[340px] font-normal">
                {e.id}
              </span>
              <Badge
                theme="secondary"
                className="inline-flex w-[60px] items-center font-medium"
              >
                <span>Default</span>
              </Badge>
            </div>
          ),
          value: e.id,
          suffix: toGibibytes(e.size),
        }))}
      >
        <div className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-r-md border-l border-blue-500 duration-200 hover:backdrop-brightness-75">
          <ChevronDownIcon size={14} color="white" />
        </div>
      </Dropdown>
    </div>
  )

  const isDownloading = downloadingModels.some((md) => md === model.id)

  const onUseModelClick = useCallback(async () => {
    if (assistants.length === 0) {
      toaster({
        title: 'No assistant available.',
        description: `Could not use Model ${model.metadata?.id} as no assistant is available.`,
        type: 'error',
      })
      return
    }
    // await requestCreateNewThread(assistants[0], model)
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
    downloadButton = <ModalCancelDownload modelId={model.id} />
  }

  return (
    <div className="rounded-t-md bg-[hsla(var(--app-bg))]">
      <div className="flex items-center justify-between py-2">
        <div className="group flex cursor-pointer items-center gap-2">
          <span
            className="line-clamp-1 text-base font-medium group-hover:text-blue-500 group-hover:underline"
            onClick={onSelectedModel}
          >
            {model.metadata?.id}
          </span>
        </div>
        <div className="inline-flex items-center space-x-2">
          <div className="hidden items-center sm:inline-flex">
            <span className="mr-4 text-sm font-light text-[hsla(var(--text-secondary))]">
              {toGibibytes(model.models?.[0]?.size)}
            </span>
          </div>
          {downloadButton}
        </div>
      </div>
    </div>
  )
}

export default ModelItemHeader
