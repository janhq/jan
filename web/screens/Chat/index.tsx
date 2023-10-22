import React from 'react'

import ChatBody from '@/_components/ChatBody'
import InputToolbar from '@/_components/InputToolbar'

const ChatScreen = () => {
  return (
    <div className="flex h-full">
      <div className="border-gray-20 flex h-full w-80 flex-shrink-0 flex-col overflow-y-scroll border-r bg-white/20 dark:border-gray-900 dark:bg-black/20">
        <div className="p-6">
          <h1 className="text-base font-semibold">History</h1>
          <p>Lorem ipsum dolor sit amet consectetur adipisicing elit. Rerum veniam provident recusandae ullam ratione exercitationem dolor asperiores nam facilis perspiciatis ex odit voluptatibus dolorem fuga odio, repudiandae doloribus corrupti aliquid!</p>
        </div>

        <div className="w-full overflow-y-scroll p-6">
          <p>Lorem ipsum dolor sit amet consectetur adipisicing elit. Doloremque dignissimos velit blanditiis consequuntur, quibusdam nemo saepe ab, ipsam beatae doloribus odio corrupti, vero illo dolores libero repellendus. Doloribus, doloremque ut.</p>
        {/* <ChatBody />
        <InputToolbar /> */}
        </div>
      </div>
    </div>
  )
}

export default ChatScreen
