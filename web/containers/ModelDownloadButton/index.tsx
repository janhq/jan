import {
  downloadedModelsAtom,
  getDownloadingModelAtom,
} from '@/helpers/atoms/Model.atom'
import { Button, Tooltip } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'
import ModalCancelDownload from '../ModalCancelDownload'
import { useCallback, useMemo } from 'react'
import { assistantsAtom } from '@/helpers/atoms/Assistant.atom'
import { MainViewState } from '@/constants/screens'
import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import useDownloadModel from '@/hooks/useDownloadModel'

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
  }, [id])

  const onUseModelClick = useCallback(async () => {
    // await requestCreateNewThread(assistants[0], model)
    setMainViewState(MainViewState.Thread)
  }, [assistants])

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
