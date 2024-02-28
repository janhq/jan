import { useState } from 'react'

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

import { usePath } from '@/hooks/usePath'

import { showRightSideBarAtom } from '@/screens/Chat/Sidebar'

import { openFileTitle } from '@/utils/titleUtils'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { assistantsAtom } from '@/helpers/atoms/Assistant.atom'
import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

const TopBar = () => {
  const activeThread = useAtomValue(activeThreadAtom)
  const mainViewState = useAtomValue(mainViewStateAtom)
  const { requestCreateNewThread } = useCreateNewThread()
  const assistants = useAtomValue(assistantsAtom)
  const [showRightSideBar, setShowRightSideBar] = useAtom(showRightSideBarAtom)
  const [showLeftSideBar, setShowLeftSideBar] = useAtom(showLeftSideBarAtom)
  const showing = useAtomValue(showRightSideBarAtom)
  const { onRevealInFinder, onViewJson } = usePath()
  const [more, setMore] = useState(false)
  const [menu, setMenu] = useState<HTMLDivElement | null>(null)
  const [toggle, setToggle] = useState<HTMLDivElement | null>(null)

  useClickOutside(() => setMore(false), null, [menu, toggle])

  const titleScreen = (viewStateName: MainViewState) => {
    switch (viewStateName) {
      case MainViewState.Thread:
        return activeThread ? activeThread?.title : 'New Thread'

      case MainViewState.LocalServer:
        return 'Local API Server'

      default:
        return MainViewState[viewStateName]?.replace(/([A-Z])/g, ' $1').trim()
    }
  }

  const onCreateConversationClick = async () => {
    if (assistants.length === 0) {
      alert('No assistant available')
    } else {
      requestCreateNewThread(assistants[0])
    }
  }

  return (
    <div className="fixed left-0 top-0 z-20 flex h-12 w-full border-b border-border bg-background/80 backdrop-blur-md">
      {mainViewState !== MainViewState.Thread &&
      mainViewState !== MainViewState.LocalServer ? (
        <div className="relative left-16 flex w-[calc(100%-64px)] items-center justify-between space-x-4 pl-6 pr-2">
          <span className="text-sm font-bold">
            {titleScreen(mainViewState)}
          </span>
        </div>
      ) : (
        <div className="relative w-full">
          {mainViewState == MainViewState.Thread && (
            <div className="absolute left-16 h-full w-60 border-r border-border">
              <div className="flex h-full w-full items-center justify-between">
                <div
                  className={twMerge('unset-drag cursor-pointer')}
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
                  data-testid="btn-create-thread"
                  onClick={onCreateConversationClick}
                >
                  <PenSquareIcon size={20} className="text-muted-foreground" />
                </div>
              </div>
            </div>
          )}
          <div
            className={twMerge(
              'absolute right-10 h-full',
              mainViewState == MainViewState.Thread
                ? 'left-80'
                : 'left-16 pl-6',
              showing && 'right-80'
            )}
          >
            <div className="flex h-full items-center">
              <span className="unselect truncate text-ellipsis text-sm font-bold">
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
            {((activeThread && mainViewState === MainViewState.Thread) ||
              mainViewState === MainViewState.LocalServer) && (
              <div className="flex h-full w-52 items-center justify-between px-4">
                {showing && (
                  <div className="relative flex h-full items-center">
                    <span className="unselect mr-2 text-sm font-bold">
                      {mainViewState === MainViewState.Thread &&
                        'Threads Settings'}
                      {mainViewState === MainViewState.LocalServer &&
                        'Model Settings'}
                    </span>
                    <div
                      ref={setToggle}
                      className="unset-drag cursor-pointer rounded-md p-2"
                      onClick={() => setMore(!more)}
                    >
                      <MoreVerticalIcon className="h-5 w-5" />
                    </div>

                    {mainViewState === MainViewState.Thread && more && (
                      <div
                        className="absolute right-0 top-11 z-20 w-64 overflow-hidden rounded-lg border border-border bg-background shadow-lg"
                        ref={setMenu}
                      >
                        <div
                          className="flex cursor-pointer items-center space-x-2 px-4 py-2 hover:bg-secondary"
                          onClick={() => {
                            onRevealInFinder('Thread')
                            setMore(false)
                          }}
                        >
                          <FolderOpenIcon
                            size={16}
                            className="text-muted-foreground"
                          />
                          <span className="font-medium text-black ">
                            {openFileTitle()}
                          </span>
                        </div>
                        <div
                          className="flex cursor-pointer items-start space-x-2 px-4 py-2 hover:bg-secondary"
                          onClick={() => {
                            onViewJson('Thread')
                            setMore(false)
                          }}
                        >
                          <Code2Icon
                            size={16}
                            className="mt-0.5 flex-shrink-0 text-muted-foreground"
                          />
                          <div className="flex flex-col">
                            <span className="font-medium text-black ">
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

                    {mainViewState === MainViewState.LocalServer && more && (
                      <div
                        className="absolute right-0 top-11 z-20 w-64 overflow-hidden rounded-lg border border-border bg-background shadow-lg"
                        ref={setMenu}
                      >
                        <div
                          className="flex cursor-pointer items-center space-x-2 px-4 py-2 hover:bg-secondary"
                          onClick={() => {
                            onRevealInFinder('Model')
                            setMore(false)
                          }}
                        >
                          <FolderOpenIcon
                            size={16}
                            className="text-muted-foreground"
                          />
                          <div className="flex flex-col">
                            <span className="font-medium text-black ">
                              {openFileTitle()}
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
      <CommandSearch />
    </div>
  )
}

export default TopBar
