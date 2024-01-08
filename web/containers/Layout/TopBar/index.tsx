import { useState } from 'react'

import { getUserSpace, joinPath, openFileExplorer } from '@janhq/core'
import { useAtom, useAtomValue } from 'jotai'
import {
  PenSquareIcon,
  MoreVerticalIcon,
  FolderOpenIcon,
  Code2Icon,
  PanelLeftCloseIcon,
  PanelRightCloseIcon,
} from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import CommandSearch from '@/containers/Layout/TopBar/CommandSearch'

import { showLeftSideBarAtom } from '@/containers/Providers/KeyListener'

import { MainViewState } from '@/constants/screens'

import { useClickOutside } from '@/hooks/useClickOutside'
import { useCreateNewThread } from '@/hooks/useCreateNewThread'
import useGetAssistants, { getAssistants } from '@/hooks/useGetAssistants'
import { useMainViewState } from '@/hooks/useMainViewState'

import { showRightSideBarAtom } from '@/screens/Chat/Sidebar'

import { activeThreadAtom, threadStatesAtom } from '@/helpers/atoms/Thread.atom'

const TopBar = () => {
  const activeThread = useAtomValue(activeThreadAtom)
  const { mainViewState } = useMainViewState()
  const { requestCreateNewThread } = useCreateNewThread()
  const { assistants } = useGetAssistants()
  const [showRightSideBar, setShowRightSideBar] = useAtom(showRightSideBarAtom)
  const [showLeftSideBar, setShowLeftSideBar] = useAtom(showLeftSideBarAtom)
  const showing = useAtomValue(showRightSideBarAtom)
  const threadStates = useAtomValue(threadStatesAtom)
  const [more, setMore] = useState(false)
  const [menu, setMenu] = useState<HTMLDivElement | null>(null)
  const [toggle, setToggle] = useState<HTMLDivElement | null>(null)

  useClickOutside(() => setMore(false), null, [menu, toggle])

  const titleScreen = (viewStateName: MainViewState) => {
    switch (viewStateName) {
      case MainViewState.Thread:
        return activeThread ? activeThread?.title : 'New Thread'

      default:
        return MainViewState[viewStateName]?.replace(/([A-Z])/g, ' $1').trim()
    }
  }

  const onCreateConversationClick = async () => {
    if (assistants.length === 0) {
      await getAssistants().then((res) => {
        if (res) {
          if (res.length === 0) {
            alert('No assistant available')
            return
          }
          requestCreateNewThread(res[0])
        }
      })
    } else {
      requestCreateNewThread(assistants[0])
    }
  }

  const onReviewInFinderClick = async () => {
    if (!activeThread) return
    const activeThreadState = threadStates[activeThread.id]
    if (!activeThreadState.isFinishInit) {
      alert('Thread is not started yet')
      return
    }

    const userSpace = await getUserSpace()
    let filePath = undefined
    filePath = await joinPath(['threads', activeThread.id])

    if (!filePath) return
    const fullPath = await joinPath([userSpace, filePath])
    openFileExplorer(fullPath)
  }

  const onViewJsonClick = async () => {
    if (!activeThread) return
    const activeThreadState = threadStates[activeThread.id]
    if (!activeThreadState.isFinishInit) {
      alert('Thread is not started yet')
      return
    }

    const userSpace = await getUserSpace()
    let filePath = undefined
    filePath = await joinPath(['threads', activeThread.id, 'thread.json'])
    if (!filePath) return
    const fullPath = await joinPath([userSpace, filePath])
    openFileExplorer(fullPath)
  }

  return (
    <div className="fixed left-0 top-0 z-50 flex h-12 w-full border-b border-border bg-background/80 backdrop-blur-md">
      {mainViewState === MainViewState.Thread && (
        <div className="relative w-full">
          <div className="absolute left-16 h-full w-60 border-r border-border">
            <div className="flex h-full w-full items-center justify-between">
              <div
                className="unset-drag cursor-pointer"
                onClick={() => setShowLeftSideBar((show) => !show)}
              >
                <PanelRightCloseIcon
                  size={20}
                  className={twMerge(
                    'ml-4 text-muted-foreground',
                    showLeftSideBar && 'rotate-180'
                  )}
                />
              </div>
              <div
                className="unset-drag cursor-pointer pr-4"
                onClick={onCreateConversationClick}
              >
                <PenSquareIcon size={20} className="text-muted-foreground" />
              </div>
            </div>
          </div>
          <div className="absolute left-80 h-full">
            <div className="flex h-full items-center">
              <span className="text-sm font-bold">
                {titleScreen(mainViewState)}
              </span>
            </div>
          </div>
          <div
            className={twMerge(
              'absolute right-0 h-full w-80',
              showing && 'border-l border-border'
            )}
          >
            {activeThread && (
              <div className="flex h-full w-52 items-center justify-between px-4">
                {showing && (
                  <div className="relative flex h-full items-center">
                    <span className="mr-2 text-sm font-bold">
                      Threads Settings
                    </span>
                    <div
                      ref={setToggle}
                      className="unset-drag cursor-pointer rounded-md p-2"
                      onClick={() => setMore(!more)}
                    >
                      <MoreVerticalIcon className="h-5 w-5" />
                    </div>

                    {more && (
                      <div
                        className="absolute right-0 top-11 z-20 w-64 overflow-hidden rounded-lg border border-border bg-background shadow-lg"
                        ref={setMenu}
                      >
                        <div
                          className="flex cursor-pointer items-center space-x-2 px-4 py-2 hover:bg-secondary"
                          onClick={() => {
                            onReviewInFinderClick()
                            setMore(false)
                          }}
                        >
                          <FolderOpenIcon
                            size={16}
                            className="text-muted-foreground"
                          />
                          <span className="font-medium text-black dark:text-muted-foreground">
                            Show in Finder
                          </span>
                        </div>
                        <div
                          className="flex cursor-pointer items-start space-x-2 px-4 py-2 hover:bg-secondary"
                          onClick={() => {
                            onViewJsonClick()
                            setMore(false)
                          }}
                        >
                          <Code2Icon
                            size={16}
                            className="mt-0.5 flex-shrink-0 text-muted-foreground"
                          />
                          <div className="flex flex-col">
                            <span className="font-medium text-black dark:text-muted-foreground">
                              Edit Threads Settings
                            </span>
                            <span className="mt-1 text-muted-foreground">
                              Opens thread.json. Changes affect this thread
                              only.
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div
                  className="unset-drag absolute right-4 cursor-pointer"
                  onClick={() => setShowRightSideBar((show) => !show)}
                >
                  <PanelLeftCloseIcon
                    size={20}
                    className={twMerge(
                      'text-muted-foreground',
                      showRightSideBar && 'rotate-180'
                    )}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {mainViewState !== MainViewState.Thread && (
        <div className="relative left-16 flex w-[calc(100%-64px)] items-center justify-between space-x-4 pl-6 pr-2">
          <span className="text-sm font-bold">
            {titleScreen(mainViewState)}
          </span>
        </div>
      )}
      <CommandSearch />
    </div>
  )
}

export default TopBar
