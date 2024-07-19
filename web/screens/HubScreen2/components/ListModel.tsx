import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'

import { Button, Progress, Select } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'

import { toaster } from '@/containers/Toast'

import useAssistantQuery from '@/hooks/useAssistantQuery'

import useCortex from '@/hooks/useCortex'

import {
  addDownloadModelStateAtom,
  downloadStateListAtom,
} from '@/hooks/useDownloadState'

import useHfEngineToBranchesQuery from '@/hooks/useHfEngineToBranchesQuery'

import useThreads from '@/hooks/useThreads'

import { formatDownloadPercentage, toGibibytes } from '@/utils/converter'

import { downloadProgress } from '@/utils/download'

import { CortexHubModel, EngineType } from '@/utils/huggingface'

import { MainViewState, mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { localModelModalStageAtom } from '@/helpers/atoms/DownloadLocalModel.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

type Props = {
  modelHandle: string
}

const ListModel: React.FC<Props> = ({ modelHandle }) => {
  const [engineFilter, setEngineFilter] = useState<EngineType | undefined>(
    undefined
  )
  const { data } = useHfEngineToBranchesQuery(modelHandle)

  const engineSelection: { name: string; value: string }[] = useMemo(() => {
    if (!data) return []
    const result: { name: string; value: string }[] = []
    if (data.gguf.length > 0) result.push({ name: 'GGUF', value: 'gguf' })
    if (data.onnx.length > 0) result.push({ name: 'ONNX', value: 'onnx' })
    if (data.tensorrtllm.length > 0)
      result.push({ name: 'TensorRT', value: 'tensorrtllm' })

    return result
  }, [data])

  useEffect(() => {
    if (engineSelection.length === 0) return
    setEngineFilter(engineSelection[0].value as EngineType)
  }, [engineSelection])

  const modelBranches: CortexHubModel[] = []
  if (data) {
    const branches = data[engineFilter as EngineType] as CortexHubModel[]
    if (!branches || branches.length === 0) return
    modelBranches.push(...branches)
  }

  return (
    <Fragment>
      <div className="mt-6 flex items-center gap-2">
        <span>Format:</span>
        <Select
          value={engineFilter}
          className="gap-1.5 whitespace-nowrap px-4 py-2 font-semibold"
          options={engineSelection}
          onValueChange={(value) => setEngineFilter(value as EngineType)}
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
  const { downloadModel, abortDownload } = useCortex()
  const addDownloadState = useSetAtom(addDownloadModelStateAtom)
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
    () => downloadedModels.find((m) => m.id === modelId),
    [downloadedModels, modelId]
  )

  const onDownloadClick = useCallback(async () => {
    addDownloadState(modelId)
    await downloadModel(modelId)
  }, [downloadModel, addDownloadState, modelId])

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

export default ListModel
