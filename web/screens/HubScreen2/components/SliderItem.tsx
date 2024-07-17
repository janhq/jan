import React, { useCallback, useMemo } from 'react'

import Image from 'next/image'

import { Button, Progress } from '@janhq/joi'

import { useAtomValue, useSetAtom } from 'jotai'

import { toaster } from '@/containers/Toast'

import useAssistantQuery from '@/hooks/useAssistantQuery'
import useCortex from '@/hooks/useCortex'
import {
  addDownloadModelStateAtom,
  downloadStateListAtom,
} from '@/hooks/useDownloadState'
import { QuickStartModel } from '@/hooks/useModelHub'
import useThreads from '@/hooks/useThreads'

import { formatDownloadPercentage } from '@/utils/converter'
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
    <div className="flex justify-between rounded-2xl border border-[hsla(var(--app-border))] p-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-base font-semibold leading-6">
          {model.model_name}
        </span>
        <div className="flex items-center gap-1.5">
          {shouldShowOwnerLogo && (
            <Image width={20} height={20} src={model.logo} alt={model.author} />
          )}
          <span className="text-sm font-medium leading-4">{model.author}</span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-4">
        <div className="h-12 w-12 rounded-full bg-transparent" />
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
  const { downloadModel, abortDownload } = useCortex()
  const addDownloadState = useSetAtom(addDownloadModelStateAtom)
  const setMainViewState = useSetAtom(mainViewStateAtom)
  const { createThread } = useThreads()
  const { data: assistants } = useAssistantQuery()

  const setDownloadLocalModelModalStage = useSetAtom(localModelModalStageAtom)

  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const allDownloadState = useAtomValue(downloadStateListAtom)

  const persistModelId = modelHandle
    .replaceAll('/', '_')
    .concat('_')
    .concat(fileName)

  const downloadState = allDownloadState.find((s) => s.id == persistModelId)

  const downloadedModel = useMemo(
    () => downloadedModels.find((m) => m.id === persistModelId),
    [downloadedModels, persistModelId]
  )

  const onDownloadClick = useCallback(async () => {
    addDownloadState(persistModelId)
    await downloadModel(modelHandle, fileName, persistModelId)
  }, [addDownloadState, downloadModel, modelHandle, fileName, persistModelId])

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
        <Button onClick={onDownloadClick}>Download</Button>
      )}
    </div>
  )
}

export default SliderItem
