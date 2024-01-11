import React from 'react'

import { useAtomValue } from 'jotai'

import ModelReload from '@/containers/Loader/ModelReload'
import ModelStart from '@/containers/Loader/ModelStart'

import { showLeftSideBarAtom } from '@/containers/Providers/KeyListener'

import useSendChatMessage from '@/hooks/useSendChatMessage'

import ChatBody from '@/screens/Chat/ChatBody'

import ThreadList from '@/screens/Chat/ThreadList'

import ChatInput from './ChatInput'
import RequestDownloadModel from './RequestDownloadModel'
import Sidebar from './Sidebar'

import {
  activeThreadAtom,
  engineParamsUpdateAtom,
} from '@/helpers/atoms/Thread.atom'

const ChatScreen: React.FC = () => {
  const activeThread = useAtomValue(activeThreadAtom)
  const showLeftSideBar = useAtomValue(showLeftSideBarAtom)
  const engineParamsUpdate = useAtomValue(engineParamsUpdateAtom)
  const { queuedMessage, reloadModel } = useSendChatMessage()

  return (
    <div className="flex h-full w-full">
      {/* Left side bar */}
      {showLeftSideBar ? (
        <div className="flex h-full w-60 flex-shrink-0 flex-col overflow-y-auto border-r border-border">
          <ThreadList />
        </div>
      ) : null}

      <div className="relative flex h-full w-full flex-col overflow-auto bg-background">
        <div className="flex h-full w-full flex-col justify-between">
          {activeThread ? (
            <div className="flex h-full w-full overflow-y-auto overflow-x-hidden">
              <ChatBody />
            </div>
          ) : (
            <RequestDownloadModel />
          )}

          {!engineParamsUpdate && <ModelStart />}

          {reloadModel && (
            <>
              <ModelReload />
              <div className="mb-2 text-center">
                <span className="text-muted-foreground">
                  Model is reloading to apply new changes.
                </span>
              </div>
            </>
          )}

          {queuedMessage && !reloadModel && (
            <div className="mb-2 text-center">
              <span className="text-muted-foreground">
                Message queued. It can be sent once the model has started
              </span>
            </div>
          )}
        </div>
        <ChatInput />
      </div>
      {/* Right side bar */}
      {activeThread && <Sidebar />}
    </div>
  )
}

export default ChatScreen
