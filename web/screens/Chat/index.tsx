import React from 'react'

import { useAtomValue } from 'jotai'

import { twMerge } from 'tailwind-merge'

import ModelStart from '@/containers/Loader/ModelStart'

import ChatBody from '@/screens/Chat/ChatBody'

import ThreadList from '@/screens/Chat/ThreadList'

import ChatInput from './ChatInput'
import MessageQueuedBanner from './MessageQueuedBanner'
import RequestDownloadModel from './RequestDownloadModel'
import Sidebar, { showRightSideBarAtom } from './Sidebar'

import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

const ChatScreen: React.FC = () => {
  const activeThread = useAtomValue(activeThreadAtom)
  const showing = useAtomValue(showRightSideBarAtom)

  return (
    <div className="flex h-full w-full">
      <div className="flex h-full w-60 flex-shrink-0 flex-col overflow-y-auto border-r border-border bg-background dark:bg-background/50">
        <ThreadList />
      </div>
      <div
        className={twMerge(
          'relative flex h-full flex-col bg-background',
          activeThread && showing ? 'w-[calc(100%-560px)]' : 'w-full'
        )}
      >
        <div className="flex h-full w-full flex-col justify-between">
          {activeThread ? (
            <div className="flex h-full w-full overflow-y-auto overflow-x-hidden">
              <ChatBody />
            </div>
          ) : (
            <RequestDownloadModel />
          )}

          <ModelStart />

          <MessageQueuedBanner />
          <ChatInput />
        </div>
      </div>

      {/* Sidebar */}
      {activeThread && <Sidebar />}
    </div>
  )
}

export default ChatScreen
