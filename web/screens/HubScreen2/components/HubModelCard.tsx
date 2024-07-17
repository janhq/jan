import React, { useCallback, useMemo } from 'react'

import { LocalEngines, RemoteEngine } from '@janhq/core'

import { Button } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'

import { CloudDownload } from 'lucide-react'

import { toaster } from '@/containers/Toast'

import { MainViewState } from '@/constants/screens'

import useAssistantQuery from '@/hooks/useAssistantQuery'

import useConfigQuery from '@/hooks/useConfigQuery'

import useCortex from '@/hooks/useCortex'

import useModels from '@/hooks/useModels'
import useThreads from '@/hooks/useThreads'

import { HfModelEntry } from '@/utils/huggingface'

import { addThousandSeparator } from '@/utils/number'

import ModelTitle from './ModelTitle'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { localModelModalStageAtom } from '@/helpers/atoms/DownloadLocalModel.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'
import { setUpRemoteModelStageAtom } from '@/helpers/atoms/SetupRemoteModel.atom'

const HubModelCard: React.FC<HfModelEntry> = ({ name, downloads, model }) => {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const { data: assistants } = useAssistantQuery()
  const { data: configData } = useConfigQuery()

  const setUpRemoteModelStage = useSetAtom(setUpRemoteModelStageAtom)
  const setLocalModelModalStage = useSetAtom(localModelModalStageAtom)

  const { createThread } = useThreads()
  const setMainViewState = useSetAtom(mainViewStateAtom)
  const { createModel } = useCortex()
  const { getModels } = useModels()

  const isLocalModel = useMemo(
    () =>
      model == null ||
      LocalEngines.filter((e) => e === model.engine).length > 0,
    [model]
  )

  const actionLabel = useMemo(() => {
    if (isLocalModel) return 'Download'

    const isApiKeyAdded =
      // @ts-expect-error engine is not null
      (configData[model?.engine ?? '']?.apiKey ?? '').length > 0
    const isModelDownloaded = downloadedModels.find(
      (m) => m.id === model!.model
    )

    if (isApiKeyAdded && isModelDownloaded) return 'Use'

    if (!isApiKeyAdded && !isModelDownloaded) return 'Setup'

    if (isModelDownloaded) return 'Setup API Key'

    return 'Add'
  }, [model, isLocalModel, downloadedModels, configData])

  const onActionClick = useCallback(() => {
    if (isLocalModel) {
      setLocalModelModalStage('MODEL_LIST', name)
    } else {
      if (!model) return

      const isApiKeyAdded =
        // @ts-expect-error engine is not null
        (cortexConfig[model?.engine ?? '']?.apiKey ?? '').length > 0
      const isModelDownloaded = downloadedModels.find(
        (m) => m.id === model.model
      )

      if (isApiKeyAdded && isModelDownloaded) {
        if (!assistants || assistants.length === 0) {
          toaster({
            title: 'No assistant available.',
            description: 'Please create an assistant to create a new thread',
            type: 'error',
          })
          return
        }

        // use
        createThread(model.model, {
          ...assistants[0],
          model: model.model,
        })
          .then(() => {
            setMainViewState(MainViewState.Thread)
          })
          .catch((err) => {
            console.log('Error creating thread', err)
          })
        return
      }

      if (!isApiKeyAdded && !isModelDownloaded) {
        setUpRemoteModelStage(
          'SETUP_INTRO',
          model.engine as RemoteEngine,
          model.metadata
        )
        return
      }

      if (isModelDownloaded) {
        // when model is downloaded but key is not there or deleted, we need to setup api key
        setUpRemoteModelStage(
          'SETUP_API_KEY',
          model.engine as RemoteEngine,
          model.metadata
        )
        return
      }

      if (isApiKeyAdded) {
        createModel(model).then(() => {
          getModels()
        })
        return
      }
    }
  }, [
    getModels,
    createModel,
    createThread,
    setMainViewState,
    setUpRemoteModelStage,
    setLocalModelModalStage,
    name,
    model,
    isLocalModel,
    downloadedModels,
    assistants,
  ])

  const owner = model?.metadata?.owned_by ?? ''
  const logoUrl = model?.metadata?.logo ?? ''

  return (
    <div
      className="flex cursor-pointer flex-row justify-between border-b-[1px] border-[hsla(var(--app-border))] pb-3 pt-6 last:border-b-0 hover:bg-[hsla(var(--dropdown-menu-hover-bg))]"
      onClick={onActionClick}
    >
      <div className="flex flex-col gap-2">
        <span>{name}</span>
        <ModelTitle
          className="text-[hsla(var(--text-secondary)]"
          name={owner}
          image={logoUrl}
        />
      </div>
      <div className="flex flex-col items-end gap-2">
        <Button
          className="!bg-[#0000000F] text-[var(--text-primary)]"
          onClick={onActionClick}
        >
          {actionLabel}
        </Button>
        <span className="flex items-center gap-1 text-sm font-medium leading-3">
          {addThousandSeparator(downloads)}
          <CloudDownload size={14} />
        </span>
      </div>
    </div>
  )
}

export default HubModelCard
