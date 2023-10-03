"use client";

import React, { useCallback, useRef, useState } from "react";
import ChatItem from "../ChatItem";
import { ChatMessage } from "@/_models/ChatMessage";
import useChatMessages from "@/_hooks/useChatMessages";
import { showingTyping } from "@/_helpers/JotaiWrapper";
import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import LoadingIndicator from "../LoadingIndicator";
import { getActiveConvoIdAtom } from "@/_helpers/atoms/Conversation.atom";
import { chatMessages } from "@/_helpers/atoms/ChatMessage.atom";

const ChatBody: React.FC = () => {
  const activeConversationId = useAtomValue(getActiveConvoIdAtom) ?? "";
  const messageList = useAtomValue(
    selectAtom(
      chatMessages,
      useCallback((v) => v[activeConversationId], [activeConversationId])
    )
  );
  const [content, setContent] = useState<React.JSX.Element[]>([]);

  const isTyping = useAtomValue(showingTyping);
  const [offset, setOffset] = useState(0);
  const { loading, hasMore } = useChatMessages(offset);
  const intersectObs = useRef<any>(null);

  const lastPostRef = useCallback(
    (message: ChatMessage) => {
      if (loading) return;

      if (intersectObs.current) intersectObs.current.disconnect();

      intersectObs.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasMore) {
          setOffset((prevOffset) => prevOffset + 5);
        }
      });

      if (message) intersectObs.current.observe(message);
    },
    [loading, hasMore]
  );

  React.useEffect(() => {
    const list = messageList?.map((message, index) => {
      if (messageList?.length === index + 1) {
        return (
          // @ts-ignore
          <ChatItem ref={lastPostRef} message={message} key={message.id} />
        );
      }
      return <ChatItem message={message} key={message.id} />;
    });
    setContent(list);
  }, [messageList, lastPostRef]);

  return (
    <div className="flex flex-col-reverse flex-1 py-4 overflow-y-auto scroll">
      {isTyping && (
        <div className="ml-4 mb-2" key="indicator">
          <LoadingIndicator />
        </div>
      )}
      {content}
    </div>
  );
};

export default ChatBody;
