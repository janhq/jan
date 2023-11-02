import React from 'react'

import ChatBody from '@/components/ChatBody'
import HistoryList from '@/components/HistoryList'
import InputToolbar from '@/components/InputToolbar'
import LeftHeaderAction from '@/components/LeftHeaderAction'
import MainHeader from '@/components/MainHeader'

const ChatScreen = () => {
  return (
    <div className="flex h-full">
      <div className="border-border flex h-full w-64 flex-shrink-0 flex-col overflow-y-auto border-r ">
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
