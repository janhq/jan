/* eslint-disable @typescript-eslint/no-explicit-any */
import { ReactNode, useEffect, useRef } from 'react'

import {
  events,
  EventName,
  ThreadMessage,
  ExtensionType,
  MessageStatus,
  Model,
  ConversationalExtension,
} from '@janhq/core'
import { useAtomValue, useSetAtom } from 'jotai'

import { activeModelAtom, stateModelAtom } from '@/hooks/useActiveModel'
import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'

import { toaster } from '../Toast'

import { extensionManager } from '@/extension'
import {
  addNewMessageAtom,
  updateMessageAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import {
  updateThreadWaitingForResponseAtom,
  threadsAtom,
} from '@/helpers/atoms/Thread.atom'

export default function EventHandler({ children }: { children: ReactNode }) {
  const addNewMessage = useSetAtom(addNewMessageAtom)
  const updateMessage = useSetAtom(updateMessageAtom)
  const { downloadedModels } = useGetDownloadedModels()
  const setActiveModel = useSetAtom(activeModelAtom)
  const setStateModel = useSetAtom(stateModelAtom)

  const updateThreadWaiting = useSetAtom(updateThreadWaitingForResponseAtom)
  const threads = useAtomValue(threadsAtom)
  const modelsRef = useRef(downloadedModels)
  const threadsRef = useRef(threads)

  useEffect(() => {
    threadsRef.current = threads
  }, [threads])

  useEffect(() => {
    modelsRef.current = downloadedModels
  }, [downloadedModels])

  async function handleNewMessageResponse(message: ThreadMessage) {
    addNewMessage(message)
  }

  async function handleModelReady(model: Model) {
    setActiveModel(model)
    toaster({
      title: 'Success!',
      description: `Model ${model.id} has been started.`,
    })
    setStateModel(() => ({
      state: 'stop',
      loading: false,
      model: model.id,
    }))
  }

  async function handleModelStopped() {
    setTimeout(async () => {
      setActiveModel(undefined)
      setStateModel({ state: 'start', loading: false, model: '' })
    }, 500)
  }

  async function handleModelFail(res: any) {
    const errorMessage = `${res.error}`
    alert(errorMessage)
    setStateModel(() => ({
      state: 'start',
      loading: false,
      model: res.modelId,
    }))
  }

  async function handleMessageResponseUpdate(message: ThreadMessage) {
    updateMessage(
      message.id,
      message.thread_id,
      message.content,
      message.status
    )
    if (message.status !== MessageStatus.Pending) {
      // Mark the thread as not waiting for response
      updateThreadWaiting(message.thread_id, false)

      const thread = threadsRef.current?.find((e) => e.id == message.thread_id)
      if (thread) {
        const messageContent = message.content[0]?.text.value ?? ''
        const metadata = {
          ...thread.metadata,
          lastMessage: messageContent,
        }
        extensionManager
          .get<ConversationalExtension>(ExtensionType.Conversational)
          ?.saveThread({
            ...thread,
            metadata,
          })

        extensionManager
          .get<ConversationalExtension>(ExtensionType.Conversational)
          ?.addNewMessage(message)
      }
    }
  }

  useEffect(() => {
    if (window.core?.events) {
      events.on(EventName.OnMessageResponse, handleNewMessageResponse)
      events.on(EventName.OnMessageUpdate, handleMessageResponseUpdate)
      events.on(EventName.OnModelReady, handleModelReady)
      events.on(EventName.OnModelFail, handleModelFail)
      events.on(EventName.OnModelStopped, handleModelStopped)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      events.off(EventName.OnMessageResponse, handleNewMessageResponse)
      events.off(EventName.OnMessageUpdate, handleMessageResponseUpdate)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <>{children}</>
}
