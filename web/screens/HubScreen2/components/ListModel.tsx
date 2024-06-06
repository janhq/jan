import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'

import { Button, Progress, Select } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'

import { MainViewState } from '@/constants/screens'

import useCortex from '@/hooks/useCortex'

import {
  addDownloadModelStateAtom,
  downloadStateListAtom,
} from '@/hooks/useDownloadState'

import useHuggingFace from '@/hooks/useHuggingFace'

import useThreads from '@/hooks/useThreads'

import { formatDownloadPercentage } from '@/utils/converter'

import { downloadProgress } from '@/utils/download'

import { EngineToBranches, EngineType } from '@/utils/huggingface'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { assistantsAtom } from '@/helpers/atoms/Assistant.atom'
import { localModelModalStageAtom } from '@/helpers/atoms/DownloadLocalModel.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

type Props = {
  modelHandle: string
}

const ListModel: React.FC<Props> = ({ modelHandle }) => {
  const { getEngineAndBranches } = useHuggingFace()

  const [engineAndBranches, setEngineAndBranches] = useState<
    EngineToBranches | undefined
  >(undefined)
  const [engineFilter, setEngineFilter] = useState<EngineType | undefined>(
    undefined
  )

  useEffect(() => {
    const fetchData = async () => {
      const result = await getEngineAndBranches(modelHandle)
      setEngineAndBranches(result)
    }
    fetchData()
  }, [getEngineAndBranches, modelHandle])

  const engineSelection: { name: string; value: string }[] = useMemo(() => {
    if (!engineAndBranches) return []
    const result: { name: string; value: string }[] = []
    if (engineAndBranches.gguf.length > 0)
      result.push({ name: 'GGUF', value: 'gguf' })
    if (engineAndBranches.onnx.length > 0)
      result.push({ name: 'ONNX', value: 'onnx' })
    if (engineAndBranches.tensorrtllm.length > 0)
      result.push({ name: 'TensorRT', value: 'tensorrtllm' })

    return result
  }, [engineAndBranches])

  useEffect(() => {
    if (engineSelection.length === 0) return
    setEngineFilter(engineSelection[0].value as EngineType)
  }, [engineSelection])

  const modelBranches: string[] = []
  if (engineAndBranches) {
    const branches = engineAndBranches[engineFilter as EngineType] as string[]
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
      <div className="mt-3 w-full overflow-hidden rounded-md border">
        <table className="w-full">
          <tbody>
            {modelBranches.map((item) => (
              <tr
                key={item}
                className="border-b last:border-b-0 hover:bg-[#2563EB0D]"
              >
                <td className="whitespace-nowrap py-4 pl-3">
                  <div className="w-fit rounded-md border bg-white px-1.5 py-0.5 text-[var(--text-primary)]">
                    {item}
                  </div>
                </td>
                <td className="w-full pl-4">{item}</td>
                <td>
                  <div className="mr-3 flex items-center gap-3 whitespace-nowrap py-3">
                    <span>4.06 MB</span>
                    <DownloadContainer
                      modelHandle={modelHandle}
                      branch={item}
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
  const assistants = useAtomValue(assistantsAtom)

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
