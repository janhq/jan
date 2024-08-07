import React, { useCallback, useMemo } from 'react'

import Image from 'next/image'

import { Button, Progress } from '@janhq/joi'

import { useAtomValue, useSetAtom } from 'jotai'

import { toaster } from '@/containers/Toast'

import useAbortDownload from '@/hooks/useAbortDownload'
import useAssistantQuery from '@/hooks/useAssistantQuery'
import { downloadStateListAtom } from '@/hooks/useDownloadState'
import useModelDownloadMutation from '@/hooks/useModelDownloadMutation'
import { QuickStartModel } from '@/hooks/useModelHub'
import useThreads from '@/hooks/useThreads'

import { formatDownloadPercentage, toGibibytes } from '@/utils/converter'
import { downloadProgress } from '@/utils/download'

import { MainViewState, mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { localModelModalStageAtom } from '@/helpers/atoms/DownloadLocalModel.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

type Props = {
  model: QuickStartModel
}

const SliderItem: React.FC<Props> = ({ model }) => {
  const url = new URL(model.url)
  const pathArray = url.pathname.split('/').filter((segment) => segment !== '')

  const owner = pathArray[0]
  const repo = pathArray[1]
  const fileName = pathArray[pathArray.length - 1]
  const repoId = `${owner}/${repo}`

  const shouldShowOwnerLogo = model.logo !== undefined && model.logo !== ''

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-[hsla(var(--app-border))] p-4">
      <div className="gap-1.5">
        <span
          className="line-clamp-1 text-base font-semibold leading-6"
          title={model.model_name}
        >
          {model.model_name}
        </span>
        <div className="mt-1.5 flex items-center gap-1.5">
          {shouldShowOwnerLogo && (
            <Image width={20} height={20} src={model.logo} alt={model.author} />
          )}
          <span className="text-sm font-medium leading-4 text-[hsla(var(--text-secondary))]">
            {model.author}
          </span>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs font-medium leading-3 text-[hsla(var(--text-secondary))]">
          {toGibibytes(model.size)}
        </span>
        <DownloadContainer modelHandle={repoId} fileName={fileName} />
      </div>
    </div>
  )
}

type DownloadContainerProps = {
  modelHandle: string
  fileName: string
}

const DownloadContainer: React.FC<DownloadContainerProps> = ({
  modelHandle,
  fileName,
}) => {
  const downloadModelMutation = useModelDownloadMutation()
  const setMainViewState = useSetAtom(mainViewStateAtom)
  const { createThread } = useThreads()
  const { data: assistants } = useAssistantQuery()

  const { abortDownload } = useAbortDownload()

  const setDownloadLocalModelModalStage = useSetAtom(localModelModalStageAtom)

  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const allDownloadState = useAtomValue(downloadStateListAtom)

  const persistModelId = modelHandle
    .replaceAll('/', '_')
    .concat('_')
    .concat(fileName)

  const downloadState = allDownloadState.find((s) => s.id == persistModelId)

  const downloadedModel = useMemo(
    () => downloadedModels.find((m) => m.model === persistModelId),
    [downloadedModels, persistModelId]
  )

  const onDownloadClick = useCallback(() => {
    downloadModelMutation.mutate({
      modelId: modelHandle,
      fileName: fileName,
      persistedModelId: persistModelId,
    })
  }, [downloadModelMutation, modelHandle, fileName, persistModelId])

  const onUseModelClick = useCallback(async () => {
    if (!assistants || assistants.length === 0) {
      toaster({
        title: 'No assistant available.',
        description: 'Please create an assistant to create a new thread',
        type: 'error',
      })
      return
    }

    await createThread(persistModelId, {
      ...assistants[0],
      model: persistModelId,
    })
    setDownloadLocalModelModalStage('NONE', undefined)
    setMainViewState(MainViewState.Thread)
  }, [
    setDownloadLocalModelModalStage,
    setMainViewState,
    createThread,
    persistModelId,
    assistants,
  ])

  const onAbortDownloadClick = useCallback(() => {
    abortDownload(persistModelId)
  }, [abortDownload, persistModelId])

  return (
    <div className="flex items-center justify-center">
      {downloadedModel ? (
        <Button
          variant="soft"
          className="min-w-[98px]"
          onClick={(e) => {
            e.stopPropagation()
            onUseModelClick()
          }}
        >
          Use
        </Button>
      ) : downloadState != null ? (
        <Button variant="soft">
          <div className="flex items-center space-x-2">
            <span className="inline-block" onClick={onAbortDownloadClick}>
              Cancel
            </span>
            <Progress
              className="inline-block h-2 w-[80px]"
              value={
                formatDownloadPercentage(downloadProgress(downloadState), {
                  hidePercentage: true,
                }) as number
              }
            />
            <span className="tabular-nums">
              {formatDownloadPercentage(downloadProgress(downloadState))}
            </span>
          </div>
        </Button>
      ) : (
        <Button
          onClick={onDownloadClick}
          theme="ghost"
          className="bg-[hsla(var(--secondary-bg))]"
        >
          Download
        </Button>
      )}
    </div>
  )
}

export default SliderItem
