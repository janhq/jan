import { join } from 'path'

import { getUserSpace, openFileExplorer } from '@janhq/core'
import { atom, useAtomValue } from 'jotai'

import CardSidebar from '@/containers/CardSidebar'
import DropdownListSidebar, {
  selectedModelAtom,
} from '@/containers/DropdownListSidebar'
import ItemCardSidebar from '@/containers/ItemCardSidebar'

import { activeThreadAtom } from '@/helpers/atoms/Conversation.atom'

export const showRightSideBarAtom = atom<boolean>(false)

export default function Sidebar() {
  const showing = useAtomValue(showRightSideBarAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const selectedModel = useAtomValue(selectedModelAtom)

  const onReviewInFinderClick = async (type: string) => {
    if (!activeThread) return
    if (!activeThread.isFinishInit) {
      alert('Thread is not ready')
      return
    }

    const userSpace = await getUserSpace()
    let filePath = undefined
    const assistantId = activeThread.assistants[0]?.assistant_id
    switch (type) {
      case 'Thread':
        filePath = join('threads', activeThread.id)
        break
      case 'Model':
        if (!selectedModel) return
        filePath = join('models', selectedModel.id)
        break
      case 'Assistant':
        if (!assistantId) return
        filePath = join('assistants', assistantId)
        break
      default:
        break
    }

    if (!filePath) return

    const fullPath = join(userSpace, filePath)
    console.log(fullPath)
    openFileExplorer(fullPath)
  }

  const onViewJsonClick = async (type: string) => {
    if (!activeThread) return
    if (!activeThread.isFinishInit) {
      alert('Thread is not ready')
      return
    }

    const userSpace = await getUserSpace()
    let filePath = undefined
    const assistantId = activeThread.assistants[0]?.assistant_id
    switch (type) {
      case 'Thread':
        filePath = join('threads', activeThread.id, 'thread.json')
        break
      case 'Model':
        if (!selectedModel) return
        filePath = join('models', selectedModel.id, 'model.json')
        break
      case 'Assistant':
        if (!assistantId) return
        filePath = join('assistants', assistantId, 'assistant.json')
        break
      default:
        break
    }

    if (!filePath) return

    const fullPath = join(userSpace, filePath)
    console.log(fullPath)
    openFileExplorer(fullPath)
  }

  return (
    <div
      className={`h-full overflow-x-hidden border-l border-border duration-300 ease-linear ${
        showing ? 'w-80' : 'w-0'
      }`}
    >
      <div className="flex flex-col gap-1 p-2">
        <CardSidebar
          title="Thread"
          onRevealInFinderClick={onReviewInFinderClick}
          onViewJsonClick={onViewJsonClick}
        >
          <ItemCardSidebar description={activeThread?.id} title="Thread ID" />
          <ItemCardSidebar title="Thread title" />
        </CardSidebar>
        <CardSidebar
          title="Assistant"
          onRevealInFinderClick={onReviewInFinderClick}
          onViewJsonClick={onViewJsonClick}
        >
          <ItemCardSidebar
            description={activeThread?.assistants[0].assistant_name ?? ''}
            title="Assistant"
          />
        </CardSidebar>
        <CardSidebar
          title="Model"
          onRevealInFinderClick={onReviewInFinderClick}
          onViewJsonClick={onViewJsonClick}
        >
          <DropdownListSidebar />
        </CardSidebar>
      </div>
    </div>
  )
}
