import React, { useCallback } from 'react'

import { EngineStatus, RemoteEngine } from '@janhq/core'
import { useAtomValue, useSetAtom } from 'jotai'

import { toaster } from '@/containers/Toast'

import useAssistantQuery from '@/hooks/useAssistantQuery'

import useCortex from '@/hooks/useCortex'

import useEngineQuery from '@/hooks/useEngineQuery'
import useModels from '@/hooks/useModels'
import useThreads from '@/hooks/useThreads'

import { HfModelEntry } from '@/utils/huggingface'

import { MainViewState, mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'
import { setUpRemoteModelStageAtom } from '@/helpers/atoms/SetupRemoteModel.atom'

const RemoteModelCard: React.FC<HfModelEntry> = ({ name, model }) => {
  const { createThread } = useThreads()
  const setMainViewState = useSetAtom(mainViewStateAtom)
  const setUpRemoteModelStage = useSetAtom(setUpRemoteModelStageAtom)

  const { createModel } = useCortex()
  const { getModels } = useModels()
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const { data: assistants } = useAssistantQuery()

  const { data: engineData } = useEngineQuery()

  const modelDisplayName = model?.name ?? name

  const onClick = useCallback(async () => {
    if (!model || !engineData) return
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
      // use this model to create new thread
      await createThread(model.model, {
        ...assistants[0],
        model: model.model,
      })
      setMainViewState(MainViewState.Thread)
      return
    }

    if (!isApiKeyAdded) {
      setUpRemoteModelStage('SETUP_INTRO', model.engine as RemoteEngine, {
        ...model.metadata,
        modelName: modelDisplayName,
        modelId: model.model,
      })
      return
    }

    if (isModelDownloaded) {
      // when model is downloaded but key is not there or deleted, we need to setup api key
      setUpRemoteModelStage('SETUP_API_KEY', model.engine as RemoteEngine, {
        ...model.metadata,
        modelName: modelDisplayName,
      })

      return
    }

    if (isApiKeyAdded) {
      // TODO: useMutation reactQuery?
      await createModel(model)
      getModels()
      if (!assistants || assistants.length === 0) {
        toaster({
          title: 'No assistant available.',
          description: 'Please create an assistant to create a new thread',
          type: 'error',
        })
        return
      }

      // use this model to create new thread
      await createThread(model.model, {
        ...assistants[0],
        model: model.model,
      })
      setMainViewState(MainViewState.Thread)
      return
    }
  }, [
    assistants,
    engineData,
    createModel,
    createThread,
    downloadedModels,
    getModels,
    model,
    setMainViewState,
    setUpRemoteModelStage,
    modelDisplayName,
  ])

  return (
    <div
      data-testid={modelDisplayName}
      onClick={onClick}
      className="group flex h-[46px] cursor-pointer flex-col justify-center border-b-[1px] border-[hsla(var(--app-border))]"
    >
      <h1 className="text-sm font-medium leading-4 group-hover:underline">
        {modelDisplayName}
      </h1>
    </div>
  )
}

export default RemoteModelCard
