import { PluginType } from '@janhq/core'
import { ConversationalPlugin } from '@janhq/core/lib/plugins'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { currentPromptAtom } from '@/containers/Providers/Jotai'

import { toaster } from '@/containers/Toast'

import { pluginManager } from '../plugin/PluginManager'

import { useActiveModel } from './useActiveModel'

import { deleteConversationMessage } from '@/helpers/atoms/ChatMessage.atom'
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
          title: 'Succes delete a chat',
          description: `Delete chat with ${activeModel?.name} has been completed`,
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
    deleteConvo,
  }
}
