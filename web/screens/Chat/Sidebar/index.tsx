import CardSidebar from '@/containers/CardSidebar'
import ItemCardSidebar from '@/containers/ItemCardSidebar'
import DropdownListSidebar, {
  selectedModelAtom,
} from '@/containers/DropdownListSidebar'
import { atom, useAtom, useAtomValue } from 'jotai'
import { activeThreadAtom } from '@/helpers/atoms/Conversation.atom'
import { fs } from '@janhq/core'
import { join } from 'path'

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

    const userSpace = await fs.getUserSpace()
    let filePath = undefined
    switch (type) {
      case 'Thread':
        filePath = join('threads', activeThread.id)
        break
      case 'Model':
        if (!selectedModel) return
        filePath = join('models', selectedModel.id)
        break
      case 'Assistant':
        const assistantId = activeThread.assistants[0]?.id
        if (!assistantId) return
        filePath = join('assistants', assistantId)
        break
      default:
        break
    }

    if (!filePath) return

    const fullPath = join(userSpace, filePath)
    console.log(fullPath)
    fs.openFileExplorer(fullPath)
  }

  const onViewJsonClick = async (type: string) => {
    if (!activeThread) return
    if (!activeThread.isFinishInit) {
      alert('Thread is not ready')
      return
    }

    const userSpace = await fs.getUserSpace()
    let filePath = undefined
    switch (type) {
      case 'Thread':
        filePath = join('threads', activeThread.id, 'thread.json')
        break
      case 'Model':
        if (!selectedModel) return
        filePath = join('models', selectedModel.id, 'model.json')
        break
      case 'Assistant':
        const assistantId = activeThread.assistants[0]?.id
        if (!assistantId) return
        filePath = join('assistants', assistantId, 'assistant.json')
        break
      default:
        break
    }

    if (!filePath) return

    const fullPath = join(userSpace, filePath)
    console.log(fullPath)
    fs.openFileExplorer(fullPath)
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
