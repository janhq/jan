import { Fragment, useCallback, useMemo } from 'react'

import { Button, Progress } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'

import Spinner from '@/containers/Loader/Spinner'
import { toaster } from '@/containers/Toast'

import useAbortDownload from '@/hooks/useAbortDownload'
import useAssistantQuery from '@/hooks/useAssistantQuery'

import { downloadStateListAtom } from '@/hooks/useDownloadState'

import useHfRepoDataQuery from '@/hooks/useHfRepoDataQuery'
import useModelDownloadMutation from '@/hooks/useModelDownloadMutation'
import useThreads from '@/hooks/useThreads'

import { formatDownloadPercentage, toGibibytes } from '@/utils/converter'

import { downloadProgress } from '@/utils/download'

import { MainViewState, mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { localModelModalStageAtom } from '@/helpers/atoms/DownloadLocalModel.atom'

import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

type Props = {
  modelHandle: string
}

const HfListModel: React.FC<Props> = ({ modelHandle }) => {
  const { data, isLoading } = useHfRepoDataQuery(modelHandle)

  const downloadableModels = useMemo(
    () =>
      data?.siblings
        .filter((item) => item.rfilename.endsWith('.gguf'))
        .sort((a, b) => (a.fileSize ?? 0) - (b.fileSize ?? 0)) ??
      [] ??
      [],
    [data]
  )

  if (isLoading)
    return (
      <div className="mb-4 mt-8 flex w-full justify-center">
        <Spinner />
      </div>
    )

  return (
    <Fragment>
      <div className="mt-3 max-h-[320px] w-full overflow-x-hidden rounded-md border border-[hsla(var(--app-border))]">
        <table className="w-full">
          <tbody>
            {downloadableModels.map((item) => (
              <tr
                key={item.rfilename}
                className="group border-b border-[hsla(var(--app-border))] last:border-b-0 hover:bg-[hsla(var(--primary-bg-soft))]"
              >
                <td className="whitespace-nowrap py-4 pl-3">
                  <div className="w-fit rounded-md border border-[hsla(var(--app-border))] bg-transparent px-1.5 py-0.5 text-[var(--text-primary)]">
                    {item.quantization}
                  </div>
                </td>
                <td className="w-full pl-4">{item.rfilename}</td>
                <td>
                  <div className="mr-3 flex items-center justify-end gap-3 whitespace-nowrap py-3">
                    <span className="text-[hsla(var(--text-secondary))]">
                      {toGibibytes(item.fileSize)}
                    </span>
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
  const downloadModelMutation = useModelDownloadMutation()
  const { abortDownload } = useAbortDownload()
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
    () => downloadedModels.find((m) => m.model === persistModelId),
    [downloadedModels, persistModelId]
  )

  const onDownloadClick = useCallback(async () => {
    downloadModelMutation.mutate({
      modelId: modelHandle,
      fileName: fileName,
      persistedModelId: persistModelId,
    })
  }, [downloadModelMutation, modelHandle, fileName, persistModelId])

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

  return (
    <div className="flex items-center justify-center transition-all">
      {downloadedModel ? (
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
            <span
              className="inline-block"
              onClick={() => abortDownload(persistModelId)}
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

export default HfListModel
