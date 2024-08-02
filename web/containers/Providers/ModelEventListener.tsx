import { useCallback, useEffect, useRef } from 'react'

import {
  EmptyModelEvent,
  ModelEvent,
  ModelStatus,
  StatusAndEvent,
} from '@janhq/core'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { useAtomValue, useSetAtom } from 'jotai'

import { removeDownloadSuccessItemAtom } from '@/hooks/useDownloadState'
import useModels from '@/hooks/useModels'

import { toaster } from '../Toast'

import { hostAtom } from '@/helpers/atoms/AppConfig.atom'
import { activeModelsAtom } from '@/helpers/atoms/Model.atom'
import { isLoadingModelAtom } from '@/helpers/atoms/Thread.atom'

function ModelEventListener() {
  const setActiveModels = useSetAtom(activeModelsAtom)
  const host = useAtomValue(hostAtom)
  const abortController = useRef<AbortController | null>(null)
  const removeDownloadSuccessItem = useSetAtom(removeDownloadSuccessItemAtom)
  const setIsLoadingModel = useSetAtom(isLoadingModelAtom)

  const { getModels } = useModels()

  const handleModelEvent = useCallback(
    (modelEvent: ModelEvent) => {
      console.log('Model event:', modelEvent.event)
      switch (modelEvent.event) {
        case 'starting':
          setIsLoadingModel(true)
          break

        case 'started':
          setIsLoadingModel(false)
          toaster({
            title: 'Success!',
            description: `Model ${modelEvent.model} has been started.`,
            type: 'success',
          })
          break

        case 'starting-failed':
          setIsLoadingModel(false)
          toaster({
            title: 'Failed!',
            description: `Model ${modelEvent.model} failed to start.`,
            type: 'error',
          })
          break

        case 'stopped':
          setIsLoadingModel(false)
          toaster({
            title: 'Success!',
            description: `Model ${modelEvent.model} has been stopped.`,
            type: 'success',
          })
          break

        case 'model-downloaded':
          removeDownloadSuccessItem(modelEvent.model)
          getModels()
          break

        case 'model-deleted':
          getModels()
          break

        case 'stopping-failed':
          setIsLoadingModel(false)
          toaster({
            title: 'Failed!',
            description: `Model ${modelEvent.model} failed to stop.`,
            type: 'error',
          })
          break

        default:
          break
      }
    },
    [getModels, removeDownloadSuccessItem, setIsLoadingModel]
  )

  const subscribeModelEvent = useCallback(async () => {
    if (abortController.current) return
    abortController.current = new AbortController()

    await fetchEventSource(`${host}/system/events/model`, {
      onmessage(ev) {
        if (!ev.data || ev.data === '') return
        try {
          const modelEvent = JSON.parse(ev.data) as StatusAndEvent

          const runningModels: ModelStatus[] = []
          Object.values(modelEvent.status).forEach((value) => {
            runningModels.push(value)
          })
          setActiveModels(runningModels)

          if (modelEvent.event === EmptyModelEvent) return
          handleModelEvent(modelEvent.event as ModelEvent)
        } catch (err) {
          console.error(err)
        }
      },
      signal: abortController.current.signal,
    })
  }, [host, setActiveModels, handleModelEvent])

  const unsubscribeModelEvent = useCallback(() => {
    if (!abortController.current) return

    abortController.current.abort()
    abortController.current = null
  }, [])

  useEffect(() => {
    subscribeModelEvent()
    return () => {
      unsubscribeModelEvent()
    }
  }, [subscribeModelEvent, unsubscribeModelEvent])

  return null
}

export default ModelEventListener
