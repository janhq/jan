import { useMemo, useCallback } from 'react'

import { Button, Progress } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'
import { CloudDownload } from 'lucide-react'

import { toaster } from '@/containers/Toast'

import { MainViewState } from '@/constants/screens'

import useAssistantQuery from '@/hooks/useAssistantQuery'
import useCortex from '@/hooks/useCortex'
import {
  addDownloadModelStateAtom,
  downloadStateListAtom,
} from '@/hooks/useDownloadState'
import useThreads from '@/hooks/useThreads'

import { formatDownloadPercentage } from '@/utils/converter'
import { downloadProgress } from '@/utils/download'
import { HfModelEntry } from '@/utils/huggingface'
import { addThousandSeparator } from '@/utils/number'

import ModelTitle from './ModelTitle'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { localModelModalStageAtom } from '@/helpers/atoms/DownloadLocalModel.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

const HuggingFaceModelCard: React.FC<HfModelEntry> = ({
  name,
  downloads,
  model,
}) => {
  const setLocalModelModalStage = useSetAtom(localModelModalStageAtom)

  const onItemClick = useCallback(() => {
    setLocalModelModalStage('MODEL_LIST', name)
  }, [setLocalModelModalStage, name])

  const owner = model?.metadata?.owned_by ?? ''
  const logoUrl = model?.metadata?.owner_logo ?? ''

  return (
    <div
      className="group flex cursor-pointer flex-row justify-between border-b-[1px] border-[hsla(var(--app-border))] pb-3 pt-4"
      onClick={onItemClick}
    >
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium leading-4 group-hover:underline">
          {name}
        </span>
        <ModelTitle
          className="text-[hsla(var(--text-secondary)]"
          name={owner}
          image={logoUrl}
        />
      </div>
      <div className="pointer-events-auto flex flex-col items-end gap-2">
        {/* <Button
          className="!bg-[#0000000F] text-[var(--text-primary)]"
          onClick={(e) => {
            e.stopPropagation()
            onActionClick()
          }}
        >
          {actionLabel}
        </Button> */}
        <DownloadContainer modelHandle={name} branch={''} />
        <span className="flex items-center gap-1 text-sm font-medium leading-3">
          {addThousandSeparator(downloads)}
          <CloudDownload size={14} />
        </span>
      </div>
    </div>
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
            <span
              className="inline-block"
              onClick={(e) => {
                e.stopPropagation()
                onAbortDownloadClick()
              }}
            >
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
          onClick={(e) => {
            e.stopPropagation()
            onDownloadClick()
          }}
        >
          Download
        </Button>
      )}
    </div>
  )
}

export default HuggingFaceModelCard
