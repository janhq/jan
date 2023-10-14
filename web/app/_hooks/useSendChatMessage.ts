import { currentPromptAtom } from "@/_helpers/JotaiWrapper";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { selectAtom } from "jotai/utils";
import { DataService, InferenceService } from "@janhq/plugin-core";
import {
  MessageSenderType,
  RawMessage,
  toChatMessage,
} from "@/_models/ChatMessage";
import { executeSerial } from "@/_services/pluginService";
import { useCallback } from "react";
import {
  addNewMessageAtom,
  updateMessageAtom,
  chatMessages,
  currentStreamingMessageAtom,
} from "@/_helpers/atoms/ChatMessage.atom";
import {
  currentConversationAtom,
  getActiveConvoIdAtom,
  updateConversationWaitingForResponseAtom,
} from "@/_helpers/atoms/Conversation.atom";

export default function useSendChatMessage() {
  const currentConvo = useAtomValue(currentConversationAtom);
  const updateStreamMessage = useSetAtom(currentStreamingMessageAtom);
  const addNewMessage = useSetAtom(addNewMessageAtom);
  const updateMessage = useSetAtom(updateMessageAtom);
  const activeConversationId = useAtomValue(getActiveConvoIdAtom) ?? "";
  const updateConvWaiting = useSetAtom(
    updateConversationWaitingForResponseAtom
  );

  const chatMessagesHistory = useAtomValue(
    selectAtom(
      chatMessages,
      useCallback((v) => v[activeConversationId], [activeConversationId])
    )
  );
  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom);

  const sendChatMessage = async () => {
    setCurrentPrompt("");
    const conversationId = activeConversationId;
    updateConvWaiting(conversationId, true);
    const prompt = currentPrompt.trim();
    const newMessage: RawMessage = {
      conversationId: currentConvo?._id,
      message: prompt,
      user: "user",
      createdAt: new Date().toISOString(),
    };
    const id = await executeSerial(DataService.CreateMessage, newMessage);
    newMessage._id = id;

    const newChatMessage = await toChatMessage(newMessage);
    addNewMessage(newChatMessage);
    const messageHistory = chatMessagesHistory ?? [];
    const recentMessages = [
      ...messageHistory.sort((a, b) => parseInt(a.id) - parseInt(b.id)),
      newChatMessage,
    ]
      .slice(-10)
      .map((message) => {
        return {
          content: message.text,
          role:
            message.messageSenderType === MessageSenderType.User
              ? "user"
              : "assistant",
        };
      });
    const url = await executeSerial(InferenceService.InferenceUrl);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "Access-Control-Allow-Origi": "*",
      },
      body: JSON.stringify({
        messages: recentMessages,
        stream: true,
        model: "gpt-3.5-turbo",
        max_tokens: 500,
      }),
    });
    const stream = response.body;

    const decoder = new TextDecoder("utf-8");
    const reader = stream?.getReader();
    let answer = "";

    // Cache received response
    const newResponse: RawMessage = {
      conversationId: currentConvo?._id,
      message: answer,
      user: "assistant",
      createdAt: new Date().toISOString(),
    };
    const respId = await executeSerial(DataService.CreateMessage, newResponse);
    newResponse._id = respId;
    const responseChatMessage = await toChatMessage(newResponse);
    addNewMessage(responseChatMessage);

    while (true && reader) {
      const { done, value } = await reader.read();
      if (done) {
        console.log("SSE stream closed");
        break;
      }
      const text = decoder.decode(value);
      const lines = text.trim().split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ") && !line.includes("data: [DONE]")) {
          updateConvWaiting(conversationId, false);
          const data = JSON.parse(line.replace("data: ", ""));
          answer += data.choices[0]?.delta?.content ?? "";
          if (answer.startsWith("assistant: ")) {
            answer = answer.replace("assistant: ", "");
          }
          updateStreamMessage({
            ...responseChatMessage,
            text: answer,
          });
          updateMessage(
            responseChatMessage.id,
            responseChatMessage.conversationId,
            answer
          );
        }
      }
    }
    updateMessage(
      responseChatMessage.id,
      responseChatMessage.conversationId,
      answer.trimEnd()
    );
    await executeSerial(DataService.UpdateMessage, {
      ...newResponse,
      message: answer.trimEnd(),
      updatedAt: new Date()
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d+Z$/, ""),
    });
    updateConvWaiting(conversationId, false);
  };
  return {
    sendChatMessage,
  };
}
