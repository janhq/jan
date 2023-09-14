/* eslint-disable react/display-name */
import React, { forwardRef } from "react";
import renderChatMessage from "../ChatBody/renderChatMessage";
import { ChatMessage } from "@/_models/ChatMessage";

type Props = {
  message: ChatMessage;
};

type Ref = HTMLDivElement;

const ChatItem = forwardRef<Ref, Props>(({ message }, ref) => {
  const item = renderChatMessage(message);

  const content = ref ? <div ref={ref}>{item}</div> : item;

  return content;
});

export default ChatItem;
