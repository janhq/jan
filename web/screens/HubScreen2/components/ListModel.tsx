import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'

import { Button, Progress, Select } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'

import Spinner from '@/containers/Loader/Spinner'
import { toaster } from '@/containers/Toast'

import useAbortDownload from '@/hooks/useAbortDownload'
import useAssistantQuery from '@/hooks/useAssistantQuery'

import { downloadStateListAtom } from '@/hooks/useDownloadState'

import useEngineQuery from '@/hooks/useEngineQuery'
import useHfEngineToBranchesQuery from '@/hooks/useHfEngineToBranchesQuery'

import useModelDownloadMutation from '@/hooks/useModelDownloadMutation'
import useThreads from '@/hooks/useThreads'

import { formatDownloadPercentage, toGibibytes } from '@/utils/converter'

import { downloadProgress } from '@/utils/download'

import { CortexHubModel, EngineType } from '@/utils/huggingface'

import { MainViewState, mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { localModelModalStageAtom } from '@/helpers/atoms/DownloadLocalModel.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

type Props = {
  modelHandle: string
  onBranchSelected?: (availableSelections: string[]) => void
}

const ListModel: React.FC<Props> = ({ modelHandle, onBranchSelected }) => {
  const { data: engineData } = useEngineQuery()
  const { data, isLoading } = useHfEngineToBranchesQuery(modelHandle)

  const [engineFilter, setEngineFilter] = useState<EngineType | undefined>(
    undefined
  )

  const engineSelections: { name: string; value: string }[] = useMemo(() => {
    if (!data || !engineData) return []

    const isSupportTensorRt =
      engineData.find((engine) => engine.name === 'cortex.tensorrt-llm')
        ?.status !== 'not_supported' ?? false

    const isSupportOnnx =
      engineData.find((engine) => engine.name === 'cortex.onnx')?.status !==
        'not_supported' ?? false

    const result: { name: string; value: string }[] = []
    if (data.gguf.length > 0) result.push({ name: 'GGUF', value: 'gguf' })
    if (isSupportOnnx && data.onnx.length > 0)
      result.push({ name: 'ONNX', value: 'onnx' })
    if (isSupportTensorRt && data.tensorrtllm.length > 0)
      result.push({ name: 'TensorRT', value: 'tensorrtllm' })

    return result
  }, [data, engineData])

  const modelBranches: CortexHubModel[] = useMemo((): CortexHubModel[] => {
    if (!data) return []
    return (data[engineFilter as EngineType] as CortexHubModel[]) ?? []
  }, [data, engineFilter])

  useEffect(() => {
    if (engineSelections.length === 0) return
    setEngineFilter(engineSelections[0].value as EngineType)
  }, [engineSelections])

  useEffect(() => {
    const models = modelBranches.map((m) => m.name)
    onBranchSelected?.(models)
  }, [modelBranches, onBranchSelected])

  const onSelectionChanged = useCallback(
    (selectionValue: string) => {
      setEngineFilter(selectionValue as EngineType)
      const models = modelBranches.map((m) => m.name)
      onBranchSelected?.(models)
    },
    [setEngineFilter, onBranchSelected, modelBranches]
  )

  if (isLoading)
    return (
      <div className="mb-4 mt-8 flex w-full justify-center">
        <Spinner />
      </div>
    )

  return (
    <Fragment>
      <div className="mt-6 flex items-center gap-2">
        <span>Format:</span>
        <Select
          value={engineFilter}
          className="gap-1.5 whitespace-nowrap px-4 py-2 font-semibold"
          options={engineSelections}
          onValueChange={onSelectionChanged}
        />
      </div>
      <div className="mt-3 w-full overflow-hidden rounded-md border border-[hsla(var(--app-border))]">
        <table className="w-full">
          <tbody>
            {modelBranches.map((item) => (
              <tr
                key={item.name}
                className="border-b border-[hsla(var(--app-border))] last:border-b-0 hover:bg-[hsla(var(--primary-bg-soft))]"
              >
                <td className="whitespace-nowrap py-4 pl-3">
                  <div className="w-fit rounded-md border border-[hsla(var(--app-border))] bg-transparent px-1.5 py-0.5 text-xs font-medium leading-4 text-[hsla(var(--text-primary))]">
                    {item.name}
                  </div>
                </td>
                <td className="w-full pl-4 font-medium leading-5 text-[hsla(var(--text-muted))]">
                  {item.name}
                </td>
                <td>
                  <div className="mr-3 flex items-center justify-end gap-3 whitespace-nowrap py-3">
                    {item.fileSize && <span>{toGibibytes(item.fileSize)}</span>}
                    <DownloadContainer
                      modelHandle={modelHandle}
                      branch={item.name}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Fragment>
  )
}

type DownloadContainerProps = {
  modelHandle: string
  branch: string
}

const DownloadContainer: React.FC<DownloadContainerProps> = ({
  modelHandle,
  branch,
}) => {
  const downloadModelMutation = useModelDownloadMutation()
  const { abortDownload } = useAbortDownload()
  const setMainViewState = useSetAtom(mainViewStateAtom)
  const { createThread } = useThreads()
  const setDownloadLocalModelModalStage = useSetAtom(localModelModalStageAtom)

  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const allDownloadState = useAtomValue(downloadStateListAtom)
  const { data: assistants } = useAssistantQuery()

  const modelId = useMemo(
    () => `${modelHandle.split('/')[1]}:${branch}`,
    [modelHandle, branch]
  )
  const downloadState = allDownloadState.find((s) => s.id == modelId)

  const isDownloaded = useMemo(
    () => downloadedModels.find((m) => m.model === modelId),
    [downloadedModels, modelId]
  )

  const onDownloadClick = useCallback(() => {
    downloadModelMutation.mutate({ modelId })
  }, [downloadModelMutation, modelId])

  const onUseModelClick = useCallback(async () => {
    if (!assistants || assistants.length === 0) {
      toaster({
        title: 'No assistant available.',
        description: 'Please create an assistant to create a new thread',
        type: 'error',
      })
      return
    }
    await createThread(modelId, {
      ...assistants[0],
      model: modelId,
    })
    setDownloadLocalModelModalStage('NONE', undefined)
    setMainViewState(MainViewState.Thread)
  }, [
    setDownloadLocalModelModalStage,
    setMainViewState,
    createThread,
    modelId,
    assistants,
  ])

  const onAbortDownloadClick = useCallback(() => {
    abortDownload(modelId)
  }, [abortDownload, modelId])

  return (
    <div className="flex items-center justify-center">
      {isDownloaded ? (
        <Button
          variant="soft"
          className="min-w-[98px]"
          onClick={onUseModelClick}
        >
          Use
        </Button>
      ) : downloadState != null ? (
        <Button theme="ghost" className="p-0 text-[hsla(var(--primary-bg))]">
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
          className="bg-[hsla(var(--secondary-bg))] group-hover:bg-[hsla(var(--primary-bg))] group-hover:text-[hsla(var(--primary-fg))]"
        >
          Download
        </Button>
      )}
    </div>
  )
}

export default ListModel
