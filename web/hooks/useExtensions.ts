import { useCallback } from 'react'

import {
  Assistant,
  AssistantExtension,
  ConversationalExtension,
  ExtensionTypeEnum,
  Model,
  ModelExtension,
  Thread,
  ThreadMessage,
} from '@janhq/core'

import { extensionManager } from '@/extension'

const useExtensions = () => {
  const fetchAssistants = useCallback(async () => getLocalAssistants(), [])
  const fetchThreads = useCallback(async () => getLocalThreads(), [])
  const fetchModels = useCallback(async () => getLocalConfiguredModels(), [])
  const writeMessages = useCallback(
    async (threadId: string, messages: ThreadMessage[]) =>
      writeLocalMessages(threadId, messages),
    []
  )

  return { fetchAssistants, fetchThreads, fetchModels, writeMessages }
}

const getLocalAssistants = async (): Promise<Assistant[]> =>
  extensionManager
    .get<AssistantExtension>(ExtensionTypeEnum.Assistant)
    ?.getAssistants() ?? []

const getLocalThreads = async (): Promise<Thread[]> =>
  (await extensionManager
    .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
    ?.getThreads()) ?? []

const getLocalConfiguredModels = async (): Promise<Model[]> =>
  extensionManager
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.getConfiguredModels() ?? []

const getLocalDownloadedModels = async (): Promise<Model[]> =>
  extensionManager
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.getDownloadedModels() ?? []

const writeLocalMessages = async (
  threadId: string,
  messages: ThreadMessage[]
): Promise<void> => {
  await extensionManager
    .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
    ?.writeMessages(threadId, messages)
}

const deleteLocalModel = async (id: string) =>
  extensionManager.get<ModelExtension>(ExtensionTypeEnum.Model)?.deleteModel(id)

const deleteThread = async (threadId: string) =>
  extensionManager
    .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
    ?.deleteThread(threadId)

export default useExtensions
