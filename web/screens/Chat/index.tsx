import React from 'react'

import ChatBody from '@/_components/ChatBody'
import InputToolbar from '@/_components/InputToolbar'

const ChatScreen = () => {
  return (
    <div className="flex h-full">
      <div className="border-gray-20 border-border flex h-full w-80 flex-shrink-0 flex-col overflow-y-scroll border-r">
        <div className="p-6">
          <h1 className="text-base font-semibold">History</h1>
          <div className="mt-4">
            <p>
              Lorem ipsum dolor sit amet consectetur adipisicing elit. Rerum
              veniam provident recusandae ullam ratione exercitationem dolor
              asperiores nam facilis perspiciatis ex odit voluptatibus dolorem
              fuga odio, repudiandae doloribus corrupti aliquid!
            </p>
          </div>
        </div>
      </div>
      <div className="bg-background/50 relative w-full overflow-y-scroll p-5">
        <ChatBody />
        <InputToolbar />
      </div>
    </div>
  )
}

export default ChatScreen
