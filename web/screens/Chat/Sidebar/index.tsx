import { join } from 'path'

import { getUserSpace, openFileExplorer } from '@janhq/core'
import { Input, Textarea } from '@janhq/uikit'
import { atom, useAtomValue } from 'jotai'

import { twMerge } from 'tailwind-merge'

import LogoMark from '@/containers/Brand/Logo/Mark'
import CardSidebar from '@/containers/CardSidebar'
import DropdownListSidebar, {
  selectedModelAtom,
} from '@/containers/DropdownListSidebar'
import ItemCardSidebar from '@/containers/ItemCardSidebar'

import { useCreateNewThread } from '@/hooks/useCreateNewThread'

import { activeThreadAtom } from '@/helpers/atoms/Conversation.atom'

export const showRightSideBarAtom = atom<boolean>(true)

export default function Sidebar() {
  const showing = useAtomValue(showRightSideBarAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const selectedModel = useAtomValue(selectedModelAtom)
  const { updateThreadTitle } = useCreateNewThread()

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
    openFileExplorer(fullPath)
  }

  return (
    <div
      className={twMerge(
        'h-full flex-shrink-0 overflow-x-hidden border-l border-border bg-background duration-300 ease-linear',
        showing ? 'w-80' : 'w-0'
      )}
    >
      <div className="flex flex-col gap-4 p-4">
        <CardSidebar
          title="Thread"
          onRevealInFinderClick={onReviewInFinderClick}
          onViewJsonClick={onViewJsonClick}
        >
          {/* <ItemCardSidebar
            description={activeThread?.id}
            title="Thread ID"
            disabled
          />
          <ItemCardSidebar
            title="Thread title"
            description={activeThread?.title}
          /> */}
          <div className="flex flex-col space-y-4 p-2">
            <div>
              <label
                id="thread-title"
                className="mb-2 inline-block font-bold text-gray-600"
              >
                Title
              </label>
              <Input
                id="thread-title"
                value={activeThread?.title}
                onChange={(e) => {
                  updateThreadTitle(e.target.value || '')
                }}
              />
            </div>
            <div className="flex flex-col">
              <label
                id="thread-title"
                className="mb-2 inline-block font-bold text-gray-600"
              >
                Threads ID
              </label>
              <span className="text-xs">{activeThread?.id || '-'}</span>
            </div>
          </div>
        </CardSidebar>
        <CardSidebar
          title="Assistant"
          onRevealInFinderClick={onReviewInFinderClick}
          onViewJsonClick={onViewJsonClick}
        >
          {/* <ItemCardSidebar
            description={activeThread?.assistants[0].assistant_name ?? ''}
            title="Assistant"
            disabled
          />
          /> */}
          <div className="flex flex-col space-y-4 p-2">
            <div className="flex items-center space-x-2">
              <LogoMark width={24} height={24} />
              <span className="font-bold capitalize">
                {activeThread?.assistants[0].assistant_name ?? '-'}
              </span>
            </div>
            <div>
              <label
                id="thread-title"
                className="mb-2 inline-block font-bold text-gray-600"
              >
                Instructions
              </label>
              <Textarea
                id="assistant-instructions"
                placeholder="Eg. You are a helpful assistant."
              />
            </div>
          </div>
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
