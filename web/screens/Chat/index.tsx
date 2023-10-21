import React from 'react'

import ChatBody from '@/_components/ChatBody'
import InputToolbar from '@/_components/InputToolbar'

const ChatScreen = () => {
  return (
    <div className="flex h-full">
      <div className="p-6">
        <h1 className="text-xl font-semibold">Chat</h1>
        <ChatBody />
        <InputToolbar />
      </div>
    </div>
  )
}

export default ChatScreen
