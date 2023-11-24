import { ChatCompletionRole, PluginType } from '@janhq/core'
import { ConversationalPlugin } from '@janhq/core/lib/plugins'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { currentPromptAtom } from '@/containers/Providers/Jotai'

import { toaster } from '@/containers/Toast'

import { pluginManager } from '../plugin/PluginManager'

import { useActiveModel } from './useActiveModel'

import {
  cleanConversationMessages,
  deleteConversationMessage,
  getCurrentChatMessagesAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import {
  userConversationsAtom,
  getActiveConvoIdAtom,
  setActiveConvoIdAtom,
} from '@/helpers/atoms/Conversation.atom'

export default function useDeleteConversation() {
  const { activeModel } = useActiveModel()
  const [userConversations, setUserConversations] = useAtom(
    userConversationsAtom
  )
  const setCurrentPrompt = useSetAtom(currentPromptAtom)
  const activeConvoId = useAtomValue(getActiveConvoIdAtom)

  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom)
  const deleteMessages = useSetAtom(deleteConversationMessage)
  const cleanMessages = useSetAtom(cleanConversationMessages)
  const currentMessages = useAtomValue(getCurrentChatMessagesAtom)

  const cleanConvo = async () => {
    if (activeConvoId) {
      const currentConversation = userConversations.filter(
        (c) => c.id === activeConvoId
      )[0]
      cleanMessages(activeConvoId)
      if (currentConversation)
        await pluginManager
          .get<ConversationalPlugin>(PluginType.Conversational)
          ?.saveConversation({
            ...currentConversation,
            id: activeConvoId,
            messages: currentMessages.filter(
              (e) => e.role === ChatCompletionRole.System
            ),
          })
    }
  }
  const deleteConvo = async () => {
    if (activeConvoId) {
      try {
        await pluginManager
          .get<ConversationalPlugin>(PluginType.Conversational)
          ?.deleteConversation(activeConvoId)
        const currentConversations = userConversations.filter(
          (c) => c.id !== activeConvoId
        )
        setUserConversations(currentConversations)
        deleteMessages(activeConvoId)
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
  }

  return {
    cleanConvo,
    deleteConvo,
  }
}
