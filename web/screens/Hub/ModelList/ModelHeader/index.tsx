import { useCallback, useMemo } from 'react'

import Image from 'next/image'

import { InferenceEngine, ModelSource } from '@janhq/core'

import { Button, Tooltip, Dropdown, Badge } from '@janhq/joi'

import { useAtomValue, useSetAtom } from 'jotai'
import { ChevronDownIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import ModalCancelDownload from '@/containers/ModalCancelDownload'

import { MainViewState } from '@/constants/screens'

import { useCreateNewThread } from '@/hooks/useCreateNewThread'
import useDownloadModel from '@/hooks/useDownloadModel'

import { toGigabytes } from '@/utils/converter'

import { getLogoEngine } from '@/utils/modelEngine'
import { extractModelName } from '@/utils/modelSource'

import { fuzzySearch } from '@/utils/search'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { assistantsAtom } from '@/helpers/atoms/Assistant.atom'
import { serverEnabledAtom } from '@/helpers/atoms/LocalServer.atom'

import {
  downloadedModelsAtom,
  getDownloadingModelAtom,
} from '@/helpers/atoms/Model.atom'
import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

type Props = {
  model: ModelSource
  onSelectedModel: () => void
}

const ModelItemHeader = ({ model, onSelectedModel }: Props) => {
  const { downloadModel } = useDownloadModel()
  const downloadingModels = useAtomValue(getDownloadingModelAtom)
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const setSelectedSetting = useSetAtom(selectedSettingAtom)
  const { requestCreateNewThread } = useCreateNewThread()

  const setMainViewState = useSetAtom(mainViewStateAtom)

  const serverEnabled = useAtomValue(serverEnabledAtom)
  const assistants = useAtomValue(assistantsAtom)

  const onDownloadClick = useCallback(() => {
    downloadModel(model.models?.[0].id)
  }, [model, downloadModel])

  const isDownloaded = downloadedModels.some((md) =>
    model.models.some((m) => m.id === md.id)
  )
  const defaultModel = useMemo(() => {
    return model.models?.find(
      (e) => e.id.includes('q4-km') || fuzzySearch('q4km', e.id)
    )
  }, [model])

  let downloadButton = (
    <div className="group flex h-8 cursor-pointer items-center justify-center rounded-md bg-[hsla(var(--primary-bg))]">
      <div
        className="flex h-full items-center rounded-l-md duration-200 hover:backdrop-brightness-75"
        onClick={onDownloadClick}
      >
        <span className="mx-4 font-medium text-white">Download</span>
      </div>
      <Dropdown
        className="z-50  max-h-[240px] min-w-[240px] max-w-[320px] overflow-y-auto border border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))] shadow"
        options={model.models?.map((e) => ({
          name: (
            <div className="flex space-x-2">
              <span className="line-clamp-1 max-w-[340px] font-normal">
                {e.id}
              </span>
              {e.id === defaultModel?.id && (
                <Badge
                  theme="secondary"
                  className="inline-flex w-[60px] items-center font-medium"
                >
                  <span>Default</span>
                </Badge>
              )}
            </div>
          ),
          value: e.id,
          suffix: toGigabytes(e.size),
        }))}
        onValueChanged={(e) => downloadModel(e)}
      >
        <div className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-r-md border-l border-blue-500 duration-200 hover:backdrop-brightness-75">
          <ChevronDownIcon size={14} color="white" />
        </div>
      </Dropdown>
    </div>
  )

  const isDownloading = downloadingModels.some((md) =>
    model.models.some((m) => m.id === md)
  )

  const onUseModelClick = useCallback(async () => {
    const downloadedModel = downloadedModels.find((e) =>
      model.models.some((m) => m.id === e.id)
    )
    if (downloadedModel) {
      await requestCreateNewThread(assistants[0], downloadedModel)
      setMainViewState(MainViewState.Thread)
    }
  }, [
    assistants,
    model,
    requestCreateNewThread,
    setMainViewState,
    downloadedModels,
  ])

  if (isDownloaded) {
    downloadButton = (
      <Tooltip
        trigger={
          <Button
            onClick={onUseModelClick}
            disabled={serverEnabled}
            data-testid={`use-model-btn-${model.id}`}
            variant="outline"
            theme="ghost"
            className="min-w-[98px]"
          >
            Use
          </Button>
        }
        disabled={!serverEnabled}
        content="Threads are disabled while the server is running"
      />
    )
  } else if (isDownloading) {
    downloadButton = (
      <ModalCancelDownload
        modelId={
          downloadingModels.find((e) => model.models.some((m) => m.id === e)) ??
          model.id
        }
      />
    )
  }

  return (
    <div className="mb-2 rounded-t-md bg-[hsla(var(--app-bg))]">
      <div className="flex items-center justify-between py-2">
        <div className="group flex cursor-pointer items-center gap-2">
          <span
            className={twMerge(
              'line-clamp-1 text-base font-medium capitalize group-hover:text-blue-500 group-hover:underline',
              model.type === 'cloud' && 'flex items-center gap-x-2'
            )}
            onClick={onSelectedModel}
          >
            {model.type === 'cloud' && (
              <>
                <Image
                  className="h-6 w-6 flex-shrink-0"
                  width={48}
                  height={48}
                  src={getLogoEngine(model.id as InferenceEngine) || ''}
                  alt="logo"
                />
              </>
            )}
            {extractModelName(model.metadata?.id)}
          </span>
        </div>
        <div className="inline-flex items-center space-x-2">
          <div className="hidden items-center sm:inline-flex">
            <span className="mr-4 text-sm font-light text-[hsla(var(--text-secondary))]">
              {toGigabytes(model.models?.[0]?.size)}
            </span>
          </div>
          {model.type !== 'cloud' ? (
            downloadButton
          ) : (
            <>
              {!model.metadata?.apiKey?.length && (
                <Button
                  data-testid="setup-btn"
                  onClick={() => {
                    setSelectedSetting(model.id)
                    setMainViewState(MainViewState.Settings)
                  }}
                >
                  Set Up
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default ModelItemHeader
