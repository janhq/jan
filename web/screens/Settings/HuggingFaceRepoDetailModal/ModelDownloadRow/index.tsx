import { useCallback, useMemo } from 'react'

import {
  DownloadState,
  HuggingFaceRepoData,
  InferenceEngine,
  Model,
  Quantization,
} from '@janhq/core'
import { Badge, Button, Progress } from '@janhq/uikit'

import { useAtomValue } from 'jotai'

import useDownloadModel from '@/hooks/useDownloadModel'

import { modelDownloadStateAtom } from '@/hooks/useDownloadState'

import { formatDownloadPercentage, toGibibytes } from '@/utils/converter'

import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

type Props = {
  index: number
  repoData: HuggingFaceRepoData
  downloadUrl: string
  fileName: string
  fileSize?: number
  quantization?: Quantization
}

const ModelDownloadRow: React.FC<Props> = ({
  index,
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

  const isDownloaded = downloadedModels.find((md) => md.id === fileName) != null

  const model = useMemo(() => {
    const promptData: string =
      (repoData.cardData['prompt_template'] as string) ??
      '{system_message}\n### Instruction: {prompt}\n### Response:'
    const model: Model = {
      object: 'model',
      version: '1.0',
      format: 'gguf',
      sources: [
        {
          url: downloadUrl,
          filename: fileName,
        },
      ],
      id: fileName,
      name: fileName,
      created: Date.now(),
      description: 'User self import model',
      settings: {
        ctx_len: 4096,
        embedding: false,
        prompt_template: promptData,
        llama_model_path: 'N/A',
      },
      parameters: {
        temperature: 0.7,
        top_p: 0.95,
        stream: true,
        max_tokens: 2048,
        stop: ['<endofstring>'],
        frequency_penalty: 0,
        presence_penalty: 0,
      },
      metadata: {
        author: 'User',
        tags: repoData.tags,
        size: fileSize,
      },
      engine: InferenceEngine.nitro,
    }
    return model
  }, [fileName, fileSize, repoData, downloadUrl])

  const onAbortDownloadClick = useCallback(() => {
    abortModelDownload(model)
  }, [model, abortModelDownload])

  const onDownloadClick = useCallback(async () => {
    downloadModel(model)
  }, [model, downloadModel])

  return (
    <div className="flex w-[662px] flex-row items-center justify-between rounded border border-border p-3">
      <div className="flex">
        {quantization && <Badge className="mr-1">{quantization}</Badge>}

        <h1 className="mr-5 line-clamp-1 text-sm font-medium text-zinc-500 dark:text-gray-300">
          {fileName}
        </h1>
        <Badge themes="secondary">{toGibibytes(fileSize)}</Badge>
      </div>

      {isDownloaded ? (
        <div>Downloaded</div>
      ) : downloadState != null ? (
        <Button themes="secondaryBlue">
          <div className="flex items-center space-x-2">
            <span className="inline-block" onClick={onAbortDownloadClick}>
              Cancel
            </span>
            <Progress
              className="inline-block h-2 w-[80px] bg-blue-100"
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
