import React, { useCallback } from 'react'

import { LlmEngine, Model } from '@janhq/core'
import { Button, Badge, Tooltip } from '@janhq/joi'

import { useAtomValue, useSetAtom } from 'jotai'

import { ChevronDownIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import ModalCancelDownload from '@/containers/ModalCancelDownload'

import ModelLabel from '@/containers/ModelLabel'

import { toaster } from '@/containers/Toast'

import { MainViewState } from '@/constants/screens'

import useCortex from '@/hooks/useCortex'

import useThreads from '@/hooks/useThreads'

import { toGibibytes } from '@/utils/converter'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { assistantsAtom } from '@/helpers/atoms/Assistant.atom'
import { serverEnabledAtom } from '@/helpers/atoms/LocalServer.atom'

import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

type Props = {
  model: Model
  onClick: () => void
  open: string
}

const ModelItemHeader: React.FC<Props> = ({ model, onClick, open }) => {
  const { downloadModel } = useCortex()
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const { createThread } = useThreads()
  const setMainViewState = useSetAtom(mainViewStateAtom)

  const serverEnabled = useAtomValue(serverEnabledAtom)
  const assistants = useAtomValue(assistantsAtom)

  const onDownloadClick = useCallback(() => {
    downloadModel(model.id)
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

  const isDownloading = false // TODO: NamH get this data from download states downloadingModels.some((md) => md.id === model.id)

  const onUseModelClick = useCallback(async () => {
    if (assistants.length === 0) {
      toaster({
        title: 'No assistant available.',
        description: `Could not use Model ${model.id} as no assistant is available.`,
        type: 'error',
      })
      return
    }
    await createThread(model.id, assistants[0])
    setMainViewState(MainViewState.Thread)
  }, [assistants, model, createThread, setMainViewState])

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
              {toGibibytes(model.metadata?.size ?? 0)}
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
  engine?: LlmEngine
}

const EngineBadge = ({ engine }: EngineBadgeProps) => {
  const title = 'TensorRT-LLM'

  switch (engine) {
    case 'cortex.tensorrt-llm':
      return <Badge title={title}>{title}</Badge>
    default:
      return null
  }
}

export default ModelItemHeader
