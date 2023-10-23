import React from 'react'

import ChatBody from '@/_components/ChatBody'
import InputToolbar from '@/_components/InputToolbar'
import HistoryList from '@/_components/HistoryList'
import MainHeader from '@/_components/MainHeader'
import LeftHeaderAction from '@/_components/LeftHeaderAction'

const ChatScreen = () => {
  return (
    <div className="flex h-full">
      <div className="border-border flex h-full w-80 flex-shrink-0 flex-col overflow-y-scroll border-r ">
        <div className="px-4 py-6 pt-4">
          <LeftHeaderAction />
          <HistoryList />
        </div>
      </div>
      <div className="bg-background/50 relative flex h-full w-full flex-col">
        <MainHeader />
        <ChatBody />
        <InputToolbar />
      </div>
    </div>
  )
}

export default ChatScreen
