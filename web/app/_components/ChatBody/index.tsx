'use client'

import React, { useCallback, useRef, useState, useEffect } from 'react'
import ChatItem from '../ChatItem'
import { ChatMessage } from '@/_models/ChatMessage'
import useChatMessages from '@/_hooks/useChatMessages'
import { useAtomValue } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { getActiveConvoIdAtom } from '@/_helpers/atoms/Conversation.atom'
import { chatMessages } from '@/_helpers/atoms/ChatMessage.atom'

const ChatBody: React.FC = () => {
  const activeConversationId = useAtomValue(getActiveConvoIdAtom) ?? ''
  const messageList = useAtomValue(
    selectAtom(
      chatMessages,
      useCallback((v) => v[activeConversationId], [activeConversationId])
    )
  )
  const [content, setContent] = useState<React.JSX.Element[]>([])

  const [offset, setOffset] = useState(0)
  const { loading, hasMore } = useChatMessages(offset)
  const intersectObs = useRef<any>(null)

  const lastPostRef = useCallback(
    (message: ChatMessage) => {
      if (loading) return

      if (intersectObs.current) intersectObs.current.disconnect()

      intersectObs.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasMore) {
          setOffset((prevOffset) => prevOffset + 5)
        }
      })

      if (message) intersectObs.current.observe(message)
    },
    [loading, hasMore]
  )

  useEffect(() => {
    const list = messageList?.map((message, index) => {
      if (messageList?.length === index + 1) {
        return (
          // @ts-ignore
          <ChatItem ref={lastPostRef} message={message} key={message.id} />
        )
      }
      return <ChatItem message={message} key={message.id} />
    })
    setContent(list)
  }, [messageList, lastPostRef])

  return (
    <div className="scroll flex flex-1 flex-col-reverse overflow-y-auto py-4">
      {content}
    </div>
  )
}

export default ChatBody
