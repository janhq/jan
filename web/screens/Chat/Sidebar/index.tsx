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

import { useCreateNewThread } from '@/hooks/useCreateNewThread'

import { activeThreadAtom, threadStatesAtom } from '@/helpers/atoms/Thread.atom'
import ModelSetting from '../ModelSetting'

export const showRightSideBarAtom = atom<boolean>(true)

export default function Sidebar() {
  const showing = useAtomValue(showRightSideBarAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const selectedModel = useAtomValue(selectedModelAtom)
  const { updateThreadMetadata } = useCreateNewThread()
  const threadStates = useAtomValue(threadStatesAtom)

  const onReviewInFinderClick = async (type: string) => {
    if (!activeThread) return
    const activeThreadState = threadStates[activeThread.id]
    if (!activeThreadState.isFinishInit) {
      alert('Thread is not started yet')
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
    const activeThreadState = threadStates[activeThread.id]
    if (!activeThreadState.isFinishInit) {
      alert('Thread is not started yet')
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
        'h-full flex-shrink-0 overflow-x-hidden border-l border-border bg-background transition-all duration-100 dark:bg-background/20',
        showing
          ? 'w-80 translate-x-0 opacity-100'
          : 'w-0 translate-x-full opacity-0'
      )}
    >
      <div
        className={twMerge(
          'flex flex-col gap-4 p-4 delay-200',
          showing ? 'animate-enter opacity-100' : 'opacity-0'
        )}
      >
        <CardSidebar
          title="Thread"
          onRevealInFinderClick={onReviewInFinderClick}
          onViewJsonClick={onViewJsonClick}
        >
          <div className="flex flex-col space-y-4 p-2">
            <div>
              <label
                id="thread-title"
                className="mb-2 inline-block font-bold text-gray-600 dark:text-gray-300"
              >
                Title
              </label>
              <Input
                id="thread-title"
                value={activeThread?.title}
                onChange={(e) => {
                  if (activeThread)
                    updateThreadMetadata({
                      ...activeThread,
                      title: e.target.value || '',
                    })
                }}
              />
            </div>
            <div className="flex flex-col">
              <label
                id="thread-title"
                className="mb-2 inline-block font-bold text-gray-600 dark:text-gray-300"
              >
                Threads ID
              </label>
              <span className="text-xs text-muted-foreground">
                {activeThread?.id || '-'}
              </span>
            </div>
          </div>
        </CardSidebar>
        <CardSidebar
          title="Assistant"
          onRevealInFinderClick={onReviewInFinderClick}
          onViewJsonClick={onViewJsonClick}
        >
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
                className="mb-2 inline-block font-bold text-gray-600 dark:text-gray-300"
              >
                Instructions
              </label>
              <Textarea
                id="assistant-instructions"
                placeholder="Eg. You are a helpful assistant."
                value={activeThread?.assistants[0].instructions ?? ''}
                onChange={(e) => {
                  if (activeThread)
                    updateThreadMetadata({
                      ...activeThread,
                      assistants: [
                        {
                          ...activeThread.assistants[0],
                          instructions: e.target.value || '',
                        },
                      ],
                    })
                }}
              />
            </div>
          </div>
        </CardSidebar>
        <CardSidebar
          title="Model"
          onRevealInFinderClick={onReviewInFinderClick}
          onViewJsonClick={onViewJsonClick}
        >
          <div className="p-2">
            <DropdownListSidebar />
          </div>
        </CardSidebar>
        <CardSidebar
          title="Model parameter"
          onRevealInFinderClick={() => {}}
          onViewJsonClick={() => {}}
        >
          <ModelSetting />
        </CardSidebar>
      </div>
    </div>
  )
}
