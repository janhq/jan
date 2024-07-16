import { Fragment, useCallback, useMemo } from 'react'

import { Button, Progress } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'

import { toaster } from '@/containers/Toast'

import { MainViewState } from '@/constants/screens'

import useAssistantQuery from '@/hooks/useAssistantQuery'

import useCortex from '@/hooks/useCortex'

import {
  addDownloadModelStateAtom,
  downloadStateListAtom,
} from '@/hooks/useDownloadState'

import useHfRepoDataQuery from '@/hooks/useHfRepoDataQuery'
import useThreads from '@/hooks/useThreads'

import { formatDownloadPercentage, toGibibytes } from '@/utils/converter'

import { downloadProgress } from '@/utils/download'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { localModelModalStageAtom } from '@/helpers/atoms/DownloadLocalModel.atom'

import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

type Props = {
  modelHandle: string
}

const HfListModel: React.FC<Props> = ({ modelHandle }) => {
  const { data } = useHfRepoDataQuery(modelHandle)

  const downloadableModels = useMemo(
    () =>
      data?.siblings
        .filter((item) => item.rfilename.endsWith('.gguf'))
        .sort((a, b) => (a.fileSize ?? 0) - (b.fileSize ?? 0)) ??
      [] ??
      [],
    [data]
  )

  return (
    <Fragment>
      <div className="mt-3 max-h-[320px] w-full overflow-x-hidden rounded-md border">
        <table className="w-full">
          <tbody>
            {downloadableModels.map((item) => (
              <tr
                key={item.rfilename}
                className="border-b last:border-b-0 hover:bg-[#2563EB0D]"
              >
                <td className="whitespace-nowrap py-4 pl-3">
                  <div className="w-fit rounded-md border bg-white px-1.5 py-0.5 text-[var(--text-primary)]">
                    {item.quantization}
                  </div>
                </td>
                <td className="w-full pl-4">{item.rfilename}</td>
                <td>
                  <div className="mr-3 flex items-center justify-end gap-3 whitespace-nowrap py-3">
                    <span>{toGibibytes(item.fileSize)}</span>
                    <DownloadContainer
                      modelHandle={modelHandle}
                      fileName={item.rfilename}
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
    setDownloadLocalModelModalStage('NONE', undefined)
    setMainViewState(MainViewState.Thread)
  }, [
    setDownloadLocalModelModalStage,
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

export default HfListModel
