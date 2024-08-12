import React, { useCallback, useMemo } from 'react'

import { EngineStatus, LocalEngines, RemoteEngine } from '@janhq/core'

import { Button } from '@janhq/joi'
import { useQueryClient } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'

import { CloudDownload } from 'lucide-react'

import { toaster } from '@/containers/Toast'

import useAssistantQuery from '@/hooks/useAssistantQuery'

import useCortex from '@/hooks/useCortex'

import useEngineQuery from '@/hooks/useEngineQuery'
import { modelQueryKey } from '@/hooks/useModelQuery'
import useThreads from '@/hooks/useThreads'

import { HfModelEntry } from '@/utils/huggingface'

import { addThousandSeparator } from '@/utils/number'

import ModelTitle from './ModelTitle'

import { MainViewState, mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { localModelModalStageAtom } from '@/helpers/atoms/DownloadLocalModel.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'
import { setUpRemoteModelStageAtom } from '@/helpers/atoms/SetupRemoteModel.atom'

const HubModelCard: React.FC<HfModelEntry> = ({ name, downloads, model }) => {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const { data: assistants } = useAssistantQuery()
  const { data: engineData } = useEngineQuery()
  const queryClient = useQueryClient()

  const setUpRemoteModelStage = useSetAtom(setUpRemoteModelStageAtom)
  const setLocalModelModalStage = useSetAtom(localModelModalStageAtom)

  const { createThread } = useThreads()
  const setMainViewState = useSetAtom(mainViewStateAtom)
  const { createModel } = useCortex()

  const isLocalModel = useMemo(
    () =>
      model == null ||
      LocalEngines.filter((e) => e === model.engine).length > 0,
    [model]
  )

  const actionLabel = useMemo(() => {
    if (isLocalModel) return 'Download'

    const isEngineConfigured: boolean =
      engineData == null || model?.engine == null
        ? false
        : engineData.find((e) => e.name === model.engine)?.status ===
          EngineStatus.Ready

    const isModelDownloaded = downloadedModels.find(
      (m) => m.model === model!.model
    )

    if (isEngineConfigured && isModelDownloaded) return 'Use'

    if (!isEngineConfigured && !isModelDownloaded) return 'Setup'

    if (isModelDownloaded) return 'Setup API Key'

    return 'Add'
  }, [model, isLocalModel, downloadedModels, engineData])

  const onActionClick = useCallback(() => {
    if (isLocalModel) {
      setLocalModelModalStage('MODEL_LIST', name)
    } else {
      if (!model) return

      const isApiKeyAdded: boolean =
        engineData == null || model?.engine == null
          ? false
          : engineData.find((e) => e.name === model.engine)?.status ===
            EngineStatus.Ready

      const isModelDownloaded = downloadedModels.find(
        (m) => m.model === model.model
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
          queryClient.invalidateQueries({ queryKey: modelQueryKey })
        })
        return
      }
    }
  }, [
    createModel,
    createThread,
    setMainViewState,
    setUpRemoteModelStage,
    setLocalModelModalStage,
    name,
    model,
    engineData,
    isLocalModel,
    downloadedModels,
    assistants,
    queryClient,
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
        <span className="flex items-center gap-1 text-sm font-medium leading-3 text-[hsla(var(--text-secondary))]">
          {addThousandSeparator(downloads)}
          <CloudDownload size={14} />
        </span>
      </div>
    </div>
  )
}

export default HubModelCard
