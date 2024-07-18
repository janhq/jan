import { useCallback, useMemo } from 'react'

import { HuggingFaceRepoData, Quantization } from '@janhq/core'
import { Badge, Button, Progress } from '@janhq/joi'

import { useAtomValue, useSetAtom } from 'jotai'

import { toaster } from '@/containers/Toast'

import useAssistantQuery from '@/hooks/useAssistantQuery'

import useCortex from '@/hooks/useCortex'

import {
  addDownloadModelStateAtom,
  downloadStateListAtom,
} from '@/hooks/useDownloadState'
import useThreads from '@/hooks/useThreads'

import { formatDownloadPercentage, toGibibytes } from '@/utils/converter'

import { downloadProgress } from '@/utils/download'

import { MainViewState, mainViewStateAtom } from '@/helpers/atoms/App.atom'

import { importHuggingFaceModelStageAtom } from '@/helpers/atoms/HuggingFace.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

type Props = {
  index: number
  modelHandle: string
  fileName: string
  fileSize?: number
  quantization?: Quantization
}

const ModelDownloadRow: React.FC<Props> = ({
  modelHandle,
  fileName,
  fileSize = 0,
  quantization,
}) => {
  return (
    <div className="flex w-[662px] flex-row items-center justify-between space-x-1 rounded border border-[hsla(var(--app-border))] p-3">
      <div className="flex">
        {quantization && (
          <Badge variant="soft" className="mr-1">
            {quantization}
          </Badge>
        )}
        <h1 className="mr-5 line-clamp-1 font-medium text-[hsla(var(--text-secondary))]">
          {fileName}
        </h1>
        <Badge theme="secondary">{toGibibytes(fileSize)}</Badge>
      </div>

      <DownloadContainer modelHandle={modelHandle} fileName={fileName} />
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
  const setHfImportingStage = useSetAtom(importHuggingFaceModelStageAtom)
  const { createThread } = useThreads()

  const { data: assistants } = useAssistantQuery()

  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const allDownloadState = useAtomValue(downloadStateListAtom)

  const persistModelId = modelHandle
    .replaceAll('/', '_')
    .concat('_')
    .concat(fileName)

  const downloadState = allDownloadState.find((s) => s.id === persistModelId)

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

    await createThread(fileName, {
      ...assistants[0],
      model: fileName,
    })
    setHfImportingStage('NONE')
    setMainViewState(MainViewState.Thread)
  }, [
    setHfImportingStage,
    setMainViewState,
    createThread,
    fileName,
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
          onClick={onUseModelClick}
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

export default ModelDownloadRow
