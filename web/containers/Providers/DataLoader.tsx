'use client'

import { useEffect, useMemo } from 'react'

import { Engine } from '@cortexso/cortex.js/resources'
import {
  EngineStatus,
  LocalEngine,
  LocalEngines,
  Model,
  RemoteEngine,
  RemoteEngines,
} from '@janhq/core'
import { useAtomValue, useSetAtom } from 'jotai'

import useAssistantCreate, { janAssistant } from '@/hooks/useAssistantCreate'
import useAssistantQuery from '@/hooks/useAssistantQuery'
import useCortex from '@/hooks/useCortex'
import useEngineQuery from '@/hooks/useEngineQuery'
import { useLoadTheme } from '@/hooks/useLoadTheme'
import useModelHub from '@/hooks/useModelHub'
import useModelQuery from '@/hooks/useModelQuery'
import useThreadCreateMutation from '@/hooks/useThreadCreateMutation'
import useThreadQuery from '@/hooks/useThreadQuery'

import {
  getSelectedModelAtom,
  updateSelectedModelAtom,
} from '@/helpers/atoms/Model.atom'
import { threadsAtom } from '@/helpers/atoms/Thread.atom'

const DataLoader: React.FC = () => {
  const selectedModel = useAtomValue(getSelectedModelAtom)
  const setSelectedModel = useSetAtom(updateSelectedModelAtom)
  const allThreads = useAtomValue(threadsAtom)
  const { data: assistants } = useAssistantQuery()
  const { data: models } = useModelQuery()
  const { data: threads, isLoading: isFetchingThread } = useThreadQuery()
  const { data: engineData } = useEngineQuery()
  const { data: modelHubData } = useModelHub()
  const createThreadMutation = useThreadCreateMutation()
  const assistantCreateMutation = useAssistantCreate()
  const { createModel } = useCortex()

  useEffect(() => {
    if (!assistants) return
    if (assistants.length === 0 && assistantCreateMutation.isIdle) {
      // empty assistant. create new one
      console.debug('Empty assistants received. Create Jan Assistant...')
      assistantCreateMutation.mutate(janAssistant)
    }
  }, [assistants, assistantCreateMutation])

  const isAnyRemoteModelConfigured = useMemo(() => {
    if (!engineData) return false

    let result = false
    for (const engine of engineData) {
      if (RemoteEngines.includes(engine.name as RemoteEngine)) {
        if (engine.status === EngineStatus.Ready) {
          result = true
        }
      }
    }
    return result
  }, [engineData])

  const isAnyModelReady = useMemo(() => {
    if (!models) return false
    return models.length > 0
  }, [models])

  // automatically create new thread if thread list is empty
  useEffect(() => {
    if (isFetchingThread) return
    if (allThreads.length > 0) return
    if (!assistants || assistants.length === 0) return
    const shouldCreateNewThread = isAnyRemoteModelConfigured || isAnyModelReady

    if (shouldCreateNewThread && !createThreadMutation.isPending) {
      // if we already have selected model then can safely proceed
      if (selectedModel) {
        const assistant = assistants[0]

        console.debug(
          'Create new thread because user have no thread, with selected model',
          selectedModel.model
        )
        createThreadMutation.mutate({
          modelId: selectedModel.model,
          assistant: assistant,
        })
        return
      }

      let modelToBeUsed: Model | undefined = undefined
      // if we have a model registered already, try to use it and prioritize local model
      if (models && models.length > 0) {
        for (const model of models) {
          if (!model.engine) continue
          if (LocalEngines.includes(model.engine as LocalEngine)) {
            modelToBeUsed = model
          }
        }

        // if we don't have it, then just take the first one
        if (!modelToBeUsed) {
          modelToBeUsed = models[0]
        }
      } else {
        if (!engineData) return
        // we don't have nay registered model, so will need to check the remote engine
        const remoteEngineReadyList: Engine[] = []
        for (const engine of engineData) {
          if (RemoteEngines.includes(engine.name as RemoteEngine)) {
            if (engine.status === EngineStatus.Ready) {
              remoteEngineReadyList.push(engine)
            }
          }
        }

        if (remoteEngineReadyList.length === 0) {
          console.debug("No remote engine ready, can't create thread")
          return
        }
        // find the model from hub that using the engine
        if (!modelHubData) return
        const remoteEngineReadyNames = remoteEngineReadyList.map((e) => e.name)

        console.log('remoteEngineReady:', remoteEngineReadyNames)
        // loop through the modelHubData.modelCategories to find the model that using the engine
        for (const [key, value] of modelHubData.modelCategories) {
          if (remoteEngineReadyNames.includes(key) && value.length > 0) {
            modelToBeUsed = value[0].model
            if (modelToBeUsed) break
          }
        }
      }

      if (!modelToBeUsed) {
        console.debug('No model to be used')
        return
      }
      console.log(
        'Create new thread because user have no thread, model to be used:',
        modelToBeUsed.model
      )
      createModel(modelToBeUsed)
      setSelectedModel(modelToBeUsed)
      const assistant = assistants[0]
      createThreadMutation.mutate({
        modelId: modelToBeUsed.model,
        assistant: assistant,
      })
    }
  }, [
    assistants,
    models,
    isFetchingThread,
    threads,
    createThreadMutation,
    allThreads,
    selectedModel,
    isAnyModelReady,
    isAnyRemoteModelConfigured,
    engineData,
    modelHubData,
    setSelectedModel,
    createModel,
  ])

  useLoadTheme()

  return null
}

export default DataLoader
