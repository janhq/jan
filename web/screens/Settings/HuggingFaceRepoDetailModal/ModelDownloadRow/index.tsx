import { useCallback, useMemo } from 'react'

import {
  DownloadState,
  HuggingFaceRepoData,
  Model,
  Quantization,
} from '@janhq/core'
import { Badge, Button, Progress } from '@janhq/joi'

import { useAtomValue, useSetAtom } from 'jotai'

import { MainViewState } from '@/constants/screens'

import { useCreateNewThread } from '@/hooks/useCreateNewThread'
import useDownloadModel from '@/hooks/useDownloadModel'
import { modelDownloadStateAtom } from '@/hooks/useDownloadState'

import { formatDownloadPercentage, toGibibytes } from '@/utils/converter'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { assistantsAtom } from '@/helpers/atoms/Assistant.atom'

import { importHuggingFaceModelStageAtom } from '@/helpers/atoms/HuggingFace.atom'
import {
  defaultModelAtom,
  downloadedModelsAtom,
} from '@/helpers/atoms/Model.atom'

type Props = {
  index: number
  repoData: HuggingFaceRepoData
  downloadUrl: string
  fileName: string
  fileSize?: number
  quantization?: Quantization
}

const ModelDownloadRow: React.FC<Props> = ({
  repoData,
  downloadUrl,
  fileName,
  fileSize = 0,
  quantization,
}) => {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const { downloadModel, abortModelDownload } = useDownloadModel()
  const allDownloadStates = useAtomValue(modelDownloadStateAtom)
  const downloadState: DownloadState | undefined = allDownloadStates[fileName]

  const { requestCreateNewThread } = useCreateNewThread()
  const setMainViewState = useSetAtom(mainViewStateAtom)
  const assistants = useAtomValue(assistantsAtom)
  const isDownloaded = downloadedModels.find((md) => md.id === fileName) != null

  const setHfImportingStage = useSetAtom(importHuggingFaceModelStageAtom)
  const defaultModel = useAtomValue(defaultModelAtom)

  const model = useMemo(() => {
    if (!defaultModel) {
      return undefined
    }

    const model: Model = {
      ...defaultModel,
      sources: [
        {
          url: downloadUrl,
          filename: fileName,
        },
      ],
      id: fileName,
      name: fileName,
      created: Date.now(),
      metadata: {
        author: 'User',
        tags: repoData.tags,
        size: fileSize,
      },
    }
    console.log('NamH model: ', JSON.stringify(model))
    return model
  }, [fileName, fileSize, repoData, downloadUrl, defaultModel])

  const onAbortDownloadClick = useCallback(() => {
    if (model) {
      abortModelDownload(model)
    }
  }, [model, abortModelDownload])

  const onDownloadClick = useCallback(async () => {
    if (model) {
      downloadModel(model)
    }
  }, [model, downloadModel])

  const onUseModelClick = useCallback(async () => {
    if (assistants.length === 0) {
      alert('No assistant available')
      return
    }
    await requestCreateNewThread(assistants[0], model)
    setMainViewState(MainViewState.Thread)
    setHfImportingStage('NONE')
  }, [
    assistants,
    model,
    requestCreateNewThread,
    setMainViewState,
    setHfImportingStage,
  ])

  if (!model) {
    return null
  }

  return (
    <div className="flex w-[662px] flex-row items-center justify-between space-x-1 rounded border border-[hsla(var(--app-border))] p-3">
      <div className="flex">
        {quantization && <Badge className="mr-1">{quantization}</Badge>}

        <h1 className="mr-5 line-clamp-1 text-sm font-medium text-[hsla(var(--text-secondary))]">
          {fileName}
        </h1>
        <Badge theme="secondary">{toGibibytes(fileSize)}</Badge>
      </div>

      {isDownloaded ? (
        <Button
          variant="soft"
          className="min-w-[98px]"
          onClick={onUseModelClick}
          data-testid={`use-model-btn-${model.id}`}
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
                formatDownloadPercentage(downloadState?.percent, {
                  hidePercentage: true,
                }) as number
              }
            />
            <span className="tabular-nums">
              {formatDownloadPercentage(downloadState.percent)}
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
