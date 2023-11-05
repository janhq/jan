import { useEffect, useState } from 'react'

import { useAtomValue, useSetAtom } from 'jotai'

import { MessageCircle } from 'lucide-react'

import { MainViewState } from '@/constants/screens'

import useCreateConversation from '@/hooks/useCreateConversation'
import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'
import { useMainViewState } from '@/hooks/useMainViewState'

import { showingModalNoActiveModel } from '@/helpers/atoms/Modal.atom'
import { activeAssistantModelAtom } from '@/helpers/atoms/Model.atom'

enum ActionButton {
  DownloadModel = 'Download a Model',
  StartChat = 'Start a Conversation',
}

const SidebarEmptyHistory: React.FC = () => {
  const { downloadedModels } = useGetDownloadedModels()
  const { setMainViewState } = useMainViewState()
  const { requestCreateConvo } = useCreateConversation()
  const [action, setAction] = useState(ActionButton.DownloadModel)
  const modalNoActiveModel = useSetAtom(showingModalNoActiveModel)

  useEffect(() => {
    if (downloadedModels.length > 0) {
      setAction(ActionButton.StartChat)
    } else {
      setAction(ActionButton.DownloadModel)
    }
  }, [downloadedModels])

  const activeModel = useAtomValue(activeAssistantModelAtom)
  const onClick = async () => {
    if (action === ActionButton.DownloadModel) {
      setMainViewState(MainViewState.ExploreModels)
    } else {
      if (!activeModel) {
        modalNoActiveModel(true)
      } else {
        await requestCreateConvo(activeModel)
      }
    }
  }

  return (
    <div className="flex flex-col items-center gap-3 py-10">
      <MessageCircle size={24} />
      <div className="flex flex-col items-center">
        <h6 className="text-center text-base">No Chat History</h6>
        <p className="mb-6 mt-1 text-center text-muted-foreground">
          Get started by creating a new chat.
        </p>
        <button onClick={onClick}>{action}</button>
      </div>
    </div>
  )
}

export default SidebarEmptyHistory
