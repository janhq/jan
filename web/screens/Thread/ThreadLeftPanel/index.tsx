import { useCallback, useEffect, useState } from 'react'

import { InferenceEngine, Thread } from '@janhq/core'

import { Button } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  GalleryHorizontalEndIcon,
  MoreHorizontalIcon,
  Paintbrush,
  PencilIcon,
  Trash2Icon,
} from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import LeftPanelContainer from '@/containers/LeftPanelContainer'

import { useCreateNewThread } from '@/hooks/useCreateNewThread'
import useRecommendedModel from '@/hooks/useRecommendedModel'
import useSetActiveThread from '@/hooks/useSetActiveThread'

import {
  activeAssistantAtom,
  assistantsAtom,
} from '@/helpers/atoms/Assistant.atom'
import { editMessageAtom } from '@/helpers/atoms/ChatMessage.atom'

import {
  getActiveThreadIdAtom,
  modalActionThreadAtom,
  threadDataReadyAtom,
  ThreadModalAction,
  threadsAtom,
} from '@/helpers/atoms/Thread.atom'

const ThreadLeftPanel = () => {
  const threads = useAtomValue(threadsAtom)
  const activeThreadId = useAtomValue(getActiveThreadIdAtom)
  const activeAssistant = useAtomValue(activeAssistantAtom)
  const { setActiveThread } = useSetActiveThread()
  const assistants = useAtomValue(assistantsAtom)
  const threadDataReady = useAtomValue(threadDataReadyAtom)
  const { requestCreateNewThread } = useCreateNewThread()
  const setEditMessage = useSetAtom(editMessageAtom)
  const { recommendedModel, downloadedModels } = useRecommendedModel()
  const setModalActionThread = useSetAtom(modalActionThreadAtom)

  const [contextMenu, setContextMenu] = useState<{
    visible: boolean
    thread?: Thread
  }>({
    visible: false,
    thread: undefined,
  })

  const onThreadClick = useCallback(
    (thread: Thread) => {
      setActiveThread(thread)
      setEditMessage('')
    },
    [setActiveThread, setEditMessage]
  )

  /**
   * Auto create thread
   * This will create a new thread if there are assistants available
   * and there are no threads available
   */

  useEffect(() => {
    if (
      threadDataReady &&
      assistants.length > 0 &&
      threads.length === 0 &&
      downloadedModels.length > 0
    ) {
      const model = downloadedModels.filter(
        (model) => model.engine === InferenceEngine.cortex_llamacpp
      )
      const selectedModel = model[0] || recommendedModel
      requestCreateNewThread(
        activeAssistant
          ? { ...assistants[0], ...activeAssistant }
          : assistants[0],
        selectedModel
      )
    } else if (threadDataReady && !activeThreadId) {
      setActiveThread(threads[0])
    }
  }, [
    assistants,
    threads,
    threadDataReady,
    requestCreateNewThread,
    activeThreadId,
    setActiveThread,
    recommendedModel,
    downloadedModels,
    activeAssistant,
  ])

  const onContextMenu = (event: React.MouseEvent, thread: Thread) => {
    event.preventDefault()
    setContextMenu({
      visible: true,
      thread,
    })
  }

  const closeContextMenu = () => {
    setContextMenu({
      visible: false,
      thread: undefined,
    })
  }

  return (
    <LeftPanelContainer>
      {threads.length === 0 ? (
        <div className="p-2 text-center">
          <GalleryHorizontalEndIcon
            size={16}
            className="text-[hsla(var(--text-secondary)] mx-auto mb-3"
          />
          <h2 className="font-medium">No Thread History</h2>
        </div>
      ) : (
        <div className="p-3">
          {threads.map((thread) => (
            <div
              key={thread.id}
              className={twMerge(
                `group/message relative mb-1 flex cursor-pointer flex-col transition-all hover:rounded-lg hover:bg-[hsla(var(--left-panel-menu-hover))]`,
                activeThreadId === thread.id &&
                  'rounded-lg bg-[hsla(var(--left-panel-icon-active-bg))]'
              )}
              onClick={() => {
                onThreadClick(thread)
              }}
              onContextMenu={(e) => onContextMenu(e, thread)}
              onMouseLeave={closeContextMenu}
            >
              <div className="relative z-10 break-all p-2">
                <h1
                  className={twMerge(
                    'line-clamp-1 pr-2 font-medium group-hover/message:pr-6',
                    activeThreadId && 'font-medium'
                  )}
                >
                  {thread.title ?? thread.metadata?.title}
                </h1>
              </div>
              <div
                className={twMerge(
                  `group/icon text-[hsla(var(--text-secondary)] invisible absolute right-1 top-1/2 z-20 -translate-y-1/2 rounded-md px-0.5 group-hover/message:visible`
                )}
              >
                <Button theme="icon" className="mt-2">
                  <MoreHorizontalIcon />
                </Button>
                <div
                  className={twMerge(
                    'invisible absolute -right-1 z-50 w-40 overflow-hidden rounded-lg border border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))] shadow-lg group-hover/icon:visible',
                    contextMenu.visible &&
                      contextMenu.thread?.id === thread.id &&
                      'visible'
                  )}
                >
                  <div
                    className="flex cursor-pointer items-center space-x-2 px-4 py-2 hover:bg-[hsla(var(--dropdown-menu-hover-bg))]"
                    onClick={(e) => {
                      setModalActionThread({
                        showModal: ThreadModalAction.EditTitle,
                        thread,
                      })
                      e.stopPropagation()
                    }}
                  >
                    <PencilIcon
                      size={16}
                      className="text-[hsla(var(--text-secondary))]"
                    />
                    <span className="text-bold text-[hsla(var(--app-text-primary))]">
                      Edit title
                    </span>
                  </div>
                  <div
                    className="flex cursor-pointer items-center space-x-2 px-4 py-2 hover:bg-[hsla(var(--dropdown-menu-hover-bg))]"
                    onClick={(e) => {
                      setModalActionThread({
                        showModal: ThreadModalAction.Clean,
                        thread,
                      })
                      e.stopPropagation()
                    }}
                  >
                    <Paintbrush
                      size={16}
                      className="text-[hsla(var(--text-secondary))]"
                    />
                    <span className="text-bold text-[hsla(var(--app-text-primary))]">
                      Clean thread
                    </span>
                  </div>
                  <div
                    className="flex cursor-pointer items-center space-x-2 px-4 py-2 hover:bg-[hsla(var(--dropdown-menu-hover-bg))]"
                    onClick={(e) => {
                      setModalActionThread({
                        showModal: ThreadModalAction.Delete,
                        thread,
                      })
                      e.stopPropagation()
                    }}
                  >
                    <Trash2Icon
                      size={16}
                      className="text-[hsla(var(--destructive-bg))]"
                    />
                    <span className="text-bold text-[hsla(var(--destructive-bg))]">
                      Delete thread
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </LeftPanelContainer>
  )
}

export default ThreadLeftPanel
