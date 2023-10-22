import useCreateConversation from '@hooks/useCreateConversation'
import PrimaryButton from '../PrimaryButton'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useState } from 'react'
import {
  MainViewState,
  setMainViewStateAtom,
} from '@helpers/atoms/MainView.atom'
import { activeAssistantModelAtom } from '@helpers/atoms/Model.atom'
import useInitModel from '@hooks/useInitModel'
import { useGetDownloadedModels } from '@hooks/useGetDownloadedModels'
import { ChatBubbleOvalLeftEllipsisIcon } from '@heroicons/react/24/outline'

enum ActionButton {
  DownloadModel = 'Download a Model',
  StartChat = 'Start a Conversation',
}

const SidebarEmptyHistory: React.FC = () => {
  const { downloadedModels } = useGetDownloadedModels()
  const activeModel = useAtomValue(activeAssistantModelAtom)
  const setMainView = useSetAtom(setMainViewStateAtom)
  const { requestCreateConvo } = useCreateConversation()
  const [action, setAction] = useState(ActionButton.DownloadModel)

  const { initModel } = useInitModel()

  useEffect(() => {
    if (downloadedModels.length > 0) {
      setAction(ActionButton.StartChat)
    } else {
      setAction(ActionButton.DownloadModel)
    }
  }, [downloadedModels])

  const onClick = () => {
    if (action === ActionButton.DownloadModel) {
      setMainView(MainViewState.ExploreModel)
    } else {
      if (!activeModel) {
        setMainView(MainViewState.ConversationEmptyModel)
      } else {
        createConversationAndInitModel(activeModel)
      }
    }
  }

  const createConversationAndInitModel = async (model: AssistantModel) => {
    await requestCreateConvo(model)
    await initModel(model)
  }

  return (
    <div className="flex flex-col items-center gap-3 py-10">
      <ChatBubbleOvalLeftEllipsisIcon width={32} height={32} />
      <div className="flex flex-col items-center gap-6">
        <div className="text-center text-sm text-gray-900">No Chat History</div>
        <div className="text-center text-sm text-gray-500">
          Get started by creating a new chat.
        </div>
        <PrimaryButton title={action} onClick={onClick} />
      </div>
    </div>
  )
}

export default SidebarEmptyHistory
