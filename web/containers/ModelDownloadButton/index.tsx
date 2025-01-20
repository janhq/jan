import { useCallback, useMemo } from 'react'

import { Button, Tooltip } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'

import { MainViewState } from '@/constants/screens'

import { useCreateNewThread } from '@/hooks/useCreateNewThread'
import useDownloadModel from '@/hooks/useDownloadModel'

import ModalCancelDownload from '../ModalCancelDownload'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { assistantsAtom } from '@/helpers/atoms/Assistant.atom'

import {
  downloadedModelsAtom,
  getDownloadingModelAtom,
} from '@/helpers/atoms/Model.atom'

interface Props {
  id: string
  theme?: 'primary' | 'ghost' | 'icon' | 'destructive' | undefined
  variant?: 'solid' | 'soft' | 'outline' | undefined
}
const ModelDownloadButton = ({ id, theme, variant }: Props) => {
  const { downloadModel } = useDownloadModel()
  const downloadingModels = useAtomValue(getDownloadingModelAtom)
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const assistants = useAtomValue(assistantsAtom)
  const setMainViewState = useSetAtom(mainViewStateAtom)
  const { requestCreateNewThread } = useCreateNewThread()
  const isDownloaded = useMemo(
    () => downloadedModels.some((md) => md.id === id),
    [downloadedModels, id]
  )
  const isDownloading = useMemo(
    () => downloadingModels.some((md) => md === id),
    [downloadingModels, id]
  )

  const onDownloadClick = useCallback(() => {
    downloadModel(id)
  }, [id, downloadModel])

  const onUseModelClick = useCallback(async () => {
    const downloadedModel = downloadedModels.find((e) => e.id === id)
    if (downloadedModel)
      await requestCreateNewThread(assistants[0], downloadedModel)
    setMainViewState(MainViewState.Thread)
  }, [
    assistants,
    downloadedModels,
    setMainViewState,
    requestCreateNewThread,
    id,
  ])

  const defaultButton = (
    <Button
      theme={theme ? theme : 'primary'}
      variant={variant ? variant : 'solid'}
      onClick={(e) => {
        e.stopPropagation()
        onDownloadClick()
      }}
    >
      Download
    </Button>
  )
  const downloadingButton = <ModalCancelDownload modelId={id} />
  const downloadedButton = (
    <Tooltip
      trigger={
        <Button
          onClick={onUseModelClick}
          data-testid={`use-model-btn-${id}`}
          variant="outline"
          theme="ghost"
          className="min-w-[70px]"
        >
          Use
        </Button>
      }
      content="Threads are disabled while the server is running"
    />
  )
  return (
    <>
      {isDownloading
        ? downloadingButton
        : isDownloaded
          ? downloadedButton
          : defaultButton}
    </>
  )
}

export default ModelDownloadButton
