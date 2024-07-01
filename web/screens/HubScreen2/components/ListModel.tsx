import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'

import { Button, Progress, Select } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'
import { Download } from 'lucide-react'

import { MainViewState } from '@/constants/screens'

import useCortex from '@/hooks/useCortex'

import {
  addDownloadModelStateAtom,
  downloadStateListAtom,
} from '@/hooks/useDownloadState'

import useHuggingFace, {
  EngineToBranches,
  EngineType,
} from '@/hooks/useHuggingFace'

import useThreads from '@/hooks/useThreads'

import { formatDownloadPercentage } from '@/utils/converter'

import { downloadProgress } from '@/utils/download'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { assistantsAtom } from '@/helpers/atoms/Assistant.atom'
import { setDownloadLocalModelStageAtom } from '@/helpers/atoms/DownloadLocalModel.atom'
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
      <div className="mt-3 rounded-md border">
        {modelBranches.map((item) => (
          <div
            className="relative flex items-center justify-between border-b p-3 last:border-b-0"
            key={item}
          >
            <div className="flex items-center gap-2">
              <div className="rounded-[5px] bg-[#2563EB33] px-1.5 py-0.5 text-xs text-[hsla(var(--app-link))]">
                {/* {item.type} */}
              </div>
              <div className="rounded-[5px] bg-[#0000000F] px-1.5 py-0.5 text-xs">
                {item}
              </div>
              <span>{item}</span>
            </div>
            <div className="flex items-center justify-end gap-2 text-xs text-[hsla(var(--text-secondary))]">
              {/* {item.status !== '' && ( */}
              {/*   <Info */}
              {/*     size={16} */}
              {/*     className={`${item.status === 'warning' ? 'text-yellow-300' : 'text-red-300'} `} */}
              {/*   /> */}
              {/* )} */}
              <div className="flex items-center gap-1">
                {item} <Download size={16} />
              </div>
              <span>{item}</span>
              <DownloadContainer modelHandle={modelHandle} branch={item} />
              {/* {showModel === index && ( */}
              {/*   <div */}
              {/*     ref={dropdownRef} */}
              {/*     className="absolute right-3 top-[85%] z-10" */}
              {/*   > */}
              {/*     <div className="rounded-lg border bg-white p-1 shadow-xl"> */}
              {/*       {Array(6) */}
              {/*         .fill(0) */}
              {/*         .map((_, idx) => ( */}
              {/*           <div className="flex items-center gap-2 p-2" key={idx}> */}
              {/*             <img */}
              {/*               className="h-4 w-4 rounded-full" */}
              {/*               src="https://i.pinimg.com/564x/08/ea/94/08ea94ca94a4b3a04037bdfc335ae00d.jpg" */}
              {/*               alt="" */}
              {/*             /> */}
              {/*             <span className="text-md whitespace-nowrap"> */}
              {/*               Jan on Hugging Face */}
              {/*             </span> */}
              {/*           </div> */}
              {/*         ))} */}
              {/*     </div> */}
              {/*   </div> */}
              {/* )} */}
            </div>
          </div>
        ))}
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
  const setDownloadLocalModelStage = useSetAtom(setDownloadLocalModelStageAtom)

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
    setDownloadLocalModelStage('NONE')
    setMainViewState(MainViewState.Thread)
  }, [
    setDownloadLocalModelStage,
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
