import { useEffect } from 'react'

import {
  Modal,
  ModalTrigger,
  ModalClose,
  ModalFooter,
  ModalPortal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  Button,
} from '@janhq/uikit'

import { motion as m } from 'framer-motion'
import { useAtomValue } from 'jotai'
import {
  GalleryHorizontalEndIcon,
  MoreVerticalIcon,
  Trash2Icon,
  Paintbrush,
} from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import { useCreateNewThread } from '@/hooks/useCreateNewThread'
import useDeleteThread from '@/hooks/useDeleteThread'

import useGetAssistants from '@/hooks/useGetAssistants'
import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'
import useSetActiveThread from '@/hooks/useSetActiveThread'

import useThreads from '@/hooks/useThreads'

import { displayDate } from '@/utils/datetime'

import {
  activeThreadAtom,
  threadStatesAtom,
  threadsAtom,
} from '@/helpers/atoms/Thread.atom'

export default function ThreadList() {
  const threads = useAtomValue(threadsAtom)
  const threadStates = useAtomValue(threadStatesAtom)
  const { getThreads } = useThreads()
  const { assistants } = useGetAssistants()
  const { requestCreateNewThread } = useCreateNewThread()
  const activeThread = useAtomValue(activeThreadAtom)
  const { deleteThread, cleanThread } = useDeleteThread()
  const { downloadedModels } = useGetDownloadedModels()

  const { activeThreadId, setActiveThread: onThreadClick } =
    useSetActiveThread()

  useEffect(() => {
    getThreads()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (
      downloadedModels.length !== 0 &&
      threads.length === 0 &&
      assistants.length !== 0 &&
      !activeThread
    ) {
      requestCreateNewThread(assistants[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistants, threads, downloadedModels, activeThread])

  return (
    <div className="px-3 py-4">
      {threads.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <GalleryHorizontalEndIcon
            size={26}
            className="mx-auto mb-3 text-muted-foreground"
          />
          <h2 className="font-semibold">No Thread History</h2>
        </div>
      ) : (
        threads.map((thread, i) => {
          const lastMessage =
            threadStates[thread.id]?.lastMessage ?? 'No new message'
          return (
            <div
              key={i}
              className={twMerge(
                `group/message relative mb-1 flex cursor-pointer flex-col transition-all hover:rounded-lg hover:bg-gray-100 hover:dark:bg-secondary/50`
              )}
              onClick={() => {
                onThreadClick(thread)
              }}
            >
              <div className="relative z-10 p-4 py-4">
                <div className="flex justify-between">
                  <h2 className="line-clamp-1 font-bold">{thread.title}</h2>
                  <p className="mb-1 line-clamp-1 text-xs leading-5 text-muted-foreground">
                    {thread.updated &&
                      displayDate(new Date(thread.updated).getTime())}
                  </p>
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-gray-700 group-hover/message:max-w-[160px] dark:text-gray-300">
                  {lastMessage || 'No new message'}
                </p>
              </div>
              <div
                className={twMerge(
                  `group/icon invisible absolute bottom-2 right-2 z-20 rounded-lg p-1 text-muted-foreground hover:bg-gray-200 group-hover/message:visible hover:dark:bg-secondary`
                )}
              >
                <MoreVerticalIcon />
                <div className="invisible absolute right-0 z-20 w-40 overflow-hidden rounded-lg border border-border bg-background shadow-lg group-hover/icon:visible">
                  <Modal>
                    <ModalTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <div className="flex cursor-pointer items-center space-x-2 px-4 py-2 hover:bg-secondary">
                        <Paintbrush
                          size={16}
                          className="text-muted-foreground"
                        />
                        <span className="text-bold text-black dark:text-muted-foreground">
                          Clean thread
                        </span>
                      </div>
                    </ModalTrigger>
                    <ModalPortal />
                    <ModalContent>
                      <ModalHeader>
                        <ModalTitle>Clean Thread</ModalTitle>
                      </ModalHeader>
                      <p>Are you sure you want to clean this thread?</p>
                      <ModalFooter>
                        <div className="flex gap-x-2">
                          <ModalClose
                            asChild
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button themes="ghost">No</Button>
                          </ModalClose>
                          <ModalClose asChild>
                            <Button
                              themes="danger"
                              onClick={(e) => {
                                e.stopPropagation()
                                cleanThread(thread.id)
                              }}
                              autoFocus
                            >
                              Yes
                            </Button>
                          </ModalClose>
                        </div>
                      </ModalFooter>
                    </ModalContent>
                  </Modal>
                  <Modal>
                    <ModalTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <div className="flex cursor-pointer items-center space-x-2 px-4 py-2 hover:bg-secondary">
                        <Trash2Icon
                          size={16}
                          className="text-muted-foreground"
                        />
                        <span className="text-bold text-black dark:text-muted-foreground">
                          Delete thread
                        </span>
                      </div>
                    </ModalTrigger>
                    <ModalPortal />
                    <ModalContent>
                      <ModalHeader>
                        <ModalTitle>Delete Thread</ModalTitle>
                      </ModalHeader>
                      <p>
                        Are you sure you want to delete this thread? This action
                        cannot be undone.
                      </p>
                      <ModalFooter>
                        <div className="flex gap-x-2">
                          <ModalClose
                            asChild
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button themes="ghost">No</Button>
                          </ModalClose>
                          <ModalClose asChild>
                            <Button
                              autoFocus
                              themes="danger"
                              onClick={(e) => {
                                e.stopPropagation()
                                deleteThread(thread.id)
                              }}
                            >
                              Yes
                            </Button>
                          </ModalClose>
                        </div>
                      </ModalFooter>
                    </ModalContent>
                  </Modal>
                </div>
              </div>
              {activeThreadId === thread.id && (
                <m.div
                  className="absolute inset-0 left-0 h-full w-full rounded-lg bg-gray-100 p-4 dark:bg-secondary/50"
                  layoutId="active-thread"
                />
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
