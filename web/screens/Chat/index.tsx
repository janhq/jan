import React from 'react'

import ChatBody from '@/_components/ChatBody'
import InputToolbar from '@/_components/InputToolbar'
import HistoryList from '@/_components/HistoryList'
import MainHeader from '@/_components/MainHeader'
import LeftHeaderAction from '@/_components/LeftHeaderAction'

const ChatScreen = () => {
  return (
    <div className="flex h-full">
      <div className="flex h-full w-64 flex-shrink-0 flex-col overflow-y-auto border-r border-border ">
        <LeftHeaderAction />
        <HistoryList />
      </div>
      <div className="relative flex h-full w-full flex-col bg-background/50">
        <MainHeader />
        <ChatBody />
        <InputToolbar />
      </div>
    </div>
  )
}

export default ChatScreen
