import { currentPromptAtom } from '@helpers/JotaiWrapper'
import { executeSerial } from '@services/pluginService'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { DataService } from '@janhq/core'
import { deleteConversationMessage } from '@helpers/atoms/ChatMessage.atom'
import {
  userConversationsAtom,
  getActiveConvoIdAtom,
  setActiveConvoIdAtom,
} from '@helpers/atoms/Conversation.atom'
import {
  showingProductDetailAtom,
  showingAdvancedPromptAtom,
} from '@helpers/atoms/Modal.atom'
import {
  MainViewState,
  setMainViewStateAtom,
} from '@helpers/atoms/MainView.atom'

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
        await executeSerial(DataService.DeleteConversation, activeConvoId)
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
