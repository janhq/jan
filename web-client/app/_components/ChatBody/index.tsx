"use client";

import React, { useCallback, useRef, useState } from "react";
import ChatItem from "../ChatItem";
import { ChatMessage } from "@/_models/ChatMessage";
import useChatMessages from "@/_hooks/useChatMessages";
import {
  currentChatMessagesAtom,
  showingTyping,
} from "@/_helpers/JotaiWrapper";
import { useAtomValue } from "jotai";
import LoadingIndicator from "../LoadingIndicator";

const ChatBody: React.FC = () => {
  const messages = useAtomValue(currentChatMessagesAtom);
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

  const content = messages.map((message, index) => {
    if (messages.length === index + 1) {
      // @ts-ignore
      return <ChatItem ref={lastPostRef} message={message} key={message.id} />;
    }
    return <ChatItem message={message} key={message.id} />;
  });

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
