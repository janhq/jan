import { PluginType } from '@janhq/core'
import { ConversationalPlugin } from '@janhq/core/lib/plugins'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { currentPromptAtom } from '@/containers/Providers/Jotai'

import { toaster } from '@/containers/Toast'

import { pluginManager } from '../plugin/PluginManager'

import { useActiveModel } from './useActiveModel'

import {
  cleanConversationMessages,
  deleteConversationMessage,
} from '@/helpers/atoms/ChatMessage.atom'
import {
  threadsAtom,
  getActiveThreadIdAtom,
  setActiveThreadIdAtom,
} from '@/helpers/atoms/Conversation.atom'

export default function useDeleteThread() {
  const { activeModel } = useActiveModel()
  const [userConversations, setUserConversations] = useAtom(threadsAtom)
  const setCurrentPrompt = useSetAtom(currentPromptAtom)
  const activeThreadId = useAtomValue(getActiveThreadIdAtom)

  const setActiveConvoId = useSetAtom(setActiveThreadIdAtom)
  const deleteMessages = useSetAtom(deleteConversationMessage)
  const cleanMessages = useSetAtom(cleanConversationMessages)

  const cleanConvo = async () => {
    if (activeThreadId) {
      const currentConversation = userConversations.filter(
        (c) => c.id === activeThreadId
      )[0]
      cleanMessages(activeThreadId)
      if (currentConversation)
        await pluginManager
          .get<ConversationalPlugin>(PluginType.Conversational)
          ?.saveThread({
            ...currentConversation,
            id: activeThreadId,
          })
    }
  }

  const deleteThread = async () => {
    if (!activeThreadId) {
      alert('No active thread')
      return
    }
    try {
      await pluginManager
        .get<ConversationalPlugin>(PluginType.Conversational)
        ?.deleteThread(activeThreadId)
      const currentConversations = userConversations.filter(
        (c) => c.id !== activeThreadId
      )
      setUserConversations(currentConversations)
      deleteMessages(activeThreadId)
      setCurrentPrompt('')
      toaster({
        title: 'Chat successfully deleted.',
        description: `Chat with ${activeModel?.name} has been successfully deleted.`,
      })
      if (currentConversations.length > 0) {
        setActiveConvoId(currentConversations[0].id)
      } else {
        setActiveConvoId(undefined)
      }
    } catch (err) {
      console.error(err)
    }
  }

  return {
    cleanConvo,
    deleteThread,
  }
}
