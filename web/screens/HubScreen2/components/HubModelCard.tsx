import React, { useCallback, useMemo } from 'react'

import { LocalEngines } from '@janhq/core'

import { Button } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'

import { MainViewState } from '@/constants/screens'

import useCortex from '@/hooks/useCortex'
import { HuggingFaceModelEntry } from '@/hooks/useHuggingFace'

import useModels from '@/hooks/useModels'
import useThreads from '@/hooks/useThreads'

import ModelTitle from './ModelTitle'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { assistantsAtom } from '@/helpers/atoms/Assistant.atom'
import { getCortexConfigAtom } from '@/helpers/atoms/CortexConfig.atom'
import { setDownloadLocalModelStageAtom } from '@/helpers/atoms/DownloadLocalModel.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'
import { setModelHubSelectedModelHandle } from '@/helpers/atoms/ModelHub.atom'
import {
  setRemoteModelBeingSetUpAtom,
  setRemoteModelSetUpStageAtom,
} from '@/helpers/atoms/SetupRemoteModel.atom'

const HubModelCard: React.FC<HuggingFaceModelEntry> = ({
  name,
  downloads,
  likes,
  model,
}) => {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const assistants = useAtomValue(assistantsAtom)
  const cortexConfig = useAtomValue(getCortexConfigAtom)

  const setDownloadLocalModelStage = useSetAtom(setDownloadLocalModelStageAtom)
  const setRemoteModelSetUpStage = useSetAtom(setRemoteModelSetUpStageAtom)
  const setRemoteModelBeingSetUp = useSetAtom(setRemoteModelBeingSetUpAtom)
  const setSelectedModelHandle = useSetAtom(setModelHubSelectedModelHandle)

  const { createThread } = useThreads()
  const setMainViewState = useSetAtom(mainViewStateAtom)
  const { createModel } = useCortex()
  const { getModels } = useModels()
  // const { selectModel } = useSelectModel()

  const isLocalModel = useMemo(
    () =>
      model == null ||
      LocalEngines.filter((e) => e === model.engine).length > 0,
    [model]
  )

  const actionLabel = useMemo(() => {
    if (isLocalModel) return 'Download'

    // if remote model, we will have model object
    if (downloadedModels.find((m) => m.id === model!.model)) return 'Use'

    // @ts-expect-error engine is not null
    const apiKey: string = cortexConfig[model?.engine ?? '']?.apiKey ?? ''
    if (apiKey.trim().length > 0) return 'Add'

    return 'Setup'
  }, [model, isLocalModel, downloadedModels, cortexConfig])

  const onActionClick = useCallback(() => {
    if (isLocalModel) {
      setSelectedModelHandle(name)
      setDownloadLocalModelStage('MODEL_LIST')
    } else {
      if (!model) return

      if (downloadedModels.find((m) => m.id === model.model)) {
        // if we already downloaded it, use it and creat new thread
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

      // @ts-expect-error engine is not null
      const apiKey: string = cortexConfig[model?.engine ?? '']?.apiKey ?? ''
      if (apiKey.trim().length > 0) {
        createModel(model).then(() => {
          getModels()
        })
        return
      }

      setRemoteModelBeingSetUp(model!)
      setRemoteModelSetUpStage('SETUP_INTRO')
    }
  }, [
    getModels,
    createModel,
    createThread,
    setMainViewState,
    setDownloadLocalModelStage,
    setSelectedModelHandle,
    setRemoteModelSetUpStage,
    setRemoteModelBeingSetUp,
    name,
    model,
    isLocalModel,
    downloadedModels,
    assistants,
    cortexConfig,
  ])

  const owner = model?.metadata?.owned_by ?? ''
  const logoUrl = model?.metadata?.owner_logo ?? ''

  return (
    <div className="flex flex-row justify-between border-b-[1px] border-[hsla(var(--app-border))] pb-3 pt-4 last:border-b-0">
      <div className="flex flex-col gap-2">
        <span>{name}</span>
        <ModelTitle
          className="text-[hsla(var(--text-secondary)] my-4"
          name={owner}
          image={logoUrl}
        />
      </div>
      <div className="flex flex-col items-end gap-2">
        <Button onClick={onActionClick}>{actionLabel}</Button>
        <span>
          Download: {downloads} Likes: {likes}
        </span>
      </div>
    </div>
  )
}

export default HubModelCard
