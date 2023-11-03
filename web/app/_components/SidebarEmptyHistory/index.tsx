import useCreateConversation from '@hooks/useCreateConversation'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useState } from 'react'
import {
  MainViewState,
  setMainViewStateAtom,
} from '@helpers/atoms/MainView.atom'
import { activeModelAtom } from '@helpers/atoms/Model.atom'
import { useGetDownloadedModels } from '@hooks/useGetDownloadedModels'
import { Button } from '@uikit'
import { MessageCircle } from 'lucide-react'
import { showingModalNoActiveModel } from '@helpers/atoms/Modal.atom'

enum ActionButton {
  DownloadModel = 'Download a Model',
  StartChat = 'Start a Conversation',
}

const SidebarEmptyHistory: React.FC = () => {
  const { downloadedModels } = useGetDownloadedModels()
  const activeModel = useAtomValue(activeModelAtom)
  const setMainView = useSetAtom(setMainViewStateAtom)
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

  const onClick = async () => {
    if (action === ActionButton.DownloadModel) {
      setMainView(MainViewState.ExploreModel)
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
        <Button onClick={onClick} themes="accent">
          {action}
        </Button>
      </div>
    </div>
  )
}

export default SidebarEmptyHistory
