/* eslint-disable @typescript-eslint/no-explicit-any */
import { ReactNode, useCallback, useEffect, useRef } from 'react'

import {
  events,
  ThreadMessage,
  ExtensionTypeEnum,
  MessageStatus,
  Model,
  ConversationalExtension,
  MessageEvent,
  ModelEvent,
} from '@janhq/core'
import { useAtomValue, useSetAtom } from 'jotai'

import {
  activeModelAtom,
  loadModelErrorAtom,
  stateModelAtom,
} from '@/hooks/useActiveModel'

import { queuedMessageAtom } from '@/hooks/useSendChatMessage'

import { toaster } from '../Toast'

import { extensionManager } from '@/extension'
import {
  addNewMessageAtom,
  updateMessageAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'
import {
  updateThreadWaitingForResponseAtom,
  threadsAtom,
  isGeneratingResponseAtom,
} from '@/helpers/atoms/Thread.atom'

export default function EventHandler({ children }: { children: ReactNode }) {
  const addNewMessage = useSetAtom(addNewMessageAtom)
  const updateMessage = useSetAtom(updateMessageAtom)
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const setActiveModel = useSetAtom(activeModelAtom)
  const setStateModel = useSetAtom(stateModelAtom)
  const setQueuedMessage = useSetAtom(queuedMessageAtom)
  const setLoadModelError = useSetAtom(loadModelErrorAtom)

  const updateThreadWaiting = useSetAtom(updateThreadWaitingForResponseAtom)
  const threads = useAtomValue(threadsAtom)
  const modelsRef = useRef(downloadedModels)
  const threadsRef = useRef(threads)
  const setIsGeneratingResponse = useSetAtom(isGeneratingResponseAtom)

  useEffect(() => {
    threadsRef.current = threads
  }, [threads])

  useEffect(() => {
    modelsRef.current = downloadedModels
  }, [downloadedModels])

  const onNewMessageResponse = useCallback(
    (message: ThreadMessage) => {
      addNewMessage(message)
    },
    [addNewMessage]
  )

  const onModelReady = useCallback(
    (model: Model) => {
      setActiveModel(model)
      toaster({
        title: 'Success!',
        description: `Model ${model.id} has been started.`,
        type: 'success',
      })
      setStateModel(() => ({
        state: 'stop',
        loading: false,
        model: model.id,
      }))
    },
    [setActiveModel, setStateModel]
  )

  const onModelStopped = useCallback(() => {
    setTimeout(() => {
      setActiveModel(undefined)
      setStateModel({ state: 'start', loading: false, model: '' })
    }, 500)
  }, [setActiveModel, setStateModel])

  const onModelInitFailed = useCallback(
    (res: any) => {
      const errorMessage = `${res.error}`
      console.error('Failed to load model: ' + errorMessage)
      setLoadModelError(errorMessage)
      setStateModel(() => ({
        state: 'start',
        loading: false,
        model: res.modelId,
      }))
      setQueuedMessage(false)
    },
    [setStateModel, setQueuedMessage, setLoadModelError]
  )

  const onMessageResponseUpdate = useCallback(
    (message: ThreadMessage) => {
      updateMessage(
        message.id,
        message.thread_id,
        message.content,
        message.status
      )
      if (message.status === MessageStatus.Pending) {
        if (message.content.length) {
          updateThreadWaiting(message.thread_id, false)
          setIsGeneratingResponse(false)
        }
        return
      }
      // Mark the thread as not waiting for response
      updateThreadWaiting(message.thread_id, false)

      setIsGeneratingResponse(false)

      const thread = threadsRef.current?.find((e) => e.id == message.thread_id)
      if (thread) {
        const messageContent = message.content[0]?.text.value ?? ''
        const metadata = {
          ...thread.metadata,
          lastMessage: messageContent,
        }
        extensionManager
          .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
          ?.saveThread({
            ...thread,
            metadata,
          })

        extensionManager
          .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
          ?.addNewMessage(message)
      }
    },
    [updateMessage, updateThreadWaiting, setIsGeneratingResponse]
  )

  useEffect(() => {
    console.log('Registering events')
    if (window.core?.events) {
      events.on(MessageEvent.OnMessageResponse, onNewMessageResponse)
      events.on(MessageEvent.OnMessageUpdate, onMessageResponseUpdate)

      events.on(ModelEvent.OnModelReady, onModelReady)
      events.on(ModelEvent.OnModelFail, onModelInitFailed)
      events.on(ModelEvent.OnModelStopped, onModelStopped)
    }
  }, [
    onNewMessageResponse,
    onMessageResponseUpdate,
    onModelReady,
    onModelInitFailed,
    onModelStopped,
  ])

  useEffect(() => {
    return () => {
      events.off(MessageEvent.OnMessageResponse, onNewMessageResponse)
      events.off(MessageEvent.OnMessageUpdate, onMessageResponseUpdate)
    }
  }, [onNewMessageResponse, onMessageResponseUpdate])
  return <>{children}</>
}
