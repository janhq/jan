import { currentPromptAtom } from "@/_helpers/JotaiWrapper";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { DataService, EventName, events } from "@janhq/plugin-core";
import { RawMessage, toChatMessage } from "@/_models/ChatMessage";
import { executeSerial } from "@/_services/pluginService";
import { addNewMessageAtom } from "@/_helpers/atoms/ChatMessage.atom";
import { currentConversationAtom } from "@/_helpers/atoms/Conversation.atom";

export default function useSendChatMessage() {
  const currentConvo = useAtomValue(currentConversationAtom);
  const addNewMessage = useSetAtom(addNewMessageAtom);

  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom);

  const sendChatMessage = async () => {
    setCurrentPrompt("");
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
    events.emit(EventName.OnNewMessageRequest, newMessage);
  };

  const inferConvoSummary = async (
    convo: Conversation,
    lastMessages: RawMessage[]
  ) => {
    if (convo.summary) return;
    const newMessage: RawMessage = {
      conversationId: currentConvo?._id,
      message: "summary this conversation in 5 words",
      user: "user",
      createdAt: new Date().toISOString(),
    };
    const messageHistory = lastMessages.map((m) => toChatMessage(m));
    const newChatMessage = toChatMessage(newMessage);

    const recentMessages = [...messageHistory, newChatMessage]
      .slice(-10)
      .map((message) => ({
        content: message.text,
        role: message.messageSenderType,
      }));

    console.debug(`Sending ${JSON.stringify(recentMessages)}`);
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

    while (reader) {
      const { done, value } = await reader.read();
      if (done) {
        console.log("SSE stream closed");
        break;
      }
      const text = decoder.decode(value);
      const lines = text.trim().split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ") && !line.includes("data: [DONE]")) {
          const data = JSON.parse(line.replace("data: ", ""));
          answer += data.choices[0]?.delta?.content ?? "";
          if (answer.startsWith("assistant: ")) {
            answer = answer.replace("assistant: ", "");
          }
        }
      }
    }

    const updatedConvo: Conversation = {
      ...convo,
      summary: answer.trim(),
    };

    console.debug(`Update convo: ${JSON.stringify(updatedConvo)}`);
    await executeSerial(DataService.UpdateConversation, updatedConvo);
    updateConversation(updatedConvo);
  };

  return {
    sendChatMessage,
  };
}
