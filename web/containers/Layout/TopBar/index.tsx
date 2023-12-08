import { useAtomValue, useSetAtom } from 'jotai'
import { PanelLeftIcon, PenSquareIcon, PanelRightIcon } from 'lucide-react'

import CommandListDownloadedModel from '@/containers/Layout/TopBar/CommandListDownloadedModel'
import CommandSearch from '@/containers/Layout/TopBar/CommandSearch'

import { MainViewState } from '@/constants/screens'

import { useCreateNewThread } from '@/hooks/useCreateNewThread'
import useGetAssistants, { getAssistants } from '@/hooks/useGetAssistants'
import { useMainViewState } from '@/hooks/useMainViewState'

import { showRightSideBarAtom } from '@/screens/Chat/Sidebar'

import { activeThreadAtom } from '@/helpers/atoms/Conversation.atom'

const TopBar = () => {
  const activeThread = useAtomValue(activeThreadAtom)
  const { mainViewState } = useMainViewState()
  const { requestCreateNewThread } = useCreateNewThread()
  const { assistants } = useGetAssistants()
  const setShowRightSideBar = useSetAtom(showRightSideBarAtom)

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

  return (
    <div className="fixed left-0 top-0 z-50 flex h-12 w-full border-b border-border bg-background/80 backdrop-blur-md">
      {mainViewState === MainViewState.Thread && (
        <div className="absolute left-16 h-full w-60 border-r border-border" />
      )}
      <div className="relative left-16 flex w-[calc(100%-64px)] items-center justify-between space-x-4 pl-6 pr-2">
        {mainViewState === MainViewState.Thread ? (
          <div className="unset-drag flex space-x-8">
            <div className="flex w-52 justify-between">
              <div className="cursor-pointer">
                <PanelLeftIcon
                  size={20}
                  className="invisible text-muted-foreground"
                />
              </div>
              <div
                className="cursor-pointer pr-2"
                onClick={onCreateConversationClick}
              >
                <PenSquareIcon size={20} className="text-muted-foreground" />
              </div>
            </div>
            <span className="text-sm font-bold">
              {titleScreen(mainViewState)}
            </span>
            {activeThread && (
              <div
                className="unset-drag absolute right-4 cursor-pointer"
                onClick={() => setShowRightSideBar((show) => !show)}
              >
                <PanelRightIcon size={20} className="text-muted-foreground" />
              </div>
            )}
          </div>
        ) : (
          <div>
            <span className="text-sm font-bold">
              {titleScreen(mainViewState)}
            </span>
          </div>
        )}
        <CommandSearch />
        <CommandListDownloadedModel />
      </div>
    </div>
  )
}

export default TopBar
