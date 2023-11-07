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
import {
  showingProductDetailAtom,
  showingAdvancedPromptAtom,
} from '@/helpers/atoms/Modal.atom'

export default function useDeleteConversation() {
  const { activeModel } = useActiveModel()
  const [userConversations, setUserConversations] = useAtom(
    userConversationsAtom
  )
  const setCurrentPrompt = useSetAtom(currentPromptAtom)
  const setShowingProductDetail = useSetAtom(showingProductDetailAtom)
  const setShowingAdvancedPrompt = useSetAtom(showingAdvancedPromptAtom)
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
          (c) => c._id !== activeConvoId
        )
        setUserConversations(currentConversations)
        deleteMessages(activeConvoId)
        toaster({
          title: 'Succes delete a chat',
          description: `Delete chat with ${activeModel} has been completed`,
        })
        if (currentConversations.length > 0) {
          setActiveConvoId(currentConversations[0]._id)
        } else {
          setActiveConvoId(undefined)
        }
        setCurrentPrompt('')
        setShowingProductDetail(false)
        setShowingAdvancedPrompt(false)
      } catch (err) {
        console.error(err)
      }
    }
  }

  return {
    deleteConvo,
  }
}
