import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { currentPromptAtom } from '@/helpers/JotaiWrapper'
import { deleteConversationMessage } from '@/helpers/atoms/ChatMessage.atom'
import { PluginType } from '@janhq/core'
import {
  userConversationsAtom,
  getActiveConvoIdAtom,
  setActiveConvoIdAtom,
} from '@/helpers/atoms/Conversation.atom'
import {
  MainViewState,
  setMainViewStateAtom,
} from '@/helpers/atoms/MainView.atom'
import {
  showingProductDetailAtom,
  showingAdvancedPromptAtom,
} from '@/helpers/atoms/Modal.atom'
import { pluginManager } from '../plugin/PluginManager'
import { ConversationalPlugin } from '@janhq/core/lib/plugins'

export default function useDeleteConversation() {
  const [userConversations, setUserConversations] = useAtom(
    userConversationsAtom
  )
  const setCurrentPrompt = useSetAtom(currentPromptAtom)
  const setShowingProductDetail = useSetAtom(showingProductDetailAtom)
  const setShowingAdvancedPrompt = useSetAtom(showingAdvancedPromptAtom)
  const activeConvoId = useAtomValue(getActiveConvoIdAtom)

  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom)
  const deleteMessages = useSetAtom(deleteConversationMessage)
  const setMainViewState = useSetAtom(setMainViewStateAtom)

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

        if (currentConversations.length > 0) {
          setActiveConvoId(currentConversations[0]._id)
        } else {
          setMainViewState(MainViewState.Welcome)
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
