import { HuggingFaceRepoData, Quantization } from '@janhq/core'
import { Badge, Button } from '@janhq/joi'

import { useAtomValue, useSetAtom } from 'jotai'

import useAssistantQuery from '@/hooks/useAssistantQuery'

import useCortex from '@/hooks/useCortex'

import useThreads from '@/hooks/useThreads'

import { toGibibytes } from '@/utils/converter'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'

import { importHuggingFaceModelStageAtom } from '@/helpers/atoms/HuggingFace.atom'
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
  repoData,
  downloadUrl,
  fileName,
  fileSize = 0,
  quantization,
}) => {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const { downloadModel, abortDownload } = useCortex()

  const { createThread } = useThreads()
  const setMainViewState = useSetAtom(mainViewStateAtom)
  const { data: assistants } = useAssistantQuery()
  const isDownloaded = downloadedModels.find((md) => md.id === fileName) != null

  const setHfImportingStage = useSetAtom(importHuggingFaceModelStageAtom)
  // const defaultModel = useAtomValue(defaultModelAtom)

  // const model = useMemo(() => {
  //   if (!defaultModel) {
  //     return undefined
  //   }

  //   const model: Model = {
  //     ...defaultModel,
  //     files: {
  //       url: downloadUrl,
  //       filename: fileName,
  //     },

  //     id: fileName,
  //     name: fileName,
  //     created: Date.now(),
  //     metadata: {
  //       author: 'User',
  //       tags: repoData.tags,
  //       size: fileSize,
  //     },
  //   }
  //   return model
  // }, [fileName, fileSize, repoData, downloadUrl, defaultModel])

  // const onAbortDownloadClick = useCallback(() => {
  //   if (!model) return
  //   abortDownload(model.id)
  // }, [model, abortDownload])

  // const onDownloadClick = useCallback(async () => {
  //   if (!model) return
  //   downloadModel(model.id)
  // }, [model, downloadModel])

  // const onUseModelClick = useCallback(async () => {
  //   if (!assistants || assistants.length === 0) {
  //     alert('No assistant available')
  //     return
  //   }
  //   if (!model) return
  //   await createThread(model.id, assistants[0])
  //   setMainViewState(MainViewState.Thread)
  //   setHfImportingStage('NONE')
  // }, [assistants, model, createThread, setMainViewState, setHfImportingStage])

  // if (!model) {
  //   return null
  // }

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

      <Button onClick={() => {}}>Download</Button>
    </div>
  )
}

export default ModelDownloadRow
