import React, { useCallback } from 'react'

import { RemoteEngine } from '@janhq/core'
import { useAtomValue, useSetAtom } from 'jotai'

import { MainViewState } from '@/constants/screens'

import useConfigQuery from '@/hooks/useConfigQuery'

import useCortex from '@/hooks/useCortex'

import useModels from '@/hooks/useModels'
import useThreads from '@/hooks/useThreads'

import { HfModelEntry } from '@/utils/huggingface'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { assistantsAtom } from '@/helpers/atoms/Assistant.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'
import { setUpRemoteModelStageAtom } from '@/helpers/atoms/SetupRemoteModel.atom'

const RemoteModelCard: React.FC<HfModelEntry> = ({ name, engine, model }) => {
  const { createThread } = useThreads()
  const setMainViewState = useSetAtom(mainViewStateAtom)
  const setUpRemoteModelStage = useSetAtom(setUpRemoteModelStageAtom)

  const { createModel } = useCortex()
  const { getModels } = useModels()
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const assistants = useAtomValue(assistantsAtom)

  const { data: configData } = useConfigQuery()

  const modelDisplayName = model?.name ?? name

  const onClick = useCallback(async () => {
    if (!model || !configData) return
    const isApiKeyAdded =
      // @ts-expect-error engine is not null
      (configData[engine ?? '']?.apiKey ?? '').length > 0
    const isModelDownloaded = downloadedModels.find((m) => m.id === model.model)

    if (isApiKeyAdded && isModelDownloaded) {
      if (assistants.length === 0) {
        // TODO: show toast instead?
        alert('No assistant available')
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
      if (assistants.length === 0) {
        // TODO: show toast instead?
        alert('No assistant available')
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
    configData,
    createModel,
    createThread,
    downloadedModels,
    engine,
    getModels,
    model,
    setMainViewState,
    setUpRemoteModelStage,
    modelDisplayName,
  ])

  return (
    <div
      onClick={onClick}
      className="flex h-[46px] cursor-pointer flex-col justify-center border-b-[1px] border-[hsla(var(--app-border))] hover:bg-[hsla(var(--dropdown-menu-hover-bg))]"
    >
      <h1 className="text-sm font-medium leading-4">{modelDisplayName}</h1>
    </div>
  )
}

export default RemoteModelCard
